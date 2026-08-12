from __future__ import annotations

import json
import re
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from adapters.base import BaseAdapter
from models import Conversation, Message, MessageRole, Source, SyncStatus

DEFAULT_CONVERSATIONS_DIR = Path.home() / ".gemini" / "antigravity-ide" / "conversations"

_MIN_TEXT_LEN = 4
_MAX_TEXT_LEN = 8000
# Regex for UUID-like strings (8-4-4-4-12 hex) to filter out.
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
# Regex for protobuf field-tag noise (short hex / control byte runs).
_NOISE_RE = re.compile(r"^[\x00-\x1f\x7f-\xff]+$")
# Step types observed in Antigravity SQLite that carry user/agent text payloads.
# step_type 9  -> user prompt turn
# step_type 15 -> agent generation turn
# step_type 14 -> session/trajectory title
# step_type 90 -> tool call
# step_type 98/99 -> tool result / observation
_USER_STEP_TYPES = {9}
_AGENT_STEP_TYPES = {15}
_TITLE_STEP_TYPES = {14, 4}
_TOOL_STEP_TYPES = {90, 98, 99, 23}


def _extract_text_from_blob(blob: bytes) -> str:
    """Extract human-readable text strings from a protobuf-style binary blob.

    Antigravity stores step payloads as protobuf-encoded blobs without an
    available .proto schema. We recover readable UTF-8 runs heuristically:
    protobuf string fields are length-prefixed UTF-8, so scanning for
    printable ASCII/UTF-8 runs of sufficient length recovers the substantive
    text content (prompts, responses, tool I/O) reliably.
    """
    if not blob:
        return ""
    # Decode as latin-1 to preserve byte values, then extract printable runs.
    raw = blob.decode("utf-8", errors="replace")
    # Pull runs of printable characters (incl. common punctuation/whitespace).
    runs = re.findall(r"[\x20-\x7e\u00a0-\uffff]{%d,}" % _MIN_TEXT_LEN, raw)
    # Filter out runs that look like hex hashes / uuids / base64 noise.
    cleaned = []
    for run in runs:
        stripped = run.strip()
        if not stripped:
            continue
        # Skip pure-hex / pure-base64 runs longer than 40 chars (likely ids).
        if re.fullmatch(r"[0-9a-fA-F]{40,}", stripped):
            continue
        if re.fullmatch(r"[A-Za-z0-9+/=]{40,}", stripped):
            continue
        # Skip UUID-like strings.
        if _UUID_RE.match(stripped):
            continue
        # Skip runs that are mostly non-letter (likely binary garbage).
        letters = sum(c.isalpha() for c in stripped)
        if letters < max(2, len(stripped) * 0.25):
            continue
        # Skip runs that are just control/noise bytes rendered as replacement chars.
        if _NOISE_RE.match(stripped):
            continue
        # Skip runs that are mostly hex with dashes (uuid fragments).
        hex_ratio = sum(c in "0123456789abcdefABCDEF-" for c in stripped) / max(1, len(stripped))
        if hex_ratio > 0.7 and len(stripped) > 20:
            continue
        cleaned.append(stripped)
    text = " ".join(cleaned)
    # Strip common protobuf-field noise prefixes that survive the run filter.
    text = re.sub(r"sessionID\s*[A-Za-z0-9_\-]{10,}\s*", " ", text)
    text = re.sub(r"^[\x00-\x1f\x7f-\xff]+", "", text)
    text = re.sub(r"\s{2,}", " ", text).strip()
    if len(text) > _MAX_TEXT_LEN:
        text = text[:_MAX_TEXT_LEN] + "…[truncated]"
    return text


def _is_quality_text(text: str) -> bool:
    """Return True if the extracted text is clean enough to keep.

    Drops messages that are mostly replacement chars / control noise.
    """
    if len(text) < 10:
        return False
    # Count replacement chars and control chars.
    noise = sum(1 for c in text if c == "\ufffd" or ord(c) < 0x20)
    ratio = noise / len(text)
    if ratio > 0.15:
        return False
    # Require a minimum density of actual word characters.
    word_chars = sum(1 for c in text if c.isalnum() or c.isspace())
    if word_chars / len(text) < 0.5:
        return False
    return True


