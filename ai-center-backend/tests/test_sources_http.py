"""Exercise the public API against two fresh databases on a disposable PostgreSQL server."""

import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
from threading import Event, Thread
import time
from uuid import uuid4

import psycopg
from psycopg import sql
import pytest
import httpx
import uvicorn
from alembic import command
from alembic.config import Config
from sqlalchemy import select
from sqlalchemy.engine import URL

from sources.access import CAPABILITIES
from sources.api import create_app
from sources import connector
from sources.connection_tests import expire_probes
from sources.core import Core
from sources.models import AuditEvent, ConnectionTest, CredentialVersion, IdempotencyRequest
from sources.worker import Worker


@pytest.fixture
def workspace(monkeypatch):
    admin_dsn = os.getenv("SOURCES_TEST_ADMIN_DSN")
    if not admin_dsn:
        pytest.skip("Set SOURCES_TEST_ADMIN_DSN to a disposable PostgreSQL server.")
    suffix = uuid4().hex[:12]
    meta, target, reader = ("eu4_" + s + suffix for s in ("platform_", "history_", "reader_"))
    password = secrets.token_urlsafe(24)
    admin = psycopg.connect(admin_dsn, autocommit=True)
    params = psycopg.conninfo.conninfo_to_dict(admin_dsn)
    platform = URL.create("postgresql+psycopg", username=params["user"], password=params["password"],
                          host=params["host"], port=int(params.get("port", 5432)), database=meta)
    target_db = None
    core = None
    try:
        for name in (meta, target):
            admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        admin.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(sql.Identifier(reader), sql.Literal(password)))
        target_db = psycopg.connect(admin_dsn, dbname=target, autocommit=True)
        target_db.execute("CREATE TABLE reigns (country text, private_note text)")
        target_db.execute("INSERT INTO reigns SELECT 'France', 'private-fixture-value' FROM generate_series(1,55)")
        target_db.execute("CREATE VIEW by_country AS SELECT country FROM reigns")
        target_db.execute(sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA public TO {}").format(sql.Identifier(reader)))
        monkeypatch.setenv("SOURCES_DATABASE_URL", platform.render_as_string(hide_password=False))
        for name in ("SOURCES_ENCRYPTION_KEYS", "SOURCES_HMAC_KEYS"):
            monkeypatch.setenv(name, json.dumps({"test": base64.urlsafe_b64encode(os.urandom(32)).decode()}))
        monkeypatch.setenv("SOURCES_ALLOW_INSECURE_LOOPBACK", "1")
        monkeypatch.setenv("SOURCES_ALLOWED_PORTS", str(platform.port))
        tokens, actors = {}, []
        for role, grants in {"admin": CAPABILITIES, "catalog": ["catalog"], "fields": ["fields"],
                             "masked": ["preview_masked"], "raw": ["preview_raw"],
                             "other": CAPABILITIES}.items():
            tokens[role] = secrets.token_urlsafe(32)
            actors.append(dict(id=role, workspace="elsewhere" if role == "other" else "atlas", grants=grants,
                               sha256=hashlib.sha256(tokens[role].encode()).hexdigest(), expires_at="2099-01-01T00:00:00Z"))
        monkeypatch.delenv("SOURCES_ACTORS_FILE", raising=False)
        monkeypatch.setenv("SOURCES_ACTORS", json.dumps(actors))
        config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
        command.upgrade(config, "head")
        core = Core()
        connection = dict(host=platform.host, port=platform.port, database=target, schemas=["public"],
                          username=reader, tls_profile="local-development")
        server = uvicorn.Server(uvicorn.Config(create_app(core), log_level="error", access_log=False))
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
            thread = Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
            thread.start()
            try:
                deadline = time.monotonic() + 5
                while not server.started and thread.is_alive() and time.monotonic() < deadline:
                    time.sleep(0.02)
                assert server.started
                with httpx.Client(base_url=f"http://127.0.0.1:{port}", trust_env=False, timeout=10) as client:
                    assert client.get("/openapi.json").json()["paths"]["/api/v1/sources"]

                    def api(method, path, role="admin", key=None, tag=None, **kwargs):
                        headers = {"Authorization": "Bearer " + tokens[role]} if role else {}
                        if key:
                            headers["Idempotency-Key"] = key
                        if tag:
                            headers["If-Match"] = tag
                        return client.request(method, "/api/v1" + path, headers=headers, **kwargs)
                    yield api, core, connection, password, target_db
            finally:
                server.should_exit = True
                thread.join(timeout=5)
    finally:
        if core:
            core.engine.dispose()
        if target_db:
            target_db.close()
        try:
            for name in (meta, target):
                admin.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(name)))
            admin.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(reader)))
        finally:
            admin.close()


