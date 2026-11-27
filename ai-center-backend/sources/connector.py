"""Read-only PostgreSQL source access. No connection or sample data is cached."""

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from contextlib import contextmanager
import ipaddress
import json
import os
import socket
from threading import BoundedSemaphore

import psycopg
from psycopg import sql
from psycopg.rows import dict_row


MAX_BYTES = 256 * 1024
MAX_ROWS = 50
MAX_CATALOG_ROWS = 100_000
TEST_DEADLINE = 10
MASK = "[REDACTED]"
_connections = BoundedSemaphore(8)
_dns_slots = BoundedSemaphore(4)
_dns_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="source-dns")
_test_slots = BoundedSemaphore(4)
_test_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="source-test")
# Built-in scalar types with bounded, predictable JSON representations. Numeric
# is rendered as text to keep its full precision across JSON clients.
_safe_types = {16, 20, 21, 23, 25, 26, 700, 701, 1042, 1043, 1082, 1083,
               1114, 1184, 1266, 1700, 2950}
_text_types = {25, 1042, 1043}


class ConnectorError(Exception):
    """Only the public code/message can leave the connector."""

    def __init__(self, code, message=None):
        self.code = code
        super().__init__(message or code)


def _csv(name, default):
    return {item.strip().lower() for item in os.getenv(name, default).split(",") if item.strip()}


def _addresses(host, port):
    try:
        return [ipaddress.ip_address(host)]
    except ValueError:
        pass
    if not _dns_slots.acquire(blocking=False):
        raise ConnectorError("unavailable")
    future = _dns_pool.submit(socket.getaddrinfo, host, port, 0, socket.SOCK_STREAM)
    future.add_done_callback(lambda _: _dns_slots.release())
    try:
        answers = future.result(timeout=2)
        return sorted({ipaddress.ip_address(answer[4][0]) for answer in answers},
                      key=lambda ip: (ip.version, int(ip)))
    except FutureTimeout:
        raise ConnectorError("timeout") from None
    except (ValueError, OSError, UnicodeError):
        raise ConnectorError("unavailable") from None


def _identifier(value):
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ConnectorError("invalid_config")
    try:
        size = len(value.encode("utf-8"))
    except UnicodeEncodeError:
        raise ConnectorError("invalid_config") from None
    if size > 63:
        raise ConnectorError("invalid_config")
    return value


def _schemas(config):
    schemas = config.get("schemas", [config.get("schema", "public")])
    if not isinstance(schemas, list) or not 1 <= len(schemas) <= 100:
        raise ConnectorError("invalid_config")
    return list(dict.fromkeys(_identifier(name) for name in schemas))


def _parameters(config, password, timeout_ms):
    host = str(config.get("host", "")).strip().lower()
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    try:
        port = int(config.get("port", 5432))
        ports = {int(p) for p in _csv("SOURCES_ALLOWED_PORTS", "5432")}
        networks = [ipaddress.ip_network(n) for n in _csv("SOURCES_ALLOWED_NETWORKS", "127.0.0.0/8,::1/128")]
    except (ValueError, TypeError):
        raise ConnectorError("invalid_config") from None
    user = _identifier(config.get("username"))
    database = _identifier(config.get("database"))
    if not isinstance(password, str) or not password or "\x00" in password:
        raise ConnectorError("credential_required")
    if not 1 <= port <= 65535 or any(c in database for c in "=\x00") or "://" in database:
        raise ConnectorError("invalid_config")
    if host not in _csv("SOURCES_ALLOWED_HOSTS", "localhost,127.0.0.1,::1") or port not in ports:
        raise ConnectorError("target_denied")
    addresses = _addresses(host, port)
    if not addresses or not all(any(ip in net for net in networks) for ip in addresses):
        raise ConnectorError("target_denied")
    profile = config.get("tls_profile", "workspace-default")
    if profile not in {"workspace-default", "local-development"}:
        raise ConnectorError("invalid_config")
    sslmode = config.get("ssl_mode") or ("disable" if profile == "local-development" else "verify-full")
    tls = {}
    if sslmode == "disable":
        local_allowed = os.getenv("SOURCES_ALLOW_INSECURE_LOOPBACK", "").lower() in {"1", "true"}
        if (config.get("tls_profile") == "workspace-default" or not local_allowed
                or not all(ip.is_loopback for ip in addresses)):
            raise ConnectorError("target_denied")
    elif sslmode == "verify-full":
        if root_cert := os.getenv("SOURCES_SSLROOTCERT"):
            tls["sslrootcert"] = root_cert
    else:
        raise ConnectorError("target_denied")
    # Pin the address already checked, retaining the requested hostname for TLS.
    return dict(host=host, hostaddr=str(addresses[0]), port=port, dbname=database, user=user,
                password=password, sslmode=sslmode, gssencmode="disable", client_encoding="UTF8",
                require_auth="scram-sha-256,md5,password", connect_timeout=4,
                application_name="sources-reader",
                options=("-c search_path=pg_catalog -c default_transaction_read_only=on "
                         f"-c statement_timeout={timeout_ms} -c lock_timeout=2000 "
                         "-c idle_in_transaction_session_timeout=10000 -c row_security=on"),
                **tls)


