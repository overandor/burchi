from __future__ import annotations

import time
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional


class Source(str, Enum):
    WINDSURF = "windsurf"
    DEVIN = "devin"
    CLAUDE = "claude"
    ACODEX = "acodex"
    CHATGPT = "chatgpt"
    ANTIGRAVITY = "antigravity"
    LIVE = "live"
    UNKNOWN = "unknown"


class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    TOOL = "tool"


class SyncStatus(str, Enum):
    PENDING = "pending"
    SYNCED = "synced"
    CONFLICT = "conflict"
    ERROR = "error"


@dataclass
class Message:
    id: str
    conversation_id: str
    role: MessageRole
    content: str
    timestamp: float
    source: Source = Source.UNKNOWN
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["role"] = self.role.value
        d["source"] = self.source.value
        return d


@dataclass
class Conversation:
    id: str
    source: Source
    source_id: str
    title: str
    created_at: float
    updated_at: float
    messages: list[Message] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    sync_status: SyncStatus = SyncStatus.PENDING
    linked_conversation_ids: list[str] = field(default_factory=list)
    content_hash: str = ""

    def to_dict(self, include_messages: bool = True) -> dict:
        d = {
            "id": self.id,
            "source": self.source.value,
            "source_id": self.source_id,
            "title": self.title,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "metadata": self.metadata,
            "sync_status": self.sync_status.value,
            "linked_conversation_ids": self.linked_conversation_ids,
            "content_hash": self.content_hash,
            "message_count": len(self.messages),
        }
        if include_messages:
            d["messages"] = [m.to_dict() for m in self.messages]
        return d


@dataclass
class ContextEntry:
    id: str
    key: str
    value: str
    source: Source
    tags: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["source"] = self.source.value
        return d


@dataclass
class SyncGroup:
    id: str
    name: str
    conversation_ids: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return asdict(self)
