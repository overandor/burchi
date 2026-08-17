"""Tests for the YouTube upload + maintenance ETL warehouse layer.

Covers:
  - Multi-account management (youtube_accounts)
  - Video lineage: conversation -> video record -> YouTube video id (youtube_videos)
  - Analytics ETL: time-series snapshots pulled back from YouTube (youtube_analytics)
  - Maintenance status transitions (pending -> uploading -> uploaded -> processing -> public)
  - Provenance: every video traces back to a source conversation
"""
from __future__ import annotations

import json
import time

import aiosqlite
import pytest

from youtube_db import (
    YOUTUBE_SCHEMA,
    add_account,
    get_accounts,
    get_account,
    update_account_status,
    delete_account,
    create_video_record,
    get_video_record,
    get_video_records,
    update_video_status,
    update_video_youtube_id,
    set_video_upload_progress,
    get_videos_by_conversation,
    get_videos_by_status,
    add_analytics_snapshot,
    get_analytics_snapshots,
    get_latest_analytics,
    get_warehouse_summary,
)


async def _setup_db(db_path: str):
    """Create schema with both core ChatSync tables and YouTube warehouse tables."""
    async with aiosqlite.connect(db_path) as db:
        from db import SCHEMA as CORE_SCHEMA
        await db.executescript(CORE_SCHEMA)
        await db.executescript(YOUTUBE_SCHEMA)
        await db.commit()
        # Seed a conversation for lineage tests.
        await db.execute(
            "INSERT INTO conversations (id, source, source_id, title, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("conv-1", "live", "conv-1", "Test conversation", 0, 0),
        )
        await db.commit()


# ─── Accounts ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_add_and_list_multiple_accounts(tmp_path):
    """Multi-account: add 3 accounts, list all, each has a distinct label."""
    db_path = str(tmp_path / "test.db")
    await _setup_db(db_path)

    async with aiosqlite.connect(db_path) as db:
        a1 = await add_account(db, label="main channel", credentials_path="/secrets/main.json")
        a2 = await add_account(db, label="backup channel", credentials_path="/secrets/backup.json")
        a3 = await add_account(db, label="niche channel", credentials_path="/secrets/niche.json")

        accounts = await get_accounts(db)
        assert len(accounts) == 3
        labels = {a["label"] for a in accounts}
        assert labels == {"main channel", "backup channel", "niche channel"}
        assert all(a["status"] == "active" for a in accounts)
        assert a1["id"] != a2["id"] != a3["id"]


@pytest.mark.asyncio
async def test_get_single_account(tmp_path):
    db_path = str(tmp_path / "test.db")
    await _setup_db(db_path)

    async with aiosqlite.connect(db_path) as db:
        created = await add_account(db, label="main", credentials_path="/secrets/main.json")
        fetched = await get_account(db, created["id"])
        assert fetched is not None
        assert fetched["label"] == "main"
        assert fetched["credentials_path"] == "/secrets/main.json"


@pytest.mark.asyncio
async def test_update_account_status_and_channel(tmp_path):
    """After first OAuth, channel_id and channel_title get populated."""
    db_path = str(tmp_path / "test.db")
    await _setup_db(db_path)

    async with aiosqlite.connect(db_path) as db:
        acct = await add_account(db, label="main", credentials_path="/secrets/main.json")
        await update_account_status(
            db, acct["id"],
            status="active",
            channel_id="UC123456789",
            channel_title="My Channel",
        )
        fetched = await get_account(db, acct["id"])
        assert fetched["channel_id"] == "UC123456789"
        assert fetched["channel_title"] == "My Channel"


@pytest.mark.asyncio
async def test_account_error_status(tmp_path):
    """A revoked token marks the account as error with a message."""
    db_path = str(tmp_path / "test.db")
    await _setup_db(db_path)

    async with aiosqlite.connect(db_path) as db:
        acct = await add_account(db, label="main", credentials_path="/secrets/main.json")
        await update_account_status(db, acct["id"], status="error", last_error="Token revoked")
        fetched = await get_account(db, acct["id"])
        assert fetched["status"] == "error"
        assert fetched["last_error"] == "Token revoked"


@pytest.mark.asyncio
async def test_delete_account(tmp_path):
    db_path = str(tmp_path / "test.db")
    await _setup_db(db_path)

    async with aiosqlite.connect(db_path) as db:
        acct = await add_account(db, label="main", credentials_path="/secrets/main.json")
        assert await delete_account(db, acct["id"]) is True
        assert await get_account(db, acct["id"]) is None
        assert await delete_account(db, acct["id"]) is False