def _public_error(exc):
    state = exc.sqlstate or ""
    if state.startswith("28"):
        return "authentication_failed"
    if state == "42501":
        return "access_denied"
    if state in {"57014", "55P03"}:
        return "timeout"
    if state in {"42P01", "42703", "42809", "3F000"}:
        return "object_changed"
    # libpq frequently has no SQLSTATE for failures during authentication.
    diagnostic = str(exc).lower()
    if any(s in diagnostic for s in ("password authentication failed", "no password supplied",
                                     "authentication method", "no pg_hba.conf entry")):
        return "authentication_failed"
    if "timeout" in diagnostic or "timed out" in diagnostic:
        return "timeout"
    return "unavailable"


@contextmanager
def _session(config, password, *, discovery=False):
    if not _connections.acquire(blocking=False):
        raise ConnectorError("unavailable")
    try:
        parameters = _parameters(config, password, 5000 if discovery else 3000)
        with psycopg.connect(**parameters, row_factory=dict_row) as conn, conn.cursor() as cur:
            isolation = "REPEATABLE READ" if discovery else "READ COMMITTED"
            cur.execute(sql.SQL("SET TRANSACTION ISOLATION LEVEL {} READ ONLY").format(sql.SQL(isolation)))
            cur.execute("SELECT current_database() AS db, current_user AS usr, rolsuper, rolbypassrls "
                        "FROM pg_catalog.pg_roles WHERE rolname = current_user")
            identity = cur.fetchone()
            if not identity or (identity["db"], identity["usr"]) != (parameters["dbname"], parameters["user"]):
                raise ConnectorError("authentication_failed")
            if identity["rolsuper"] or identity["rolbypassrls"]:
                raise ConnectorError("access_denied", "Use a source account subject to row-level security.")
            yield cur
    except psycopg.Error as exc:
        raise ConnectorError(_public_error(exc)) from None
    finally:
        _connections.release()


def _check_schemas(cur, schemas):
    cur.execute("SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname = ANY(%s) "
                "AND has_schema_privilege(oid,'USAGE')", (schemas,))
    if {row["nspname"] for row in cur.fetchall()} != set(schemas):
        raise ConnectorError("schema_denied")


def _test_schemas(config, password, schemas):
    with _session(config, password) as cur:
        _check_schemas(cur, schemas)


def test_connection(config: dict, password: str) -> None:
    schemas = _schemas(config)
    if not _test_slots.acquire(blocking=False):
        raise ConnectorError("unavailable")
    # Enforce one end-to-end response deadline, even for an unresponsive network.
    # Keep a timed-out attempt in its slot until its I/O has actually finished.
    future = _test_pool.submit(_test_schemas, config, password, schemas)
    future.add_done_callback(lambda _: _test_slots.release())
    try:
        future.result(timeout=TEST_DEADLINE)
    except FutureTimeout:
        raise ConnectorError("timeout") from None


