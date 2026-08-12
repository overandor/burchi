from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

from adapters.base import BaseAdapter
from models import Conversation, Message, MessageRole, Source, SyncStatus


class ClaudeAdapter(BaseAdapter):
    """
    Adapter for Claude conversation exports.
    Supports JSON export files from claude.ai or the Anthropic API.
    """

    source = Source.CLAUDE

    def __init__(self, export_dir: Optional[Path] = None):
        self.export_dir = Path(export_dir) if export_dir else Path.home() / ".claude" / "exports"

    def _parse_export(self, filepath: Path) -> Optional[Conversation]:
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            return None

        source_id = data.get("uuid", filepath.stem)
        conv_id = self._make_id(source_id)
        title = data.get("name", data.get("title", filepath.stem))

        messages = []
        for msg_data in data.get("chat_messages", []):
            sender = msg_data.get("sender", "")
            text = msg_data.get("text", "")
            created = msg_data.get("created_at", "")

            try:
                from datetime import datetime
                ts = datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp()
            except Exception:
                ts = time.time()

            role = MessageRole.USER if sender == "human" else MessageRole.ASSISTANT
            messages.append(self._make_message(conv_id, role, text, ts, metadata={"sender": sender}))

        return Conversation(
            id=conv_id,
            source=self.source,
            source_id=source_id,
            title=title,
            created_at=messages[0].timestamp if messages else time.time(),
            updated_at=messages[-1].timestamp if messages else time.time(),
            messages=messages,
            metadata={"export_file": str(filepath)},
            sync_status=SyncStatus.PENDING,
            content_hash=self._content_hash(messages),
        )

    async def fetch_conversations(self) -> list[Conversation]:
        if not self.export_dir.exists():
            return []
        conversations = []
        for filepath in self.export_dir.glob("*.json"):
            conv = self._parse_export(filepath)
            if conv:
                conversations.append(conv)
        return conversations

    async def fetch_conversation(self, source_id: str) -> Optional[Conversation]:
        convs = await self.fetch_conversations()
        for c in convs:
            if c.source_id == source_id:
                return c
        return None
