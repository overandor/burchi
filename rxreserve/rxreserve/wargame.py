from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from rxreserve.models import PharmaFrontier, PriorArtState


# ─── Adversarial War-Game Prosecutors ───
# W — War-Game: Run prosecutors

@dataclass
class ProsecutionResult:
    prosecutor: str
    verdict: str  # pass, fail, conditional
    severity: float  # 0.0 = no concern, 1.0 = fatal
    reasoning: str = ""
    conditions: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "prosecutor": self.prosecutor,
            "verdict": self.verdict,
            "severity": round(self.severity, 4),
            "reasoning": self.reasoning,
            "conditions": self.conditions,
        }


class BaseProsecutor:
    """Abstract base for adversarial prosecutors."""
    name: str = ""

    def prosecute(self, frontier: PharmaFrontier) -> ProsecutionResult:
        raise NotImplementedError


class ScientificProsecutor(BaseProsecutor):
    """Challenges scientific validity of the hypothesis."""
    name = "Scientific Prosecutor"

    def prosecute(self, frontier: PharmaFrontier) -> ProsecutionResult:
        severity = 0.0
        conditions = []

        if not frontier.source_evidence:
            severity = 0.7
            conditions.append("No source evidence provided")
        elif len(frontier.source_evidence) < 2:
            severity = 0.3
            conditions.append("Only one source — insufficient for scientific claim")

        if not frontier.evidence_envelope.human_verification:
            severity = max(severity, 0.4)
            conditions.append("Human verification of evidence not confirmed")

        if not frontier.unknowns:
            severity = max(severity, 0.5)
            conditions.append("No explicit unknowns stated — what exactly is being tested?")

        verdict = "fail" if severity >= 0.7 else "conditional" if severity >= 0.3 else "pass"
        return ProsecutionResult(
            prosecutor=self.name, verdict=verdict, severity=severity,
            reasoning="Challenges scientific validity of evidence and hypothesis formulation",
            conditions=conditions,
        )


class RegulatoryProsecutor(BaseProsecutor):
    """Challenges regulatory feasibility."""
    name = "Regulatory Prosecutor"

    def prosecute(self, frontier: PharmaFrontier) -> ProsecutionResult:
        severity = 0.0
        conditions = []

        if not frontier.regulatory_domain:
            severity = 0.6
            conditions.append("Regulatory domain not specified — cannot assess feasibility")
        elif frontier.regulatory_domain.lower() in ("gcp", "gmp", "glp", "gvp"):
            conditions.append(f"Regulated under {frontier.regulatory_domain} — requires validated evidence")
        elif frontier.regulatory_domain.lower() == "none":
            severity = 0.2
            conditions.append("Claims no regulatory domain — verify this is accurate")

        if frontier.rights_envelope.external_disclosure_allowed and not frontier.rights_envelope.patent_review_required:
            severity = max(severity, 0.5)
            conditions.append("External disclosure allowed without patent review — regulatory risk")

        verdict = "fail" if severity >= 0.6 else "conditional" if severity >= 0.3 else "pass"
        return ProsecutionResult(
            prosecutor=self.name, verdict=verdict, severity=severity,
            reasoning="Challenges regulatory feasibility and compliance posture",
            conditions=conditions,
        )


class PatientSafetyProsecutor(BaseProsecutor):
    """Challenges patient safety implications."""
    name = "Patient-Safety Prosecutor"

    def prosecute(self, frontier: PharmaFrontier) -> ProsecutionResult:
        severity = 0.0
        conditions = []

        if not frontier.quality_patient_consequence:
            severity = 0.4
            conditions.append("Patient/quality consequence not assessed")
        elif "risk" in frontier.quality_patient_consequence.lower():
            severity = 0.3
            conditions.append("Patient risk identified — requires safety monitoring plan")

        if not frontier.current_workaround:
            severity = max(severity, 0.2)
            conditions.append("Current workaround not documented — what are patients doing now?")

        verdict = "fail" if severity >= 0.6 else "conditional" if severity >= 0.3 else "pass"
        return ProsecutionResult(
            prosecutor=self.name, verdict=verdict, severity=severity,
            reasoning="Challenges patient safety implications and quality consequences",
            conditions=conditions,
        )


class IPProsecutor(BaseProsecutor):
    """Challenges IP position and inventorship."""
    name = "IP Prosecutor"

    def prosecute(self, frontier: PharmaFrontier) -> ProsecutionResult:
        severity = 0.0
        conditions = []

        if frontier.prior_art_state == PriorArtState.ALREADY_PATENTED:
            severity = 0.8
            conditions.append("Already patented — freedom to operate unclear")
        elif frontier.prior_art_state == PriorArtState.COMMODITIZED:
            severity = 0.6
            conditions.append("Approach is commoditized — limited IP protection available")
        elif frontier.prior_art_state == PriorArtState.OVERLAPPING:
            severity = 0.4
            conditions.append("Overlapping prior art — requires FTO analysis")

        if not frontier.contribution_envelope.human_originators:
            severity = max(severity, 0.7)
            conditions.append("No human originators identified — inventorship cannot be established")

        if frontier.rights_envelope.rights_owner.value == "unresolved":
            severity = max(severity, 0.5)
            conditions.append("Rights ownership unresolved — cannot proceed to contract")

        verdict = "fail" if severity >= 0.7 else "conditional" if severity >= 0.3 else "pass"
        return ProsecutionResult(
            prosecutor=self.name, verdict=verdict, severity=severity,
            reasoning="Challenges IP position, inventorship, and freedom to operate",
            conditions=conditions,
        )


