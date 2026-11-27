"""Launch the local Sources API, workbench and sync worker on Windows."""

import argparse
from http.client import HTTPConnection, HTTPException
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import webbrowser


BACKEND = Path(__file__).resolve().parents[1] / "ai-center-backend"
HOST, PORT = "127.0.0.1", 63074


def serving_workbench(port):
    connection = HTTPConnection(HOST, port, timeout=1)
    try:
        connection.request("GET", "/openapi.json")
        response = connection.getresponse()
        if response.status != 200:
            return False
        spec = json.loads(response.read(1024 * 1024))
        if spec.get("info", {}).get("title") != "AI Center · Data Sources":
            return False
        connection.request("GET", "/index.html")
        response = connection.getresponse()
        return response.status == 200 and b'ac-live-sources' in response.read(256 * 1024)
    except (OSError, HTTPException, ValueError):
        return False
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    url = f"http://{HOST}:{args.port}/#/data/catalog"
    if serving_workbench(args.port):
        print(f"AI Center is running at {url}")
        if not args.no_browser:
            webbrowser.open_new_tab(url)
        return 0
    with socket.socket() as probe:
        try:
            probe.bind((HOST, args.port))
        except OSError:
            print(f"Port {args.port} is occupied. Close the old frontend server and run this launcher again.", file=sys.stderr)
            return 1

    profile = Path(os.getenv("SOURCES_PROFILE") or Path.home() / ".eu4-sources").resolve()
    env = os.environ.copy()
    env.setdefault("SOURCES_ALLOW_INSECURE_LOOPBACK", "1")
    if not env.get("SOURCES_DATABASE_URL") and not (profile / "platform.url").is_file():
        print("Set SOURCES_DATABASE_URL or complete the local database setup in ai-center-backend/README.md.", file=sys.stderr)
        return 1
    if not ((profile / "keys.json").is_file() or env.get("SOURCES_ENCRYPTION_KEYS")):
        print("Initialize the operator profile with python -m sources init from ai-center-backend.", file=sys.stderr)
        return 1
    interpreter = BACKEND / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    cli = [str(interpreter) if interpreter.is_file() else sys.executable, "-m", "sources", "--profile", str(profile)]
    if subprocess.run(cli + ["migrate"], cwd=BACKEND, env=env).returncode:
        print("The platform database could not be upgraded. Check the database connection and Docker Desktop.", file=sys.stderr)
        return 1

    processes = []
    try:
        api = subprocess.Popen(cli + ["serve", "--port", str(args.port)], cwd=BACKEND, env=env)
        processes.append(api)
        for _ in range(60):
            if api.poll() is not None:
                return 1
            if serving_workbench(args.port):
                break
            time.sleep(.25)
        else:
            print("The workbench did not become ready.", file=sys.stderr)
            return 1
        worker = subprocess.Popen(cli + ["worker"], cwd=BACKEND, env=env)
        processes.append(worker)
        print(f"AI Center: {url}\nPress Ctrl+C to stop the API and worker.", flush=True)
        if not args.no_browser:
            webbrowser.open_new_tab(url)
        while all(process.poll() is None for process in processes):
            time.sleep(.5)
        print("A backend process exited. Restart the launcher to resume.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
            process.wait()


if __name__ == "__main__":
    sys.exit(main())
