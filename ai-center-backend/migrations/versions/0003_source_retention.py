"""Retire historical credentials and link asynchronous requests to their retention clocks."""
from alembic import op

revision = "0003_source_retention"
down_revision = "0002_source_integrity"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""ALTER TABLE source_credential_versions
                  ADD COLUMN retired_at TIMESTAMPTZ, ALTER COLUMN nonce DROP NOT NULL,
                  ALTER COLUMN ciphertext DROP NOT NULL""")
    op.execute("""
        UPDATE source_credential_versions v SET retired_at = CURRENT_TIMESTAMP, ciphertext = NULL, nonce = NULL
        WHERE NOT EXISTS (
            SELECT 1 FROM sources s JOIN source_config_revisions c
                ON c.source_id = s.id AND c.revision = s.current_config_revision
            WHERE v.source_id = s.id AND v.id = c.credential_version_id
        )""")
    op.execute("""ALTER TABLE source_credential_versions ADD CONSTRAINT ck_credential_retirement CHECK (
        (retired_at IS NULL AND ciphertext IS NOT NULL AND nonce IS NOT NULL) OR
        (retired_at IS NOT NULL AND ciphertext IS NULL AND nonce IS NULL))""")
    op.execute("""ALTER TABLE idempotency_requests
        ADD COLUMN sync_run_id UUID REFERENCES source_sync_runs(id),
        ADD COLUMN connection_test_id UUID REFERENCES source_connection_tests(id)""")
    op.execute("""UPDATE idempotency_requests i SET sync_run_id = r.id FROM source_sync_runs r
                  WHERE i.operation = 'source.sync' AND i.workspace_id = r.workspace_id AND i.response->>'id' = r.id::text""")
    op.execute("""UPDATE idempotency_requests i SET connection_test_id = t.id FROM source_connection_tests t
                  WHERE i.operation IN ('test.saved','test.draft') AND i.workspace_id = t.workspace_id AND i.response->>'id' = t.id::text""")
    op.execute("CREATE INDEX ix_idempotency_expiry ON idempotency_requests (expires_at, id)")


def downgrade():
    op.execute("DROP INDEX ix_idempotency_expiry")
    op.execute("ALTER TABLE idempotency_requests DROP COLUMN connection_test_id, DROP COLUMN sync_run_id")
    op.execute("ALTER TABLE source_credential_versions DROP CONSTRAINT ck_credential_retirement")
    # Old revisions retain their IDs. The old schema requires byte arrays even for unusable historical versions.
    op.execute("UPDATE source_credential_versions SET ciphertext = ''::bytea, nonce = ''::bytea WHERE retired_at IS NOT NULL")
    op.execute("""ALTER TABLE source_credential_versions DROP COLUMN retired_at,
                  ALTER COLUMN nonce SET NOT NULL, ALTER COLUMN ciphertext SET NOT NULL""")