_catalog = """
    SELECT n.nspname AS schema, c.relname AS name, c.oid, CASE
        WHEN c.relkind = 'v' THEN 'view' WHEN c.relkind = 'p' THEN 'partitioned_table'
        WHEN c.relispartition THEN 'partition' ELSE 'table' END AS kind,
        a.attname, a.attnum, a.atttypid, a.atttypmod, a.attnotnull, a.attgenerated,
        CASE WHEN a.attnum IS NULL THEN NULL WHEN t.typnamespace = 'pg_catalog'::regnamespace
             THEN format_type(a.atttypid, a.atttypmod)
             ELSE format('%%I.%%I', tn.nspname, t.typname) END AS type
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
    WHERE n.nspname = ANY(%s) AND c.relkind IN ('r','p','v')
    AND has_table_privilege(c.oid,'SELECT')
"""


def _inspect(cur, schemas, name=None):
    query = _catalog
    args = [schemas]
    if name is not None:
        query += " AND c.relname = %s"
        args.append(name)
    cur.execute(query + " ORDER BY n.nspname, c.relname, a.attnum LIMIT %s", (*args, MAX_CATALOG_ROWS + 1))
    rows = cur.fetchall()
    if len(rows) > MAX_CATALOG_ROWS:
        raise ConnectorError("limit_exceeded")
    objects = {}
    for row in rows:
        entry = objects.get(row["oid"])
        if entry is None:
            entry = {key: row[key] for key in ("schema", "name", "oid", "kind")}
            entry["columns"] = []
            objects[row["oid"]] = entry
        if row["attnum"] is not None:
            entry["columns"].append(dict(name=row["attname"], type=row["type"], ordinal=row["attnum"],
                                         type_oid=row["atttypid"], typmod=row["atttypmod"],
                                         nullable=not row["attnotnull"], generated=row["attgenerated"]))
    return list(objects.values())


def discover(config: dict, password: str) -> list[dict]:
    schemas = _schemas(config)
    with _session(config, password, discovery=True) as cur:
        _check_schemas(cur, schemas)
        return _inspect(cur, schemas)


# Querying a child directly doesn't apply its ancestors' row policies. Even two
# tables with RLS enabled needn't have equivalent policies. Keep direct child
# reads unavailable in that case; reading the parent still uses native RLS.
_preview_guard = """
    WITH RECURSIVE target AS (
        SELECT c.oid, c.relkind, c.relrowsecurity FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.oid = %s AND n.nspname = %s AND c.relname = %s
    ), ancestors(oid) AS (
        SELECT i.inhparent FROM pg_catalog.pg_inherits i JOIN target t ON t.oid = i.inhrelid
        UNION SELECT i.inhparent FROM pg_catalog.pg_inherits i JOIN ancestors a ON a.oid = i.inhrelid
    )
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'object_changed'
        WHEN EXISTS (SELECT 1 FROM target WHERE relrowsecurity AND NOT row_security_active(oid))
            THEN 'access_denied'
        WHEN EXISTS (SELECT 1 FROM ancestors a JOIN pg_catalog.pg_class c ON c.oid = a.oid
                     WHERE c.relrowsecurity)
            THEN 'preview_not_supported'
        WHEN EXISTS (SELECT 1 FROM target t CROSS JOIN LATERAL pg_catalog.pg_partition_tree(t.oid) p
                     JOIN pg_catalog.pg_class c ON c.oid = p.relid
                     WHERE t.relkind = 'p' AND c.relkind NOT IN ('r','p'))
            THEN 'preview_not_supported'
    END AS error
"""


