#!/usr/bin/env python3
"""
Terminality Runtime CLI — real end-to-end tool for the inference mesh.

Usage:
  terminality-runtime run "analyze this repo for security issues"
  terminality-runtime run "explain the auth flow" --model claude-3.5-sonnet
  terminality-runtime run "continue analysis" --from-rollup <hash>
  terminality-runtime peers list
  terminality-runtime peers add --id claude --model claude-3.5-sonnet --provider anthropic
  terminality-runtime seeds search "security"
  terminality-runtime seeds list
  terminality-runtime frames list
  terminality-runtime frames show <cid>
  terminality-runtime status
  terminality-runtime ledger list
  terminality-runtime ledger show <type>

This actually:
  1. Calls a real LLM API
  2. Creates a real inference rollup
  3. Stores it in SQLite (persists across runs)
  4. Seeds the reasoning to the mesh
  5. Can continue from a previous rollup with a different model
"""

from __future__ import annotations
import sys
import os
import json
import time
import hashlib
import argparse
from pathlib import Path

# Add src to path for development
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from gguf_serverless.terminality.runtime.persistence import Persistence
from gguf_serverless.terminality.runtime.llm_client import LLMClient
from gguf_serverless.terminality.runtime.inference_rollups import (
    InferenceRollup, ReasoningStep, ModelIndependentState,
    InferenceRollupManager, RollupStatus,
)
from gguf_serverless.terminality.runtime.universal_frame import (
    UniversalInferenceFrame, FrameGraph, FrameType, Provider,
)


def get_db():
    db_path = os.environ.get("TERMINALITY_DB",
                             str(Path.home() / ".terminality" / "runtime.db"))
    return Persistence(db_path)


def cmd_status(args):
    """Show runtime status."""
    db = get_db()
    stats = db.stats()
    print("Terminality Runtime Status")
    print("=" * 40)
    print(f"  Database: {stats['db_path']}")
    print(f"  DB size:  {stats['db_size_kb']} KB")
    print()
    print(f"  Objects:        {stats['objects']}")
    print(f"  Frames:         {stats['frames']}")
    print(f"  Rollups:        {stats['rollups']}")
    print(f"  Graph nodes:    {stats['graph_nodes']}")
    print(f"  Ledger entries: {stats['ledger_entries']}")
    print(f"  Terminal states:{stats['terminal_states']}")
    print(f"  Peers:          {stats['peers']}")
    print(f"  Seeds:          {stats['seeds']}")
    db.close()