# ─── Video records + lineage ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_video_record_with_conversation_provenance(tmp_path):
    """A video record traces back to its source conversation (provenance)."""
    db_path = str(tmp_path / "test.db")
    await _setup_db(db_path)

    async with aiosqlite.connect(db_path) as db:
        acct = await add_account(db, label="main", credentials_path="/secrets/main.json")
        video = await create_video_record(
            db,
            conversation_id="conv-1",
            account_id=acct["id"],
            title="AI Conversation Breakdown",
            description="A narrated breakdown of an AI chat.",
            tags=["AI", "chatgpt", "tutorial"],
            privacy="private",
        )
        assert video["id"]
        assert video["conversation_id"] == "conv-1"
        assert video["account_id"] == acct["id"]
        assert video["status"] == "pending"
        assert video["youtube_video_id"] is None
        assert video["privacy"] == "private"
        assert video["tags"] == ["AI", "chatgpt", "tutorial"]


@pytest.mark.asyncio
async def test_video_status_transitions(tmp_path):
    """Maintenance lifecycle: pending -> uploading -> uploaded -> processing -> public."""
    db_path = str(tmp_path / "test.db")
    await _setup_db(db_path)

    async with aiosqlite.connect(db_path) as db:
        acct = await add_account(db, label="main", credentials_path="/secrets/main.json")
        video = await create_video_record(
            db, conversation_id="conv-1", account_id=acct["id"], title="Test",
        )

        for status in ("uploading", "uploaded", "processing", "public"):
            await update_video_status(db, video["id"], status=status)
            fetched = await get_video_record(db, video["id"])
            assert fetched["status"] == status


@pytest.mark.asyncio
async def test_update_youtube_video_id_after_upload(tmp_path):
    """After a successful upload, the YouTube video id is recorded."""
    db_path = str(tmp_path / "test.db")
    await _setup_db(db_path)

    async with aiosqlite.connect(db_path) as db:
        acct = await add_account(db, label="main", credentials_path="/secrets/main.json")
        video = await create_video_record(
            db, conversation_id="conv-1", account_id=acct["id"], title="Test",
        )
        await update_video_youtube_id(db, video["id"], youtube_video_id="dQw4w9WgXcQ")
        fetched = await get_video_record(db, video["id"])
        assert fetched["youtube_video_id"] == "dQw4w9WgXcQ"


@pytest.mark.asyncio
async def test_upload_progress_tracking(tmp_path):
    """Resumable upload progress is tracked as a percentage."""
    db_path = str(tmp_path / "test.db")
    await _setup_db(db_path)

    async with aiosqlite.connect(db_path) as db:
        acct = await add_account(db, label="main", credentials_path="/secrets/main.json")
        video = await create_video_record(
            db, conversation_id="conv-1", account_id=acct["id"], title="Test",
        )
        await set_video_upload_progress(db, video["id"], progress=45.5)
        fetched = await get_video_record(db, video["id"])
        assert fetched["upload_progress"] == 45.5


@pytest.mark.asyncio
async def test_get_videos_by_conversation(tmp_path):
    """One conversation can produce multiple videos (different accounts/cuts)."""
    db_path = str(tmp_path / "test.db")
    await _setup_db(db_path)

    async with aiosqlite.connect(db_path) as db:
        a1 = await add_account(db, label="main", credentials_path="/s1.json")
        a2 = await add_account(db, label="backup", credentials_path="/s2.json")

        await create_video_record(db, "conv-1", a1["id"], "Cut 1")
        await create_video_record(db, "conv-1", a2["id"], "Cut 2")

        videos = await get_videos_by_conversation(db, "conv-1")
        assert len(videos) == 2
        assert all(v["conversation_id"] == "conv-1" for v in videos)


