"""Curator — separates important innovation from fashionable noise.

The Curator sits between the Scout (which discovers) and the Oracle (which
diagnoses). Its job is to filter observations into four populations:

    1. Frontier population — currently live, high-velocity, worth tracking
    2. Candidate population — promising enough to attempt implementation
    3. Capability population — verified, transferable skills (read-only here)
    4. Failure population — documented dead ends (read-only here)

The Curator does NOT evaluate visual quality. It evaluates *signal strength*:
is this observation novel enough, different enough from what we already know,
and structurally rich enough to justify the cost of an implementation attempt?

Popularity discovers attention; it does not determine quality. The Curator
applies adversarial filtering to prevent homogenization.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from dataclasses import dataclass, field
import hashlib

from rxreserve.design_genome import (
    DesignObservation, DesignGene, GeneType, SourceCategory, Capability,
    CapabilityStatus, FailureRecord,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ═══════════════════════════════════════════════════════════════
# Population Membership — which population an observation belongs to
# ═══════════════════════════════════════════════════════════════

class PopulationClass(str, Enum):
    FRONTIER = "frontier"
    CANDIDATE = "candidate"
    CAPABILITY = "capability"
    FAILURE = "failure"
    ARCHIVE = "archive"  # not worth tracking anymore


@dataclass
class PopulationAssignment:
    """The Curator's decision about where an observation belongs."""
    observation_id: str = ""
    population: str = PopulationClass.FRONTIER.value
    reason: str = ""
    signal_strength: float = 0.0
    novelty_vs_corpus: float = 0.0
    structural_richness: float = 0.0
    velocity_score: float = 0.0
    assigned_at: str = field(default_factory=_now)


# ═══════════════════════════════════════════════════════════════
# Signal Strength Estimator
# ═══════════════════════════════════════════════════════════════

class SignalEstimator:
    """Estimates whether an observation has enough signal to justify
    the cost of an implementation attempt.

    The cost of a full render-compare-mutate cycle is significant.
    The Curator must be selective about what enters the candidate population.
    """

    @staticmethod
    def estimate(observation: DesignObservation,
                 genes: list[DesignGene],
                 existing_gene_count: int = 0,
                 saturation_threshold: float = 0.8) -> dict[str, float]:
        """Estimate signal strength across multiple dimensions.

        Returns dict with:
            signal_strength: overall 0-1
            novelty_vs_corpus: how different from what we already have
            structural_richness: how many distinct design axes are present
            velocity_score: how fast this category is changing
        """
        # Novelty: how different from existing corpus
        novelty = observation.novelty_score
        # Penalize if we already have many genes from this category
        corpus_novelty = novelty * max(0.0, 1.0 - existing_gene_count / 200)

        # Structural richness: count distinct gene types AND distinct
        # preserve_attributes — more distinct axes = richer structure
        gene_types = set(g.gene_type for g in genes)
        all_preserve_attrs: set[str] = set()
        for g in genes:
            all_preserve_attrs.update(g.preserve_attributes)
        type_diversity = min(len(gene_types) / 10, 1.0)  # 10+ types = max
        attr_diversity = min(len(all_preserve_attrs) / 15, 1.0)  # 15+ attrs = max
        structural = (type_diversity * 0.6 + attr_diversity * 0.4)

        # Velocity: trend velocity from observation, normalized
        velocity = min(observation.trend_velocity / 10, 1.0)

        # Saturation penalty — if the observation itself reports high
        # saturation, the signal is weaker (everyone is doing this)
        saturation = observation.saturation_score if hasattr(observation, 'saturation_score') else 0.0
        saturation_penalty = 1.0 if saturation < saturation_threshold else 0.3

        # Unusual decisions are strong signal — count and weight them
        unusual_count = len(observation.unusual_design_decisions)
        unusual_boost = min(unusual_count / 5, 1.0) * 0.2

        # Gene principle diversity — are the genes saying different things
        # or just repeating the same principle?
        if genes:
            principles = [g.principle[:100].lower().strip() for g in genes]
            unique_principles = len(set(principles))
            principle_diversity = unique_principles / len(genes)
        else:
            principle_diversity = 0.0

        # Composite signal — weighted by what matters most
        signal = (
            0.30 * corpus_novelty
            + 0.20 * structural
            + 0.15 * velocity
            + 0.15 * saturation_penalty
            + 0.10 * principle_diversity
            + unusual_boost
        )
        signal = max(0.0, min(1.0, signal))

        return {
            "signal_strength": signal,
            "novelty_vs_corpus": corpus_novelty,
            "structural_richness": structural,
            "velocity_score": velocity,
            "principle_diversity": principle_diversity,
        }


# ═══════════════════════════════════════════════════════════════
# Adversarial Filter — prevents homogenization
# ═══════════════════════════════════════════════════════════════