def cmd_run(args):
    """Run an objective — real LLM call, real rollup, real persistence."""
    db = get_db()

    model = args.model or os.environ.get("TERMINALITY_MODEL", "gpt-4o-mini")
    provider = args.provider or os.environ.get("TERMINALITY_PROVIDER", "openai")

    # If continuing from a rollup, load it
    context_messages = []
    parent_rollup = None
    if args.from_rollup:
        parent_rollup = db.get_rollup(args.from_rollup)
        if parent_rollup:
            print(f"Continuing from rollup {args.from_rollup[:12]}...")
            print(f"  Objective: {parent_rollup.get('state', {}).get('objectives_remaining', ['?'])[0]}")
            print(f"  Steps: {len(parent_rollup.get('steps', []))}")
            print(f"  Verified facts: {len(parent_rollup.get('state', {}).get('verified_facts', []))}")
            for step in parent_rollup.get("steps", []):
                context_messages.append({
                    "role": "assistant",
                    "content": f"{step.get('action', '')}: {str(step.get('output_state', ''))[:200]}",
                })
        else:
            print(f"Warning: Rollup {args.from_rollup[:12]} not found, starting fresh")

    system_msg = "You are a reasoning engine in the Terminality runtime. Be concise and precise."
    if parent_rollup:
        facts = parent_rollup.get("state", {}).get("verified_facts", [])
        if facts:
            system_msg += "\n\nVerified facts from previous reasoning:\n" + "\n".join(f"- {f}" for f in facts[:20])

    messages = [{"role": "system", "content": system_msg}]
    messages.extend(context_messages[-10:])
    messages.append({"role": "user", "content": args.objective})

    endpoint = os.environ.get("TERMINALITY_ENDPOINT", "")
    client = LLMClient(provider=provider, model=model, endpoint=endpoint)

    print(f"Calling {provider}/{model}...")
    try:
        response = client.chat(messages, max_tokens=args.max_tokens, temperature=args.temperature)
    except Exception as e:
        print(f"Error: {e}")
        db.close()
        sys.exit(1)

    print(f"Response ({response.total_tokens} tokens, {response.elapsed_ms:.0f}ms):")
    print("-" * 60)
    print(response.text)
    print("-" * 60)

    # Create a rollup
    rollup = InferenceRollup(
        rollup_id=hashlib.sha256(f"rollup:{time.time()}".encode()).hexdigest()[:16],
        state=ModelIndependentState(
            objectives_remaining=[args.objective],
        ),
        steps=[],
        parent_rollups=[args.from_rollup] if args.from_rollup else [],
    )
    rollup.add_step(ReasoningStep(
        step_id="s1",
        action=args.objective[:100],
        input_state={"context_steps": len(context_messages)},
        output_state={"response": response.text[:500]},
        evidence="llm_response",
        model_used=response.model,
        tokens_consumed=response.total_tokens,
    ))

    rollup_dict = {
        "hash": rollup.hash,
        "rollup_id": rollup.rollup_id,
        "status": rollup.status.value,
        "parent_rollups": [args.from_rollup] if args.from_rollup else [],
        "model_provenance": [response.model],
        "steps": [
            {
                "step_id": s.step_id,
                "action": s.action,
                "input_state": s.input_state,
                "output_state": s.output_state,
                "evidence": s.evidence,
                "model_used": s.model_used,
                "tokens_consumed": s.tokens_consumed,
                "verified": s.verified,
            }
            for s in rollup.steps
        ],
        "state": {
            "verified_facts": [],
            "objectives_remaining": [args.objective],
            "token_lineage": [{"step": "s1", "model": response.model, "tokens": response.total_tokens}],
        },
    }
    db.store_rollup(rollup_dict)

    # Create and store a universal frame
    try:
        prov = Provider(response.provider)
    except ValueError:
        prov = Provider.CUSTOM

    frame = UniversalInferenceFrame(
        frame_id=hashlib.sha256(f"frame:{time.time()}".encode()).hexdigest()[:16],
        frame_type=FrameType.INFERENCE,
        prompt=args.objective,
        model_id=response.model,
        provider=prov,
        response=response.text,
        tokens_consumed=response.total_tokens,
    )
    db.store_frame(frame.to_dict())

    # Append to ledgers
    db.append_ledger("inference", {
        "model": response.model,
        "provider": response.provider,
        "tokens_in": response.tokens_in,
        "tokens_out": response.tokens_out,
        "objective": args.objective[:100],
        "rollup_hash": rollup.hash,
        "frame_cid": frame.cid,
        "elapsed_ms": response.elapsed_ms,
    }, signer=os.environ.get("USER", "cli"))

    db.append_ledger("execution", {
        "command": f"terminality-runtime run '{args.objective[:50]}'",
        "model": response.model,
        "tokens": response.total_tokens,
    }, signer=os.environ.get("USER", "cli"))

    # Seed the reasoning
    seed_dict = {
        "peer_id": os.environ.get("USER", "cli"),
        "rollup_hash": rollup.hash,
        "objective": args.objective,
        "verified_conclusions": [],
        "evidence_frontier": [frame.cid],
        "confidence": 0.5,
        "tokens_invested": response.total_tokens,
        "seed_count": 0,
    }
    db.store_seed(seed_dict)

    print()
    print(f"Rollup: {rollup.hash[:12]} (stored in SQLite)")
    print(f"Frame:  {frame.short_cid} (stored)")
    print(f"Ledger: inference + execution entries appended")
    print(f"Tokens: {response.total_tokens} ({response.tokens_in} in / {response.tokens_out} out)")
    print(f"Seed:   stored (confidence=0.5)")
    print()
    print(f"To continue with a different model:")
    print(f"  terminality-runtime run 'next step' --from-rollup {rollup.hash[:12]} --model gpt-4o")

    db.close()


def cmd_peers_list(args):
    db = get_db()
    peers = db.list_peers()
    if not peers:
        print("No peers registered.")
        db.close()
        return
    print(f"{'Peer ID':<20} {'Model':<25} {'Family':<10} {'Status'}")
    print("-" * 70)
    for p in peers:
        print(f"{p['peer_id']:<20} {p['model_id']:<25} {p['model_family']:<10} {p['status']}")
    db.close()


def cmd_peers_add(args):
    db = get_db()
    caps = {
        "model_family": args.family or args.provider,
        "model_id": args.model,
        "provider": args.provider,
        "context_window": args.context,
        "endpoint_url": args.endpoint or "",
        "api_key_env": args.api_key_env or "",
    }
    db.store_peer(args.id, caps, status="online")
    print(f"Registered peer: {args.id} ({args.model})")
    db.close()


def cmd_seeds_search(args):
    db = get_db()
    seeds = db.list_seeds(objective=args.query)
    if not seeds:
        print("No seeds found.")
        db.close()
        return
    print(f"Found {len(seeds)} seed(s):")
    print("-" * 70)
    for s in seeds:
        print(f"  {s.get('peer_id', '?')}: {s.get('objective', '?')[:60]}")
        print(f"    confidence={s.get('confidence', 0)}, tokens={s.get('tokens_invested', 0)}")
    db.close()


def cmd_seeds_list(args):
    db = get_db()
    seeds = db.list_seeds()
    if not seeds:
        print("No seeds.")
        db.close()
        return
    for s in seeds:
        print(f"  {s.get('peer_id', '?')}: {s.get('objective', '?')[:60]} (conf={s.get('confidence', 0)})")
    db.close()


