"""Data store — Postgres (Neon) with SQLite fallback for local dev.

When DATABASE_URL is set (and starts with postgres://), uses psycopg2.
Otherwise falls back to SQLite in /tmp for local development.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

DATABASE_URL = os.environ.get("DATABASE_URL", "")
USE_POSTGRES = DATABASE_URL.startswith("postgres://") or DATABASE_URL.startswith("postgresql://")

# Parse the Postgres URL into components for pg8000
_pg_host = _pg_db = _pg_user = _pg_pw = ""
if USE_POSTGRES:
    from urllib.parse import urlparse, unquote
    parsed = urlparse(DATABASE_URL)
    _pg_host = parsed.hostname or ""
    _pg_port = parsed.port or 5432
    _pg_db = parsed.path.lstrip("/") or "neondb"
    _pg_user = unquote(parsed.username or "")
    _pg_pw = unquote(parsed.password or "")

DB_PATH = DATABASE_URL
if not USE_POSTGRES:
    if not DB_PATH:
        if os.path.exists("/tmp"):
            DB_PATH = "/tmp/autonomous_revops.db"
        else:
            DB_PATH = str(Path(__file__).parent / "data" / "autonomous_revops.db")

_lock = threading.Lock()
_initialized = False
_pg_pool = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class PgConnWrapper:
    """Wraps a pg8000 connection to mimic sqlite3's conn.execute() interface.

    sqlite3 lets you call conn.execute() directly and returns rows.
    pg8000 requires a cursor. This wrapper bridges that gap.
    Also sets search_path to 'revops' schema to avoid collisions with
    the consent platform tables in the 'public' schema.
    """

    def __init__(self, conn):
        self._conn = conn
        # Set search_path to revops schema first, then public as fallback
        cur = conn.cursor()
        cur.execute("SET search_path TO revops, public")
        conn.commit()

    def execute(self, sql, params=None):
        cur = self._conn.cursor()
        if params:
            cur.execute(_ph(sql), params)
        else:
            cur.execute(_ph(sql))
        return PgCursorWrapper(cur)

    def commit(self):
        self._conn.commit()

    def close(self):
        self._conn.close()

    @property
    def row_factory(self):
        return None

    @row_factory.setter
    def row_factory(self, value):
        pass


class PgCursorWrapper:
    """Wraps a pg8000 cursor so fetchone/fetchall return dict-like rows.

    pg8000 returns tuples from fetchone/fetchall. We convert them to dicts
    using the column names from cursor.description.
    """

    def __init__(self, cur):
        self._cur = cur
        self._cols = None

    def _get_cols(self):
        if self._cols is None and self._cur.description:
            self._cols = [d[0] for d in self._cur.description]
        return self._cols

    def _to_dict(self, row):
        if row is None:
            return None
        cols = self._get_cols()
        if cols and isinstance(row, (tuple, list)):
            return dict(zip(cols, row))
        return row

    def fetchone(self):
        return self._to_dict(self._cur.fetchone())

    def fetchall(self):
        return [self._to_dict(r) for r in self._cur.fetchall()]

    def fetchmany(self, size=None):
        rows = self._cur.fetchmany(size) if size else self._cur.fetchmany()
        return [self._to_dict(r) for r in rows]

    @property
    def description(self):
        return self._cur.description

    @property
    def rowcount(self):
        return self._cur.rowcount


def _get_conn():
    global _initialized, _pg_pool
    if USE_POSTGRES:
        import pg8000
        conn = pg8000.connect(
            host=_pg_host,
            database=_pg_db,
            user=_pg_user,
            password=_pg_pw,
            ssl_context=True,
            timeout=30,
        )
        wrapped = PgConnWrapper(conn)
        if not _initialized:
            _init_db_pg(wrapped)
            _initialized = True
        return wrapped
    else:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        if not _initialized:
            _init_db(conn)
            _initialized = True
        return conn


def _ph(query: str) -> str:
    """Convert SQLite-style ? placeholders to Postgres %s."""
    if USE_POSTGRES:
        return query.replace("?", "%s")
    return query


def _scalar(row):
    """Get a scalar value from a fetchone() result (works with both sqlite3.Row and RealDictRow)."""
    if row is None:
        return 0
    if isinstance(row, dict):
        return list(row.values())[0]
    try:
        return row[0]
    except (IndexError, KeyError):
        return list(row.values())[0]


def _exec(conn, sql: str, params: tuple = None):
    """Execute a query with automatic placeholder conversion."""
    if params:
        return conn.execute(_ph(sql), params)
    return conn.execute(_ph(sql))



def _init_db(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS telemetry (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        visitor_id TEXT DEFAULT '',
        session_id TEXT DEFAULT '',
        value REAL DEFAULT 0,
        data_semantic TEXT DEFAULT 'LIVE',
        metadata TEXT DEFAULT '{}',
        timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS visitors (
        id TEXT PRIMARY KEY,
        visitor_id TEXT UNIQUE NOT NULL,
        ip TEXT DEFAULT '',
        geo TEXT DEFAULT '',
        first_seen TEXT,
        last_seen TEXT,
        visit_count INTEGER DEFAULT 1,
        engagement_score REAL DEFAULT 0,
        lifecycle_stage TEXT DEFAULT 'new',
        inferred_intent TEXT DEFAULT 'unknown',
        last_message TEXT DEFAULT '',
        message_count INTEGER DEFAULT 0,
        converted INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS experiments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'bio',
        status TEXT DEFAULT 'running',
        variants TEXT DEFAULT '[]',
        winner_id TEXT DEFAULT '',
        reward_metric TEXT DEFAULT 'ctr',
        confidence REAL DEFAULT 0,
        observations INTEGER DEFAULT 0,
        created_at TEXT,
        ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS variants (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL,
        label TEXT NOT NULL,
        content TEXT DEFAULT '',
        reward REAL DEFAULT 0,
        impressions INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        contacts INTEGER DEFAULT 0,
        conversions INTEGER DEFAULT 0,
        status TEXT DEFAULT 'candidate',
        url TEXT DEFAULT '',
        created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS content_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT DEFAULT '',
        body TEXT DEFAULT '',
        status TEXT DEFAULT 'generated',
        experiment_id TEXT DEFAULT '',
        performance_score REAL DEFAULT 0,
        metadata TEXT DEFAULT '{}',
        created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        experiment_id TEXT DEFAULT '',
        variant_id TEXT DEFAULT '',
        action_type TEXT NOT NULL,
        rationale TEXT DEFAULT '',
        confidence REAL DEFAULT 0,
        mode TEXT DEFAULT 'OBSERVE',
        status TEXT DEFAULT 'pending',
        receipt TEXT DEFAULT '{}',
        created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL,
        input_observation TEXT DEFAULT '',
        source TEXT DEFAULT '',
        model TEXT DEFAULT '',
        decision TEXT DEFAULT '',
        action TEXT DEFAULT '',
        result TEXT DEFAULT '',
        reward REAL DEFAULT 0,
        receipt_json TEXT DEFAULT '{}',
        created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS kpi_snapshots (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        impressions INTEGER DEFAULT 0,
        visitors INTEGER DEFAULT 0,
        repeat_visitors INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        contacts INTEGER DEFAULT 0,
        bookings INTEGER DEFAULT 0,
        revenue REAL DEFAULT 0,
        ctr REAL DEFAULT 0,
        conversion_rate REAL DEFAULT 0,
        created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        target TEXT DEFAULT '',
        payload TEXT DEFAULT '{}',
        mode TEXT DEFAULT 'OBSERVE',
        status TEXT DEFAULT 'pending',
        scheduled_at TEXT,
        executed_at TEXT,
        result TEXT DEFAULT '',
        created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS control_state (
        key TEXT PRIMARY KEY,
        value TEXT
    );

    CREATE TABLE IF NOT EXISTS live_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        message TEXT DEFAULT '',
        severity TEXT DEFAULT 'info',
        timestamp TEXT
    );
    """)


