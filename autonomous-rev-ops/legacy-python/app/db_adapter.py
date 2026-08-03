"""Database adapter — PostgreSQL for production, SQLite for local dev.

Detects DATABASE_URL scheme:
  - postgres:// or postgresql:// → pg8000 (real Postgres backend)
  - file:// or plain path or empty → sqlite3 (local dev fallback)

Provides a unified connection interface with:
  - execute(sql, params) → cursor
  - executemany(sql, params) → cursor
  - fetchone(sql, params) → Row-like dict | None
  - fetchall(sql, params) → list[Row-like dict]
  - commit()
  - close()

Row objects support dict-style access (row["col"]) and key lookup.
Parameter markers are auto-translated: ? → %s for Postgres.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
from typing import Any, Optional
from urllib.parse import urlparse

_lock = threading.Lock()

_DB_URL = os.environ.get("DATABASE_URL", "").strip()
# Only use PostgreSQL if explicitly enabled AND not on Vercel serverless
# (Neon PostgreSQL free tier has cold start timeouts that make it unreliable
# for serverless functions. SQLite in /tmp is faster for serverless.)
_USE_POSTGRES = _DB_URL.startswith(("postgres://", "postgresql://")) and os.environ.get("USE_POSTGRES", "false").lower() == "true"

# Connection pool for Postgres (reuse across serverless invocations)
_pg_pool: list = []
_pg_pool_max = 3
_pg_reuse_conn: Any = None


def is_postgres() -> bool:
    return _USE_POSTGRES


def _translate_sql(sql: str) -> str:
    """Translate SQLite ? placeholders to Postgres %s and SQLite-specific syntax."""
    if not _USE_POSTGRES:
        return sql
    # Replace INSERT OR REPLACE INTO ... (cols) VALUES (...) with ON CONFLICT DO UPDATE
    sql = re.sub(
        r'INSERT OR REPLACE INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)',
        lambda m: _insert_or_replace_to_pg(m.group(1), m.group(2), m.group(3)),
        sql,
        flags=re.IGNORECASE,
    )
    # Replace INSERT OR IGNORE with INSERT ... ON CONFLICT DO NOTHING
    sql = re.sub(r'INSERT OR IGNORE INTO', 'INSERT INTO', sql, flags=re.IGNORECASE)
    # Replace ? with %s, but not inside string literals
    result = []
    in_string = False
    quote_char = ""
    i = 0
    while i < len(sql):
        ch = sql[i]
        if in_string:
            result.append(ch)
            if ch == quote_char:
                in_string = False
        elif ch in ("'", '"'):
            in_string = True
            quote_char = ch
            result.append(ch)
        elif ch == "?":
            result.append("%s")
        else:
            result.append(ch)
        i += 1
    return "".join(result)


def _insert_or_replace_to_pg(table: str, cols: str, vals: str) -> str:
    """Convert INSERT OR REPLACE to Postgres ON CONFLICT DO UPDATE."""
    col_list = [c.strip() for c in cols.split(",")]
    val_list = [v.strip() for v in vals.split(",")]
    # Use first column as conflict target (usually the primary key)
    conflict_col = col_list[0]
    # Build SET clause for all columns except the conflict column
    set_clauses = []
    for c in col_list[1:]:
        set_clauses.append(f"{c} = EXCLUDED.{c}")
    set_clause = ", ".join(set_clauses) if set_clauses else f"{conflict_col} = EXCLUDED.{conflict_col}"
    return f"INSERT INTO {table} ({', '.join(col_list)}) VALUES ({', '.join(val_list)}) ON CONFLICT ({conflict_col}) DO UPDATE SET {set_clause}"


class _PgRow:
    """Dict-like row wrapper for pg8000 results. Supports both string and integer indexing like sqlite3.Row."""

    def __init__(self, columns: list[str], values: tuple):
        self._data = dict(zip(columns, values))
        self._columns = columns
        self._values = values

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return self._data[key]

    def get(self, key: str, default=None):
        return self._data.get(key, default)

    def keys(self):
        return self._data.keys()

    def values(self):
        return self._data.values()

    def items(self):
        return self._data.items()

    def __iter__(self):
        return iter(self._data)

    def __contains__(self, key):
        return key in self._data

    def __repr__(self):
        return repr(self._data)


class Connection:
    """Unified connection wrapper for both SQLite and PostgreSQL."""

    def __init__(self, raw_conn, is_pg: bool):
        self._conn = raw_conn
        self._is_pg = is_pg

    def execute(self, sql: str, params: tuple = ()) -> "Cursor":
        return Cursor(self._conn.cursor(), _translate_sql(sql), params, self._is_pg)

    def executemany(self, sql: str, params_list: list[tuple]) -> "Cursor":
        cur = self._conn.cursor()
        translated = _translate_sql(sql)
        if self._is_pg:
            cur.executemany(translated, params_list)
        else:
            cur.executemany(translated, params_list)
        return Cursor(cur, "", (), self._is_pg, _already_executed=True)

    def executescript(self, script: str) -> None:
        """Execute a multi-statement SQL script."""
        if self._is_pg:
            translated = _translate_sql(script)
            cur = self._conn.cursor()
            for stmt in _split_sql_statements(translated):
                stmt = stmt.strip()
                if stmt:
                    cur.execute(stmt)
            cur.close()
        else:
            self._conn.executescript(script)

    def commit(self):
        self._conn.commit()

    def close(self):
        if self._is_pg:
            try:
                self._conn.close()
            except Exception:
                pass
            _return_pg_conn(self._conn)
        else:
            self._conn.close()

    @property
    def row_factory(self):
        return None

    @row_factory.setter
    def row_factory(self, value):
        if not self._is_pg:
            self._conn.row_factory = value


class Cursor:
    """Unified cursor wrapper."""

    def __init__(self, cur, sql: str, params: tuple, is_pg: bool, _already_executed: bool = False):
        self._cur = cur
        self._is_pg = is_pg
        if not _already_executed:
            if is_pg:
                cur.execute(sql, params)
            else:
                cur.execute(sql, params)

    def fetchone(self) -> Optional[Any]:
        row = self._cur.fetchone()
        if row is None:
            return None
        if self._is_pg:
            cols = [d[0] for d in (self._cur.description or [])]
            return _PgRow(cols, tuple(row))
        return row  # sqlite3.Row already supports dict-style access

    def fetchall(self) -> list[Any]:
        rows = self._cur.fetchall()
        if self._is_pg:
            cols = [d[0] for d in (self._cur.description or [])]
            return [_PgRow(cols, tuple(r)) for r in rows]
        return rows

    @property
    def description(self):
        return self._cur.description

    @property
    def rowcount(self):
        return self._cur.rowcount

    def close(self):
        self._cur.close()


def _get_pg_conn():
    """Get a Postgres connection from pool or create new."""
    global _pg_pool
    with _lock:
        while _pg_pool:
            conn = _pg_pool.pop()
            try:
                conn.cursor().execute("SELECT 1")
                return conn
            except Exception:
                try:
                    conn.close()
                except Exception:
                    pass

    import pg8000

    parsed = urlparse(_DB_URL)
    user = parsed.username or ""
    password = parsed.password or ""
    host = parsed.hostname or "localhost"
    port = parsed.port or 5432
    database = parsed.path.lstrip("/")

    conn = pg8000.connect(
        user=user,
        password=password,
        host=host,
        port=port,
        database=database,
        ssl_context=True,
        timeout=30,
    )
    conn.autocommit = False
    return conn


def _return_pg_conn(conn):
    """Return a Postgres connection to the pool."""
    global _pg_pool
    with _lock:
        if len(_pg_pool) < _pg_pool_max:
            _pg_pool.append(conn)
        else:
            try:
                conn.close()
            except Exception:
                pass


def _get_sqlite_path() -> str:
    """Determine SQLite database file path."""
    raw = os.environ.get("DATABASE_URL", "").strip()
    if raw and not raw.startswith(("postgres://", "postgresql://")):
        if raw.startswith("file://"):
            return raw[7:]
        return raw
    # Auto-detect writable location
    for candidate in ["/tmp/autonomous_revops.db", str(os.path.dirname(__file__) + "/data/autonomous_revops.db")]:
        test_dir = os.path.dirname(candidate)
        if test_dir and not os.path.exists(test_dir):
            try:
                os.makedirs(test_dir, exist_ok=True)
            except (OSError, PermissionError):
                continue
        try:
            with open(candidate, "a"):
                pass
            return candidate
        except (OSError, PermissionError):
            continue
    return ":memory:"


_SQLITE_PATH = _get_sqlite_path()


def get_conn() -> Connection:
    """Get a database connection (PostgreSQL or SQLite)."""
    if _USE_POSTGRES:
        raw = _get_pg_conn()
        return Connection(raw, is_pg=True)
    else:
        conn = sqlite3.connect(_SQLITE_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return Connection(conn, is_pg=False)


def executescript(script: str) -> None:
    """Execute a multi-statement SQL script (for schema initialization)."""
    if _USE_POSTGRES:
        conn = _get_pg_conn()
        try:
            cur = conn.cursor()
            translated = _translate_sql(script)
            # pg8000 doesn't have executescript, split on semicolons
            statements = _split_sql_statements(translated)
            for stmt in statements:
                stmt = stmt.strip()
                if stmt:
                    cur.execute(stmt)
            conn.commit()
            cur.close()
        finally:
            _return_pg_conn(conn)
    else:
        conn = sqlite3.connect(_SQLITE_PATH, check_same_thread=False)
        conn.executescript(script)
        conn.commit()
        conn.close()


def _split_sql_statements(sql: str) -> list[str]:
    """Split SQL into individual statements, respecting string literals."""
    statements = []
    current = []
    in_string = False
    quote_char = ""
    i = 0
    while i < len(sql):
        ch = sql[i]
        if in_string:
            current.append(ch)
            if ch == quote_char:
                in_string = False
        elif ch in ("'", '"'):
            in_string = True
            quote_char = ch
            current.append(ch)
        elif ch == ";":
            stmt = "".join(current).strip()
            if stmt:
                statements.append(stmt)
            current = []
        else:
            current.append(ch)
        i += 1
    last = "".join(current).strip()
    if last:
        statements.append(last)
    return statements
