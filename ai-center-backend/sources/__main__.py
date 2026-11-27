"""Local operator commands. Run from ai-center-backend."""

import argparse
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets


def initialize(directory, days):
    from .access import CAPABILITIES

    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    token = secrets.token_urlsafe(32)
    def write_private(name, value):
        fd = os.open(directory / name, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(value + "\n")

    def ring():
        return {"v1": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()}
    write_private("keys.json", json.dumps({"SOURCES_ENCRYPTION_KEYS": ring(), "SOURCES_HMAC_KEYS": ring()}, indent=2))
    entry = {"id": "local-admin", "workspace": "local", "grants": list(CAPABILITIES),
             "sha256": hashlib.sha256(token.encode()).hexdigest(),
             "expires_at": (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()}
    write_private("actors.json", json.dumps([entry], indent=2))
    write_private("admin.token", token)
    print(f"Created a {days}-day local admin credential in {directory / 'admin.token'}.")


def main():
    parser = argparse.ArgumentParser(description="AI Center Sources")
    parser.add_argument("--profile", type=Path, default=Path(os.getenv("SOURCES_PROFILE") or Path.home() / ".eu4-sources"))
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init", help="Create a new local profile, keyrings and administrator credential.")
    commands.add_parser("migrate", help="Upgrade the platform metadata database.")
    serve = commands.add_parser("serve", help="Start the local REST API.")
    serve.add_argument("--port", type=int, default=8000)
    worker = commands.add_parser("worker", help="Run the catalog sync worker.")
    worker.add_argument("--once", action="store_true")
    args = parser.parse_args()
    directory = args.profile.expanduser().resolve()
    if args.command == "init":
        initialize(directory, 30)
        return
    if not os.getenv("SOURCES_DATABASE_URL") and (directory / "platform.url").is_file():
        os.environ["SOURCES_DATABASE_URL"] = (directory / "platform.url").read_text(encoding="utf-8").strip()
    if (directory / "keys.json").is_file():
        for name, ring in json.loads((directory / "keys.json").read_text(encoding="utf-8")).items():
            if name in {"SOURCES_ENCRYPTION_KEYS", "SOURCES_HMAC_KEYS"}:
                os.environ.setdefault(name, json.dumps(ring))
        if "SOURCES_ACTORS" not in os.environ:
            os.environ.setdefault("SOURCES_ACTORS_FILE", str(directory / "actors.json"))
    if args.command == "migrate":
        from alembic import command
        from alembic.config import Config
        config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
        command.upgrade(config, "head")
    elif args.command == "serve":
        import uvicorn
        uvicorn.run("sources.api:create_app", factory=True, host="127.0.0.1", port=args.port, access_log=False)
    else:
        from .worker import main as run_worker
        run_worker(["--once"] if args.once else [])


if __name__ == "__main__":
    main()
