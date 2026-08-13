from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Any, Optional

from rxreserve.models import PharmaFrontier, PriorArtState


# ─── GapSWAT Underwriting Protocol ───
# G — Gap: Prove materiality. G = Impact × Frequency × Unmetness
# S — Strategic Advantage: Why this company could uniquely win
# W — War-Game: Run prosecutors
# A — Attribution: Determine who contributed what
# T — Transform: Magnify survivors

@dataclass
class GapAssessment:
    """G — Gap: Prove materiality."""
    impact: float = 0.0        # economic or patient impact if resolved
    frequency: float = 0.0     # how often this gap causes harm
    unmetness: float = 0.0     # degree to which existing solutions fail

    @property
    def gap_score(self) -> float:
        return self.impact * self.frequency * self.unmetness

    @property
    def is_material(self) -> bool:
        return self.gap_score >= 0.15

    def to_dict(self) -> dict[str, Any]:
        return {
            "impact": self.impact,
            "frequency": self.frequency,
            "unmetness": self.unmetness,
            "gap_score": round(self.gap_score, 4),
            "is_material": self.is_material,
        }


@dataclass
class StrategicAdvantage:
    """S — Strategic Advantage: Why this company could uniquely win."""
    proprietary_data: float = 0.0
    domain_expertise: float = 0.0
    existing_infrastructure: float = 0.0
    regulatory_position: float = 0.0
    distribution: float = 0.0
    relationships: float = 0.0
    manufacturing_assets: float = 0.0

    @property
    def advantage_score(self) -> float:
        scores = [
            self.proprietary_data, self.domain_expertise,
            self.existing_infrastructure, self.regulatory_position,
            self.distribution, self.relationships, self.manufacturing_assets,
        ]
        nonzero = [s for s in scores if s > 0]
        if not nonzero:
            return 0.0
        return sum(nonzero) / len(nonzero)

    def to_dict(self) -> dict[str, Any]:
        return {
            "proprietary_data": self.proprietary_data,
            "domain_expertise": self.domain_expertise,
            "existing_infrastructure": self.existing_infrastructure,
            "regulatory_position": self.regulatory_position,
            "distribution": self.distribution,
            "relationships": self.relationships,
            "manufacturing_assets": self.manufacturing_assets,
            "advantage_score": round(self.advantage_score, 4),
        }


@dataclass
class AttributionAssessment:
    """A — Attribution: Determine who contributed what."""
    employee_observed: str = ""
    employee_originated: str = ""
    ai_generated: str = ""
    collaborators_contributed: str = ""
    existed_independently: str = ""
    would_happen_anyway: str = ""

    @property
    def employee_attribution_strength(self) -> float:
        """How much of the frontier is genuinely attributable to human originators."""
        score = 0.0
        if self.employee_observed and self.employee_observed != "none":
            score += 0.3
        if self.employee_originated and self.employee_originated != "none":
            score += 0.4
        if self.existed_independently == "none" or not self.existed_independently:
            score += 0.15
        if self.would_happen_anyway == "no" or not self.would_happen_anyway:
            score += 0.15
        return min(1.0, score)

    def to_dict(self) -> dict[str, Any]:
        return {
            "employee_observed": self.employee_observed,
            "employee_originated": self.employee_originated,
            "ai_generated": self.ai_generated,
            "collaborators_contributed": self.collaborators_contributed,
            "existed_independently": self.existed_independently,
            "would_happen_anyway": self.would_happen_anyway,
            "employee_attribution_strength": round(self.employee_attribution_strength, 4),
        }


class TransformType(enum.Enum):
    SITE_TO_ENTERPRISE = "site → enterprise"
    WORKFLOW_TO_PLATFORM = "workflow → platform"
    SINGLE_INDICATION_TO_CAPABILITY = "single indication → reusable capability"
    SINGLE_DATASET_TO_PORTFOLIO = "single dataset → portfolio asset"
    WORKAROUND_TO_STANDARD = "workaround → organizational standard"
    NONE = "none"


@dataclass
class TransformAssessment:
    """T — Transform: Magnify survivors."""
    transform_type: TransformType = TransformType.NONE
    magnification_factor: float = 1.0
    description: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "transform_type": self.transform_type.value,
            "magnification_factor": self.magnification_factor,
            "description": self.description,
        }


@dataclass
class GapSWATReport:
    """Complete GapSWAT underwriting report."""
    gap: GapAssessment = field(default_factory=GapAssessment)
    strategic_advantage: StrategicAdvantage = field(default_factory=StrategicAdvantage)
    war_game: list[dict[str, Any]] = field(default_factory=list)
    attribution: AttributionAssessment = field(default_factory=AttributionAssessment)
    transform: TransformAssessment = field(default_factory=TransformAssessment)

    @property
    def underwriting_score(self) -> float:
        """Composite underwriting score."""
        if not self.gap.is_material:
            return 0.0
        return (
            self.gap.gap_score * 0.35
            + self.strategic_advantage.advantage_score * 0.25
            + self.attribution.employee_attribution_strength * 0.20
            + min(1.0, self.transform.magnification_factor / 5.0) * 0.20
        )

    @property
    def passes_gate(self) -> bool:
        """Gate check: gap must be material AND at least some strategic advantage."""
        return self.gap.is_material and self.strategic_advantage.advantage_score >= 0.2

    def to_dict(self) -> dict[str, Any]:
        return {
            "gap": self.gap.to_dict(),
            "strategic_advantage": self.strategic_advantage.to_dict(),
            "war_game": self.war_game,
            "attribution": self.attribution.to_dict(),
            "transform": self.transform.to_dict(),
            "underwriting_score": round(self.underwriting_score, 4),
            "passes_gate": self.passes_gate,
        }


class GapSWATUnderwriter:
    """Runs the GapSWAT underwriting protocol on a PharmaFrontier."""

    def underwrite(
        self,
        frontier: PharmaFrontier,
        gap: Optional[GapAssessment] = None,
        advantage: Optional[StrategicAdvantage] = None,
        attribution: Optional[AttributionAssessment] = None,
        transform: Optional[TransformAssessment] = None,
        war_game_results: Optional[list[dict[str, Any]]] = None,
    ) -> GapSWATReport:
        report = GapSWATReport(
            gap=gap or GapAssessment(),
            strategic_advantage=advantage or StrategicAdvantage(),
            war_game=war_game_results or [],
            attribution=attribution or AttributionAssessment(),
            transform=transform or TransformAssessment(),
        )
        return report
