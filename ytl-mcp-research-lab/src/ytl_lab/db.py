"""SQLite persistence for YTL-MCP Research Lab."""

from __future__ import annotations

import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

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
"""


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
        conn = sqlite3.connect(self.settings.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

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
            "pending_policy": pending,
            "approved": approved,
            "average_transcript_score": round(avg_score or 0.0, 3),
        }
