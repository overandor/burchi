from __future__ import annotations

import asyncio
import json
import logging
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

from config import CORS_ORIGINS, HOST, PORT, LOG_LEVEL, MAX_PAGE_LIMIT, DEFAULT_PAGE_LIMIT, SYNC_TIMEOUT_SECONDS, API_KEY
from db import (
    DB_PATH,
    init_db,
    get_conversations,
    get_conversation,
    search_messages,
    delete_conversation,
    get_sync_groups,
    upsert_heartbeat,
    get_heartbeats,
    delete_heartbeat,
    HEARTBEAT_DEFAULT_TTL,
    create_derived_path,
    get_derived_paths,
    delete_derived_path,
    extract_tool,
    get_extracted_tools,
    delete_extracted_tool,
)
from sync_engine import SyncEngine
from context_store import ContextStore
from models import Source
from adapters.live_adapter import live_adapter, build_message
from db import upsert_conversation

# ─── Logging ───────────────────────────────────────────────────────
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("chatsync")

app = FastAPI(
    title="ChatSync",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

sync_engine = SyncEngine(str(DB_PATH))
context_store = ContextStore(str(DB_PATH))
logger.info("ChatSync backend starting | DB: %s | CORS: %s", DB_PATH, CORS_ORIGINS)

# ─── Basic rate limiting ───────────────────────────────────────────
_RATE_LIMIT = int(os.environ.get("CHATSYNC_RATE_LIMIT", "0"))  # 0 = disabled
_rate_buckets: dict[str, list[float]] = {}

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if _RATE_LIMIT > 0:
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        window = 60.0
        hits = _rate_buckets.get(client_ip, [])
        hits = [t for t in hits if now - t < window]
        if len(hits) >= _RATE_LIMIT:
            return Response(
                content=json.dumps({"detail": "Rate limit exceeded"}),
                media_type="application/json",
                status_code=429,
            )
        hits.append(now)
        _rate_buckets[client_ip] = hits
    return await call_next(request)


# ─── API key auth ───────────────────────────────────────────────────
# If CHATSYNC_API_KEY is set, all /api/* requests must include
# X-API-Key: <key> header. Health check and docs are exempt.
_PUBLIC_PATHS = {"/api/health", "/api/docs", "/api/openapi.json", "/"}

@app.middleware("http")
async def api_key_auth(request: Request, call_next):
    if API_KEY and request.url.path.startswith("/api/") and request.url.path not in _PUBLIC_PATHS:
        provided = request.headers.get("X-API-Key", "")
        if provided != API_KEY:
            return Response(
                content=json.dumps({"detail": "Invalid or missing API key"}),
                media_type="application/json",
                status_code=401,
            )
    return await call_next(request)


def _clamp_limit(limit: int) -> int:
    if limit < 1:
        return DEFAULT_PAGE_LIMIT
    return min(limit, MAX_PAGE_LIMIT)


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


@app.middleware("http")
async def error_handler(request: Request, call_next):
    try:
        return await call_next(request)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return Response(
            content=json.dumps({"detail": "Internal server error"}),
            media_type="application/json",
            status_code=500,
        )


@app.get("/api/health")
async def health():
    await ensure_db()
    return {"status": "ok", "timestamp": time.time(), "version": app.version}


@app.get("/api/conversations")
async def list_conversations(
    source: Optional[str] = None,
    limit: int = DEFAULT_PAGE_LIMIT,
    offset: int = 0,
    include_messages: bool = False,
):
    await ensure_db()
    limit = _clamp_limit(limit)
    offset = max(offset, 0)
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute("PRAGMA foreign_keys=ON")
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
    if not q or not q.strip():
        raise HTTPException(400, "Query parameter 'q' is required")
    limit = _clamp_limit(limit)
    async with aiosqlite.connect(str(DB_PATH)) as db:
        return await search_messages(db, q, limit)


@app.post("/api/sync")
async def sync():
    await ensure_db()
    logger.info("Starting full sync")
    try:
        result = await asyncio.wait_for(sync_engine.sync_all(), timeout=SYNC_TIMEOUT_SECONDS)
        logger.info("Sync complete: %d synced, %d errors", result.get("synced", 0), len(result.get("errors", [])))
        return result
    except asyncio.TimeoutError:
        logger.error("Sync timed out after %ds", SYNC_TIMEOUT_SECONDS)
        raise HTTPException(504, "Sync timed out")


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
    raw = await asyncio.to_thread(DEFAULT_PIPELINE_LEDGER.read_text, "utf-8")
    records = []
    for line in raw.splitlines():
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


# ─── Heartbeat protocol ──────────────────────────────────────────────
class HeartbeatRequest(BaseModel):
    session_id: str
    agent: str = "unknown"
    active_task: str = ""
    status: str = "running"
    task_status: str = "IN_PROGRESS"
    blockers: list[str] = []
    next_action: str = ""
    commit_sha: str = ""
    heartbeat_sequence: int = 0
    payload: dict = {}


@app.post("/api/heartbeat")
async def post_heartbeat(req: HeartbeatRequest):
    """Post a chat heartbeat. Other chats read /api/heartbeats to coordinate.

    Each chat should post every few minutes. Stale heartbeats (older than TTL)
    are automatically pruned on read. Send the full current state each call —
    it's an upsert, not an append.
    """
    await ensure_db()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        return await upsert_heartbeat(
            db,
            session_id=req.session_id,
            agent=req.agent,
            active_task=req.active_task,
            status=req.status,
            task_status=req.task_status,
            blockers=req.blockers,
            next_action=req.next_action,
            commit_sha=req.commit_sha,
            heartbeat_sequence=req.heartbeat_sequence,
            payload=req.payload,
        )


@app.get("/api/heartbeats")
async def list_heartbeats(active_only: bool = True, ttl: int = HEARTBEAT_DEFAULT_TTL):
    """List all sibling chat heartbeats. Stale ones are auto-pruned.

    Any chat can read this to see what its siblings are working on,
    their blockers, and next actions — enabling cohesive correspondence
    without mixing chat contexts.
    """
    await ensure_db()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        beats = await get_heartbeats(db, active_only=active_only, ttl=ttl)
        return {
            "heartbeats": beats,
            "count": len(beats),
            "ttl_seconds": ttl,
        }


@app.delete("/api/heartbeat/{session_id}")
async def remove_heartbeat(session_id: str):
    """Manually remove a chat's heartbeat (e.g. on clean exit)."""
    await ensure_db()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        if not await delete_heartbeat(db, session_id):
            raise HTTPException(404, "Heartbeat not found")
        return {"deleted": True}


# ─── Derived paths (antagonistic branches) ──────────────────────────
class DerivedPathRequest(BaseModel):
    parent_conversation_id: str
    child_conversation_id: str
    label: str = ""
    antagonism: str = "neutral"


@app.post("/api/paths/derive")
async def derive_path(req: DerivedPathRequest):
    """Derive an antagonistic path from one chat to another.

    antagonism values: 'neutral', 'opposing', 'complementary', 'divergent'
    The label describes the angle (e.g. "security audit angle", "performance angle").
    """
    await ensure_db()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        return await create_derived_path(
            db,
            parent_conversation_id=req.parent_conversation_id,
            child_conversation_id=req.child_conversation_id,
            label=req.label,
            antagonism=req.antagonism,
        )


@app.get("/api/paths")
async def list_paths(conversation_id: str | None = None, direction: str = "children"):
    """List derived paths. Filter by conversation_id as parent (children) or child (parents)."""
    await ensure_db()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        paths = await get_derived_paths(db, conversation_id=conversation_id, direction=direction)
        return {"paths": paths, "count": len(paths)}


@app.delete("/api/paths/{path_id}")
async def remove_path(path_id: str):
    await ensure_db()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        if not await delete_derived_path(db, path_id):
            raise HTTPException(404, "Path not found")
        return {"deleted": True}


# ─── Extracted tools (reusable artifacts from chats) ────────────────
class ExtractToolRequest(BaseModel):
    source_conversation_id: str
    tool_type: str = "snippet"
    name: str = ""
    language: str = ""
    content: str = ""
    summary: str = ""
    tags: list[str] = []


@app.post("/api/tools/extract")
async def extract_tool_endpoint(req: ExtractToolRequest):
    """Extract a reusable tool/artifact from a chat without importing the full conversation.

    tool_type: 'snippet', 'function', 'pattern', 'decision', 'config', 'prompt'
    The tool is stored independently and can be referenced by any other path.
    """
    await ensure_db()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        return await extract_tool(
            db,
            source_conversation_id=req.source_conversation_id,
            tool_type=req.tool_type,
            name=req.name,
            language=req.language,
            content=req.content,
            summary=req.summary,
            tags=req.tags,
        )


@app.get("/api/tools")
async def list_tools(
    conversation_id: str | None = None,
    tool_type: str | None = None,
    tag: str | None = None,
):
    """List extracted tools. Filter by source conversation, type, or tag."""
    await ensure_db()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        tools = await get_extracted_tools(db, conversation_id=conversation_id, tool_type=tool_type, tag=tag)
        return {"tools": tools, "count": len(tools)}


@app.delete("/api/tools/{tool_id}")
async def remove_tool(tool_id: str):
    await ensure_db()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        if not await delete_extracted_tool(db, tool_id):
            raise HTTPException(404, "Tool not found")
        return {"deleted": True}


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
    limit = _clamp_limit(limit)
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


# ─── YouTube upload + maintenance ETL pipeline ──────────────────────
class YouTubeAccountRequest(BaseModel):
    label: str
    credentials_path: str


class YouTubeUploadRequest(BaseModel):
    conversation_id: str
    account_id: str
    privacy: str = "private"
    voice: str = "Alex"


@app.post("/api/youtube/accounts")
async def add_youtube_account(req: YouTubeAccountRequest):
    """Register a YouTube account (multi-account support).

    credentials_path must point to a client_secrets.json downloaded from
    Google Cloud Console (YouTube Data API v3 enabled).
    """
    await ensure_db()
    from youtube_db import add_account, YOUTUBE_SCHEMA
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.executescript(YOUTUBE_SCHEMA)
        await db.commit()
        account = await add_account(db, label=req.label, credentials_path=req.credentials_path)
    return account


@app.get("/api/youtube/accounts")
async def list_youtube_accounts():
    """List all registered YouTube accounts."""
    await ensure_db()
    from youtube_db import get_accounts, YOUTUBE_SCHEMA
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.executescript(YOUTUBE_SCHEMA)
        await db.commit()
        accounts = await get_accounts(db)
    return {"accounts": accounts, "count": len(accounts)}


@app.delete("/api/youtube/accounts/{account_id}")
async def remove_youtube_account(account_id: str):
    await ensure_db()
    from youtube_db import delete_account, get_account, YOUTUBE_SCHEMA
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.executescript(YOUTUBE_SCHEMA)
        await db.commit()
        if not await get_account(db, account_id):
            raise HTTPException(404, "Account not found")
        await delete_account(db, account_id)
    return {"deleted": True}


@app.post("/api/youtube/accounts/{account_id}/verify")
async def verify_youtube_account(account_id: str):
    """Verify account credentials by fetching channel info from YouTube.

    This triggers the OAuth flow on first run (browser prompt).
    Updates the account with channel_id and channel_title on success.
    """
    await ensure_db()
    from youtube_db import get_account, update_account_status, YOUTUBE_SCHEMA
    from youtube_client import get_channel_info, YouTubeClientError
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.executescript(YOUTUBE_SCHEMA)
        await db.commit()
        acct = await get_account(db, account_id)
        if not acct:
            raise HTTPException(404, "Account not found")
    try:
        info = await asyncio.to_thread(get_channel_info, acct["credentials_path"])
    except YouTubeClientError as e:
        async with aiosqlite.connect(str(DB_PATH)) as db:
            await update_account_status(db, account_id, status="error", last_error=str(e))
        raise HTTPException(502, str(e))
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await update_account_status(
            db, account_id, status="active",
            channel_id=info["channel_id"], channel_title=info["channel_title"],
        )
    return {"verified": True, **info}


@app.post("/api/youtube/upload")
async def youtube_upload(req: YouTubeUploadRequest):
    """One-click: conversation -> video -> YouTube upload -> warehouse lineage.

    Generates an MP4 from the conversation (TTS + slides), uploads it to
    YouTube via the real Data API, and records the provenance lineage in
    the warehouse (conversation_id -> video_id -> youtube_video_id).
    """
    await ensure_db()
    from youtube_pipeline import upload_conversation
    valid_privacy = {"private", "unlisted", "public"}
    if req.privacy not in valid_privacy:
        raise HTTPException(422, f"privacy must be one of: {sorted(valid_privacy)}")
    try:
        result = await upload_conversation(
            conversation_id=req.conversation_id,
            account_id=req.account_id,
            privacy=req.privacy,
            voice=req.voice,
        )
    except ValueError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    return result


@app.get("/api/youtube/videos")
async def list_youtube_videos(
    account_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):
    """List YouTube video records from the warehouse.

    Filter by account, source conversation, or upload status.
    Each record includes provenance (conversation_id) and YouTube video id.
    """
    await ensure_db()
    from youtube_db import get_video_records, get_videos_by_conversation, get_videos_by_status, YOUTUBE_SCHEMA
    limit = _clamp_limit(limit)
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.executescript(YOUTUBE_SCHEMA)
        await db.commit()
        if conversation_id:
            videos = await get_videos_by_conversation(db, conversation_id)
        elif status:
            videos = await get_videos_by_status(db, status)
        else:
            videos = await get_video_records(db, account_id=account_id, limit=limit, offset=offset)
    return {"videos": videos, "count": len(videos)}


@app.get("/api/youtube/videos/{video_id}")
async def get_youtube_video(video_id: str):
    """Get a single YouTube video record with its analytics history."""
    await ensure_db()
    from youtube_db import get_video_record, get_analytics_snapshots, YOUTUBE_SCHEMA
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.executescript(YOUTUBE_SCHEMA)
        await db.commit()
        video = await get_video_record(db, video_id)
        if not video:
            raise HTTPException(404, "Video record not found")
        analytics = await get_analytics_snapshots(db, video_id)
    return {**video, "analytics_history": analytics}


@app.get("/api/youtube/videos/{video_id}/analytics")
async def get_youtube_video_analytics(video_id: str):
    """Get the analytics time-series for a video."""
    await ensure_db()
    from youtube_db import get_analytics_snapshots, get_latest_analytics, YOUTUBE_SCHEMA
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.executescript(YOUTUBE_SCHEMA)
        await db.commit()
        history = await get_analytics_snapshots(db, video_id)
        latest = await get_latest_analytics(db, video_id)
    return {"snapshots": history, "count": len(history), "latest": latest}


@app.post("/api/youtube/maintenance")
async def youtube_maintenance():
    """Run the maintenance job: poll YouTube for video processing statuses.

    Transitions videos through the lifecycle:
    uploaded -> processing -> public/unlisted/private (or failed).
    """
    await ensure_db()
    from youtube_pipeline import run_maintenance
    return await run_maintenance()


@app.post("/api/youtube/etl")
async def youtube_etl(days_back: int = 30):
    """Run the ETL job: pull analytics for all uploaded videos into the warehouse.

    Stores append-only time-series snapshots in youtube_analytics.
    """
    await ensure_db()
    from youtube_pipeline import run_etl_analytics
    return await run_etl_analytics(days_back=days_back)


@app.get("/api/youtube/warehouse")
async def youtube_warehouse_overview():
    """Get the warehouse summary: accounts, videos by status, total analytics."""
    await ensure_db()
    from youtube_pipeline import get_pipeline_overview
    return await get_pipeline_overview()


# Serve frontend (static files)
FRONTEND_DIR = Path(__file__).parent.parent / "frontend" / "dist"

@app.get("/{path:path}")
async def serve_frontend(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "Not found")
    file_path = FRONTEND_DIR / path
    if file_path.exists() and file_path.is_file():
        content = await asyncio.to_thread(file_path.read_bytes)
        return Response(content=content, media_type=_guess_mime(path))
    index = FRONTEND_DIR / "index.html"
    if index.exists():
        html = await asyncio.to_thread(index.read_text, "utf-8")
        return HTMLResponse(html)
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
    logger.info("Starting ChatSync on %s:%d", HOST, PORT)
    uvicorn.run(app, host=HOST, port=PORT, log_level=LOG_LEVEL)
