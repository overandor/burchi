"""Infinite history store — append-only, content-addressed, deduplicated.

Layout:
  ~/.terminality/
  ├── chunks/           # SHA-256 addressed chunk files
  │   ├── ab/ab123...
  │   └── cd/cdef...
  ├── sessions/         # session state JSON
  ├── history/          # append-only history.jsonl
  └── merkle/           # cached Merkle trees
"""

from __future__ import annotations
import os
import json
import struct
import time
import hashlib
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional, Any

from .chunker import TerminalChunk, MerkleTree

DEFAULT_STORE_DIR = Path(
    os.environ.get("TERMINALITY_STORE", str(Path.home() / ".terminality"))
)


@dataclass
class SessionState:
    session_id: str
    merkle_root: str
    chunk_hashes: list[str]
    chunk_count: int
    total_bytes: int
    scrollback_lines: int
    cwd: str
    env_snapshot: dict[str, str]
    process_pid: Optional[int]
    created_at: float
    last_activity: float
    llm_context_hash: Optional[str] = None

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2)

    @classmethod
    def from_json(cls, data: str) -> "SessionState":
        return cls(**json.loads(data))


@dataclass
class HistoryEntry:
    timestamp: float
    chunk_hash: str
    entry_type: str  # "command", "output", "state", "llm_inference"
    session_id: str
    metadata: dict[str, Any] = field(default_factory=dict)


class InfiniteHistory:
    """Append-only, content-addressed, deduplicated history store.

    Never deletes. Chunks stored by hash → identical content across
    sessions stored once. History is infinite because storage grows
    by unique content only, not by time.
    """

    def __init__(self, store_dir: Path = DEFAULT_STORE_DIR):
        self.store_dir = store_dir
        self.chunks_dir = store_dir / "chunks"
        self.sessions_dir = store_dir / "sessions"
        self.history_dir = store_dir / "history"
        self.merkle_dir = store_dir / "merkle"
        for d in [self.store_dir, self.chunks_dir, self.sessions_dir,
                  self.history_dir, self.merkle_dir]:
            d.mkdir(parents=True, exist_ok=True)

    def _chunk_path(self, chunk_hash: str) -> Path:
        return self.chunks_dir / chunk_hash[:2] / chunk_hash[2:]

    def store_chunk(self, chunk: TerminalChunk) -> bool:
        """Store a chunk. Returns True if new, False if deduped."""
        path = self._chunk_path(chunk.hash)
        if path.exists():
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        meta = struct.pack("!dI", chunk.timestamp, len(chunk.data))
        path.write_bytes(meta + chunk.data)
        return True

    def load_chunk(self, chunk_hash: str) -> Optional[TerminalChunk]:
        path = self._chunk_path(chunk_hash)
        if not path.exists():
            return None
        raw = path.read_bytes()
        timestamp, data_len = struct.unpack("!dI", raw[:12])
        data = raw[12:12 + data_len]
        return TerminalChunk(
            index=0, hash=chunk_hash, data=data,
            timestamp=timestamp, chunk_type="output",
        )

    def append_history(self, entry: HistoryEntry):
        log_path = self.history_dir / "history.jsonl"
        with open(log_path, "a") as f:
            f.write(json.dumps(asdict(entry)) + "\n")

    def read_history(self, session_id: Optional[str] = None,
                     limit: int = 100, offset: int = 0) -> list[HistoryEntry]:
        log_path = self.history_dir / "history.jsonl"
        if not log_path.exists():
            return []
        entries = []
        with open(log_path) as f:
            for line in f:
                data = json.loads(line)
                entry = HistoryEntry(**data)
                if session_id and entry.session_id != session_id:
                    continue
                entries.append(entry)
        return entries[-(offset + limit):][:limit] if offset else entries[-limit:]

    def save_session(self, state: SessionState):
        (self.sessions_dir / f"{state.session_id}.json").write_text(state.to_json())

    def load_session(self, session_id: str) -> Optional[SessionState]:
        path = self.sessions_dir / f"{session_id}.json"
        if not path.exists():
            return None
        return SessionState.from_json(path.read_text())

    def save_merkle(self, session_id: str, tree: MerkleTree):
        (self.merkle_dir / f"{session_id}.json").write_text(
            json.dumps({"layers": tree.layers, "root": tree.root})
        )

    def load_merkle(self, session_id: str) -> Optional[MerkleTree]:
        path = self.merkle_dir / f"{session_id}.json"
        if not path.exists():
            return None
        data = json.loads(path.read_text())
        return MerkleTree(layers=data["layers"], root=data["root"])

    def stats(self) -> dict:
        chunk_count = 0
        total_bytes = 0
        for d in self.chunks_dir.iterdir():
            if d.is_dir():
                for f in d.iterdir():
                    if f.is_file():
                        chunk_count += 1
                        total_bytes += f.stat().st_size
        session_count = len(list(self.sessions_dir.glob("*.json")))
        history_path = self.history_dir / "history.jsonl"
        history_lines = 0
        if history_path.exists():
            with open(history_path) as f:
                history_lines = sum(1 for _ in f)
        return {
            "chunks_stored": chunk_count,
            "storage_bytes": total_bytes,
            "storage_mb": round(total_bytes / 1024 / 1024, 2),
            "sessions": session_count,
            "history_entries": history_lines,
        }
