"""
Chat Bank — aggregates chat history from all LLM apps into a single API.

Sources:
  - Devin:     ~/.local/share/devin/cli/summaries/*.md
  - Claude Code: ~/.claude/projects/**/*.jsonl
  - Codex:     ~/.codex/sessions/**/*.jsonl + archived_sessions/*.jsonl
  - Cursor:    ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb

API:
  GET /                    — web UI (ConvoReader-style)
  GET /api/conversations   — list all conversations (paginated)
  GET /api/conversation/:id — get full conversation
  GET /api/search?q=...    — search across all conversations
  GET /api/random           — get a random user prompt (for inference loop)
  GET /api/prompts          — get all user prompts (for prompt bank)
  GET /api/stats            — aggregate stats
  GET /api/sources          — list sources with counts
  GET /health               — health check
"""

import os
import re
import json
import sqlite3
import glob
import time
import random
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

PORT = int(os.environ.get("PORT", "8000"))

# Source paths
DEVIN_SUMMARIES = os.path.expanduser("~/.local/share/devin/cli/summaries")
CLAUDE_PROJECTS = os.path.expanduser("~/.claude/projects")
CODEX_SESSIONS = os.path.expanduser("~/.codex/sessions")
CODEX_ARCHIVED = os.path.expanduser("~/.codex/archived_sessions")
CURSOR_VSCDB = os.path.expanduser("~/Library/Application Support/Cursor/User/globalStorage/state.vscdb")

app = FastAPI(title="Chat Bank")


# ── Data models ─────────────────────────────────────────────────

class Message:
    def __init__(self, role: str, content: str, timestamp: str = ""):
        self.role = role
        self.content = content
        self.timestamp = timestamp

    def to_dict(self):
        return {"role": self.role, "content": self.content[:5000], "timestamp": self.timestamp}


class Conversation:
    def __init__(self, conv_id: str, source: str, title: str = ""):
        self.id = conv_id
        self.source = source
        self.title = title
        self.messages: list[Message] = []
        self.file_path = ""
        self.timestamp = ""

    @property
    def user_prompts(self) -> list[str]:
        return [m.content for m in self.messages if m.role == "user" and len(m.content) > 20]

    def to_summary(self):
        return {
            "id": self.id,
            "source": self.source,
            "title": self.title or "(untitled)",
            "message_count": len(self.messages),
            "user_prompt_count": len(self.user_prompts),
            "timestamp": self.timestamp,
        }

    def to_dict(self):
        return {
            "id": self.id,
            "source": self.source,
            "title": self.title or "(untitled)",
            "messages": [m.to_dict() for m in self.messages],
            "timestamp": self.timestamp,
        }


# ── Parsers ─────────────────────────────────────────────────────

def parse_devin(summaries_dir: str) -> list[Conversation]:
    """Parse Devin .md history files."""
    convs = []
    if not os.path.isdir(summaries_dir):
        return convs

    for fname in sorted(os.listdir(summaries_dir)):
        if not fname.startswith("history_") or not fname.endswith(".md"):
            continue

        fpath = os.path.join(summaries_dir, fname)
        conv_id = fname.replace("history_", "").replace(".md", "")

        with open(fpath, "r", errors="replace") as f:
            content = f.read()

        conv = Conversation(conv_id, "devin", fpath)
        conv.file_path = fpath

        # Parse messages: === MESSAGE N - Role ===
        pattern = r"=== MESSAGE (\d+) - (\w+) ===\n(.*?)(?=\n=== MESSAGE|\Z)"
        matches = re.findall(pattern, content, re.DOTALL)

        for msg_num, role, body in matches:
            body = body.strip()
            if not body:
                continue
            # Skip system metadata blocks
            if body.startswith("<system_info>") or body.startswith("<rules") or body.startswith("<available_skills>"):
                continue
            if body.startswith("<additional_metadata>") or body.startswith("<system_guidance>"):
                continue
            # Normalize role
            role_lower = role.lower()
            if role_lower == "user":
                conv.messages.append(Message("user", body))
            elif role_lower == "assistant":
                conv.messages.append(Message("assistant", body))
            elif role_lower == "tool":
                conv.messages.append(Message("tool", body[:2000]))  # truncate tool output

        if conv.messages:
            convs.append(conv)

    return convs


