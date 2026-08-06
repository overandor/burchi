"""
Real persistence — SQLite-backed storage for all runtime state.

State survives restarts. Content-addressed storage with real dedup.
This is not in-memory dicts. This is a real database.

Tables:
  - objects: content-addressed blob store (cid → json blob)
  - frames: universal inference frames
  - rollups: inference rollups + steps
  - graph_nodes: execution graph nodes
  - ledger_entries: all 11 ledgers
  - terminal_states: terminal state snapshots
  - peers: registered reasoning peers
  - seeds: seeded reasoning
  - kv: key-value for metadata (head hashes, state root, etc.)
"""

from __future__ import annotations
import sqlite3
import json
import hashlib
import time
import os
from typing import Optional, Any
from pathlib import Path


class Persistence:
    """SQLite-backed content-addressed storage.

    Every object is stored by its content hash.
    Same content → same hash → dedup for free.
    State survives process restarts.
    """

    def __init__(self, db_path: str = ""):
        if not db_path:
            db_path = os.environ.get(
                "TERMINALITY_DB",
                str(Path.home() / ".terminality" / "runtime.db"),
            )
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self):
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS objects (
                cid TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                data TEXT NOT NULL,
                size INTEGER NOT NULL,
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS frames (
                cid TEXT PRIMARY KEY,
                frame_type TEXT NOT NULL,
                parent_frames TEXT NOT NULL,
                prompt TEXT,
                model_id TEXT,
                provider TEXT,
                response TEXT,
                verified INTEGER DEFAULT 0,
                tokens_consumed INTEGER DEFAULT 0,
                created_at REAL NOT NULL,
                data TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS rollups (
                hash TEXT PRIMARY KEY,
                rollup_id TEXT NOT NULL,
                objective TEXT,
                status TEXT NOT NULL,
                parent_rollups TEXT,
                model_provenance TEXT,
                steps TEXT NOT NULL,
                state TEXT NOT NULL,
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS graph_nodes (
                hash TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                identity TEXT NOT NULL,
                data TEXT NOT NULL,
                causal_parents TEXT NOT NULL,
                causal_children TEXT NOT NULL,
                timestamp REAL NOT NULL,
                provenance TEXT,
                verified INTEGER DEFAULT 0,
                tags TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ledger_entries (
                hash TEXT PRIMARY KEY,
                ledger_type TEXT NOT NULL,
                entry_id TEXT NOT NULL,
                parent_hash TEXT NOT NULL,
                data TEXT NOT NULL,
                signer TEXT NOT NULL,
                timestamp REAL NOT NULL,
                seq INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_ledger_type ON ledger_entries(ledger_type);

            CREATE TABLE IF NOT EXISTS terminal_states (
                cid TEXT PRIMARY KEY,
                parent_cid TEXT NOT NULL,
                data TEXT NOT NULL,
                is_checkpoint INTEGER DEFAULT 0,
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS peers (
                peer_id TEXT PRIMARY KEY,
                model_family TEXT,
                model_id TEXT,
                status TEXT NOT NULL,
                capabilities TEXT NOT NULL,
                registered_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS seeds (
                seed_hash TEXT PRIMARY KEY,
                peer_id TEXT NOT NULL,
                rollup_hash TEXT NOT NULL,
                objective TEXT,
                confidence REAL,
                data TEXT NOT NULL,
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS kv (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)
        self.conn.commit()

    def _content_hash(self, data: dict) -> str:
        return hashlib.sha256(
            json.dumps(data, sort_keys=True, default=str).encode()
        ).hexdigest()

    # ─── Generic object store ──────────────────────────────────────────

    def store_object(self, obj_type: str, data: dict) -> str:
        cid = self._content_hash({"type": obj_type, "data": data})
        raw = json.dumps(data, default=str)
        self.conn.execute(
            "INSERT OR IGNORE INTO objects (cid, type, data, size, created_at) VALUES (?, ?, ?, ?, ?)",
            (cid, obj_type, raw, len(raw), time.time()),
        )
        self.conn.commit()
        return cid

    def get_object(self, cid: str) -> Optional[dict]:
        row = self.conn.execute("SELECT data FROM objects WHERE cid = ?", (cid,)).fetchone()
        return json.loads(row["data"]) if row else None

    def object_exists(self, cid: str) -> bool:
        return self.conn.execute("SELECT 1 FROM objects WHERE cid = ?", (cid,)).fetchone() is not None

    # ─── Frames ─────────────────────────────────────────────────────────

    def store_frame(self, frame_dict: dict) -> str:
        cid = frame_dict.get("cid", "")
        if not cid:
            cid = self._content_hash(frame_dict)
        self.conn.execute(
            """INSERT OR REPLACE INTO frames
            (cid, frame_type, parent_frames, prompt, model_id, provider,
             response, verified, tokens_consumed, created_at, data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                cid,
                frame_dict.get("frame_type", "inference"),
                json.dumps(frame_dict.get("parent_frames", [])),
                frame_dict.get("prompt", ""),
                frame_dict.get("model_id", ""),
                frame_dict.get("provider", "custom"),
                frame_dict.get("response", ""),
                1 if frame_dict.get("verified") else 0,
                frame_dict.get("tokens_consumed", 0),
                frame_dict.get("created_at", time.time()),
                json.dumps(frame_dict, default=str),
            ),
        )
        self.conn.commit()
        return cid

    def get_frame(self, cid: str) -> Optional[dict]:
        row = self.conn.execute("SELECT data FROM frames WHERE cid = ?", (cid,)).fetchone()
        if not row:
            row = self.conn.execute("SELECT data FROM frames WHERE cid LIKE ?", (cid + "%",)).fetchone()
        return json.loads(row["data"]) if row else None

    def list_frames(self, limit: int = 100) -> list[dict]:
        rows = self.conn.execute(
            "SELECT data FROM frames ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [json.loads(r["data"]) for r in rows]

    def count_frames(self) -> int:
        return self.conn.execute("SELECT COUNT(*) FROM frames").fetchone()[0]

    # ─── Rollups ────────────────────────────────────────────────────────

    def store_rollup(self, rollup_dict: dict) -> str:
        h = rollup_dict.get("hash", "")
        if not h:
            h = self._content_hash(rollup_dict)
        self.conn.execute(
            """INSERT OR REPLACE INTO rollups
            (hash, rollup_id, objective, status, parent_rollups,
             model_provenance, steps, state, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                h,
                rollup_dict.get("rollup_id", ""),
                rollup_dict.get("state", {}).get("objectives_remaining", [""])[0]
                    if rollup_dict.get("state", {}).get("objectives_remaining") else "",
                rollup_dict.get("status", "open"),
                json.dumps(rollup_dict.get("parent_rollups", [])),
                json.dumps(rollup_dict.get("model_provenance", [])),
                json.dumps(rollup_dict.get("steps", [])),
                json.dumps(rollup_dict.get("state", {})),
                time.time(),
            ),
        )
        self.conn.commit()
        return h

    def get_rollup(self, h: str) -> Optional[dict]:
        row = self.conn.execute("SELECT * FROM rollups WHERE hash = ?", (h,)).fetchone()
        if not row:
            # Try prefix match
            row = self.conn.execute("SELECT * FROM rollups WHERE hash LIKE ?", (h + "%",)).fetchone()
        if not row:
            return None
        return {
            "hash": row["hash"],
            "rollup_id": row["rollup_id"],
            "status": row["status"],
            "parent_rollups": json.loads(row["parent_rollups"]),
            "model_provenance": json.loads(row["model_provenance"]),
            "steps": json.loads(row["steps"]),
            "state": json.loads(row["state"]),
        }

    def list_rollups(self, limit: int = 50) -> list[dict]:
        rows = self.conn.execute(
            "SELECT hash, rollup_id, objective, status, created_at FROM rollups ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    # ─── Graph nodes ────────────────────────────────────────────────────

    def store_graph_node(self, node_dict: dict) -> str:
        h = node_dict.get("hash", "")
        if not h:
            h = self._content_hash(node_dict)
        self.conn.execute(
            """INSERT OR REPLACE INTO graph_nodes
            (hash, kind, identity, data, causal_parents, causal_children,
             timestamp, provenance, verified, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                h,
                node_dict.get("kind", ""),
                node_dict.get("identity", ""),
                json.dumps(node_dict.get("data", {})),
                json.dumps(node_dict.get("causal_parents", [])),
                json.dumps(node_dict.get("causal_children", [])),
                node_dict.get("timestamp", time.time()),
                json.dumps(node_dict.get("provenance")),
                1 if node_dict.get("verified") else 0,
                json.dumps(node_dict.get("tags", [])),
            ),
        )
        self.conn.commit()
        return h

    def get_graph_node(self, h: str) -> Optional[dict]:
        row = self.conn.execute("SELECT * FROM graph_nodes WHERE hash = ?", (h,)).fetchone()
        if not row:
            return None
        return {
            "hash": row["hash"],
            "kind": row["kind"],
            "identity": row["identity"],
            "data": json.loads(row["data"]),
            "causal_parents": json.loads(row["causal_parents"]),
            "causal_children": json.loads(row["causal_children"]),
            "timestamp": row["timestamp"],
            "provenance": json.loads(row["provenance"]) if row["provenance"] else None,
            "verified": bool(row["verified"]),
            "tags": json.loads(row["tags"]),
        }

    def list_graph_nodes(self, kind: str = "", limit: int = 100) -> list[dict]:
        if kind:
            rows = self.conn.execute(
                "SELECT hash FROM graph_nodes WHERE kind = ? ORDER BY timestamp DESC LIMIT ?",
                (kind, limit),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT hash FROM graph_nodes ORDER BY timestamp DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [self.get_graph_node(r["hash"]) for r in rows if r["hash"]]

    # ─── Ledger entries ─────────────────────────────────────────────────

    def append_ledger(self, ledger_type: str, data: dict,
                      signer: str = "", parent_hash: str = "") -> str:
        ts = time.time()
        entry_id = hashlib.sha256(f"{ledger_type}:{ts}".encode()).hexdigest()[:16]
        payload = {
            "type": ledger_type,
            "id": entry_id,
            "parent": parent_hash,
            "data": data,
            "timestamp": ts,
            "signer": signer,
        }
        h = hashlib.sha256(
            json.dumps(payload, sort_keys=True, default=str).encode()
        ).hexdigest()
        self.conn.execute(
            """INSERT OR IGNORE INTO ledger_entries
            (hash, ledger_type, entry_id, parent_hash, data, signer, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (h, ledger_type, entry_id, parent_hash, json.dumps(data), signer, ts),
        )
        self.conn.commit()
        return h

    def get_ledger_head(self, ledger_type: str) -> str:
        row = self.conn.execute(
            "SELECT hash FROM ledger_entries WHERE ledger_type = ? ORDER BY timestamp DESC LIMIT 1",
            (ledger_type,),
        ).fetchone()
        return row["hash"] if row else ""

    def list_ledger_entries(self, ledger_type: str, limit: int = 50) -> list[dict]:
        rows = self.conn.execute(
            "SELECT hash, entry_id, parent_hash, data, signer, timestamp FROM ledger_entries WHERE ledger_type = ? ORDER BY timestamp DESC LIMIT ?",
            (ledger_type, limit),
        ).fetchall()
        return [
            {
                "hash": r["hash"],
                "entry_id": r["entry_id"],
                "parent_hash": r["parent_hash"],
                "data": json.loads(r["data"]),
                "signer": r["signer"],
                "timestamp": r["timestamp"],
            }
            for r in rows
        ]

    def count_ledger_entries(self, ledger_type: str = "") -> int:
        if ledger_type:
            return self.conn.execute(
                "SELECT COUNT(*) FROM ledger_entries WHERE ledger_type = ?", (ledger_type,)
            ).fetchone()[0]
        return self.conn.execute("SELECT COUNT(*) FROM ledger_entries").fetchone()[0]

    # ─── Terminal states ────────────────────────────────────────────────

    def store_terminal_state(self, state_dict: dict) -> str:
        cid = state_dict.get("cid", "")
        if not cid:
            cid = self._content_hash(state_dict)
        self.conn.execute(
            """INSERT OR REPLACE INTO terminal_states
            (cid, parent_cid, data, is_checkpoint, created_at)
            VALUES (?, ?, ?, ?, ?)""",
            (
                cid,
                state_dict.get("parent_state_cid", ""),
                json.dumps(state_dict, default=str),
                1 if state_dict.get("is_checkpoint") else 0,
                state_dict.get("created_at", time.time()),
            ),
        )
        self.conn.commit()
        return cid

    def get_terminal_state(self, cid: str) -> Optional[dict]:
        row = self.conn.execute("SELECT data FROM terminal_states WHERE cid = ?", (cid,)).fetchone()
        return json.loads(row["data"]) if row else None

    # ─── Peers ──────────────────────────────────────────────────────────

    def store_peer(self, peer_id: str, capabilities: dict, status: str = "online"):
        self.conn.execute(
            """INSERT OR REPLACE INTO peers
            (peer_id, model_family, model_id, status, capabilities, registered_at)
            VALUES (?, ?, ?, ?, ?, ?)""",
            (
                peer_id,
                capabilities.get("model_family", ""),
                capabilities.get("model_id", ""),
                status,
                json.dumps(capabilities),
                time.time(),
            ),
        )
        self.conn.commit()

    def get_peer(self, peer_id: str) -> Optional[dict]:
        row = self.conn.execute("SELECT * FROM peers WHERE peer_id = ?", (peer_id,)).fetchone()
        if not row:
            return None
        return {
            "peer_id": row["peer_id"],
            "model_family": row["model_family"],
            "model_id": row["model_id"],
            "status": row["status"],
            "capabilities": json.loads(row["capabilities"]),
            "registered_at": row["registered_at"],
        }

    def list_peers(self) -> list[dict]:
        rows = self.conn.execute("SELECT * FROM peers").fetchall()
        return [
            {
                "peer_id": r["peer_id"],
                "model_family": r["model_family"],
                "model_id": r["model_id"],
                "status": r["status"],
                "capabilities": json.loads(r["capabilities"]),
            }
            for r in rows
        ]

    # ─── Seeds ──────────────────────────────────────────────────────────

    def store_seed(self, seed_dict: dict) -> str:
        h = self._content_hash(seed_dict)
        self.conn.execute(
            """INSERT OR REPLACE INTO seeds
            (seed_hash, peer_id, rollup_hash, objective, confidence, data, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                h,
                seed_dict.get("peer_id", ""),
                seed_dict.get("rollup_hash", ""),
                seed_dict.get("objective", ""),
                seed_dict.get("confidence", 0.0),
                json.dumps(seed_dict, default=str),
                time.time(),
            ),
        )
        self.conn.commit()
        return h

    def list_seeds(self, objective: str = "") -> list[dict]:
        if objective:
            rows = self.conn.execute(
                "SELECT data FROM seeds WHERE objective LIKE ? ORDER BY created_at DESC",
                (f"%{objective}%",),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT data FROM seeds ORDER BY created_at DESC"
            ).fetchall()
        return [json.loads(r["data"]) for r in rows]

    # ─── KV store ───────────────────────────────────────────────────────

    def set_kv(self, key: str, value: str):
        self.conn.execute(
            "INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)",
            (key, value),
        )
        self.conn.commit()

    def get_kv(self, key: str) -> Optional[str]:
        row = self.conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    # ─── Stats ──────────────────────────────────────────────────────────

    def stats(self) -> dict:
        return {
            "db_path": self.db_path,
            "objects": self.conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0],
            "frames": self.count_frames(),
            "rollups": self.conn.execute("SELECT COUNT(*) FROM rollups").fetchone()[0],
            "graph_nodes": self.conn.execute("SELECT COUNT(*) FROM graph_nodes").fetchone()[0],
            "ledger_entries": self.count_ledger_entries(),
            "terminal_states": self.conn.execute("SELECT COUNT(*) FROM terminal_states").fetchone()[0],
            "peers": self.conn.execute("SELECT COUNT(*) FROM peers").fetchone()[0],
            "seeds": self.conn.execute("SELECT COUNT(*) FROM seeds").fetchone()[0],
            "db_size_kb": round(os.path.getsize(self.db_path) / 1024, 1) if os.path.exists(self.db_path) else 0,
        }

    def close(self):
        self.conn.close()
