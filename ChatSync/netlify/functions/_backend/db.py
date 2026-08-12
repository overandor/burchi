from __future__ import annotations

import aiosqlite
import json
import os
import time
from typing import Optional
from pathlib import Path

from models import Conversation, Message, MessageRole, Source, SyncStatus, ContextEntry, SyncGroup

_DB_ENV = os.environ.get("CHATSYNC_DB_PATH", "")
DB_PATH = Path(_DB_ENV) if _DB_ENV else Path(__file__).parent.parent / "data" / "chatsync.db"


SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    sync_status TEXT NOT NULL DEFAULT 'pending',
    linked_conversation_ids TEXT NOT NULL DEFAULT '[]',
    content_hash TEXT NOT NULL DEFAULT '',
    UNIQUE(source, source_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    timestamp REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'unknown',
    metadata TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);

CREATE TABLE IF NOT EXISTS context_entries (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'unknown',
    tags TEXT NOT NULL DEFAULT '[]',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    conversation_ids TEXT NOT NULL DEFAULT '[]',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


async def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.executescript(SCHEMA)
        await db.commit()


async def upsert_conversation(db: aiosqlite.Connection, conv: Conversation):
    await db.execute(
        """INSERT INTO conversations (id, source, source_id, title, created_at, updated_at, metadata, sync_status, linked_conversation_ids, content_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source, source_id) DO UPDATE SET
             title=excluded.title, updated_at=excluded.updated_at,
             metadata=excluded.metadata, sync_status=excluded.sync_status,
             linked_conversation_ids=excluded.linked_conversation_ids,
             content_hash=excluded.content_hash""",
        (conv.id, conv.source.value, conv.source_id, conv.title, conv.created_at,
         conv.updated_at, json.dumps(conv.metadata), conv.sync_status.value,
         json.dumps(conv.linked_conversation_ids), conv.content_hash),
    )
    for msg in conv.messages:
        await db.execute(
            """INSERT OR REPLACE INTO messages (id, conversation_id, role, content, timestamp, source, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (msg.id, msg.conversation_id, msg.role.value, msg.content,
             msg.timestamp, msg.source.value, json.dumps(msg.metadata)),
        )
    await db.commit()


async def get_conversations(
    db: aiosqlite.Connection,
    source: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    include_messages: bool = False,
) -> list[dict]:
    query = "SELECT * FROM conversations"
    params: list = []
    if source:
        query += " WHERE source = ?"
        params.append(source)
    query += " ORDER BY updated_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    cols = [d[0] for d in cursor.description]
    results = []
    for row in rows:
        d = dict(zip(cols, row))
        d["metadata"] = json.loads(d["metadata"])
        d["linked_conversation_ids"] = json.loads(d["linked_conversation_ids"])
        d["message_count"] = 0
        if include_messages:
            mcursor = await db.execute(
                "SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp",
                (d["id"],),
            )
            mrows = await mcursor.fetchall()
            mcols = [d2[0] for d2 in mcursor.description]
            d["messages"] = [dict(zip(mcols, r)) for r in mrows]
            for m in d["messages"]:
                m["metadata"] = json.loads(m["metadata"])
            d["message_count"] = len(d["messages"])
        else:
            c2 = await db.execute("SELECT COUNT(*) FROM messages WHERE conversation_id = ?", (d["id"],))
            d["message_count"] = (await c2.fetchone())[0]
        results.append(d)
    return results


async def get_conversation(db: aiosqlite.Connection, conv_id: str) -> Optional[dict]:
    cursor = await db.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,))
    row = await cursor.fetchone()
    if not row:
        return None
    cols = [d[0] for d in cursor.description]
    d = dict(zip(cols, row))
    d["metadata"] = json.loads(d["metadata"])
    d["linked_conversation_ids"] = json.loads(d["linked_conversation_ids"])
    mcursor = await db.execute(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp",
        (d["id"],),
    )
    mrows = await mcursor.fetchall()
    mcols = [d2[0] for d2 in mcursor.description]
    d["messages"] = []
    for r in mrows:
        m = dict(zip(mcols, r))
        m["metadata"] = json.loads(m["metadata"])
        d["messages"].append(m)
    d["message_count"] = len(d["messages"])
    return d


async def search_messages(db: aiosqlite.Connection, query: str, limit: int = 50) -> list[dict]:
    cursor = await db.execute(
        """SELECT m.*, c.title as conversation_title, c.source as conversation_source
           FROM messages m JOIN conversations c ON m.conversation_id = c.id
           WHERE m.content LIKE ? ORDER BY m.timestamp DESC LIMIT ?""",
        (f"%{query}%", limit),
    )
    rows = await cursor.fetchall()
    cols = [d[0] for d in cursor.description]
    results = []
    for row in rows:
        d = dict(zip(cols, row))
        d["metadata"] = json.loads(d["metadata"])
        results.append(d)
    return results


async def upsert_context_entry(db: aiosqlite.Connection, entry: ContextEntry):
    await db.execute(
        """INSERT INTO context_entries (id, key, value, source, tags, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, source=excluded.source,
             tags=excluded.tags, updated_at=excluded.updated_at""",
        (entry.id, entry.key, entry.value, entry.source.value,
         json.dumps(entry.tags), entry.created_at, entry.updated_at),
    )
    await db.commit()


async def get_context_entries(db: aiosqlite.Connection, tag: Optional[str] = None) -> list[dict]:
    query = "SELECT * FROM context_entries"
    params: list = []
    if tag:
        query += " WHERE tags LIKE ?"
        params.append(f'%"{tag}"%')
    query += " ORDER BY updated_at DESC"
    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    cols = [d[0] for d in cursor.description]
    results = []
    for row in rows:
        d = dict(zip(cols, row))
        d["tags"] = json.loads(d["tags"])
        results.append(d)
    return results


async def delete_context_entry(db: aiosqlite.Connection, key: str) -> bool:
    cursor = await db.execute("DELETE FROM context_entries WHERE key = ?", (key,))
    await db.commit()
    return cursor.rowcount > 0


async def upsert_sync_group(db: aiosqlite.Connection, group: SyncGroup):
    await db.execute(
        """INSERT INTO sync_groups (id, name, conversation_ids, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name,
             conversation_ids=excluded.conversation_ids, updated_at=excluded.updated_at""",
        (group.id, group.name, json.dumps(group.conversation_ids),
         group.created_at, group.updated_at),
    )
    await db.commit()


async def get_sync_groups(db: aiosqlite.Connection) -> list[dict]:
    cursor = await db.execute("SELECT * FROM sync_groups ORDER BY updated_at DESC")
    rows = await cursor.fetchall()
    cols = [d[0] for d in cursor.description]
    results = []
    for row in rows:
        d = dict(zip(cols, row))
        d["conversation_ids"] = json.loads(d["conversation_ids"])
        results.append(d)
    return results


async def get_sync_state(db: aiosqlite.Connection, key: str) -> Optional[str]:
    cursor = await db.execute("SELECT value FROM sync_state WHERE key = ?", (key,))
    row = await cursor.fetchone()
    return row[0] if row else None


async def set_sync_state(db: aiosqlite.Connection, key: str, value: str):
    await db.execute(
        "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
    await db.commit()


async def delete_conversation(db: aiosqlite.Connection, conv_id: str) -> bool:
    cursor = await db.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
    await db.commit()
    return cursor.rowcount > 0
