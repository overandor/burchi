#!/usr/bin/env python3
"""ChatSync analysis pipeline CLI.

Runs the full flow:
  1. Sync conversations from all adapters (Windsurf/Devin/Claude/Acodex/
     ChatGPT/Antigravity) into the unified DB.
  2. Disassemble conversations into business processes.
  3. Research prior art (web + patents + academic) for each process.
  4. Synthesize a unique revenue-producing automation recommendation.
  5. Write outputs: dossier entry + adas-venture + orchestrator state + ledger.

Usage:
    python runner.py                          # full pipeline run
    python runner.py --no-sync                # skip sync, use existing DB
    python runner.py --since 7d               # only chats from last 7 days
    python runner.py --limit 20               # only scan 20 most recent chats
    python runner.py --no-llm                 # deterministic mode (no LLM calls)
    python runner.py --no-prior-art           # skip web/patent search
    python runner.py --dry-run                # don't write outputs, just print
    python runner.py --scrape-chatgpt         # run ChatGPT browser scraper first
    python runner.py --scrape-chatgpt --headless

Environment:
    OPENAI_API_KEY / OPENAI_BASE_URL / LLM_MODEL  — for LLM-optional steps
    BRAVE_SEARCH_API_KEY                          — for higher-quality web search
    CHATSYNC_DB_PATH                              — override DB location
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

# Ensure backend/ is on the path when run as a script.
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import DB_PATH, init_db  # noqa: E402
from sync_engine import SyncEngine  # noqa: E402
from pipeline.disassembly import disassemble_conversations, cluster_processes  # noqa: E402
from pipeline.prior_art import research_all  # noqa: E402
from pipeline.recommendation import recommend  # noqa: E402
from pipeline.outputs import (  # noqa: E402
    write_dossier_entry, spawn_venture, feed_orchestrator, append_ledger,
    DEFAULT_DOSSIER, DEFAULT_VENTURES_DIR, DEFAULT_ORCHESTRATOR_STATE, DEFAULT_PIPELINE_LEDGER,
)


def _parse_since(since: str) -> float:
    import re
    m = re.fullmatch(r"(\d+)([smhdw])", since)
    if not m:
        return 0.0
    n, unit = int(m.group(1)), m.group(2)
    mult = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}[unit]
    return time.time() - n * mult


async def run_pipeline(args: argparse.Namespace) -> dict:
    db_path = str(DB_PATH)
    await init_db()

    # Step 0: Optionally scrape ChatGPT.
    if args.scrape_chatgpt:
        print("[0] Scraping ChatGPT via Playwright…")
        from chatgpt_scraper import scrape as scrape_chatgpt
        scrape_result = await scrape_chatgpt(limit=0, since_ts=0.0, headless=args.headless)
        print(f"    Scraped: {scrape_result.get('scraped', 0)} conversations, "
              f"{len(scrape_result.get('errors', []))} errors")
        if scrape_result.get("errors") and not scrape_result.get("scraped"):
            print("    Scraper errors (aborting scrape step):")
            for e in scrape_result["errors"][:5]:
                print(f"      - {e}")

    # Step 1: Sync.
    if not args.no_sync:
        print("[1] Syncing conversations from all adapters…")
        engine = SyncEngine(db_path)
        sync_result = await engine.sync_all()
        print(f"    Synced: {sync_result['synced']} conversations, "
              f"{len(sync_result['errors'])} errors")
        if sync_result["errors"]:
            for e in sync_result["errors"][:5]:
                print(f"      - {e}")
    else:
        print("[1] Skipping sync (using existing DB).")

    # Step 2: Disassemble.
    since_ts = _parse_since(args.since) if args.since else 0.0
    print(f"[2] Disassembling conversations into business processes (since={args.since or 'all'}, limit={args.limit or 'all'})…")
    processes = await disassemble_conversations(
        db_path, since_ts=since_ts, limit=args.limit, use_llm=not args.no_llm
    )
    print(f"    Extracted {len(processes)} business processes.")
    if not processes:
        print("    No business processes found. Nothing to do.")
        return {"processes": 0, "recommendation": None}

    clusters = cluster_processes(processes)
    for cat, bps in clusters.items():
        print(f"      [{cat}] {len(bps)} processes")

    # Step 3: Prior-art research.
    reports = []
    if not args.no_prior_art:
        print(f"[3] Researching prior art for {len(processes)} processes (web + patents + academic)…")
        reports = await research_all(processes, concurrency=4)
        novel = sum(1 for r in reports if r.novelty_assessment == "novel")
        partial = sum(1 for r in reports if r.novelty_assessment == "partially novel")
        known = sum(1 for r in reports if r.novelty_assessment == "known")
        print(f"    Novel: {novel} | Partially novel: {partial} | Known: {known}")
    else:
        print("[3] Skipping prior-art research.")

    # Step 4: Recommend.
    print("[4] Synthesizing recommendation…")
    recommendation = await recommend(processes, reports, use_llm=not args.no_llm)
    print(f"    Product: {recommendation.product_name}")
    print(f"    Category: {recommendation.new_category}")
    print(f"    Novelty: {recommendation.novelty_assessment}")
    print(f"    Revenue: {recommendation.revenue_model.pricing}")

    # Step 5: Write outputs.
    if args.dry_run:
        print("[5] Dry-run: skipping output writes.")
        print(json.dumps(recommendation.to_dict(), indent=2, default=str))
    else:
        print("[5] Writing outputs…")
        dossier_section = write_dossier_entry(recommendation, processes, reports)
        print(f"    Dossier entry: {dossier_section}")
        print(f"      -> {DEFAULT_DOSSIER}")

        venture_path = spawn_venture(recommendation)
        print(f"    Venture spawned: {venture_path.name}")
        print(f"      -> {venture_path}")

        fed = feed_orchestrator(recommendation, venture_path)
        print(f"    Orchestrator state updated: {fed}")
        print(f"      -> {DEFAULT_ORCHESTRATOR_STATE}")

        append_ledger(recommendation, processes, reports, dossier_section, venture_path)
        print(f"    Ledger appended: {DEFAULT_PIPELINE_LEDGER}")

    return {
        "processes": len(processes),
        "reports": len(reports),
        "recommendation": recommendation.to_dict() if not args.dry_run else recommendation.to_dict(),
    }


def main():
    ap = argparse.ArgumentParser(description="ChatSync analysis pipeline: chats → processes → prior art → recommendation.")
    ap.add_argument("--no-sync", action="store_true", help="Skip sync step.")
    ap.add_argument("--since", type=str, default="", help="Only chats since (e.g. 7d, 12h).")
    ap.add_argument("--limit", type=int, default=0, help="Max conversations to scan (0=all).")
    ap.add_argument("--no-llm", action="store_true", help="Deterministic mode (no LLM calls).")
    ap.add_argument("--no-prior-art", action="store_true", help="Skip web/patent search.")
    ap.add_argument("--dry-run", action="store_true", help="Don't write outputs, just print.")
    ap.add_argument("--scrape-chatgpt", action="store_true", help="Run ChatGPT browser scraper first.")
    ap.add_argument("--headless", action="store_true", help="Run ChatGPT scraper headless.")
    args = ap.parse_args()

    try:
        result = asyncio.run(run_pipeline(args))
        if result["processes"] == 0:
            sys.exit(0)
        print("\nPipeline complete.")
    except KeyboardInterrupt:
        print("\nInterrupted.")
        sys.exit(130)
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
