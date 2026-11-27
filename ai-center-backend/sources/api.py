import logging
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select

from .access import Actor, authenticate, bearer
from .catalog import Catalog
from .connection_tests import ConnectionTests, present
from .contracts import (AssetDetail, CatalogPage, DraftTest, Health, Page, ProbeInfo, RunInfo, Sample,
                        SourceCreate, SourceInfo, SourcePatch, source_payload)
from .core import Core, DomainError
from .models import Source
from .paging import page_token, read_token


Identity = Annotated[Actor, Depends(authenticate)]
Limit = Annotated[int, Query(ge=1, le=100)]


def request_key(value: Annotated[str | None, Header(alias="Idempotency-Key")] = None):
    if not value:
        raise DomainError(400, "idempotency_key_required", "Send an Idempotency-Key header.")
    if len(value) > 128 or not value.isascii() or not value.isprintable() or not value.strip():
        raise DomainError(400, "invalid_idempotency_key", "Use a printable key of at most 128 characters.")
    return value


Key = Annotated[str, Depends(request_key)]


def public_source(data, actor):
    data = dict(data)
    if "preview_policy" not in actor.grants:
        data.pop("preview_columns", None)
    return data


def json_result(data, status=200, **headers):
    return JSONResponse(jsonable_encoder(data), status_code=status, headers=headers)


