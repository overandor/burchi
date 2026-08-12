from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Optional

import aiosqlite

from db import DB_PATH
from models import ContextEntry, Source


class ContextStore:
    """
    Shared context layer that all AI assistants can read from and write to.
    - Stores key-value context entries in SQLite
    - Also writes a shared context file that tools can read
    - Supports tags for categorization
    """

    def __init__(self, db_path: str = str(DB_PATH), shared_file: Optional[Path] = None):
        self.db_path = db_path
        self.shared_file = shared_file or Path(__file__).parent.parent / "data" / "shared_context.md"

    async def add_entry(
        self,
        key: str,
        value: str,
        source: Source = Source.UNKNOWN,
        tags: Optional[list[str]] = None,
    ) -> ContextEntry:
        entry = ContextEntry(
            id=str(uuid.uuid4()),
            key=key,
            value=value,
            source=source,
            tags=tags or [],
        )
        async with aiosqlite.connect(self.db_path) as db:
            from db import upsert_context_entry
            await upsert_context_entry(db, entry)
        await self._update_shared_file()
        return entry

    async def get_entries(self, tag: Optional[str] = None) -> list[dict]:
        async with aiosqlite.connect(self.db_path) as db:
            from db import get_context_entries
            return await get_context_entries(db, tag)

    async def delete_entry(self, key: str) -> bool:
        async with aiosqlite.connect(self.db_path) as db:
            from db import delete_context_entry
            result = await delete_context_entry(db, key)
        if result:
            await self._update_shared_file()
        return result

    async def _update_shared_file(self):
        """Write all context entries to a shared markdown file that any tool can read."""
        entries = await self.get_entries()
        lines = ["# Shared Context (ChatSync)", ""]
        for entry in entries:
            tags_str = ", ".join(entry.get("tags", []))
            lines.append(f"## {entry['key']}")
            lines.append(f"**Source:** {entry['source']} | **Tags:** {tags_str}")
            lines.append("")
            lines.append(entry["value"])
            lines.append("")
        self.shared_file.parent.mkdir(parents=True, exist_ok=True)
        self.shared_file.write_text("\n".join(lines), encoding="utf-8")

    async def export_context_json(self) -> str:
        entries = await self.get_entries()
        return json.dumps(entries, indent=2, ensure_ascii=False, default=str)
