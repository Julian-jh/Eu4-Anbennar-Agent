"""Serve the workbench on loopback and open it in the default browser."""

from functools import partial
from http.client import HTTPConnection, HTTPException
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import webbrowser


FRONTEND = Path(__file__).resolve().parents[1] / "ai-center-frontend"
HOST = "127.0.0.1"
PORT = 63074


class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = False


def serves_workbench(port, entry):
    connection = HTTPConnection(HOST, port, timeout=2)
    try:
        connection.request("GET", "/index.html")
        response = connection.getresponse()
        return response.status == 200 and response.read(len(entry) + 1) == entry
    except (OSError, HTTPException):
        return False
    finally:
        connection.close()


def main(port=PORT):
    url = f"http://{HOST}:{port}/"
    entry = FRONTEND / "index.html"
    if not entry.is_file():
        print(f"Frontend entry is missing: {entry}", file=sys.stderr)
        return 1
    handler = partial(SimpleHTTPRequestHandler, directory=str(FRONTEND))
    try:
        server = LocalServer((HOST, port), handler)
    except OSError as error:
        if serves_workbench(port, entry.read_bytes()):
            webbrowser.open_new_tab(url)
            return 0
        print(f"Cannot serve the frontend at {url}: {error}", file=sys.stderr)
        return 1
    with server:
        print(f"Serving AI Center at {url}   Press Ctrl+C to stop.", flush=True)
        try:
            webbrowser.open_new_tab(url)
            server.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
