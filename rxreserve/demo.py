#!/usr/bin/env python
"""Design Genome Runtime — Beauty Discovery Pipeline

This demo runs the full discover → observe → replicate → compile pipeline:

1. DISCOVER: Crawl design directories to find beautiful websites
2. OBSERVE: Render each site in a real browser, score its beauty,
   identify what makes it beautiful
3. REPLICATE: Generate HTML/CSS that attempts to reproduce the beauty,
   evaluate in browser, iterate through mutations
4. COMPILE: Turn all observations and replications into a readable
   skill document that another LLM can follow to produce beautiful UI

The knowledge base persists across runs — every execution adds more
observations and the compiled skill gets richer.

Usage:
    python demo.py                    # Run full pipeline
    python demo.py --sites 10         # Observe 10 sites
    python demo.py --headless         # Run browser headless
    python demo.py --no-replicate     # Skip replication, just observe
"""

import asyncio
import os
import sys
import time

# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def banner(title: str) -> None:
    line = "═" * 72
    print(f"\n  {line}")
    print(f"  {title}")
    print(f"  {line}")

def sub(title: str) -> None:
    print(f"\n  ── {title} ──")

def field(label: str, value, indent: int = 4) -> None:
    val_str = str(value)
    if len(val_str) > 50:
        val_str = val_str[:47] + "..."
    print(f"{' ' * indent}{label:30s} {val_str}")

def bar(score: float, width: int = 30) -> str:
    filled = int(score * width)
    return "█" * filled + "░" * (width - filled)


# ─────────────────────────────────────────────────────────────
# Main pipeline
# ─────────────────────────────────────────────────────────────

