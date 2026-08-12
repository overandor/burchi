from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from adapters.base import BaseAdapter
from models import Conversation, Message, MessageRole, Source, SyncStatus

DEFAULT_EXPORT_DIR = Path.home() / ".chatgpt" / "exports"


class ChatGPTAdapter(BaseAdapter):
    """Adapter for ChatGPT conversations.

    ChatGPT has no official bulk export API. Conversations are staged as
    JSON files in ``~/.chatgpt/exports/`` by the companion browser scraper
    (``chatgpt_scraper.py``) which uses Playwright to extract conversations
    from chat.openai.com. Two file shapes are supported:

    1. **Single-conversation files** (one JSON per conversation):
       ``{"title": ..., "create_time": ..., "messages": [{"role","content"}, ...]}``
    2. **OpenAI account-export format** (``conversations.json`` from
       Settings -> Data Controls -> Export Data): a list of conversation
       objects each with a ``mapping`` tree of nodes.
    """

    source = Source.CHATGPT

    def __init__(self, export_dir: Optional[Path] = None):
        self.export_dir = Path(export_dir) if export_dir else DEFAULT_EXPORT_DIR

    def _parse_single(self, data: dict, filepath: Path) -> Optional[Conversation]:
        source_id = data.get("id") or data.get("uuid") or filepath.stem
        conv_id = self._make_id(source_id)
        title = data.get("title", filepath.stem)
        created = data.get("create_time") or data.get("created_at")
        messages = []
        for m in data.get("messages", []):
            role_str = m.get("role", m.get("sender", "user"))
            content = m.get("content", m.get("text", ""))
            if isinstance(content, list):
                # OpenAI export content can be a list of parts.
                content = " ".join(str(p.get("text", p)) if isinstance(p, dict) else str(p) for p in content)
            if not content:
                continue
            role = MessageRole.ASSISTANT if role_str in ("assistant", "ChatGPT") else MessageRole.USER
            ts = m.get("create_time") or m.get("timestamp") or (created if isinstance(created, (int, float)) else time.time())
            try:
                ts = float(ts)
            except (TypeError, ValueError):
                ts = time.time()
            messages.append(self._make_message(conv_id, role, str(content), ts, metadata={"role": role_str}))

        if not messages:
            return None
        return Conversation(
            id=conv_id,
            source=self.source,
            source_id=source_id,
            title=title,
            created_at=messages[0].timestamp,
            updated_at=messages[-1].timestamp,
            messages=messages,
            metadata={"export_file": str(filepath)},
            sync_status=SyncStatus.PENDING,
            content_hash=self._content_hash(messages),
        )

    def _parse_export_bundle(self, data: list, filepath: Path) -> list[Conversation]:
        """Parse the OpenAI account-export conversations.json (list of trees)."""
        convs = []
        for entry in data:
            if not isinstance(entry, dict):
                continue
            source_id = entry.get("id") or entry.get("uuid") or ""
            if not source_id:
                continue
            conv_id = self._make_id(source_id)
            title = entry.get("title", source_id)
            mapping = entry.get("mapping", {})
            messages = []
            # Walk the mapping tree to collect messages in order.
            ordered = self._flatten_mapping(mapping)
            for role_str, content, ts in ordered:
                if not content:
                    continue
                role = MessageRole.ASSISTANT if role_str in ("assistant", "ChatGPT") else MessageRole.USER
                messages.append(self._make_message(conv_id, role, content, ts, metadata={"role": role_str}))
            if not messages:
                continue
            convs.append(Conversation(
                id=conv_id,
                source=self.source,
                source_id=source_id,
                title=title,
                created_at=messages[0].timestamp,
                updated_at=messages[-1].timestamp,
                messages=messages,
                metadata={"export_file": str(filepath)},
                sync_status=SyncStatus.PENDING,
                content_hash=self._content_hash(messages),
            ))
        return convs

    @staticmethod
    def _flatten_mapping(mapping: dict) -> list[tuple[str, str, float]]:
        """Flatten an OpenAI export mapping tree into ordered (role, content, ts)."""
        if not isinstance(mapping, dict):
            return []
        # Find root node.
        root_id = None
        for node_id, node in mapping.items():
            if isinstance(node, dict) and node.get("parent") is None:
                root_id = node_id
                break
        if root_id is None and mapping:
            root_id = next(iter(mapping))

        ordered = []
        seen = set()
        stack = [root_id]
        while stack:
            node_id = stack.pop(0)
            if not node_id or node_id in seen:
                continue
            seen.add(node_id)
            node = mapping.get(node_id)
            if not isinstance(node, dict):
                continue
            msg = node.get("message")
            if isinstance(msg, dict):
                meta = msg.get("metadata", {}) or {}
                author = msg.get("author", {}) or {}
                role = author.get("role", "user")
                content_parts = msg.get("content", {}).get("parts", [])
                content = " ".join(
                    str(p) if not isinstance(p, dict) else str(p.get("text", p))
                    for p in content_parts
                ) if isinstance(content_parts, list) else str(content_parts)
                ts = msg.get("create_time") or 0
                try:
                    ts = float(ts)
                except (TypeError, ValueError):
                    ts = 0.0
                if content:
                    ordered.append((role, content, ts))
            children = node.get("children", []) or []
            stack.extend(children)
        ordered.sort(key=lambda x: x[2] if x[2] else 0.0)
        return ordered

    async def fetch_conversations(self) -> list[Conversation]:
        if not self.export_dir.exists():
            return []
        conversations = []
        for filepath in self.export_dir.glob("*.json"):
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue
            if isinstance(data, list):
                conversations.extend(self._parse_export_bundle(data, filepath))
            elif isinstance(data, dict):
                # Could be a single conversation or a bundle under a key.
                if "conversations" in data and isinstance(data["conversations"], list):
                    conversations.extend(self._parse_export_bundle(data["conversations"], filepath))
                elif "mapping" in data:
                    conversations.extend(self._parse_export_bundle([data], filepath))
                else:
                    conv = self._parse_single(data, filepath)
                    if conv:
                        conversations.append(conv)
        return conversations

    async def fetch_conversation(self, source_id: str) -> Optional[Conversation]:
        convs = await self.fetch_conversations()
        for c in convs:
            if c.source_id == source_id:
                return c
        return None
