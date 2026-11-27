"""Connection probes run between short reservation and completion transactions."""

from datetime import datetime, timedelta, timezone
from time import monotonic

from sqlalchemy import select

from . import connector
from .core import DomainError
from .models import ConnectionTest


def now():
    return datetime.now(timezone.utc)


def present(test):
    return {k: getattr(test, k) for k in (
        "id", "source_id", "revision", "status", "error_code", "elapsed_ms", "started_at", "finished_at"
    )}


def mark_interrupted(core, session, test):
    test.status, test.error_code, test.finished_at = "interrupted", "interrupted", now()
    core.audit(session, test.workspace_id, test.actor, "connection_test.interrupted", test.id)


def expire_probes(core, batch_size=100):
    with core.sessions.begin() as session:
        expired = session.scalars(select(ConnectionTest).where(
            ConnectionTest.status == "running", ConnectionTest.deadline_at <= now()
        ).order_by(ConnectionTest.deadline_at, ConnectionTest.id).limit(batch_size)
            .with_for_update(skip_locked=True)).all()
        for test in expired:
            mark_interrupted(core, session, test)
        return len(expired)


class ConnectionTests:
    def __init__(self, core, catalog):
        self.core = core
        self.catalog = catalog

    def read(self, session, actor, test_id):
        query = select(ConnectionTest).where(
            ConnectionTest.id == test_id, ConnectionTest.workspace_id == actor.workspace
        ).with_for_update()
        test = session.scalar(query)
        if test is None or (test.source_id is None and test.actor != actor.id):
            raise DomainError(404, "test_not_found", "Connection test not found.")
        if test.status == "running" and test.deadline_at <= now():
            mark_interrupted(self.core, session, test)
        return test

    def execute(self, actor, key, source_id=None, draft=None):
        operation = "test.saved" if source_id else "test.draft"
        remote = {}
        with self.core.sessions.begin() as session:
            def reserve():
                revision = None
                if source_id:
                    source = self.core.get_source(session, actor.workspace, source_id, lock=True)
                    if not source.enabled:
                        raise DomainError(409, "source_disabled", "This source is disabled.")
                    revision = source.current_config_revision
                    remote["config"], remote["password"] = self.core.connection(session, source)
                else:
                    remote.update(config=draft["connection"], password=draft["password"])
                test = ConnectionTest(workspace_id=actor.workspace, actor=actor.id, source_id=source_id,
                                      revision=revision, status="running", deadline_at=now() + timedelta(seconds=30))
                session.add(test)
                session.flush()
                self.core.audit(session, actor.workspace, actor.id, operation, test.id)
                return {"id": test.id}

            result, replay = self.core.idempotent(session, actor.workspace, actor.id, operation,
                                                  source_id or "draft", key, draft or {}, reserve)
            test_id = result["id"]
            if replay:
                return present(self.read(session, actor, test_id))

        started = monotonic()
        error_code = None
        try:
            connector.test_connection(remote["config"], remote["password"])
        except connector.ConnectorError as exc:
            error_code = exc.code
        finally:
            remote.clear()
        with self.core.sessions.begin() as session:
            source = self.core.get_source(session, actor.workspace, source_id, lock=True) if source_id else None
            test = self.read(session, actor, test_id)
            if test.status == "running":
                test.status = "failed" if error_code else "succeeded"
                test.error_code = error_code
                test.elapsed_ms = round((monotonic() - started) * 1000)
                test.finished_at = now()
                if source and source.current_config_revision == test.revision and error_code in (
                    "authentication_failed", "schema_denied", "access_denied", "permission_denied", "auth_failed"
                ):
                    self.catalog.block_access(session, source)
                self.core.audit(session, actor.workspace, actor.id, operation + "." + test.status, test_id,
                                {"error_code": error_code})
            return present(test)
