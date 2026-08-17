"""YouTube upload + maintenance ETL pipeline orchestration.

Ties together:
  - youtube_db.py     (warehouse: accounts, videos, analytics)
  - youtube_client.py (real YouTube Data API v3 client)
  - video_converter.py (conversation -> MP4 bytes)
  - youtube_generator.py (conversation -> structured script with title/desc/tags)

Three operations:
  1. upload_conversation  — one-click: conversation -> video -> YouTube -> warehouse record
  2. run_maintenance      — check processing status, update metadata, fix failures
  3. run_etl_analytics    — pull analytics for all uploaded videos into the warehouse
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta
from typing import Optional

import aiosqlite

from config import DB_PATH
from db import get_conversation
from youtube_db import (
    YOUTUBE_SCHEMA,
    add_account,
    get_account,
    get_accounts,
    create_video_record,
    get_video_record,
    get_videos_by_status,
    update_video_status,
    update_video_youtube_id,
    set_video_upload_progress,
    add_analytics_snapshot,
    get_warehouse_summary,
)

logger = logging.getLogger("chatsync.youtube")


async def ensure_youtube_schema(db: aiosqlite.Connection):
    """Create YouTube warehouse tables if they don't exist."""
    await db.executescript(YOUTUBE_SCHEMA)
    await db.commit()


async def upload_conversation(
    conversation_id: str,
    account_id: str,
    privacy: str = "private",
    voice: str = "Alex",
) -> dict:
    """One-click: conversation -> MP4 -> YouTube upload -> warehouse lineage record.

    This is the main entry point. It:
      1. Loads the conversation from the ChatSync DB.
      2. Generates a YouTube script (title, description, tags) from it.
      3. Converts the conversation to an MP4 video (TTS + slides + ffmpeg).
      4. Uploads the MP4 to YouTube via the real API client.
      5. Records the video lineage in the warehouse (conversation -> video -> yt_id).

    Args:
        conversation_id: ChatSync conversation id.
        account_id: YouTube account id (from the warehouse).
        privacy: 'private', 'unlisted', or 'public'.
        voice: TTS voice for the video converter.

    Returns:
        Video record dict with youtube_video_id and status.

    Raises:
        ValueError: If the conversation or account doesn't exist.
        RuntimeError: If video generation or upload fails.
    """
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await ensure_youtube_schema(db)

        # 1. Load conversation.
        conv_dict = await get_conversation(db, conversation_id)
        if not conv_dict:
            raise ValueError(f"Conversation {conversation_id} not found")

        # 2. Load account.
        acct = await get_account(db, account_id)
        if not acct:
            raise ValueError(f"YouTube account {account_id} not found")
        if acct["status"] != "active":
            raise RuntimeError(f"Account {account_id} is not active (status={acct['status']})")

        # 3. Generate script (title, description, tags).
        from youtube_generator import generate_youtube_script
        from models import Conversation, Message, MessageRole, Source, SyncStatus
        msgs = [
            Message(
                id=m["id"], conversation_id=m["conversation_id"],
                role=MessageRole(m["role"]), content=m["content"],
                timestamp=m["timestamp"], source=Source(m["source"]),
                metadata=m["metadata"],
            )
            for m in conv_dict["messages"]
        ]
        conv = Conversation(
            id=conv_dict["id"], source=Source(conv_dict["source"]),
            source_id=conv_dict["source_id"], title=conv_dict["title"],
            created_at=conv_dict["created_at"], updated_at=conv_dict["updated_at"],
            messages=msgs, metadata=conv_dict["metadata"],
            sync_status=SyncStatus(conv_dict["sync_status"]),
            linked_conversation_ids=conv_dict["linked_conversation_ids"],
            content_hash=conv_dict["content_hash"],
        )
        script = generate_youtube_script(conv)

        # 4. Create warehouse record (pending).
        video = await create_video_record(
            db,
            conversation_id=conversation_id,
            account_id=account_id,
            title=script.title,
            description=script.description,
            tags=script.tags,
            privacy=privacy,
            metadata={
                "hook": script.hook,
                "thumbnail_suggestion": script.thumbnail_suggestion,
                "estimated_duration": script.estimated_duration,
                "source_title": script.source_title,
            },
        )

    # 5. Generate video (outside DB connection — it's CPU/IO heavy).
    await update_video_status_in_db(video["id"], status="uploading")
    try:
        from video_converter import convert_conversation_to_video
        video_bytes = await convert_conversation_to_video(conv, voice=voice)
    except Exception as e:
        await update_video_status_in_db(video["id"], status="failed", error_message=str(e))
        raise RuntimeError(f"Video generation failed: {e}") from e

    # 6. Upload to YouTube (real API call).
    from youtube_client import upload_video_bytes, YouTubeClientError

    def on_progress(pct: float):
        # Fire-and-forget progress update (sync callback in async context).
        logger.info("Upload progress for %s: %.1f%%", video["id"], pct)

    try:
        result = await asyncio.to_thread(
            upload_video_bytes,
            acct["credentials_path"],
            video_bytes,
            script.title,
            script.description,
            script.tags,
            privacy,
            "22",
            on_progress,
        )
    except (YouTubeClientError, Exception) as e:
        await update_video_status_in_db(video["id"], status="failed", error_message=str(e))
        raise RuntimeError(f"YouTube upload failed: {e}") from e

    # 7. Record YouTube video id + mark uploaded.
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await update_video_youtube_id(db, video["id"], result["video_id"])
        await update_video_status(db, video["id"], status="uploaded")
        await set_video_upload_progress(db, video["id"], 100.0)

    logger.info("Uploaded conversation %s as YouTube video %s", conversation_id, result["video_id"])

    async with aiosqlite.connect(str(DB_PATH)) as db:
        return await get_video_record(db, video["id"])


