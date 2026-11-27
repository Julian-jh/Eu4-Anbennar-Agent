import os
import threading
import unittest
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


FRONTEND = Path(__file__).resolve().parents[1] / "ai-center-frontend"
SOURCE_ID = "37711905-c135-44ac-8784-f7ab2430147e"
TOKEN = "frontend-smoke-token"
SOURCES = "/api/v1/sources"


class StaticFiles(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def launch_browser(chromium):
    from playwright.sync_api import Error

    try:
        return chromium.launch()
    except Error as error:
        if os.name != "nt" or "Executable doesn't exist" not in str(error):
            raise
        # A normal Windows VS Code installation may already have Edge or Chrome.
        for browser_path in (
            "Microsoft/Edge/Application/msedge.exe",
            "Google/Chrome/Application/chrome.exe",
        ):
            for location in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
                base = os.environ.get(location)
                if base and (Path(base) / browser_path).is_file():
                    return chromium.launch(executable_path=str(Path(base) / browser_path))
        raise


class DataSourceSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright

        playwright = sync_playwright().start()
        cls.addClassCleanup(playwright.stop)
        cls.browser = launch_browser(playwright.chromium)
        cls.addClassCleanup(cls.browser.close)
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0), partial(StaticFiles, directory=str(FRONTEND))
        )
        cls.addClassCleanup(server.server_close)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        cls.addClassCleanup(thread.join)
        cls.addClassCleanup(server.shutdown)
        cls.entry = f"http://127.0.0.1:{server.server_port}/index.html"

    def setUp(self):
        self.source = None
        self.create_payloads = []
        self.errors = []
        self.addCleanup(self.assertEqual, self.errors, [])
        context = self.browser.new_context(service_workers="block")
        self.addCleanup(context.close)
        context.route("**/api/v1/**", self.serve_api)
        self.page = context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.set_default_timeout(5000)
        self.page.goto(self.entry + "#/data/catalog")

    def serve_api(self, route):
        request = route.request
        path = urlsplit(request.url).path
        detail = f"{SOURCES}/{SOURCE_ID}"
        if request.headers.get("authorization") != f"Bearer {TOKEN}":
            self.errors.append(f"Missing test token on {request.method} {path}")
            route.fulfill(status=401, json={"code": "unauthorized"})
        elif path == SOURCES and request.method == "GET":
            items = [self.source] if self.source else []
            route.fulfill(json={"items": items, "next_cursor": None})
        elif path == SOURCES and request.method == "POST":
            payload = request.post_data_json
            self.create_payloads.append(payload)
            self.source = {**payload, "id": SOURCE_ID, "credential_configured": False}
            route.fulfill(status=201, json=self.source)
        elif path == detail and request.method == "GET" and self.source:
            route.fulfill(json=self.source, headers={"ETag": '"v1"'})
        elif path == detail + "/health" and request.method == "GET" and self.source:
            route.fulfill(json={"catalog_status": "not_synced", "latest_sync_run": None})
        else:
            self.errors.append(f"Unexpected Sources request: {request.method} {path}")
            route.fulfill(status=404, json={"code": "unexpected_request"})

    def sign_in(self):
        self.page.get_by_role("heading", name="Connect to Sources").wait_for()
        self.page.get_by_label("Access token", exact=True).fill(TOKEN)
        self.page.get_by_role("button", name="Connect", exact=True).click()

    def assert_connection(self, name, database):
        self.page.wait_for_url(self.entry + f"#/data/connection?source={SOURCE_ID}")
        self.page.get_by_role("heading", name=name, exact=True).wait_for()
        self.page.get_by_role("heading", name="Connection settings").wait_for()
        source_view = self.page.locator("#ac-live-sources")
        db_value = source_view.get_by_text("Database", exact=True).locator("xpath=following-sibling::dd[1]")
        self.assertEqual(db_value.inner_text(), database)
        source_view.get_by_text("Never synced", exact=True).wait_for()

    def test_sign_in_open_source_and_sign_out(self):
        self.source = {
            "id": SOURCE_ID,
            "name": "History archive",
            "corpus": "Real History",
            "enabled": True,
            "credential_configured": False,
            "connection": {
                "host": "db.example.test", "port": 5432, "database": "history_archive",
                "schemas": ["public"], "username": "reader", "tls_profile": "workspace-default",
            },
        }
        self.sign_in()
        table = self.page.get_by_role("table", name="Sources", exact=True)
        table.get_by_role("button", name="History archive").click()
        self.assert_connection("History archive", "history_archive")
        self.page.get_by_role("button", name="Sign out").click()
        self.page.get_by_role("heading", name="Connect to Sources").wait_for()
        self.page.get_by_role("button", name="Sources", exact=True).click()
        self.page.get_by_label("Access token", exact=True).wait_for()
        self.assertEqual(self.create_payloads, [])

    def test_create_source_from_form(self):
        self.sign_in()
        self.page.get_by_role("heading", name="No sources connected").wait_for()
        self.page.get_by_role("button", name="Add source").click()
        self.page.get_by_role("heading", name="Add PostgreSQL source").wait_for()
        create = self.page.get_by_role("button", name="Create source")
        create.click()
        name = self.page.get_by_label("Source name", exact=True)
        self.assertTrue(name.evaluate("field => field.validity.valueMissing && field === document.activeElement"))
        self.assertEqual(self.create_payloads, [])

        name.fill("Trade ledger")
        self.page.get_by_label("Corpus", exact=True).select_option("EU4")
        self.page.get_by_label("Host", exact=True).fill("ledger.example.test")
        self.page.get_by_label("Port", exact=True).fill("5433")
        self.page.get_by_label("Database", exact=True).fill("trade_data")
        self.page.get_by_label("Username", exact=True).fill("trade_reader")
        self.page.get_by_label("Schemas (comma separated)").fill("public, ledger")
        create.click()
        self.assert_connection("Trade ledger", "trade_data")
        self.assertEqual(self.create_payloads, [{
            "name": "Trade ledger", "corpus": "EU4", "enabled": True,
            "connection": {
                "host": "ledger.example.test", "port": 5433, "database": "trade_data",
                "username": "trade_reader", "schemas": ["public", "ledger"],
                "tls_profile": "workspace-default",
            },
        }])
