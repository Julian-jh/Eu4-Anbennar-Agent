"""Identify stored fingerprints and enforce source ownership for derived metadata."""
from alembic import op

revision = "0002_source_integrity"
down_revision = "0001_sources"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE idempotency_requests ADD COLUMN algorithm VARCHAR(32) NOT NULL DEFAULT 'hmac-sha256-v1'")
    op.execute("ALTER TABLE idempotency_requests ALTER COLUMN algorithm DROP DEFAULT")
    op.execute("""
        CREATE FUNCTION validate_snapshot_asset_owner() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM source_assets a JOIN source_snapshots s ON s.source_id = a.source_id
                WHERE a.id = NEW.asset_id AND s.id = NEW.snapshot_id
            ) THEN
                RAISE EXCEPTION 'Snapshot and asset must belong to the same source' USING ERRCODE = '23503';
            END IF;
            RETURN NEW;
        END $$""")
    op.execute("""
        CREATE TRIGGER snapshot_asset_owner BEFORE INSERT OR UPDATE OF snapshot_id, asset_id ON source_snapshot_assets
        FOR EACH ROW EXECUTE FUNCTION validate_snapshot_asset_owner()""")
    op.execute("""
        CREATE FUNCTION validate_dataset_asset_owner() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            -- Serialize creating lineage with editing the referenced source's target.
            PERFORM 1 FROM source_assets a
                JOIN sources s ON s.id = a.source_id
                JOIN source_config_revisions c ON c.source_id = s.id AND c.revision = s.current_config_revision
                WHERE a.id = NEW.asset_id AND s.workspace_id = NEW.workspace_id
                    AND a.target_generation = c.target_generation AND a.available
                FOR UPDATE OF s;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Dataset requires an available asset in the same workspace and target generation'
                    USING ERRCODE = '23503';
            END IF;
            RETURN NEW;
        END $$""")
    op.execute("""
        CREATE TRIGGER dataset_asset_owner BEFORE INSERT OR UPDATE OF workspace_id, asset_id ON dataset_asset_refs
        FOR EACH ROW EXECUTE FUNCTION validate_dataset_asset_owner()""")


def downgrade():
    op.execute("DROP TRIGGER dataset_asset_owner ON dataset_asset_refs")
    op.execute("DROP FUNCTION validate_dataset_asset_owner()")
    op.execute("DROP TRIGGER snapshot_asset_owner ON source_snapshot_assets")
    op.execute("DROP FUNCTION validate_snapshot_asset_owner()")
    op.execute("ALTER TABLE idempotency_requests DROP COLUMN algorithm")
