"""Transactional PostgreSQL catalog, with a short database transaction on each side of remote I/O."""
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select, tuple_

from . import connector, paging
from .core import DomainError
from .models import Asset, ConfigRevision, ConnectionTest, Snapshot, SnapshotAsset, Source, StageAsset, SyncRun


MAX_ATTEMPTS = 3
LEASE_SECONDS = 45
RUN_SECONDS = 600
STAGE_BATCH = 200
REVOCATIONS = {"authentication_failed", "schema_denied", "access_denied", "auth_failed", "permission_denied"}
TRANSIENT = {"timeout", "unavailable"}


def now():
    return datetime.now(timezone.utc)


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def stamp(value):
    return utc(value).isoformat() if value is not None else None


def page_size(value):
    if type(value) is not int or not 1 <= value <= 100:
        raise DomainError(422, "invalid_limit", "Choose a page size between 1 and 100.")
    return value


def run_info(run):
    return {"id": run.id, "source_id": run.source_id, "revision": run.revision, "status": run.status,
            "attempts": run.attempts, "error_code": run.error_code, "asset_count": run.asset_count,
            "snapshot_id": run.snapshot_id, "created_at": stamp(run.created_at),
            "started_at": stamp(run.started_at), "finished_at": stamp(run.finished_at)}


def member_info(row):
    return {"id": row.asset_id, "asset_id": row.asset_id, "snapshot_id": row.snapshot_id, "schema": row.schema_name,
            "name": row.object_name, "kind": row.kind, "qualified_name": row.schema_name + "." + row.object_name}


def resource_id(value, kind):
    try:
        return str(UUID(str(value)))
    except ValueError:
        raise DomainError(404, kind + "_not_found", "The requested " + kind + " was not found.") from None


def last_key(token, scope, parts):
    try:
        key = json.loads(paging.read_token(token, scope))
        if not isinstance(key, list) or len(key) != parts or not all(isinstance(part, str) for part in key):
            raise ValueError
        return key
    except (ValueError, TypeError, KeyError):
        raise DomainError(400, "invalid_cursor", "The cursor is invalid.") from None


@dataclass(frozen=True)
class Claim:
    run_id: str
    workspace_id: str
    source_id: str
    revision: int
    token: int


class LeaseLost(Exception):
    """Another attempt or a source change has fenced this execution."""


