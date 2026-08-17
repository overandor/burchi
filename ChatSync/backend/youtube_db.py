"""YouTube upload + maintenance ETL warehouse layer.

Schema and CRUD for three tables that form the YouTube pipeline warehouse:

  youtube_accounts  — multi-account OAuth credential registry + channel info
  youtube_videos    — lineage: conversation -> video record -> YouTube video id
  youtube_analytics — ETL time-series: analytics snapshots pulled from YouTube

Every video record traces back to a source conversation (provenance).
Analytics are stored as append-only snapshots so the warehouse preserves
full history, not just the latest state.
"""
from __future__ import annotations

import json
import time
import uuid as _uuid
from typing import Optional

import aiosqlite


YOUTUBE_SCHEMA = """
CREATE TABLE IF NOT EXISTS youtube_accounts (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    credentials_path TEXT NOT NULL,
    channel_id TEXT NOT NULL DEFAULT '',
    channel_title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    last_error TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_yt_accounts_status ON youtube_accounts(status);

CREATE TABLE IF NOT EXISTS youtube_videos (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    youtube_video_id TEXT,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    privacy TEXT NOT NULL DEFAULT 'private',
    file_path TEXT NOT NULL DEFAULT '',
    upload_progress REAL NOT NULL DEFAULT 0,
    published_at REAL,
    error_message TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES youtube_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_yt_videos_conversation ON youtube_videos(conversation_id);
CREATE INDEX IF NOT EXISTS idx_yt_videos_account ON youtube_videos(account_id);
CREATE INDEX IF NOT EXISTS idx_yt_videos_status ON youtube_videos(status);
CREATE INDEX IF NOT EXISTS idx_yt_videos_yt_id ON youtube_videos(youtube_video_id);

CREATE TABLE IF NOT EXISTS youtube_analytics (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    snapshot_at REAL NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    likes INTEGER NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0,
    shares INTEGER NOT NULL DEFAULT 0,
    subscribers_gained INTEGER NOT NULL DEFAULT 0,
    subscribers_lost INTEGER NOT NULL DEFAULT 0,
    estimated_minutes_watched REAL NOT NULL DEFAULT 0,
    average_view_duration REAL NOT NULL DEFAULT 0,
    average_view_percentage REAL NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    impressions_ctr REAL NOT NULL DEFAULT 0,
    revenue REAL NOT NULL DEFAULT 0,
    rpm REAL NOT NULL DEFAULT 0,
    raw_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (video_id) REFERENCES youtube_videos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_yt_analytics_video ON youtube_analytics(video_id);
CREATE INDEX IF NOT EXISTS idx_yt_analytics_snapshot ON youtube_analytics(snapshot_at);
"""


# ─── Accounts ────────────────────────────────────────────────────────


async def add_account(
    db: aiosqlite.Connection,
    label: str,
    credentials_path: str,
) -> dict:
    acct_id = str(_uuid.uuid4())
    now = time.time()
    await db.execute(
        """INSERT INTO youtube_accounts (id, label, credentials_path, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)""",
        (acct_id, label, credentials_path, now, now),
    )
    await db.commit()
    return {
        "id": acct_id, "label": label, "credentials_path": credentials_path,
        "channel_id": "", "channel_title": "", "status": "active",
        "last_error": "", "created_at": now, "updated_at": now,
    }


async def get_accounts(db: aiosqlite.Connection, status: Optional[str] = None) -> list[dict]:
    query = "SELECT * FROM youtube_accounts"
    params: list = []
    if status:
        query += " WHERE status = ?"
        params.append(status)
    query += " ORDER BY created_at"
    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, r)) for r in rows]


async def get_account(db: aiosqlite.Connection, account_id: str) -> Optional[dict]:
    cursor = await db.execute("SELECT * FROM youtube_accounts WHERE id = ?", (account_id,))
    row = await cursor.fetchone()
    if not row:
        return None
    cols = [d[0] for d in cursor.description]
    return dict(zip(cols, row))


async def update_account_status(
    db: aiosqlite.Connection,
    account_id: str,
    status: str = "active",
    channel_id: Optional[str] = None,
    channel_title: Optional[str] = None,
    last_error: Optional[str] = None,
) -> bool:
    now = time.time()
    fields = ["status = ?", "updated_at = ?"]
    params: list = [status, now]
    if channel_id is not None:
        fields.append("channel_id = ?")
        params.append(channel_id)
    if channel_title is not None:
        fields.append("channel_title = ?")
        params.append(channel_title)
    if last_error is not None:
        fields.append("last_error = ?")
        params.append(last_error)
    params.append(account_id)
    cursor = await db.execute(
        f"UPDATE youtube_accounts SET {', '.join(fields)} WHERE id = ?", params,
    )
    await db.commit()
    return cursor.rowcount > 0