def test_confirmed_workflow_and_tiers(workspace, monkeypatch):
    api, core, connection, password, remote = workspace
    draft = {"connection": connection, "password": password}
    assert api("GET", "/sources", role=None).status_code == 401
    tested = api("POST", "/source-connection-tests", key="test", json=draft)
    assert tested.status_code == 200, tested.text
    assert tested.json()["status"] == "succeeded"
    assert api("POST", "/source-connection-tests", key="test", json=draft).json() == tested.json()
    assert api("GET", "/sources").json()["items"] == []
    payload = {"name": "Reign register", "corpus": "Real History", "connection": connection}
    assert api("POST", "/sources", json=payload).status_code == 400
    with ThreadPoolExecutor(max_workers=2) as pool:
        creates = list(pool.map(lambda _: api("POST", "/sources", key="create", json=payload), range(2)))
    assert [r.status_code for r in creates] == [201, 201]
    assert creates[0].json() == creates[1].json()
    source = "/sources/" + creates[0].json()["id"]
    assert api("GET", source, role="other").status_code == 404
    assert api("POST", source + "/sync-runs", key="missing").json()["code"] == "credential_required"
    assert api("POST", "/sources", key="create", json={**payload, "name":"New name"}).status_code == 409
    credentials = {"credential":{"action":"replace","password":password}}
    saved = api("PATCH", source, key="save", tag=creates[0].headers["etag"], json=credentials)
    assert saved.status_code == 200, saved.text
    assert api("PATCH", source, key="save", tag=creates[0].headers["etag"], json=credentials).json() == saved.json()
    assert api("PATCH", source, key="stale", tag=creates[0].headers["etag"], json=credentials).status_code == 412
    assert api("PATCH", source, key="no-tag", json={"name":"New"}).status_code == 428
    job = api("POST", source + "/sync-runs", key="queue")
    assert job.status_code == 202, job.text
    assert api("POST", source + "/sync-runs", key="another").json()["id"] == job.json()["id"]
    assert Worker(core).run_once()
    assert api("GET", source + "/health").json()["catalog_status"] == "available"
    assert api("GET", "/source-sync-runs/" + job.json()["id"]).json()["status"] == "succeeded"
    assets = api("GET", source + "/assets", role="catalog").json()["items"]
    assert len(assets) == 2 and all("columns" not in asset for asset in assets)
    asset_id = next(asset["id"] for asset in assets if asset["name"] == "reigns")
    view_id = next(asset["id"] for asset in assets if asset["name"] == "by_country")
    table = source + "/assets/" + asset_id
    assert api("GET", table, role="catalog").status_code == 403
    assert len(api("GET", table, role="fields").json()["columns"]) == 2
    assert api("GET", table + "/preview", role="fields").status_code == 403
    masked = api("GET", table + "/preview", role="masked")
    assert masked.status_code == 200, masked.text
    assert len(masked.json()["rows"]) == 15 and masked.json()["truncated"]
    assert masked.headers["Cache-Control"] == "no-store"
    assert "France" not in masked.text and "private-fixture-value" not in masked.text
    assert api("GET", table + "/preview?mode=raw", role="masked").status_code == 403
    assert api("GET", table + "/preview?mode=raw", role="raw").status_code == 403
    allowed = api("PATCH", source, key="policy", tag=saved.headers["etag"], json={"preview_columns":{asset_id:["country"]}})
    assert allowed.status_code == 200, allowed.text
    raw = api("GET", table + "/preview?mode=raw&limit=1", role="raw")
    assert raw.status_code == 200 and raw.json()["rows"][0]["country"] == "France", raw.text
    assert "private-fixture-value" not in raw.text
    assert "France" not in api("GET", table + "/preview", role="raw").text
    with monkeypatch.context() as during:
        read_rows = connector.preview

        def revoke_while_reading(*args):
            rows = read_rows(*args)
            actors = json.loads(os.environ["SOURCES_ACTORS"])
            next(entry for entry in actors if entry["id"] == "raw")["grants"] = ["fields"]
            during.setenv("SOURCES_ACTORS", json.dumps(actors))
            return rows

        during.setattr(connector, "preview", revoke_while_reading)
        revoked = api("GET", table + "/preview?mode=raw", role="raw")
        assert revoked.status_code == 403 and "France" not in revoked.text
    assert api("GET", table + "/preview?limit=51").status_code == 422
    assert api("GET", source + "/assets/" + view_id + "/preview").status_code in (403, 409)

    remote.execute("REVOKE USAGE ON SCHEMA public FROM PUBLIC")
    denied = api("POST", source + "/connection-tests", key="revoked")
    assert denied.json()["status"] == "failed", denied.text
    assert api("GET", source + "/assets").status_code == 409
    remote.execute("GRANT USAGE ON SCHEMA public TO PUBLIC")
    assert api("POST", source + "/connection-tests", key="restored").json()["status"] == "succeeded"
    assert api("GET", source + "/assets").status_code == 409
    api("POST", source + "/sync-runs", key="republish")
    assert Worker(core).run_once()
    assert api("GET", table, role="fields").status_code == 200
    changed = api("PATCH", source, key="change-account", tag=allowed.headers["etag"],
                  json={"connection":{"username":"a_different_reader"}})
    assert changed.status_code == 200 and not changed.json()["credential_configured"]
    assert api("GET", table + "/preview", role="raw").status_code == 409
    with core.sessions() as session:
        for model in (AuditEvent, IdempotencyRequest, CredentialVersion):
            for row in session.execute(select(model.__table__)).mappings():
                assert password not in str(row) and "private-fixture-value" not in str(row)


def test_concurrent_draft_replay_and_interruption(workspace, monkeypatch):
    api, core, connection, password, _ = workspace
    draft = {"connection": connection, "password": password}
    entered, release = Event(), Event()
    probes = 0

    def slow_probe(config, secret):
        nonlocal probes
        probes += 1
        entered.set()
        assert release.wait(10)

    monkeypatch.setattr(connector, "test_connection", slow_probe)
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(api, "POST", "/source-connection-tests", key="same", json=draft)
        try:
            assert entered.wait(5)
            second = api("POST", "/source-connection-tests", key="same", json=draft)
            assert second.status_code == 202 and second.json()["status"] == "running"
            conflict = api("POST", "/source-connection-tests", key="same", json={**draft, "password":"different"})
            assert conflict.status_code == 409
            with core.sessions.begin() as session:
                test = session.get(ConnectionTest, second.json()["id"])
                test.deadline_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            assert expire_probes(core) == 1
        finally:
            release.set()
        terminal = first.result()
    assert terminal.json()["status"] == "interrupted"
    assert api("POST", "/source-connection-tests", key="same", json=draft).json() == terminal.json()
    assert probes == 1
    assert api("GET", "/source-connection-tests/" + terminal.json()["id"], role="other").status_code == 404
