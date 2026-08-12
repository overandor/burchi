from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from pydantic import BaseModel
from typing import Optional
import aiosqlite

sys.path.insert(0, str(Path(__file__).parent))

from db import (
    DB_PATH,
    init_db,
    get_conversations,
    get_conversation,
    search_messages,
    delete_conversation,
    get_sync_groups,
)
from sync_engine import SyncEngine
from context_store import ContextStore
from models import Source
from adapters.live_adapter import live_adapter, build_message
from db import upsert_conversation

app = FastAPI(title="ChatSync", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

sync_engine = SyncEngine(str(DB_PATH))
context_store = ContextStore(str(DB_PATH))

# Pydantic models for request bodies
class ContextRequest(BaseModel):
    key: str
    value: str
    source: str = "unknown"
    tags: list[str] = []

class SyncGroupRequest(BaseModel):
    conversation_ids: list[str]
    name: str = ""

class ExportRequest(BaseModel):
    format: str = "json"
    conversation_id: Optional[str] = None


class LiveMessageIn(BaseModel):
    role: str
    content: str
    timestamp: float


class LiveIngestRequest(BaseModel):
    conversation_id: str
    title: str = ""
    messages: list[LiveMessageIn]
    created_at: Optional[float] = None


class CrawlSeedQuery(BaseModel):
    limit: int = 50
    source: Optional[str] = None
    since: str = ""


_db_initialized = False

async def ensure_db():
    global _db_initialized
    if not _db_initialized:
        await init_db()
        _db_initialized = True


@app.get("/api/health")
async def health():
    await ensure_db()
    return {"status": "ok", "timestamp": time.time()}


@app.get("/api/conversations")
async def list_conversations(
    source: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    include_messages: bool = False,
):
    await ensure_db()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        return await get_conversations(db, source=source, limit=limit, offset=offset, include_messages=include_messages)


@app.get("/api/conversations/{conv_id}")
async def get_single_conversation(conv_id: str):
    await ensure_db()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        conv = await get_conversation(db, conv_id)
        if not conv:
            raise HTTPException(404, "Conversation not found")
        return conv


@app.delete("/api/conversations/{conv_id}")
async def delete_conv(conv_id: str):
    await ensure_db()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        if not await delete_conversation(db, conv_id):
            raise HTTPException(404, "Conversation not found")
        return {"deleted": True}


@app.get("/api/search")
async def search(q: str, limit: int = 50):
    await ensure_db()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        return await search_messages(db, q, limit)


@app.post("/api/sync")
async def sync():
    await ensure_db()
    return await sync_engine.sync_all()


@app.get("/api/sync/status")
async def sync_status():
    await ensure_db()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        from db import get_sync_state
        last = await get_sync_state(db, "last_sync")
        convs = await get_conversations(db, limit=10000)
        by_source = {}
        for c in convs:
            by_source[c["source"]] = by_source.get(c["source"], 0) + 1
        return {
            "last_sync": float(last) if last else None,
            "total_conversations": len(convs),
            "by_source": by_source,
        }


@app.post("/api/sync-groups")
async def create_sync_group(req: SyncGroupRequest):
    await ensure_db()
    group = await sync_engine.create_sync_group(req.conversation_ids, req.name)
    return group.to_dict()


@app.get("/api/sync-groups")
async def list_sync_groups():
    await ensure_db()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        return await get_sync_groups(db)


# Context endpoints
@app.get("/api/context")
async def get_context(tag: Optional[str] = None):
    await ensure_db()
    return await context_store.get_entries(tag)


@app.post("/api/context")
async def add_context(req: ContextRequest):
    await ensure_db()
    source = Source(req.source) if req.source in [s.value for s in Source] else Source.UNKNOWN
    entry = await context_store.add_entry(req.key, req.value, source, req.tags)
    return entry.to_dict()


@app.delete("/api/context/{key}")
async def delete_context(key: str):
    await ensure_db()
    if not await context_store.delete_entry(key):
        raise HTTPException(404, "Context entry not found")
    return {"deleted": True}


@app.get("/api/context/export")
async def export_context():
    await ensure_db()
    data = await context_store.export_context_json()
    return PlainTextResponse(data, media_type="application/json")


# Export endpoints
@app.post("/api/export")
async def export(req: ExportRequest):
    await ensure_db()
    if req.conversation_id:
        data = await sync_engine.export_conversation(req.conversation_id, req.format)
        if data is None:
            raise HTTPException(404, "Conversation not found")
    else:
        data = await sync_engine.export_all(req.format)

    if req.format == "markdown":
        return PlainTextResponse(data, media_type="text/markdown")
    return PlainTextResponse(data, media_type="application/json")


# ─── Pipeline endpoints ───────────────────────────────────────────
class PipelineRequest(BaseModel):
    since: str = ""
    limit: int = 0
    no_sync: bool = False
    no_llm: bool = False
    no_prior_art: bool = False
    dry_run: bool = False


@app.post("/api/pipeline/run")
async def run_pipeline_endpoint(req: PipelineRequest):
    """Run the full analysis pipeline: disassemble → prior art → recommend → write outputs."""
    await ensure_db()
    from pipeline.runner import run_pipeline
    import argparse
    args = argparse.Namespace(
        no_sync=req.no_sync, since=req.since, limit=req.limit,
        no_llm=req.no_llm, no_prior_art=req.no_prior_art, dry_run=req.dry_run,
        scrape_chatgpt=False, headless=False,
    )
    result = await run_pipeline(args)
    return result


@app.get("/api/pipeline/recommendations")
async def list_recommendations():
    """List recommendations from the pipeline ledger."""
    from pipeline.outputs import DEFAULT_PIPELINE_LEDGER
    if not DEFAULT_PIPELINE_LEDGER.exists():
        return []
    import json as _json
    records = []
    for line in DEFAULT_PIPELINE_LEDGER.read_text(encoding="utf-8").splitlines():
        if line.strip():
            try:
                records.append(_json.loads(line))
            except _json.JSONDecodeError:
                continue
    return records


# ─── Live session ingest ───────────────────────────────────────────
@app.post("/api/live")
async def live_ingest(req: LiveIngestRequest):
    """Stream a live chat transcript into the unified DB.

    Idempotent: pushing the same conversation_id with the same messages
    upserts (no duplicates). Each push replaces the buffered message list
    for that conversation, so send the full current transcript each call.
    """
    await ensure_db()
    if not req.messages:
        raise HTTPException(400, "messages must be a non-empty list")
    conv_id = f"live:{req.conversation_id}"
    try:
        msgs = [
            build_message(m.role, m.content, m.timestamp, conversation_id=conv_id)
            for m in req.messages
        ]
    except ValueError as e:
        raise HTTPException(422, str(e))

    conv = live_adapter.ingest(
        source_id=req.conversation_id,
        title=req.title or f"Live session {req.conversation_id}",
        messages=msgs,
        created_at=req.created_at,
    )
    # Durable write immediately.
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await upsert_conversation(db, conv)
    return conv.to_dict()


# ─── Crawler seed API ──────────────────────────────────────────────
def _parse_since_window(since: str) -> float:
    import re
    if not since:
        return 0.0
    m = re.fullmatch(r"(\d+)([smhdw])", since)
    if not m:
        return 0.0
    n, unit = int(m.group(1)), m.group(2)
    mult = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}[unit]
    return time.time() - n * mult


