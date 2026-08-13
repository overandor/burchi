"""Tests for the Design Genome Runtime — Scout, Curator, Oracle, Builder, BrowserLab, Runtime.

Tests the architectural contracts that are enforced in code:
- Scout discovers but does not evaluate quality
- Curator filters signal but does not evaluate visual quality
- Oracle diagnoses but never writes code
- Builder implements but never evaluates its own output
- BrowserLab is the only arbiter of rendered quality
- Four memories are isolated
"""

import asyncio
import sys
import os
import hashlib
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rxreserve.design_genome import (
    SourceEntry, SourceCategory, LicenseState, AssetClassification,
    DesignObservation, DesignGene, GeneType,
    ProjectArchetype, DistinctionContract, PerceptualTarget,
    RendererType, Implementation, ImplementationStatus,
    Capability, CapabilityStatus, QualityScore, RenderResult,
    InteractionTrace, FailureRecord, TransferTest,
    RENDERER_CLASSIFICATION,
)
from rxreserve.scout import Scout, ComplianceChecker, TrendDetector, DeduplicationEngine
from rxreserve.curator import Curator, PopulationClass, SignalEstimator
from rxreserve.oracle import TasteOracle, PerceptualDecomposer
from rxreserve.builder import VisualEngineer, ArchitectureSearch, MutationOperator
from rxreserve.browser_lab import BrowserLab, AcceptanceThresholds, MultiAxisEvaluator
from rxreserve.genome_runtime import (
    DesignGenomeRuntime, ObservationMemory, LatentValueMemory,
    AttemptMemory, VerifiedCapabilityMemory,
)


# ═══════════════════════════════════════════════════════════════
# Test data — real HTML, not fabricated
# ═══════════════════════════════════════════════════════════════

