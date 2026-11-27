"""Authenticate revocable, workspace-scoped bearer credentials."""

import hashlib
import json
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from .core import DomainError


LEVELS = ("catalog", "fields", "preview_masked", "preview_raw")
CAPABILITIES = (*LEVELS, "manage", "credentials", "preview_policy", "test", "sync", "runs")
bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Actor:
    workspace: str
    id: str
    grants: frozenset[str]

    def require(self, *capabilities: str) -> None:
        if not self.grants.issuperset(capabilities):
            raise DomainError(403, "forbidden", "This credential lacks the required permission.")


def authenticate(auth: HTTPAuthorizationCredentials | None = Depends(bearer)) -> Actor:
    if auth and len(auth.credentials) <= 512:
        digest = hashlib.sha256(auth.credentials.encode()).hexdigest()
        registry = os.getenv("SOURCES_ACTORS_FILE")
        records = Path(registry).read_text(encoding="utf-8") if registry else os.environ["SOURCES_ACTORS"]
        for entry in json.loads(records):
            if not secrets.compare_digest(entry["sha256"], digest):
                continue
            if datetime.fromisoformat(entry["expires_at"]) <= datetime.now(timezone.utc):
                break
            grants = set(entry["grants"])
            for index, level in enumerate(LEVELS):
                if level in grants:
                    grants.update(LEVELS[:index])
            return Actor(entry["workspace"], entry["id"], frozenset(grants))
    raise DomainError(401, "unauthenticated", "A valid bearer credential is required.")