@app.get("/api/crawl/seed")
async def crawl_seed(limit: int = 50, source: Optional[str] = None, since: str = ""):
    """Return ranked keyword seeds derived from stored conversations.

    An external crawler (e.g. SixBrowse) polls this to drive query evolution:
    each seed is a topical keyword with provenance (conversation id + source)
    and a frequency score.
    """
    await ensure_db()
    from pipeline.disassembly import _extract_keywords
    since_ts = _parse_since_window(since)
    async with aiosqlite.connect(str(DB_PATH)) as db:
        query = "SELECT id, source, title FROM conversations"
        params: list = []
        if source:
            query += " WHERE source = ?"
            params.append(source)
            if since_ts:
                query += " AND updated_at > ?"
                params.append(since_ts)
        elif since_ts:
            query += " WHERE updated_at > ?"
            params.append(since_ts)
        query += " ORDER BY updated_at DESC LIMIT 500"
        cursor = await db.execute(query, params)
        conv_rows = await cursor.fetchall()

        freq: dict[str, int] = {}
        provenance: dict[str, list[dict]] = {}
        for conv_id, conv_source, title in conv_rows:
            mcursor = await db.execute(
                "SELECT content FROM messages WHERE conversation_id = ?",
                (conv_id,),
            )
            for (content,) in await mcursor.fetchall():
                if not content:
                    continue
                for kw in _extract_keywords(content, max_keywords=6):
                    freq[kw] = freq.get(kw, 0) + 1
                    provenance.setdefault(kw, []).append(
                        {"conversation_id": conv_id, "source": conv_source, "title": title}
                    )

    ranked = sorted(freq.items(), key=lambda x: (-x[1], x[0]))[:limit]
    seeds = [
        {
            "keyword": kw,
            "score": count,
            "provenance": provenance[kw][:5],
        }
        for kw, count in ranked
    ]
    return {
        "seeds": seeds,
        "count": len(seeds),
        "scanned_conversations": len(conv_rows),
        "since": since or "all",
    }


