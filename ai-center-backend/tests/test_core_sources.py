"""Integration checks against a migrated, disposable PostgreSQL platform database."""

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from sources.core import Core, DomainError, etag
from sources.models import (
    Asset, AuditEvent, ConfigRevision, ConnectionTest, CredentialVersion, DatasetAssetRef, IdempotencyRequest, Snapshot,
    SnapshotAsset, Source, SyncRun, new_id, now,
)


@pytest.fixture
def fixture():
    url = os.environ.get("SOURCES_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set SOURCES_TEST_DATABASE_URL to a migrated disposable PostgreSQL database.")
    core = Core(url, {"v1":os.urandom(32)}, {"v1":os.urandom(32)})
    yield core, str(uuid4())
    core.engine.dispose()


def create(core, session, workspace, password=None):
    payload = {"name":"Reign register", "corpus":"Real History", "connection":{
        "host":"db.example.test","database":"history","schema":"public","username":"reader"}}
    if password is not None:
        payload["credential"] = {"action":"replace", "password":password}
    return core.create_source(session, workspace, "admin", payload, can_manage_credentials=True)


def test_concurrent_idempotence_replay_and_rollback(fixture):
    core, workspace = fixture
    password = "input-only-" + str(uuid4())
    def create_once(_):
        with core.sessions.begin() as session:
            return core.idempotent(session, workspace, "alice", "create", "", "one-key", {"secret":password},
                                   lambda: create(core, session, workspace, password))
    with ThreadPoolExecutor(max_workers=4) as threads:
        results = list(threads.map(create_once, range(4)))
    assert len({item["id"] for item, _ in results}) == 1
    assert sum(not replay for _, replay in results) == 1
    assert all(password not in str(item) for item, _ in results)
    with core.sessions.begin() as session:
        record = session.scalars(select(IdempotencyRequest).filter_by(workspace_id=workspace)).one()
        assert password not in str(record.response) and record.fingerprint != password.encode()
        source = core.get_source(session, workspace, results[0][0]["id"])
        cfg, recovered = core.connection(session, source)
        assert recovered == password and "password" not in cfg
        row = session.scalars(select(CredentialVersion).filter_by(source_id=source.id)).one()
        assert password.encode() not in row.ciphertext
    core.hmac_keys = {"new":os.urandom(32), **core.hmac_keys}
    assert create_once(0)[1]
    with pytest.raises(DomainError, match="different input"), core.sessions.begin() as session:
        core.idempotent(session, workspace,"alice","create","","one-key",{},lambda: {})
    with pytest.raises(RuntimeError), core.sessions.begin() as session:
        def fail():
            core.audit(session, workspace, "alice", "attempt", "sample")
            raise RuntimeError("fixture")
        core.idempotent(session, workspace,"alice","failing","","retryable",{},fail)
    with core.sessions.begin() as session:
        assert core.idempotent(session, workspace,"alice","failing","","retryable",{},lambda: {"done":True}) == ({"done":True}, False)


def test_rotation_supersedes_config_and_prevents_secret_transfer(fixture):
    core, workspace = fixture
    with core.sessions.begin() as session:
        ident = create(core, session, workspace, "old-value")["id"]
        run = SyncRun(workspace_id=workspace, source_id=ident, revision=1, actor="admin", deadline_at=now()+timedelta(minutes=2))
        session.add(run)
        session.flush()
        run_id = run.id
    def patch(payload, version, **kwargs):
        with core.sessions.begin() as session:
            return core.update_source(session, workspace, "operator", ident, payload, etag(version), **kwargs)
    assert patch({"name":"New display"},1)["current_config_revision"] == 1
    with pytest.raises(DomainError) as stale:
        patch({"name":"Old display"},1)
    assert stale.value.status == 412
    with pytest.raises(DomainError) as forbidden:
        patch({"connection":{"host":"next.example.test"}},2)
    assert forbidden.value.status == 403
    required = set()
    edited = patch({"connection":{"host":"next.example.test"}},2, can_manage_credentials=True, required_permissions=required)
    assert required == {"credentials"} and not edited["credential_configured"] and edited["current_config_revision"] == 2
    with core.sessions.begin() as s:
        assert s.get(SyncRun,run_id).status == "superseded"
        assert s.get(ConfigRevision,(ident,2)).target_generation == 2
        with pytest.raises(DomainError) as missing:
            core.connection(s, core.get_source(s,workspace,ident))
        assert missing.value.code == "credential_required"
        with pytest.raises(DomainError) as wrong_workspace:
            core.get_source(s, "other", ident)
        assert wrong_workspace.value.status == 404
    new = patch({"credential":{"action":"replace","password":"rotated"}},3, can_manage_credentials=True)
    assert new["credential_configured"] and new["current_config_revision"] == 3