def _init_db_pg(conn) -> None:
    """Initialize schema for Postgres in the 'revops' schema."""
    # Create the revops schema first
    conn.execute("CREATE SCHEMA IF NOT EXISTS revops")

    schema_sql = """
    CREATE TABLE IF NOT EXISTS revops.telemetry (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        visitor_id TEXT DEFAULT '',
        session_id TEXT DEFAULT '',
        value REAL DEFAULT 0,
        data_semantic TEXT DEFAULT 'LIVE',
        metadata TEXT DEFAULT '{}',
        timestamp TEXT
    );
    CREATE TABLE IF NOT EXISTS revops.visitors (
        id TEXT PRIMARY KEY,
        visitor_id TEXT UNIQUE NOT NULL,
        ip TEXT DEFAULT '',
        geo TEXT DEFAULT '',
        first_seen TEXT,
        last_seen TEXT,
        visit_count INTEGER DEFAULT 1,
        engagement_score REAL DEFAULT 0,
        lifecycle_stage TEXT DEFAULT 'new',
        inferred_intent TEXT DEFAULT 'unknown',
        last_message TEXT DEFAULT '',
        message_count INTEGER DEFAULT 0,
        converted INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS revops.experiments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'bio',
        status TEXT DEFAULT 'running',
        variants TEXT DEFAULT '[]',
        winner_id TEXT DEFAULT '',
        reward_metric TEXT DEFAULT 'ctr',
        confidence REAL DEFAULT 0,
        observations INTEGER DEFAULT 0,
        created_at TEXT,
        ended_at TEXT
    );
    CREATE TABLE IF NOT EXISTS revops.variants (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL,
        label TEXT NOT NULL,
        content TEXT DEFAULT '',
        reward REAL DEFAULT 0,
        impressions INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        contacts INTEGER DEFAULT 0,
        conversions INTEGER DEFAULT 0,
        status TEXT DEFAULT 'candidate',
        url TEXT DEFAULT '',
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS revops.content_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT DEFAULT '',
        body TEXT DEFAULT '',
        status TEXT DEFAULT 'generated',
        experiment_id TEXT DEFAULT '',
        performance_score REAL DEFAULT 0,
        metadata TEXT DEFAULT '{}',
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS revops.decisions (
        id TEXT PRIMARY KEY,
        experiment_id TEXT DEFAULT '',
        variant_id TEXT DEFAULT '',
        action_type TEXT NOT NULL,
        rationale TEXT DEFAULT '',
        confidence REAL DEFAULT 0,
        mode TEXT DEFAULT 'OBSERVE',
        status TEXT DEFAULT 'pending',
        receipt TEXT DEFAULT '{}',
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS revops.receipts (
        id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL,
        input_observation TEXT DEFAULT '',
        source TEXT DEFAULT '',
        model TEXT DEFAULT '',
        decision TEXT DEFAULT '',
        action TEXT DEFAULT '',
        result TEXT DEFAULT '',
        reward REAL DEFAULT 0,
        receipt_json TEXT DEFAULT '{}',
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS revops.kpi_snapshots (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        impressions INTEGER DEFAULT 0,
        visitors INTEGER DEFAULT 0,
        repeat_visitors INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        contacts INTEGER DEFAULT 0,
        bookings INTEGER DEFAULT 0,
        revenue REAL DEFAULT 0,
        ctr REAL DEFAULT 0,
        conversion_rate REAL DEFAULT 0,
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS revops.actions (
        id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        target TEXT DEFAULT '',
        payload TEXT DEFAULT '{}',
        mode TEXT DEFAULT 'OBSERVE',
        status TEXT DEFAULT 'pending',
        scheduled_at TEXT,
        executed_at TEXT,
        result TEXT DEFAULT '',
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS revops.control_state (
        key TEXT PRIMARY KEY,
        value TEXT
    );
    CREATE TABLE IF NOT EXISTS revops.live_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        message TEXT DEFAULT '',
        severity TEXT DEFAULT 'info',
        timestamp TEXT
    );
    """
    for stmt in schema_sql.strip().split(';'):
        stmt = stmt.strip()
        if stmt:
            conn.execute(stmt)
    conn.commit()