@app.get("/api/crawl/processes")
async def crawl_processes(limit: int = 0, since: str = "", no_llm: bool = True):
    """Return business-process seeds for a crawler.

    Runs the deterministic disassembly pass over recent conversations and
    returns structured processes (category + keywords + description) that a
    crawler can turn into targeted discovery queries. Defaults to no-LLM for
    speed and determinism.
    """
    await ensure_db()
    from pipeline.disassembly import disassemble_conversations, cluster_processes
    since_ts = _parse_since_window(since)
    processes = await disassemble_conversations(
        str(DB_PATH), since_ts=since_ts, limit=limit, use_llm=not no_llm
    )
    clusters = cluster_processes(processes)
    return {
        "processes": [p.to_dict() for p in processes],
        "count": len(processes),
        "clusters": {cat: len(bps) for cat, bps in clusters.items()},
        "since": since or "all",
    }


# ─── Video converter (chat -> MP4) ─────────────────────────────────
class VideoConvertRequest(BaseModel):
    conversation_id: str
    voice: str = "Alex"


@app.post("/api/video/convert")
async def convert_conversation_to_video(req: VideoConvertRequest):
    """Convert a conversation into an MP4 video with TTS narration + slides.

    Requires ffmpeg, say (macOS), and Pillow on the backend.
    Returns the video file as application/octet-stream.
    """
    await ensure_db()
    from video_converter import convert_conversation_to_video as _convert
    from models import Conversation, Message, MessageRole, Source, SyncStatus

    # Validate voice.
    valid_voices = {"Alex", "Samantha", "Daniel", "Karen", "Tom", "Moira", "Tessa"}
    if req.voice not in valid_voices:
        raise HTTPException(422, f"Invalid voice. Must be one of: {sorted(valid_voices)}")

    # Fetch conversation.
    async with aiosqlite.connect(str(DB_PATH)) as db:
        conv_row = await get_conversation(db, req.conversation_id)
    if not conv_row:
        raise HTTPException(404, "Conversation not found")

    # Reconstruct Conversation object.
    conv = Conversation(
        id=conv_row["id"],
        source=Source(conv_row["source"]),
        source_id=conv_row["source_id"],
        title=conv_row["title"],
        created_at=conv_row["created_at"],
        updated_at=conv_row["updated_at"],
        messages=[
            Message(
                id=m["id"],
                conversation_id=m["conversation_id"],
                role=MessageRole(m["role"]),
                content=m["content"],
                timestamp=m["timestamp"],
                source=Source(m["source"]),
                metadata=m["metadata"] if isinstance(m["metadata"], dict) else (json.loads(m["metadata"]) if m["metadata"] else {}),
            )
            for m in conv_row.get("messages", [])
        ],
        metadata=conv_row.get("metadata", {}) or {},
        sync_status=SyncStatus.SYNCED,
        linked_conversation_ids=conv_row.get("linked_conversation_ids", []),
        content_hash=conv_row.get("content_hash", ""),
    )

    try:
        video_bytes = await _convert(conv, voice=req.voice)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        raise HTTPException(500, f"Video generation failed: {e}")

    # Clean filename.
    safe_title = re.sub(r"[^a-zA-Z0-9]", "_", conv.title or "chat")[:60]
    return Response(
        content=video_bytes,
        media_type="video/mp4",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.mp4"'},
    )


@app.get("/api/video/voices")
async def list_voices():
    """List available TTS voices for video conversion."""
    return {
        "voices": ["Alex", "Samantha", "Daniel", "Karen", "Tom", "Moira", "Tessa"],
        "requires": ["ffmpeg", "say (macOS)", "Pillow"],
    }


# ─── YouTube script generator ──────────────────────────────────────
class YouTubeScriptRequest(BaseModel):
    conversation_id: str
    format: str = "json"  # "json" | "markdown" | "srt"


