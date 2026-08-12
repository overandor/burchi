from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Optional

from adapters.base import BaseAdapter
from models import Conversation, Message, MessageRole, Source, SyncStatus

# Default paths discovered from the system
DEFAULT_DATA_DIR = Path.home() / "Library" / "Application Support" / "Devin"
DEFAULT_ACP_EVENTS = DEFAULT_DATA_DIR / "User" / "acp-events"
DEFAULT_STATE_DB = DEFAULT_DATA_DIR / "User" / "globalStorage" / "state.vscdb"


class WindsurfAdapter(BaseAdapter):
    """Adapter for Windsurf/Devin local conversations stored as NDJSON event logs."""

    source = Source.WINDSURF

    def __init__(
        self,
        acp_events_dir: Path = DEFAULT_ACP_EVENTS,
        state_db_path: Path = DEFAULT_STATE_DB,
    ):
        self.acp_events_dir = Path(acp_events_dir)
        self.state_db_path = Path(state_db_path)

    def _load_event_index(self) -> dict:
        """Load the ACP event log index from state.vscdb."""
        if not self.state_db_path.exists():
            return {}
        try:
            conn = sqlite3.connect(str(self.state_db_path))
            cursor = conn.execute(
                "SELECT value FROM ItemTable WHERE key = 'windsurf.acp.eventLog.index'"
            )
            row = cursor.fetchone()
            conn.close()
            if row:
                return json.loads(row[0])
        except Exception:
            pass
        return {}

    def _load_metadata_cache(self) -> dict:
        """Load session metadata from state.vscdb."""
        if not self.state_db_path.exists():
            return {}
        try:
            conn = sqlite3.connect(str(self.state_db_path))
            cursor = conn.execute(
                "SELECT value FROM ItemTable WHERE key = 'windsurf.acp.metadataCache'"
            )
            row = cursor.fetchone()
            conn.close()
            if row:
                return json.loads(row[0])
        except Exception:
            pass
        return {}

    def _parse_ndjson(self, filepath: Path) -> list[dict]:
        """Parse an NDJSON event log file."""
        events = []
        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            events.append(json.loads(line))
                        except json.JSONDecodeError:
                            continue
        except Exception:
            pass
        return events

    def _extract_messages(self, events: list[dict], conversation_id: str) -> list[Message]:
        """Extract user/assistant messages from ACP event log."""
        messages = []
        for event in events:
            notification = event.get("notification", {})
            session_update = notification.get("sessionUpdate", "")

            # User messages
            if session_update == "user_message":
                content = notification.get("text", "")
                if content:
                    ts = notification.get("timestamp", time.time())
                    messages.append(
                        self._make_message(conversation_id, MessageRole.USER, content, ts)
                    )

            # Assistant messages
            elif session_update == "agent_message":
                content = notification.get("text", "")
                if content:
                    ts = notification.get("timestamp", time.time())
                    messages.append(
                        self._make_message(conversation_id, MessageRole.ASSISTANT, content, ts)
                    )

            # Agent message chunks (streaming)
            elif session_update == "agent_message_chunk":
                content = notification.get("text", "")
                if content:
                    ts = notification.get("timestamp", time.time())
                    messages.append(
                        self._make_message(
                            conversation_id, MessageRole.ASSISTANT, content, ts,
                            metadata={"chunk": True}
                        )
                    )

            # Tool calls
            elif session_update == "tool_call":
                tool_name = notification.get("toolName", "unknown")
                input_data = notification.get("input", {})
                content = f"[Tool: {tool_name}] {json.dumps(input_data, ensure_ascii=False)[:500]}"
                ts = notification.get("timestamp", time.time())
                messages.append(
                    self._make_message(
                        conversation_id, MessageRole.TOOL, content, ts,
                        metadata={"tool": tool_name, "input": input_data}
                    )
                )

            # Tool results
            elif session_update == "tool_result":
                output = notification.get("output", "")
                content = str(output)[:2000]
                ts = notification.get("timestamp", time.time())
                messages.append(
                    self._make_message(
                        conversation_id, MessageRole.TOOL, content, ts,
                        metadata={"tool_result": True}
                    )
                )

        # Merge consecutive assistant chunks
        merged: list[Message] = []
        for msg in messages:
            if (
                merged
                and msg.role == MessageRole.ASSISTANT
                and merged[-1].role == MessageRole.ASSISTANT
                and merged[-1].metadata.get("chunk", False)
            ):
                merged[-1].content += msg.content
            else:
                merged.append(msg)

        return merged

    def _get_session_metadata(self, session_key: str, metadata_cache: dict) -> dict:
        """Extract metadata for a session from the metadata cache."""
        sessions = metadata_cache.get("sessions", [])
        for session in sessions:
            if session.get("sessionId") == session_key:
                meta = session.get("_meta", {})
                return {
                    "title": session.get("title", session_key),
                    "status": session.get("status", "unknown"),
                    "url": meta.get("cognition.ai/url", ""),
                    "repos": meta.get("cognition.ai/sessionRepos", []),
                    "prs": meta.get("cognition.ai/sessionPRs", []),
                    "tags": meta.get("cognition.ai/sessionTags", []),
                    "created_at": meta.get("cognition.ai/createdAt", ""),
                    "provider_id": session.get("providerId", ""),
                }
        return {}

    async def fetch_conversations(self) -> list[Conversation]:
        if not self.acp_events_dir.exists():
            return []

        event_index = self._load_event_index()
        metadata_cache = self._load_metadata_cache()

        conversations = []
        ndjson_files = list(self.acp_events_dir.glob("*.ndjson"))

        for ndjson_file in ndjson_files:
            file_uuid = ndjson_file.stem

            # Find the session key from the event index
            session_key = None
            for key, info in event_index.items():
                if info.get("uuid") == file_uuid:
                    session_key = key
                    break

            if not session_key:
                session_key = f"acp/unknown/{file_uuid}"

            events = self._parse_ndjson(ndjson_file)
            if not events:
                continue

            source_id = session_key
            conv_id = self._make_id(source_id)
            messages = self._extract_messages(events, conv_id)

            if not messages:
                # Still create a conversation entry for sessions with no messages
                messages = []

            meta = self._get_session_metadata(session_key, metadata_cache)
            title = meta.get("title", session_key.split("/")[-1] if session_key else file_uuid)

            # Determine timestamps
            created_at = messages[0].timestamp if messages else time.time()
            updated_at = messages[-1].timestamp if messages else time.time()

            # Try to parse created_at from metadata
            if meta.get("created_at"):
                try:
                    from datetime import datetime
                    dt = datetime.fromisoformat(meta["created_at"].replace("Z", "+00:00"))
                    created_at = dt.timestamp()
                except Exception:
                    pass

            # Use event index lastUpdated if available
            for key, info in event_index.items():
                if info.get("uuid") == file_uuid:
                    updated_at = info.get("lastUpdated", updated_at) / 1000.0
                    break

            # Determine sub-source (devin-cloud vs codex-acp vs devin-cli)
            provider_id = meta.get("provider_id", "")
            if "devin-cloud" in session_key:
                actual_source = Source.DEVIN
            elif "codex-acp" in session_key:
                actual_source = Source.ACODEX
            else:
                actual_source = Source.WINDSURF

            conv = Conversation(
                id=conv_id,
                source=actual_source,
                source_id=source_id,
                title=title,
                created_at=created_at,
                updated_at=updated_at,
                messages=messages,
                metadata=meta,
                sync_status=SyncStatus.PENDING,
                content_hash=self._content_hash(messages),
            )
            conversations.append(conv)

        return conversations

    async def fetch_conversation(self, source_id: str) -> Optional[Conversation]:
        convs = await self.fetch_conversations()
        for c in convs:
            if c.source_id == source_id:
                return c
        return None