async def delete_account(db: aiosqlite.Connection, account_id: str) -> bool:
    cursor = await db.execute("DELETE FROM youtube_accounts WHERE id = ?", (account_id,))
    await db.commit()
    return cursor.rowcount > 0


# ─── Video records + lineage ─────────────────────────────────────────


async def create_video_record(
    db: aiosqlite.Connection,
    conversation_id: str,
    account_id: str,
    title: str = "",
    description: str = "",
    tags: Optional[list[str]] = None,
    privacy: str = "private",
    file_path: str = "",
    metadata: Optional[dict] = None,
) -> dict:
    video_id = str(_uuid.uuid4())
    now = time.time()
    tags = tags or []
    metadata = metadata or {}
    await db.execute(
        """INSERT INTO youtube_videos
             (id, conversation_id, account_id, youtube_video_id, title, description,
              tags, status, privacy, file_path, upload_progress, published_at,
              error_message, metadata, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?, 'pending', ?, ?, 0, NULL, '', ?, ?, ?)""",
        (video_id, conversation_id, account_id, title, description,
         json.dumps(tags), privacy, file_path, json.dumps(metadata), now, now),
    )
    await db.commit()
    return {
        "id": video_id, "conversation_id": conversation_id, "account_id": account_id,
        "youtube_video_id": None, "title": title, "description": description,
        "tags": tags, "status": "pending", "privacy": privacy, "file_path": file_path,
        "upload_progress": 0, "published_at": None, "error_message": "",
        "metadata": metadata, "created_at": now, "updated_at": now,
    }


async def get_video_record(db: aiosqlite.Connection, video_id: str) -> Optional[dict]:
    cursor = await db.execute("SELECT * FROM youtube_videos WHERE id = ?", (video_id,))
    row = await cursor.fetchone()
    if not row:
        return None
    cols = [d[0] for d in cursor.description]
    d = dict(zip(cols, row))
    d["tags"] = json.loads(d["tags"])
    d["metadata"] = json.loads(d["metadata"])
    return d


