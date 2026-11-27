"""Initial PostgreSQL Sources metadata, including deferred same-source revision and snapshot links."""
from alembic import op

revision = "0001_sources"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
CREATE TABLE sources (
	id UUID NOT NULL,
	workspace_id VARCHAR(128) NOT NULL,
	name VARCHAR(200) NOT NULL,
	corpus VARCHAR(32) NOT NULL,
	kind VARCHAR(16) NOT NULL,
	engine VARCHAR(16) NOT NULL,
	enabled BOOLEAN NOT NULL,
	version INTEGER NOT NULL,
	current_config_revision INTEGER NOT NULL,
	published_snapshot_id UUID,
	catalog_access_blocked BOOLEAN NOT NULL,
	preview_columns JSONB NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_source_workspace_id UNIQUE (workspace_id, id)
)
""")

    op.execute("""
CREATE UNIQUE INDEX uq_source_workspace_name ON sources (workspace_id, lower(btrim(name)))
""")

    op.execute("""
CREATE TABLE idempotency_requests (
	id UUID NOT NULL,
	workspace_id VARCHAR(128) NOT NULL,
	actor VARCHAR(128) NOT NULL,
	operation VARCHAR(80) NOT NULL,
	target VARCHAR(128) NOT NULL,
	key VARCHAR(160) NOT NULL,
	key_id VARCHAR(128) NOT NULL,
	fingerprint BYTEA NOT NULL,
	response JSONB,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_idempotency_scope UNIQUE (workspace_id, actor, operation, target, key)
)
""")

    op.execute("""
CREATE TABLE audit_events (
	id UUID NOT NULL,
	workspace_id VARCHAR(128) NOT NULL,
	actor VARCHAR(128) NOT NULL,
	action VARCHAR(80) NOT NULL,
	resource_id VARCHAR(128) NOT NULL,
	detail JSONB NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id)
)
""")

    op.execute("""
CREATE TABLE source_credential_versions (
	id UUID NOT NULL,
	source_id UUID NOT NULL,
	key_id VARCHAR(128) NOT NULL,
	nonce BYTEA NOT NULL,
	ciphertext BYTEA NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_source_credential_id UNIQUE (source_id, id),
	FOREIGN KEY(source_id) REFERENCES sources (id)
)
""")

    op.execute("""
CREATE TABLE source_config_revisions (
	source_id UUID NOT NULL,
	revision INTEGER NOT NULL,
	target_generation INTEGER NOT NULL,
	connection JSONB NOT NULL,
	credential_version_id UUID,
	created_by VARCHAR(128) NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (source_id, revision),
	FOREIGN KEY(source_id, credential_version_id) REFERENCES source_credential_versions (source_id, id),
	FOREIGN KEY(source_id) REFERENCES sources (id)
)
""")

    op.execute("""
CREATE TABLE source_connection_tests (
	id UUID NOT NULL,
	workspace_id VARCHAR(128) NOT NULL,
	source_id UUID,
	revision INTEGER,
	actor VARCHAR(128) NOT NULL,
	status VARCHAR(24) NOT NULL,
	error_code VARCHAR(64),
	elapsed_ms INTEGER,
	started_at TIMESTAMP WITH TIME ZONE NOT NULL,
	finished_at TIMESTAMP WITH TIME ZONE,
	deadline_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(workspace_id, source_id) REFERENCES sources (workspace_id, id),
	FOREIGN KEY(source_id, revision) REFERENCES source_config_revisions (source_id, revision),
	CONSTRAINT ck_test_revision CHECK ((source_id IS NULL) = (revision IS NULL))
)
""")

    op.execute("""
CREATE INDEX ix_source_tests_health ON source_connection_tests (source_id, revision, started_at)
""")

    op.execute("""
CREATE TABLE source_sync_runs (
	id UUID NOT NULL,
	workspace_id VARCHAR(128) NOT NULL,
	source_id UUID NOT NULL,
	revision INTEGER NOT NULL,
	actor VARCHAR(128) NOT NULL,
	status VARCHAR(24) NOT NULL,
	attempts INTEGER NOT NULL,
	execution_token INTEGER NOT NULL,
	lease_until TIMESTAMP WITH TIME ZONE,
	available_at TIMESTAMP WITH TIME ZONE NOT NULL,
	deadline_at TIMESTAMP WITH TIME ZONE NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	started_at TIMESTAMP WITH TIME ZONE,
	finished_at TIMESTAMP WITH TIME ZONE,
	error_code VARCHAR(64),
	snapshot_id UUID,
	asset_count INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(workspace_id, source_id) REFERENCES sources (workspace_id, id),
	FOREIGN KEY(source_id, revision) REFERENCES source_config_revisions (source_id, revision),
	CONSTRAINT uq_sync_revision_run UNIQUE (source_id, revision, id)
)
""")

    op.execute("""
CREATE UNIQUE INDEX uq_sync_active ON source_sync_runs (source_id, revision) WHERE status IN ('queued','running')
""")

    op.execute("""
