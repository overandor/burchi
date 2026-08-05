"""Tests for the five-tier evidence hierarchy."""

from __future__ import annotations

import pytest

from spinor_os.evidence_tiers import (
    EvidenceTier,
    EvidenceAssessment,
    compute_evidence_tier,
)
from spinor_os.config import AttributionMethod
from spinor_os.models import AttributionClaim


def make_claim(
    confidence: float = 0.95,
    method: AttributionMethod = AttributionMethod.RCT,
    falsification_survived: bool = True,
    outcome_value: float = 0.2,
    counterfactual: float = 0.05,
    segments: list[str] | None = None,
    tested_by: list[str] | None = None,
) -> AttributionClaim:
    return AttributionClaim(
        experiment_id="EXP-001",
        hypothesis_id="HYP-001",
        outcome_metric="y_rate",
        outcome_value=outcome_value,
        counterfactual_estimate=counterfactual,
        confidence=confidence,
        method=method,
        falsification_survived=falsification_survived,
        segments=segments or ["enterprise"],
        territories=["northeast"],
        tested_by=tested_by or ["emp-001"],
    )


class TestEvidenceTierEnum:
    def test_rank_ordering(self):
        assert EvidenceTier.OBSERVED.rank() == 0
        assert EvidenceTier.REPLICATED.rank() == 4

    def test_is_at_least(self):
        assert EvidenceTier.REPLICATED.is_at_least(EvidenceTier.OBSERVED)
        assert not EvidenceTier.OBSERVED.is_at_least(EvidenceTier.REPLICATED)

    def test_from_string(self):
        assert EvidenceTier.from_string("observed") == EvidenceTier.OBSERVED
        with pytest.raises(ValueError):
            EvidenceTier.from_string("invalid")


class TestComputeEvidenceTier:
    def test_no_claims_yields_observed(self):
        result = compute_evidence_tier([])
        assert result.tier == EvidenceTier.OBSERVED
        assert result.claim_count == 0

    def test_claims_but_none_significant_yields_associated(self):
        claims = [make_claim(falsification_survived=False, confidence=0.3)]
        result = compute_evidence_tier(claims)
        assert result.tier == EvidenceTier.ASSOCIATED
        assert result.significant_count == 0

    def test_significant_with_controlled_method_yields_experimentally_demonstrated(self):
        claims = [make_claim(method=AttributionMethod.RCT)]
        result = compute_evidence_tier(claims)
        assert result.tier == EvidenceTier.EXPERIMENTALLY_DEMONSTRATED
        assert result.significant_count == 1

    def test_significant_with_observational_method_yields_supported(self):
        claims = [make_claim(method=AttributionMethod.EXPERT_JUDGMENT)]
        result = compute_evidence_tier(claims)
        assert result.tier == EvidenceTier.SUPPORTED

    def test_multiple_independent_contexts_yields_replicated(self):
        claims = [
            make_claim(tested_by=["emp-001"], segments=["enterprise"]),
            make_claim(tested_by=["emp-002"], segments=["hospital"]),
            make_claim(tested_by=["emp-003"], segments=["clinic"]),
        ]
        result = compute_evidence_tier(claims, required_replications=3)
        assert result.tier == EvidenceTier.REPLICATED
        assert result.replicated_count >= 3

    def test_two_contexts_not_enough_for_replicated(self):
        claims = [
            make_claim(tested_by=["emp-001"], segments=["enterprise"]),
            make_claim(tested_by=["emp-002"], segments=["hospital"]),
        ]
        result = compute_evidence_tier(claims, required_replications=3)
        assert result.tier == EvidenceTier.EXPERIMENTALLY_DEMONSTRATED
        assert result.replicated_count < 3

    def test_deterministic(self):
        claims = [make_claim(), make_claim(tested_by=["emp-002"], segments=["hospital"])]
        r1 = compute_evidence_tier(claims)
        r2 = compute_evidence_tier(claims)
        assert r1.tier == r2.tier
        assert r1.avg_confidence == r2.avg_confidence

    def test_assessment_to_dict(self):
        result = compute_evidence_tier([])
        d = result.to_dict()
        assert d["tier"] == "observed"
        assert d["claim_count"] == 0
