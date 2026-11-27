"""Lease-fenced source discovery worker. Run with python -m sources.worker."""
import argparse
import logging
import time
from contextlib import contextmanager
from datetime import timedelta
from threading import Event, Thread
from uuid import uuid4

from sqlalchemy import and_, delete, insert, or_, select
from sqlalchemy.exc import OperationalError

from . import connection_tests, connector
from .catalog import Claim, LeaseLost, LEASE_SECONDS, MAX_ATTEMPTS, REVOCATIONS, STAGE_BATCH, TRANSIENT, now, utc
from .core import Core, DomainError
from .models import Asset, ConfigRevision, Snapshot, SnapshotAsset, Source, StageAsset, SyncRun


log = logging.getLogger(__name__)


def identity(row):
    return row.schema_name, row.object_name, row.kind, row.relation_oid


class Worker:
    def __init__(self, core, *, lease_seconds=LEASE_SECONDS):
        self.core = core
        self.lease = timedelta(seconds=lease_seconds)

    def _finish(self, session, run, status, code=None):
        run.status, run.error_code, run.finished_at, run.lease_until = status, code, now(), None
        session.execute(delete(StageAsset).where(StageAsset.run_id == run.id))
        self.core.audit(session, run.workspace_id, run.actor, "sync." + status, run.source_id,
                        {"run_id": run.id, "revision": run.revision, "error_code": code})

    def claim(self):
        while True:
            with self.core.sessions.begin() as session:
                at = now()
                runnable = or_(and_(SyncRun.status == "queued", SyncRun.available_at <= at),
                               and_(SyncRun.status == "running", SyncRun.lease_until <= at),
                               and_(SyncRun.status.in_(("queued", "running")), SyncRun.deadline_at <= at))
                run = session.scalar(select(SyncRun).where(runnable).order_by(SyncRun.available_at, SyncRun.id)
                                     .limit(1).with_for_update(skip_locked=True))
                if run is None:
                    return None
                if utc(run.deadline_at) <= at or run.attempts >= MAX_ATTEMPTS:
                    self._finish(session, run, "failed", "timeout" if utc(run.deadline_at) <= at else "worker_interrupted")
                    continue
                run.status = "running"
                run.execution_token += 1
                run.attempts += 1
                run.started_at = run.started_at or at
                run.lease_until = min(utc(run.deadline_at), at + self.lease)
                run.error_code = None
                session.execute(delete(StageAsset).where(StageAsset.run_id == run.id))
                return Claim(run.id, run.workspace_id, run.source_id, run.revision, run.execution_token)

    def _locked(self, session, claim, *, write_source=False):
        # All transactions that acquire both locks take the source first.
        source = session.scalar(select(Source).where(Source.workspace_id == claim.workspace_id, Source.id == claim.source_id)
                                .with_for_update(read=not write_source))
        run = session.scalar(select(SyncRun).where(SyncRun.id == claim.run_id).with_for_update())
        at = now()
        if (not source or not source.enabled or source.current_config_revision != claim.revision or not run
                or run.revision != claim.revision or run.source_id != source.id or run.status != "running"
                or run.execution_token != claim.token or not run.lease_until or utc(run.lease_until) <= at
                or utc(run.deadline_at) <= at):
            raise LeaseLost
        return source, run

    def renew(self, claim):
        with self.core.sessions.begin() as session:
            _, run = self._locked(session, claim)
            run.lease_until = min(utc(run.deadline_at), now() + self.lease)

    @contextmanager
    def renewing(self, claim):
        stopped = Event()

        def heartbeat():
            while not stopped.wait(self.lease.total_seconds() / 3):
                try:
                    self.renew(claim)
                except LeaseLost:
                    return
                except Exception:
                    # A failed heartbeat cannot grant more time; publication still checks the lease.
                    log.warning("Could not renew source sync lease for run %s", claim.run_id)
                    return

        thread = Thread(target=heartbeat, daemon=True)
        thread.start()
        try:
            yield
        finally:
            stopped.set()
            thread.join(timeout=2)

    def stage(self, claim, objects):
        for offset in range(0, len(objects), STAGE_BATCH):
            with self.core.sessions.begin() as session:
                self._locked(session, claim)
                batch = [{"run_id": claim.run_id, "execution_token": claim.token, "schema_name": item["schema"],
                          "object_name": item["name"], "kind": item["kind"], "relation_oid": item["oid"],
                          "columns": item["columns"]} for item in objects[offset:offset + STAGE_BATCH]]
                session.execute(insert(StageAsset), batch)

    def publish(self, claim, expected_count):
        with self.core.sessions.begin() as session:
            source, run = self._locked(session, claim, write_source=True)
            staged = session.scalars(select(StageAsset).where(StageAsset.run_id == run.id,
                                     StageAsset.execution_token == claim.token)).all()
            if len(staged) != expected_count:
                raise ValueError("Incomplete discovery staging.")
            config = session.get(ConfigRevision, (source.id, claim.revision))
            snap = Snapshot(id=str(uuid4()), source_id=source.id, revision=claim.revision, run_id=run.id, created_at=now())
            session.add(snap)
            session.flush()
            previously_visible = session.scalars(select(Asset).where(Asset.source_id == source.id, Asset.available)).all()
            previous = {identity(a): a for a in previously_visible if a.target_generation == config.target_generation
                        and a.last_snapshot_id == source.published_snapshot_id}
            members, retained = [], set()
            saved_grants = source.preview_columns or {}
            current_grants = {}
            for item in staged:
                asset = previous.get(identity(item))
                if asset is None:
                    asset = Asset(id=str(uuid4()), source_id=source.id, target_generation=config.target_generation,
                                  schema_name=item.schema_name, object_name=item.object_name, kind=item.kind,
                                  relation_oid=item.relation_oid, first_snapshot_id=snap.id, available=True)
                    session.add(asset)
                asset.last_snapshot_id = snap.id
                retained.add(asset.id)
                if asset.id in saved_grants:
                    signatures = {col["name"]: col for col in item.columns}
                    valid = [col for col in saved_grants[asset.id] if col == signatures.get(col["name"])]
                    if valid:
                        current_grants[asset.id] = valid
                members.append({"snapshot_id": snap.id, "asset_id": asset.id, "schema_name": item.schema_name,
                                "object_name": item.object_name, "kind": item.kind, "relation_oid": item.relation_oid,
                                "columns": item.columns})
            for asset in previously_visible:
                if asset.id not in retained:
                    asset.available = False
            session.flush()
            if members:
                session.execute(insert(SnapshotAsset), members)
            # The source / run locks preclude another publisher. Still honor the hard deadline
            # if bulk writes consumed the remainder of the lease while those locks were held.
            if now() >= min(utc(run.deadline_at), utc(run.lease_until)):
                raise LeaseLost
            source.published_snapshot_id = snap.id
            source.catalog_access_blocked = False
            if current_grants != saved_grants:
                source.preview_columns = current_grants
                source.version += 1
                source.updated_at = now()
                self.core.audit(session, run.workspace_id, run.actor, "preview.policy_invalidated", source.id,
                                {"run_id": run.id, "revision": run.revision})
            run.snapshot_id, run.asset_count = snap.id, len(members)
            self._finish(session, run, "succeeded")
            return snap.id

    def fail(self, claim, code):
        with self.core.sessions.begin() as session:
            source, run = self._locked(session, claim, write_source=True)
            at = now()
            retry_at = at + timedelta(seconds=2 ** run.attempts)
            if code in TRANSIENT and run.attempts < MAX_ATTEMPTS and retry_at < utc(run.deadline_at):
                run.status, run.error_code, run.available_at, run.lease_until = "queued", code, retry_at, None
                session.execute(delete(StageAsset).where(StageAsset.run_id == run.id))
                self.core.audit(session, run.workspace_id, run.actor, "sync.retry", source.id,
                                {"run_id": run.id, "revision": run.revision, "error_code": code})
            else:
                if code in REVOCATIONS:
                    source.catalog_access_blocked = True
                self._finish(session, run, "failed", code)

    def run_once(self):
        claim = self.claim()
        if claim is None:
            return False
        try:
            with self.renewing(claim):
                with self.core.sessions.begin() as session:
                    source, _ = self._locked(session, claim)
                    config, password = self.core.connection(session, source, claim.revision)
                try:
                    objects = connector.discover(config, password)
                finally:
                    del password
                self.stage(claim, objects)
            self.publish(claim, len(objects))
        except LeaseLost:
            pass
        except (connector.ConnectorError, DomainError) as exc:
            self._fail_current(claim, exc.code)
        except Exception:
            log.error("Source sync failed for run %s", claim.run_id)
            self._fail_current(claim, "worker_error")
        return True

    def _fail_current(self, claim, code):
        try:
            self.fail(claim, code)
        except LeaseLost:
            pass


def main(argv=None):
    parser = argparse.ArgumentParser(description="Process PostgreSQL source catalog syncs.")
    parser.add_argument("--once", action="store_true", help="Process one available sync, then exit.")
    args = parser.parse_args(argv)
    worker = Worker(Core())
    idle = True
    next_maintenance = time.monotonic()
    while True:
        try:
            at = time.monotonic()
            if idle and at >= next_maintenance:
                next_maintenance = at + 60
                connection_tests.expire_probes(worker.core)
                with worker.core.sessions.begin() as session:
                    worker.core.cleanup_idempotency(session, limit=100)
            idle = not worker.run_once()
        except OperationalError:
            log.error("The platform database is unavailable.")
            if args.once:
                raise SystemExit(1) from None
            idle = True
        if args.once:
            return
        if idle:
            time.sleep(1)


if __name__ == "__main__":
    main()
