from __future__ import annotations

import abc
import hashlib
import json
import time
import uuid
from typing import Optional

from models import Conversation, Message, MessageRole, Source


class BaseAdapter(abc.ABC):
    """Base class for all chat source adapters."""

    source: Source = Source.UNKNOWN

    @abc.abstractmethod
    async def fetch_conversations(self) -> list[Conversation]:
        """Fetch all conversations from this source."""
        ...

    @abc.abstractmethod
    async def fetch_conversation(self, source_id: str) -> Optional[Conversation]:
        """Fetch a single conversation by its source-specific ID."""
        ...

    def _make_id(self, source_id: str) -> str:
        return f"{self.source.value}:{source_id}"

    def _content_hash(self, messages: list[Message]) -> str:
        h = hashlib.sha256()
        for msg in sorted(messages, key=lambda m: m.timestamp):
            h.update(f"{msg.role.value}:{msg.content}".encode())
        return h.hexdigest()[:16]

    def _make_message(
        self,
        conversation_id: str,
        role: MessageRole,
        content: str,
        timestamp: float,
        metadata: Optional[dict] = None,
    ) -> Message:
        return Message(
            id=str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{conversation_id}:{role}:{timestamp}:{content[:100]}")),
            conversation_id=conversation_id,
            role=role,
            content=content,
            timestamp=timestamp,
            source=self.source,
            metadata=metadata or {},
        )
