"""Run against a disposable PostgreSQL platform database via SOURCES_TEST_DATABASE_URL."""
import base64
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.schema import CreateSchema, DropSchema

from sources import connection_tests, connector, worker as worker_module
from sources.catalog import Catalog, LeaseLost, now
from sources.core import Core, DomainError, etag
from sources.models import Asset, Base, ConnectionTest, IdempotencyRequest, Snapshot, StageAsset, SyncRun
from sources.worker import Worker


@pytest.fixture
def platform(monkeypatch):
    url = os.getenv("SOURCES_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set SOURCES_TEST_DATABASE_URL to run the PostgreSQL catalog tests.")
    encryption, signature = os.urandom(32), os.urandom(32)
    monkeypatch.setenv("SOURCES_HMAC_KEYS", json.dumps({"test": base64.urlsafe_b64encode(signature).decode()}))
    core = Core(url, {"test": encryption}, {"test": signature})
    schema = "catalog_test_" + uuid4().hex
    with core.engine.begin() as connection:
        connection.execute(CreateSchema(schema))
    core.engine.update_execution_options(schema_translate_map={None: schema})
    try:
        Base.metadata.create_all(core.engine)
        yield core
    finally:
        with core.engine.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True))
        core.engine.dispose()


def source(core, connection=None, password="sample-password"):
    connection = connection or {"host": "localhost", "database": "sample", "username": "reader"}
    with core.sessions.begin() as s:
        return core.create_source(s, "workspace", "actor", {"name": "Catalog fixture", "corpus": "EU4",
                                  "connection": connection, "credential": {"action": "replace", "password": password}},
                                  can_manage_credentials=True)["id"]


def enqueue(catalog, source_id):
    with catalog.core.sessions.begin() as s:
        return catalog.enqueue(s, "workspace", source_id, "actor")["id"]


def relation(name, oid):
    return {"schema": "public", "name": name, "kind": "table", "oid": oid,
            "columns": [{"name": "title", "ordinal": 1, "type": "text", "type_oid": 25, "nullable": True, "typmod": -1}]}


def page(catalog, source_id, **params):
    with catalog.core.sessions.begin() as s:
        return catalog.list_assets(s, "workspace", source_id, **params)


def patch(core, source_id, changes):
    with core.sessions.begin() as s:
        original = core.get_source(s, "workspace", source_id)
        return core.update_source(s, "workspace", "actor", source_id, changes, etag(original.version),
                                  can_manage_credentials=True, can_manage_preview=True)


def test_fencing_atomic_publish_cursors_and_identity(platform, monkeypatch):
    catalog, worker = Catalog(platform), Worker(platform)
    src = source(platform)
    with ThreadPoolExecutor(2) as pool:
        first, second = pool.map(lambda _: enqueue(catalog, src), range(2))
    assert first == second
    stale = worker.claim()
    worker.stage(stale, [relation("partial", 1)])
    with pytest.raises(DomainError, match="no published"):
        page(catalog, src)
    with platform.sessions.begin() as s:
        s.get(SyncRun, first).lease_until = now() - timedelta(seconds=1)
    claim = worker.claim()
    assert claim.token > stale.token
    with pytest.raises(LeaseLost):
        worker.publish(stale, 1)
    objects = [relation("b", 2), relation("a", 1)]
    worker.stage(claim, objects)
    with pytest.raises(ValueError):
        worker.publish(claim, 3)
    with platform.sessions.begin() as s:
        assert s.scalar(select(func.count()).select_from(Snapshot)) == 0
    first_snap = worker.publish(claim, 2)
    with pytest.raises(LeaseLost):
        worker.fail(stale, "access_denied")
    first_page = page(catalog, src, limit=1)
    assert first_page["snapshot_id"] == first_snap and first_page["items"][0]["name"] == "a"
    assert "columns" not in first_page["items"][0]
    a_id = first_page["items"][0]["id"]
    second_page = page(catalog, src, limit=1, cursor=first_page["next_cursor"])
    assert second_page["items"][0]["name"] == "b" and second_page["next_cursor"] is None
    with pytest.raises(DomainError) as mismatch:
        page(catalog, src, name="different", cursor=first_page["next_cursor"])
    assert mismatch.value.code == "invalid_cursor"
    monkeypatch.setattr(connector, "discover", lambda *_: [relation("a", 1)])
    enqueue(catalog, src)
    assert worker.run_once()
    assert page(catalog, src)["items"][0]["id"] == a_id
    with pytest.raises(DomainError) as stale_page:
        page(catalog, src, cursor=first_page["next_cursor"])
    assert stale_page.value.code == "catalog_changed"
    monkeypatch.setattr(connector, "discover", lambda *_: objects)
    enqueue(catalog, src)
    worker.run_once()
    assert page(catalog, src)["items"][1]["id"] != second_page["items"][0]["id"]
    with platform.sessions.begin() as s:
        assert s.scalar(select(func.count()).select_from(StageAsset)) == 0
        assert s.scalar(select(func.count()).select_from(Asset).where(~Asset.available)) == 1
        assert catalog.get_run(s, "workspace", first)["attempts"] == 2
        with pytest.raises(DomainError) as other:
            catalog.get_run(s, "elsewhere", first)
        assert other.value.status == 404


