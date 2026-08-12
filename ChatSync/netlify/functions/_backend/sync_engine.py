from __future__ import annotations

import asyncio
import hashlib
import json
import time
import uuid
from typing import Optional

import aiosqlite

from adapters.base import BaseAdapter
from adapters.windsurf_adapter import WindsurfAdapter
from adapters.claude_adapter import ClaudeAdapter
from adapters.acodex_adapter import AcodexAdapter
from adapters.chatgpt_adapter import ChatGPTAdapter
from adapters.antigravity_adapter import AntigravityAdapter
from adapters.live_adapter import live_adapter as _live_adapter_singleton
from db import upsert_conversation, get_conversations, set_sync_state, get_sync_state
from models import Conversation, Message, MessageRole, Source, SyncStatus, SyncGroup


class SyncEngine:
    """
    Synchronizes conversations across all sources.
    - Imports conversations from each adapter into the unified DB
    - Detects linked conversations across sources (by content similarity)
    - Enables two-way context sharing
    """

    def __init__(self, db_path: str):
        self.db_path = db_path
        self.adapters: list[BaseAdapter] = [
            WindsurfAdapter(),
            ClaudeAdapter(),
            AcodexAdapter(),
            ChatGPTAdapter(),
            AntigravityAdapter(),
            _live_adapter_singleton,
        ]
        self._sync_lock = asyncio.Lock()

    async def sync_all(self) -> dict:
        """Run a full sync from all adapters."""
        async with self._sync_lock:
            results = {"synced": 0, "errors": [], "by_source": {}}
            for adapter in self.adapters:
                try:
                    convs = await adapter.fetch_conversations()
                    async with aiosqlite.connect(self.db_path) as db:
                        for conv in convs:
                            await upsert_conversation(db, conv)
                            results["synced"] += 1
                        results["by_source"][adapter.source.value] = len(convs)
                except Exception as e:
                    results["errors"].append(f"{adapter.source.value}: {str(e)}")

            # Detect linked conversations
            await self._detect_linked_conversations()

            # Record sync time
            async with aiosqlite.connect(self.db_path) as db:
                await set_sync_state(db, "last_sync", str(time.time()))

            return results

    async def _detect_linked_conversations(self):
        """Detect conversations across sources that are likely about the same topic."""
        async with aiosqlite.connect(self.db_path) as db:
            all_convs = await get_conversations(db, limit=10000, include_messages=False)

            # Group by similar titles (normalized)
            groups: dict[str, list[str]] = {}
            for conv in all_convs:
                title_key = self._normalize_title(conv["title"])
                if title_key and len(title_key) > 5:
                    groups.setdefault(title_key, []).append(conv["id"])

            # Link conversations with same normalized title from different sources
            for title_key, conv_ids in groups.items():
                if len(conv_ids) > 1:
                    sources = set()
                    for cid in conv_ids:
                        for c in all_convs:
                            if c["id"] == cid:
                                sources.add(c["source"])
                    if len(sources) > 1:
                        for cid in conv_ids:
                            linked = [x for x in conv_ids if x != cid]
                            await db.execute(
                                "UPDATE conversations SET linked_conversation_ids = ?, sync_status = 'synced' WHERE id = ?",
                                (json.dumps(linked), cid),
                            )
            await db.commit()

    def _normalize_title(self, title: str) -> str:
        """Normalize a title for comparison."""
        return title.lower().strip().replace("_", "-").replace(" ", "-")[:60]

    async def create_sync_group(self, conversation_ids: list[str], name: str = "") -> SyncGroup:
        """Manually link conversations into a sync group."""
        group = SyncGroup(
            id=str(uuid.uuid4()),
            name=name or f"Sync Group {time.strftime('%Y-%m-%d %H:%M')}",
            conversation_ids=conversation_ids,
        )
        async with aiosqlite.connect(self.db_path) as db:
            from db import upsert_sync_group
            await upsert_sync_group(db, group)

            # Update linked_conversation_ids for each conversation
            for cid in conversation_ids:
                await db.execute(
                    "UPDATE conversations SET linked_conversation_ids = ?, sync_status = 'synced' WHERE id = ?",
                    (json.dumps([x for x in conversation_ids if x != cid]), cid),
                )
            await db.commit()

        return group

    async def export_conversation(self, conv_id: str, fmt: str = "json") -> Optional[str]:
        """Export a conversation in JSON or Markdown format."""
        async with aiosqlite.connect(self.db_path) as db:
            from db import get_conversation
            conv = await get_conversation(db, conv_id)
            if not conv:
                return None

            if fmt == "markdown":
                lines = [f"# {conv['title']}", ""]
                lines.append(f"**Source:** {conv['source']}")
                lines.append(f"**Created:** {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(conv['created_at']))}")
                lines.append(f"**Messages:** {conv['message_count']}")
                lines.append("")
                for msg in conv.get("messages", []):
                    role_label = msg["role"].upper()
                    lines.append(f"## [{role_label}]")
                    lines.append(msg["content"])
                    lines.append("")
                return "\n".join(lines)
            else:
                return json.dumps(conv, indent=2, ensure_ascii=False, default=str)

    async def export_all(self, fmt: str = "json") -> str:
        """Export all conversations."""
        async with aiosqlite.connect(self.db_path) as db:
            all_convs = await get_conversations(db, limit=10000, include_messages=True)
            if fmt == "markdown":
                parts = ["# ChatSync Export", ""]
                for conv in all_convs:
                    parts.append(f"## {conv['title']} ({conv['source']})")
                    parts.append(f"*{conv['message_count']} messages*")
                    parts.append("")
                    for msg in conv.get("messages", []):
                        parts.append(f"**[{msg['role'].upper()}]** {msg['content'][:500]}")
                        parts.append("")
                    parts.append("---")
                    parts.append("")
                return "\n".join(parts)
            else:
                return json.dumps(all_convs, indent=2, ensure_ascii=False, default=str)
