"""Transactional source configuration services. All session lifetimes belong to callers."""

import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
from datetime import timedelta
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import and_, create_engine, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from .models import (
    Asset, AuditEvent, ConfigRevision, ConnectionTest, CredentialVersion, DatasetAssetRef, IdempotencyRequest,
    Snapshot, SnapshotAsset, Source, StageAsset, SyncRun, new_id, now,
)

REPLAY_WINDOW = timedelta(days=1)


def expired_requests(at):
    """Keep the acceptance result until at least 24 hours after an associated operation finishes."""
    cutoff = at - REPLAY_WINDOW
    keep_run = select(1).where(
        SyncRun.id == IdempotencyRequest.sync_run_id,
        or_(SyncRun.status.in_(("queued", "running")), SyncRun.finished_at.is_(None), SyncRun.finished_at > cutoff)
    ).exists()
    keep_test = select(1).where(
        ConnectionTest.id == IdempotencyRequest.connection_test_id,
        or_(ConnectionTest.status == "running", ConnectionTest.finished_at.is_(None), ConnectionTest.finished_at > cutoff)
    ).exists()
    return and_(IdempotencyRequest.expires_at <= at, ~keep_run, ~keep_test)


class DomainError(Exception):
    def __init__(self, status, code, message, detail=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail


def invalid(message):
    return DomainError(422, "invalid_input", message)


def etag(version):
    return f'"{version}"'


def keyring(env_name, supplied):
    supplied = supplied if supplied is not None else os.getenv(env_name)
    if isinstance(supplied, str):
        try:
            supplied = json.loads(supplied)
        except ValueError:
            raise ValueError(f"{env_name} must be a JSON object of versioned keys.") from None
    if not isinstance(supplied, dict) or not supplied:
        raise ValueError(f"Configure {env_name} with at least one key.")
    keys = {}
    for version, value in supplied.items():
        try:
            key = value if isinstance(value, bytes) else base64.b64decode(value, altchars=b"-_", validate=True)
        except (TypeError, ValueError):
            raise ValueError(f"{env_name} must contain base64url-encoded 32-byte keys.") from None
        if not isinstance(version, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", version) or len(key) != 32:
            raise ValueError(f"Invalid version or key length in {env_name}.")
        keys[version] = key
    return keys


def short_text(value, label, limit):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise invalid(f"Enter a valid {label}.")
    return value


def canonical_fields(value):
    allowed = {"host", "port", "database", "schema", "schemas", "username", "ssl_mode", "tls_profile"}
    if not isinstance(value, dict) or set(value) - allowed:
        raise invalid("Unsupported PostgreSQL connection fields.")
    value = dict(value)
    if "schema" in value:
        if "schemas" in value:
            raise invalid("Specify the schema selection only once.")
        value["schemas"] = [value.pop("schema")]
    if "ssl_mode" in value:
        mode = value.pop("ssl_mode")
        profiles = {"verify-full":"workspace-default", "disable":"local-development"}
        if "tls_profile" in value or mode not in profiles:
            raise invalid("Choose a supported TLS profile.")
        value["tls_profile"] = profiles[mode]
    return value


def normalize_connection(value):
    value = canonical_fields(value)
    host = short_text(value.get("host"), "host", 253).strip()
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    try:
        host = str(ipaddress.ip_address(host))
    except ValueError:
        name = host.rstrip(".")
        if not name or not all(re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label) for label in name.split(".")):
            raise invalid("Enter a host name or IP address.") from None
        host = host.lower()
    port = value.get("port", 5432)
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise invalid("The port must be an integer from 1 to 65535.")
    profile = value.get("tls_profile", "workspace-default")
    if profile not in ("workspace-default", "local-development"):
        raise invalid("Choose a supported TLS profile.")
    schemas = value.get("schemas", ["public"])
    if not isinstance(schemas, list) or not 1 <= len(schemas) <= 64:
        raise invalid("Select between 1 and 64 database schemas.")
    schemas = sorted(set(short_text(schema, "schema", 63) for schema in schemas))
    return {"host":host, "port":port, "database":short_text(value.get("database"), "database", 128),
            "schemas":schemas, "username":short_text(value.get("username"), "username", 128), "tls_profile":profile}


def checked_input(payload, create):
    allowed = {"name", "corpus", "connection", "credential", "enabled", "preview_columns"}
    if create:
        allowed.update(("kind", "engine"))
    if not isinstance(payload, dict) or set(payload) - allowed:
        raise invalid("The source request contains unsupported fields.")
    if create and (payload.get("kind", "database") != "database" or payload.get("engine", "postgresql") != "postgresql"):
        raise invalid("Choose a PostgreSQL database source.")
    if "enabled" in payload and not isinstance(payload["enabled"], bool):
        raise invalid("Enabled must be a boolean.")
    if (create or "corpus" in payload) and payload.get("corpus") not in ("EU4", "Anbennar", "Real History"):
        raise invalid("Choose a supported corpus.")
    if create or "name" in payload:
        short_text(payload.get("name"), "source name", 200)
    if "credential" in payload:
        action = payload["credential"]
        if not isinstance(action, dict) or action.get("action") not in ("clear", "replace"):
            raise invalid("Choose a credential operation.")
        if action["action"] == "clear" and set(action) != {"action"}:
            raise invalid("Clearing credentials does not accept a password.")
        if action["action"] == "replace" and (set(action) != {"action","password"} or not isinstance(action["password"], str)
                                                 or not action["password"] or len(action["password"]) > 8192 or "\x00" in action["password"]):
            raise invalid("Replacing credentials requires a nonempty password.")
    if "preview_columns" in payload and not isinstance(payload["preview_columns"], dict):
        raise invalid("Preview columns must be mapped by asset ID.")


def flush_source(session):
    try:
        session.flush()
    except IntegrityError as error:
        if getattr(getattr(error.orig, "diag", None), "constraint_name", None) == "uq_source_workspace_name":
            raise DomainError(409, "source_name_conflict", "A source with that name already exists.") from None
        raise


def require_grant(name, granted, required_permissions):
    if not granted:
        raise DomainError(403, "permission_denied", "This change requires additional permission.")
    if required_permissions is not None:
        required_permissions.add(name)


class Core:
    def __init__(self, database_url=None, encryption_keys=None, hmac_keys=None):
        self.encryption_keys = keyring("SOURCES_ENCRYPTION_KEYS", encryption_keys)
        self.hmac_keys = keyring("SOURCES_HMAC_KEYS", hmac_keys)
        if set(self.encryption_keys.values()) & set(self.hmac_keys.values()):
            raise ValueError("Credential encryption and request authentication require distinct keys.")
        url = database_url or os.environ["SOURCES_DATABASE_URL"]
        if isinstance(url, str) and url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        self.engine = create_engine(url, pool_pre_ping=True, hide_parameters=True)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)

    @staticmethod
    def audit(session, workspace, actor, action, resource_id, detail=None):
        session.add(AuditEvent(workspace_id=workspace, actor=actor, action=action, resource_id=str(resource_id), detail=detail or {}))

    @staticmethod
    def cleanup_idempotency(session, limit=100):
        if not isinstance(limit, int) or not 1 <= limit <= 1000:
            raise ValueError("Choose a batch size between 1 and 1000.")
        candidates = select(IdempotencyRequest.id).where(expired_requests(now())).order_by(
            IdempotencyRequest.expires_at, IdempotencyRequest.id).limit(limit).with_for_update(skip_locked=True)
        return session.execute(delete(IdempotencyRequest).where(IdempotencyRequest.id.in_(candidates))
                               .execution_options(synchronize_session=False)).rowcount

    def idempotent(self, session, workspace, actor, operation, target, key, payload, perform):
        if not key:
            raise DomainError(400, "idempotency_key_required", "Provide an Idempotency-Key.")
        if not isinstance(key, str) or len(key) > 160 or not all(33 <= ord(c) <= 126 for c in key):
            raise invalid("Use a printable, nonblank idempotency key of up to 160 characters.")
        # The request bytes may contain a secret. Only the keyed digest is stored.
        value = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False).encode()
        scope = dict(workspace_id=workspace, actor=actor, operation=operation, target=str(target or ""), key=key)
        version = next(iter(self.hmac_keys))
        def fingerprint(key_id):
            if key_id not in self.hmac_keys:
                raise DomainError(503, "key_unavailable", "The replay verification key is unavailable.")
            return hmac.digest(self.hmac_keys[key_id], b"source-idempotency-v1\x00" + value, hashlib.sha256)
        while True:
            stamp = now()
            fresh = dict(key_id=version, fingerprint=fingerprint(version), algorithm="hmac-sha256-v1",
                         created_at=stamp, expires_at=stamp + REPLAY_WINDOW)
            rid = session.scalar(insert(IdempotencyRequest).values(**scope, **fresh)
                .on_conflict_do_nothing(constraint="uq_idempotency_scope").returning(IdempotencyRequest.id))
            if rid is not None:
                break
            rec = session.scalar(select(IdempotencyRequest).filter_by(**scope).with_for_update().execution_options(populate_existing=True))
            if rec is None:
                # A collector removed an expired row between the conflict and the lock.
                continue
            if rec.expires_at <= stamp and session.scalar(select(IdempotencyRequest.id).where(
                    IdempotencyRequest.id == rec.id, expired_requests(stamp))):
                rid = rec.id
                session.execute(update(IdempotencyRequest).where(IdempotencyRequest.id == rid)
                                .values(**fresh, response=None, sync_run_id=None, connection_test_id=None))
                break
            if rec.algorithm != "hmac-sha256-v1":
                raise DomainError(503, "fingerprint_unavailable", "The request fingerprint version is unavailable.")
            if not hmac.compare_digest(rec.fingerprint, fingerprint(rec.key_id)):
                raise DomainError(409, "idempotency_conflict", "This key was already used with different input.")
            return rec.response, True
        response = perform()
        link = {}
        if operation == "source.sync":
            link["sync_run_id"] = response["id"]
        elif operation in ("test.draft", "test.saved"):
            link["connection_test_id"] = response["id"]
        session.execute(update(IdempotencyRequest).where(IdempotencyRequest.id == rid)
                        .values(response=response, expires_at=now() + REPLAY_WINDOW, **link))
        return response, False

    @staticmethod
    def get_source(session, workspace, source_id, lock=False):
        try:
            ident = str(UUID(str(source_id)))
        except ValueError:
            raise DomainError(404, "source_not_found", "Source not found.") from None
        query = select(Source).where(Source.workspace_id == workspace, Source.id == ident)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        source = session.scalar(query)
        if not source:
            raise DomainError(404, "source_not_found", "Source not found.")
        return source

    @staticmethod
    def public_source(session, source):
        revision = session.get(ConfigRevision, (source.id, source.current_config_revision))
        return {"id":source.id, "name":source.name, "corpus":source.corpus, "kind":source.kind, "engine":source.engine,
                "enabled":source.enabled, "version":source.version, "current_config_revision":revision.revision,
                "connection":dict(revision.connection), "credential_configured":bool(revision.credential_version_id),
                "preview_columns":{asset:[col["name"] for col in cols] for asset,cols in source.preview_columns.items()},
                "created_at":source.created_at.isoformat(), "updated_at":source.updated_at.isoformat()}

    def _save_password(self, session, source, password):
        ident = new_id()
        key_id = next(iter(self.encryption_keys))
        nonce = os.urandom(12)
        aad = self._credential_context(source, ident)
        ciphertext = AESGCM(self.encryption_keys[key_id]).encrypt(nonce, password.encode(), aad)
        version = CredentialVersion(id=ident, source_id=source.id, key_id=key_id, nonce=nonce, ciphertext=ciphertext)
        session.add(version)
        session.flush([version])
        return ident

    @staticmethod
    def _credential_context(source, ident):
        return json.dumps([source.workspace_id, source.id, ident], separators=(",", ":")).encode()

    def connection(self, session, source, revision=None):
        if not source.enabled:
            raise DomainError(409, "source_disabled", "This source is disabled.")
        if revision is not None and revision != source.current_config_revision:
            raise DomainError(409, "revision_changed", "The source configuration has changed.")
        record = session.get(ConfigRevision, (source.id, source.current_config_revision))
        if not record.credential_version_id:
            raise DomainError(409, "credential_required", "Configure credentials for this source.")
        credential = session.get(CredentialVersion, record.credential_version_id, populate_existing=True)
        if credential.retired_at is not None:
            raise DomainError(409, "revision_changed", "The source credential has been retired.")
        key = self.encryption_keys.get(credential.key_id)
        if key is None:
            raise DomainError(503, "key_unavailable", "The source credential key is unavailable.")
        try:
            password = AESGCM(key).decrypt(credential.nonce, credential.ciphertext, self._credential_context(source, credential.id))
        except InvalidTag:
            raise DomainError(503, "credential_unavailable", "The saved credential could not be verified.") from None
        return dict(record.connection), password.decode()

    def create_source(self, session, workspace, actor, payload, *, can_manage_credentials=False, can_manage_preview=False, required_permissions=None):
        checked_input(payload, True)
        if "credential" in payload:
            require_grant("credentials", can_manage_credentials, required_permissions)
        if "preview_columns" in payload:
            require_grant("preview_columns", can_manage_preview, required_permissions)
        if payload.get("preview_columns"):
            raise invalid("Publish the source catalog before permitting preview columns.")
        config = normalize_connection(payload.get("connection"))
        source = Source(workspace_id=workspace, name=payload["name"].strip(), corpus=payload["corpus"], enabled=payload.get("enabled", True))
        session.add(source)
        flush_source(session)
        action = payload.get("credential", {})
        credential_id = self._save_password(session, source, action["password"]) if action.get("action") == "replace" else None
        session.add(ConfigRevision(source_id=source.id, revision=1, target_generation=1, connection=config,
                                   credential_version_id=credential_id, created_by=actor))
        self.audit(session, workspace, actor, "source.create", source.id, {"version":1})
        session.flush()
        return self.public_source(session, source)

    def update_source(self, session, workspace, actor, source_id, payload, if_match, *, can_manage_credentials=False,
                      can_manage_preview=False, required_permissions=None):
        source = self.get_source(session, workspace, source_id, lock=True)
        if not if_match:
            raise DomainError(428, "precondition_required", "Provide the source ETag in If-Match.")
        if if_match != etag(source.version):
            raise DomainError(412, "precondition_failed", "The source was edited. Reload and try again.")
        checked_input(payload, False)
        previous = session.get(ConfigRevision, (source.id, source.current_config_revision))
        patch = payload.get("connection", {})
        if not isinstance(patch, dict):
            raise invalid("Enter a PostgreSQL connection.")
        config = normalize_connection({**previous.connection, **canonical_fields(patch)})
        moved = any(config[k] != previous.connection[k] for k in ("host", "port", "database"))
        identity_changed = moved or any(config[k] != previous.connection[k] for k in ("username", "tls_profile"))
        if "credential" in payload or (previous.credential_version_id and identity_changed):
            require_grant("credentials", can_manage_credentials, required_permissions)
        if "preview_columns" in payload:
            require_grant("preview_columns", can_manage_preview, required_permissions)
        if moved:
            counts = dict(session.execute(select(DatasetAssetRef.archived, func.count(func.distinct(DatasetAssetRef.dataset_id)))
                .join(Asset, Asset.id == DatasetAssetRef.asset_id)
                .where(Asset.source_id == source.id, DatasetAssetRef.workspace_id == workspace)
                .group_by(DatasetAssetRef.archived)).all())
            if counts:
                raise DomainError(409, "source_in_use", "Linked datasets use this source.", {"active":counts.get(False,0), "archived":counts.get(True,0)})
        action = payload.get("credential", {}).get("action")
        credential_id = previous.credential_version_id
        if identity_changed or action == "clear":
            credential_id = None
        if action == "replace":
            credential_id = self._save_password(session, source, payload["credential"]["password"])
        if previous.credential_version_id and previous.credential_version_id != credential_id:
            session.execute(update(CredentialVersion).where(CredentialVersion.id == previous.credential_version_id)
                            .values(ciphertext=None, nonce=None, retired_at=now()))
        changed = config != previous.connection or credential_id != previous.credential_version_id
        disabling = source.enabled and not payload.get("enabled", True)
        if changed or disabling:
            superseded = session.scalars(update(SyncRun).where(SyncRun.source_id == source.id, SyncRun.status.in_(("queued","running")))
                .values(status="superseded", lease_until=None, finished_at=now()).returning(SyncRun.id)).all()
            if superseded:
                session.execute(delete(StageAsset).where(StageAsset.run_id.in_(superseded)))
            source.catalog_access_blocked = True
        if changed:
            source.current_config_revision += 1
            session.add(ConfigRevision(source_id=source.id, revision=source.current_config_revision,
                target_generation=previous.target_generation + int(moved), connection=config, credential_version_id=credential_id, created_by=actor))
            source.preview_columns = {}
        if "preview_columns" in payload:
            if changed and payload["preview_columns"]:
                raise invalid("Publish the new connection revision before granting preview columns.")
            source.preview_columns = self._preview_signatures(session, source, payload["preview_columns"])
        source.name = payload.get("name", source.name).strip()
        source.corpus = payload.get("corpus", source.corpus)
        source.enabled = payload.get("enabled", source.enabled)
        source.updated_at = now()
        source.version += 1
        self.audit(session, workspace, actor, "source.edit", source.id, {"version":source.version, "fields":sorted(payload)})
        flush_source(session)
        return self.public_source(session, source)

    @staticmethod
    def _preview_signatures(session, source, policy):
        if not policy:
            return {}
        snapshot = session.get(Snapshot, source.published_snapshot_id) if source.published_snapshot_id else None
        if not source.enabled or source.catalog_access_blocked or not snapshot or snapshot.revision != source.current_config_revision:
            raise DomainError(409, "catalog_unavailable", "Publish the current source catalog before granting preview columns.")
        result = {}
        for key, names in policy.items():
            try:
                asset_id = str(UUID(str(key)))
            except ValueError:
                raise invalid("Choose assets from the current catalog.") from None
            member = session.get(SnapshotAsset, (snapshot.id, asset_id))
            if not member or member.kind not in ("table", "partitioned_table", "partition"):
                raise invalid("Choose a table from the current catalog.")
            if not isinstance(names, list) or not names or not all(isinstance(name, str) for name in names) or len(set(names)) != len(names):
                raise invalid("Choose distinct column names for each previewable table.")
            columns = {col["name"]:col for col in member.columns}
            if not set(names) <= columns.keys():
                raise invalid("Choose columns from the current catalog.")
            result[asset_id] = [columns[name] for name in names]
        return result