class AntigravityAdapter(BaseAdapter):
    """Adapter for Google Antigravity IDE conversations.

    Antigravity stores each conversation as a SQLite database under
    ``~/.gemini/antigravity-ide/conversations/<uuid>.db``. Step payloads are
    protobuf-encoded blobs; we extract readable text heuristically and
    classify turns by step_type.
    """

    source = Source.ANTIGRAVITY

    def __init__(self, conversations_dir: Optional[Path] = None):
        self.conversations_dir = Path(conversations_dir) if conversations_dir else DEFAULT_CONVERSATIONS_DIR

    def _parse_db(self, db_path: Path) -> Optional[Conversation]:
        source_id = db_path.stem
        conv_id = self._make_id(source_id)
        title = source_id
        messages: list[Message] = []

        try:
            conn = sqlite3.connect(str(db_path))
            try:
                # Title from trajectory_metadata_blob or a title step.
                try:
                    cur = conn.execute("SELECT data FROM trajectory_metadata_blob LIMIT 1")
                    row = cur.fetchone()
                    if row and row[0]:
                        meta_text = _extract_text_from_blob(row[0])
                        if meta_text:
                            # First meaningful line is usually the title.
                            title = meta_text.split("\n")[0][:120] or title
                except sqlite3.Error:
                    pass

                cur = conn.execute(
                    "SELECT idx, step_type, status, step_payload, task_details FROM steps ORDER BY idx ASC"
                )
                rows = cur.fetchall()
                for idx, step_type, status, payload, task_details in rows:
                    blob = payload if payload else task_details
                    text = _extract_text_from_blob(blob) if blob else ""
                    if not text or not _is_quality_text(text):
                        continue
                    ts = time.time()  # Antigravity blobs don't expose a clean timestamp field.
                    if step_type in _TITLE_STEP_TYPES and len(text) > len(title):
                        title = text[:120]
                    elif step_type in _USER_STEP_TYPES:
                        messages.append(
                            self._make_message(conv_id, MessageRole.USER, text, ts,
                                               metadata={"step_type": step_type, "idx": idx})
                        )
                    elif step_type in _AGENT_STEP_TYPES:
                        messages.append(
                            self._make_message(conv_id, MessageRole.ASSISTANT, text, ts,
                                               metadata={"step_type": step_type, "idx": idx})
                        )
                    elif step_type in _TOOL_STEP_TYPES:
                        messages.append(
                            self._make_message(conv_id, MessageRole.TOOL, text, ts,
                                               metadata={"step_type": step_type, "idx": idx})
                        )
            finally:
                conn.close()
        except sqlite3.Error:
            return None

        if not messages:
            return None

        created_at = messages[0].timestamp
        updated_at = messages[-1].timestamp
        return Conversation(
            id=conv_id,
            source=self.source,
            source_id=source_id,
            title=title,
            created_at=created_at,
            updated_at=updated_at,
            messages=messages,
            metadata={"db_file": str(db_path)},
            sync_status=SyncStatus.PENDING,
            content_hash=self._content_hash(messages),
        )

    async def fetch_conversations(self) -> list[Conversation]:
        if not self.conversations_dir.exists():
            return []
        conversations = []
        for db_path in self.conversations_dir.glob("*.db"):
            # Skip -wal/-shm sidecar files.
            if db_path.suffix != ".db":
                continue
            conv = self._parse_db(db_path)
            if conv:
                conversations.append(conv)
        return conversations

    async def fetch_conversation(self, source_id: str) -> Optional[Conversation]:
        convs = await self.fetch_conversations()
        for c in convs:
            if c.source_id == source_id:
                return c
        return None