@pytest.mark.asyncio
async def test_get_videos_by_status(tmp_path):
    """Maintenance job queries videos by status (e.g. all 'uploaded' to check processing)."""
    db_path = str(tmp_path / "test.db")
    await _setup_db(db_path)

    async with aiosqlite.connect(db_path) as db:
        acct = await add_account(db, label="main", credentials_path="/s.json")
        v1 = await create_video_record(db, "conv-1", acct["id"], "V1")
        v2 = await create_video_record(db, "conv-1", acct["id"], "V2")
        v3 = await create_video_record(db, "conv-1", acct["id"], "V3")

        await update_video_status(db, v1["id"], status="uploaded")
        await update_video_status(db, v2["id"], status="uploaded")
        await update_video_status(db, v3["id"], status="public")

        uploaded = await get_videos_by_status(db, status="uploaded")
        assert len(uploaded) == 2
        public = await get_videos_by_status(db, status="public")
        assert len(public) == 1


@pytest.mark.asyncio
async def test_video_error_recorded(tmp_path):
    """A failed upload records the error message."""
    db_path = str(tmp_path / "test.db")
    await _setup_db(db_path)

    async with aiosqlite.connect(db_path) as db:
        acct = await add_account(db, label="main", credentials_path="/s.json")
        video = await create_video_record(db, "conv-1", acct["id"], "V1")
        await update_video_status(db, video["id"], status="failed", error_message="Quota exceeded")
        fetched = await get_video_record(db, video["id"])
        assert fetched["status"] == "failed"
        assert fetched["error_message"] == "Quota exceeded"


# ─── Analytics ETL ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_analytics_snapshot_etl(tmp_path):
    """ETL pulls analytics from YouTube and stores a time-series snapshot."""
    db_path = str(tmp_path / "test.db")
    await _setup_db(db_path)

    async with aiosqlite.connect(db_path) as db:
        acct = await add_account(db, label="main", credentials_path="/s.json")
        video = await create_video_record(db, "conv-1", acct["id"], "V1")
        await update_video_youtube_id(db, video["id"], "yt-001")

        snap1 = await add_analytics_snapshot(
            db, video_id=video["id"],
            views=100, likes=10, comments=2, shares=1,
            estimated_minutes_watched=250.0,
            average_view_duration=25.0,
        )
        assert snap1["id"]
        assert snap1["views"] == 100

        # Second snapshot later — time series.
        time.sleep(0.01)
        snap2 = await add_analytics_snapshot(
            db, video_id=video["id"],
            views=250, likes=25, comments=5, shares=3,
            estimated_minutes_watched=800.0,
            average_view_duration=32.0,
        )

        snapshots = await get_analytics_snapshots(db, video_id=video["id"])
        assert len(snapshots) == 2
        # Ordered newest first.
        assert snapshots[0]["views"] == 250
        assert snapshots[1]["views"] == 100


@pytest.mark.asyncio
async def test_latest_analytics(tmp_path):
    """Maintenance job reads the most recent analytics snapshot per video."""
    db_path = str(tmp_path / "test.db")
    await _setup_db(db_path)

    async with aiosqlite.connect(db_path) as db:
        acct = await add_account(db, label="main", credentials_path="/s.json")
        video = await create_video_record(db, "conv-1", acct["id"], "V1")

        await add_analytics_snapshot(db, video["id"], views=100, likes=10)
        time.sleep(0.01)
        await add_analytics_snapshot(db, video["id"], views=500, likes=50)

        latest = await get_latest_analytics(db, video_id=video["id"])
        assert latest is not None
        assert latest["views"] == 500
        assert latest["likes"] == 50


@pytest.mark.asyncio
async def test_warehouse_summary(tmp_path):
    """Warehouse summary: account count, video counts by status, total views."""
    db_path = str(tmp_path / "test.db")
    await _setup_db(db_path)

    async with aiosqlite.connect(db_path) as db:
        a1 = await add_account(db, label="main", credentials_path="/s1.json")
        a2 = await add_account(db, label="backup", credentials_path="/s2.json")

        v1 = await create_video_record(db, "conv-1", a1["id"], "V1")
        v2 = await create_video_record(db, "conv-1", a2["id"], "V2")
        await update_video_status(db, v1["id"], status="public")
        await update_video_status(db, v2["id"], status="uploaded")
        await update_video_youtube_id(db, v1["id"], "yt-001")

        await add_analytics_snapshot(db, v1["id"], views=1000, likes=100)
        await add_analytics_snapshot(db, v1["id"], views=3000, likes=250)

        summary = await get_warehouse_summary(db)
        assert summary["accounts"] == 2
        assert summary["videos_by_status"]["public"] == 1
        assert summary["videos_by_status"]["uploaded"] == 1
        assert summary["total_views"] == 3000  # latest snapshot
        assert summary["total_likes"] == 250
