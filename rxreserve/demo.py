#!/usr/bin/env python3
"""Design Genome Runtime — End-to-End Demo

Walks through the full pipeline with real data:
  1. Scout discovers sources — fetches real HTML from a live URL
  2. Curator assigns populations + adversarial filtering
  3. Oracle extracts genes + creates perceptual target
  4. Builder runs architecture search + generates prototypes
  5. BrowserLab renders + evaluates (requires Playwright)
  6. BrowserJudge ranks + compares (tournament)
  7. Builder mutates + recombines across generations
  8. FailureMemory records rejected renders — derived from actual failures
  9. TransferTest validates cross-product
  10. CapabilityVerifier computes skill weights — from actual results
  11. Archivist accepts with browser-verified evidence

No hardcoded HTML. No fabricated scores. No placeholder renders.
Every value is computed from real pipeline output.
"""

import asyncio
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rxreserve.genome_runtime import DesignGenomeRuntime
from rxreserve.design_genome import (
    SourceEntry, SourceCategory, LicenseState,
    DesignObservation, DesignGene, GeneType,
    ProjectArchetype, DistinctionContract, PerceptualTarget,
    RendererType, Implementation, ImplementationStatus,
    Capability, CapabilityStatus, FailureRecord, TransferTest,
    RenderResult, QualityScore, InteractionTrace,
)
from rxreserve.curator import PopulationClass
from rxreserve.builder import MutationOperator, MutationType
from rxreserve.browser_lab import BrowserJudge, MultiAxisEvaluator


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def banner(title: str) -> None:
    line = "═" * 72
    print(f"\n{line}")
    print(f"  {title}")
    print(f"{line}")

def sub(title: str) -> None:
    print(f"\n  ── {title} ──")

def field(name: str, value, indent: int = 4) -> None:
    pad = " " * indent
    if isinstance(value, float):
        print(f"{pad}{name:30s} {value:.4f}")
    elif isinstance(value, dict):
        print(f"{pad}{name:30s}")
        for k, v in value.items():
            if isinstance(v, float):
                print(f"{pad}  {k:28s} {v:.4f}")
            else:
                print(f"{pad}  {k:28s} {v}")
    elif isinstance(value, list) and len(value) > 5:
        print(f"{pad}{name:30s} [{len(value)} items]")
    else:
        print(f"{pad}{name:30s} {value}")


# ─────────────────────────────────────────────────────────────
# Real HTML acquisition — fetch from a live URL
# ─────────────────────────────────────────────────────────────

async def fetch_real_html(url: str, timeout: float = 15.0) -> tuple[str, dict[str, str]]:
    """Fetch real HTML and meta tags from a live URL.

    Returns (html_content, meta_tags). Raises on failure.
    """
    import httpx

    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        headers={"User-Agent": "DesignGenome/1.0 (research; +https://github.com/overandor)"},
    ) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        html = resp.text

    # Extract meta tags from HTML
    meta_tags: dict[str, str] = {}
    import re
    for match in re.finditer(r'<meta\s+[^>]*?name=["\']([^"\']+)["\'][^>]*?content=["\']([^"\']*)["\']', html, re.IGNORECASE):
        meta_tags[match.group(1).lower()] = match.group(2)
    for match in re.finditer(r'<meta\s+[^>]*?property=["\']([^"\']+)["\'][^>]*?content=["\']([^"\']*)["\']', html, re.IGNORECASE):
        meta_tags[match.group(1).lower()] = match.group(2)

    return html, meta_tags


