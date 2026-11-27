"""Platform metadata for the PostgreSQL Sources service."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint,
    Index, Integer, LargeBinary, String, UniqueConstraint, Uuid, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, mapped_column


def now():
    return datetime.now(UTC)


def new_id():
    return str(uuid4())


class Base(DeclarativeBase):
    pass


def uuid_column(**kwargs):
    return mapped_column(Uuid(as_uuid=False), **kwargs)


def primary_id():
    return uuid_column(primary_key=True, default=new_id)


def timestamp(**kwargs):
    return mapped_column(DateTime(timezone=True), **kwargs)


def string(size=128, **kwargs):
    return mapped_column(String(size), nullable=False, **kwargs)


class Source(Base):
    __tablename__ = "sources"
    id = primary_id()
    workspace_id = string()
    name = string(200)
    corpus = string(32)
    kind = string(16, default="database")
    engine = string(16, default="postgresql")
    enabled = mapped_column(Boolean, nullable=False, default=True)
    version = mapped_column(Integer, nullable=False, default=1)
    current_config_revision = mapped_column(Integer, nullable=False, default=1)
    published_snapshot_id = uuid_column()
    catalog_access_blocked = mapped_column(Boolean, nullable=False, default=False)
    preview_columns = mapped_column(JSONB, nullable=False, default=dict)
    created_at = timestamp(nullable=False, default=now)
    updated_at = timestamp(nullable=False, default=now)
    __table_args__ = (
        UniqueConstraint("workspace_id", "id", name="uq_source_workspace_id"),
        Index("uq_source_workspace_name", workspace_id, func.lower(func.btrim(name)), unique=True),
        ForeignKeyConstraint(["id", "current_config_revision"], ["source_config_revisions.source_id", "source_config_revisions.revision"],
                             use_alter=True, deferrable=True, initially="DEFERRED", name="fk_source_current_revision"),
        ForeignKeyConstraint(["id", "published_snapshot_id"], ["source_snapshots.source_id", "source_snapshots.id"],
                             use_alter=True, deferrable=True, initially="DEFERRED", name="fk_source_published_snapshot"),
    )


class CredentialVersion(Base):
    __tablename__ = "source_credential_versions"
    id = primary_id()
    source_id = mapped_column(Uuid(as_uuid=False), ForeignKey("sources.id"), nullable=False)
    key_id = string()
    nonce = mapped_column(LargeBinary)
    ciphertext = mapped_column(LargeBinary)
    retired_at = timestamp()
    created_at = timestamp(nullable=False, default=now)
    __table_args__ = (
        UniqueConstraint("source_id", "id", name="uq_source_credential_id"),
        CheckConstraint("(retired_at IS NULL AND ciphertext IS NOT NULL AND nonce IS NOT NULL) OR "
                        "(retired_at IS NOT NULL AND ciphertext IS NULL AND nonce IS NULL)", name="ck_credential_retirement"),
    )


class ConfigRevision(Base):
    __tablename__ = "source_config_revisions"
    source_id = mapped_column(Uuid(as_uuid=False), ForeignKey("sources.id"), primary_key=True)
    revision = mapped_column(Integer, primary_key=True)
    target_generation = mapped_column(Integer, nullable=False)
    connection = mapped_column(JSONB, nullable=False)
    credential_version_id = uuid_column()
    created_by = string()
    created_at = timestamp(nullable=False, default=now)
    __table_args__ = (
        ForeignKeyConstraint(["source_id", "credential_version_id"], ["source_credential_versions.source_id", "source_credential_versions.id"]),
    )


class ConnectionTest(Base):
    __tablename__ = "source_connection_tests"
    id = primary_id()
    workspace_id = string()
    source_id = uuid_column()
    revision = mapped_column(Integer)
    actor = string()
    status = string(24, default="running")
    error_code = mapped_column(String(64))
    elapsed_ms = mapped_column(Integer)
    started_at = timestamp(nullable=False, default=now)
    finished_at = timestamp()
    deadline_at = timestamp(nullable=False)
    __table_args__ = (
        ForeignKeyConstraint(["workspace_id","source_id"], ["sources.workspace_id","sources.id"]),
        ForeignKeyConstraint(["source_id","revision"], ["source_config_revisions.source_id","source_config_revisions.revision"]),
        CheckConstraint("(source_id IS NULL) = (revision IS NULL)", name="ck_test_revision"),
        Index("ix_source_tests_health", "source_id","revision","started_at"),
    )


class SyncRun(Base):
    __tablename__ = "source_sync_runs"
    id = primary_id()
    workspace_id = string()
    source_id = uuid_column(nullable=False)
    revision = mapped_column(Integer, nullable=False)
    actor = string()
    status = string(24, default="queued")
    attempts = mapped_column(Integer, nullable=False, default=0)
    execution_token = mapped_column(Integer, nullable=False, default=0)
    lease_until = timestamp()
    available_at = timestamp(nullable=False, default=now)
    deadline_at = timestamp(nullable=False)
    created_at = timestamp(nullable=False, default=now)
    started_at = timestamp()
    finished_at = timestamp()
    error_code = mapped_column(String(64))
    snapshot_id = uuid_column()
    asset_count = mapped_column(Integer)
    __table_args__ = (
        ForeignKeyConstraint(["workspace_id","source_id"], ["sources.workspace_id","sources.id"]),
        ForeignKeyConstraint(["source_id","revision"], ["source_config_revisions.source_id","source_config_revisions.revision"]),
        UniqueConstraint("source_id","revision","id",name="uq_sync_revision_run"),
        ForeignKeyConstraint(["id","snapshot_id"], ["source_snapshots.run_id","source_snapshots.id"],
                             use_alter=True, deferrable=True, initially="DEFERRED", name="fk_run_snapshot"),
        Index("uq_sync_active", "source_id", "revision", unique=True, postgresql_where=text("status IN ('queued','running')")),
        Index("ix_sync_claim", "status","available_at","lease_until"),
    )


class Snapshot(Base):
    __tablename__ = "source_snapshots"
    id = primary_id()
    source_id = uuid_column(nullable=False)
    revision = mapped_column(Integer, nullable=False)
    run_id = uuid_column(nullable=False, unique=True)
    created_at = timestamp(nullable=False, default=now)
    __table_args__ = (
        ForeignKeyConstraint(["source_id","revision","run_id"], ["source_sync_runs.source_id","source_sync_runs.revision","source_sync_runs.id"]),
        UniqueConstraint("source_id","id",name="uq_snapshot_source"),
        UniqueConstraint("run_id","id",name="uq_snapshot_run_id"),
    )


class Asset(Base):
    __tablename__ = "source_assets"
    id = primary_id()
    source_id = mapped_column(Uuid(as_uuid=False), ForeignKey("sources.id"), nullable=False)
    target_generation = mapped_column(Integer, nullable=False)
    relation_oid = mapped_column(BigInteger, nullable=False)
    schema_name = string(128)
    object_name = string(128)
    kind = string(32)
    first_snapshot_id = uuid_column(nullable=False)
    last_snapshot_id = uuid_column(nullable=False)
    available = mapped_column(Boolean, nullable=False, default=True)
    __table_args__ = (
        ForeignKeyConstraint(["source_id","first_snapshot_id"], ["source_snapshots.source_id","source_snapshots.id"]),
        ForeignKeyConstraint(["source_id","last_snapshot_id"], ["source_snapshots.source_id","source_snapshots.id"]),
        Index("ix_source_asset_identity","source_id","target_generation","schema_name","object_name","available"),
    )


class SnapshotAsset(Base):
    __tablename__ = "source_snapshot_assets"
    snapshot_id = mapped_column(Uuid(as_uuid=False), ForeignKey("source_snapshots.id"), primary_key=True)
    asset_id = mapped_column(Uuid(as_uuid=False), ForeignKey("source_assets.id"), primary_key=True)
    schema_name = string(128)
    object_name = string(128)
    kind = string(32)
    relation_oid = mapped_column(BigInteger, nullable=False)
    columns = mapped_column(JSONB, nullable=False)
    __table_args__ = (
        UniqueConstraint("snapshot_id","schema_name","object_name",name="uq_snapshot_object"),
    )


class StageAsset(Base):
    __tablename__ = "source_stage_assets"
    run_id = mapped_column(Uuid(as_uuid=False), ForeignKey("source_sync_runs.id"), primary_key=True)
    execution_token = mapped_column(Integer, primary_key=True)
    schema_name = string(128, primary_key=True)
    object_name = string(128, primary_key=True)
    kind = string(32)
    relation_oid = mapped_column(BigInteger, nullable=False)
    columns = mapped_column(JSONB, nullable=False)


class DatasetAssetRef(Base):
    __tablename__ = "dataset_asset_refs"
    workspace_id = string(primary_key=True)
    dataset_id = uuid_column(primary_key=True)
    asset_id = mapped_column(Uuid(as_uuid=False), ForeignKey("source_assets.id"), primary_key=True)
    archived = mapped_column(Boolean, nullable=False, default=False)


class IdempotencyRequest(Base):
    __tablename__ = "idempotency_requests"
    id = primary_id()
    workspace_id = string()
    actor = string()
    operation = string(80)
    target = string(128)
    key = string(160)
    key_id = string()
    algorithm = string(32, default="hmac-sha256-v1")
    fingerprint = mapped_column(LargeBinary, nullable=False)
    response = mapped_column(JSONB)
    sync_run_id = mapped_column(Uuid(as_uuid=False), ForeignKey("source_sync_runs.id"))
    connection_test_id = mapped_column(Uuid(as_uuid=False), ForeignKey("source_connection_tests.id"))
    created_at = timestamp(nullable=False, default=now)
    expires_at = timestamp(nullable=False)
    __table_args__ = (
        UniqueConstraint("workspace_id","actor","operation","target","key",name="uq_idempotency_scope"),
        Index("ix_idempotency_expiry", "expires_at", "id"),
    )


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id = primary_id()
    workspace_id = string()
    actor = string()
    action = string(80)
    resource_id = string(128)
    detail = mapped_column(JSONB, nullable=False, default=dict)
    created_at = timestamp(nullable=False, default=now)