def parse_claude_code(projects_dir: str) -> list[Conversation]:
    """Parse Claude Code .jsonl session files."""
    convs = []
    if not os.path.isdir(projects_dir):
        return convs

    for fpath in glob.glob(os.path.join(projects_dir, "**", "*.jsonl"), recursive=True):
        conv_id = Path(fpath).stem
        conv = Conversation(conv_id, "claude-code", "")
        conv.file_path = fpath

        try:
            with open(fpath, "r", errors="replace") as f:
                for line in f:
                    entry = json.loads(line)
                    entry_type = entry.get("type", "")

                    if entry_type == "custom-title":
                        conv.title = entry.get("customTitle", "")
                    elif entry_type == "ai-title":
                        if not conv.title:
                            conv.title = entry.get("aiTitle", "")
                    elif entry_type in ("user", "assistant"):
                        msg = entry.get("message", {})
                        content = msg.get("content", "")
                        if isinstance(content, str):
                            text = content
                        elif isinstance(content, list):
                            text = " ".join(
                                c.get("text", "") for c in content
                                if isinstance(c, dict) and c.get("type") in ("text", "input_text")
                            )
                        else:
                            text = str(content)
                        if text.strip():
                            conv.messages.append(Message(entry_type, text, entry.get("timestamp", "")))
        except (json.JSONDecodeError, KeyError):
            continue

        if conv.messages:
            convs.append(conv)

    return convs


def parse_codex(sessions_dir: str, archived_dir: str = "") -> list[Conversation]:
    """Parse Codex .jsonl rollout files."""
    convs = []
    files = []

    if os.path.isdir(sessions_dir):
        files.extend(glob.glob(os.path.join(sessions_dir, "**", "*.jsonl"), recursive=True))
    if archived_dir and os.path.isdir(archived_dir):
        files.extend(glob.glob(os.path.join(archived_dir, "*.jsonl")))

    for fpath in files:
        conv_id = Path(fpath).stem
        conv = Conversation(conv_id, "codex", "")
        conv.file_path = fpath

        try:
            with open(fpath, "r", errors="replace") as f:
                for line in f:
                    entry = json.loads(line)
                    entry_type = entry.get("type", "")

                    if entry_type == "session_meta":
                        payload = entry.get("payload", {})
                        conv.timestamp = payload.get("timestamp", "")

                    elif entry_type == "response_item":
                        payload = entry.get("payload", {})
                        if payload.get("type") == "message":
                            role = payload.get("role", "")
                            content_list = payload.get("content", [])
                            text = " ".join(
                                c.get("text", "") for c in content_list
                                if isinstance(c, dict) and c.get("type") in ("input_text", "output_text", "text")
                            )
                            if text.strip():
                                # Map developer/system roles
                                if role in ("developer", "system"):
                                    role = "system"
                                conv.messages.append(Message(role, text, entry.get("timestamp", "")))
        except (json.JSONDecodeError, KeyError):
            continue

        if conv.messages:
            convs.append(conv)

    return convs


def parse_cursor(vscdb_path: str) -> list[Conversation]:
    """Parse Cursor composer conversations from SQLite."""
    convs = []
    if not os.path.isfile(vscdb_path):
        return convs

    try:
        conn = sqlite3.connect(vscdb_path)
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
        for key, value in cursor.fetchall():
            conv_id = key.replace("composerData:", "")
            conv = Conversation(conv_id, "cursor", "")
            conv.file_path = vscdb_path

            try:
                data = json.loads(value)
                conv.title = data.get("name", "")

                # Cursor stores conversations in fullConversation or conversationMap
                conversations = data.get("fullConversation", [])
                if not conversations:
                    conv_map = data.get("conversationMap", {})
                    conversations = list(conv_map.values()) if conv_map else []

                for msg in conversations:
                    if not isinstance(msg, dict):
                        continue
                    role = msg.get("role", msg.get("type", ""))
                    text = msg.get("text", msg.get("content", ""))
                    if isinstance(text, list):
                        text = " ".join(t.get("text", "") for t in text if isinstance(t, dict))
                    if not isinstance(text, str):
                        text = str(text)
                    if text.strip() and role:
                        if role in ("human", "user"):
                            role = "user"
                        conv.messages.append(Message(role, text))
            except (json.JSONDecodeError, KeyError):
                continue

        conn.close()
    except sqlite3.Error:
        pass

    return [c for c in convs if c.messages]


# ── Load all conversations at startup ───────────────────────────

print("Loading conversations...")
t0 = time.time()

all_conversations: list[Conversation] = []
conversations_by_id: dict[str, Conversation] = {}

def _conv_from_dict(d: dict) -> Conversation:
    """Rebuild a Conversation from a dict."""
    conv = Conversation(d["id"], d["source"], d.get("title", ""))
    conv.timestamp = d.get("timestamp", "")
    for m in d.get("messages", []):
        conv.messages.append(Message(m["role"], m["content"], m.get("timestamp", "")))
    return conv