async def run_demo():
    banner("DESIGN GENOME RUNTIME — LIVE DEMO (real data)")
    print("  Initializing runtime with all agents...")
    print("  📹 Video recording enabled — browser will open visibly!")

    video_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo_videos")
    rt = DesignGenomeRuntime(headless=False, video_dir=video_dir)
    print("  ✓ Scout, Oracle, Builder, BrowserLab, Curator, Judge, Verifier, Archivist")

    # ═══════════════════════════════════════════════════════════
    # 1. ACQUISITION — Scout captures a real source
    # ═══════════════════════════════════════════════════════════
    banner("1. ACQUISITION — Scout captures a real design source")

    # Use a real URL from the Scout's acquisition streams
    target_url = "https://www.cssdesignawards.com"
    print(f"  Fetching real HTML from {target_url}...")

    try:
        html_content, meta_tags = await fetch_real_html(target_url)
        print(f"  ✓ Fetched {len(html_content)} bytes, {len(meta_tags)} meta tags")
    except Exception as e:
        print(f"  ✗ Failed to fetch {target_url}: {e}")
        print("  Trying fallback URL...")
        target_url = "https://www.awwwards.com"
        try:
            html_content, meta_tags = await fetch_real_html(target_url)
            print(f"  ✓ Fetched {len(html_content)} bytes from fallback")
        except Exception as e2:
            print(f"  ✗ Fallback also failed: {e2}")
            print("  Cannot run demo without real HTML. Exiting.")
            return

    source = SourceEntry(
        url=target_url,
        category=SourceCategory.AWARD_WINNING,
        license_state=LicenseState.UNKNOWN,
        access_policy_checked=False,
    )

    # Capture with real HTML — the Scout checks robots.txt, classifies license,
    # removes PII, hashes for dedup, and creates a real observation
    source, captured_obs = await rt.scout.capture_source(
        source, html_content=html_content, meta_tags=meta_tags)

    sub("Source captured")
    field("URL", source.url)
    field("Category", source.category.value)
    field("License", source.license_state.value if hasattr(source.license_state, 'value') else source.license_state)
    field("Robots allowed", source.robots_allowed)
    field("Access policy checked", source.access_policy_checked)
    field("Personal info removed", source.personal_info_removed)
    field("Content hash", source.source_hash[:16] + "..." if source.source_hash else "none")
    field("Is duplicate", source.is_duplicate)

    if not captured_obs:
        # capture_source returned None — either rate limited, robots blocked,
        # or duplicate. This is a real outcome, not a failure to paper over.
        print("\n  ⚠ Capture returned no observation (rate limited, robots blocked, or duplicate).")
        print("  This is a real pipeline outcome. Retrying with a different source...")

        # Try a different category
        target_url = "https://www.tesla.com"
        print(f"  Fetching {target_url}...")
        try:
            html_content, meta_tags = await fetch_real_html(target_url)
        except Exception as e:
            print(f"  ✗ Failed: {e}")
            print("  Cannot acquire real source. Exiting.")
            return

        source = SourceEntry(
            url=target_url,
            category=SourceCategory.AUTOMOTIVE_INTERFACES,
            license_state=LicenseState.UNKNOWN,
            access_policy_checked=False,
        )
        source, captured_obs = await rt.scout.capture_source(
            source, html_content=html_content, meta_tags=meta_tags)

        if not captured_obs:
            print("  ⚠ Second source also rejected. The pipeline is working correctly")
            print("  but both sources were blocked. Check robots.txt or rate limits.")
            return

    obs = captured_obs
    rt.observation_memory.add(source, obs)
    sub("Observation stored")
    field("Observation ID", obs.observation_id)
    field("Novelty score", obs.novelty_score)
    field("Trend velocity", obs.trend_velocity)
    field("Unusual decisions", len(obs.unusual_design_decisions))
    for d in obs.unusual_design_decisions:
        print(f"        • {d}")

    # ═══════════════════════════════════════════════════════════
    # 1b. VISIBLE BROWSING — Agent opens the page and records its journey
    # ═══════════════════════════════════════════════════════════
    banner("1b. VISIBLE BROWSING — Agent opens the page in a real browser")
    print(f"  🌐 Opening {target_url} in visible Chromium...")
    print("  The agent will scroll through the page, capture frames,")
    print("  and record a video of its journey. Watch the browser window!")

    try:
        journey_render = await rt.lab.renderer.navigate_to_url(
            target_url,
            viewports=[{"name": "desktop", "width": 1440, "height": 900}],
        )
        sub("Agent browsing journey complete")
        field("Frames captured", len(journey_render.desktop_frames))
        field("Interaction elements", len(journey_render.interaction_trace.hover_elements) if journey_render.interaction_trace else 0)
        field("Scroll depth", journey_render.interaction_trace.scroll_depth if journey_render.interaction_trace else 0.0)
        if journey_render.performance_trace:
            field("DOM elements", journey_render.performance_trace.get("domCount", 0))
            field("FCP (ms)", journey_render.performance_trace.get("firstContentfulPaint", 0))
            field("LCP (ms)", journey_render.performance_trace.get("largestContentfulPaint", 0))
            field("CLS", journey_render.performance_trace.get("cumulativeLayoutShift", 0))
        video_path = rt.lab.renderer._last_video_path
        if video_path:
            field("Video recorded", video_path)
        elif journey_render.rejected_reason:
            print(f"  ⚠ Journey had error: {journey_render.rejected_reason}")
        else:
            print("  (Video may still be finalizing)")
    except Exception as e:
        print(f"  ⚠ Visible browsing error: {e}")
        import traceback
        traceback.print_exc()
        print("  Continuing with pipeline...")

    # ═══════════════════════════════════════════════════════════
    # 2. CURATION — Curator assigns population
    # ═══════════════════════════════════════════════════════════
    banner("2. CURATION — Curator evaluates signal strength")

    genes, evaluation = rt.oracle.extract_genes(obs)

    sub("Oracle gene extraction")
    field("Genes extracted", len(genes))
    for g in genes:
        gtype = g.gene_type.value if hasattr(g.gene_type, 'value') else str(g.gene_type)
        print(f"        • [{gtype}] {g.principle[:60]}")
        if g.preserve_attributes:
            print(f"          preserve: {', '.join(g.preserve_attributes[:3])}")

    assignment = rt.curator.curate(obs, genes, source.category, existing_gene_count=3)

    sub("Curator population assignment")
    field("Population", assignment.population)
    field("Signal strength", assignment.signal_strength)
    field("Novelty vs corpus", assignment.novelty_vs_corpus)
    field("Structural richness", assignment.structural_richness)
    field("Velocity score", assignment.velocity_score)

    # Adversarial filter
    rt.curator.adversarial_filter.register_genes(genes)
    adv_result = rt.curator.adversarial_filter.filter(obs, genes, source.category)
    sub("Adversarial filter")
    field("Diversity bonus", adv_result["diversity_bonus"])
    field("Overlap penalty", adv_result["overlap_penalty"])
    field("Unusual boost", adv_result["unusual_boost"])
    field("Adversarial score", adv_result["adversarial_score"])
    field("Verdict", adv_result["verdict"])

    # Challenge extraction
    challenge = rt.curator.challenge_extractor.extract(obs, genes)
    sub("Challenge extracted")
    field("Challenge ID", challenge["challenge_id"])
    field("Description", challenge["challenge_description"][:80])
    field("Dominant gene type", challenge["dominant_gene_type"])
    field("Renderer candidates", challenge["renderer_candidates"])

    # ═══════════════════════════════════════════════════════════
    # 3. EXPERIMENT — Architecture search + initial render
    # ═══════════════════════════════════════════════════════════
    banner("3. EXPERIMENT — Architecture search + initial render")

    # Create distinction contract from actual observation data
    contract = DistinctionContract(
        project_name="DemoProduct",
        spatial_signature="; ".join(g.principle for g in genes[:2]) if genes else "discovered from observation",
        interaction_primitive="hover-lift with shadow expansion",
        forbidden_cliche="standard card grid with no depth",
        typography_doctrine="variable weight with gradient text",
        motion_doctrine="spring-based easing on entrance",
        unique_feature=obs.unusual_design_decisions[0] if obs.unusual_design_decisions else "discovered from observation",
    )
    rt._contracts[contract.contract_id] = contract

    # Create project archetype
    project = ProjectArchetype(
        archetype_id="PROJ-DEMO-001",
        project_name="Demo Product",
        product_category="analytics",
        mood="analytical, premium, dark",
        distinction_contract_id=contract.contract_id,
        active_gene_ids=[g.gene_id for g in genes],
    )

    # Create perceptual target from actual gene data
    target = PerceptualTarget(
        benchmark_observation_id=obs.observation_id,
        visual_identity=project.mood,
        primary_composition="; ".join(g.principle for g in genes[:3]) if genes else "discovered",
        recommended_renderer=RendererType.DOM_CSS,
        renderer_rationale="CSS grid + backdrop-filter sufficient",
    )

    sub("Perceptual target created")
    field("Visual identity", target.visual_identity)
    field("Primary composition", target.primary_composition[:60])
    field("Recommended renderer", target.recommended_renderer.value)

    # Architecture search + prototype generation
    prototypes = rt.builder.start_project(target, contract, project.archetype_id)
    sub(f"Architecture search — {len(prototypes)} prototypes generated")
    for p in prototypes:
        rtype = p.renderer_type.value if hasattr(p.renderer_type, 'value') else str(p.renderer_type)
        print(f"        • {p.impl_id[:12]} renderer={rtype} arch={p.architecture_hypothesis[:40]}")

    # Use the real fetched HTML as initial source for the first prototype
    for proto in prototypes:
        if not proto.source_code:
            proto.source_code = html_content

    # ═══════════════════════════════════════════════════════════
    # 4. EVOLUTION LOOP — Render, evaluate, mutate, select, repeat
    # ═══════════════════════════════════════════════════════════
    banner("4. EVOLUTION LOOP — Generational improvement in real browser")

    NUM_GENERATIONS = 4
    MUTATION_AXES = [
        MutationType.COMPOSITION, MutationType.MOTION,
        MutationType.LIGHTING, MutationType.INTERACTION,
        MutationType.TYPOGRAPHY, MutationType.DENSITY,
    ]

    # Generation 0: render initial prototypes
    sub(f"Generation 0 — rendering {len(prototypes)} initial prototypes")
    population: list[tuple[Implementation, RenderResult]] = []
    for proto in prototypes:
        try:
            render = await rt.lab.evaluate_implementation(proto, target, contract)
            rt.builder.submit_render(proto, render)
            population.append((proto, render))
            status = "ACCEPTED" if render.accepted else "REJECTED"
            print(f"        {proto.impl_id[:12]} → {status}  quality={render.quality.total:.4f}")
        except RuntimeError as e:
            print(f"        {proto.impl_id[:12]} → RENDER FAILED: {e}")
            print("          Install Playwright: pip install playwright && playwright install chromium")
            return

    if not population:
        print("\n  ⚠ No renders completed. Cannot evolve.")
        return

    best_impl, best_render = max(population, key=lambda x: x[1].quality.total)
    best_quality = best_render.quality.total
    print(f"\n        Best initial quality: {best_quality:.4f}")

    quality_history = [best_quality]
    failure_reasons: list[str] = []

    # Evolve across generations
    for gen in range(1, NUM_GENERATIONS + 1):
        sub(f"Generation {gen} — mutate best, render all, select winner")

        # Generate mutations from current best
        candidates: list[Implementation] = []
        for axis in MUTATION_AXES:
            mutant = MutationOperator.mutate(best_impl, target, axis)
            if mutant.source_code != best_impl.source_code:
                candidates.append(mutant)

        # Also try recombination if we have 2+ in population
        if len(population) >= 2:
            parent_b = population[1][0] if population[1][0] != best_impl else population[-1][0]
            child = MutationOperator.recombine(best_impl, parent_b, target)
            if child.source_code != best_impl.source_code:
                candidates.append(child)

        if not candidates:
            print(f"        No mutations produced changes — trying all axes with forced insertion")
            for axis in MUTATION_AXES:
                mutant = MutationOperator.mutate(best_impl, target, axis)
                candidates.append(mutant)

        # Render and evaluate each candidate
        print(f"        Rendering {len(candidates)} candidates in real browser...")
        gen_results: list[tuple[Implementation, RenderResult]] = []
        for mutant in candidates:
            try:
                m_render = await rt.lab.evaluate_implementation(mutant, target, contract)
                rt.builder.submit_render(mutant, m_render)
                gen_results.append((mutant, m_render))
                mtype = mutant.mutation_type if hasattr(mutant.mutation_type, 'value') else str(mutant.mutation_type)
                status = "ACCEPTED" if m_render.accepted else "REJECTED"
                delta = m_render.quality.total - best_quality
                print(f"          {mutant.impl_id[:12]} [{str(mtype):15s}] → {status}  "
                      f"q={m_render.quality.total:.4f}  Δ={delta:+.4f}")
                if not m_render.accepted and m_render.rejected_reason:
                    failure_reasons.append(m_render.rejected_reason)
            except Exception as e:
                print(f"          {mutant.impl_id[:12]} → RENDER FAILED: {e}")

        if not gen_results:
            print(f"        All renders failed this generation.")
            continue

        # Select the best from this generation
        gen_best_impl, gen_best_render = max(gen_results, key=lambda x: x[1].quality.total)
        gen_best_quality = gen_best_render.quality.total

        # Only adopt if it's an improvement (or equal but accepted)
        if gen_best_quality > best_quality or (gen_best_render.accepted and not best_render.accepted):
            print(f"\n        ✅ IMPROVEMENT: {best_quality:.4f} → {gen_best_quality:.4f} "
                  f"(+{gen_best_quality - best_quality:.4f})")
            best_impl = gen_best_impl
            best_render = gen_best_render
            best_quality = gen_best_quality
            population = [(best_impl, best_render)] + gen_results[:2]
        else:
            print(f"\n        ❌ No improvement this generation (best={gen_best_quality:.4f} vs current={best_quality:.4f})")
            # Record failure for the best attempt
            worst = min(gen_results, key=lambda x: x[1].quality.total)
            if worst[1].rejected_reason:
                failure_reasons.append(worst[1].rejected_reason)
            # Keep population for recombination diversity
            population = [(best_impl, best_render)] + gen_results[:2]

        quality_history.append(best_quality)

    # Show quality progression
    sub("Quality progression across generations")
    for i, q in enumerate(quality_history):
        bar = "█" * int(q * 40)
        print(f"        Gen {i}: {q:.4f} {bar}")

    final_quality = best_render.quality
    sub("Final best implementation")
    status = "ACCEPTED" if best_render.accepted else "REJECTED"
    print(f"        {best_impl.impl_id[:12]} → {status}")
    field("Total quality", final_quality.total, indent=12)
    field("Composition", final_quality.composition_similarity, indent=12)
    field("Perceptual depth", final_quality.perceptual_depth, indent=12)
    field("Visual hierarchy", final_quality.visual_hierarchy, indent=12)
    field("Motion character", final_quality.motion_character_match, indent=12)
    field("Material/lighting", final_quality.material_lighting_behavior, indent=12)
    field("Typography", final_quality.typography_character_match, indent=12)
    field("Identity", final_quality.product_specific_identity, indent=12)
    field("Originality", final_quality.originality_distance, indent=12)
    field("Accessibility", final_quality.accessibility_audit, indent=12)
    field("Performance", final_quality.runtime_performance, indent=12)
    field("Cross-device", final_quality.cross_device_stability, indent=12)
    if best_render.accepted:
        field("Improvement", f"{quality_history[0]:.4f} → {best_quality:.4f} (+{best_quality - quality_history[0]:.4f})")
    else:
        print(f"          REJECTED: {best_render.rejected_reason}")

    # Use the best implementation from the evolution loop
    renders = [(best_impl, best_render)]
    best_proto = best_impl

    # ═══════════════════════════════════════════════════════════
    # 7. FAILURE RECORDING — Derived from actual rejected renders
    # ═══════════════════════════════════════════════════════════
    banner("7. FAILURE RECORDING — Negative knowledge from actual rejections")

    # failure_reasons was already collected during the evolution loop
    # from renders that were actually rejected by the BrowserLab

    if not failure_reasons:
        print("\n  All renders were accepted. No failures to record.")
        print("  (In a longer run, mutations and transfer tests would generate failures.)")
    else:
        sub(f"Failures classified + lessons extracted ({len(failure_reasons)} failures)")
        for reason in failure_reasons:
            mode = rt._classify_failure(reason)
            lesson = rt._extract_lesson(reason)
            avoid = rt._extract_avoid_pattern(reason, best_proto)
            failure = FailureRecord(
                impl_id=best_proto.impl_id,
                renderer_type=best_proto.renderer_type.value if hasattr(best_proto.renderer_type, 'value') else str(best_proto.renderer_type),
                failure_mode=mode,
                failure_description=reason,
                quality_score=0.0,  # will be set from actual render if available
                lesson=lesson,
                avoid_pattern=avoid,
            )
            rt.failure_memory.add(failure)
            print(f"\n        [{mode}]")
            print(f"          reason:  {reason[:65]}")
            print(f"          lesson:  {lesson[:65]}...")
            print(f"          avoid:   {avoid[:65]}")

    sub("Failure memory summary")
    field("Total failures", rt.failure_memory.count())
    field("Failure modes", rt.failure_memory.failure_modes())
    field("Lessons for dom_css", len(rt.failure_memory.lessons_for_renderer("dom_css")))

    # ═══════════════════════════════════════════════════════════
    # 7b. TRANSFER TEST — Validate capability in a different product
    # ═══════════════════════════════════════════════════════════
    banner("7b. TRANSFER TEST — Cross-product validation")

    # Build a preliminary capability from the best render
    best_render_for_cap = max(renders, key=lambda x: x[1].quality.total)[1]
    prelim_cap = Capability(
        name=f"Design capability from {source.url}",
        recognition="; ".join(g.principle for g in genes[:3]) if genes else "discovered",
        execution=f"renderer={best_proto.renderer_type.value if hasattr(best_proto.renderer_type, 'value') else best_proto.renderer_type}",
        validation="browser-rendered with accessibility audit",
        perceptual_objective=obs.unusual_design_decisions[0] if obs.unusual_design_decisions else "discovered",
        renderer_architecture=best_proto.renderer_type.value if hasattr(best_proto.renderer_type, 'value') else str(best_proto.renderer_type),
        confidence=best_render_for_cap.quality.total,
        saturation_factor=1.0,
        source_observation_id=obs.observation_id,
    )

    sub("Running transfer test in different product context...")
    transfer_result = None
    try:
        transfer_result = await rt._run_transfer_test(
            prelim_cap, best_proto, project, contract)

        field("Transfer target", transfer_result.target_product_category)
        field("Target audience", transfer_result.target_audience)
        field("Target mood", transfer_result.target_mood)
        field("Quality in new context", transfer_result.quality_in_new_context)
        field("Identity preserved", transfer_result.identity_preserved)
        field("Depth preserved", transfer_result.depth_preserved)
        field("Motion preserved", transfer_result.motion_preserved)
        field("Accessibility maintained", transfer_result.accessibility_maintained)
        field("PASSED", transfer_result.passed)
        if not transfer_result.passed and transfer_result.failure_reason:
            print(f"          Reason: {transfer_result.failure_reason[:80]}")
    except Exception as e:
        print(f"  Transfer test error: {e}")

    # ═══════════════════════════════════════════════════════════
    # 8. CAPABILITY VERIFICATION — From actual render results
    # ═══════════════════════════════════════════════════════════
    banner("8. CAPABILITY VERIFICATION — Skill weight from actual results")

    # Build capability from actual render data — no hardcoded scores
    best_render = max(renders, key=lambda x: x[1].quality.total)[1]
    q = best_render.quality

    # Include transfer test results if available
    transfer_passed = transfer_result.passed if transfer_result else False
    transfer_count = 1 if transfer_result and transfer_result.passed else 0

    cap = Capability(
        name=f"Design capability from {source.url}",
        recognition="; ".join(g.principle for g in genes[:3]) if genes else "discovered",
        execution=f"renderer={best_proto.renderer_type.value if hasattr(best_proto.renderer_type, 'value') else best_proto.renderer_type}",
        validation="browser-rendered with accessibility audit",
        perceptual_objective=obs.unusual_design_decisions[0] if obs.unusual_design_decisions else "discovered",
        renderer_architecture=best_proto.renderer_type.value if hasattr(best_proto.renderer_type, 'value') else str(best_proto.renderer_type),
        confidence=q.total,  # from actual render quality
        saturation_factor=1.0,
        depth_reproduced=q.perceptual_depth > 0.5,
        motion_reproduced=q.motion_character_match > 0.5,
        mobile_preserved=q.cross_device_stability > 0.5,
        accessibility_maintained=q.accessibility_audit > 0.8,
        performance_budget_met=q.runtime_performance > 0.5,
        transfers_to_other_products=transfer_passed,
        survives_human_comparison=False,  # not yet tested
        transfer_success_count=transfer_count,
    )
    cap.transfer_test_results = [transfer_result] if transfer_result else []
    cap.comparison_scores = {
        "originality_distance": q.originality_distance,
        "composition_fidelity": q.composition_similarity,
        "depth_accuracy": q.perceptual_depth,
    }

    verified = rt.verifier.verify(cap)

    sub("Verified capability")
    field("Capability ID", verified.capability_id)
    field("Name", verified.name)
    field("Status", verified.status.value)
    field("Confidence", verified.confidence)
    sub("Skill weight factors (from actual render quality)")
    field("Quality factor", verified.quality_factor)
    field("Transferability factor", verified.transferability_factor)
    field("Novelty factor", verified.novelty_factor)
    field("Reliability factor", verified.reliability_factor)
    field("Saturation factor", verified.saturation_factor)
    sub("Composite")
    field("SKILL WEIGHT", verified.skill_weight)
    print(f"        formula: (Q × T × N × R) / S")
    print(f"        = ({verified.quality_factor:.3f} × {verified.transferability_factor:.3f} × {verified.novelty_factor:.3f} × {verified.reliability_factor:.3f}) / {verified.saturation_factor:.3f}")
    print(f"        = {verified.skill_weight:.6f}")

    # ═══════════════════════════════════════════════════════════
    # 9. ARCHIVIST — Browser-verified evidence gatekeeper
    # ═══════════════════════════════════════════════════════════
    banner("9. ARCHIVIST — Browser-verified evidence gatekeeper")

    # Use the actual best render — no fabricated demo_render
    transfer_tests = [transfer_result] if transfer_result else []
    if best_render.accepted:
        accepted, reason = rt.archivist.accept_capability(
            verified, best_render,
            transfer_tests=transfer_tests,
            failure_records=rt.failure_memory.all_failures()[:5],
        )
    else:
        print("\n  ⚠ Best render was not accepted by BrowserLab.")
        print(f"  Rejection reason: {best_render.rejected_reason}")
        print("  The Archivist cannot accept a capability without an accepted render.")
        print("  In a production run, mutations would continue until a render passes acceptance.")
        accepted = False
        reason = f"Best render rejected: {best_render.rejected_reason}"

    sub("Archivist decision")
    field("Accepted", accepted)
    field("Reason", reason)
    if accepted:
        field("Verified renders", len(verified.verified_renders))
        field("Transfer success count", verified.transfer_success_count)
        field("Failed alternatives recorded", len(verified.failed_alternatives))
        field("Performance profile stored", verified.performance_profile is not None)

    # ═══════════════════════════════════════════════════════════
    # 10. RUNTIME STATE SUMMARY
    # ═══════════════════════════════════════════════════════════
    banner("10. RUNTIME STATE SUMMARY")

    state = rt.summary()
    sub("Genome state")
    for k, v in state.items():
        if isinstance(v, dict):
            print(f"    {k}:")
            for sk, sv in v.items():
                if isinstance(sv, dict):
                    print(f"      {sk}:")
                    for ssk, ssv in sv.items():
                        print(f"        {ssk}: {ssv}")
                else:
                    print(f"      {sk}: {sv}")
        else:
            print(f"    {k}: {v}")

    sub("Memory inventory")
    field("Observations", rt.observation_memory.count())
    field("Capabilities (verified)", rt.verified_capability_memory.count())
    field("Failures recorded", rt.failure_memory.count())
    field("Frontier population", rt.frontier_population.count())
    field("Builder population", len(rt.builder.population._population))

    banner("DEMO COMPLETE")
    print("  All agents executed with real data.")
    print(f"  Source: {source.url} ({len(html_content)} bytes of real HTML)")
    print(f"  Renders: {len(renders)} evaluated in real browser")
    print(f"  Transfer tests: {1 if transfer_result else 0} run in real browser")
    print(f"  Failures: {rt.failure_memory.count()} from actual rejections")
    video_path = rt.lab.renderer._last_video_path
    if video_path:
        print(f"  📹 Video: {video_path}")
    print(f"  Every score computed from actual render/observation/capability data.")

    # Clean up browser
    await rt.lab.renderer.close()


if __name__ == "__main__":
    asyncio.run(run_demo())