def test_failure_revoke_and_revalidate_preview(platform, monkeypatch):
    catalog, worker = Catalog(platform), Worker(platform)
    src = source(platform)
    objects = [relation("reigns", 11)]
    monkeypatch.setattr(connector, "discover", lambda *_: objects)
    enqueue(catalog, src)
    worker.run_once()
    current = page(catalog, src)
    asset = current["items"][0]["id"]
    run = enqueue(catalog, src)
    claim = worker.claim()
    worker.fail(claim, "unavailable")
    assert page(catalog, src)["snapshot_id"] == current["snapshot_id"]
    with platform.sessions.begin() as s:
        row = s.get(SyncRun, run)
        assert row.status == "queued" and row.attempts == 1
        row.available_at = now()
    claim = worker.claim()
    worker.fail(claim, "access_denied")
    with pytest.raises(DomainError) as blocked:
        page(catalog, src)
    assert blocked.value.code == "catalog_access_blocked"
    enqueue(catalog, src)
    worker.run_once()
    assert page(catalog, src)["items"][0]["id"] == asset
    def source_denied(*args):
        raise connector.ConnectorError("access_denied")
    monkeypatch.setattr(connector, "preview", source_denied)
    with pytest.raises(DomainError) as remote_denial:
        catalog.preview("workspace", src, asset, mode="masked")
    assert remote_denial.value.code == "access_denied"
    with pytest.raises(DomainError) as blocked_preview:
        page(catalog, src)
    assert blocked_preview.value.code == "catalog_access_blocked"
    enqueue(catalog, src)
    worker.run_once()
    with pytest.raises(DomainError) as no_columns:
        catalog.preview("workspace", src, asset, mode="raw")
    assert no_columns.value.status == 403
    patch(platform, src, {"preview_columns": {asset: ["title"]}})
    def revoke_during_sample(config, password, member, mode, clear, limit):
        assert clear == {"title"} and member["oid"] == 11 and mode == "raw" and limit == 15
        patch(platform, src, {"preview_columns": {}})
        return {"columns": ["title"], "rows": [{"title": "must never reach client"}], "truncated": False}
    monkeypatch.setattr(connector, "preview", revoke_during_sample)
    with pytest.raises(DomainError) as changed:
        catalog.preview("workspace", src, asset, mode="raw")
    assert changed.value.status == 403
    enqueue(catalog, src)
    claim = worker.claim()
    with platform.sessions.begin() as s:
        catalog.block_access(s, platform.get_source(s, "workspace", src, lock=True))
    with pytest.raises(LeaseLost):
        worker.publish(claim, 0)
    enqueue(catalog, src)
    worker.run_once()
    patch(platform, src, {"enabled": False})
    with pytest.raises(DomainError) as disabled:
        page(catalog, src)
    assert disabled.value.code == "source_disabled"
    patch(platform, src, {"enabled": True, "connection": {"database": "other"},
                          "credential": {"action": "replace", "password": "replacement"}})
    with pytest.raises(DomainError):
        page(catalog, src)
    enqueue(catalog, src)
    worker.run_once()
    assert page(catalog, src)["items"][0]["id"] != asset


def test_republished_column_cannot_reactivate_old_cleartext_grant(platform, monkeypatch):
    catalog, worker = Catalog(platform), Worker(platform)
    src = source(platform)
    item = relation("reigns", 23)
    monkeypatch.setattr(connector, "discover", lambda *_: [item])
    enqueue(catalog, src)
    worker.run_once()
    asset = page(catalog, src)["items"][0]["id"]
    permitted = patch(platform, src, {"preview_columns": {asset: ["title"]}})
    original = item["columns"][0].copy()
    item["columns"][0]["type"] = "integer"
    item["columns"][0]["type_oid"] = 23
    enqueue(catalog, src)
    worker.run_once()
    with platform.sessions.begin() as s:
        current = platform.get_source(s, "workspace", src)
        assert current.preview_columns == {} and current.version == permitted["version"] + 1
    item["columns"] = [original]
    enqueue(catalog, src)
    worker.run_once()
    assert page(catalog, src)["items"][0]["id"] == asset
    with pytest.raises(DomainError) as denial:
        catalog.preview("workspace", src, asset, mode="raw")
    assert denial.value.code == "preview_columns_denied"


def test_worker_expires_abandoned_probes_and_throttles_idle_maintenance(platform, monkeypatch):
    src = source(platform)
    with platform.sessions.begin() as session:
        expired = now() - timedelta(minutes=5)
        probe = ConnectionTest(workspace_id="workspace", source_id=src, revision=1, actor="actor",
                               started_at=expired, deadline_at=expired, status="running")
        session.add(probe)
        platform.idempotent(session, "workspace", "actor", "fixture", src, "old-key", {}, lambda: {"ok": True})
        session.scalar(select(IdempotencyRequest)).expires_at = expired
    calls = []
    elapsed = 0
    class StopLoop(Exception):
        pass
    def advance(_):
        nonlocal elapsed
        if elapsed >= 60:
            raise StopLoop
        elapsed += 10
    expire, clean = connection_tests.expire_probes, platform.cleanup_idempotency
    def counted_expire(core):
        calls.append(("expire", elapsed))
        return expire(core)
    def counted_clean(session, *, limit):
        assert limit == 100
        calls.append(("cleanup", elapsed))
        return clean(session, limit=limit)
    monkeypatch.setattr(connection_tests, "expire_probes", counted_expire)
    monkeypatch.setattr(platform, "cleanup_idempotency", counted_clean)
    monkeypatch.setattr(worker_module, "Core", lambda: platform)
    monkeypatch.setattr(worker_module, "time", SimpleNamespace(monotonic=lambda: elapsed, sleep=advance))
    worker_module.main(["--once"])
    assert calls == [("expire", 0), ("cleanup", 0)]
    with platform.sessions.begin() as session:
        assert Catalog(platform).health(session, "workspace", src)["latest_test"]["status"] == "interrupted"
        assert session.scalar(select(func.count()).select_from(IdempotencyRequest)) == 0
    calls.clear()
    with pytest.raises(StopLoop):
        worker_module.main([])
    assert calls == [("expire", 0), ("cleanup", 0), ("expire", 60), ("cleanup", 60)]