def load_all():
    global all_conversations, conversations_by_id

    # Try bundled JSON first (Docker), fall back to live parsing (local dev)
    bundled = os.path.join(os.path.dirname(__file__), "conversations.json")
    if os.path.isfile(bundled):
        print("  Loading from bundled conversations.json...")
        with open(bundled) as f:
            data = json.load(f)
        all_conversations = [_conv_from_dict(d) for d in data["conversations"]]
    else:
        print("  No bundled data — parsing live filesystem...")
        all_conversations = []
        all_conversations.extend(parse_devin(DEVIN_SUMMARIES))
        all_conversations.extend(parse_claude_code(CLAUDE_PROJECTS))
        all_conversations.extend(parse_codex(CODEX_SESSIONS, CODEX_ARCHIVED))
        all_conversations.extend(parse_cursor(CURSOR_VSCDB))

    conversations_by_id = {c.id: c for c in all_conversations}
    print(f"  Loaded {len(all_conversations)} conversations in {time.time()-t0:.1f}s")

load_all()


# ── API endpoints ───────────────────────────────────────────────

@app.get("/api/conversations")
async def list_conversations(
    source: str = Query("", description="Filter by source"),
    limit: int = Query(50, le=500),
    offset: int = Query(0),
):
    convs = all_conversations
    if source:
        convs = [c for c in convs if c.source == source]
    total = len(convs)
    page = convs[offset:offset + limit]
    return {"total": total, "offset": offset, "limit": limit, "conversations": [c.to_summary() for c in page]}


@app.get("/api/conversation/{conv_id}")
async def get_conversation(conv_id: str):
    conv = conversations_by_id.get(conv_id)
    if not conv:
        return JSONResponse({"error": "not found"}, status_code=404)
    return conv.to_dict()


@app.get("/api/search")
async def search(q: str = Query(..., min_length=2), limit: int = Query(20, le=100)):
    results = []
    q_lower = q.lower()
    for conv in all_conversations:
        for msg in conv.messages:
            if q_lower in msg.content.lower():
                # Find the snippet around the match
                idx = msg.content.lower().find(q_lower)
                start = max(0, idx - 50)
                end = min(len(msg.content), idx + len(q) + 100)
                snippet = msg.content[start:end]
                results.append({
                    "conversation_id": conv.id,
                    "conversation_title": conv.title,
                    "source": conv.source,
                    "role": msg.role,
                    "snippet": snippet,
                })
                if len(results) >= limit:
                    break
        if len(results) >= limit:
            break
    return {"query": q, "results": results, "count": len(results)}


@app.get("/api/random")
async def random_prompt():
    """Get a random user prompt — for the inference loop."""
    all_prompts = []
    for conv in all_conversations:
        all_prompts.extend(conv.user_prompts)
    if not all_prompts:
        return {"prompt": "No prompts available"}
    return {"prompt": random.choice(all_prompts), "total_prompts": len(all_prompts)}


@app.get("/api/prompts")
async def all_prompts(limit: int = Query(100, le=1000), offset: int = Query(0)):
    """Get all user prompts — the prompt bank."""
    prompts = []
    for conv in all_conversations:
        for p in conv.user_prompts:
            prompts.append({"text": p, "source": conv.source, "conversation_id": conv.id})
    total = len(prompts)
    page = prompts[offset:offset + limit]
    return {"total": total, "offset": offset, "limit": limit, "prompts": page}


@app.get("/api/stats")
async def stats():
    source_counts = {}
    total_messages = 0
    total_prompts = 0
    for conv in all_conversations:
        source_counts[conv.source] = source_counts.get(conv.source, 0) + 1
        total_messages += len(conv.messages)
        total_prompts += len(conv.user_prompts)
    return {
        "total_conversations": len(all_conversations),
        "total_messages": total_messages,
        "total_user_prompts": total_prompts,
        "by_source": source_counts,
    }


@app.get("/api/sources")
async def sources():
    source_info = {}
    for conv in all_conversations:
        if conv.source not in source_info:
            source_info[conv.source] = {"conversations": 0, "messages": 0, "prompts": 0}
        source_info[conv.source]["conversations"] += 1
        source_info[conv.source]["messages"] += len(conv.messages)
        source_info[conv.source]["prompts"] += len(conv.user_prompts)
    return {"sources": source_info}


@app.get("/health")
async def health():
    return {"status": "healthy", "conversations": len(all_conversations)}


@app.get("/")
async def index():
    return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