@app.post("/api/youtube-script")
async def generate_youtube_script(req: YouTubeScriptRequest):
    """Convert a conversation into a structured YouTube video script."""
    await ensure_db()
    from youtube_generator import generate_youtube_script as _generate
    from models import Conversation, Message, MessageRole, Source, SyncStatus
    async with aiosqlite.connect(str(DB_PATH)) as db:
        conv_row = await get_conversation(db, req.conversation_id)
    if not conv_row:
        raise HTTPException(404, "Conversation not found")
    # Reconstruct a Conversation object from the dict.
    conv = Conversation(
        id=conv_row["id"],
        source=Source(conv_row["source"]),
        source_id=conv_row["source_id"],
        title=conv_row["title"],
        created_at=conv_row["created_at"],
        updated_at=conv_row["updated_at"],
        messages=[
            Message(
                id=m["id"],
                conversation_id=m["conversation_id"],
                role=MessageRole(m["role"]),
                content=m["content"],
                timestamp=m["timestamp"],
                source=Source(m["source"]),
                metadata=m["metadata"] if isinstance(m["metadata"], dict) else (json.loads(m["metadata"]) if m["metadata"] else {}),
            )
            for m in conv_row.get("messages", [])
        ],
        metadata=conv_row.get("metadata", {}) or {},
        sync_status=SyncStatus.SYNCED,
        linked_conversation_ids=conv_row.get("linked_conversation_ids", []),
        content_hash=conv_row.get("content_hash", ""),
    )
    try:
        script = _generate(conv)
    except ValueError as e:
        raise HTTPException(422, str(e))

    if req.format == "markdown":
        md = _script_to_markdown(script)
        return PlainTextResponse(md, media_type="text/markdown")
    elif req.format == "srt":
        srt = _script_to_srt(script)
        return PlainTextResponse(srt, media_type="text/plain")
    return script.to_dict()


def _script_to_markdown(script) -> str:
    lines = [
        f"# {script.title}",
        f"",
        f"**Estimated duration:** {script.estimated_duration}",
        f"**Source:** {script.source_title}",
        f"**Messages:** {script.message_count}",
        f"",
        f"## Hook (0:00–0:15)",
        f"",
        f"> {script.hook}",
        f"",
        f"## Description",
        f"",
        script.description,
        f"",
        f"## Tags",
        f"",
        ", ".join(f"#{t}" for t in script.tags),
        f"",
        f"## Scenes",
        f"",
    ]
    for s in script.scenes:
        lines.extend([
            f"### Scene {s.scene_number} ({s.start_time}–{s.end_time})",
            f"",
            f"**Visual:** {s.visual}",
            f"",
            f"**Narration:** {s.narration}",
            f"",
            f"**Text overlay:** {s.text_overlay}",
            f"",
        ])
    lines.extend([
        f"## Outro ({script.estimated_duration.split(':')[0]}:{script.estimated_duration.split(':')[1]})",
        f"",
        f"> {script.outro}",
        f"",
        f"## Thumbnail Suggestion",
        f"",
        script.thumbnail_suggestion,
    ])
    return "\n".join(lines)


def _script_to_srt(script) -> str:
    entries = []
    for i, s in enumerate(script.scenes, 1):
        start = s.start_time
        # Convert end_time to SRT format (0:00 -> 00:00:00,000)
        def to_srt(t):
            parts = t.split(":")
            m = int(parts[0])
            sec = int(parts[1]) if len(parts) > 1 else 0
            return f"00:{m:02d}:{sec:02d},000"
        entries.append(f"{i}\n{to_srt(start)} --> {to_srt(s.end_time)}\n{s.narration}\n")
    return "\n".join(entries)


# Serve frontend (static files)
FRONTEND_DIR = Path(__file__).parent.parent / "frontend" / "dist"

@app.get("/{path:path}")
async def serve_frontend(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "Not found")
    file_path = FRONTEND_DIR / path
    if file_path.exists() and file_path.is_file():
        return Response(content=file_path.read_bytes(), media_type=_guess_mime(path))
    index = FRONTEND_DIR / "index.html"
    if index.exists():
        return HTMLResponse(index.read_text(encoding="utf-8"))
    return HTMLResponse("<h1>ChatSync API</h1><p>Frontend not built. Run <code>npm run build</code> in frontend/</p>")


def _guess_mime(path: str) -> str:
    ext = Path(path).suffix.lower()
    return {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
    }.get(ext, "application/octet-stream")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