class Catalog:
    def __init__(self, core):
        self.core = core

    @staticmethod
    def block_access(session, source):
        """Caller holds the source lock and has checked the failed operation's revision."""
        source.catalog_access_blocked = True
        pending = session.scalars(select(SyncRun).where(SyncRun.source_id == source.id,
                                  SyncRun.revision == source.current_config_revision, SyncRun.status == "running")
                                  .with_for_update()).all()
        for run in pending:
            run.status = "superseded"
            run.error_code = "catalog_access_blocked"
            run.finished_at = now()
            run.lease_until = None
            session.execute(delete(StageAsset).where(StageAsset.run_id == run.id))

    def enqueue(self, session, workspace_id, source_id, actor_id):
        source = self.core.get_source(session, workspace_id, source_id, lock=True)
        if not source.enabled:
            raise DomainError(409, "source_disabled", "The source is disabled.")
        revision = source.current_config_revision
        config = session.get(ConfigRevision, (source_id, revision))
        if not config or not config.credential_version_id:
            raise DomainError(409, "credential_required", "Save credentials before syncing this source.")
        run = session.scalar(select(SyncRun).where(SyncRun.source_id == source_id, SyncRun.revision == revision,
                                                    SyncRun.status.in_(("queued", "running"))))
        if run is None:
            created = now()
            run = SyncRun(id=str(uuid4()), workspace_id=workspace_id, source_id=source_id, revision=revision,
                          actor=actor_id, status="queued", attempts=0, execution_token=0, available_at=created,
                          deadline_at=created + timedelta(seconds=RUN_SECONDS), created_at=created, asset_count=0)
            session.add(run)
            session.flush()
            self.core.audit(session, workspace_id, actor_id, "sync.queued", source_id, {"run_id": run.id, "revision": revision})
        return run_info(run)

    def get_run(self, session, workspace_id, run_id):
        run_id = resource_id(run_id, "run")
        run = session.scalar(select(SyncRun).where(SyncRun.workspace_id == workspace_id, SyncRun.id == run_id))
        if not run:
            raise DomainError(404, "run_not_found", "The sync run was not found.")
        return run_info(run)

    def list_runs(self, session, workspace_id, source_id, *, cursor=None, limit=25):
        self.core.get_source(session, workspace_id, source_id)
        limit = page_size(limit)
        scope = {"collection": "source_runs", "workspace": workspace_id, "source": source_id}
        query = select(SyncRun).where(SyncRun.source_id == source_id, SyncRun.workspace_id == workspace_id)
        if cursor:
            date, key = last_key(cursor, scope, 2)
            query = query.where(tuple_(SyncRun.created_at, SyncRun.id) < (datetime.fromisoformat(date), key))
        rows = session.scalars(query.order_by(SyncRun.created_at.desc(), SyncRun.id.desc()).limit(limit + 1)).all()
        page = rows[:limit]
        token = paging.page_token(scope, json.dumps([stamp(page[-1].created_at), page[-1].id])) if len(rows) > limit else None
        return {"items": [run_info(row) for row in page], "next_cursor": token}

    @staticmethod
    def _status(source, snapshot):
        if not source.enabled:
            return "disabled"
        if snapshot is not None and snapshot.revision != source.current_config_revision:
            return "pending_sync"
        if source.catalog_access_blocked:
            return "blocked"
        return "available" if snapshot else "not_synced"

    def _readable(self, session, workspace_id, source_id, snapshot_id=None):
        # A shared lock also gives a list/detail response one consistent published pointer
        # while a publisher, explicit revocation or configuration change is committing.
        source_id = resource_id(source_id, "source")
        source = session.scalar(select(Source).where(Source.workspace_id == workspace_id, Source.id == source_id)
                                .with_for_update(read=True).execution_options(populate_existing=True))
        if not source:
            raise DomainError(404, "source_not_found", "The source was not found.")
        snapshot = session.get(Snapshot, source.published_snapshot_id) if source.published_snapshot_id else None
        status = self._status(source, snapshot)
        failures = {"disabled": ("source_disabled", "The source is disabled."),
                    "pending_sync": ("catalog_stale", "Sync the current source revision to read the catalog."),
                    "blocked": ("catalog_access_blocked", "Access to this catalog is blocked."),
                    "not_synced": ("catalog_not_synced", "This source has no published catalog.")}
        if status in failures:
            raise DomainError(409, *failures[status])
        if snapshot.source_id != source_id or snapshot_id is not None and snapshot_id != snapshot.id:
            raise DomainError(409, "catalog_changed", "The published catalog changed. Reload the first page.")
        return source, snapshot

    def list_assets(self, session, workspace_id, source_id, *, schema=None, kind=None, name=None, cursor=None, limit=25):
        limit = page_size(limit)
        _, snapshot = self._readable(session, workspace_id, source_id)
        scope = {"collection": "source_assets", "workspace": workspace_id, "source": source_id,
                 "schema": schema, "kind": kind, "name": name}
        last = last_key(cursor, scope, 5) if cursor else None
        if last and last[0] != snapshot.id:
            raise DomainError(409, "catalog_changed", "The published catalog changed. Reload the first page.")
        fields = (SnapshotAsset.schema_name, SnapshotAsset.object_name, SnapshotAsset.kind, SnapshotAsset.asset_id)
        # Select list-visible metadata only. Field definitions require a separate detail request.
        query = select(SnapshotAsset.snapshot_id, SnapshotAsset.asset_id, SnapshotAsset.schema_name,
                       SnapshotAsset.object_name, SnapshotAsset.kind).where(SnapshotAsset.snapshot_id == snapshot.id)
        if schema:
            query = query.where(SnapshotAsset.schema_name == schema)
        if kind:
            query = query.where(SnapshotAsset.kind == kind)
        if name:
            query = query.where(func.lower(SnapshotAsset.object_name).contains(name.lower(), autoescape=True))
        if last:
            query = query.where(tuple_(*fields) > tuple(last[1:]))
        rows = session.execute(query.order_by(*fields).limit(limit + 1)).all()
        page = rows[:limit]
        token = None
        if len(rows) > limit:
            end = page[-1]
            token = paging.page_token(scope, json.dumps([snapshot.id, end.schema_name, end.object_name, end.kind, end.asset_id]))
        return {"items": [member_info(row) for row in page], "snapshot_id": snapshot.id, "next_cursor": token}

    @staticmethod
    def _member(session, snapshot_id, asset_id):
        asset_id = resource_id(asset_id, "asset")
        member = session.get(SnapshotAsset, (snapshot_id, asset_id))
        if member is None:
            raise DomainError(404, "asset_not_found", "This asset is not in the published catalog.")
        return member

    def get_asset(self, session, workspace_id, source_id, asset_id, *, snapshot_id=None):
        _, snapshot = self._readable(session, workspace_id, source_id, snapshot_id)
        member = self._member(session, snapshot.id, asset_id)
        return {**member_info(member), "columns": member.columns}

    def health(self, session, workspace_id, source_id):
        source = self.core.get_source(session, workspace_id, source_id)
        snap = session.get(Snapshot, source.published_snapshot_id) if source.published_snapshot_id else None
        test = session.scalar(select(ConnectionTest).where(ConnectionTest.source_id == source_id,
                              ConnectionTest.workspace_id == workspace_id, ConnectionTest.revision == source.current_config_revision)
                              .order_by(ConnectionTest.started_at.desc(), ConnectionTest.id.desc()).limit(1))
        run = session.scalar(select(SyncRun).where(SyncRun.workspace_id == workspace_id, SyncRun.source_id == source_id)
                             .order_by(SyncRun.created_at.desc(), SyncRun.id.desc()).limit(1))
        return {"source_id": source_id, "current_config_revision": source.current_config_revision,
                "catalog_status": self._status(source, snap), "published_snapshot_id": snap.id if snap else None,
                "last_published_at": stamp(snap.created_at) if snap else None, "last_published_revision": snap.revision if snap else None,
                "latest_sync_run": run_info(run) if run else None, "latest_test": None if not test else
                {"id": test.id, "revision": test.revision, "status": test.status, "error_code": test.error_code,
                 "elapsed_ms": test.elapsed_ms, "finished_at": stamp(test.finished_at)}}

    @staticmethod
    def _clear_fields(source, member, mode):
        if mode == "masked":
            return set()
        if mode != "raw":
            raise DomainError(422, "invalid_preview_mode", "Choose masked or raw preview.")
        policy = (source.preview_columns or {}).get(member.asset_id, [])
        current = {col["name"]: col for col in member.columns}
        allowed = {col["name"] for col in policy if isinstance(col, dict) and col.get("name") in current
                   and col == current[col["name"]]}
        if not allowed:
            raise DomainError(403, "preview_columns_denied", "No current columns are authorized for cleartext preview.")
        return allowed

    def preview(self, workspace_id, source_id, asset_id, *, mode, limit=15, snapshot_id=None, actor_id=None):
        actor_id = actor_id or "system"
        if type(limit) is not int or not 1 <= limit <= 50:
            raise DomainError(422, "invalid_limit", "Choose a preview size between 1 and 50.")
        with self.core.sessions.begin() as session:
            source, snap = self._readable(session, workspace_id, source_id, snapshot_id)
            member = self._member(session, snap.id, asset_id)
            if member.kind not in {"table", "partitioned_table", "partition"}:
                raise DomainError(409, "preview_not_supported", "Only tables support row preview.")
            clear = self._clear_fields(source, member, mode)
            revision, snap_id = source.current_config_revision, snap.id
            config, password = self.core.connection(session, source, revision)
            asset = {"schema": member.schema_name, "name": member.object_name, "kind": member.kind,
                     "oid": member.relation_oid, "columns": member.columns}
        try:
            result = connector.preview(config, password, asset, mode, clear, limit)
        except connector.ConnectorError as exc:
            with self.core.sessions.begin() as session:
                source = self.core.get_source(session, workspace_id, source_id, lock=True)
                if source.current_config_revision == revision and exc.code in REVOCATIONS:
                    self.block_access(session, source)
                self.core.audit(session, workspace_id, actor_id, "preview.failed", source_id,
                                {"asset_id": asset_id, "revision": revision, "error_code": exc.code})
            status = {"timeout": 504, "object_changed": 409, "preview_columns_denied": 403,
                      "preview_not_supported": 409}.get(exc.code, 502)
            raise DomainError(status, exc.code, "The source could not provide this preview.") from None
        finally:
            del password
        with self.core.sessions.begin() as session:
            source, snap = self._readable(session, workspace_id, source_id, snap_id)
            member = self._member(session, snap.id, asset_id)
            if source.current_config_revision != revision or not clear.issubset(self._clear_fields(source, member, mode)):
                raise DomainError(403, "preview_policy_changed", "Preview access changed during this read.")
            self.core.audit(session, workspace_id, actor_id, "preview.read", source_id,
                            {"asset_id": asset_id, "revision": revision, "mode": mode})
        return {**result, "asset_id": asset_id, "snapshot_id": snap_id, "read_at": stamp(now())}
