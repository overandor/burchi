"""Live session adapter.

Push-based adapter for streaming an in-flight chat (e.g. the current Devin
session) into the unified ChatSync DB as it grows. Unlike the disk-based
adapters, conversations are not pulled from the filesystem; they are pushed
via the ``POST /api/live`` endpoint into an in-memory buffer held by the
module-level ``live_adapter`` singleton. ``SyncEngine.sync_all`` reads from
the same singleton, so a live session is reflected in sync status and
re-pulled idempotently.

The endpoint also writes directly to the SQLite DB so pushed messages are
durable immediately, even before a sync runs.
"""
from __future__ import annotations

import time
import uuid
from typing import Optional

from adapters.base import BaseAdapter
from models import Conversation, Message, MessageRole, Source, SyncStatus


class LiveAdapter(BaseAdapter):
    """In-memory buffer for live-pushed conversations."""

    source = Source.LIVE

    def __init__(self) -> None:
        self._convs: dict[str, Conversation] = {}

    async def fetch_conversations(self) -> list[Conversation]:
        return list(self._convs.values())

    async def fetch_conversation(self, source_id: str) -> Optional[Conversation]:
        return self._convs.get(source_id)

    def ingest(
        self,
        source_id: str,
        title: str,
        messages: list[Message],
        created_at: Optional[float] = None,
    ) -> Conversation:
        """Upsert a live conversation into the in-memory buffer.

        ``messages`` replace the buffer's message list for this source_id so
        repeated pushes with the full transcript stay idempotent.
        """
        now = time.time()
        conv_id = self._make_id(source_id)
        existing = self._convs.get(source_id)
        created = created_at or (existing.created_at if existing else now)

        # Stamp each message with the conversation id + LIVE source if unset.
        cleaned: list[Message] = []
        for m in messages:
            if not m.conversation_id:
                m.conversation_id = conv_id
            if m.source == Source.UNKNOWN:
                m.source = self.source
            cleaned.append(m)

        conv = Conversation(
            id=conv_id,
            source=self.source,
            source_id=source_id,
            title=title,
            created_at=created,
            updated_at=now,
            messages=cleaned,
            sync_status=SyncStatus.SYNCED,
            metadata={"live": True},
            content_hash=self._content_hash(cleaned),
        )
        self._convs[source_id] = conv
        return conv

    def reset(self) -> None:
        """Clear the in-memory buffer (used by tests)."""
        self._convs.clear()


# Module-level singleton shared by the endpoint and the sync engine.
live_adapter = LiveAdapter()


def build_message(
    role: str,
    content: str,
    timestamp: float,
    conversation_id: str = "",
) -> Message:
    """Construct a Message from raw endpoint input with validation."""
    try:
        role_enum = MessageRole(role)
    except ValueError:
        raise ValueError(f"Invalid role: {role!r}. Must be one of {[r.value for r in MessageRole]}")
    if not content:
        raise ValueError("content must be a non-empty string")
    if not isinstance(timestamp, (int, float)) or timestamp < 0:
        raise ValueError("timestamp must be a non-negative number")
    return Message(
        id=str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{conversation_id}:{role}:{timestamp}:{content[:100]}")),
        conversation_id=conversation_id,
        role=role_enum,
        content=content,
        timestamp=float(timestamp),
        source=Source.LIVE,
    )
