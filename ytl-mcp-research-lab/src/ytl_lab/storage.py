from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .db import connect


@dataclass(frozen=True)
class Project:
    id: str
    name: str
    created_at: str


@dataclass(frozen=True)
class ResearchQuery:
    id: str
    project_id: str
    query: str
    status: str
    created_at: str


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def insert_project(db_path: Path, *, project_id: str, name: str) -> Project:
    created_at = now_iso()
    with connect(db_path) as conn:
        conn.execute(
            "INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)",
            (project_id, name, created_at),
        )
    return Project(id=project_id, name=name, created_at=created_at)


def list_projects(db_path: Path, *, limit: int) -> list[Project]:
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, name, created_at FROM projects ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [Project(id=row["id"], name=row["name"], created_at=row["created_at"]) for row in rows]


def project_exists(db_path: Path, *, project_id: str) -> bool:
    with connect(db_path) as conn:
        row = conn.execute("SELECT 1 AS ok FROM projects WHERE id = ?", (project_id,)).fetchone()
    return row is not None


def insert_research_query(
    db_path: Path,
    *,
    query_id: str,
    project_id: str,
    query: str,
    status: str,
) -> ResearchQuery:
    created_at = now_iso()
    with connect(db_path) as conn:
        conn.execute(
            "INSERT INTO research_queries (id, project_id, query, status, created_at) VALUES (?, ?, ?, ?, ?)",
            (query_id, project_id, query, status, created_at),
        )
    return ResearchQuery(
        id=query_id,
        project_id=project_id,
        query=query,
        status=status,
        created_at=created_at,
    )


def count_rows(db_path: Path) -> dict[str, int]:
    with connect(db_path) as conn:
        projects = _count(conn, "projects")
        research_queries = _count(conn, "research_queries")
        receipts = _count(conn, "receipts")
    return {"projects": projects, "research_queries": research_queries, "receipts": receipts}


def _count(conn: sqlite3.Connection, table: str) -> int:
    row = conn.execute(f"SELECT COUNT(1) AS c FROM {table}").fetchone()
    if row is None:
        return 0
    return int(row["c"])
