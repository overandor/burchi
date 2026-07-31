"""Data store — SQLite with in-memory fallback for serverless."""

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

# Use /tmp on Vercel, local dir otherwise
DB_PATH = os.environ.get("DATABASE_URL", "")
if not DB_PATH:
    if os.path.exists("/tmp"):
        DB_PATH = "/tmp/torrent_gguf.db"
    else:
        DB_PATH = str(Path(__file__).parent / "data" / "torrent_gguf.db")

_lock = threading.Lock()
_initialized = False


def _get_conn() -> sqlite3.Connection:
    global _initialized
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    if not _initialized:
        _init_db(conn)
        _initialized = True
    return conn


def _init_db(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS models (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            architecture TEXT DEFAULT 'unknown',
            quantization TEXT DEFAULT 'unknown',
            parameter_count TEXT DEFAULT 'unknown',
            model_size INTEGER DEFAULT 0,
            chunk_count INTEGER DEFAULT 0,
            chunk_size INTEGER DEFAULT 16777216,
            merkle_root TEXT DEFAULT '',
            tracker_url TEXT DEFAULT '',
            inference_url TEXT DEFAULT '',
            chunks TEXT DEFAULT '[]',
            metadata TEXT DEFAULT '{}',
            status TEXT DEFAULT 'registered',
            created_at TEXT,
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS nodes (
            node_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            models TEXT DEFAULT '[]',
            inference_url TEXT DEFAULT '',
            tracker_url TEXT DEFAULT '',
            capabilities TEXT DEFAULT '{}',
            region TEXT DEFAULT 'unknown',
            status TEXT DEFAULT 'active',
            last_heartbeat TEXT,
            registered_at TEXT,
            metrics TEXT DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS peers (
            peer_id TEXT PRIMARY KEY,
            chunks TEXT DEFAULT '[]',
            ip TEXT DEFAULT '',
            port INTEGER DEFAULT 0,
            last_seen TEXT
        );

        CREATE TABLE IF NOT EXISTS api_keys (
            key TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            scopes TEXT DEFAULT '["read"]',
            user_id TEXT,
            created_at TEXT,
            last_used TEXT
        );

        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            username TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            created_at TEXT,
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at TEXT,
            expires_at TEXT
        );

        CREATE TABLE IF NOT EXISTS analytics (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            model_id TEXT,
            node_id TEXT,
            metadata TEXT DEFAULT '{}',
            timestamp TEXT
        );

        CREATE TABLE IF NOT EXISTS inference_logs (
            id TEXT PRIMARY KEY,
            model_id TEXT,
            node_id TEXT,
            prompt TEXT,
            response TEXT,
            elapsed_ms INTEGER,
            tokens_prompt INTEGER DEFAULT 0,
            tokens_completion INTEGER DEFAULT 0,
            gen_tok_per_sec REAL DEFAULT 0,
            prompt_tok_per_sec REAL DEFAULT 0,
            success INTEGER DEFAULT 1,
            error TEXT,
            timestamp TEXT
        );

        CREATE TABLE IF NOT EXISTS race_workers (
            id TEXT PRIMARY KEY,
            race_id TEXT NOT NULL,
            worker_url TEXT NOT NULL,
            worker_id TEXT NOT NULL,
            partial_text TEXT DEFAULT '',
            score REAL DEFAULT 0,
            status TEXT DEFAULT 'pending',
            tokens_generated INTEGER DEFAULT 0,
            elapsed_ms INTEGER DEFAULT 0,
            created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS races (
            id TEXT PRIMARY KEY,
            prompt TEXT NOT NULL,
            model_id TEXT DEFAULT '',
            num_workers INTEGER DEFAULT 2,
            partial_tokens INTEGER DEFAULT 32,
            winner_worker_id TEXT DEFAULT '',
            final_response TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            user_preference TEXT DEFAULT '',
            total_elapsed_ms INTEGER DEFAULT 0,
            tokens_saved INTEGER DEFAULT 0,
            created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS worker_stats (
            worker_id TEXT PRIMARY KEY,
            worker_url TEXT NOT NULL,
            races_won INTEGER DEFAULT 0,
            races_lost INTEGER DEFAULT 0,
            total_score REAL DEFAULT 0,
            avg_score REAL DEFAULT 0,
            avg_latency_ms REAL DEFAULT 0,
            user_preferences INTEGER DEFAULT 0,
            alpha REAL DEFAULT 1.0,
            beta REAL DEFAULT 1.0,
            last_race TEXT
        );

        CREATE TABLE IF NOT EXISTS peer_chunks (
            id TEXT PRIMARY KEY,
            peer_id TEXT NOT NULL,
            chunk_hash TEXT NOT NULL,
            model_id TEXT DEFAULT '',
            announced_at TEXT
        );

        CREATE TABLE IF NOT EXISTS peer_connections (
            id TEXT PRIMARY KEY,
            from_peer TEXT NOT NULL,
            to_peer TEXT NOT NULL,
            chunk_hash TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            bytes_transferred INTEGER DEFAULT 0,
            started_at TEXT,
            completed_at TEXT
        );
    """)
    conn.commit()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── Models ──────────────────────────────────────────────────────

def create_model(data: dict) -> dict:
    with _lock:
        conn = _get_conn()
        model_id = str(uuid4())
        now = utc_now()
        conn.execute(
            """INSERT INTO models (id, name, architecture, quantization, parameter_count,
               model_size, chunk_count, chunk_size, merkle_root, tracker_url, inference_url,
               chunks, metadata, status, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (model_id, data["name"], data.get("architecture", "unknown"),
             data.get("quantization", "unknown"), data.get("parameter_count", "unknown"),
             data.get("model_size", 0), data.get("chunk_count", 0),
             data.get("chunk_size", 16777216), data.get("merkle_root", ""),
             data.get("tracker_url", ""), data.get("inference_url", ""),
             json.dumps(data.get("chunks", [])), json.dumps(data.get("metadata", {})),
             "registered", now, now)
        )
        conn.commit()
        return get_model(model_id)


def get_model(model_id: str) -> Optional[dict]:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM models WHERE id = ?", (model_id,)).fetchone()
    if not row:
        return None
    return _row_to_model(row)


def get_model_by_name(name: str) -> Optional[dict]:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM models WHERE name = ?", (name,)).fetchone()
    if not row:
        return None
    return _row_to_model(row)


def list_models() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM models ORDER BY created_at DESC").fetchall()
    return [_row_to_model(r) for r in rows]


def update_model(model_id: str, data: dict) -> Optional[dict]:
    with _lock:
        conn = _get_conn()
        existing = get_model(model_id)
        if not existing:
            return None
        fields = []
        values = []
        for k in ["name", "architecture", "quantization", "inference_url", "tracker_url"]:
            if k in data and data[k] is not None:
                fields.append(f"{k} = ?")
                values.append(data[k])
        if "metadata" in data and data["metadata"] is not None:
            fields.append("metadata = ?")
            values.append(json.dumps(data["metadata"]))
        fields.append("updated_at = ?")
        values.append(utc_now())
        values.append(model_id)
        conn.execute(f"UPDATE models SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
        return get_model(model_id)


def delete_model(model_id: str) -> bool:
    with _lock:
        conn = _get_conn()
        cur = conn.execute("DELETE FROM models WHERE id = ?", (model_id,))
        conn.commit()
        return cur.rowcount > 0


def _row_to_model(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "architecture": row["architecture"],
        "quantization": row["quantization"],
        "parameter_count": row["parameter_count"],
        "model_size": row["model_size"],
        "chunk_count": row["chunk_count"],
        "chunk_size": row["chunk_size"],
        "merkle_root": row["merkle_root"],
        "tracker_url": row["tracker_url"],
        "inference_url": row["inference_url"],
        "chunks": json.loads(row["chunks"]),
        "metadata": json.loads(row["metadata"]),
        "status": row["status"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


# ─── Nodes ────────────────────────────────────────────────────────

def register_node(data: dict) -> dict:
    with _lock:
        conn = _get_conn()
        now = utc_now()
        conn.execute(
            """INSERT OR REPLACE INTO nodes (node_id, name, models, inference_url, tracker_url,
               capabilities, region, status, last_heartbeat, registered_at, metrics)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (data["node_id"], data["name"], json.dumps(data.get("models", [])),
             data.get("inference_url", ""), data.get("tracker_url", ""),
             json.dumps(data.get("capabilities", {})), data.get("region", "unknown"),
             "active", now, now, json.dumps({}))
        )
        conn.commit()
        return get_node(data["node_id"])


def get_node(node_id: str) -> Optional[dict]:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
    if not row:
        return None
    return _row_to_node(row)


def list_nodes() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM nodes ORDER BY registered_at DESC").fetchall()
    return [_row_to_node(r) for r in rows]


def heartbeat(node_id: str, data: dict) -> Optional[dict]:
    with _lock:
        conn = _get_conn()
        existing = get_node(node_id)
        if not existing:
            return None
        conn.execute(
            "UPDATE nodes SET status = ?, last_heartbeat = ?, metrics = ? WHERE node_id = ?",
            (data.get("status", "active"), utc_now(),
             json.dumps(data.get("metrics", {})), node_id)
        )
        conn.commit()
        return get_node(node_id)


def deregister_node(node_id: str) -> bool:
    with _lock:
        conn = _get_conn()
        cur = conn.execute("DELETE FROM nodes WHERE node_id = ?", (node_id,))
        conn.commit()
        return cur.rowcount > 0


def _row_to_node(row: sqlite3.Row) -> dict:
    return {
        "node_id": row["node_id"],
        "name": row["name"],
        "models": json.loads(row["models"]),
        "inference_url": row["inference_url"],
        "tracker_url": row["tracker_url"],
        "capabilities": json.loads(row["capabilities"]),
        "region": row["region"],
        "status": row["status"],
        "last_heartbeat": row["last_heartbeat"],
        "registered_at": row["registered_at"],
        "metrics": json.loads(row["metrics"]),
    }


# ─── Peers ────────────────────────────────────────────────────────

def announce_peer(data: dict) -> dict:
    with _lock:
        conn = _get_conn()
        now = utc_now()
        conn.execute(
            """INSERT OR REPLACE INTO peers (peer_id, chunks, ip, port, last_seen)
               VALUES (?,?,?,?,?)""",
            (data["peer_id"], json.dumps(data.get("chunks", [])),
             data.get("ip", ""), data.get("port", 0), now)
        )
        conn.commit()
        return {
            "peer_id": data["peer_id"],
            "chunks": data.get("chunks", []),
            "ip": data.get("ip", ""),
            "port": data.get("port", 0),
            "last_seen": now,
        }


def get_peers_for_chunk(chunk_hash: str) -> list[dict]:
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM peers").fetchall()
    result = []
    for row in rows:
        chunks = json.loads(row["chunks"])
        if chunk_hash in chunks:
            result.append({
                "peer_id": row["peer_id"],
                "ip": row["ip"],
                "port": row["port"],
                "last_seen": row["last_seen"],
            })
    return result


def list_peers() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM peers ORDER BY last_seen DESC").fetchall()
    return [
        {
            "peer_id": r["peer_id"],
            "chunks": json.loads(r["chunks"]),
            "ip": r["ip"],
            "port": r["port"],
            "last_seen": r["last_seen"],
        }
        for r in rows
    ]


# ─── API Keys ────────────────────────────────────────────────────

def create_api_key(name: str, scopes: list[str], user_id: str = None) -> dict:
    with _lock:
        conn = _get_conn()
        key = f"tg_{uuid4().hex}"
        now = utc_now()
        conn.execute(
            "INSERT INTO api_keys (key, name, scopes, user_id, created_at) VALUES (?,?,?,?,?)",
            (key, name, json.dumps(scopes), user_id, now)
        )
        conn.commit()
        return {"key": key, "name": name, "scopes": scopes, "user_id": user_id, "created_at": now, "last_used": None}


def validate_api_key(key: str) -> Optional[dict]:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM api_keys WHERE key = ?", (key,)).fetchone()
    if not row:
        return None
    with _lock:
        conn.execute("UPDATE api_keys SET last_used = ? WHERE key = ?", (utc_now(), key))
        conn.commit()
    return {
        "key": row["key"],
        "name": row["name"],
        "scopes": json.loads(row["scopes"]),
        "user_id": row["user_id"],
        "created_at": row["created_at"],
        "last_used": row["last_used"],
    }


def list_api_keys() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM api_keys ORDER BY created_at DESC").fetchall()
    return [
        {
            "key": r["key"],
            "name": r["name"],
            "scopes": json.loads(r["scopes"]),
            "user_id": r["user_id"],
            "created_at": r["created_at"],
            "last_used": r["last_used"],
        }
        for r in rows
    ]


def revoke_api_key(key: str) -> bool:
    with _lock:
        conn = _get_conn()
        cur = conn.execute("DELETE FROM api_keys WHERE key = ?", (key,))
        conn.commit()
        return cur.rowcount > 0


def list_api_keys_for_user(user_id: str) -> list[dict]:
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC", (user_id,)).fetchall()
    return [
        {
            "key": r["key"],
            "name": r["name"],
            "scopes": json.loads(r["scopes"]),
            "user_id": r["user_id"],
            "created_at": r["created_at"],
            "last_used": r["last_used"],
        }
        for r in rows
    ]


# ─── Users ────────────────────────────────────────────────────────

def create_user(email: str, username: str, password_hash: str) -> dict:
    with _lock:
        conn = _get_conn()
        user_id = str(uuid4())
        now = utc_now()
        conn.execute(
            "INSERT INTO users (id, email, username, password_hash, role, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
            (user_id, email, username, password_hash, "user", now, now)
        )
        conn.commit()
        return get_user_by_id(user_id)


def get_user_by_id(user_id: str) -> Optional[dict]:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        return None
    return _row_to_user(row)


def get_user_by_email(email: str) -> Optional[dict]:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not row:
        return None
    return _row_to_user(row)


def list_users() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM users ORDER BY created_at DESC").fetchall()
    return [_row_to_user(r) for r in rows]


def _row_to_user(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "username": row["username"],
        "password_hash": row["password_hash"],
        "role": row["role"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


# ─── Sessions ────────────────────────────────────────────────────

def create_session(user_id: str, expires_hours: int = 24 * 7) -> dict:
    with _lock:
        conn = _get_conn()
        token = f"ts_{uuid4().hex}"
        now = datetime.now(timezone.utc)
        from datetime import timedelta
        expires = now + timedelta(hours=expires_hours)
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
            (token, user_id, now.isoformat(), expires.isoformat())
        )
        conn.commit()
        return {"token": token, "user_id": user_id, "created_at": now.isoformat(), "expires_at": expires.isoformat()}


def validate_session(token: str) -> Optional[dict]:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM sessions WHERE token = ?", (token,)).fetchone()
    if not row:
        return None
    # Check expiry
    try:
        expires = datetime.fromisoformat(row["expires_at"])
        if datetime.now(timezone.utc) > expires:
            with _lock:
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
                conn.commit()
            return None
    except Exception:
        return None
    user = get_user_by_id(row["user_id"])
    if not user:
        return None
    return {"token": row["token"], "user_id": row["user_id"], "user": user}


def revoke_session(token: str) -> bool:
    with _lock:
        conn = _get_conn()
        cur = conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        return cur.rowcount > 0


# ─── Analytics ────────────────────────────────────────────────────

def log_event(event_type: str, model_id: str = None, node_id: str = None, metadata: dict = None) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO analytics (id, event_type, model_id, node_id, metadata, timestamp) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), event_type, model_id, node_id, json.dumps(metadata or {}), utc_now())
        )
        conn.commit()


def log_inference(data: dict) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            """INSERT INTO inference_logs (id, model_id, node_id, prompt, response, elapsed_ms,
               tokens_prompt, tokens_completion, gen_tok_per_sec, prompt_tok_per_sec,
               success, error, timestamp) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (str(uuid4()), data.get("model_id"), data.get("node_id"),
             data.get("prompt", ""), data.get("response", ""), data.get("elapsed_ms", 0),
             data.get("tokens_prompt", 0), data.get("tokens_completion", 0),
             data.get("gen_tok_per_sec", 0), data.get("prompt_tok_per_sec", 0),
             1 if data.get("success") else 0, data.get("error"), utc_now())
        )
        conn.commit()


def get_analytics() -> dict:
    conn = _get_conn()
    total_downloads = conn.execute(
        "SELECT COUNT(*) FROM analytics WHERE event_type = 'download_complete'"
    ).fetchone()[0]
    total_inferences = conn.execute("SELECT COUNT(*) FROM inference_logs").fetchone()[0]
    active_nodes = conn.execute(
        "SELECT COUNT(*) FROM nodes WHERE status = 'active'"
    ).fetchone()[0]
    total_models = conn.execute("SELECT COUNT(*) FROM models").fetchone()[0]
    total_chunks = conn.execute("SELECT COALESCE(SUM(chunk_count), 0) FROM models").fetchone()[0]
    total_size = conn.execute("SELECT COALESCE(SUM(model_size), 0) FROM models").fetchone()[0]

    # Top models by inference count
    top_rows = conn.execute(
        """SELECT model_id, COUNT(*) as count, AVG(gen_tok_per_sec) as avg_speed
           FROM inference_logs WHERE success = 1 GROUP BY model_id ORDER BY count DESC LIMIT 5"""
    ).fetchall()
    top_models = [{"model_id": r["model_id"], "inferences": r["count"], "avg_tok_s": round(r["avg_speed"] or 0, 1)} for r in top_rows]

    # Recent events
    event_rows = conn.execute(
        "SELECT * FROM analytics ORDER BY timestamp DESC LIMIT 20"
    ).fetchall()
    events = [{"event_type": r["event_type"], "model_id": r["model_id"], "timestamp": r["timestamp"]} for r in event_rows]

    # Node uptime
    node_rows = conn.execute("SELECT node_id, registered_at, last_heartbeat FROM nodes").fetchall()
    node_uptime = {}
    for r in node_rows:
        try:
            reg = datetime.fromisoformat(r["registered_at"])
            now = datetime.now(timezone.utc)
            uptime = (now - reg).total_seconds() / 3600
            node_uptime[r["node_id"]] = round(uptime, 1)
        except Exception:
            pass

    return {
        "total_downloads": total_downloads,
        "total_inferences": total_inferences,
        "active_nodes": active_nodes,
        "total_models": total_models,
        "total_chunks": total_chunks,
        "total_size_mb": round(total_size / (1024 * 1024), 1),
        "events": events,
        "top_models": top_models,
        "node_uptime": node_uptime,
    }


# ─── Competitive Inference ───────────────────────────────────────

def create_race(prompt: str, model_id: str, num_workers: int, partial_tokens: int) -> dict:
    with _lock:
        conn = _get_conn()
        race_id = str(uuid4())
        now = utc_now()
        conn.execute(
            "INSERT INTO races (id, prompt, model_id, num_workers, partial_tokens, status, created_at) VALUES (?,?,?,?,?,?,?)",
            (race_id, prompt[:500], model_id, num_workers, partial_tokens, "racing", now)
        )
        conn.commit()
        return get_race(race_id)


def get_race(race_id: str) -> Optional[dict]:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM races WHERE id = ?", (race_id,)).fetchone()
    if not row:
        return None
    workers = conn.execute("SELECT * FROM race_workers WHERE race_id = ?", (race_id,)).fetchall()
    return {
        "id": row["id"],
        "prompt": row["prompt"],
        "model_id": row["model_id"],
        "num_workers": row["num_workers"],
        "partial_tokens": row["partial_tokens"],
        "winner_worker_id": row["winner_worker_id"],
        "final_response": row["final_response"],
        "status": row["status"],
        "user_preference": row["user_preference"],
        "total_elapsed_ms": row["total_elapsed_ms"],
        "tokens_saved": row["tokens_saved"],
        "created_at": row["created_at"],
        "workers": [
            {
                "worker_id": w["worker_id"],
                "worker_url": w["worker_url"],
                "partial_text": w["partial_text"],
                "score": w["score"],
                "status": w["status"],
                "tokens_generated": w["tokens_generated"],
                "elapsed_ms": w["elapsed_ms"],
            }
            for w in workers
        ],
    }


def add_race_worker(race_id: str, worker_id: str, worker_url: str) -> dict:
    with _lock:
        conn = _get_conn()
        wid = str(uuid4())
        conn.execute(
            "INSERT INTO race_workers (id, race_id, worker_url, worker_id, status, created_at) VALUES (?,?,?,?,?,?)",
            (wid, race_id, worker_url, worker_id, "generating", utc_now())
        )
        conn.commit()
        return {"id": wid, "race_id": race_id, "worker_id": worker_id, "worker_url": worker_url}


def update_race_worker(race_id: str, worker_id: str, data: dict) -> None:
    with _lock:
        conn = _get_conn()
        fields = []
        values = []
        for k in ["partial_text", "score", "status", "tokens_generated", "elapsed_ms"]:
            if k in data:
                fields.append(f"{k} = ?")
                values.append(data[k])
        if fields:
            values.extend([race_id, worker_id])
            conn.execute(
                f"UPDATE race_workers SET {', '.join(fields)} WHERE race_id = ? AND worker_id = ?",
                values
            )
            conn.commit()


def complete_race(race_id: str, winner_id: str, final_response: str, total_ms: int, tokens_saved: int) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE races SET winner_worker_id = ?, final_response = ?, status = 'completed', total_elapsed_ms = ?, tokens_saved = ? WHERE id = ?",
            (winner_id, final_response[:2000], total_ms, tokens_saved, race_id)
        )
        conn.commit()


def set_user_preference(race_id: str, worker_id: str) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE races SET user_preference = ? WHERE id = ?",
            (worker_id, race_id)
        )
        conn.commit()
        stats = conn.execute("SELECT * FROM worker_stats WHERE worker_id = ?", (worker_id,)).fetchone()
        if stats:
            conn.execute(
                "UPDATE worker_stats SET user_preferences = user_preferences + 1 WHERE worker_id = ?",
                (worker_id,)
            )
        conn.commit()


def list_races(limit: int = 20) -> list[dict]:
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM races ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    return [
        {
            "id": r["id"],
            "prompt": r["prompt"][:100],
            "num_workers": r["num_workers"],
            "winner_worker_id": r["winner_worker_id"],
            "status": r["status"],
            "tokens_saved": r["tokens_saved"],
            "total_elapsed_ms": r["total_elapsed_ms"],
            "user_preference": r["user_preference"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def get_or_create_worker_stats(worker_id: str, worker_url: str) -> dict:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM worker_stats WHERE worker_id = ?", (worker_id,)).fetchone()
    if row:
        return _row_to_worker_stats(row)
    with _lock:
        now = utc_now()
        conn.execute(
            "INSERT INTO worker_stats (worker_id, worker_url, alpha, beta, last_race) VALUES (?,?,?,?,?)",
            (worker_id, worker_url, 1.0, 1.0, now)
        )
        conn.commit()
        row = conn.execute("SELECT * FROM worker_stats WHERE worker_id = ?", (worker_id,)).fetchone()
        return _row_to_worker_stats(row)


def update_worker_stats(worker_id: str, won: bool, score: float, latency_ms: float) -> None:
    with _lock:
        conn = _get_conn()
        row = conn.execute("SELECT * FROM worker_stats WHERE worker_id = ?", (worker_id,)).fetchone()
        if not row:
            return
        races_won = row["races_won"] + (1 if won else 0)
        races_lost = row["races_lost"] + (0 if won else 1)
        total_score = row["total_score"] + score
        total_races = races_won + races_lost
        avg_score = total_score / total_races if total_races > 0 else 0
        avg_lat = ((row["avg_latency_ms"] * (total_races - 1)) + latency_ms) / total_races if total_races > 0 else latency_ms
        alpha = row["alpha"] + (score if won else 0)
        beta = row["beta"] + (0.1 if not won else 0)
        conn.execute(
            "UPDATE worker_stats SET races_won = ?, races_lost = ?, total_score = ?, avg_score = ?, avg_latency_ms = ?, alpha = ?, beta = ?, last_race = ? WHERE worker_id = ?",
            (races_won, races_lost, total_score, avg_score, avg_lat, alpha, beta, utc_now(), worker_id)
        )
        conn.commit()


def list_worker_stats() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM worker_stats ORDER BY avg_score DESC").fetchall()
    return [_row_to_worker_stats(r) for r in rows]


def _row_to_worker_stats(row: sqlite3.Row) -> dict:
    return {
        "worker_id": row["worker_id"],
        "worker_url": row["worker_url"],
        "races_won": row["races_won"],
        "races_lost": row["races_lost"],
        "avg_score": round(row["avg_score"], 3),
        "avg_latency_ms": round(row["avg_latency_ms"], 1),
        "user_preferences": row["user_preferences"],
        "alpha": round(row["alpha"], 3),
        "beta": round(row["beta"], 3),
        "last_race": row["last_race"],
    }


# ─── P2P Peer Chunks ─────────────────────────────────────────────

def announce_peer_chunks(peer_id: str, chunks: list[str], model_id: str = "") -> int:
    with _lock:
        conn = _get_conn()
        now = utc_now()
        conn.execute("DELETE FROM peer_chunks WHERE peer_id = ?", (peer_id,))
        count = 0
        for chunk_hash in chunks:
            conn.execute(
                "INSERT INTO peer_chunks (id, peer_id, chunk_hash, model_id, announced_at) VALUES (?,?,?,?,?)",
                (str(uuid4()), peer_id, chunk_hash, model_id, now)
            )
            count += 1
        conn.execute(
            "UPDATE peers SET last_seen = ? WHERE peer_id = ?",
            (now, peer_id)
        )
        conn.commit()
        return count


def find_peers_for_chunk(chunk_hash: str) -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        """SELECT DISTINCT p.peer_id, p.ip, p.port, p.last_seen
           FROM peer_chunks pc JOIN peers p ON pc.peer_id = p.peer_id
           WHERE pc.chunk_hash = ?""",
        (chunk_hash,)
    ).fetchall()
    return [
        {"peer_id": r["peer_id"], "ip": r["ip"], "port": r["port"], "last_seen": r["last_seen"]}
        for r in rows
    ]


def find_peers_for_model(model_id: str) -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        """SELECT DISTINCT p.peer_id, p.ip, p.port, p.last_seen, COUNT(pc.chunk_hash) as chunk_count
           FROM peer_chunks pc JOIN peers p ON pc.peer_id = p.peer_id
           WHERE pc.model_id = ?
           GROUP BY p.peer_id ORDER BY chunk_count DESC""",
        (model_id,)
    ).fetchall()
    return [
        {"peer_id": r["peer_id"], "ip": r["ip"], "port": r["port"],
         "last_seen": r["last_seen"], "chunk_count": r["chunk_count"]}
        for r in rows
    ]


def log_peer_transfer(from_peer: str, to_peer: str, chunk_hash: str, bytes_transferred: int) -> dict:
    with _lock:
        conn = _get_conn()
        tid = str(uuid4())
        now = utc_now()
        conn.execute(
            "INSERT INTO peer_connections (id, from_peer, to_peer, chunk_hash, status, bytes_transferred, started_at, completed_at) VALUES (?,?,?,?,?,?,?,?)",
            (tid, from_peer, to_peer, chunk_hash, "completed", bytes_transferred, now, now)
        )
        conn.commit()
        return {"id": tid, "from_peer": from_peer, "to_peer": to_peer, "chunk_hash": chunk_hash, "bytes": bytes_transferred}


def get_peer_transfer_stats() -> dict:
    conn = _get_conn()
    total = conn.execute("SELECT COUNT(*) FROM peer_connections").fetchone()[0]
    total_bytes = conn.execute("SELECT COALESCE(SUM(bytes_transferred), 0) FROM peer_connections").fetchone()[0]
    active_peers = conn.execute("SELECT COUNT(DISTINCT peer_id) FROM peer_chunks").fetchone()[0]
    total_chunks_announced = conn.execute("SELECT COUNT(*) FROM peer_chunks").fetchone()[0]
    return {
        "total_transfers": total,
        "total_bytes_transferred": total_bytes,
        "active_peers": active_peers,
        "total_chunks_announced": total_chunks_announced,
    }


def get_peer_chunk_map() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        """SELECT peer_id, COUNT(chunk_hash) as chunk_count, model_id
           FROM peer_chunks GROUP BY peer_id ORDER BY chunk_count DESC"""
    ).fetchall()
    return [
        {"peer_id": r["peer_id"], "chunk_count": r["chunk_count"], "model_id": r["model_id"]}
        for r in rows
    ]