def _sample_query(asset, reveal):
    relation = sql.Identifier(asset["schema"], asset["name"])
    projected, field_sizes = [], []
    for col in asset["columns"]:
        identifier = sql.Identifier(col["name"])
        if col["name"] in reveal:
            value = sql.Identifier("src", col["name"])
            if col["type_oid"] in {20, 1700}:
                value = sql.SQL("{}::text").format(value)
            if col["type_oid"] in _text_types or col["type_oid"] == 1700:
                field_sizes.append(sql.SQL("octet_length({})").format(value))
        else:
            # Even when only checking row existence, original field values must never reach Python.
            value = sql.Literal(MASK)
        projected.append(sql.SQL("{} AS {}").format(value, identifier))
    size_guard = sql.SQL("false")
    if field_sizes:
        size_guard = sql.SQL("(SELECT sum(bytes) > {} FROM unnest(ARRAY[{}]) AS s(bytes))").format(
            sql.Literal(MAX_BYTES), sql.SQL(", ").join(field_sizes))
    # Native inheritance children are separate sources; a partitioned root uses its normal partition scan.
    from_relation = relation if asset["kind"] == "partitioned_table" else sql.SQL("ONLY {}").format(relation)
    return sql.SQL("""
        WITH guard AS MATERIALIZED ({}), sample AS MATERIALIZED (
            SELECT CASE WHEN {} THEN NULL ELSE
                (SELECT row_to_json(v.*)::text FROM (SELECT {}) AS v) END AS payload
            FROM {} AS src
            WHERE (SELECT error FROM guard) IS NULL
            LIMIT %s
        ), sized AS (
            SELECT payload, row_number() OVER () AS n FROM sample
        ), bounded AS (
            SELECT payload, n, sum(coalesce(octet_length(payload), %s)) OVER (ORDER BY n) AS total
            FROM sized
        ) SELECT CASE WHEN total <= %s THEN payload END AS payload, NULL AS error, n FROM bounded
          UNION ALL SELECT NULL, error, 0 FROM guard WHERE error IS NOT NULL ORDER BY n
    """).format(sql.SQL(_preview_guard), size_guard, sql.SQL(", ").join(projected), from_relation)


def preview(config: dict, password: str, asset: dict, mode: str, clear_columns: set[str], limit: int) -> dict:
    if mode not in {"masked", "raw"} or type(limit) is not int or not 1 <= limit <= MAX_ROWS:
        raise ConnectorError("invalid_config")
    schema, name = _identifier(asset.get("schema")), _identifier(asset.get("name"))
    if schema not in _schemas(config):
        raise ConnectorError("schema_denied")
    if asset.get("kind") not in {"table", "partition", "partitioned_table"}:
        raise ConnectorError("preview_not_supported")
    with _session(config, password) as cur:
        _check_schemas(cur, [schema])
        # Lock the current relation first, then look it up in a fresh READ COMMITTED snapshot.
        cur.execute(sql.SQL("LOCK TABLE ONLY {} IN ACCESS SHARE MODE").format(sql.Identifier(schema, name)))
        current = _inspect(cur, [schema], name)
        if not current or any(current[0][key] != asset.get(key) for key in ("oid","kind","columns")):
            raise ConnectorError("object_changed")
        identity = (asset["oid"], schema, name)
        cur.execute(_preview_guard, identity)
        if policy_error := cur.fetchone()["error"]:
            raise ConnectorError(policy_error)
        columns = current[0]["columns"]
        names = [col["name"] for col in columns]
        reveal = {col["name"] for col in columns if mode == "raw" and col["name"] in clear_columns
                  and col["type_oid"] in _safe_types and col["generated"] != "v"}
        if mode == "raw" and not reveal:
            raise ConnectorError("preview_columns_denied")
        result = {"columns": names, "rows": [], "truncated": False}
        budget = MAX_BYTES - len(json.dumps(result).encode()) - 1024
        if budget <= 0 or not columns:
            raise ConnectorError("limit_exceeded")
        cur.execute(_sample_query(current[0], reveal), (*identity, limit + 1, MAX_BYTES + 1, budget))
        for row in cur:
            if row["error"]:
                raise ConnectorError(row["error"])
            if row["payload"] is None or len(result["rows"]) == limit:
                result["truncated"] = True
                break
            item = json.loads(row["payload"])
            cost = len(json.dumps(item).encode()) + 2
            if cost > budget:
                result["truncated"] = True
                break
            result["rows"].append(item)
            budget -= cost
        return result
