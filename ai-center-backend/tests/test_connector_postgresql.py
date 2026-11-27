"""Run using the backend environment. Live cases use a disposable PostgreSQL database."""

import json
import os
from pathlib import Path
import sys
from threading import Event
import unittest
from unittest.mock import patch
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sources import connector


class PolicyTests(unittest.TestCase):
    config = dict(host="127.0.0.1", port=5432, database="history", username="reader")

    def test_tls_and_target_policy(self):
        with patch.dict(os.environ, {}, clear=True):
            args = connector._parameters(self.config, "example", 3000)
            self.assertEqual((args["sslmode"], args["hostaddr"]), ("verify-full", "127.0.0.1"))
            for values in ({"host": "other.example.test"}, {"port": 5433},
                           {"tls_profile": "local-development"}, {"ssl_mode": "prefer"}):
                with self.subTest(values=values), self.assertRaises(connector.ConnectorError) as error:
                    connector._parameters(self.config | values, "example", 3000)
                self.assertEqual(error.exception.code, "target_denied")

    def test_all_dns_answers_must_be_allowed(self):
        settings = {"SOURCES_ALLOWED_HOSTS": "db.test", "SOURCES_ALLOWED_NETWORKS": "10.0.0.0/24"}
        addresses = [connector.ipaddress.ip_address(ip) for ip in ("10.0.0.5", "10.0.1.6")]
        with patch.dict(os.environ, settings, clear=True), patch.object(connector, "_addresses", return_value=addresses):
            with self.assertRaises(connector.ConnectorError) as error:
                connector._parameters(self.config | {"host": "db.test"}, "example", 3000)
            self.assertEqual(error.exception.code, "target_denied")

    def test_missing_password_and_invalid_schema(self):
        with self.assertRaises(connector.ConnectorError) as error:
            connector._parameters(self.config, "", 3000)
        self.assertEqual(error.exception.code, "credential_required")
        with self.assertRaises(connector.ConnectorError):
            connector.test_connection(self.config | {"schemas": []}, "example")

    def test_connection_has_total_deadline(self):
        release = Event()
        try:
            with patch.object(connector, "TEST_DEADLINE", 0.05), \
                    patch.object(connector, "_test_schemas", side_effect=lambda *_: release.wait(1)):
                with self.assertRaises(connector.ConnectorError) as error:
                    connector.test_connection(self.config, "example")
                self.assertEqual(error.exception.code, "timeout")
        finally:
            release.set()