async def get_video_records(
    db: aiosqlite.Connection,
    account_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    query = "SELECT * FROM youtube_videos"
    params: list = []
    if account_id:
        query += " WHERE account_id = ?"
        params.append(account_id)
    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    cols = [d[0] for d in cursor.description]
    results = []
    for row in rows:
        d = dict(zip(cols, row))
        d["tags"] = json.loads(d["tags"])
        d["metadata"] = json.loads(d["metadata"])
        results.append(d)
    return results


async def update_video_status(
    db: aiosqlite.Connection,
    video_id: str,
    status: str,
    error_message: Optional[str] = None,
    published_at: Optional[float] = None,
) -> bool:
    now = time.time()
    fields = ["status = ?", "updated_at = ?"]
    params: list = [status, now]
    if error_message is not None:
        fields.append("error_message = ?")
        params.append(error_message)
    if published_at is not None:
        fields.append("published_at = ?")
        params.append(published_at)
    params.append(video_id)
    cursor = await db.execute(
        f"UPDATE youtube_videos SET {', '.join(fields)} WHERE id = ?", params,
    )
    await db.commit()
    return cursor.rowcount > 0


async def update_video_youtube_id(
    db: aiosqlite.Connection,
    video_id: str,
    youtube_video_id: str,
) -> bool:
    now = time.time()
    cursor = await db.execute(
        "UPDATE youtube_videos SET youtube_video_id = ?, updated_at = ? WHERE id = ?",
        (youtube_video_id, now, video_id),
    )
    await db.commit()
    return cursor.rowcount > 0


async def set_video_upload_progress(
    db: aiosqlite.Connection,
    video_id: str,
    progress: float,
) -> bool:
    now = time.time()
    cursor = await db.execute(
        "UPDATE youtube_videos SET upload_progress = ?, updated_at = ? WHERE id = ?",
        (progress, now, video_id),
    )
    await db.commit()
    return cursor.rowcount > 0


async def get_videos_by_conversation(
    db: aiosqlite.Connection,
    conversation_id: str,
) -> list[dict]:
    cursor = await db.execute(
        "SELECT * FROM youtube_videos WHERE conversation_id = ? ORDER BY created_at DESC",
        (conversation_id,),
    )
    rows = await cursor.fetchall()
    cols = [d[0] for d in cursor.description]
    results = []
    for row in rows:
        d = dict(zip(cols, row))
        d["tags"] = json.loads(d["tags"])
        d["metadata"] = json.loads(d["metadata"])
        results.append(d)
    return results


async def get_videos_by_status(
    db: aiosqlite.Connection,
    status: str,
) -> list[dict]:
    cursor = await db.execute(
        "SELECT * FROM youtube_videos WHERE status = ? ORDER BY updated_at DESC",
        (status,),
    )
    rows = await cursor.fetchall()
    cols = [d[0] for d in cursor.description]
    results = []
    for row in rows:
        d = dict(zip(cols, row))
        d["tags"] = json.loads(d["tags"])
        d["metadata"] = json.loads(d["metadata"])
        results.append(d)
    return results


# ─── Analytics ETL ───────────────────────────────────────────────────


async def add_analytics_snapshot(
    db: aiosqlite.Connection,
    video_id: str,
    views: int = 0,
    likes: int = 0,
    comments: int = 0,
    shares: int = 0,
    subscribers_gained: int = 0,
    subscribers_lost: int = 0,
    estimated_minutes_watched: float = 0,
    average_view_duration: float = 0,
    average_view_percentage: float = 0,
    impressions: int = 0,
    impressions_ctr: float = 0,
    revenue: float = 0,
    rpm: float = 0,
    raw_json: Optional[dict] = None,
) -> dict:
    snap_id = str(_uuid.uuid4())
    now = time.time()
    raw_json = raw_json or {}
    await db.execute(
        """INSERT INTO youtube_analytics
             (id, video_id, snapshot_at, views, likes, comments, shares,
              subscribers_gained, subscribers_lost, estimated_minutes_watched,
              average_view_duration, average_view_percentage, impressions,
              impressions_ctr, revenue, rpm, raw_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (snap_id, video_id, now, views, likes, comments, shares,
         subscribers_gained, subscribers_lost, estimated_minutes_watched,
         average_view_duration, average_view_percentage, impressions,
         impressions_ctr, revenue, rpm, json.dumps(raw_json)),
    )
    await db.commit()
    return {
        "id": snap_id, "video_id": video_id, "snapshot_at": now,
        "views": views, "likes": likes, "comments": comments, "shares": shares,
        "subscribers_gained": subscribers_gained, "subscribers_lost": subscribers_lost,
        "estimated_minutes_watched": estimated_minutes_watched,
        "average_view_duration": average_view_duration,
        "average_view_percentage": average_view_percentage,
        "impressions": impressions, "impressions_ctr": impressions_ctr,
        "revenue": revenue, "rpm": rpm, "raw_json": raw_json,
    }


async def get_analytics_snapshots(
    db: aiosqlite.Connection,
    video_id: str,
    limit: int = 100,
) -> list[dict]:
    cursor = await db.execute(
        "SELECT * FROM youtube_analytics WHERE video_id = ? ORDER BY snapshot_at DESC LIMIT ?",
        (video_id, limit),
    )
    rows = await cursor.fetchall()
    cols = [d[0] for d in cursor.description]
    results = []
    for row in rows:
        d = dict(zip(cols, row))
        d["raw_json"] = json.loads(d["raw_json"])
        results.append(d)
    return results


async def get_latest_analytics(
    db: aiosqlite.Connection,
    video_id: str,
) -> Optional[dict]:
    cursor = await db.execute(
        "SELECT * FROM youtube_analytics WHERE video_id = ? ORDER BY snapshot_at DESC LIMIT 1",
        (video_id,),
    )
    row = await cursor.fetchone()
    if not row:
        return None
    cols = [d[0] for d in cursor.description]
    d = dict(zip(cols, row))
    d["raw_json"] = json.loads(d["raw_json"])
    return d


# ─── Warehouse summary ───────────────────────────────────────────────


async def get_warehouse_summary(db: aiosqlite.Connection) -> dict:
    """Aggregate warehouse state: accounts, videos by status, total latest analytics."""
    # Accounts
    cursor = await db.execute("SELECT COUNT(*) FROM youtube_accounts")
    accounts = (await cursor.fetchone())[0]

    # Videos by status
    cursor = await db.execute(
        "SELECT status, COUNT(*) FROM youtube_videos GROUP BY status"
    )
    videos_by_status = {row[0]: row[1] for row in await cursor.fetchall()}

    # Latest analytics per video (sum of most recent snapshot per video)
    cursor = await db.execute(
        """SELECT SUM(views), SUM(likes), SUM(comments), SUM(shares),
                  SUM(estimated_minutes_watched)
           FROM (
             SELECT video_id, views, likes, comments, shares,
                    estimated_minutes_watched,
                    ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY snapshot_at DESC) AS rn
             FROM youtube_analytics
           ) WHERE rn = 1"""
    )
    row = await cursor.fetchone()
    total_views = row[0] or 0
    total_likes = row[1] or 0
    total_comments = row[2] or 0
    total_shares = row[3] or 0
    total_minutes = row[4] or 0

    return {
        "accounts": accounts,
        "videos_by_status": videos_by_status,
        "total_views": total_views,
        "total_likes": total_likes,
        "total_comments": total_comments,
        "total_shares": total_shares,
        "total_minutes_watched": total_minutes,
    }
