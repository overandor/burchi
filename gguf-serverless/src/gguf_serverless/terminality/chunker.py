"""Content-addressed chunker + Merkle tree for terminal output."""

from __future__ import annotations
import hashlib
import time
from dataclasses import dataclass, field

CHUNK_SIZE = 4096
MERKLE_LEAF_PREFIX = b"\x00"
MERKLE_INTERNAL_PREFIX = b"\x01"


@dataclass
class TerminalChunk:
    index: int
    hash: str
    data: bytes
    timestamp: float
    chunk_type: str  # "output", "input", "state_snapshot", "llm_response"

    def size(self) -> int:
        return len(self.data)

    def verify(self) -> bool:
        return hashlib.sha256(self.data).hexdigest() == self.hash


@dataclass
class MerkleTree:
    layers: list[list[str]]
    root: str

    @classmethod
    def build(cls, chunks: list[TerminalChunk]) -> "MerkleTree":
        leaves = [
            hashlib.sha256(MERKLE_LEAF_PREFIX + c.data).hexdigest()
            for c in chunks
        ]
        layers = [leaves]
        current = leaves
        while len(current) > 1:
            nxt = []
            for i in range(0, len(current), 2):
                left = current[i]
                right = current[i + 1] if i + 1 < len(current) else current[i]
                nxt.append(hashlib.sha256(
                    MERKLE_INTERNAL_PREFIX + bytes.fromhex(left) + bytes.fromhex(right)
                ).hexdigest())
            layers.append(nxt)
            current = nxt
        root = current[0] if current else hashlib.sha256(b"").hexdigest()
        return cls(layers=layers, root=root)

    def verify_chunk(self, chunk: TerminalChunk, proof: list[tuple[str, bool]]) -> bool:
        h = hashlib.sha256(MERKLE_LEAF_PREFIX + chunk.data).hexdigest()
        for sibling, is_right in proof:
            if is_right:
                h = hashlib.sha256(
                    MERKLE_INTERNAL_PREFIX + bytes.fromhex(h) + bytes.fromhex(sibling)
                ).hexdigest()
            else:
                h = hashlib.sha256(
                    MERKLE_INTERNAL_PREFIX + bytes.fromhex(sibling) + bytes.fromhex(h)
                ).hexdigest()
        return h == self.root


class TerminalChunker:
    """Chunks terminal output into content-addressed blocks.

    Deduplication: identical output blocks produce identical hashes.
    Repeated commands (e.g. `ls` in same dir) share chunks.
    """

    def __init__(self, chunk_size: int = CHUNK_SIZE):
        self.chunk_size = chunk_size
        self.chunks: list[TerminalChunk] = []
        self.chunk_index: dict[str, TerminalChunk] = {}
        self.pending = bytearray()

    def feed(self, data: bytes, chunk_type: str = "output") -> list[TerminalChunk]:
        self.pending.extend(data)
        new_chunks = []
        while len(self.pending) >= self.chunk_size:
            block = bytes(self.pending[:self.chunk_size])
            self.pending = self.pending[self.chunk_size:]
            new_chunks.append(self._make_chunk(block, chunk_type))
        return new_chunks

    def flush(self, chunk_type: str = "output") -> TerminalChunk | None:
        if not self.pending:
            return None
        chunk = self._make_chunk(bytes(self.pending), chunk_type)
        self.pending = bytearray()
        return chunk

    def _make_chunk(self, data: bytes, chunk_type: str) -> TerminalChunk:
        h = hashlib.sha256(data).hexdigest()
        if h in self.chunk_index:
            return self.chunk_index[h]
        chunk = TerminalChunk(
            index=len(self.chunks), hash=h, data=data,
            timestamp=time.time(), chunk_type=chunk_type,
        )
        self.chunks.append(chunk)
        self.chunk_index[h] = chunk
        return chunk

    def get_merkle_tree(self) -> MerkleTree:
        return MerkleTree.build(self.chunks)

    def stats(self) -> dict:
        total = sum(c.size() for c in self.chunks)
        unique = len(self.chunk_index)
        return {
            "total_chunks": len(self.chunks),
            "unique_chunks": unique,
            "total_bytes": total,
            "dedup_bytes_saved": (len(self.chunks) - unique) * self.chunk_size,
            "merkle_root": self.get_merkle_tree().root[:16] + "...",
        }