class FinanceProsecutor(BaseProsecutor):
    """Challenges economic viability."""
    name = "Finance Prosecutor"

    def prosecute(self, frontier: PharmaFrontier) -> ProsecutionResult:
        severity = 0.0
        conditions = []

        if frontier.cost_of_learning <= 0:
            severity = 0.5
            conditions.append("Cost of learning not estimated")
        elif frontier.cost_of_learning > frontier.maximum_upside * 0.5:
            severity = 0.4
            conditions.append("Cost of learning exceeds 50% of maximum upside — poor risk/reward")

        if frontier.maximum_upside <= 0:
            severity = max(severity, 0.6)
            conditions.append("Maximum upside not quantified")

        if not frontier.economic_consequence:
            severity = max(severity, 0.3)
            conditions.append("Economic consequence not described")

        verdict = "fail" if severity >= 0.6 else "conditional" if severity >= 0.3 else "pass"
        return ProsecutionResult(
            prosecutor=self.name, verdict=verdict, severity=severity,
            reasoning="Challenges economic viability and capital efficiency",
            conditions=conditions,
        )


class AdoptionProsecutor(BaseProsecutor):
    """Challenges likelihood of real-world adoption."""
    name = "Adoption Prosecutor"

    def prosecute(self, frontier: PharmaFrontier) -> ProsecutionResult:
        severity = 0.0
        conditions = []

        if not frontier.current_workaround:
            severity = 0.3
            conditions.append("Current workaround unknown — cannot assess switching cost")

        if "manual" in (frontier.current_workaround or "").lower():
            conditions.append("Current workaround is manual — adoption may face resistance")

        if not frontier.candidate_experiments:
            severity = max(severity, 0.4)
            conditions.append("No candidate experiments proposed — how will this be validated?")

        verdict = "fail" if severity >= 0.6 else "conditional" if severity >= 0.3 else "pass"
        return ProsecutionResult(
            prosecutor=self.name, verdict=verdict, severity=severity,
            reasoning="Challenges real-world adoption likelihood and switching costs",
            conditions=conditions,
        )


class DataProsecutor(BaseProsecutor):
    """Challenges data quality and availability."""
    name = "Data Prosecutor"

    def prosecute(self, frontier: PharmaFrontier) -> ProsecutionResult:
        severity = 0.0
        conditions = []

        if not frontier.evidence_envelope.source_system:
            severity = 0.4
            conditions.append("Source system not identified — data provenance unclear")

        if frontier.evidence_envelope.confidence < 0.5:
            severity = max(severity, 0.5)
            conditions.append(f"Evidence confidence is low ({frontier.evidence_envelope.confidence:.0%})")

        if not frontier.evidence_envelope.supporting_evidence:
            severity = max(severity, 0.3)
            conditions.append("No supporting evidence items provided")

        verdict = "fail" if severity >= 0.6 else "conditional" if severity >= 0.3 else "pass"
        return ProsecutionResult(
            prosecutor=self.name, verdict=verdict, severity=severity,
            reasoning="Challenges data quality, provenance, and sufficiency",
            conditions=conditions,
        )


class AISubstitutionProsecutor(BaseProsecutor):
    """Challenges whether AI could simply replace the entire approach."""
    name = "AI-Substitution Prosecutor"

    def prosecute(self, frontier: PharmaFrontier) -> ProsecutionResult:
        severity = 0.0
        conditions = []

        if frontier.ai_contribution and "fully" in frontier.ai_contribution.lower():
            severity = 0.5
            conditions.append("AI contribution described as 'fully' — human attribution at risk")

        if not frontier.contribution_envelope.human_modifications:
            severity = max(severity, 0.3)
            conditions.append("No human modifications to AI output — human inventorship questionable")

        if not frontier.contribution_envelope.human_selection:
            severity = max(severity, 0.4)
            conditions.append("No human selection from AI candidates — who chose this direction?")

        verdict = "fail" if severity >= 0.6 else "conditional" if severity >= 0.3 else "pass"
        return ProsecutionResult(
            prosecutor=self.name, verdict=verdict, severity=severity,
            reasoning="Challenges whether AI could replace the approach and whether human inventorship is genuine",
            conditions=conditions,
        )


# ─── War-Game Orchestrator ───

class WarGame:
    """Runs all 8 prosecutors against a frontier."""

    def __init__(self):
        self.prosecutors: list[BaseProsecutor] = [
            ScientificProsecutor(),
            RegulatoryProsecutor(),
            PatientSafetyProsecutor(),
            IPProsecutor(),
            FinanceProsecutor(),
            AdoptionProsecutor(),
            DataProsecutor(),
            AISubstitutionProsecutor(),
        ]

    def run(self, frontier: PharmaFrontier) -> list[ProsecutionResult]:
        return [p.prosecute(frontier) for p in self.prosecutors]

    def summary(self, results: list[ProsecutionResult]) -> dict[str, Any]:
        fails = [r for r in results if r.verdict == "fail"]
        conditionals = [r for r in results if r.verdict == "conditional"]
        passes = [r for r in results if r.verdict == "pass"]
        max_severity = max(r.severity for r in results) if results else 0.0

        if fails:
            overall = "REJECTED"
        elif conditionals:
            overall = "CONDITIONAL — address conditions before proceeding"
        else:
            overall = "CLEARED"

        return {
            "overall_verdict": overall,
            "passes": len(passes),
            "conditionals": len(conditionals),
            "fails": len(fails),
            "max_severity": round(max_severity, 4),
            "results": [r.to_dict() for r in results],
        }