@unittest.skipUnless(os.getenv("SOURCES_TEST_ADMIN_DSN"), "requires disposable PostgreSQL via SOURCES_TEST_ADMIN_DSN")
class PostgresIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        params = conninfo_to_dict(os.environ["SOURCES_TEST_ADMIN_DSN"])
        tag = uuid4().hex[:12]
        cls.role = "src_reader_" + tag
        cls.schema = "src_a_" + tag
        cls.extra = "src-b-" + tag
        cls.password = uuid4().hex
        cls.name = 'Country "register"'
        cls.config = dict(host=params.get("host", "127.0.0.1"), port=params.get("port", "5432"),
                          database=params.get("dbname", "postgres"), username=cls.role,
                          schemas=[cls.schema, cls.extra], tls_profile="local-development")
        env = patch.dict(os.environ, {"SOURCES_ALLOWED_PORTS": str(cls.config["port"]),
                                     "SOURCES_ALLOWED_HOSTS": cls.config["host"], "SOURCES_ALLOW_INSECURE_LOOPBACK":"1",
                                     "SOURCES_ALLOWED_NETWORKS":"127.0.0.0/8,::1/128"})
        env.start()
        cls.addClassCleanup(env.stop)
        cls.admin = psycopg.connect(**params, autocommit=True)
        cls.addClassCleanup(cls.admin.close)
        role, schema, extra = [sql.Identifier(n) for n in (cls.role, cls.schema, cls.extra)]
        cls.relation = sql.Identifier(cls.schema, cls.name)
        cls.admin.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(role, sql.Literal(cls.password)))
        cls.addClassCleanup(cls.admin.execute, sql.SQL("DROP ROLE {}").format(role))
        for name in [schema, extra]:
            cls.admin.execute(sql.SQL("CREATE SCHEMA {}").format(name))
            cls.addClassCleanup(cls.admin.execute, sql.SQL("DROP SCHEMA {} CASCADE").format(name))
            cls.admin.execute(sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(name, role))
        cls.admin.execute(sql.SQL('CREATE TABLE {} (id integer, "display name" text, private_note text, file_bytes bytea)').format(cls.relation))
        cls.admin.execute(sql.SQL("INSERT INTO {} VALUES (1,'France','first secret',NULL),"
                                  "(2,'England','second secret',NULL),(3,'Hidden','third secret',NULL)").format(cls.relation))
        cls.admin.execute(sql.SQL("ALTER TABLE {} ENABLE ROW LEVEL SECURITY").format(cls.relation))
        cls.admin.execute(sql.SQL("CREATE POLICY allowed ON {} FOR SELECT USING (id < 3)").format(cls.relation))
        cls.admin.execute(sql.SQL("CREATE VIEW {} AS SELECT 1 AS id").format(sql.Identifier(cls.extra, "view")))
        cls.admin.execute(sql.SQL("CREATE TABLE {} (id integer) PARTITION BY RANGE (id)").format(sql.Identifier(cls.extra, "root")))
        cls.admin.execute(sql.SQL("CREATE TABLE {} PARTITION OF {} DEFAULT").format(
            sql.Identifier(cls.extra, "leaf"), sql.Identifier(cls.extra, "root")))
        cls.admin.execute(sql.SQL("INSERT INTO {} VALUES (7)").format(sql.Identifier(cls.extra, "root")))
        for name in (schema, extra):
            cls.admin.execute(sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA {} TO {}").format(name, role))

    def inventory(self):
        return {entry["name"]: entry for entry in connector.discover(self.config, self.password)}

    def test_auth_and_schema_checks(self):
        connector.test_connection(self.config, self.password)
        for config, password, code in ((self.config, "wrong-test-password", "authentication_failed"),
                                      (self.config | {"schemas":[self.schema,"missing_" + self.schema]},
                                       self.password, "schema_denied")):
            with self.subTest(code=code), self.assertRaises(connector.ConnectorError) as err:
                connector.test_connection(config, password)
            self.assertEqual(err.exception.code, code)
            self.assertNotIn(password, str(err.exception))

    def test_metadata_and_graded_preview(self):
        assets = self.inventory()
        self.assertEqual(assets["view"]["kind"], "view")
        self.assertEqual(assets["root"]["kind"], "partitioned_table")
        self.assertEqual(assets["leaf"]["kind"], "partition")
        asset = json.loads(json.dumps(assets[self.name]))
        names = ["id","display name","private_note","file_bytes"]
        self.assertEqual([c["name"] for c in asset["columns"]], names)
        masked = connector.preview(self.config, self.password, asset, "masked", {"id"}, 50)
        self.assertEqual(masked["columns"], names)
        self.assertEqual(masked["rows"], [dict.fromkeys(names, connector.MASK)] * 2)
        clear = connector.preview(self.config, self.password, asset, "raw", {"id","display name","file_bytes"}, 50)
        self.assertEqual({(r["id"],r["display name"]) for r in clear["rows"]}, {(1,"France"),(2,"England")})
        self.assertTrue(all(r["private_note"] == r["file_bytes"] == connector.MASK for r in clear["rows"]))
        self.assertTrue(connector.preview(self.config, self.password, asset, "masked", set(), 1)["truncated"])
        for obj in ["root","leaf"]:
            self.assertEqual(connector.preview(self.config, self.password, assets[obj], "raw", {"id"}, 1)["rows"], [{"id":7}])
        with self.assertRaises(connector.ConnectorError) as err:
            connector.preview(self.config, self.password, assets["view"], "raw", {"id"}, 1)
        self.assertEqual(err.exception.code,"preview_not_supported")

    def test_shape_identity_and_byte_cutoff(self):
        name = "changes"
        relation = sql.Identifier(self.schema, name)
        def create():
            self.admin.execute(sql.SQL("CREATE TABLE {} (value text)").format(relation))
            self.admin.execute(sql.SQL("GRANT SELECT ON {} TO {}").format(relation, sql.Identifier(self.role)))
        create()
        self.addCleanup(self.admin.execute, sql.SQL("DROP TABLE {}").format(relation))
        self.admin.execute(sql.SQL("INSERT INTO {} VALUES (repeat('x',300000))").format(relation))
        old = self.inventory()[name]
        result = connector.preview(self.config, self.password, old, "raw", {"value"}, 5)
        self.assertEqual(result, {"columns":["value"], "rows":[], "truncated":True})
        self.admin.execute(sql.SQL("ALTER TABLE {} ADD COLUMN new_private_data text").format(relation))
        with self.assertRaises(connector.ConnectorError) as changed:
            connector.preview(self.config, self.password, old, "raw", {"value"}, 5)
        self.assertEqual(changed.exception.code, "object_changed")
        self.admin.execute(sql.SQL("DROP TABLE {}").format(relation))
        create()
        with self.assertRaises(connector.ConnectorError) as replaced:
            connector.preview(self.config, self.password, old, "masked", set(), 5)
        self.assertEqual(replaced.exception.code, "object_changed")

    def test_revoked_privilege_and_disabled_raw_fields(self):
        asset = self.inventory()[self.name]
        with self.assertRaises(connector.ConnectorError) as policy:
            connector.preview(self.config, self.password, asset, "raw", {"file_bytes"}, 5)
        self.assertEqual(policy.exception.code, "preview_columns_denied")
        role = sql.Identifier(self.role)
        self.admin.execute(sql.SQL("REVOKE SELECT ON {} FROM {}").format(self.relation, role))
        try:
            self.assertNotIn(self.name, self.inventory())
            with self.assertRaises(connector.ConnectorError) as permission:
                connector.preview(self.config, self.password, asset, "masked", set(), 1)
            self.assertEqual(permission.exception.code, "access_denied")
        finally:
            self.admin.execute(sql.SQL("GRANT SELECT ON {} TO {}").format(self.relation, role))

    def test_partition_ancestors_row_security(self):
        assets = self.inventory()
        root, leaf = [sql.Identifier(self.extra, n) for n in ("root", "leaf")]
        self.admin.execute(sql.SQL("ALTER TABLE {} ENABLE ROW LEVEL SECURITY").format(root))
        self.addCleanup(self.admin.execute, sql.SQL("ALTER TABLE {} DISABLE ROW LEVEL SECURITY").format(root))
        self.admin.execute(sql.SQL("CREATE POLICY visible ON {} FOR SELECT USING (id < 7)").format(root))
        self.addCleanup(self.admin.execute, sql.SQL("DROP POLICY visible ON {}").format(root))

        def check_direct_read():
            with self.assertRaises(connector.ConnectorError) as err:
                connector.preview(self.config, self.password, assets["leaf"], "masked", set(), 5)
            self.assertEqual(err.exception.code, "preview_not_supported")

        check_direct_read()
        self.admin.execute(sql.SQL("ALTER TABLE {} ENABLE ROW LEVEL SECURITY").format(leaf))
        self.addCleanup(self.admin.execute, sql.SQL("ALTER TABLE {} DISABLE ROW LEVEL SECURITY").format(leaf))
        self.admin.execute(sql.SQL("CREATE POLICY visible ON {} FOR SELECT USING (true)").format(leaf))
        self.addCleanup(self.admin.execute, sql.SQL("DROP POLICY visible ON {}").format(leaf))
        check_direct_read()
        sample = connector.preview(self.config, self.password, assets["root"], "raw", {"id"}, 5)
        self.assertEqual(sample["rows"], [])

    def test_relation_stays_locked_until_preview_finishes(self):
        asset = self.inventory()[self.name]
        build = connector._sample_query

        def attempt_concurrent_change(current, reveal):
            with self.admin.transaction():
                self.admin.execute("SET LOCAL lock_timeout = '100ms'")
                with self.assertRaises(psycopg.errors.LockNotAvailable), self.admin.transaction():
                    self.admin.execute(sql.SQL("ALTER TABLE {} ADD COLUMN new_field text").format(self.relation))
            return build(current, reveal)

        with patch.object(connector, "_sample_query", side_effect=attempt_concurrent_change):
            result = connector.preview(self.config, self.password, asset, "masked", set(), 1)
        self.assertEqual(len(result["rows"]), 1)


if __name__ == "__main__":
    unittest.main()