class AdversarialFilter:
    """Ensures the corpus doesn't homogenize around popular patterns.

    The crawler should not merely acquire what is trending. That creates
    another homogenization engine. The filter applies adversarial pressure:

    - Penalize observations from over-represented categories
    - Boost observations from under-represented categories
    - Penalize observations whose genes overlap heavily with existing genes
    - Boost observations with unusual design decisions
    """

    def __init__(self) -> None:
        self._category_counts: dict[str, int] = {}
        self._gene_principle_hashes: set[str] = set()

    def register_genes(self, genes: list[DesignGene]) -> None:
        """Register gene principles for overlap detection."""
        for g in genes:
            h = hashlib.md5(g.principle[:100].encode()).hexdigest()
            self._gene_principle_hashes.add(h)

    def filter(self, observation: DesignObservation,
               genes: list[DesignGene],
               category: SourceCategory) -> dict[str, Any]:
        """Apply adversarial filtering to an observation.

        Returns dict with:
            diversity_bonus: boost for under-represented categories
            overlap_penalty: penalty for overlapping with existing genes
            adversarial_score: adjusted signal after filtering
            verdict: "promote" | "frontier" | "archive"
        """
        cat_key = category.value
        cat_count = self._category_counts.get(cat_key, 0)

        # Diversity bonus: under-represented categories get a boost
        max_cat = max(self._category_counts.values(), default=1)
        diversity_bonus = 1.0 - (cat_count / max(max_cat, 1))
        diversity_bonus = max(0.0, min(0.3, diversity_bonus))

        # Overlap penalty: how many genes overlap with existing
        overlap_count = sum(
            1 for g in genes
            if hashlib.md5(g.principle[:100].encode()).hexdigest() in self._gene_principle_hashes
        )
        overlap_penalty = overlap_count / max(len(genes), 1) if genes else 0.0

        # Unusual decisions boost
        unusual_boost = min(len(observation.unusual_design_decisions) / 5, 1.0) * 0.15

        # Adversarial score
        base_signal = observation.novelty_score
        adversarial = (
            base_signal * (1.0 - overlap_penalty)
            + diversity_bonus
            + unusual_boost
        )
        adversarial = max(0.0, min(1.0, adversarial))

        # Verdict
        if adversarial > 0.5 and overlap_penalty < 0.5:
            verdict = "promote"
        elif adversarial > 0.25:
            verdict = "frontier"
        else:
            verdict = "archive"

        # Update category count
        self._category_counts[cat_key] = cat_count + 1

        return {
            "diversity_bonus": diversity_bonus,
            "overlap_penalty": overlap_penalty,
            "unusual_boost": unusual_boost,
            "adversarial_score": adversarial,
            "verdict": verdict,
        }


# ═══════════════════════════════════════════════════════════════
# Challenge Extractor — turns observations into buildable challenges
# ═══════════════════════════════════════════════════════════════

class ChallengeExtractor:
    """Extracts a buildable challenge from an observation.

    The Curator doesn't just say "this is interesting." It formulates a
    specific, testable challenge:

        "Reproduce the depth layering from observation X using a hybrid
         GPU/DOM renderer, preserving the parallax relationship while
         adapting the content to a different product category."

    This challenge becomes the seed for a Builder tournament.
    """

    @staticmethod
    def extract(observation: DesignObservation,
                genes: list[DesignGene]) -> dict[str, Any]:
        """Extract a buildable challenge from an observation."""
        # Identify the dominant gene type
        gene_type_counts: dict[str, int] = {}
        for g in genes:
            key = g.gene_type.value if hasattr(g.gene_type, 'value') else str(g.gene_type)
            gene_type_counts[key] = gene_type_counts.get(key, 0) + 1

        dominant_type = max(gene_type_counts, key=gene_type_counts.get) if gene_type_counts else "unknown"

        # Formulate challenge
        challenge_parts: list[str] = []

        if dominant_type == "composition":
            challenge_parts.append("Reproduce the spatial composition")
        elif dominant_type == "motion_character":
            challenge_parts.append("Reproduce the motion physics character")
        elif dominant_type == "typography":
            challenge_parts.append("Reproduce the typographic identity layer")
        elif dominant_type == "depth":
            challenge_parts.append("Reproduce the perceptual depth layering")
        elif dominant_type == "color_relationship":
            challenge_parts.append("Reproduce the color relationship structure")
        else:
            challenge_parts.append(f"Reproduce the {dominant_type} principle")

        # Add preservation requirement
        preserve_attrs = []
        for g in genes[:3]:
            preserve_attrs.extend(g.preserve_attributes[:2])
        if preserve_attrs:
            challenge_parts.append(f"preserving {', '.join(set(preserve_attrs[:4]))}")

        # Add adaptation requirement
        challenge_parts.append("adapting content to a different product category")

        challenge_description = "; ".join(challenge_parts)

        # Identify which renderer architectures to try
        renderer_candidates: list[str] = []
        motion_genes = [g for g in genes if g.gene_type == GeneType.MOTION_CHARACTER]
        depth_genes = [g for g in genes if g.gene_type == GeneType.DEPTH]

        renderer_candidates.append("dom_css")
        if any("physics" in g.principle.lower() for g in motion_genes):
            renderer_candidates.append("webgl")
        if any("layer" in g.principle.lower() for g in depth_genes):
            renderer_candidates.append("hybrid_gpu_dom")

        return {
            "challenge_id": f"CHL-{observation.observation_id[:8]}",
            "observation_id": observation.observation_id,
            "challenge_description": challenge_description,
            "dominant_gene_type": dominant_type,
            "gene_count": len(genes),
            "renderer_candidates": renderer_candidates,
            "preserve_attributes": list(set(preserve_attrs[:6])),
            "source_genes": [g.gene_id for g in genes],
        }