def test_snapshot_column_grants_and_dataset_identity(fixture):
    core, workspace = fixture
    with core.sessions.begin() as s:
        source_id = create(core, s, workspace)["id"]
        run = SyncRun(workspace_id=workspace, source_id=source_id, revision=1, actor="admin", status="succeeded", deadline_at=now())
        s.add(run)
        s.flush()
        snap = Snapshot(source_id=source_id, revision=1, run_id=run.id)
        s.add(snap)
        s.flush()
        obj = Asset(source_id=source_id, target_generation=1, relation_oid=3344, schema_name="public", object_name="reigns",
                    kind="table", first_snapshot_id=snap.id, last_snapshot_id=snap.id)
        s.add(obj)
        s.flush()
        aid = obj.id
        signature = {"name":"ruler","ordinal":3,"type":"text","type_oid":25,"typmod":-1,"nullable":True}
        s.add(SnapshotAsset(snapshot_id=snap.id, asset_id=aid, schema_name="public", object_name="reigns",
                            kind="table", relation_oid=3344, columns=[signature]))
        src = core.get_source(s, workspace, source_id)
        src.published_snapshot_id = snap.id
        run.snapshot_id = snap.id
        s.add(DatasetAssetRef(workspace_id=workspace, dataset_id=new_id(), asset_id=aid, archived=True))
    with pytest.raises(DomainError) as forbidden, core.sessions.begin() as s:
        core.update_source(s,workspace,"reader",source_id,{"preview_columns":{aid:["ruler"]}},etag(1))
    assert forbidden.value.status == 403
    with core.sessions.begin() as s:
        updated = core.update_source(s,workspace,"admin",source_id,{"preview_columns":{aid:["ruler"]}},etag(1),can_manage_preview=True)
        assert updated["preview_columns"] == {aid:["ruler"]}
        assert core.get_source(s,workspace,source_id).preview_columns == {aid:[signature]}
    with pytest.raises(DomainError) as moved, core.sessions.begin() as s:
        core.update_source(s,workspace,"admin",source_id,{"connection":{"database":"other"}},etag(2))
    assert moved.value.detail == {"active":0,"archived":1}
    with pytest.raises(IntegrityError), core.sessions.begin() as s:
        s.add(DatasetAssetRef(workspace_id="unrelated", dataset_id=new_id(), asset_id=aid, archived=False))
        s.flush()
    with core.sessions.begin() as s:
        next_revision = core.update_source(s,workspace,"admin",source_id,{"connection":{"schemas":["archive","public"]}},etag(2))
        assert next_revision["preview_columns"] == {}
        assert s.scalar(select(func.count()).select_from(Source).filter_by(workspace_id=workspace)) == 1


def test_secret_retirement_is_atomic_and_keeps_revision_ids(fixture):
    core, workspace = fixture
    with core.sessions.begin() as s:
        ident = create(core, s, workspace, "first-test-value")["id"]
        original_id = s.get(ConfigRevision, (ident, 1)).credential_version_id
        core.update_source(s, workspace, "admin", ident, {"connection":{"schemas":["archive"]}}, etag(1))
        assert s.get(ConfigRevision, (ident, 2)).credential_version_id == original_id

    def replace(s):
        core.update_source(s, workspace, "admin", ident, {"credential":{"action":"replace", "password":"second-test-value"}},
                           etag(2), can_manage_credentials=True)
    with pytest.raises(RuntimeError), core.sessions.begin() as s:
        replace(s)
        assert s.get(CredentialVersion, original_id).ciphertext is None
        raise RuntimeError("abort after retiring and replacing")
    with core.sessions.begin() as s:
        assert core.connection(s, core.get_source(s, workspace, ident))[1] == "first-test-value"
        assert s.get(CredentialVersion, original_id).retired_at is None
        replace(s)
    with core.sessions.begin() as s:
        previous = s.get(CredentialVersion, original_id)
        assert previous.retired_at and previous.nonce is None and previous.ciphertext is None
        assert s.get(ConfigRevision, (ident, 2)).credential_version_id == original_id
        assert core.connection(s, core.get_source(s, workspace, ident))[1] == "second-test-value"
        second_id = s.get(ConfigRevision, (ident, 3)).credential_version_id
        core.update_source(s, workspace, "admin", ident, {"connection":{"host":"new.example.test"}},
                           etag(3), can_manage_credentials=True)
        assert s.get(ConfigRevision, (ident,4)).credential_version_id is None
        assert s.get(CredentialVersion, second_id).ciphertext is None
    with core.sessions.begin() as s:
        core.update_source(s,workspace,"admin",ident,{"credential":{"action":"replace","password":"third-test-value"}},
                           etag(4),can_manage_credentials=True)
        third_id = s.get(ConfigRevision, (ident,5)).credential_version_id
        core.update_source(s,workspace,"admin",ident,{"credential":{"action":"clear"}},etag(5),can_manage_credentials=True)
        assert s.get(CredentialVersion, third_id).ciphertext is None


