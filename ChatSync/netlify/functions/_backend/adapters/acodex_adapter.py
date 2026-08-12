from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

from adapters.base import BaseAdapter
from models import Conversation, Message, MessageRole, Source, SyncStatus


class AcodexAdapter(BaseAdapter):
    """
    Adapter for Acodex conversations.
    Reads from a configurable directory of JSON/NDJSON conversation files.
    """

    source = Source.ACODEX

    def __init__(self, data_dir: Optional[Path] = None):
        self.data_dir = Path(data_dir) if data_dir else Path.home() / ".acodex" / "conversations"

    def _parse_json(self, filepath: Path) -> Optional[Conversation]:
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            return None

        source_id = data.get("id", filepath.stem)
        conv_id = self._make_id(source_id)
        title = data.get("title", filepath.stem)

        messages = []
        for msg_data in data.get("messages", []):
            role_str = msg_data.get("role", "user")
            content = msg_data.get("content", msg_data.get("text", ""))
            ts = msg_data.get("timestamp", msg_data.get("created_at", time.time()))
            if isinstance(ts, str):
                try:
                    from datetime import datetime
                    ts = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
                except Exception:
                    ts = time.time()

            role = MessageRole(role_str) if role_str in [r.value for r in MessageRole] else MessageRole.USER
            messages.append(self._make_message(conv_id, role, content, float(ts)))

        return Conversation(
            id=conv_id,
            source=self.source,
            source_id=source_id,
            title=title,
            created_at=messages[0].timestamp if messages else time.time(),
            updated_at=messages[-1].timestamp if messages else time.time(),
            messages=messages,
            metadata={"source_file": str(filepath)},
            sync_status=SyncStatus.PENDING,
            content_hash=self._content_hash(messages),
        )

    async def fetch_conversations(self) -> list[Conversation]:
        if not self.data_dir.exists():
            return []
        conversations = []
        for filepath in self.data_dir.glob("*.json"):
            conv = self._parse_json(filepath)
            if conv:
                conversations.append(conv)
        return conversations

    async def fetch_conversation(self, source_id: str) -> Optional[Conversation]:
        convs = await self.fetch_conversations()
        for c in convs:
            if c.source_id == source_id:
                return c
        return None
