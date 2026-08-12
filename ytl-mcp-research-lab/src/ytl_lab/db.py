"""SQLite persistence for YTL-MCP Research Lab."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

from ytl_lab.config import Settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS experiments (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    intent TEXT NOT NULL,
    video_url TEXT,
    transcript TEXT,
    transcript_score REAL,
    script_candidate TEXT,
    metadata_candidate TEXT,
    shotlist_candidate TEXT,
    policy_status TEXT DEFAULT 'pending',
    approval_receipt_id TEXT,
    upload_status TEXT DEFAULT 'not_started',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    experiment_id TEXT REFERENCES experiments(id),
    source_url TEXT,
    title TEXT,
    duration_seconds INTEGER,
    transcript_path TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_experiments_task_id ON experiments(task_id);
CREATE INDEX IF NOT EXISTS idx_experiments_policy ON experiments(policy_status);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_queries (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    query TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_queries_project_id ON research_queries(project_id);

CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    experiment_id TEXT REFERENCES experiments(id),
    step TEXT NOT NULL,
    status TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    record_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_receipts_task_id ON receipts(task_id);
CREATE INDEX IF NOT EXISTS idx_receipts_experiment_id ON receipts(experiment_id);
"""


@contextmanager
def connect(db_path: Path) -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(str(db_path), timeout=30, check_same_thread=False)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode=WAL")
        yield conn
        conn.commit()
    finally:
        conn.close()


@dataclass(frozen=True)
class Experiment:
    id: str
    task_id: str
    intent: str
    video_url: str
    transcript: str
    transcript_score: float
    script_candidate: str
    metadata_candidate: str
    shotlist_candidate: str
    policy_status: str
    approval_receipt_id: str
    upload_status: str
    created_at: str
    updated_at: str


class LabDB:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.settings.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        return connect(self.settings.db_path)

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(SCHEMA)
            conn.commit()

    def create_experiment(
        self,
        experiment_id: str,
        task_id: str,
        intent: str,
        video_url: str = "",
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO experiments (
                    id, task_id, intent, video_url, transcript, transcript_score,
                    script_candidate, metadata_candidate, shotlist_candidate,
                    policy_status, approval_receipt_id, upload_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    experiment_id,
                    task_id,
                    intent,
                    video_url,
                    "",
                    0.0,
                    "",
                    "",
                    "",
                    "pending",
                    "",
                    "not_started",
                    now,
                    now,
                ),
            )
            conn.commit()

    def update_experiment(self, experiment_id: str, **fields: Any) -> None:
        fields["updated_at"] = datetime.now(timezone.utc).isoformat()
        columns = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [experiment_id]
        with self._connect() as conn:
            conn.execute(f"UPDATE experiments SET {columns} WHERE id = ?", values)
            conn.commit()

    def get_experiment(self, experiment_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM experiments WHERE id = ?", (experiment_id,)
            ).fetchone()
            return dict(row) if row else None

    def list_experiments(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM experiments ORDER BY created_at DESC"
            ).fetchall()
            return [dict(row) for row in rows]

    def summary(self) -> Dict[str, Any]:
        with self._connect() as conn:
            total = conn.execute(
                "SELECT COUNT(*) FROM experiments"
            ).fetchone()[0]
            projects = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
            research_queries = conn.execute("SELECT COUNT(*) FROM research_queries").fetchone()[0]
            receipts = conn.execute("SELECT COUNT(*) FROM receipts").fetchone()[0]
            pending = conn.execute(
                "SELECT COUNT(*) FROM experiments WHERE policy_status = 'pending'"
            ).fetchone()[0]
            approved = conn.execute(
                "SELECT COUNT(*) FROM experiments WHERE policy_status = 'approved'"
            ).fetchone()[0]
            avg_score = conn.execute(
                "SELECT AVG(transcript_score) FROM experiments"
            ).fetchone()[0]
        return {
            "total_experiments": total,
            "projects": projects,
            "research_queries": research_queries,
            "receipts": receipts,
            "pending_policy": pending,
            "approved": approved,
            "average_transcript_score": round(avg_score or 0.0, 3),
        }

    def create_project(self, project_id: str, name: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (project_id, name, now, now),
            )
            conn.commit()

    def list_projects(self, limit: int) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, name, created_at, updated_at FROM projects ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def create_research_query(
        self,
        query_id: str,
        project_id: str,
        query: str,
        status: str,
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO research_queries (id, project_id, query, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (query_id, project_id, query, status, now, now),
            )
            conn.commit()

    def list_research_queries(
        self, *, project_id: Optional[str], limit: int
    ) -> List[Dict[str, Any]]:
        sql = "SELECT id, project_id, query, status, created_at, updated_at FROM research_queries"
        params: list[Any] = []
        if project_id is not None:
            sql += " WHERE project_id = ?"
            params.append(project_id)
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)

        with self._connect() as conn:
            rows = conn.execute(sql, tuple(params)).fetchall()
        return [dict(row) for row in rows]

    def insert_receipt(self, receipt: Dict[str, Any]) -> None:
        evidence_json = json.dumps(receipt.get("evidence", {}), ensure_ascii=False)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO receipts (id, task_id, experiment_id, step, status, timestamp, evidence_json, record_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    receipt["receipt_id"],
                    receipt.get("task_id"),
                    receipt.get("experiment_id"),
                    receipt.get("step", ""),
                    receipt.get("status", ""),
                    receipt.get("timestamp", ""),
                    evidence_json,
                    receipt.get("hash", ""),
                ),
            )
            conn.commit()

    def get_receipts(
        self, *, task_id: Optional[str] = None, experiment_id: Optional[str] = None, limit: int = 100
    ) -> List[Dict[str, Any]]:
        sql = "SELECT id, task_id, experiment_id, step, status, timestamp, evidence_json, record_hash FROM receipts"
        params: list[Any] = []
        conditions = []
        if task_id is not None:
            conditions.append("task_id = ?")
            params.append(task_id)
        if experiment_id is not None:
            conditions.append("experiment_id = ?")
            params.append(experiment_id)
        if conditions:
            sql += " WHERE " + " AND ".join(conditions)
        sql += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)
        with self._connect() as conn:
            rows = conn.execute(sql, tuple(params)).fetchall()
        return [dict(row) for row in rows]