def test_expired_key_concurrent_reuse_and_gc_runs_one_effect(fixture):
    core, workspace = fixture
    def call(payload):
        with core.sessions.begin() as s:
            def perform():
                ident = new_id()
                core.audit(s, workspace, "admin", "effect", ident)
                return {"id":ident}
            return core.idempotent(s,workspace,"admin","effect","target","one-key",payload,perform)
    original, _ = call({"phase":1})
    with core.sessions.begin() as s:
        s.execute(update(IdempotencyRequest).where(IdempotencyRequest.workspace_id == workspace)
                  .values(expires_at=now() - timedelta(days=4)))
    def cleanup():
        with core.sessions.begin() as s:
            return core.cleanup_idempotency(s, 1)
    with ThreadPoolExecutor(max_workers=5) as pool:
        callers = [pool.submit(call, {"phase":2}) for _ in range(4)]
        collector = pool.submit(cleanup)
        responses = [f.result() for f in callers]
        assert collector.result() <= 1
    ids = {r["id"] for r,_ in responses}
    assert len(ids) == 1 and original["id"] not in ids
    assert sum(not replay for _,replay in responses) == 1
    with core.sessions.begin() as s:
        assert s.scalar(select(func.count()).select_from(AuditEvent).filter_by(workspace_id=workspace, action="effect")) == 2


@pytest.mark.parametrize("operation", ["source.sync","test.saved","test.draft"])
def test_gc_preserves_active_and_recently_completed_operations(fixture, operation):
    core, workspace = fixture
    stamp = now()
    with core.sessions.begin() as s:
        ident = create(core,s,workspace)["id"]
        def perform():
            settings = dict(workspace_id=workspace, actor="admin", source_id=ident, revision=1, deadline_at=stamp+timedelta(hours=1))
            if operation == "source.sync":
                record = SyncRun(**settings, status="running")
            else:
                if operation == "test.draft":
                    settings.update(source_id=None,revision=None)
                record = ConnectionTest(**settings, status="running")
            s.add(record)
            s.flush()
            return {"id":record.id}
        response, _ = core.idempotent(s,workspace,"admin",operation,"target","key",{},perform)
        s.execute(update(IdempotencyRequest).where(IdempotencyRequest.workspace_id == workspace).values(expires_at=stamp-timedelta(days=4)))
    with core.sessions.begin() as s:
        core.cleanup_idempotency(s)
        result,replay = core.idempotent(s,workspace,"admin",operation,"target","key",{},lambda: pytest.fail("Active request repeated"))
        assert replay and result == response
        model = SyncRun if operation == "source.sync" else ConnectionTest
        running = s.get(model,response["id"])
        running.status, running.finished_at = "succeeded", stamp-timedelta(hours=23)
    with core.sessions.begin() as s:
        core.cleanup_idempotency(s)
        assert s.scalar(select(IdempotencyRequest.id).filter_by(workspace_id=workspace))
        s.get(model,response["id"]).finished_at = stamp-timedelta(hours=25)
    with core.sessions.begin() as s:
        assert core.cleanup_idempotency(s) >= 1
        assert not s.scalar(select(IdempotencyRequest.id).filter_by(workspace_id=workspace))
