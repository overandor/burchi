#!/usr/bin/env python3
"""
CI/CD Research Generator — 24/7 continuous prior art research.

Loops through all 8 research categories, generates a draft for each,
then starts over. Runs forever. Saves everything to disk.

Each cycle:
  1. Search GitHub + arXiv + HuggingFace for prior art
  2. Generate 5-section research draft
  3. Save to output dir with timestamp
  4. Move to next category
  5. After all 8, start over

Usage:
  python3 cicd_research.py --output ./research_output
  python3 cicd_research.py --output ./research_output --interval 3600  # wait 1h between cycles
"""

import sys, os, time, json, argparse, traceback
from datetime import datetime
from pathlib import Path

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from prior_art_generator import (
    PriorArtResearcher, ResearchDraftGenerator, RESEARCH_CATEGORIES,
    llm_chat, llm_generate_long
)

def run_cycle(cycle_num, output_dir):
    """Run one full cycle through all categories."""
    researcher = PriorArtResearcher()
    cycle_dir = output_dir / f"cycle_{cycle_num:04d}"
    cycle_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'#'*70}", flush=True)
    print(f"#  CYCLE {cycle_num} — {datetime.now().isoformat()}", flush=True)
    print(f"#  Output: {cycle_dir}", flush=True)
    print(f"{'#'*70}", flush=True)

    results_summary = []

    for i, category in enumerate(RESEARCH_CATEGORIES):
        print(f"\n{'='*60}", flush=True)
        print(f"  [{i+1}/8] {category['name']}", flush=True)
        print(f"  Gap: {category['gap'][:80]}...", flush=True)
        print(f"{'='*60}", flush=True)

        try:
            # Search for prior art
            prior_art = researcher.research(category)

            # Generate draft
            generator = ResearchDraftGenerator(output_dir=str(cycle_dir))
            filepath, tokens = generator.generate_draft(category, prior_art)

            results_summary.append({
                "category": category["name"],
                "prior_art_count": len(prior_art),
                "tokens_generated": tokens,
                "file": str(filepath),
                "status": "success",
            })

            print(f"\n  ✅ {category['name']}: {tokens} tokens, {len(prior_art)} sources", flush=True)

        except Exception as e:
            print(f"\n  ❌ {category['name']}: {e}", flush=True)
            traceback.print_exc()
            results_summary.append({
                "category": category["name"],
                "status": "failed",
                "error": str(e),
            })
            continue

    # Save cycle summary
    summary_path = cycle_dir / "cycle_summary.json"
    summary_path.write_text(json.dumps({
        "cycle": cycle_num,
        "timestamp": datetime.now().isoformat(),
        "categories": results_summary,
        "total_tokens": sum(r.get("tokens_generated", 0) for r in results_summary),
    }, indent=2))

    print(f"\n{'#'*70}", flush=True)
    print(f"#  CYCLE {cycle_num} COMPLETE", flush=True)
    print(f"#  Categories: {len(results_summary)}", flush=True)
    print(f"#  Success: {sum(1 for r in results_summary if r['status']=='success')}", flush=True)
    print(f"#  Failed: {sum(1 for r in results_summary if r['status']=='failed')}", flush=True)
    print(f"{'#'*70}", flush=True)

    return results_summary


def main():
    parser = argparse.ArgumentParser(description="CI/CD 24/7 Research Generator")
    parser.add_argument("--output", type=str, default="./research_output",
                        help="Output directory")
    parser.add_argument("--interval", type=int, default=0,
                        help="Seconds to wait between cycles (0 = no wait)")
    parser.add_argument("--max-cycles", type=int, default=0,
                        help="Max cycles (0 = infinite)")
    args = parser.parse_args()

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Write master index
    index_path = output_dir / "INDEX.md"
    index_path.write_text(f"# Research Output Index\n\n*Started: {datetime.now().isoformat()}*\n\n")

    cycle = 1
    all_summaries = []

    while True:
        try:
            summary = run_cycle(cycle, output_dir)
            all_summaries.append({"cycle": cycle, "results": summary})

            # Update index
            index_lines = [f"# Research Output Index",
                          f"*Last updated: {datetime.now().isoformat()}*",
                          f"*Cycles completed: {cycle}*",
                          f"*Total drafts: {sum(len(s['results']) for s in all_summaries)}*",
                          ""]
            for s in all_summaries[-10:]:  # last 10 cycles
                index_lines.append(f"## Cycle {s['cycle']}")
                for r in s["results"]:
                    status = "✅" if r["status"] == "success" else "❌"
                    tokens = r.get("tokens_generated", 0)
                    index_lines.append(f"  {status} {r['category']} — {tokens} tokens")
                index_lines.append("")
            index_path.write_text("\n".join(index_lines))

        except KeyboardInterrupt:
            print(f"\n\nStopped by user after {cycle} cycles.", flush=True)
            break
        except Exception as e:
            print(f"\n⚠ Cycle {cycle} crashed: {e}", flush=True)
            traceback.print_exc()

        if args.max_cycles and cycle >= args.max_cycles:
            print(f"\nReached max cycles ({args.max_cycles}). Stopping.", flush=True)
            break

        cycle += 1

        if args.interval > 0:
            print(f"\n⏳ Waiting {args.interval}s before next cycle...", flush=True)
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