# ─── Telemetry ───────────────────────────────────────────────────

def log_telemetry(event_type: str, visitor_id: str = "", value: float = 0,
                  data_semantic: str = "LIVE", metadata: dict = None) -> dict:
    with _lock:
        conn = _get_conn()
        tid = str(uuid4())
        conn.execute(
            "INSERT INTO telemetry (id, event_type, visitor_id, value, data_semantic, metadata, timestamp) VALUES (?,?,?,?,?,?,?)",
            (tid, event_type, visitor_id, value, data_semantic, json.dumps(metadata or {}), utc_now())
        )
        conn.commit()
        return {"id": tid, "event_type": event_type, "timestamp": utc_now()}


def get_telemetry(limit: int = 50, event_type: str = "") -> list[dict]:
    conn = _get_conn()
    if event_type:
        rows = _exec(conn, "SELECT * FROM telemetry WHERE event_type=? ORDER BY timestamp DESC LIMIT ?", (event_type, limit)).fetchall()
    else:
        rows = _exec(conn, "SELECT * FROM telemetry ORDER BY timestamp DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


def get_telemetry_stats() -> dict:
    conn = _get_conn()
    total = _scalar(conn.execute("SELECT COUNT(*) as count FROM telemetry").fetchone())
    by_type = {}
    rows = conn.execute("SELECT event_type, COUNT(*) as c FROM telemetry GROUP BY event_type ORDER BY c DESC").fetchall()
    for r in rows:
        by_type[r["event_type"]] = r["c"]
    semantics = {}
    rows = conn.execute("SELECT data_semantic, COUNT(*) as c FROM telemetry GROUP BY data_semantic").fetchall()
    for r in rows:
        semantics[r["data_semantic"]] = r["c"]
    return {"total_events": total, "by_type": by_type, "by_semantic": semantics}


# ─── Visitors / CRM ──────────────────────────────────────────────

def upsert_visitor(visitor_id: str, ip: str = "", geo: str = "") -> dict:
    with _lock:
        conn = _get_conn()
        now = utc_now()
        row = _exec(conn, "SELECT * FROM visitors WHERE visitor_id=?", (visitor_id,)).fetchone()
        if row:
            conn.execute(
                "UPDATE visitors SET last_seen=?, visit_count=visit_count+1, ip=COALESCE(NULLIF(?, ''), ip) WHERE visitor_id=?",
                (now, ip, visitor_id)
            )
            conn.commit()
            row = _exec(conn, "SELECT * FROM visitors WHERE visitor_id=?", (visitor_id,)).fetchone()
            return dict(row)
        vid = str(uuid4())
        conn.execute(
            "INSERT INTO visitors (id, visitor_id, ip, geo, first_seen, last_seen) VALUES (?,?,?,?,?,?)",
            (vid, visitor_id, ip, geo, now, now)
        )
        conn.commit()
        row = _exec(conn, "SELECT * FROM visitors WHERE visitor_id=?", (visitor_id,)).fetchone()
        return dict(row)


def update_visitor(visitor_id: str, data: dict) -> Optional[dict]:
    with _lock:
        conn = _get_conn()
        fields = []
        values = []
        for k in ["engagement_score", "lifecycle_stage", "inferred_intent", "last_message", "message_count", "converted"]:
            if k in data:
                fields.append(f"{k} = ?")
                values.append(data[k])
        if fields:
            values.append(visitor_id)
            _exec(conn, f"UPDATE visitors SET {', '.join(fields)} WHERE visitor_id=?", values)
            conn.commit()
        row = _exec(conn, "SELECT * FROM visitors WHERE visitor_id=?", (visitor_id,)).fetchone()
        return dict(row) if row else None


def list_visitors(limit: int = 50) -> list[dict]:
    conn = _get_conn()
    rows = _exec(conn, "SELECT * FROM visitors ORDER BY last_seen DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


def get_high_intent_visitors(limit: int = 20) -> list[dict]:
    conn = _get_conn()
    rows = _exec(conn, "SELECT * FROM visitors WHERE converted=0 ORDER BY engagement_score DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


# ─── Experiments ─────────────────────────────────────────────────

def create_experiment(name: str, type: str = "bio", variants: list = None) -> dict:
    with _lock:
        conn = _get_conn()
        eid = str(uuid4())
        now = utc_now()
        conn.execute(
            "INSERT INTO experiments (id, name, type, status, variants, created_at) VALUES (?,?,?,?,?,?)",
            (eid, name, type, "running", json.dumps(variants or []), now)
        )
        for v in (variants or []):
            vid = str(uuid4())
            conn.execute(
                "INSERT INTO variants (id, experiment_id, label, content, status, url, created_at) VALUES (?,?,?,?,?,?,?)",
                (vid, eid, v.get("label", "Variant"), v.get("content", ""), v.get("status", "candidate"), v.get("url", ""), now)
            )
        conn.commit()
        return get_experiment(eid)


def get_experiment(eid: str) -> Optional[dict]:
    conn = _get_conn()
    row = _exec(conn, "SELECT * FROM experiments WHERE id=?", (eid,)).fetchone()
    if not row:
        return None
    variants = _exec(conn, "SELECT * FROM variants WHERE experiment_id=?", (eid,)).fetchall()
    return {**dict(row), "variants": [dict(v) for v in variants]}


def list_experiments(limit: int = 20) -> list[dict]:
    conn = _get_conn()
    rows = _exec(conn, "SELECT * FROM experiments ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    result = []
    for r in rows:
        exp = dict(r)
        variants = _exec(conn, "SELECT * FROM variants WHERE experiment_id=?", (r["id"],)).fetchall()
        exp["variants"] = [dict(v) for v in variants]
        result.append(exp)
    return result


def update_variant(vid: str, data: dict) -> None:
    with _lock:
        conn = _get_conn()
        fields = []
        values = []
        for k in ["reward", "impressions", "clicks", "contacts", "conversions", "status"]:
            if k in data:
                fields.append(f"{k} = ?")
                values.append(data[k])
        if fields:
            values.append(vid)
            _exec(conn, f"UPDATE variants SET {', '.join(fields)} WHERE id=?", values)
            conn.commit()


def complete_experiment(eid: str, winner_id: str, confidence: float) -> None:
    with _lock:
        conn = _get_conn()
        _exec(conn, "UPDATE experiments SET status='completed', winner_id=?, confidence=?, ended_at=? WHERE id=?",
                      (winner_id, confidence, utc_now(), eid))
        conn.commit()


def update_experiment(eid: str, data: dict) -> None:
    """Update arbitrary fields on an experiment."""
    allowed = {"name", "type", "status", "winner_id", "reward_metric", "confidence", "observations", "ended_at"}
    fields = {k: v for k, v in data.items() if k in allowed and v is not None}
    if not fields:
        return
    sets = ", ".join(f"{k}=?" for k in fields)
    with _lock:
        conn = _get_conn()
        _exec(conn, f"UPDATE experiments SET {sets} WHERE id=?", (*fields.values(), eid))
        conn.commit()


# ─── Content Factory ─────────────────────────────────────────────

def create_content(type: str, title: str, body: str, metadata: dict = None) -> dict:
    with _lock:
        conn = _get_conn()
        cid = str(uuid4())
        conn.execute(
            "INSERT INTO content_items (id, type, title, body, metadata, created_at) VALUES (?,?,?,?,?,?)",
            (cid, type, title, body, json.dumps(metadata or {}), utc_now())
        )
        conn.commit()
        return {"id": cid, "type": type, "title": title, "body": body, "created_at": utc_now()}


def list_content(type: str = "", limit: int = 50) -> list[dict]:
    conn = _get_conn()
    if type:
        rows = _exec(conn, "SELECT * FROM content_items WHERE type=? ORDER BY created_at DESC LIMIT ?", (type, limit)).fetchall()
    else:
        rows = _exec(conn, "SELECT * FROM content_items ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


# ─── Decisions & Receipts ────────────────────────────────────────

def create_decision(experiment_id: str, variant_id: str, action_type: str,
                    rationale: str, confidence: float, mode: str = "OBSERVE") -> dict:
    with _lock:
        conn = _get_conn()
        did = str(uuid4())
        conn.execute(
            "INSERT INTO decisions (id, experiment_id, variant_id, action_type, rationale, confidence, mode, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (did, experiment_id, variant_id, action_type, rationale, confidence, mode, "pending", utc_now())
        )
        conn.commit()
        return {"id": did, "action_type": action_type, "confidence": confidence, "mode": mode}


def approve_decision(did: str) -> None:
    with _lock:
        conn = _get_conn()
        _exec(conn, "UPDATE decisions SET status='approved' WHERE id=?", (did,))
        conn.commit()


def create_receipt(decision_id: str, input_obs: str, source: str, model: str,
                   decision: str, action: str, result: str, reward: float) -> dict:
    with _lock:
        conn = _get_conn()
        rid = str(uuid4())
        receipt = {"input": input_obs, "source": source, "model": model, "decision": decision,
                   "action": action, "result": result, "reward": reward, "timestamp": utc_now()}
        conn.execute(
            "INSERT INTO receipts (id, decision_id, input_observation, source, model, decision, action, result, reward, receipt_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (rid, decision_id, input_obs, source, model, decision, action, result, reward, json.dumps(receipt), utc_now())
        )
        conn.commit()
        return receipt


def list_decisions(limit: int = 30) -> list[dict]:
    conn = _get_conn()
    rows = _exec(conn, "SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


def list_receipts(limit: int = 30) -> list[dict]:
    conn = _get_conn()
    rows = _exec(conn, "SELECT * FROM receipts ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


# ─── KPI Snapshots ───────────────────────────────────────────────

def save_kpi_snapshot(data: dict) -> dict:
    with _lock:
        conn = _get_conn()
        kid = str(uuid4())
        now = utc_now()
        today = now[:10]
        ctr = (data.get("clicks", 0) / max(data.get("impressions", 1), 1)) * 100
        cvr = (data.get("bookings", 0) / max(data.get("visitors", 1), 1)) * 100
        conn.execute(
            "INSERT INTO kpi_snapshots (id, date, impressions, visitors, repeat_visitors, clicks, contacts, bookings, revenue, ctr, conversion_rate, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (kid, today, data.get("impressions", 0), data.get("visitors", 0), data.get("repeat_visitors", 0),
             data.get("clicks", 0), data.get("contacts", 0), data.get("bookings", 0), data.get("revenue", 0),
             round(ctr, 2), round(cvr, 2), now)
        )
        conn.commit()
        return {"id": kid, "date": today, "ctr": round(ctr, 2), "conversion_rate": round(cvr, 2)}


def get_kpi_history(limit: int = 30) -> list[dict]:
    conn = _get_conn()
    rows = _exec(conn, "SELECT * FROM kpi_snapshots ORDER BY date DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


def get_latest_kpi() -> dict:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM kpi_snapshots ORDER BY created_at DESC LIMIT 1").fetchone()
    if row:
        return dict(row)
    return {"impressions": 0, "visitors": 0, "repeat_visitors": 0, "clicks": 0, "contacts": 0, "bookings": 0, "revenue": 0, "ctr": 0, "conversion_rate": 0}


# ─── Control Plane ───────────────────────────────────────────────

def get_control_state(key: str) -> str:
    conn = _get_conn()
    row = _exec(conn, "SELECT value FROM control_state WHERE key=?", (key,)).fetchone()
    return row["value"] if row else ""


def set_control_state(key: str, value: str) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(_ph("INSERT OR REPLACE INTO control_state (key, value) VALUES (?,?)"), (key, value)) if not USE_POSTGRES else conn.execute("INSERT INTO control_state (key, value) VALUES (%s,%s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", (key, value))
        conn.commit()


def create_action(action_type: str, target: str, payload: dict, mode: str = "OBSERVE",
                  scheduled_at: str = "") -> dict:
    with _lock:
        conn = _get_conn()
        aid = str(uuid4())
        conn.execute(
            "INSERT INTO actions (id, action_type, target, payload, mode, status, scheduled_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (aid, action_type, target, json.dumps(payload), mode, "pending", scheduled_at, utc_now())
        )
        conn.commit()
        return {"id": aid, "action_type": action_type, "target": target, "mode": mode, "status": "pending"}


def list_actions(limit: int = 30) -> list[dict]:
    conn = _get_conn()
    rows = _exec(conn, "SELECT * FROM actions ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


def execute_action(aid: str, result: str = "") -> None:
    with _lock:
        conn = _get_conn()
        _exec(conn, "UPDATE actions SET status='executed', executed_at=?, result=? WHERE id=?", (utc_now(), result, aid))
        conn.commit()


# ─── Live Events ─────────────────────────────────────────────────

def log_live_event(event_type: str, message: str, severity: str = "info") -> dict:
    with _lock:
        conn = _get_conn()
        eid = str(uuid4())
        conn.execute(
            "INSERT INTO live_events (id, event_type, message, severity, timestamp) VALUES (?,?,?,?,?)",
            (eid, event_type, message, severity, utc_now())
        )
        conn.commit()
        return {"id": eid, "event_type": event_type, "message": message, "timestamp": utc_now()}


def list_live_events(limit: int = 50) -> list[dict]:
    conn = _get_conn()
    rows = _exec(conn, "SELECT * FROM live_events ORDER BY timestamp DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


# ─── Seed Data ───────────────────────────────────────────────────

def seed_data() -> None:
    conn = _get_conn()
    # Check for rev-ops specific data (telemetry events), not just any experiments row
    # (the consent platform shares the same DB and has its own experiments table)
    if _scalar(conn.execute("SELECT COUNT(*) as count FROM telemetry").fetchone()) > 0:
        return
    # Also check if we already have rev-ops visitors
    if _scalar(conn.execute("SELECT COUNT(*) as count FROM visitors WHERE visitor_id LIKE 'visitor_%'").fetchone()) > 0:
        return

    now = utc_now()

    # Seed experiment with variants
    exp = create_experiment("Bio Optimization Q3", "bio", [
        {"label": "Bio A", "content": "Professional massage therapist with 8 years experience. Specializing in deep tissue and Swedish techniques.", "status": "eliminated"},
        {"label": "Bio B", "content": "Award-winning massage therapist. 500+ satisfied clients. Same-day appointments available. Book now.", "status": "leader"},
        {"label": "Bio C", "content": "Certified massage therapist serving downtown. Relax, recover, rejuvenate. Online booking 24/7.", "status": "challenger"},
    ])
    eid = exp["id"]
    variants = exp["variants"]

    # Update variant metrics
    update_variant(variants[0]["id"], {"impressions": 420, "clicks": 12, "contacts": 2, "conversions": 0, "reward": -0.18, "status": "eliminated"})
    update_variant(variants[1]["id"], {"impressions": 380, "clicks": 34, "contacts": 11, "conversions": 4, "reward": 0.42, "status": "leader"})
    update_variant(variants[2]["id"], {"impressions": 350, "clicks": 22, "contacts": 6, "conversions": 1, "reward": 0.11, "status": "challenger"})

    # Update experiment confidence
    with _lock:
        _exec(conn, "UPDATE experiments SET observations=187, confidence=0.81 WHERE id=?", (eid,))
        conn.commit()

    # Seed KPI
    save_kpi_snapshot({
        "impressions": 1150, "visitors": 342, "repeat_visitors": 87,
        "clicks": 68, "contacts": 19, "bookings": 5, "revenue": 1250
    })

    # Seed visitors
    for i, (vid, score, stage) in enumerate([
        ("visitor_001", 0.85, "high_intent"),
        ("visitor_002", 0.72, "engaged"),
        ("visitor_003", 0.61, "engaged"),
        ("visitor_004", 0.45, "browsing"),
        ("visitor_005", 0.38, "new"),
        ("visitor_006", 0.29, "new"),
        ("visitor_007", 0.15, "bounced"),
    ]):
        upsert_visitor(vid, ip=f"192.168.1.{i+10}", geo=["NYC", "LA", "Miami", "Chicago", "Boston", "Seattle", "Austin"][i])
        update_visitor(vid, {"engagement_score": score, "lifecycle_stage": stage, "visit_count": [4, 3, 3, 2, 1, 1, 1][i]})

    # Seed content
    create_content("bio", "Bio B - Leader", "Award-winning massage therapist. 500+ satisfied clients. Same-day appointments available. Book now.")
    create_content("blog", "5 Benefits of Deep Tissue Massage", "Deep tissue massage offers numerous benefits including pain relief, stress reduction, improved blood pressure, injury rehabilitation, and scar tissue breakdown...")
    create_content("social", "Tuesday Special", "Book a 90-minute session this Tuesday and get 20% off! Limited slots available. #massage #wellness")
    create_content("seo", "massage therapist downtown", "Keywords: massage therapist downtown, deep tissue massage, swedish massage, sports massage, same-day appointment")
    create_content("email", "Follow-up Template", "Hi [Name], thanks for visiting my profile! I noticed you've been back a few times. I'd love to help you with your wellness goals...")

    # Seed decisions
    d1 = create_decision(eid, variants[1]["id"], "continue", "Bio B outperforming Bio A on repeat-visitor conversion. 187 observations. Confidence 81%.", 0.81, "AUTO")
    create_receipt(d1["id"], "187 observations across 3 variants", "telemetry_pipeline", "thompson_sampling_v2",
                   "Continue Bio B for another measurement window", "no_mutation", "Bio B remains live", 0.42)

    d2 = create_decision(eid, variants[0]["id"], "eliminate", "Bio A reward -0.18, lowest CTR across all variants. Insufficient conversion signal.", 0.92, "AUTO")
    create_receipt(d2["id"], "420 impressions, 12 clicks, 0 conversions", "experiment_ledger", "reward_calculator_v1",
                   "Eliminate Bio A from rotation", "variant_status=eliminated", "Bio A removed from production", -0.18)

    # Seed live events
    for msg, etype, sev in [
        ("Visitor returned (3rd visit this week)", "visitor_returned", "info"),
        ("Booking link clicked", "click", "info"),
        ("AI reward updated: Bio B +0.42", "reward_update", "info"),
        ("Experiment confidence increased to 81%", "confidence_update", "info"),
        ("Repeat visitor matched: visitor_001", "visitor_matched", "info"),
        ("Next experiment scheduled in 41 minutes", "experiment_scheduled", "info"),
        ("Bio A eliminated from rotation", "variant_eliminated", "warning"),
    ]:
        log_live_event(etype, msg, sev)

    # Seed control state
    set_control_state("mode", "AUTO")
    set_control_state("emergency_stop", "false")
    set_control_state("scheduler_active", "true")
    # Capability permissions
    set_control_state("cap_bio_mutation", "true")
    set_control_state("cap_messaging", "true")
    set_control_state("cap_visitor_engagement", "true")
    set_control_state("cap_photo_rotation", "false")
    set_control_state("cap_price_changes", "false")
    set_control_state("cap_content_generation", "true")
    set_control_state("cap_ai_optimization", "true")

    # Seed telemetry events
    for etype, vsrc, detail, semantic in [
        ("visitor_sighting", "engagement_engine", "visitor_001 visited profile (4th visit)", "LIVE"),
        ("visitor_sighting", "engagement_engine", "visitor_002 visited profile (3rd visit)", "LIVE"),
        ("message_sent", "engagement_engine", "Sent to visitor_003 (trigger: 3 visits, threshold=3)", "LIVE"),
        ("profile_visit", "engagement_engine", "Visited visitor_001 profile (reciprocal)", "LIVE"),
        ("rl_feedback", "pipeline_24_7", "Reward=0.42, bio=Bio B, no rotation (age=1d, threshold=3d)", "LIVE"),
        ("kpi_snapshot", "pipeline_24_7", "Views=1150, Visitors=342, Clicks=68, Messages=19", "LIVE"),
        ("availability_check", "pipeline_24_7", "Availability confirmed: active", "LIVE"),
        ("scrape_blocked", "engagement_engine", "CrowdSec rate limit — visitor scrape returned NO_OBSERVATION", "NO_DATA"),
        ("ga_optimization", "pipeline_24_7", "Generation 5 complete, best_fitness=0.71, best_revenue=$1250", "LIVE"),
        ("bio_generated", "content_generator", "Generated 3 bios via LLM (Bio A, Bio B, Bio C)", "LIVE"),
        ("visitor_returned", "engagement_engine", "visitor_001 returned (3rd visit this week)", "LIVE"),
        ("click", "engagement_engine", "Booking link clicked by visitor_002", "LIVE"),
        ("reward_update", "pipeline_24_7", "AI reward updated: Bio B +0.42", "LIVE"),
        ("confidence_update", "pipeline_24_7", "Experiment confidence increased to 81%", "LIVE"),
        ("visitor_matched", "engagement_engine", "Repeat visitor matched: visitor_001", "LIVE"),
    ]:
        log_telemetry(etype, visitor_id=detail.split()[0] if "visitor_" in detail else "",
                      value=0, data_semantic=semantic,
                      metadata={"source": vsrc, "detail": detail})