# ═══════════════════════════════════════════════════════════════
# Curator — orchestrates population management
# ═══════════════════════════════════════════════════════════════

class Curator:
    """The Curator agent.

    Separates important innovation from fashionable noise. Decides which
    observations enter the candidate population (justifying the cost of
    implementation attempts) and which stay in the frontier population
    (worth tracking but not yet worth building).

    The Curator does NOT evaluate visual quality. It evaluates signal strength
    and diversity. The Oracle evaluates visual quality.
    """

    def __init__(self) -> None:
        self.signal_estimator = SignalEstimator()
        self.adversarial_filter = AdversarialFilter()
        self.challenge_extractor = ChallengeExtractor()
        self._assignments: dict[str, PopulationAssignment] = {}
        self._challenges: dict[str, dict[str, Any]] = {}
        self._frontier: list[str] = []  # observation_ids in frontier
        self._candidates: list[str] = []  # observation_ids promoted to candidate
        self._archived: list[str] = []

    def curate(self, observation: DesignObservation,
               genes: list[DesignGene],
               category: SourceCategory,
               existing_gene_count: int = 0) -> PopulationAssignment:
        """Curate an observation into a population.

        This is the main entry point. The Curator:
        1. Estimates signal strength
        2. Applies adversarial filtering
        3. Assigns to a population
        4. If promoted, extracts a buildable challenge
        """
        # Step 1: Signal estimation
        signals = self.signal_estimator.estimate(
            observation, genes, existing_gene_count)

        # Step 2: Adversarial filtering
        filter_result = self.adversarial_filter.filter(
            observation, genes, category)

        # Register genes for future overlap detection
        self.adversarial_filter.register_genes(genes)

        # Step 3: Population assignment
        combined_score = (
            signals["signal_strength"] * 0.6
            + filter_result["adversarial_score"] * 0.4
        )

        if filter_result["verdict"] == "promote" and combined_score > 0.45:
            population = PopulationClass.CANDIDATE.value
            self._candidates.append(observation.observation_id)

            # Step 4: Extract challenge
            challenge = self.challenge_extractor.extract(observation, genes)
            self._challenges[challenge["challenge_id"]] = challenge

        elif filter_result["verdict"] == "frontier":
            population = PopulationClass.FRONTIER.value
            self._frontier.append(observation.observation_id)

        else:
            population = PopulationClass.ARCHIVE.value
            self._archived.append(observation.observation_id)

        assignment = PopulationAssignment(
            observation_id=observation.observation_id,
            population=population,
            reason=filter_result["verdict"],
            signal_strength=signals["signal_strength"],
            novelty_vs_corpus=signals["novelty_vs_corpus"],
            structural_richness=signals["structural_richness"],
            velocity_score=signals["velocity_score"],
        )
        self._assignments[observation.observation_id] = assignment

        return assignment

    def get_challenge(self, observation_id: str) -> Optional[dict[str, Any]]:
        """Get the buildable challenge for a candidate observation."""
        for challenge in self._challenges.values():
            if challenge["observation_id"] == observation_id:
                return challenge
        return None

    def get_pending_challenges(self) -> list[dict[str, Any]]:
        """Get all challenges that haven't been attempted yet."""
        return list(self._challenges.values())

    def frontier_count(self) -> int:
        return len(self._frontier)

    def candidate_count(self) -> int:
        return len(self._candidates)

    def archived_count(self) -> int:
        return len(self._archived)

    def challenge_count(self) -> int:
        return len(self._challenges)

    def summary(self) -> dict[str, Any]:
        return {
            "frontier_count": self.frontier_count(),
            "candidate_count": self.candidate_count(),
            "archived_count": self.archived_count(),
            "challenge_count": self.challenge_count(),
            "total_assignments": len(self._assignments),
            "category_counts": dict(self.adversarial_filter._category_counts),
        }
