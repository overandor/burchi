"""Terminality — tmux replacement with torrent state reconstruction.

Replaces tmux's local-only session model with:
  1. PTY state capture (screen buffer + scrollback + process state)
  2. Content-addressed chunking of terminal output (Merkle tree)
  3. P2P state reconstruction from chunks (any peer can rebuild any session)
  4. Infinite history store (append-only, deduplicated, never lost)
  5. LLM runtime stack: llm → qllm → qrllm → qqc++llm
"""

from .chunker import TerminalChunker, TerminalChunk, MerkleTree
from .history import InfiniteHistory, HistoryEntry, SessionState
from .llm_stack import LLMRuntimeStack, LLMContext
from .session import TerminalitySession
from .p2p import ChunkExchange

__all__ = [
    "TerminalChunker", "TerminalChunk", "MerkleTree",
    "InfiniteHistory", "HistoryEntry", "SessionState",
    "LLMRuntimeStack", "LLMContext",
    "TerminalitySession", "ChunkExchange",
]