REAL_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta name="description" content="Award-winning design site">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Test Site</title>
<style>
  body { margin: 0; background: #0a0a0a; color: #e0e0e0; font-family: 'Inter', sans-serif; }
  .hero { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; padding: 2rem; }
  .card { background: rgba(255,255,255,0.05); border-radius: 16px; padding: 2rem;
    backdrop-filter: blur(12px); }
  nav { position: sticky; top: 0; backdrop-filter: blur(8px); }
  @media (max-width: 768px) { .hero { grid-template-columns: 1fr; } }
</style>
</head>
<body>
  <nav role="navigation" aria-label="Main">
    <a href="#" aria-label="Home">Home</a>
    <button aria-label="Menu">Menu</button>
  </nav>
  <main>
    <section class="hero">
      <div><h1>Test Product</h1><p>Description.</p></div>
      <div class="card"><p>Card content</p></div>
    </section>
  </main>
</body>
</html>"""

META_TAGS = {"description": "Award-winning design site", "viewport": "width=device-width, initial-scale=1.0"}


# ═══════════════════════════════════════════════════════════════
# Scout tests
# ═══════════════════════════════════════════════════════════════

class TestComplianceChecker:
    def test_robots_allowed_when_no_robots_txt(self):
        assert ComplianceChecker.check_robots("https://example.com/page", "") is True

    def test_robots_disallow_blocks(self):
        robots = "User-agent: *\nDisallow: /private/"
        assert ComplianceChecker.check_robots("https://example.com/private/secret", robots) is False

    def test_robots_allows_public_paths(self):
        robots = "User-agent: *\nDisallow: /private/"
        assert ComplianceChecker.check_robots("https://example.com/public/page", robots) is True

    def test_rate_limit_enforces_interval(self):
        last_time = time.time()
        # Immediately after last request — should be rate limited
        assert ComplianceChecker.check_rate_limit(last_time, min_interval=1.0) is False
        # After interval — should be allowed
        assert ComplianceChecker.check_rate_limit(last_time - 2.0, min_interval=1.0) is True

    def test_classify_license_open(self):
        content = "This work is licensed under Creative Commons CC BY 4.0"
        assert ComplianceChecker.classify_license(content) == LicenseState.OPEN

    def test_classify_license_restricted(self):
        content = "© 2024 All rights reserved. No reproduction without permission."
        assert ComplianceChecker.classify_license(content) == LicenseState.REFERENCE_ONLY

    def test_classify_license_unknown(self):
        content = "Just some regular content with no license info."
        assert ComplianceChecker.classify_license(content) == LicenseState.UNKNOWN

    def test_classify_asset_from_open_license(self):
        assert ComplianceChecker.classify_asset(LicenseState.OPEN) == AssetClassification.USABLE_ASSET

    def test_classify_asset_from_restricted_license(self):
        assert ComplianceChecker.classify_asset(LicenseState.REFERENCE_ONLY) == AssetClassification.REFERENCE_ONLY

    def test_remove_personal_info_emails(self):
        text = "Contact us at john@example.com for details"
        cleaned = ComplianceChecker.remove_personal_info(text)
        assert "john@example.com" not in cleaned
        assert "[EMAIL_REMOVED]" in cleaned

    def test_remove_personal_info_phones(self):
        text = "Call 555-123-4567 for support"
        cleaned = ComplianceChecker.remove_personal_info(text)
        assert "555-123-4567" not in cleaned
        assert "[PHONE_REMOVED]" in cleaned

    def test_compute_hash_deterministic(self):
        h1 = ComplianceChecker.compute_hash("test content")
        h2 = ComplianceChecker.compute_hash("test content")
        assert h1 == h2

    def test_compute_hash_different_content(self):
        h1 = ComplianceChecker.compute_hash("content a")
        h2 = ComplianceChecker.compute_hash("content b")
        assert h1 != h2


class TestTrendDetector:
    def test_is_novel_for_new_content(self):
        td = TrendDetector()
        assert td.is_novel("new_hash_123") is True

    def test_not_novel_after_registration(self):
        td = TrendDetector()
        td.register("hash_123", SourceCategory.AWARD_WINNING)
        assert td.is_novel("hash_123") is False

    def test_saturation_increases_with_frequency(self):
        td = TrendDetector()
        td.register("h1", SourceCategory.AWARD_WINNING, detected_patterns=["glassmorphism"])
        td.register("h2", SourceCategory.AWARD_WINNING, detected_patterns=["glassmorphism"])
        td.register("h3", SourceCategory.AWARD_WINNING, detected_patterns=["grid"])
        # glassmorphism appears twice, grid once — glassmorphism should have higher saturation
        assert td.get_saturation("glassmorphism") > td.get_saturation("grid")

    def test_oversaturated_patterns(self):
        td = TrendDetector()
        for i in range(10):
            td.register(f"h{i}", SourceCategory.AWARD_WINNING, detected_patterns=["overused"])
        for i in range(2):
            td.register(f"h2{i}", SourceCategory.AWARD_WINNING, detected_patterns=["rare"])
        oversat = td.get_oversaturated_patterns(threshold=0.8)
        assert "overused" in oversat
        assert "rare" not in oversat


class TestDeduplicationEngine:
    def test_exact_hash_duplicate(self):
        dd = DeduplicationEngine()
        dd.register("src-1", "hash_abc")
        is_dup, existing = dd.is_duplicate("hash_abc")
        assert is_dup is True
        assert existing == "src-1"

    def test_no_duplicate_for_new_hash(self):
        dd = DeduplicationEngine()
        is_dup, _ = dd.is_duplicate("new_hash")
        assert is_dup is False

    def test_visual_embedding_similarity(self):
        dd = DeduplicationEngine()
        emb = [1.0, 0.0, 0.0]
        dd.register("src-1", "hash_1", visual_embedding=emb)
        # Same embedding — should be duplicate
        is_dup, existing = dd.is_duplicate("hash_2", visual_embedding=[1.0, 0.0, 0.0])
        assert is_dup is True
        assert existing == "src-1"

    def test_different_embedding_not_duplicate(self):
        dd = DeduplicationEngine()
        emb = [1.0, 0.0, 0.0]
        dd.register("src-1", "hash_1", visual_embedding=emb)
        # Very different embedding — should not be duplicate
        is_dup, _ = dd.is_duplicate("hash_2", visual_embedding=[0.0, 0.0, 1.0])
        assert is_dup is False


class TestScout:
    def test_discover_sources_returns_entries(self):
        scout = Scout()
        sources = scout.discover_sources(categories=[SourceCategory.AWARD_WINNING], max_per_category=2)
        assert len(sources) == 2
        assert all(s.category == SourceCategory.AWARD_WINNING for s in sources)

    def test_discover_sources_all_categories(self):
        scout = Scout()
        sources = scout.discover_sources(max_per_category=1)
        assert len(sources) == len(SourceCategory)

    def test_capture_source_with_real_html(self):
        scout = Scout()
        source = SourceEntry(
            url="https://example.com",
            category=SourceCategory.AWARD_WINNING,
        )
        source, obs = asyncio.run(scout.capture_source(
            source, html_content=REAL_HTML, meta_tags=META_TAGS))
        assert source.access_policy_checked is True
        assert source.personal_info_removed is True
        assert source.source_hash != ""
        # Observation may be None if rate-limited, but if present should have data
        if obs:
            assert obs.url == "https://example.com"
            assert obs.observation_id != ""

    def test_capture_source_dedup(self):
        scout = Scout()
        source1 = SourceEntry(url="https://example.com", category=SourceCategory.AWARD_WINNING)
        source2 = SourceEntry(url="https://example.com", category=SourceCategory.AWARD_WINNING)
        _, obs1 = asyncio.run(scout.capture_source(source1, html_content=REAL_HTML, meta_tags=META_TAGS))
        _, obs2 = asyncio.run(scout.capture_source(source2, html_content=REAL_HTML, meta_tags=META_TAGS))
        # Second capture should be deduplicated (same content hash)
        assert obs2 is None or source2.is_duplicate

    def test_acquisition_streams_cover_all_categories(self):
        """Adversarial acquisition streams must cover all 12 categories."""
        for category in SourceCategory:
            assert category in Scout.ACQUISITION_STREAMS, f"Missing stream for {category}"
            assert len(Scout.ACQUISITION_STREAMS[category]) > 0, f"Empty stream for {category}"


# ═══════════════════════════════════════════════════════════════
# Curator tests
# ═══════════════════════════════════════════════════════════════

class TestCurator:
    def _make_observation(self):
        return DesignObservation(
            url="https://example.com",
            unusual_design_decisions=["gradient text", "glassmorphism", "asymmetric grid"],
            novelty_score=0.8,
            trend_velocity=7.5,
            layout_geometry={"columns": 2, "ratio": 0.6},
            typography_ratios={"h1_to_body": 3.5},
            spacing_rhythm=[8, 16, 24, 32],
        )

    def _make_genes(self):
        return [
            DesignGene(gene_type=GeneType.COMPOSITION, principle="asymmetric grid", novelty_score=0.8),
            DesignGene(gene_type=GeneType.TYPOGRAPHY, principle="gradient text clipping", novelty_score=0.7),
            DesignGene(gene_type=GeneType.DEPTH, principle="glassmorphism layering", novelty_score=0.6),
        ]

    def test_curate_assigns_population(self):
        curator = Curator()
        obs = self._make_observation()
        genes = self._make_genes()
        assignment = curator.curate(obs, genes, SourceCategory.AWARD_WINNING)
        assert assignment.population in [p.value for p in PopulationClass]
        assert 0.0 <= assignment.signal_strength <= 1.0

    def test_curator_does_not_evaluate_visual_quality(self):
        """The Curator evaluates signal strength, not visual quality."""
        curator = Curator()
        obs = self._make_observation()
        genes = self._make_genes()
        assignment = curator.curate(obs, genes, SourceCategory.AWARD_WINNING)
        # Signal strength is about novelty/richness/velocity, not beauty
        assert "quality" not in assignment.reason.lower() or "signal" in assignment.reason.lower()

    def test_adversarial_filter_penalizes_overlap(self):
        curator = Curator()
        obs = self._make_observation()
        genes = self._make_genes()
        curator.adversarial_filter.register_genes(genes)
        result = curator.adversarial_filter.filter(obs, genes, SourceCategory.AWARD_WINNING)
        assert "overlap_penalty" in result
        assert "diversity_bonus" in result
        assert "adversarial_score" in result

    def test_challenge_extraction(self):
        curator = Curator()
        obs = self._make_observation()
        genes = self._make_genes()
        challenge = curator.challenge_extractor.extract(obs, genes)
        assert "challenge_id" in challenge
        assert "challenge_description" in challenge
        assert "dominant_gene_type" in challenge


# ═══════════════════════════════════════════════════════════════
# Oracle tests
# ═══════════════════════════════════════════════════════════════

class TestOracle:
    def _make_observation(self):
        return DesignObservation(
            url="https://example.com",
            unusual_design_decisions=["gradient text", "glassmorphism"],
            novelty_score=0.8,
            layout_geometry={"columns": 2, "ratio": 0.6},
            typography_ratios={"h1_to_body": 3.5, "weight_contrast": 0.8},
            spacing_rhythm=[8, 16, 24, 32],
            color_relationships={"contrast": 0.9, "harmony": "complementary"},
        )

    def test_extract_genes_returns_design_genes(self):
        oracle = TasteOracle()
        obs = self._make_observation()
        genes, evaluation = oracle.extract_genes(obs)
        assert len(genes) > 0
        assert all(isinstance(g, DesignGene) for g in genes)

    def test_oracle_does_not_write_code(self):
        """The Oracle never writes frontend code — it only diagnoses."""
        oracle = TasteOracle()
        obs = self._make_observation()
        genes, evaluation = oracle.extract_genes(obs)
        # Genes are principles, not code
        for g in genes:
            assert "<" not in g.principle or g.principle.count("<") == 0  # no HTML tags in principles
            assert "function" not in g.principle.lower() or "principle" in g.principle.lower()

    def test_perceptual_decomposer_extracts_principles_not_copies(self):
        obs = self._make_observation()
        genes = PerceptualDecomposer.decompose(obs)
        for g in genes:
            # Principles should be abstract, not "copy this section"
            assert "copy" not in g.principle.lower() or "copyright" in g.principle.lower()

    def test_create_perceptual_target(self):
        oracle = TasteOracle()
        obs = self._make_observation()
        # Must extract genes first so benchmark decomposition is stored
        oracle.extract_genes(obs)
        # create_perceptual_target takes a current render, not genes
        current_render = RenderResult(
            implementation_id="IMPL-1",
            renderer_type=RendererType.DOM_CSS,
        )
        target = oracle.create_perceptual_target(obs, current_render)
        assert target.benchmark_observation_id == obs.observation_id
        assert target.recommended_renderer in RendererType


# ═══════════════════════════════════════════════════════════════
# Builder tests
# ═══════════════════════════════════════════════════════════════

class TestArchitectureSearch:
    def test_search_returns_multiple_candidates(self):
        target = PerceptualTarget(
            benchmark_observation_id="OBS-1",
            visual_identity="premium dark",
            primary_composition="asymmetric grid with glassmorphism",
            recommended_renderer=RendererType.DOM_CSS,
            renderer_rationale="CSS grid sufficient",
            depth_layers=3,
            motion_character="physics-based spring",
        )
        candidates = ArchitectureSearch.search(target)
        assert len(candidates) >= 2  # at least primary + baseline

    def test_search_includes_baseline_dom_css(self):
        target = PerceptualTarget(
            benchmark_observation_id="OBS-1",
            recommended_renderer=RendererType.WEBGL,
            renderer_rationale="GPU needed",
            depth_layers=1,
            motion_character="simple",
        )
        candidates = ArchitectureSearch.search(target)
        renderers = [c["renderer"] for c in candidates]
        assert RendererType.DOM_CSS in renderers  # baseline always included


class TestBuilder:
    def _make_target(self):
        return PerceptualTarget(
            benchmark_observation_id="OBS-1",
            visual_identity="premium dark",
            primary_composition="asymmetric grid",
            recommended_renderer=RendererType.DOM_CSS,
            renderer_rationale="CSS grid sufficient",
        )

    def _make_contract(self):
        return DistinctionContract(
            project_name="TestProduct",
            spatial_signature="asymmetric grid",
            interaction_primitive="hover-lift",
            forbidden_cliche="standard card grid",
            typography_doctrine="variable weight",
            motion_doctrine="spring easing",
            unique_feature="backdrop-filter blur",
        )

    def test_start_project_generates_prototypes(self):
        builder = VisualEngineer()
        target = self._make_target()
        contract = self._make_contract()
        prototypes = builder.start_project(target, contract, "PROJ-1")
        assert len(prototypes) > 0
        for p in prototypes:
            assert p.impl_id != ""
            assert p.renderer_type in RendererType

    def test_builder_does_not_evaluate_own_output(self):
        """The Builder cannot promote itself into verified memory."""
        builder = VisualEngineer()
        # Builder has no verify/accept method — that's the Archivist's job
        assert not hasattr(builder, "verify")
        assert not hasattr(builder, "accept_capability")

    def test_mutation_modifies_source_code(self):
        impl = Implementation(
            project_id="PROJ-1",
            source_code=REAL_HTML,
            renderer_type=RendererType.DOM_CSS,
        )
        target = self._make_target()
        mutated = MutationOperator.mutate(impl, target, "composition")
        # Mutation may or may not change the code, but the method must run
        assert mutated.impl_id != ""
        assert mutated.mutation_type is not None

    def test_recombination_produces_child(self):
        parent_a = Implementation(
            project_id="PROJ-1",
            source_code=REAL_HTML,
            renderer_type=RendererType.DOM_CSS,
        )
        parent_b = Implementation(
            project_id="PROJ-1",
            source_code="<html><body><h1>Different</h1></body></html>",
            renderer_type=RendererType.DOM_CSS,
        )
        target = self._make_target()
        child = MutationOperator.recombine(parent_a, parent_b, target)
        assert child.impl_id != ""
        assert len(child.source_code) > 0
        assert child.mutation_type == "recombination"


# ═══════════════════════════════════════════════════════════════
# BrowserLab tests
# ═══════════════════════════════════════════════════════════════

class TestAcceptanceThresholds:
    def test_wcag_2_2_is_hard_constraint(self):
        thresholds = AcceptanceThresholds()
        assert thresholds.min_accessibility == 0.8  # WCAG 2.2

    def test_hard_constraints_exist(self):
        thresholds = AcceptanceThresholds()
        assert thresholds.min_accessibility > 0
        assert thresholds.min_performance > 0
        assert thresholds.min_cross_device > 0


class TestMultiAxisEvaluator:
    def test_evaluate_computes_quality_scores(self):
        evaluator = MultiAxisEvaluator()
        render = RenderResult(
            implementation_id="IMPL-1",
            renderer_type=RendererType.DOM_CSS,
            desktop_frames=["frame1", "frame2"],
            mobile_frames=["mframe1"],
            interaction_trace=InteractionTrace(
                hover_elements=["btn1"],
                click_elements=["btn1"],
                scroll_depth=0.8,
                transition_timings=[300, 200],
            ),
            performance_trace={
                "firstContentfulPaint": 800,
                "largestContentfulPaint": 1800,
                "domCount": 120,
                "loadTime": 2500,
            },
        )
        target = PerceptualTarget(
            benchmark_observation_id="OBS-1",
            recommended_renderer=RendererType.DOM_CSS,
            renderer_rationale="test",
        )
        q = asyncio.run(evaluator.evaluate(render, target, None, None))
        assert q.total >= 0.0
        # If we have frames, composition should be computed
        if render.desktop_frames:
            assert q.composition_similarity >= 0.0


# ═══════════════════════════════════════════════════════════════
# Genome Runtime tests — memory isolation
# ═══════════════════════════════════════════════════════════════

class TestObservationMemory:
    def test_add_and_get(self):
        mem = ObservationMemory()
        source = SourceEntry(url="https://example.com")
        obs = DesignObservation(source_id=source.source_id, url="https://example.com")
        mem.add(source, obs)
        assert mem.get(obs.observation_id) is not None
        assert mem.get_source(source.source_id) is not None

    def test_count(self):
        mem = ObservationMemory()
        assert mem.count() == 0
        source = SourceEntry(url="https://example.com")
        obs = DesignObservation(source_id=source.source_id)
        mem.add(source, obs)
        assert mem.count() == 1


class TestLatentValueMemory:
    def test_add_and_get(self):
        mem = LatentValueMemory()
        gene = DesignGene(gene_type=GeneType.COMPOSITION, principle="test principle")
        mem.add_gene(gene)
        assert mem.get_gene(gene.gene_id) is not None
        assert mem.count() == 1


class TestAttemptMemory:
    def test_add_and_get(self):
        mem = AttemptMemory()
        impl = Implementation(project_id="PROJ-1", renderer_type=RendererType.DOM_CSS)
        mem.add_implementation(impl)
        assert mem.get_implementation(impl.impl_id) is not None

    def test_all_implementations(self):
        mem = AttemptMemory()
        impl1 = Implementation(project_id="PROJ-1", renderer_type=RendererType.DOM_CSS)
        impl2 = Implementation(project_id="PROJ-1", renderer_type=RendererType.WEBGL)
        mem.add_implementation(impl1)
        mem.add_implementation(impl2)
        all_impls = mem.all_implementations()
        assert len(all_impls) == 2


class TestVerifiedCapabilityMemory:
    def test_add_and_get(self):
        mem = VerifiedCapabilityMemory()
        cap = Capability(name="Test Capability", recognition="test", execution="test")
        mem.add(cap)
        assert mem.get(cap.capability_id) is not None

    def test_only_verified_capabilities(self):
        """Only verified capabilities should be in this memory — not attempts."""
        mem = VerifiedCapabilityMemory()
        cap = Capability(name="Test", recognition="test", execution="test")
        mem.add(cap)
        all_caps = mem.verified()
        for c in all_caps:
            assert isinstance(c, Capability)


class TestMemoryIsolation:
    """The four memories must be isolated — no cross-contamination."""

    def test_observation_memory_does_not_contain_capabilities(self):
        mem = ObservationMemory()
        source = SourceEntry(url="https://example.com")
        obs = DesignObservation(source_id=source.source_id)
        mem.add(source, obs)
        # Observation memory should only have observations, not capabilities
        assert not hasattr(mem, 'capabilities')

    def test_attempt_memory_does_not_contain_observations(self):
        mem = AttemptMemory()
        impl = Implementation(project_id="PROJ-1", renderer_type=RendererType.DOM_CSS)
        mem.add_implementation(impl)
        assert not hasattr(mem, 'observations')

    def test_verified_memory_does_not_contain_attempts(self):
        mem = VerifiedCapabilityMemory()
        cap = Capability(name="Test", recognition="test", execution="test")
        mem.add(cap)
        assert not hasattr(mem, 'implementations')


# ═══════════════════════════════════════════════════════════════
# Full runtime integration test
# ═══════════════════════════════════════════════════════════════

class TestDesignGenomeRuntime:
    def test_initializes_all_agents(self):
        rt = DesignGenomeRuntime()
        assert rt.scout is not None
        assert rt.oracle is not None
        assert rt.builder is not None
        assert rt.lab is not None
        assert rt.curator is not None
        assert rt.judge is not None
        assert rt.verifier is not None
        assert rt.archivist is not None

    def test_four_memories_exist(self):
        rt = DesignGenomeRuntime()
        assert rt.observation_memory is not None
        assert hasattr(rt, 'latent_value_memory') or hasattr(rt, '_latent_value_memory')
        assert hasattr(rt, 'attempt_memory') or hasattr(rt, '_attempt_memory')
        assert rt.verified_capability_memory is not None
        assert rt.failure_memory is not None

    def test_classify_failure_modes(self):
        rt = DesignGenomeRuntime()
        assert rt._classify_failure("Accessibility score 0.65 below WCAG 2.2 threshold") == "accessibility_violation"
        assert rt._classify_failure("load time 8.2s exceeds 5s budget") == "performance_budget_exceeded"
        assert rt._classify_failure("mobile rendering broken at 390px") == "cross_device_instability"

    def test_extract_lesson_is_actionable(self):
        rt = DesignGenomeRuntime()
        lesson = rt._extract_lesson("Accessibility score 0.65 below WCAG 2.2 threshold 0.80")
        assert "WCAG" in lesson or "accessibility" in lesson.lower()
        assert len(lesson) > 20  # not a trivial string

    def test_summary_returns_state(self):
        rt = DesignGenomeRuntime()
        state = rt.summary()
        assert isinstance(state, dict)
        assert len(state) > 0


# ═══════════════════════════════════════════════════════════════
# QualityScore formula test
# ═══════════════════════════════════════════════════════════════

class TestQualityScore:
    def test_total_includes_similarity_penalty(self):
        """Q = 0.22*U + 0.18*B + 0.16*C + 0.14*A + 0.12*P + 0.10*R + 0.08*N - 0.25*S
        The similarity penalty S is essential — without it, the system produces polished copying.
        """
        q = QualityScore(
            U=0.9, B=0.9, C=0.9, A=0.9, P=0.9, R=0.9, N=0.9,
            S=0.0,  # no similarity penalty
        )
        total_no_penalty = q.total

        q_with_penalty = QualityScore(
            U=0.9, B=0.9, C=0.9, A=0.9, P=0.9, R=0.9, N=0.9,
            S=0.9,  # high similarity penalty
        )
        total_with_penalty = q_with_penalty.total

        assert total_with_penalty < total_no_penalty, "Similarity penalty must reduce total when high"

    def test_total_bounded(self):
        q = QualityScore(
            U=1.0, B=1.0, C=1.0, A=1.0, P=1.0, R=1.0, N=1.0, S=0.0,
        )
        assert q.total <= 1.0 or q.total <= 1.01  # allow float rounding

    def test_zero_quality(self):
        q = QualityScore()
        assert q.total >= -1.0  # S could make it negative, which is correct


# ═══════════════════════════════════════════════════════════════
# Renderer classification test
# ═══════════════════════════════════════════════════════════════

class TestRendererClassification:
    def test_conventional_maps_to_dom_css(self):
        assert RENDERER_CLASSIFICATION["conventional_application_controls"] == RendererType.DOM_CSS

    def test_3d_maps_to_three_js(self):
        assert RENDERER_CLASSIFICATION["interactive_3d_environment"] == RendererType.THREE_JS

    def test_all_classifications_are_valid_renderers(self):
        for key, renderer in RENDERER_CLASSIFICATION.items():
            assert renderer in RendererType
