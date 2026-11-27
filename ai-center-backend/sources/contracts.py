from datetime import datetime
from typing import Annotated, Generic, Literal, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, StringConstraints, model_validator


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255, pattern=r"^[^\x00]+$")]
SchemaName = Annotated[str, StringConstraints(min_length=1, max_length=63, pattern=r"^[^\x00]+$")]
Schemas = Annotated[list[SchemaName], Field(min_length=1, max_length=64)]
Corpus = Literal["EU4", "Anbennar", "Real History"]
Tls = Literal["workspace-default", "local-development"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Connection(Contract):
    host: Name
    port: int = Field(default=5432, ge=1, le=65535)
    database: Name
    username: Name
    schemas: Schemas = Field(default_factory=lambda: ["public"])
    tls_profile: Tls = "workspace-default"


class PatchFields(Contract):
    @model_validator(mode="after")
    def supplied_fields_have_values(self):
        if not self.model_fields_set or any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError("Submit at least one field, with a non-null value.")
        return self


class ConnectionPatch(PatchFields):
    host: Name | None = None
    port: int | None = Field(default=None, ge=1, le=65535)
    database: Name | None = None
    username: Name | None = None
    schemas: Schemas | None = None
    tls_profile: Tls | None = None


class PasswordInput(Contract):
    password: SecretStr = Field(min_length=1, max_length=4096)


class Replace(PasswordInput):
    action: Literal["replace"]


class Clear(Contract):
    action: Literal["clear"]


class DraftTest(PasswordInput):
    connection: Connection


class SourceCreate(Contract):
    name: Name
    corpus: Corpus
    kind: Literal["database"] = "database"
    engine: Literal["postgresql"] = "postgresql"
    enabled: bool = True
    connection: Connection
    credential: Replace | None = None


class SourcePatch(PatchFields):
    name: Name | None = None
    corpus: Corpus | None = None
    enabled: bool | None = None
    connection: ConnectionPatch | None = None
    credential: Annotated[Replace | Clear, Field(discriminator="action")] | None = None
    preview_columns: dict[str, list[SchemaName]] | None = Field(default=None, max_length=1000)


def source_payload(body: SourceCreate | SourcePatch) -> dict:
    data = body.model_dump(exclude_unset=isinstance(body, SourcePatch), exclude_none=True)
    if isinstance(body.credential, Replace):
        data["credential"]["password"] = body.credential.password.get_secret_value()
    return data


class SourceInfo(Contract):
    id: UUID
    name: str
    corpus: Corpus
    kind: Literal["database"]
    engine: Literal["postgresql"]
    enabled: bool
    version: int
    current_config_revision: int
    connection: Connection
    credential_configured: bool
    preview_columns: dict[str, list[str]] | None = None
    created_at: datetime
    updated_at: datetime


Item = TypeVar("Item")


class Page(Contract, Generic[Item]):
    items: list[Item]
    next_cursor: str | None


class ProbeInfo(Contract):
    id: UUID
    source_id: UUID | None
    revision: int | None
    status: Literal["running", "succeeded", "failed", "interrupted"]
    error_code: str | None
    elapsed_ms: int | None
    started_at: datetime
    finished_at: datetime | None


class RunInfo(Contract):
    id: UUID
    source_id: UUID
    revision: int
    status: Literal["queued", "running", "succeeded", "failed", "superseded"]
    attempts: int
    error_code: str | None
    asset_count: int | None
    snapshot_id: UUID | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class TestSummary(Contract):
    id: UUID
    revision: int
    status: str
    error_code: str | None
    elapsed_ms: int | None
    finished_at: datetime | None


class Health(Contract):
    source_id: UUID
    current_config_revision: int
    catalog_status: Literal["disabled", "pending_sync", "blocked", "not_synced", "available"]
    published_snapshot_id: UUID | None
    last_published_at: datetime | None
    last_published_revision: int | None
    latest_sync_run: RunInfo | None
    latest_test: TestSummary | None


class AssetInfo(Contract):
    id: UUID
    asset_id: UUID
    snapshot_id: UUID
    schema_name: str = Field(alias="schema")
    name: str
    kind: str
    qualified_name: str


class CatalogPage(Page[AssetInfo]):
    snapshot_id: UUID


class FieldInfo(Contract):
    name: str
    type: str
    ordinal: int
    type_oid: int
    typmod: int
    nullable: bool
    generated: str


class AssetDetail(AssetInfo):
    columns: list[FieldInfo]


class Sample(Contract):
    asset_id: UUID
    snapshot_id: UUID
    read_at: datetime
    columns: list[str]
    rows: list[dict[str, str | bool | int | float | None]]
    truncated: bool
