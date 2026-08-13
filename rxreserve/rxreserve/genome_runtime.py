"""Design Genome Runtime — main orchestrator.

The runtime is not a dataset. It is a self-renewing capability organism:

    Discover → recognize latent value → attempt implementation →
    render → compare → mutate → retain demonstrated improvement

Four isolated memories:
    1. Observation memory      — everything the crawler found
    2. Latent-value memory     — what the Oracle believes is valuable and why
    3. Attempt memory          — everything the Builder tried, including failures
    4. Verified-capability memory — only techniques that produced measurable improvement

The implementation model should not directly write into Taste Memory.
The Oracle should not directly modify production code.
Only verified experimental outcomes cross between them.

Continuous Acquisition Loop (hourly):
    1. Discover — Scout finds new sources
    2. Capture  — capture screenshots, interaction traces, structural data
    3. Decompose — Oracle extracts design genes
    4. Classify — classify by product category, audience, mood, purpose
    5. Evaluate — score for novelty, quality, saturation, trend velocity
    6. Promote  — high-value observations become latent-value entries
    7. Retire   — oversaturated patterns are retired
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any, Optional
from dataclasses import dataclass, field

from rxreserve.design_genome import (
    SourceEntry, SourceCategory, DesignObservation, DesignGene, GeneType,
    PerceptualTarget, DistinctionContract, Implementation, ImplementationStatus,
    RenderResult, QualityScore, Capability, CapabilityStatus,
    CorpusManifest, GenomeState, ProjectArchetype, AntiPattern,
    PreferenceEntry, RendererType, RENDERER_CLASSIFICATION,
    FailureRecord, TransferTest,
)
from rxreserve.scout import Scout
from rxreserve.oracle import TasteOracle
from rxreserve.builder import VisualEngineer, PopulationStats
from rxreserve.browser_lab import BrowserLab, AcceptanceThresholds, BrowserJudge, ComparisonResult
from rxreserve.curator import Curator, PopulationClass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ═══════════════════════════════════════════════════════════════
# Memory Stores — four isolated memories
# ═══════════════════════════════════════════════════════════════

class ObservationMemory:
    """Memory 1: Everything the crawler found (no claim of usefulness)."""

    def __init__(self) -> None:
        self._observations: dict[str, DesignObservation] = {}
        self._sources: dict[str, SourceEntry] = {}

    def add(self, source: SourceEntry, observation: DesignObservation) -> None:
        self._sources[source.source_id] = source
        self._observations[observation.observation_id] = observation

    def get(self, observation_id: str) -> Optional[DesignObservation]:
        return self._observations.get(observation_id)

    def get_source(self, source_id: str) -> Optional[SourceEntry]:
        return self._sources.get(source_id)

    def all_observations(self) -> list[DesignObservation]:
        return list(self._observations.values())

    def count(self) -> int:
        return len(self._observations)

    def source_count(self) -> int:
        return len(self._sources)


class LatentValueMemory:
    """Memory 2: What the Oracle believes is valuable and why.

    The implementation model should not directly write into Taste Memory.
    """

    def __init__(self) -> None:
        self._genes: dict[str, DesignGene] = {}
        self._evaluations: dict[str, dict[str, Any]] = {}  # observation_id -> evaluation
        self._anti_patterns: dict[str, AntiPattern] = {}

    def add_gene(self, gene: DesignGene) -> None:
        self._genes[gene.gene_id] = gene

    def add_evaluation(self, observation_id: str, evaluation: dict[str, Any]) -> None:
        self._evaluations[observation_id] = evaluation

    def add_anti_pattern(self, ap: AntiPattern) -> None:
        self._anti_patterns[ap.antipattern_id] = ap

    def get_gene(self, gene_id: str) -> Optional[DesignGene]:
        return self._genes.get(gene_id)

    def all_genes(self) -> list[DesignGene]:
        return list(self._genes.values())

    def active_genes(self) -> list[DesignGene]:
        return [g for g in self._genes.values() if not g.retired]

    def retired_genes(self) -> list[DesignGene]:
        return [g for g in self._genes.values() if g.retired]

    def get_anti_patterns(self) -> list[AntiPattern]:
        return list(self._anti_patterns.values())

    def retire_gene(self, gene_id: str, reason: str) -> None:
        gene = self._genes.get(gene_id)
        if gene:
            gene.retired = True
            gene.retired_reason = reason

    def count(self) -> int:
        return len(self._genes)

    def active_count(self) -> int:
        return len(self.active_genes())


class AttemptMemory:
    """Memory 3: Everything the Builder tried, including failures.

    The Oracle should not directly modify production code.
    """

    def __init__(self) -> None:
        self._implementations: dict[str, Implementation] = {}
        self._renders: dict[str, RenderResult] = {}
        self._targets: dict[str, PerceptualTarget] = {}

    def add_implementation(self, impl: Implementation) -> None:
        self._implementations[impl.impl_id] = impl

    def add_render(self, render: RenderResult) -> None:
        self._renders[render.render_id] = render

    def add_target(self, target: PerceptualTarget) -> None:
        self._targets[target.target_id] = target

    def get_implementation(self, impl_id: str) -> Optional[Implementation]:
        return self._implementations.get(impl_id)

    def get_render(self, render_id: str) -> Optional[RenderResult]:
        return self._renders.get(render_id)

    def get_target(self, target_id: str) -> Optional[PerceptualTarget]:
        return self._targets.get(target_id)

    def all_implementations(self) -> list[Implementation]:
        return list(self._implementations.values())

    def all_renders(self) -> list[RenderResult]:
        return list(self._renders.values())

    def count(self) -> int:
        return len(self._implementations)

    def render_count(self) -> int:
        return len(self._renders)


class VerifiedCapabilityMemory:
    """Memory 4: Only techniques that produced measurable improvement.

    A Builder experiment cannot promote itself into verified memory.
    Promotion requires independent evaluation.
    """

    def __init__(self) -> None:
        self._capabilities: dict[str, Capability] = {}
        self._preferences: dict[str, PreferenceEntry] = {}

    def add(self, cap: Capability) -> None:
        self._capabilities[cap.capability_id] = cap

    def get(self, capability_id: str) -> Optional[Capability]:
        return self._capabilities.get(capability_id)

    def verified(self) -> list[Capability]:
        return [c for c in self._capabilities.values() if c.is_verified]

    def candidates(self) -> list[Capability]:
        return [c for c in self._capabilities.values()
                if c.status == CapabilityStatus.IMPLEMENTED]

    def add_preference(self, pref: PreferenceEntry) -> None:
        self._preferences[pref.entry_id] = pref

    def preferences(self) -> list[PreferenceEntry]:
        return list(self._preferences.values())

    def count(self) -> int:
        return len(self._capabilities)

    def verified_count(self) -> int:
        return len(self.verified())

    def active_capabilities(self) -> list[Capability]:
        """Capabilities that are verified and not saturated/retired."""
        return [c for c in self._capabilities.values() if c.is_active and c.is_verified]

    def production_capabilities(self) -> list[Capability]:
        return [c for c in self._capabilities.values()
                if c.status == CapabilityStatus.PRODUCTION]

    def saturated_capabilities(self) -> list[Capability]:
        return [c for c in self._capabilities.values()
                if c.status == CapabilityStatus.SATURATED]

    def get_by_weight(self, limit: int = 10) -> list[Capability]:
        """Get capabilities ranked by skill weight (quality × transferability × novelty × reliability) / saturation."""
        active = self.active_capabilities()
        active.sort(key=lambda c: c.skill_weight, reverse=True)
        return active[:limit]

    def increment_retrieval(self, capability_id: str) -> None:
        """Track when a capability is retrieved for use (saturation tracking)."""
        cap = self._capabilities.get(capability_id)
        if cap:
            cap.times_retrieved += 1
            cap.last_used = _now()
            # Increase saturation factor as capability is overused
            cap.saturation_factor = 1.0 + (cap.times_retrieved * 0.05)
            # Auto-saturate if overused
            if cap.saturation_factor > 3.0 and cap.status == CapabilityStatus.PRODUCTION:
                cap.status = CapabilityStatus.SATURATED


class FailureMemory:
    """Memory 5: Documented failures — what does NOT work.

    The failure population is critical. It teaches the system what
    doesn't work, preventing repeated dead ends. Failures are not
    discarded — they are retained as negative knowledge with the same
    structural rigor as verified capabilities.
    """

    def __init__(self) -> None:
        self._failures: dict[str, FailureRecord] = {}
        self._by_mode: dict[str, list[str]] = {}  # failure_mode -> failure_ids
        self._by_capability: dict[str, list[str]] = {}  # cap_id -> failure_ids

    def add(self, failure: FailureRecord) -> None:
        self._failures[failure.failure_id] = failure
        mode = failure.failure_mode or "unknown"
        self._by_mode.setdefault(mode, []).append(failure.failure_id)
        if failure.capability_id:
            self._by_capability.setdefault(failure.capability_id, []).append(failure.failure_id)

    def get(self, failure_id: str) -> Optional[FailureRecord]:
        return self._failures.get(failure_id)

    def by_mode(self, failure_mode: str) -> list[FailureRecord]:
        ids = self._by_mode.get(failure_mode, [])
        return [self._failures[fid] for fid in ids if fid in self._failures]

    def by_capability(self, capability_id: str) -> list[FailureRecord]:
        ids = self._by_capability.get(capability_id, [])
        return [self._failures[fid] for fid in ids if fid in self._failures]

    def all_failures(self) -> list[FailureRecord]:
        return list(self._failures.values())

    def failure_modes(self) -> dict[str, int]:
        return {mode: len(ids) for mode, ids in self._by_mode.items()}

    def count(self) -> int:
        return len(self._failures)

    def lessons_for_renderer(self, renderer_type: str) -> list[str]:
        """Get failure lessons for a specific renderer type."""
        return [
            f.lesson for f in self._failures.values()
            if f.renderer_type == renderer_type and f.lesson
        ]

    def avoid_patterns_for_axis(self, mutation_axis: str) -> list[str]:
        """Get patterns to avoid for a specific mutation axis."""
        return [
            f.avoid_pattern for f in self._failures.values()
            if f.mutation_axis == mutation_axis and f.avoid_pattern
        ]


class FrontierPopulation:
    """Tracks the live design frontier — currently tracked observations
    that are worth monitoring but haven't been promoted to candidates yet.

    The frontier population is self-renewing: observations enter, get
    tracked for velocity changes, and either get promoted to candidates
    or archived.
    """

    def __init__(self) -> None:
        self._members: dict[str, dict[str, Any]] = {}  # observation_id -> tracking data
        self._velocity_history: dict[str, list[float]] = {}

    def add(self, observation_id: str, velocity: float = 0.0) -> None:
        self._members[observation_id] = {
            "added_at": _now(),
            "initial_velocity": velocity,
            "current_velocity": velocity,
            "promotion_score": 0.0,
        }
        self._velocity_history[observation_id] = [velocity]

    def update_velocity(self, observation_id: str, velocity: float) -> None:
        if observation_id in self._members:
            self._members[observation_id]["current_velocity"] = velocity
            self._velocity_history.setdefault(observation_id, []).append(velocity)
            # Keep last 20 readings
            self._velocity_history[observation_id] = self._velocity_history[observation_id][-20:]

    def get_accelerating(self, threshold: float = 0.1) -> list[str]:
        """Get observation IDs whose velocity is accelerating."""
        accelerating: list[str] = []
        for obs_id, history in self._velocity_history.items():
            if len(history) >= 2:
                recent_avg = sum(history[-3:]) / min(len(history), 3)
                older_avg = sum(history[:-3]) / max(len(history) - 3, 1)
                if recent_avg - older_avg > threshold:
                    accelerating.append(obs_id)
        return accelerating

    def remove(self, observation_id: str) -> None:
        self._members.pop(observation_id, None)
        self._velocity_history.pop(observation_id, None)

    def count(self) -> int:
        return len(self._members)

    def members(self) -> list[str]:
        return list(self._members.keys())


# ═══════════════════════════════════════════════════════════════
# Capability Verifier — independent verification
# ═══════════════════════════════════════════════════════════════

class CapabilityVerifier:
    """Independently verifies Builder-proposed capabilities.

    A Builder experiment cannot promote itself into verified memory.
    Promotion requires independent evaluation.

    Lifecycle: OBSERVED → HYPOTHESIZED → IMPLEMENTED → VERIFIED → PRODUCTION → SATURATED → RETIRED
    """

    REQUIRED_PROBES = [
        "depth_reproduced", "motion_reproduced", "mobile_preserved",
        "accessibility_maintained", "performance_budget_met",
        "transfers_to_other_products", "survives_human_comparison",
    ]

    @staticmethod
    def verify(capability: Capability, min_confidence: float = 0.6,
               min_probe_rate: float = 0.6) -> Capability:
        """Verify a capability candidate independently.

        Transitions: IMPLEMENTED → VERIFIED (if probes pass) or stays IMPLEMENTED.
        """
        # Check confidence
        if capability.confidence < min_confidence:
            capability.status = CapabilityStatus.IMPLEMENTED
            return capability

        # Check probe pass rate
        pass_rate = capability.probe_pass_rate
        if pass_rate < min_probe_rate:
            capability.status = CapabilityStatus.IMPLEMENTED
            return capability

        # All checks passed — promote to VERIFIED
        capability.status = CapabilityStatus.VERIFIED
        capability.verified_at = _now()

        # Compute skill weight factors from actual capability data
        # Quality: geometric mean of confidence and probe pass rate
        # — both must be high for quality to be high
        capability.quality_factor = (capability.confidence * pass_rate) ** 0.5

        # Transferability: ratio of successful transfers to total attempts
        # — 0 if never tested, baseline if marked but not yet counted,
        #   approaches 1 as transfer tests succeed
        if capability.transfers_to_other_products:
            if capability.transfer_success_count > 0:
                total_transfer_attempts = max(
                    capability.transfer_success_count
                    + len(capability.transfer_test_results) - capability.transfer_success_count,
                    1,
                )
                capability.transferability_factor = (
                    capability.transfer_success_count / total_transfer_attempts
                )
            else:
                # Marked as transferable but no formal count yet — give baseline
                capability.transferability_factor = 0.5
        else:
            capability.transferability_factor = 0.0

        # Novelty: inverse of saturation, boosted by originality
        # — fresh capabilities start at 1.0, decay as they're overused
        novelty_base = 1.0 / max(capability.saturation_factor, 1.0)
        # If the capability has comparison scores, use originality from there
        originality = capability.comparison_scores.get("originality_distance", 0.5)
        capability.novelty_factor = max(0.0, min(1.0, novelty_base * 0.7 + originality * 0.3))

        # Reliability: probe consistency — how many of the 7 probes pass
        # — not just the rate, but weighted by which probes matter most
        probe_weights = {
            "depth_reproduced": 0.20,
            "motion_reproduced": 0.20,
            "mobile_preserved": 0.15,
            "accessibility_maintained": 0.20,
            "performance_budget_met": 0.10,
            "transfers_to_other_products": 0.10,
            "survives_human_comparison": 0.05,
        }
        probe_values = {
            "depth_reproduced": capability.depth_reproduced,
            "motion_reproduced": capability.motion_reproduced,
            "mobile_preserved": capability.mobile_preserved,
            "accessibility_maintained": capability.accessibility_maintained,
            "performance_budget_met": capability.performance_budget_met,
            "transfers_to_other_products": capability.transfers_to_other_products,
            "survives_human_comparison": capability.survives_human_comparison,
        }
        capability.reliability_factor = sum(
            probe_weights[k] for k, v in probe_values.items() if v
        )

        return capability

    @staticmethod
    def promote_to_production(capability: Capability) -> Capability:
        """Promote a verified capability to production after transfer testing."""
        if capability.status == CapabilityStatus.VERIFIED and capability.transfers_to_other_products:
            capability.status = CapabilityStatus.PRODUCTION
        return capability

    @staticmethod
    def retire(capability: Capability, reason: str = "") -> Capability:
        """Retire a capability that is no longer useful."""
        capability.status = CapabilityStatus.RETIRED
        capability.expiration_weight = 0.0
        return capability

    @staticmethod
    def check_transfer(capability: Capability, target_product: str) -> bool:
        """Check if capability transfers to a different product category."""
        return capability.transfers_to_other_products


# ═══════════════════════════════════════════════════════════════
# Archivist — only accepts browser-verified evidence
# ═══════════════════════════════════════════════════════════════

class Archivist:
    """The Archivist is the gatekeeper of verified capability memory.

    The Archivist only accepts browser-verified evidence. No claim of
    skill acquisition is valid without a corresponding render that
    demonstrates the capability in a real browser.

    The Archivist also manages capability lifecycle transitions:
    - Promotes VERIFIED → PRODUCTION after transfer tests pass
    - Marks SATURATED when retrieval count exceeds threshold
    - Retires capabilities that have been saturated too long
    - Re-activates retired capabilities when contextually unusual
    """

    SATURATION_THRESHOLD = 20  # retrievals before saturation
    RETIREMENT_AGE = 60  # days saturated before retirement
    REACTIVATION_NOVELTY = 0.7  # novelty score needed to reactivate

    @staticmethod
    def accept_capability(
        capability: Capability,
        render: RenderResult,
        transfer_tests: list[TransferTest] = None,
        failure_records: list[FailureRecord] = None,
    ) -> tuple[bool, str]:
        """Accept a capability into verified memory.

        Returns (accepted, reason). The Archivist only accepts
        browser-verified evidence — no render, no entry.
        """
        # Must have browser render evidence
        if not render or not render.render_id:
            return False, "No browser render evidence provided"

        # Render must be accepted (passed browser lab thresholds)
        if not render.accepted:
            return False, f"Render rejected: {render.rejected_reason}"

        # Must have at least the core probes passed
        if not capability.depth_reproduced and not capability.motion_reproduced:
            return False, "No perceptual probes passed"

        # Transfer tests must pass (if any were run)
        if transfer_tests:
            passed = [t for t in transfer_tests if t.passed]
            if len(passed) == 0:
                return False, "All transfer tests failed"
            capability.transfer_success_count = len(passed)
            capability.transfers_to_other_products = len(passed) > 0
            capability.transfer_test_results = [t.to_dict() for t in transfer_tests]

        # Record failed alternatives
        if failure_records:
            capability.failed_alternatives = [f.to_dict() for f in failure_records]

        # Store verified render
        if render.render_id not in capability.verified_renders:
            capability.verified_renders.append(render.render_id)

        # Record performance profile
        capability.performance_profile = render.performance_trace

        return True, "Accepted with browser-verified evidence"

    @staticmethod
    def check_saturation(capability: Capability) -> Capability:
        """Check and update saturation status of a capability."""
        if capability.times_retrieved > Archivist.SATURATION_THRESHOLD:
            if capability.status == CapabilityStatus.PRODUCTION:
                capability.status = CapabilityStatus.SATURATED
                capability.saturation_factor = max(capability.saturation_factor, 3.0)
        return capability

    @staticmethod
    def maybe_retire(capability: Capability, days_saturated: int = 0) -> Capability:
        """Retire a capability that has been saturated too long."""
        if (capability.status == CapabilityStatus.SATURATED
                and days_saturated > Archivist.RETIREMENT_AGE):
            capability.status = CapabilityStatus.RETIRED
            capability.expiration_weight = 0.0
        return capability

    @staticmethod
    def maybe_reactivate(capability: Capability, context_novelty: float = 0.0) -> Capability:
        """Reactivate a retired capability if context is sufficiently novel."""
        if (capability.status == CapabilityStatus.RETIRED
                and context_novelty > Archivist.REACTIVATION_NOVELTY):
            capability.status = CapabilityStatus.VERIFIED
            capability.saturation_factor = 1.0
            capability.expiration_weight = 1.0
            capability.times_retrieved = 0
        return capability


# ═══════════════════════════════════════════════════════════════
# Distinction Contract Validator
# ═══════════════════════════════════════════════════════════════

class DistinctionValidator:
    """Validates that a design meets its Distinction Contract.

    If the product name can be replaced and the interface still makes
    equal sense, the design fails.
    """

    @staticmethod
    def validate(render: RenderResult, contract: DistinctionContract) -> tuple[bool, float, list[str]]:
        """Validate a render against its Distinction Contract.

        Returns (passes, distinction_score, failures).
        """
        failures: list[str] = []
        score = 0.0
        checks = 0

        # Check 1: Three emotions
        if contract.required_emotions:
            checks += 1
            # In production, evaluate emotional response from render
            if render.quality.product_specific_identity > 0.5:
                score += 1.0
            else:
                failures.append("Required emotions not sufficiently expressed")

        # Check 2: Spatial signature
        if contract.spatial_signature:
            checks += 1
            if render.quality.composition_similarity > 0.4:
                score += 1.0
            else:
                failures.append("Spatial signature not achieved")

        # Check 3: Interaction primitive
        if contract.interaction_primitive:
            checks += 1
            if render.quality.interaction_responsiveness > 0.5:
                score += 1.0
            else:
                failures.append("Interaction primitive not implemented")

        # Check 4: Forbidden cliché
        if contract.forbidden_cliche:
            checks += 1
            if render.quality.originality_distance > 0.4:
                score += 1.0
            else:
                failures.append(f"Forbidden cliché detected: {contract.forbidden_cliche}")

        # Check 5: Typography doctrine
        if contract.typography_doctrine:
            checks += 1
            if render.quality.typography_character_match > 0.5:
                score += 1.0
            else:
                failures.append("Typography doctrine not followed")

        # Check 6: Motion doctrine
        if contract.motion_doctrine:
            checks += 1
            if render.quality.motion_character_match > 0.5:
                score += 1.0
            else:
                failures.append("Motion doctrine not followed")

        # Check 7: Information density rule
        if contract.density_rule:
            checks += 1
            if render.quality.information_density_match > 0.4:
                score += 1.0
            else:
                failures.append("Information density rule violated")

        # Check 8: Unique feature
        if contract.unique_feature:
            checks += 1
            if render.quality.product_specific_identity > 0.6:
                score += 1.0
            else:
                failures.append("Unique feature not sufficiently product-specific")

        distinction_score = score / max(checks, 1)
        passes = distinction_score >= 0.7 and len(failures) <= 2

        contract.distinction_verified = passes
        contract.distinction_score = distinction_score

        return passes, distinction_score, failures


# ═══════════════════════════════════════════════════════════════
# Design Genome Runtime — main orchestrator
# ═══════════════════════════════════════════════════════════════

class DesignGenomeRuntime:
    """The Design Genome Runtime — Visual Skill Foundry.

    A self-renewing capability organism that:
        1. Discovers design frontiers (Scout)
        2. Curates into populations (Curator)
        3. Recognizes latent value (Oracle)
        4. Attempts implementation (Builder)
        5. Renders and evaluates (Browser Lab)
        6. Judges independently (Browser Judge)
        7. Verifies with browser evidence (Archivist)
        8. Retains demonstrated improvement (Verified Capability Memory)

    The system evolves implementations, not pages. A skill exists only
    when the system repeatedly converts references into working browser
    implementations and retains the techniques that measurably improve
    the render.
    """

    def __init__(self, db_path: str = "rxreserve.db",
                 headless: bool = True, video_dir: str = None) -> None:
        self.db_path = db_path

        # Agents — six isolated intelligence roles
        self.scout = Scout()
        self.curator = Curator()
        self.oracle = TasteOracle()
        self.builder = VisualEngineer()
        self.lab = BrowserLab(headless=headless, video_dir=video_dir)
        self.judge = BrowserJudge()
        self.archivist = Archivist()
        self.verifier = CapabilityVerifier()
        self.distinction_validator = DistinctionValidator()

        # Isolated memories with strict write authorities
        self.observation_memory = ObservationMemory()      # Scout writes
        self.latent_value_memory = LatentValueMemory()      # Oracle writes
        self.attempt_memory = AttemptMemory()               # Builder writes
        self.verified_capability_memory = VerifiedCapabilityMemory()  # Archivist writes
        self.failure_memory = FailureMemory()               # Browser Judge writes
        self.frontier_population = FrontierPopulation()     # Curator writes

        # State
        self.state = GenomeState()
        self._corpus_version = "0.1.0"
        self._projects: dict[str, ProjectArchetype] = {}
        self._contracts: dict[str, DistinctionContract] = {}
        self._manifests: list[CorpusManifest] = []

    # ═══════════════════════════════════════════════════════════
    # Continuous Acquisition Loop
    # ═══════════════════════════════════════════════════════════

    async def run_acquisition_cycle(self, max_sources: int = 10) -> dict[str, Any]:
        """Run one acquisition cycle.

        1. Discover — Scout finds new sources
        2. Capture  — capture screenshots, interaction traces, structural data
        3. Decompose — Oracle extracts design genes
        4. Curate   — Curator assigns to populations (frontier/candidate/archive)
        5. Evaluate — score for novelty, quality, saturation, trend velocity
        6. Promote  — high-value observations become latent-value entries
        7. Retire   — oversaturated patterns are retired
        """
        cycle_start = _now()
        results = {
            "cycle_start": cycle_start,
            "discovered": 0,
            "captured": 0,
            "decomposed": 0,
            "curated": 0,
            "promoted": 0,
            "retired": 0,
            "challenges_extracted": 0,
            "errors": [],
        }

        try:
            # Step 1: Discover
            sources = self.scout.discover_sources(max_per_category=max_sources // 12 + 1)
            results["discovered"] = len(sources)

            # Step 2: Capture
            for source in sources:
                source, observation = await self.scout.capture_source(source)
                if observation:
                    self.observation_memory.add(source, observation)
                    results["captured"] += 1

                    # Step 3: Decompose
                    genes, evaluation = self.oracle.extract_genes(observation)
                    results["decomposed"] += len(genes)

                    # Step 4: Curate — assign to population
                    assignment = self.curator.curate(
                        observation, genes, source.category,
                        existing_gene_count=self.latent_value_memory.count())
                    results["curated"] += 1

                    # Track frontier population
                    if assignment.population == PopulationClass.FRONTIER.value:
                        self.frontier_population.add(
                            observation.observation_id,
                            velocity=assignment.velocity_score)

                    # Step 5: Classify and Evaluate genes
                    for gene in genes:
                        saturation = self.scout.trend_detector.get_saturation(gene.principle[:50])
                        gene.saturation_score = saturation
                        gene.trend_velocity = observation.trend_velocity

                        # Step 6: Promote high-value observations
                        if evaluation["is_acquisition_candidate"] and not gene.retired:
                            self.latent_value_memory.add_gene(gene)
                            results["promoted"] += 1

                    self.latent_value_memory.add_evaluation(observation.observation_id, evaluation)

                    # Track challenges from promoted candidates
                    if assignment.population == PopulationClass.CANDIDATE.value:
                        challenge = self.curator.get_challenge(observation.observation_id)
                        if challenge:
                            results["challenges_extracted"] += 1

            # Step 7: Retire oversaturated patterns
            oversaturated = self.scout.get_oversaturated_patterns()
            for pattern in oversaturated:
                for gene in self.latent_value_memory.active_genes():
                    if pattern in gene.principle:
                        self.latent_value_memory.retire_gene(gene.gene_id, "Oversaturated pattern")
                        results["retired"] += 1

            # Check frontier for accelerating observations
            accelerating = self.frontier_population.get_accelerating()
            for obs_id in accelerating:
                obs = self.observation_memory.get(obs_id)
                if obs:
                    genes = self.oracle.decomposer.decompose(obs)
                    assignment = self.curator.curate(
                        obs, genes, source.category,
                        existing_gene_count=self.latent_value_memory.count())
                    if assignment.population == PopulationClass.CANDIDATE.value:
                        self.frontier_population.remove(obs_id)

        except Exception as e:
            results["errors"].append(str(e))

        # Update state
        self.state.last_acquisition_run = cycle_start
        self.state.total_acquisition_cycles += 1
        self.state.observation_count = self.observation_memory.count()
        self.state.latent_value_count = self.latent_value_memory.active_count()
        self.state.oversaturated_patterns = oversaturated if 'oversaturated' in dir() else []
        self.state.retired_pattern_count = len(self.latent_value_memory.retired_genes())
        self.state.frontier_population_count = self.frontier_population.count()
        self.state.candidate_population_count = self.curator.candidate_count()
        self.state.failure_population_count = self.failure_memory.count()

        results["cycle_end"] = _now()
        return results

    # ═══════════════════════════════════════════════════════════
    # Design Project Lifecycle
    # ═══════════════════════════════════════════════════════════

    def create_distinction_contract(self, project_name: str, brief: str,
                                    emotions: list[str], spatial_signature: str,
                                    interaction_primitive: str, forbidden_cliche: str,
                                    typography_doctrine: str, motion_doctrine: str,
                                    density_rule: str, unique_feature: str) -> DistinctionContract:
        """Create a Distinction Contract for a project.

        Eight mandatory elements ensure unique design outcomes.
        """
        contract = DistinctionContract(
            project_name=project_name,
            project_brief=brief,
            required_emotions=emotions,
            spatial_signature=spatial_signature,
            interaction_primitive=interaction_primitive,
            forbidden_cliche=forbidden_cliche,
            typography_doctrine=typography_doctrine,
            motion_doctrine=motion_doctrine,
            density_rule=density_rule,
            unique_feature=unique_feature,
        )
        self._contracts[contract.contract_id] = contract
        return contract

    def create_project(self, project_name: str, product_category: str,
                       audience: str, mood: str, interaction_purpose: str,
                       contract: DistinctionContract) -> ProjectArchetype:
        """Create a new design project with archetype and contract."""
        archetype = ProjectArchetype(
            project_name=project_name,
            product_category=product_category,
            audience=audience,
            mood=mood,
            interaction_purpose=interaction_purpose,
            distinction_contract_id=contract.contract_id,
        )

        # Retrieve relevant genes for this project context
        relevant_genes = self._retrieve_genes(product_category, audience, mood, interaction_purpose)
        archetype.active_gene_ids = [g.gene_id for g in relevant_genes]

        # Generate 5 competing experience hypotheses
        archetype.experience_hypotheses = self._generate_hypotheses(relevant_genes, contract)

        self._projects[archetype.archetype_id] = archetype
        self.state.active_project_count = len(self._projects)
        return archetype

    def _retrieve_genes(self, product_category: str, audience: str,
                        mood: str, interaction_purpose: str) -> list[DesignGene]:
        """Retrieve relevant genes for a project context.

        The system uses project archetype (product category, audience, mood,
        interaction purpose) to retrieve and synthesize relevant design genes.
        """
        all_genes = self.latent_value_memory.active_genes()
        scored: list[tuple[DesignGene, float]] = []

        for gene in all_genes:
            score = 0.0
            if product_category in gene.product_categories:
                score += 0.3
            if audience in gene.audience_types:
                score += 0.2
            if mood in gene.mood_tags:
                score += 0.2
            if interaction_purpose in gene.interaction_purposes:
                score += 0.2
            score += gene.confidence * 0.1
            scored.append((gene, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return [g for g, s in scored[:20] if s > 0]

    def _generate_hypotheses(self, genes: list[DesignGene],
                             contract: DistinctionContract) -> list[dict[str, Any]]:
        """Generate 5 competing experience hypotheses.

        The system must generate five competing experience hypotheses,
        not one. It must render all five. It must select the strongest.
        """
        hypotheses: list[dict[str, Any]] = []

        # Group genes by type
        by_type: dict[GeneType, list[DesignGene]] = {}
        for gene in genes:
            by_type.setdefault(gene.gene_type, []).append(gene)

        # Hypothesis 1: Composition-led
        comp_genes = by_type.get(GeneType.COMPOSITION, [])
        if comp_genes:
            hypotheses.append({
                "id": "H1",
                "name": "Composition-led",
                "primary_gene": comp_genes[0].gene_id,
                "description": f"Led by composition: {comp_genes[0].principle}",
            })

        # Hypothesis 2: Motion-led
        motion_genes = by_type.get(GeneType.MOTION_CHARACTER, [])
        if motion_genes:
            hypotheses.append({
                "id": "H2",
                "name": "Motion-led",
                "primary_gene": motion_genes[0].gene_id,
                "description": f"Led by motion: {motion_genes[0].principle}",
            })

        # Hypothesis 3: Typography-led
        typo_genes = by_type.get(GeneType.TYPOGRAPHY, [])
        if typo_genes:
            hypotheses.append({
                "id": "H3",
                "name": "Typography-led",
                "primary_gene": typo_genes[0].gene_id,
                "description": f"Led by typography: {typo_genes[0].principle}",
            })

        # Hypothesis 4: Depth-led
        depth_genes = by_type.get(GeneType.DEPTH, [])
        if depth_genes:
            hypotheses.append({
                "id": "H4",
                "name": "Depth-led",
                "primary_gene": depth_genes[0].gene_id,
                "description": f"Led by depth: {depth_genes[0].principle}",
            })

        # Hypothesis 5: Hybrid
        hypotheses.append({
            "id": "H5",
            "name": "Hybrid synthesis",
            "primary_gene": "",
            "description": "Synthesis of strongest genes across all axes",
        })

        return hypotheses[:5]

    async def run_experiment(self, project: ProjectArchetype,
                             benchmark_observation_id: str = None,
                             max_generations: int = 10) -> dict[str, Any]:
        """Run a design experiment for a project.

        The system never jumps directly from prompt to React. It must:
        1. Generate competing implementation paths
        2. Render every candidate
        3. Judge independently (Browser Judge — never sees source code)
        4. Select the strongest via tournament
        5. Mutate independently
        6. Reject regressions (record as FailureRecords)
        7. Recombine compatible winners
        8. Preserve lineage
        9. Transfer test the winner on a different product
        10. Archive with browser-verified evidence (Archivist)
        """
        contract = self._contracts.get(project.distinction_contract_id)
        if not contract:
            return {"error": "No distinction contract found"}

        # Get benchmark observation
        benchmark = None
        if benchmark_observation_id:
            benchmark = self.observation_memory.get(benchmark_observation_id)

        # Get relevant genes
        genes = [self.latent_value_memory.get_gene(gid) for gid in project.active_gene_ids
                 if self.latent_value_memory.get_gene(gid)]

        # Create perceptual target
        target = PerceptualTarget(
            benchmark_observation_id=benchmark.observation_id if benchmark else "",
            visual_identity=project.mood,
            primary_composition="; ".join(g.principle for g in genes[:3] if g),
            recommended_renderer=RendererType.DOM_CSS,
            renderer_rationale="Default renderer",
        )

        if benchmark:
            target = self.oracle.create_perceptual_target(
                benchmark, RenderResult(), None)

        # Start project with architecture search
        prototypes = self.builder.start_project(target, contract, project.archetype_id)

        # Record in attempt memory
        for proto in prototypes:
            self.attempt_memory.add_implementation(proto)

        # Evolve for max_generations
        best_impl = None
        best_quality = 0.0
        best_render = None
        all_renders: list[RenderResult] = []
        all_failures: list[FailureRecord] = []
        tournament_results: list[ComparisonResult] = []

        for gen in range(max_generations):
            # Render and evaluate all implementations
            current_pop = self.builder.population._population
            gen_renders: list[tuple[Implementation, RenderResult]] = []

            for impl in current_pop:
                render = await self.lab.evaluate_implementation(
                    impl, target, contract,
                    self.attempt_memory.get_render(impl.best_render_id) if impl.best_render_id else None)

                self.builder.submit_render(impl, render)
                self.attempt_memory.add_render(render)
                all_renders.append(render)
                gen_renders.append((impl, render))

                # Validate distinction contract
                if render.accepted:
                    passes, score, failures = self.distinction_validator.validate(render, contract)
                    if not passes:
                        render.accepted = False
                        render.rejected_reason = f"Distinction contract failed: {'; '.join(failures[:3])}"

                # Record failures for rejected renders
                if not render.accepted and render.rejected_reason:
                    failure = FailureRecord(
                        impl_id=impl.impl_id,
                        renderer_type=impl.renderer_type.value if hasattr(impl.renderer_type, 'value') else str(impl.renderer_type),
                        failure_mode=self._classify_failure(render.rejected_reason),
                        failure_description=render.rejected_reason,
                        render_id=render.render_id,
                        quality_score=render.quality.total,
                        quality_breakdown={
                            "accessibility": render.quality.accessibility_audit,
                            "performance": render.quality.runtime_performance,
                            "cross_device": render.quality.cross_device_stability,
                            "originality": render.quality.originality_distance,
                        },
                        lesson=self._extract_lesson(render.rejected_reason),
                        avoid_pattern=self._extract_avoid_pattern(render.rejected_reason, impl),
                        generation=gen,
                        parent_impl_id=impl.parent_id or "",
                    )
                    self.failure_memory.add(failure)
                    all_failures.append(failure)

                if impl.best_quality > best_quality:
                    best_quality = impl.best_quality
                    best_impl = impl
                    best_render = render

            # Tournament: use Browser Judge to rank renders in this generation
            if len(gen_renders) > 1:
                renders_only = [r for _, r in gen_renders]
                ranked = await self.judge.rank(
                    renders_only, benchmark=benchmark,
                    contract=contract)

                # Record tournament result for top 2
                if len(ranked) >= 2:
                    comparison = await self.judge.compare(
                        ranked[0][0], ranked[1][0],
                        benchmark=benchmark, contract=contract)
                    tournament_results.append(comparison)

                self.state.total_tournaments += 1

            # Check stagnation
            if self.builder.is_stagnant():
                break

            # Evolve to next generation
            next_gen = self.builder.evolve_generation(target)
            for impl in next_gen:
                self.attempt_memory.add_implementation(impl)

            self.state.total_experiments += 1

        # Update project with best
        if best_impl:
            project.best_impl_id = best_impl.impl_id
            project.best_quality_score = best_quality

        # Count accepted/rejected
        accepted = sum(1 for r in all_renders if r.accepted)
        rejected = len(all_renders) - accepted
        self.state.total_accepted_mutations += accepted
        self.state.total_rejected_mutations += rejected

        # Propose capability if quality is sufficient
        capability = None
        transfer_tests: list[TransferTest] = []
        if best_impl and best_quality > 0.5 and best_render and best_render.accepted:
            cap = self.builder.propose_capability(best_impl, target, genes)
            cap.status = CapabilityStatus.IMPLEMENTED

            # Run transfer test on a different product category
            transfer_test = await self._run_transfer_test(
                cap, best_impl, project, contract)
            transfer_tests.append(transfer_test)
            self.state.total_transfer_tests += 1
            if transfer_test.passed:
                self.state.total_transfer_passes += 1
                cap.transfers_to_other_products = True
                cap.transfer_success_count = 1
                cap.transfer_test_results = [transfer_test.to_dict()]

            # Independent verification
            verified_cap = self.verifier.verify(cap)

            # Archivist accepts only with browser-verified evidence
            if best_render and best_render.accepted:
                accepted_by_archivist, reason = self.archivist.accept_capability(
                    verified_cap, best_render,
                    transfer_tests=transfer_tests,
                    failure_records=all_failures[:10])

                if accepted_by_archivist:
                    # Promote to production if transfer test passed
                    if transfer_test.passed:
                        verified_cap = self.verifier.promote_to_production(verified_cap)
                    self.verified_capability_memory.add(verified_cap)
                    capability = verified_cap

        return {
            "project_id": project.archetype_id,
            "generations_run": gen + 1,
            "best_quality": best_quality,
            "best_impl_id": best_impl.impl_id if best_impl else None,
            "total_renders": len(all_renders),
            "accepted": accepted,
            "rejected": rejected,
            "failures_recorded": len(all_failures),
            "tournaments_run": len(tournament_results),
            "transfer_tests": len(transfer_tests),
            "transfer_passed": sum(1 for t in transfer_tests if t.passed),
            "capability_promoted": capability is not None,
            "capability_id": capability.capability_id if capability else None,
            "stagnated": self.builder.is_stagnant(),
            "builder_stats": self.builder.summary(),
            "judge_stats": self.judge.summary(),
        }

    def _classify_failure(self, reason: str) -> str:
        """Classify a failure reason into a structured failure mode.

        Maps rejection reasons to failure modes using both the reason
        text and the quality axis that triggered the rejection.
        """
        reason_lower = reason.lower()

        # Accessibility failures — hard constraint violations
        if any(k in reason_lower for k in ("accessibility", "wcag", "aria", "contrast", "keyboard")):
            return "accessibility_violation"

        # Performance budget exceeded
        if any(k in reason_lower for k in ("performance", "lcp", "fcp", "tbt", "cls", "budget")):
            return "performance_budget_exceeded"

        # Cross-device instability
        if any(k in reason_lower for k in ("cross-device", "instability", "mobile", "responsive", "layout shift")):
            return "cross_device_instability"

        # Generic identity — looks like any other product
        if any(k in reason_lower for k in ("originality", "generic", "identity", "indistinguishable", "template")):
            return "identity_generic"

        # No measurable improvement over previous generation
        if any(k in reason_lower for k in ("improvement", "delta", "regression", "no improvement", "stagnation")):
            return "no_improvement"

        # Distinction contract failures
        if any(k in reason_lower for k in ("distinction", "contract", "emotion", "spatial signature", "interaction primitive")):
            return "distinction_contract_failed"

        # Depth or motion perceptual failures
        if any(k in reason_lower for k in ("depth", "parallax", "layer", "z-axis")):
            return "depth_lost"
        if any(k in reason_lower for k in ("motion", "animation", "easing", "physics", "janky")):
            return "motion_degraded"

        # Typography failures
        if any(k in reason_lower for k in ("typography", "font", "kerning", "readability")):
            return "typography_mismatch"

        return "unknown"

    def _extract_lesson(self, reason: str) -> str:
        """Extract an actionable lesson from a failure reason.

        Maps the failure to a specific design principle that was violated,
        so future mutations can avoid repeating the same mistake.
        """
        mode = self._classify_failure(reason)

        lessons = {
            "accessibility_violation": "Accessibility is a hard constraint — never sacrifice WCAG compliance for visual effect. Test with screen readers before accepting.",
            "performance_budget_exceeded": "Visual richness must stay within performance budget. Prefer GPU-accelerated transforms over layout-triggering animations. Reduce paint complexity before reducing visual complexity.",
            "cross_device_instability": "Design must be stable across viewport sizes. Test mobile rendering before desktop polish. Use container queries, not fixed pixel widths.",
            "identity_generic": "The design must be unmistakably product-specific. If swapping the product name doesn't break the design, it's too generic. Add product-specific spatial signatures.",
            "no_improvement": "Mutation must produce measurable quality improvement. If delta vs previous is near zero, the mutation axis is exhausted — try a different axis or recombine instead.",
            "distinction_contract_failed": "The distinction contract defines what makes this product unique. Every design decision must trace back to a contract requirement. Reject mutations that don't serve the contract.",
            "depth_lost": "Perceptual depth requires actual layer separation, not just shadows. Verify parallax relationships and z-axis ordering in the browser, not just in code.",
            "motion_degraded": "Motion character must match the benchmark's physics. Janky or robotic motion is worse than no motion. Match easing curves and timing functions precisely.",
            "typography_mismatch": "Typography is a primary identity carrier. Font weight, spacing, and scale must match the benchmark's character, not just the family.",
            "unknown": f"Unclassified failure: {reason[:120]}. Investigate the quality axis breakdown to determine the root cause.",
        }

        return lessons.get(mode, lessons["unknown"])

    def _extract_avoid_pattern(self, reason: str, impl: Implementation) -> str:
        """Extract a concrete pattern to avoid from a failure."""
        mode = self._classify_failure(reason)
        renderer = impl.renderer_type.value if hasattr(impl.renderer_type, 'value') else str(impl.renderer_type)
        mutation = impl.mutation_type or "unknown"

        return f"[{mode}] renderer={renderer} mutation={mutation}: {reason[:150]}"

    async def _run_transfer_test(self, capability: Capability,
                                 impl: Implementation,
                                 original_project: ProjectArchetype,
                                 contract: DistinctionContract) -> TransferTest:
        """Run a transfer test — implement the capability in a different
        product context and verify it still works.

        The winning technique must be tested on a completely different product
        before being promoted to the capability population. This creates a new
        implementation, renders it in the browser lab, and evaluates the result.
        """
        # Pick a different product context
        different_category = "enterprise_saas" if original_project.product_category != "enterprise_saas" else "consumer_ecommerce"
        different_audience = "enterprise_admin" if original_project.audience != "enterprise_admin" else "casual_shopper"
        different_mood = "analytical" if original_project.mood != "analytical" else "playful"

        test = TransferTest(
            capability_id=capability.capability_id,
            target_product_category=different_category,
            target_audience=different_audience,
            target_mood=different_mood,
            transfer_impl_id=impl.impl_id,
        )

        # Create a transfer target in the new product context
        transfer_target = PerceptualTarget(
            benchmark_observation_id=capability.source_observation_id,
            visual_identity=different_mood,
            primary_composition=capability.execution,
            recommended_renderer=impl.renderer_type,
            renderer_rationale="Transfer test — same technique, different context",
        )

        # Create a transfer-specific distinction contract
        transfer_contract = DistinctionContract(
            project_name=f"Transfer Test: {capability.name}",
            project_brief=f"Transfer {capability.recognition} to {different_category}",
            required_emotions=contract.required_emotions,
            spatial_signature=contract.spatial_signature,
            interaction_primitive=contract.interaction_primitive,
            forbidden_cliche=contract.forbidden_cliche,
            typography_doctrine=contract.typography_doctrine,
            motion_doctrine=contract.motion_doctrine,
            density_rule=contract.density_rule,
            unique_feature=contract.unique_feature,
        )

        # Start a new builder project in the transfer context
        transfer_prototypes = self.builder.start_project(
            transfer_target, transfer_contract, f"transfer-{capability.capability_id[:8]}")

        if not transfer_prototypes:
            test.passed = False
            test.failure_reason = "Builder could not create transfer implementation"
            return test

        # Use the first prototype and render it
        transfer_impl = transfer_prototypes[0]
        self.attempt_memory.add_implementation(transfer_impl)

        transfer_render = await self.lab.evaluate_implementation(
            transfer_impl, transfer_target, transfer_contract, None)

        self.attempt_memory.add_render(transfer_render)
        test.transfer_render_id = transfer_render.render_id

        # Evaluate transfer results from actual render data
        q = transfer_render.quality

        test.quality_in_new_context = q.total
        test.identity_preserved = q.product_specific_identity > 0.5
        test.depth_preserved = q.perceptual_depth > 0.45
        test.motion_preserved = q.motion_character_match > 0.45
        test.accessibility_maintained = q.accessibility_audit > 0.7

        # Transfer passes if quality holds and core perceptual properties survive
        test.passed = (
            transfer_render.accepted
            and test.quality_in_new_context > 0.4
            and test.identity_preserved
            and test.accessibility_maintained
            and (test.depth_preserved or test.motion_preserved)
        )

        if not test.passed:
            reasons = []
            if not transfer_render.accepted:
                reasons.append(f"render rejected: {transfer_render.rejected_reason}")
            if not test.identity_preserved:
                reasons.append(f"identity not preserved ({q.product_specific_identity:.3f})")
            if not test.accessibility_maintained:
                reasons.append(f"accessibility dropped ({q.accessibility_audit:.3f})")
            if not test.depth_preserved and not test.motion_preserved:
                reasons.append("both depth and motion lost in transfer")
            test.failure_reason = "; ".join(reasons)

        return test

    # ═══════════════════════════════════════════════════════════
    # Corpus Versioning
    # ═══════════════════════════════════════════════════════════

    def release_corpus(self, version: str = None) -> CorpusManifest:
        """Release a new versioned corpus manifest.

        Each corpus release gets a manifest. Makes skill acquisition
        measurable, reversible and auditable.
        """
        if version is None:
            # Auto-increment version
            parts = self._corpus_version.split(".")
            if len(parts) == 3:
                parts[1] = str(int(parts[1]) + 1)
                version = ".".join(parts)
            else:
                version = "0.1.0"

        self._corpus_version = version

        manifest = CorpusManifest(
            corpus_version=version,
            release_date=_now(),
            source_hashes=[s.source_hash for s in self.observation_memory._sources.values()],
            license_states={s.source_id: s.license_state.value
                           for s in self.observation_memory._sources.values()},
            added_patterns=[g.gene_id for g in self.latent_value_memory.active_genes()],
            retired_patterns=[g.gene_id for g in self.latent_value_memory.retired_genes()],
            trend_velocity=self.scout.trend_detector.summary().get("total_seen", 0),
            oversaturated_patterns=self.scout.get_oversaturated_patterns(),
            evaluation_model="multi_axis_v1",
            total_observations=self.observation_memory.count(),
            total_genes=self.latent_value_memory.count(),
            total_capabilities=self.verified_capability_memory.count(),
            total_verified_capabilities=self.verified_capability_memory.verified_count(),
        )

        self._manifests.append(manifest)
        self.state.current_corpus_version = version
        self.state.last_corpus_release = manifest.release_date
        self.state.verified_capability_count = self.verified_capability_memory.verified_count()
        self.state.failure_count = self.failure_memory.count()
        self.state.saturated_capability_count = len(self.verified_capability_memory.saturated_capabilities())

        return manifest

    # ═══════════════════════════════════════════════════════════
    # Human Preference & Outcome Ledger
    # ═══════════════════════════════════════════════════════════

    def record_preference(self, project_id: str, design_decision: str,
                          user_behavior: str, measured_outcome: str,
                          outcome_metric: str, outcome_value: float,
                          human_preference_score: float = 0.0,
                          context_tags: list[str] = None) -> PreferenceEntry:
        """Record a human preference or outcome observation.

        The real moat is the accumulated relationship between:
            project context × design decision × user behavior × measured outcome
        """
        pref = PreferenceEntry(
            project_id=project_id,
            design_decision=design_decision,
            user_behavior=user_behavior,
            measured_outcome=measured_outcome,
            outcome_metric=outcome_metric,
            outcome_value=outcome_value,
            human_preference_score=human_preference_score,
            context_tags=context_tags or [],
        )
        self.verified_capability_memory.add_preference(pref)
        return pref

    # ═══════════════════════════════════════════════════════════
    # State & Summary
    # ═══════════════════════════════════════════════════════════

    def get_state(self) -> GenomeState:
        """Get current runtime state."""
        self.state.observation_count = self.observation_memory.count()
        self.state.latent_value_count = self.latent_value_memory.active_count()
        self.state.attempt_count = self.attempt_memory.count()
        self.state.verified_capability_count = self.verified_capability_memory.verified_count()
        self.state.failure_count = self.failure_memory.count()
        self.state.frontier_population_count = self.frontier_population.count()
        self.state.candidate_population_count = self.curator.candidate_count()
        self.state.capability_population_count = self.verified_capability_memory.count()
        self.state.failure_population_count = self.failure_memory.count()
        self.state.saturated_capability_count = len(self.verified_capability_memory.saturated_capabilities())
        return self.state

    def summary(self) -> dict[str, Any]:
        """Get a comprehensive summary of the runtime."""
        return {
            "state": self.get_state().to_dict(),
            "scout": self.scout.summary(),
            "curator": self.curator.summary(),
            "oracle": self.oracle.summary(),
            "builder": self.builder.summary(),
            "browser_lab": self.lab.summary(),
            "judge": self.judge.summary(),
            "memories": {
                "observation": self.observation_memory.count(),
                "latent_value_active": self.latent_value_memory.active_count(),
                "latent_value_retired": len(self.latent_value_memory.retired_genes()),
                "attempts": self.attempt_memory.count(),
                "renders": self.attempt_memory.render_count(),
                "verified_capabilities": self.verified_capability_memory.verified_count(),
                "capability_candidates": len(self.verified_capability_memory.candidates()),
                "production_capabilities": len(self.verified_capability_memory.production_capabilities()),
                "saturated_capabilities": len(self.verified_capability_memory.saturated_capabilities()),
                "preferences": len(self.verified_capability_memory.preferences()),
                "failures": self.failure_memory.count(),
                "failure_modes": self.failure_memory.failure_modes(),
                "frontier": self.frontier_population.count(),
            },
            "corpus_version": self._corpus_version,
            "manifests": len(self._manifests),
            "projects": len(self._projects),
            "contracts": len(self._contracts),
        }