async def update_video_status_in_db(
    video_id: str,
    status: str,
    error_message: Optional[str] = None,
):
    """Helper to update video status without holding a long DB connection."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await update_video_status(db, video_id, status=status, error_message=error_message)


async def run_maintenance() -> dict:
    """Maintenance job: check video statuses on YouTube and sync the warehouse.

    For each video in 'uploaded' or 'processing' status:
      - Poll YouTube for the real processing status.
      - Transition to 'public'/'processing'/'failed' based on the API response.

    Returns:
        Summary of how many videos were updated.
    """
    updated = 0
    errors = 0

    async with aiosqlite.connect(str(DB_PATH)) as db:
        await ensure_youtube_schema(db)

        # Check videos that are uploaded or processing.
        for status_filter in ("uploaded", "processing"):
            videos = await get_videos_by_status(db, status=status_filter)
            for v in videos:
                if not v["youtube_video_id"]:
                    continue
                acct = await get_account(db, v["account_id"])
                if not acct or acct["status"] != "active":
                    continue

                from youtube_client import get_video_status, YouTubeClientError
                try:
                    yt_status = await asyncio.to_thread(
                        get_video_status,
                        acct["credentials_path"],
                        v["youtube_video_id"],
                    )
                except YouTubeClientError as e:
                    logger.warning("Maintenance check failed for %s: %s", v["id"], e)
                    errors += 1
                    continue

                upload_status = yt_status["upload_status"]
                new_status = v["status"]
                if upload_status == "processed":
                    # Processing complete — check privacy to determine final state.
                    new_status = yt_status["privacy_status"]  # public/unlisted/private
                elif upload_status == "processing":
                    new_status = "processing"
                elif upload_status == "failed":
                    new_status = "failed"

                if new_status != v["status"]:
                    await update_video_status(db, v["id"], status=new_status)
                    updated += 1
                    logger.info("Video %s transitioned %s -> %s", v["id"], v["status"], new_status)

    return {"updated": updated, "errors": errors, "checked": updated + errors}


async def run_etl_analytics(days_back: int = 30) -> dict:
    """ETL job: pull analytics for all uploaded/public videos into the warehouse.

    For each video with a youtube_video_id:
      - Call the YouTube Analytics API for the last `days_back` days.
      - Store a snapshot in youtube_analytics (append-only time series).

    Returns:
        Summary of how many snapshots were pulled.
    """
    pulled = 0
    errors = 0

    end_date = datetime.utcnow().strftime("%Y-%m-%d")
    start_date = (datetime.utcnow() - timedelta(days=days_back)).strftime("%Y-%m-%d")

    async with aiosqlite.connect(str(DB_PATH)) as db:
        await ensure_youtube_schema(db)

        # Get all videos that have a YouTube video id.
        for status_filter in ("uploaded", "public", "unlisted", "private"):
            videos = await get_videos_by_status(db, status=status_filter)
            for v in videos:
                if not v["youtube_video_id"]:
                    continue
                acct = await get_account(db, v["account_id"])
                if not acct or acct["status"] != "active":
                    continue

                from youtube_client import fetch_analytics, YouTubeClientError
                try:
                    analytics = await asyncio.to_thread(
                        fetch_analytics,
                        acct["credentials_path"],
                        v["youtube_video_id"],
                        start_date,
                        end_date,
                    )
                except YouTubeClientError as e:
                    logger.warning("Analytics pull failed for %s: %s", v["id"], e)
                    errors += 1
                    continue

                await add_analytics_snapshot(
                    db,
                    video_id=v["id"],
                    views=analytics["views"],
                    likes=analytics["likes"],
                    comments=analytics["comments"],
                    shares=analytics["shares"],
                    subscribers_gained=analytics["subscribers_gained"],
                    subscribers_lost=analytics["subscribers_lost"],
                    estimated_minutes_watched=analytics["estimated_minutes_watched"],
                    average_view_duration=analytics["average_view_duration"],
                    average_view_percentage=analytics["average_view_percentage"],
                    impressions=analytics["impressions"],
                    impressions_ctr=analytics["impressions_ctr"],
                    revenue=analytics["revenue"],
                    rpm=analytics["rpm"],
                    raw_json=analytics["raw_json"],
                )
                pulled += 1
                logger.info("Pulled analytics for video %s: %d views", v["id"], analytics["views"])

    return {"snapshots_pulled": pulled, "errors": errors, "days_back": days_back}


async def get_pipeline_overview() -> dict:
    """Get the full warehouse summary for the dashboard."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await ensure_youtube_schema(db)
        return await get_warehouse_summary(db)