async def run_pipeline(
    max_sites: int = 5,
    headless: bool = False,
    replicate: bool = True,
    max_replication_generations: int = 3,
):
    from rxreserve.discovery_engine import DiscoveryEngine
    from rxreserve.beauty_observer import BeautyObserver
    from rxreserve.replication_engine import ReplicationEngine
    from rxreserve.skill_compiler import SkillCompiler
    from rxreserve.knowledge_base import KnowledgeBase

    base_dir = os.path.dirname(os.path.abspath(__file__))
    video_dir = os.path.join(base_dir, "demo_videos")
    db_path = os.path.join(base_dir, "beauty_knowledge.json")
    skill_path = os.path.join(base_dir, "ui_beauty_skill.md")

    banner("DESIGN GENOME RUNTIME — BEAUTY DISCOVERY PIPELINE")
    print(f"  Mode: {'headless' if headless else 'visible browser'}")
    print(f"  Sites to observe: {max_sites}")
    print(f"  Replication: {'enabled' if replicate else 'disabled'}")
    print(f"  Knowledge base: {db_path}")

    # ─────────────────────────────────────────────────────────
    # 1. DISCOVER — Find beautiful websites
    # ─────────────────────────────────────────────────────────
    banner("1. DISCOVER — Crawling directories for beautiful websites")

    discovery = DiscoveryEngine()
    kb = KnowledgeBase(db_path)
    kb.increment_run()

    # Skip URLs we've already observed
    visited = kb.get_visited_urls()

    sub("Crawling directory pages to extract site links...")
    sources_found = 0
    sources: list = []
    while sources_found < max_sites:
        source = await discovery.next_source()
        if source is None:
            print("  No more sources discoverable from directories.")
            break
        if source.url in visited:
            continue
        sources.append(source)
        sources_found += 1
        print(f"        [{sources_found}/{max_sites}] {source.url}")

    sub("Discovery summary")
    field("Sources found", len(sources))
    field("Directories crawled", discovery.crawled_count())
    field("Total URLs discovered", discovery.visited_count())
    field("Queue remaining", discovery.queue_size())
    field("Previously visited (skipped)", len(visited))

    if not sources:
        print("\n  ⚠ No new sources found. All directories crawled and all sites visited.")
        print("  The knowledge base has accumulated data from previous runs.")
        kb_summary = kb.summary()
        print(f"  Total observations in knowledge base: {kb_summary['total_observations']}")
        print(f"  Total replications in knowledge base: {kb_summary['total_replications']}")
        return

    # ─────────────────────────────────────────────────────────
    # 2. OBSERVE — Render and score each site's beauty
    # ─────────────────────────────────────────────────────────
    banner("2. OBSERVE — Rendering sites and scoring beauty")

    observer = BeautyObserver(headless=headless, video_dir=video_dir)
    observations = []

    for i, source in enumerate(sources):
        url = source.url
        print(f"\n  [{i+1}/{len(sources)}] Observing {url}...")

        try:
            obs = await observer.observe(url)
            if obs is None:
                print(f"        ⚠ Could not observe (render failed or blocked)")
                continue

            observations.append(obs)
            kb.add_observation(obs)

            sub(f"Beauty analysis — {url}")
            field("Beauty score", f"{obs.beauty_score:.4f}  {bar(obs.beauty_score)}")
            field("Composition", f"{obs.composition_score:.4f}  {bar(obs.composition_score)}")
            field("Typography", f"{obs.typography_score:.4f}  {bar(obs.typography_score)}")
            field("Color", f"{obs.color_score:.4f}  {bar(obs.color_score)}")
            field("Motion", f"{obs.motion_score:.4f}  {bar(obs.motion_score)}")
            field("Depth", f"{obs.depth_score:.4f}  {bar(obs.depth_score)}")
            field("Rhythm", f"{obs.rhythm_score:.4f}  {bar(obs.rhythm_score)}")
            field("Originality", f"{obs.originality_score:.4f}  {bar(obs.originality_score)}")
            field("Performance", f"{obs.performance_score:.4f}  {bar(obs.performance_score)}")
            field("DOM elements", obs.dom_element_count)
            field("FCP (ms)", obs.fcp_ms)
            field("LCP (ms)", obs.lcp_ms)
            field("CLS", obs.cls)
            print(f"\n        What makes it beautiful:")
            field("Composition", obs.composition_pattern, indent=12)
            for td in obs.typography_decisions[:2]:
                field("Typography", td, indent=12)
            field("Color", obs.color_relationship, indent=12)
            field("Motion", obs.motion_character, indent=12)
            field("Depth", obs.depth_treatment, indent=12)
            for ud in obs.unusual_decisions[:2]:
                field("Unusual", ud, indent=12)

            video_path = observer.renderer._last_video_path
            if video_path:
                field("Video", video_path, indent=12)

        except Exception as e:
            print(f"        ⚠ Error: {e}")

    await observer.close()

    if not observations:
        print("\n  ⚠ No observations completed. Check network connectivity.")
        return

    sub("Observation summary")
    beautiful = [o for o in observations if o.is_beautiful()]
    avg_beauty = sum(o.beauty_score for o in observations) / len(observations)
    field("Sites observed", len(observations))
    field("Beautiful sites (≥0.6)", len(beautiful))
    field("Average beauty score", f"{avg_beauty:.4f}")
    field("Best beauty score", f"{max(o.beauty_score for o in observations):.4f}")
    field("Worst beauty score", f"{min(o.beauty_score for o in observations):.4f}")

    # ─────────────────────────────────────────────────────────
    # 3. REPLICATE — Try to reproduce the beauty
    # ─────────────────────────────────────────────────────────
    replications = []

    if replicate and observations:
        banner("3. REPLICATE — Generating HTML/CSS to reproduce beauty")

        replicator = ReplicationEngine(
            headless=headless, video_dir=video_dir,
            max_generations=max_replication_generations,
        )

        # Replicate the most beautiful sites
        to_replicate = sorted(observations, key=lambda o: -o.beauty_score)[:3]

        for i, obs in enumerate(to_replicate):
            print(f"\n  [{i+1}/{len(to_replicate)}] Replicating {obs.url}")
            field("Target beauty score", f"{obs.beauty_score:.4f}")

            try:
                result = await replicator.replicate(obs)
                replications.append(result)
                kb.add_replication(result)

                sub(f"Replication result — {obs.url}")
                field("Original beauty", f"{result.original_beauty_score:.4f}")
                field("Replicated quality", f"{result.replicated_quality:.4f}  {bar(result.replicated_quality)}")
                field("Improvement", f"{result.improvement_over_original:+.4f}")
                field("Generations", result.generations)
                field("Success (≥80% of original)", result.success)
                field("Source code length", len(result.source_code))
                print(f"\n        Techniques used:")
                for t in result.techniques_used[:5]:
                    print(f"          • {t}")
                print(f"\n        Mutations applied:")
                for m in result.mutations_applied[:5]:
                    print(f"          • {m}")
                if result.failure_reasons:
                    print(f"\n        Failures:")
                    for f in result.failure_reasons[:3]:
                        print(f"          ⚠ {f}")

                # Save the replicated source code
                rep_path = os.path.join(base_dir, "replications", f"rep_{i+1}.html")
                os.makedirs(os.path.dirname(rep_path), exist_ok=True)
                with open(rep_path, "w") as f:
                    f.write(result.source_code)
                field("Saved to", rep_path)

            except Exception as e:
                print(f"        ⚠ Replication error: {e}")
                import traceback
                traceback.print_exc()

        await replicator.close()

        if replications:
            sub("Replication summary")
            successful = [r for r in replications if r.success]
            avg_repl = sum(r.replicated_quality for r in replications) / len(replications)
            field("Replications attempted", len(replications))
            field("Successful (≥80%)", len(successful))
            field("Average replication quality", f"{avg_repl:.4f}")
            field("Best replication quality", f"{max(r.replicated_quality for r in replications):.4f}")

    # ─────────────────────────────────────────────────────────
    # 4. COMPILE — Build the skill document
    # ─────────────────────────────────────────────────────────
    banner("4. COMPILE — Building transferable skill document")

    compiler = SkillCompiler()

    # Add all observations from this run
    for obs in observations:
        compiler.add_observation(obs)

    # Add all replications from this run
    for rep in replications:
        compiler.add_replication(rep)

    # Also load historical data from knowledge base
    kb_obs = kb.get_observations()
    kb_reps = kb.get_replications()
    field("Total observations in knowledge base", len(kb_obs))
    field("Total replications in knowledge base", len(kb_reps))

    # Compile the skill
    skill = compiler.compile()

    # Save the skill document
    with open(skill_path, "w") as f:
        f.write(skill.markdown)

    sub("Skill compiled")
    field("Skill ID", skill.skill_id)
    field("Version", skill.version)
    field("Title", skill.title)
    field("Observations included", skill.observations_count)
    field("Replications included", skill.replications_count)
    field("Average beauty observed", f"{skill.avg_beauty_score:.4f}")
    field("Average replication quality", f"{skill.avg_replication_quality:.4f}")
    field("Techniques extracted", len(skill.techniques))
    field("Anti-patterns identified", len(skill.anti_patterns))
    field("Document length", f"{len(skill.markdown)} chars")
    field("Saved to", skill_path)

    # ─────────────────────────────────────────────────────────
    # 5. KNOWLEDGE BASE SUMMARY
    # ─────────────────────────────────────────────────────────
    banner("5. KNOWLEDGE BASE — Accumulated knowledge across runs")

    summary = kb.summary()
    sub("Persistent knowledge state")
    field("Total runs", summary["total_runs"])
    field("Total observations (all runs)", summary["total_observations"])
    field("Total replications (all runs)", summary["total_replications"])
    field("Total skills compiled (all runs)", summary["total_skills"])
    field("Average beauty score (all runs)", f"{summary['avg_beauty_score']:.4f}")
    field("Average replication quality (all runs)", f"{summary['avg_replication_quality']:.4f}")
    field("Knowledge base file", db_path)

    # ─────────────────────────────────────────────────────────
    # DONE
    # ─────────────────────────────────────────────────────────
    banner("PIPELINE COMPLETE")
    print(f"  Discovered {len(sources)} websites from design directories")
    print(f"  Observed {len(observations)} sites in real browser")
    print(f"  Replicated {len(replications)} designs with mutation/evolution")
    print(f"  Compiled skill: {skill_path}")
    print(f"  Knowledge base: {db_path}")
    print(f"  Videos: {video_dir}/")
    print(f"")
    print(f"  Give the skill document to any LLM to improve its UI design.")
    print(f"  Re-run this pipeline to accumulate more knowledge.")


# ─────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Beauty Discovery Pipeline")
    parser.add_argument("--sites", type=int, default=5,
                        help="Number of sites to observe (default: 5)")
    parser.add_argument("--headless", action="store_true",
                        help="Run browser in headless mode")
    parser.add_argument("--no-replicate", action="store_true",
                        help="Skip replication, just observe")
    parser.add_argument("--generations", type=int, default=3,
                        help="Max replication generations (default: 3)")
    args = parser.parse_args()

    asyncio.run(run_pipeline(
        max_sites=args.sites,
        headless=args.headless,
        replicate=not args.no_replicate,
        max_replication_generations=args.generations,
    ))


if __name__ == "__main__":
    main()
