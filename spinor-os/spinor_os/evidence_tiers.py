"""Five-tier evidence hierarchy for SPINOR OS.

Replaces the vague notion of "validated" with five explicit, computable
evidence states.  A SPIN's evidence tier is *computed* from its
accumulated attribution claims — never set by hand.

Tiers (ordered from weakest to strongest):

    OBSERVED
        The event occurred.  No causal claim.

    ASSOCIATED
        The intervention and outcome moved together.  Correlation
        observed but no controls.

    SUPPORTED
        Controls, matching, or repeated observations support
        contribution.  Some confounders addressed.

    EXPERIMENTALLY_DEMONSTRATED
        A credible controlled comparison supports an incremental effect.
        Attribution claim is significant and falsification survived.

    REPLICATED
        The effect survived replication in another eligible person or
        context.  Multiple independent significant claims exist.

The tier is computed by :func:`compute_evidence_tier` from a list of
:class:`~spinor_os.models.AttributionClaim` objects.  The computation
is deterministic: given the same claims, the same tier is always
returned.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from spinor_os.config import OSDefaults, get_logger
from spinor_os.models import AttributionClaim

LOG = get_logger("spinor_os.evidence_tiers")


class EvidenceTier(str, Enum):
    """The five evidence states used everywhere in SPINOR."""

    OBSERVED = "observed"
    ASSOCIATED = "associated"
    SUPPORTED = "supported"
    EXPERIMENTALLY_DEMONSTRATED = "experimentally_demonstrated"
    REPLICATED = "replicated"

    @classmethod
    def from_string(cls, value: str) -> EvidenceTier:
        """Parse a string into an EvidenceTier, raising ValueError on unknown."""
        for tier in cls:
            if tier.value == value:
                return tier
        raise ValueError(f"unknown evidence tier: {value!r}")

    def rank(self) -> int:
        """Return the ordinal rank (0=weakest, 4=strongest)."""
        return list(EvidenceTier).index(self)

    def is_at_least(self, other: EvidenceTier) -> bool:
        """Return True if this tier is at least as strong as ``other``."""
        return self.rank() >= other.rank()


class EvidenceAssessment(BaseModel):
    """The result of computing an evidence tier from attribution claims."""

    model_config = ConfigDict(extra="forbid")

    tier: EvidenceTier
    claim_count: int
    significant_count: int
    replicated_count: int
    avg_confidence: float
    methods_used: list[str] = Field(default_factory=list)
    segments_tested: list[str] = Field(default_factory=list)
    territories_tested: list[str] = Field(default_factory=list)
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")


def compute_evidence_tier(
    claims: list[AttributionClaim],
    required_replications: int = OSDefaults.MIN_REPLICATIONS,
    confidence_threshold: float = OSDefaults.CONFIDENCE_THRESHOLD,
) -> EvidenceAssessment:
    """Compute the evidence tier from a list of attribution claims.

    The computation is deterministic:

    1.  If there are no claims at all → ``OBSERVED``.
    2.  If there are claims but none are significant → ``ASSOCIATED``.
    3.  If there is one significant claim with controls (method is RCT,
        DIFF_IN_DIFF, SYNTHETIC_CONTROL, REGRESSION_DISCONTINUITY, or
        INSTRUMENTAL_VARIABLE) → ``EXPERIMENTALLY_DEMONSTRATED``.
    4.  If there are significant claims but the method is BAYESIAN or
        EXPERT_JUDGMENT only → ``SUPPORTED``.
    5.  If there are >= ``required_replications`` significant claims
        from different testers or segments → ``REPLICATED``.

    Parameters
    ----------
    claims : list[AttributionClaim]
        The attribution claims to assess.
    required_replications : int
        Minimum number of significant claims for the REPLICATED tier.
    confidence_threshold : float
        Minimum confidence for a claim to count as "significant enough".

    Returns
    -------
    EvidenceAssessment
        The computed tier with supporting metadata.
    """
    if not claims:
        return EvidenceAssessment(
            tier=EvidenceTier.OBSERVED,
            claim_count=0,
            significant_count=0,
            replicated_count=0,
            avg_confidence=0.0,
            methods_used=[],
            segments_tested=[],
            territories_tested=[],
            reason="no attribution claims exist yet",
        )

    significant = [c for c in claims if c.is_significant()]
    sig_count = len(significant)

    if sig_count == 0:
        avg_conf = sum(c.confidence for c in claims) / len(claims)
        methods = sorted({c.method.value for c in claims})
        return EvidenceAssessment(
            tier=EvidenceTier.ASSOCIATED,
            claim_count=len(claims),
            significant_count=0,
            replicated_count=0,
            avg_confidence=round(avg_conf, 4),
            methods_used=methods,
            segments_tested=sorted({s for c in claims for s in c.segments}),
            territories_tested=sorted({t for c in claims for t in c.territories}),
            reason="claims exist but none are significant (falsification not survived or confidence too low)",
        )

    # Determine if any significant claim uses a controlled method
    controlled_methods = {
        "rct",
        "diff_in_diff",
        "synthetic_control",
        "regression_discontinuity",
        "instrumental_variable",
    }
    has_controlled = any(c.method.value in controlled_methods for c in significant)
    avg_conf = sum(c.confidence for c in significant) / sig_count

    # Check replication: significant claims from different testers or segments
    testers = {t for c in significant for t in c.tested_by}
    segments = {s for c in significant for s in c.segments}
    territories = {t for c in significant for t in c.territories}
    # Independent contexts = number of distinct (tester, segment) pairs
    # or at minimum the number of distinct testers, whichever is larger.
    # This prevents inflating the count by mixing dimensions.
    independent_contexts = max(len(testers), len(segments))

    methods = sorted({c.method.value for c in significant})

    if sig_count >= required_replications and independent_contexts >= required_replications:
        return EvidenceAssessment(
            tier=EvidenceTier.REPLICATED,
            claim_count=len(claims),
            significant_count=sig_count,
            replicated_count=independent_contexts,
            avg_confidence=round(avg_conf, 4),
            methods_used=methods,
            segments_tested=sorted(segments),
            territories_tested=sorted(territories),
            reason=f"{sig_count} significant claims across {independent_contexts} independent contexts",
        )

    if has_controlled:
        return EvidenceAssessment(
            tier=EvidenceTier.EXPERIMENTALLY_DEMONSTRATED,
            claim_count=len(claims),
            significant_count=sig_count,
            replicated_count=independent_contexts,
            avg_confidence=round(avg_conf, 4),
            methods_used=methods,
            segments_tested=sorted(segments),
            territories_tested=sorted(territories),
            reason=f"{sig_count} significant claim(s) using controlled methods, but not yet replicated in {required_replications} independent contexts",
        )

    return EvidenceAssessment(
        tier=EvidenceTier.SUPPORTED,
        claim_count=len(claims),
        significant_count=sig_count,
        replicated_count=independent_contexts,
        avg_confidence=round(avg_conf, 4),
        methods_used=methods,
        segments_tested=sorted(segments),
        territories_tested=sorted(territories),
        reason=f"{sig_count} significant claim(s) but only observational methods (bayesian/expert), no controlled comparison",
    )