CREATE INDEX ix_sync_claim ON source_sync_runs (status, available_at, lease_until)
""")

    op.execute("""
CREATE TABLE source_snapshots (
	id UUID NOT NULL,
	source_id UUID NOT NULL,
	revision INTEGER NOT NULL,
	run_id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(source_id, revision, run_id) REFERENCES source_sync_runs (source_id, revision, id),
	CONSTRAINT uq_snapshot_source UNIQUE (source_id, id),
	CONSTRAINT uq_snapshot_run_id UNIQUE (run_id, id),
	UNIQUE (run_id)
)
""")

    op.execute("""
CREATE TABLE source_stage_assets (
	run_id UUID NOT NULL,
	execution_token INTEGER NOT NULL,
	schema_name VARCHAR(128) NOT NULL,
	object_name VARCHAR(128) NOT NULL,
	kind VARCHAR(32) NOT NULL,
	relation_oid BIGINT NOT NULL,
	columns JSONB NOT NULL,
	PRIMARY KEY (run_id, execution_token, schema_name, object_name),
	FOREIGN KEY(run_id) REFERENCES source_sync_runs (id)
)
""")

    op.execute("""
CREATE TABLE source_assets (
	id UUID NOT NULL,
	source_id UUID NOT NULL,
	target_generation INTEGER NOT NULL,
	relation_oid BIGINT NOT NULL,
	schema_name VARCHAR(128) NOT NULL,
	object_name VARCHAR(128) NOT NULL,
	kind VARCHAR(32) NOT NULL,
	first_snapshot_id UUID NOT NULL,
	last_snapshot_id UUID NOT NULL,
	available BOOLEAN NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(source_id, first_snapshot_id) REFERENCES source_snapshots (source_id, id),
	FOREIGN KEY(source_id, last_snapshot_id) REFERENCES source_snapshots (source_id, id),
	FOREIGN KEY(source_id) REFERENCES sources (id)
)
""")

    op.execute("""
CREATE INDEX ix_source_asset_identity ON source_assets (source_id, target_generation, schema_name, object_name, available)
""")

    op.execute("""
CREATE TABLE source_snapshot_assets (
	snapshot_id UUID NOT NULL,
	asset_id UUID NOT NULL,
	schema_name VARCHAR(128) NOT NULL,
	object_name VARCHAR(128) NOT NULL,
	kind VARCHAR(32) NOT NULL,
	relation_oid BIGINT NOT NULL,
	columns JSONB NOT NULL,
	PRIMARY KEY (snapshot_id, asset_id),
	CONSTRAINT uq_snapshot_object UNIQUE (snapshot_id, schema_name, object_name),
	FOREIGN KEY(snapshot_id) REFERENCES source_snapshots (id),
	FOREIGN KEY(asset_id) REFERENCES source_assets (id)
)
""")

    op.execute("""
CREATE TABLE dataset_asset_refs (
	workspace_id VARCHAR(128) NOT NULL,
	dataset_id UUID NOT NULL,
	asset_id UUID NOT NULL,
	archived BOOLEAN NOT NULL,
	PRIMARY KEY (workspace_id, dataset_id, asset_id),
	FOREIGN KEY(asset_id) REFERENCES source_assets (id)
)
""")

    op.execute("""
ALTER TABLE source_sync_runs ADD CONSTRAINT fk_run_snapshot FOREIGN KEY(id, snapshot_id) REFERENCES source_snapshots (run_id, id) DEFERRABLE INITIALLY DEFERRED
""")

    op.execute("""
ALTER TABLE sources ADD CONSTRAINT fk_source_published_snapshot FOREIGN KEY(id, published_snapshot_id) REFERENCES source_snapshots (source_id, id) DEFERRABLE INITIALLY DEFERRED
""")

    op.execute("""
ALTER TABLE sources ADD CONSTRAINT fk_source_current_revision FOREIGN KEY(id, current_config_revision) REFERENCES source_config_revisions (source_id, revision) DEFERRABLE INITIALLY DEFERRED
""")


def downgrade():
    op.execute("""
ALTER TABLE source_sync_runs DROP CONSTRAINT fk_run_snapshot
""")

    op.execute("""
ALTER TABLE sources DROP CONSTRAINT fk_source_published_snapshot
""")

    op.execute("""
ALTER TABLE sources DROP CONSTRAINT fk_source_current_revision
""")

    op.execute("""
DROP TABLE dataset_asset_refs
""")

    op.execute("""
DROP TABLE source_snapshot_assets
""")

    op.execute("""
DROP TABLE source_assets
""")

    op.execute("""
DROP TABLE source_stage_assets
""")

    op.execute("""
DROP TABLE source_snapshots
""")

    op.execute("""
DROP TABLE source_sync_runs
""")

    op.execute("""
DROP TABLE source_connection_tests
""")

    op.execute("""
DROP TABLE source_config_revisions
""")

    op.execute("""
DROP TABLE source_credential_versions
""")

    op.execute("""
DROP TABLE audit_events
""")

    op.execute("""
DROP TABLE idempotency_requests
""")

    op.execute("""
DROP TABLE sources
""")
