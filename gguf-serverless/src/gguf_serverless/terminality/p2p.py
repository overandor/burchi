"""P2P chunk exchange — torrent-style terminal state distribution.

Nodes announce chunks, request missing ones, verify via Merkle proofs.
Any node can reconstruct any session from any subset of peers.
"""

from __future__ import annotations
import os
import time
import hashlib
from typing import Optional

from .chunker import TerminalChunk, MerkleTree
from .history import InfiniteHistory, SessionState
from .session import TerminalitySession


class ChunkExchange:
    """P2P chunk exchange protocol for terminal state."""

    def __init__(self, store: InfiniteHistory, tracker_url: str = ""):
        self.store = store
        self.tracker_url = tracker_url
        self.have_chunks: set[str] = set()
        self._scan_local_chunks()

    def _scan_local_chunks(self):
        if self.store.chunks_dir.exists():
            for d in self.store.chunks_dir.iterdir():
                if d.is_dir():
                    for f in d.iterdir():
                        if f.is_file():
                            self.have_chunks.add(d.name + f.name)

    def announce(self, session_id: str, chunk_hashes: list[str]) -> dict:
        return {
            "session_id": session_id,
            "chunks": chunk_hashes,
            "peer_id": hashlib.sha256(
                f"{os.getpid()}{time.time()}".encode()
            ).hexdigest()[:16],
            "timestamp": time.time(),
        }

    def serve_chunk(self, chunk_hash: str) -> Optional[TerminalChunk]:
        return self.store.load_chunk(chunk_hash)

    def receive_chunk(self, chunk: TerminalChunk, expected_root: str,
                      proof: list[tuple[str, bool]]) -> bool:
        if not chunk.verify():
            return False
        tree = MerkleTree(layers=[], root=expected_root)
        if not tree.verify_chunk(chunk, proof):
            return False
        self.store.store_chunk(chunk)
        self.have_chunks.add(chunk.hash)
        return True

    def reconstruct_session(self, state: SessionState) -> TerminalitySession:
        missing = [h for h in state.chunk_hashes if h not in self.have_chunks]
        if missing:
            for h in missing:
                chunk = self.store.load_chunk(h)
                if chunk:
                    self.have_chunks.add(h)
                else:
                    raise ValueError(
                        f"Missing chunk {h[:16]}... Need {len(missing)} more chunks."
                    )
        return TerminalitySession.reconstruct(state, self.store)
