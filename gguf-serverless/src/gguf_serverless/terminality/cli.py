"""Terminality CLI — tmux replacement with torrent state reconstruction + LLM runtime."""

from __future__ import annotations
import sys
import os
import asyncio
import select
import argparse
from pathlib import Path

from .session import TerminalitySession, DEFAULT_SHELL
from .history import InfiniteHistory, DEFAULT_STORE_DIR
from .p2p import ChunkExchange


def main():
    parser = argparse.ArgumentParser(
        prog="terminality",
        description="tmux replacement with torrent state reconstruction + LLM runtime",
    )
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("run", help="Start an interactive terminal session")
    sub.add_parser("stats", help="Show storage statistics")
    rec = sub.add_parser("reconstruct", help="Reconstruct a session from state")
    rec.add_argument("session_id")
    hist = sub.add_parser("history", help="Show session history")
    hist.add_argument("--session", default="")
    hist.add_argument("--limit", type=int, default=50)
    ask = sub.add_parser("ask", help="Ask LLM about a session")
    ask.add_argument("session_id")
    ask.add_argument("prompt")
    sub.add_parser("sessions", help="List all stored sessions")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    if args.command == "run":
        _cmd_run()
    elif args.command == "stats":
        store = InfiniteHistory(DEFAULT_STORE_DIR)
        s = store.stats()
        print(f"Chunks stored:    {s['chunks_stored']}")
        print(f"Storage:          {s['storage_mb']} MB")
        print(f"Sessions:         {s['sessions']}")
        print(f"History entries:  {s['history_entries']}")
    elif args.command == "reconstruct":
        store = InfiniteHistory(DEFAULT_STORE_DIR)
        state = store.load_session(args.session_id)
        if not state:
            print(f"Session not found: {args.session_id}")
            sys.exit(1)
        session = TerminalitySession.reconstruct(state, store)
        screen = session.reconstruct_screen()
        print(screen[-2000:] if len(screen) > 2000 else screen)
        print(f"\n--- Reconstructed: {state.chunk_count} chunks, "
              f"merkle={state.merkle_root[:16]}... ---")
    elif args.command == "history":
        store = InfiniteHistory(DEFAULT_STORE_DIR)
        entries = store.read_history(
            session_id=args.session or None, limit=args.limit
        )
        for e in entries[-args.limit:]:
            print(f"[{e.timestamp:.0f}] {e.entry_type:15s} {e.chunk_hash[:16]}...")
    elif args.command == "ask":
        store = InfiniteHistory(DEFAULT_STORE_DIR)
        state = store.load_session(args.session_id)
        if not state:
            print(f"Session not found: {args.session_id}")
            sys.exit(1)
        session = TerminalitySession.reconstruct(state, store)
        result = asyncio.run(session.ask_llm(args.prompt))
        if result.get("ok"):
            print(f"Layers: {' → '.join(result.get('layers', []))}")
            print(f"\n{result['response']}")
        else:
            print(f"Error: {result.get('error')}")
    elif args.command == "sessions":
        store = InfiniteHistory(DEFAULT_STORE_DIR)
        for f in sorted(store.sessions_dir.glob("*.json")):
            import json
            data = json.loads(f.read_text())
            print(f"  {data['session_id']}  "
                  f"chunks={data['chunk_count']}  "
                  f"scrollback={data['scrollback_lines']}  "
                  f"created={data['created_at']:.0f}")


def _cmd_run():
    session = TerminalitySession()
    session.start()
    print(f"Session: {session.session_id}", file=sys.stderr)
    print(f"Store:   {session.store.store_dir}", file=sys.stderr)
    print(f"PID:     {session.pid}", file=sys.stderr)
    print(f"Ctrl+D to exit. State auto-chunked + Merkle rooted.\n", file=sys.stderr)

    try:
        while session._running:
            ready, _, _ = select.select(
                [sys.stdin, session.master_fd], [], [], 1.0
            )
            if sys.stdin in ready:
                data = os.read(sys.stdin.fileno(), 1024)
                if not data:
                    break
                session.send_input(data.decode("utf-8", errors="replace"))
            if session.master_fd in ready:
                try:
                    data = os.read(session.master_fd, 65536)
                    if not data:
                        break
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
                    session._feed_output(data)
                except OSError:
                    break
    except KeyboardInterrupt:
        pass
    finally:
        state = session.capture_state()
        print(f"\n\nSession saved: {state.session_id}", file=sys.stderr)
        print(f"Merkle root:   {state.merkle_root[:32]}...", file=sys.stderr)
        print(f"Chunks:        {state.chunk_count}", file=sys.stderr)
        print(f"Total:         {state.total_bytes / 1024:.1f} KB", file=sys.stderr)
        session.close()


if __name__ == "__main__":
    main()
