"""Terminality session — PTY capture + chunked state + LLM integration."""

from __future__ import annotations
import os
import sys
import pty
import time
import json
import select
import struct
import fcntl
import termios
import signal
import hashlib
from collections import deque
from pathlib import Path
from typing import Optional

from .chunker import TerminalChunker, TerminalChunk, MerkleTree
from .history import InfiniteHistory, HistoryEntry, SessionState, DEFAULT_STORE_DIR
from .llm_stack import LLMRuntimeStack, LLMContext

SCROLLBACK_MAX = 100_000
DEFAULT_SHELL = os.environ.get("SHELL", "/bin/bash")


class TerminalitySession:
    """A terminal session with torrent state reconstruction.

    Replaces tmux: state is chunked + Merkle rooted + P2P distributable.
    Any node with the chunk set can reconstruct the full session.
    History is infinite (content-addressed dedup).
    """

    def __init__(
        self,
        shell: str = DEFAULT_SHELL,
        session_id: Optional[str] = None,
        store_dir: Path = DEFAULT_STORE_DIR,
        llm_stack: Optional[LLMRuntimeStack] = None,
    ):
        self.shell = shell
        self.session_id = session_id or hashlib.sha256(
            f"{time.time()}{os.getpid()}".encode()
        ).hexdigest()[:16]
        self.store = InfiniteHistory(store_dir)
        self.chunker = TerminalChunker()
        self.llm = llm_stack or LLMRuntimeStack()

        self.pid: Optional[int] = None
        self.master_fd: Optional[int] = None
        self.scrollback: deque = deque(maxlen=SCROLLBACK_MAX)
        self.screen_buffer = bytearray()
        self.cwd = os.getcwd()
        self.env_snapshot = dict(os.environ)
        self.created_at = time.time()
        self.last_activity = time.time()
        self._running = False

    def start(self, rows: int = 24, cols: int = 80):
        self.pid, self.master_fd = pty.fork()
        if self.pid == 0:
            env = self.env_snapshot.copy()
            env["TERM"] = "xterm-256color"
            env["LINES"] = str(rows)
            env["COLUMNS"] = str(cols)
            for k, v in env.items():
                os.environ[k] = v
            os.execvp(self.shell, [self.shell])
        else:
            self._running = True
            self._set_winsize(rows, cols)
            self._checkpoint("session_start")

    def _set_winsize(self, rows: int, cols: int):
        if self.master_fd:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)

    def run_command(self, command: str, timeout: float = 10.0) -> str:
        if not self.master_fd:
            raise RuntimeError("Session not started")
        os.write(self.master_fd, (command + "\n").encode())
        self.last_activity = time.time()
        output = bytearray()
        deadline = time.time() + timeout
        while time.time() < deadline:
            ready, _, _ = select.select([self.master_fd], [], [], 0.1)
            if ready:
                try:
                    data = os.read(self.master_fd, 65536)
                    if not data:
                        break
                    output.extend(data)
                    self._feed_output(data)
                except OSError:
                    break
            else:
                if output and time.time() - self.last_activity > 0.5:
                    break
        return output.decode("utf-8", errors="replace")

    def _feed_output(self, data: bytes):
        self.screen_buffer.extend(data)
        self.last_activity = time.time()
        chunks = self.chunker.feed(data, "output")
        for chunk in chunks:
            is_new = self.store.store_chunk(chunk)
            if is_new:
                self.store.append_history(HistoryEntry(
                    timestamp=chunk.timestamp,
                    chunk_hash=chunk.hash,
                    entry_type="output",
                    session_id=self.session_id,
                ))
        try:
            text = data.decode("utf-8", errors="replace")
            for line in text.split("\n"):
                self.scrollback.append(line)
        except Exception:
            pass

    def send_input(self, data: str):
        if not self.master_fd:
            raise RuntimeError("Session not started")
        encoded = data.encode()
        os.write(self.master_fd, encoded)
        chunks = self.chunker.feed(encoded, "input")
        for chunk in chunks:
            is_new = self.store.store_chunk(chunk)
            if is_new:
                self.store.append_history(HistoryEntry(
                    timestamp=chunk.timestamp,
                    chunk_hash=chunk.hash,
                    entry_type="input",
                    session_id=self.session_id,
                ))

    def capture_state(self) -> SessionState:
        final = self.chunker.flush("state_snapshot")
        if final:
            self.store.store_chunk(final)
        tree = self.chunker.get_merkle_tree()
        state = SessionState(
            session_id=self.session_id,
            merkle_root=tree.root,
            chunk_hashes=[c.hash for c in self.chunker.chunks],
            chunk_count=len(self.chunker.chunks),
            total_bytes=sum(c.size() for c in self.chunker.chunks),
            scrollback_lines=len(self.scrollback),
            cwd=self.cwd,
            env_snapshot={k: v for k, v in self.env_snapshot.items()
                         if not k.startswith("_") and len(v) < 1000},
            process_pid=self.pid,
            created_at=self.created_at,
            last_activity=self.last_activity,
        )
        self.store.save_session(state)
        self.store.save_merkle(self.session_id, tree)
        return state

    def _checkpoint(self, reason: str = ""):
        state = self.capture_state()
        self.store.append_history(HistoryEntry(
            timestamp=time.time(),
            chunk_hash=state.merkle_root,
            entry_type="state",
            session_id=self.session_id,
            metadata={"reason": reason},
        ))

    def reconstruct_screen(self) -> str:
        data = bytearray()
        for chunk in self.chunker.chunks:
            data.extend(chunk.data)
        return data.decode("utf-8", errors="replace")

    @classmethod
    def reconstruct(cls, state: SessionState, store: InfiniteHistory) -> "TerminalitySession":
        session = cls.__new__(cls)
        session.session_id = state.session_id
        session.store = store
        session.chunker = TerminalChunker()
        session.llm = LLMRuntimeStack()
        session.pid = None
        session.master_fd = None
        session.scrollback = deque(maxlen=SCROLLBACK_MAX)
        session.screen_buffer = bytearray()
        session.cwd = state.cwd
        session.env_snapshot = state.env_snapshot
        session.created_at = state.created_at
        session.last_activity = state.last_activity
        session._running = False

        for chunk_hash in state.chunk_hashes:
            chunk = store.load_chunk(chunk_hash)
            if chunk:
                session.chunker.chunks.append(chunk)
                session.chunker.chunk_index[chunk.hash] = chunk
                session.screen_buffer.extend(chunk.data)
                try:
                    text = chunk.data.decode("utf-8", errors="replace")
                    for line in text.split("\n"):
                        session.scrollback.append(line)
                except Exception:
                    pass

        tree = session.chunker.get_merkle_tree()
        if tree.root != state.merkle_root:
            raise ValueError(
                f"Merkle root mismatch! Expected {state.merkle_root[:16]}..., "
                f"got {tree.root[:16]}... Session may be corrupted."
            )
        return session

    def get_history(self, limit: int = 100) -> list[HistoryEntry]:
        return self.store.read_history(session_id=self.session_id, limit=limit)

    async def ask_llm(self, prompt: str) -> dict:
        history = self.get_history(limit=50)
        context = self.llm.build_context(
            session_id=self.session_id,
            history=history,
            store=self.store,
        )
        result = await self.llm.infer(context, prompt)
        if result.get("ok"):
            response_data = result["response"].encode()
            chunk = self.chunker._make_chunk(response_data, "llm_response")
            self.store.store_chunk(chunk)
            self.store.append_history(HistoryEntry(
                timestamp=time.time(),
                chunk_hash=chunk.hash,
                entry_type="llm_inference",
                session_id=self.session_id,
                metadata={"prompt": prompt[:200], "layers": result.get("layers", [])},
            ))
        return result

    def stats(self) -> dict:
        return {
            "session_id": self.session_id,
            "chunker": self.chunker.stats(),
            "store": self.store.stats(),
            "scrollback_lines": len(self.scrollback),
            "running": self._running,
            "pid": self.pid,
        }

    def close(self):
        if self.pid and self._running:
            try:
                os.kill(self.pid, signal.SIGHUP)
                os.waitpid(self.pid, 0)
            except Exception:
                pass
        if self.master_fd:
            try:
                os.close(self.master_fd)
            except Exception:
                pass
        self._running = False
        self._checkpoint("session_end")