def cmd_frames_list(args):
    db = get_db()
    frames = db.list_frames()
    if not frames:
        print("No frames.")
        db.close()
        return
    print(f"{'CID':<14} {'Type':<12} {'Model':<25} {'Tokens'}")
    print("-" * 60)
    for f in frames:
        print(f"{f.get('cid', '?')[:12]:<14} {f.get('frame_type', '?'):<12} {f.get('model_id', '?'):<25} {f.get('tokens_consumed', 0)}")
    db.close()


def cmd_frames_show(args):
    db = get_db()
    frame = db.get_frame(args.cid)
    if not frame:
        print(f"Frame {args.cid} not found.")
        db.close()
        return
    print(json.dumps(frame, indent=2, default=str))
    db.close()


def cmd_ledger_list(args):
    db = get_db()
    ledger_types = [
        "execution", "inference", "filesystem", "tool", "artifact",
        "knowledge", "verification", "reward", "authority", "identity", "network",
    ]
    print(f"{'Ledger':<15} {'Entries'}")
    print("-" * 25)
    for lt in ledger_types:
        count = db.count_ledger_entries(lt)
        print(f"{lt:<15} {count}")
    db.close()


def cmd_ledger_show(args):
    db = get_db()
    entries = db.list_ledger_entries(args.type, limit=args.limit)
    if not entries:
        print(f"No entries in {args.type} ledger.")
        db.close()
        return
    for e in entries:
        print(f"  {e['hash'][:12]} [{e['signer']}] {json.dumps(e['data'])[:80]}")
    db.close()


def main():
    parser = argparse.ArgumentParser(
        prog="terminality-runtime",
        description="Content-Addressed Agent Runtime CLI",
    )
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("status", help="Show runtime status")

    p_run = sub.add_parser("run", help="Run an objective with a real LLM")
    p_run.add_argument("objective", help="What to reason about")
    p_run.add_argument("--model", default="", help="Model ID (default: gpt-4o-mini)")
    p_run.add_argument("--provider", default="", help="Provider: openai, anthropic, local, llm7")
    p_run.add_argument("--endpoint", default="", help="Custom API endpoint")
    p_run.add_argument("--from-rollup", default="", help="Continue from a previous rollup hash")
    p_run.add_argument("--max-tokens", type=int, default=512)
    p_run.add_argument("--temperature", type=float, default=0.3)

    p_peers = sub.add_parser("peers", help="Manage reasoning peers")
    sp_peers = p_peers.add_subparsers(dest="peers_command")
    sp_peers.add_parser("list", help="List peers")
    p_add = sp_peers.add_parser("add", help="Register a peer")
    p_add.add_argument("--id", required=True, help="Peer ID")
    p_add.add_argument("--model", required=True, help="Model ID")
    p_add.add_argument("--provider", default="openai", help="Provider")
    p_add.add_argument("--family", default="", help="Model family")
    p_add.add_argument("--context", type=int, default=8192, help="Context window")
    p_add.add_argument("--endpoint", default="", help="API endpoint")
    p_add.add_argument("--api-key-env", default="", help="Env var name for API key")

    p_seeds = sub.add_parser("seeds", help="Manage seeded reasoning")
    sp_seeds = p_seeds.add_subparsers(dest="seeds_command")
    p_search = sp_seeds.add_parser("search", help="Search seeds")
    p_search.add_argument("query", help="Search query")
    sp_seeds.add_parser("list", help="List all seeds")

    p_frames = sub.add_parser("frames", help="Manage inference frames")
    sp_frames = p_frames.add_subparsers(dest="frames_command")
    sp_frames.add_parser("list", help="List frames")
    p_show = sp_frames.add_parser("show", help="Show a frame")
    p_show.add_argument("cid", help="Frame CID")

    p_ledger = sub.add_parser("ledger", help="Manage ledgers")
    sp_ledger = p_ledger.add_subparsers(dest="ledger_command")
    sp_ledger.add_parser("list", help="List all ledgers")
    p_show_ledger = sp_ledger.add_parser("show", help="Show entries in a ledger")
    p_show_ledger.add_argument("type", help="Ledger type")
    p_show_ledger.add_argument("--limit", type=int, default=20)

    args = parser.parse_args()

    if args.command == "status":
        cmd_status(args)
    elif args.command == "run":
        cmd_run(args)
    elif args.command == "peers":
        if args.peers_command == "list":
            cmd_peers_list(args)
        elif args.peers_command == "add":
            cmd_peers_add(args)
        else:
            p_peers.print_help()
    elif args.command == "seeds":
        if args.seeds_command == "search":
            cmd_seeds_search(args)
        elif args.seeds_command == "list":
            cmd_seeds_list(args)
        else:
            p_seeds.print_help()
    elif args.command == "frames":
        if args.frames_command == "list":
            cmd_frames_list(args)
        elif args.frames_command == "show":
            cmd_frames_show(args)
        else:
            p_frames.print_help()
    elif args.command == "ledger":
        if args.ledger_command == "list":
            cmd_ledger_list(args)
        elif args.ledger_command == "show":
            cmd_ledger_show(args)
        else:
            p_ledger.print_help()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
