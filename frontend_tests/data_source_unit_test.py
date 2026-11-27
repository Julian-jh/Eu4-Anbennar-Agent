from pathlib import Path
import shutil
import subprocess
import unittest


CASE_RUNNER = Path(__file__).with_name("data_source_unit_cases.cjs").resolve()


class DataSourceUnitTest(unittest.TestCase):
    def run_node_case(self, case):
        node = shutil.which("node")
        self.assertIsNotNone(node, "Install Node.js 18+ and make node available on PATH.")
        result = subprocess.run(
            [node, str(CASE_RUNNER), case],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_list_sources_filters(self):
        self.run_node_case("listSourcesFilters")

    def test_update_source_request(self):
        self.run_node_case("updateSourceRequest")

    def test_token_change_discards_pending_response(self):
        self.run_node_case("tokenChangeDiscardsPendingResponse")

    def test_unauthorized_clears_token(self):
        self.run_node_case("unauthorizedClearsToken")