def create_app(core=None):
    core = core or Core()
    catalog = Catalog(core)
    probes = ConnectionTests(core, catalog)
    app = FastAPI(title="AI Center · Data Sources", version="1.0")
    base = "/api/v1"
    sources = base + "/sources"

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = str(uuid4())
        try:
            response = await call_next(request)
        except Exception as exc:
            # Database/driver exception text can include request values or connection parameters.
            logging.getLogger(__name__).error("Sources request %s failed (%s)", request.state.request_id, type(exc).__name__)
            response = json_result({"code": "internal_error", "message": "The request could not be completed.",
                                    "request_id": request.state.request_id}, 500)
        response.headers["X-Request-ID"] = request.state.request_id
        if request.url.path.startswith(base):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(DomainError)
    async def domain_error(request, exc):
        result = {"code": exc.code, "message": exc.message, "request_id": request.state.request_id}
        if exc.detail:
            result["detail"] = exc.detail
        headers = {"WWW-Authenticate": "Bearer"} if exc.status == 401 else {}
        return json_result(result, exc.status, **headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Validation errors can otherwise echo entire bodies, including passwords.
        return json_result({"code": "invalid_request", "message": "Check the request against the API schema.",
                            "request_id": request.state.request_id}, 422)

    @app.post(sources, status_code=201, response_model=SourceInfo)
    def create_source(body: SourceCreate, actor: Identity, key: Key):
        actor.require("manage")
        payload = source_payload(body)
        if body.credential:
            actor.require("credentials")
        with core.sessions.begin() as session:
            result, _ = core.idempotent(session, actor.workspace, actor.id, "source.create", "collection", key,
                                        payload, lambda: core.create_source(
                                            session, actor.workspace, actor.id, payload,
                                            can_manage_credentials="credentials" in actor.grants))
        return json_result(public_source(result, actor), 201, ETag=f'"{result["version"]}"',
                           Location=f'{sources}/{result["id"]}')

    @app.get(sources, response_model=Page[SourceInfo], response_model_exclude_unset=True)
    def list_sources(actor: Identity, name: str | None = None, corpus: str | None = None,
                     engine: str | None = None, enabled: bool | None = None, limit: Limit = 25,
                     cursor: str | None = None):
        actor.require("catalog")
        scope = dict(route="sources", workspace=actor.workspace, actor=actor.id, name=name, corpus=corpus,
                     engine=engine, enabled=enabled)
        query = select(Source).where(Source.workspace_id == actor.workspace)
        if name:
            query = query.where(Source.name.icontains(name, autoescape=True))
        if corpus:
            query = query.where(Source.corpus == corpus)
        if engine:
            query = query.where(Source.engine == engine)
        if enabled is not None:
            query = query.where(Source.enabled == enabled)
        if cursor:
            query = query.where(Source.id > read_token(cursor, scope))
        with core.sessions.begin() as session:
            rows = session.scalars(query.order_by(Source.id).limit(limit + 1)).all()
            return {"items": [public_source(core.public_source(session, row), actor) for row in rows[:limit]],
                    "next_cursor": page_token(scope, rows[limit-1].id) if len(rows) > limit else None}

    @app.get(sources + "/{source_id}", response_model=SourceInfo)
    def get_source(source_id: UUID, actor: Identity):
        actor.require("catalog")
        with core.sessions.begin() as session:
            source = core.get_source(session, actor.workspace, str(source_id))
            return json_result(public_source(core.public_source(session, source), actor), ETag=f'"{source.version}"')

    @app.patch(sources + "/{source_id}", response_model=SourceInfo)
    def edit(source_id: UUID, body: SourcePatch, actor: Identity, key: Key,
             if_match: Annotated[str | None, Header(alias="If-Match")] = None):
        actor.require("manage")
        if body.credential:
            actor.require("credentials")
        if body.preview_columns is not None:
            actor.require("preview_policy")
        payload, target = source_payload(body), str(source_id)
        with core.sessions.begin() as session:
            def update():
                required = set()
                value = core.update_source(session, actor.workspace, actor.id, target, payload, if_match,
                                           can_manage_credentials="credentials" in actor.grants,
                                           can_manage_preview="preview_policy" in actor.grants,
                                           required_permissions=required)
                return {"source": value, "permissions": sorted(required)}

            result, _ = core.idempotent(session, actor.workspace, actor.id, "source.patch", target, key,
                                        {"body": payload, "if_match": if_match}, update)
            for capability in result["permissions"]:
                actor.require("preview_policy" if capability == "preview_columns" else capability)
        data = result["source"]
        return json_result(public_source(data, actor), ETag=f'"{data["version"]}"')

    def test_reply(result):
        return json_result(result, 202 if result["status"] == "running" else 200,
                           Location=f'{base}/source-connection-tests/{result["id"]}')

    @app.post(base + "/source-connection-tests", response_model=ProbeInfo, responses={202: {"model": ProbeInfo}})
    def draft_test(body: DraftTest, actor: Identity, key: Key):
        actor.require("test")
        draft = {"connection": body.connection.model_dump(), "password": body.password.get_secret_value()}
        return test_reply(probes.execute(actor, key, draft=draft))

    @app.post(sources + "/{source_id}/connection-tests", response_model=ProbeInfo, responses={202: {"model": ProbeInfo}})
    def saved_test(source_id: UUID, actor: Identity, key: Key):
        actor.require("test")
        return test_reply(probes.execute(actor, key, source_id=str(source_id)))

    @app.get(base + "/source-connection-tests/{test_id}", response_model=ProbeInfo)
    def read_test(test_id: UUID, actor: Identity):
        actor.require("test")
        with core.sessions.begin() as session:
            return present(probes.read(session, actor, str(test_id)))

    @app.post(sources + "/{source_id}/sync-runs", status_code=202, response_model=RunInfo)
    def sync(source_id: UUID, actor: Identity, key: Key):
        actor.require("sync")
        target = str(source_id)
        with core.sessions.begin() as session:
            result, _ = core.idempotent(session, actor.workspace, actor.id, "source.sync", target, key, {},
                                        lambda: catalog.enqueue(session, actor.workspace, target, actor.id))
        return json_result(result, 202, Location=f'{base}/source-sync-runs/{result["id"]}')

    @app.get(base + "/source-sync-runs/{run_id}", response_model=RunInfo)
    def run(run_id: UUID, actor: Identity):
        actor.require("runs")
        with core.sessions.begin() as session:
            return catalog.get_run(session, actor.workspace, str(run_id))

    @app.get(sources + "/{source_id}/sync-runs", response_model=Page[RunInfo])
    def history(source_id: UUID, actor: Identity, limit: Limit = 25, cursor: str | None = None):
        actor.require("runs")
        with core.sessions.begin() as session:
            return catalog.list_runs(session, actor.workspace, str(source_id), cursor=cursor, limit=limit)

    @app.get(sources + "/{source_id}/health", response_model=Health)
    def health(source_id: UUID, actor: Identity):
        actor.require("catalog")
        with core.sessions.begin() as session:
            return catalog.health(session, actor.workspace, str(source_id))

    @app.get(sources + "/{source_id}/assets", response_model=CatalogPage)
    def assets(source_id: UUID, actor: Identity, schema: str | None = None, kind: str | None = None,
               name: str | None = None, cursor: str | None = None, limit: Limit = 25):
        actor.require("catalog")
        with core.sessions.begin() as session:
            return catalog.list_assets(session, actor.workspace, str(source_id), schema=schema, kind=kind,
                                       name=name, cursor=cursor, limit=limit)

    @app.get(sources + "/{source_id}/assets/{asset_id}", response_model=AssetDetail)
    def fields(source_id: UUID, asset_id: UUID, actor: Identity, snapshot_id: UUID | None = None):
        actor.require("fields")
        with core.sessions.begin() as session:
            return catalog.get_asset(session, actor.workspace, str(source_id), str(asset_id),
                                     snapshot_id=str(snapshot_id) if snapshot_id else None)

    @app.get(sources + "/{source_id}/assets/{asset_id}/preview", response_model=Sample)
    def preview(source_id: UUID, asset_id: UUID, actor: Identity,
                auth: Annotated[HTTPAuthorizationCredentials, Depends(bearer)], mode: Literal["masked", "raw"] = "masked",
                limit: Annotated[int, Query(ge=1, le=50)] = 15, snapshot_id: UUID | None = None):
        capability = "preview_raw" if mode == "raw" else "preview_masked"
        actor.require(capability)
        sample = catalog.preview(actor.workspace, str(source_id), str(asset_id), mode=mode, limit=limit,
                                 snapshot_id=str(snapshot_id) if snapshot_id else None, actor_id=actor.id)
        current = authenticate(auth)
        current.require(capability)
        if (current.workspace, current.id) != (actor.workspace, actor.id):
            raise DomainError(403, "identity_changed", "Access changed while reading this sample.")
        return sample

    frontend = Path(__file__).resolve().parents[2] / "ai-center-frontend"
    if (frontend / "index.html").is_file():
        @app.get("/design/ai-center-workbench.html", include_in_schema=False)
        def open_workbench():
            return RedirectResponse("/#/data/catalog")

        app.mount("/", StaticFiles(directory=frontend, html=True), name="workbench")
    return app
