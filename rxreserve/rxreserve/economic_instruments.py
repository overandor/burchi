"""LAIDER Economic Instruments.

These are not features. They are economic contracts that link a person,
uncertainty, experiment, capital, outcome, attribution and settlement.

The distinction from HR products is that every object here has:
- economic legibility (measurable value)
- provenance (who created it)
- settlement (how value flows back to people)
- optionality (preservation of choices)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from uuid import uuid4


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(prefix: str = "") -> str:
    return f"{prefix}{uuid4().hex[:12]}"


# ═══════════════════════════════════════════════════════════════
# 1. Uncertainty Asset
# ═══════════════════════════════════════════════════════════════

@dataclass
class UncertaintyAsset:
    """Before there is an opportunity, there is an unanswered economically
    relevant question. The asset isn't 'build something' — it's the
    uncertainty being resolved. This lets LAIDER reward someone even
    when the answer is 'No, that doesn't work here.'
    """
    uncertainty_id: str = field(default_factory=lambda: _uid("UNC-"))
    question: str = ""
    affected_process: str = ""
    current_decision: str = ""
    decision_cost: float = 0.0
    evidence_available: str = ""
    confidence_before: float = 0.5
    possible_answers: list[str] = field(default_factory=list)
    value_if_resolved: float = 0.0
    resolution_cost: float = 0.0
    expiry: Optional[str] = None
    owner: str = ""
    witnesses: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=_now)
    state: str = "open"  # open → resolving → resolved → expired

    def to_dict(self) -> dict[str, Any]:
        return {
            "uncertainty_id": self.uncertainty_id,
            "question": self.question,
            "affected_process": self.affected_process,
            "current_decision": self.current_decision,
            "decision_cost": self.decision_cost,
            "evidence_available": self.evidence_available,
            "confidence_before": self.confidence_before,
            "possible_answers": self.possible_answers,
            "value_if_resolved": self.value_if_resolved,
            "resolution_cost": self.resolution_cost,
            "expiry": self.expiry,
            "owner": self.owner,
            "witnesses": self.witnesses,
            "created_at": self.created_at,
            "state": self.state,
        }


# ═══════════════════════════════════════════════════════════════
# 2. Information Value Receipt
# ═══════════════════════════════════════════════════════════════

@dataclass
class InformationValueReceipt:
    """A failed experiment can create positive economic value.

    IV = P(bad decision without experiment) × Loss_avoided

    Now a negative result is economically legible.
    """
    receipt_id: str = field(default_factory=lambda: _uid("IVR-"))
    uncertainty_id: str = ""
    prior_distribution: dict[str, float] = field(default_factory=dict)
    posterior_distribution: dict[str, float] = field(default_factory=dict)
    decision_changed: bool = False
    avoided_commitment: str = ""
    estimated_loss_avoided: float = 0.0
    confidence: float = 0.0
    evidence: str = ""
    experiment_id: str = ""
    created_at: str = field(default_factory=_now)

    @property
    def information_value(self) -> float:
        """IV = P(bad decision) × Loss_avoided"""
        if not self.prior_distribution:
            return 0.0
        p_bad = max(self.prior_distribution.values()) if self.prior_distribution else 0.0
        return p_bad * self.estimated_loss_avoided

    def to_dict(self) -> dict[str, Any]:
        return {
            "receipt_id": self.receipt_id,
            "uncertainty_id": self.uncertainty_id,
            "prior_distribution": self.prior_distribution,
            "posterior_distribution": self.posterior_distribution,
            "decision_changed": self.decision_changed,
            "avoided_commitment": self.avoided_commitment,
            "estimated_loss_avoided": self.estimated_loss_avoided,
            "information_value": self.information_value,
            "confidence": self.confidence,
            "evidence": self.evidence,
            "experiment_id": self.experiment_id,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# 3. Experiment Option (staged options, not monolithic projects)
# ═══════════════════════════════════════════════════════════════

class TrancheStage(str, Enum):
    DISCOVERY = "discovery"
    VALIDATION = "validation"
    PILOT = "pilot"
    EXPANSION = "expansion"
    STANDARDIZATION = "standardization"


@dataclass
class CapitalTranche:
    """Each tranche receives its own budget, criteria, and attribution."""
    tranche_id: str = field(default_factory=lambda: _uid("TRN-"))
    stage: TrancheStage = TrancheStage.DISCOVERY
    budget: float = 0.0
    uncertainty_target: str = ""
    success_criteria: str = ""
    kill_criteria: str = ""
    evidence_requirement: str = ""
    sponsor: str = ""
    employee_ownership: str = ""
    attribution_agreement: str = ""
    status: str = "proposed"  # proposed → funded → running → passed → failed → killed
    actual_spend: float = 0.0
    result: str = ""
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "tranche_id": self.tranche_id,
            "stage": self.stage.value,
            "budget": self.budget,
            "uncertainty_target": self.uncertainty_target,
            "success_criteria": self.success_criteria,
            "kill_criteria": self.kill_criteria,
            "evidence_requirement": self.evidence_requirement,
            "sponsor": self.sponsor,
            "employee_ownership": self.employee_ownership,
            "attribution_agreement": self.attribution_agreement,
            "status": self.status,
            "actual_spend": self.actual_spend,
            "result": self.result,
            "created_at": self.created_at,
        }


@dataclass
class ExperimentOption:
    """O_E = (C_0, X_1, C_1, X_2, C_2, ...)

    Each successful experiment purchases the right, not obligation,
    to spend more capital. This prevents LAIDER from becoming another
    giant-project approval workflow.
    """
    option_id: str = field(default_factory=lambda: _uid("EXP-"))
    uncertainty_id: str = ""
    hypothesis: str = ""
    tranches: list[CapitalTranche] = field(default_factory=list)
    current_tranche_index: int = 0
    status: str = "proposed"  # proposed → active → completed → killed → dormant
    created_at: str = field(default_factory=_now)

    @property
    def current_tranche(self) -> Optional[CapitalTranche]:
        if self.current_tranche_index < len(self.tranches):
            return self.tranches[self.current_tranche_index]
        return None

    def advance(self, result: str = "passed") -> Optional[CapitalTranche]:
        """Advance to next tranche if current passed."""
        ct = self.current_tranche
        if ct:
            ct.status = result
            ct.result = result
        if result == "passed":
            self.current_tranche_index += 1
            if self.current_tranche_index >= len(self.tranches):
                self.status = "completed"
                return None
            self.tranches[self.current_tranche_index].status = "funded"
            return self.tranches[self.current_tranche_index]
        elif result == "failed" or result == "killed":
            self.status = "killed"
            return None
        return ct

    def to_dict(self) -> dict[str, Any]:
        return {
            "option_id": self.option_id,
            "uncertainty_id": self.uncertainty_id,
            "hypothesis": self.hypothesis,
            "tranches": [t.to_dict() for t in self.tranches],
            "current_tranche_index": self.current_tranche_index,
            "current_stage": self.current_tranche.stage.value if self.current_tranche else None,
            "status": self.status,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# 5. Attribution Cap Table
# ═══════════════════════════════════════════════════════════════

@dataclass
class AttributionEntry:
    """A single entry in the cap table. Provenance weights, not necessarily
    compensation percentages. Can change through explicit amendments."""
    role: str = ""  # originator, experiment_designer, builder, domain_expert, etc.
    person: str = ""
    weight: float = 0.0  # percentage as 0-1
    amended: bool = False
    amendment_reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "role": self.role,
            "person": self.person,
            "weight": self.weight,
            "amended": self.amended,
            "amendment_reason": self.amendment_reason,
        }


@dataclass
class AttributionCapTable:
    """Established before the experiment begins.

    Σ_i A_{i,E} = 1

    Realized attributable contribution:
    V_{i,E} = A_{i,E} × V_E
    """
    cap_table_id: str = field(default_factory=lambda: _uid("CAP-"))
    experiment_id: str = ""
    entries: list[AttributionEntry] = field(default_factory=list)
    amendments: list[dict[str, Any]] = field(default_factory=list)
    created_at: str = field(default_factory=_now)

    @property
    def total_weight(self) -> float:
        return sum(e.weight for e in self.entries)

    @property
    def is_balanced(self) -> bool:
        return abs(self.total_weight - 1.0) < 0.001

    def attributable_value(self, person: str, experiment_value: float) -> float:
        """V_{i,E} = A_{i,E} × V_E"""
        for e in self.entries:
            if e.person == person:
                return e.weight * experiment_value
        return 0.0

    def amend(self, person: str, new_weight: float, reason: str) -> None:
        for e in self.entries:
            if e.person == person:
                old = e.weight
                e.weight = new_weight
                e.amended = True
                e.amendment_reason = reason
                self.amendments.append({
                    "person": person,
                    "old_weight": old,
                    "new_weight": new_weight,
                    "reason": reason,
                    "timestamp": _now(),
                })
                return

    def to_dict(self) -> dict[str, Any]:
        return {
            "cap_table_id": self.cap_table_id,
            "experiment_id": self.experiment_id,
            "entries": [e.to_dict() for e in self.entries],
            "total_weight": self.total_weight,
            "is_balanced": self.is_balanced,
            "amendments": self.amendments,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# 6. Attribution Dispute
# ═══════════════════════════════════════════════════════════════

class DisputeState(str, Enum):
    CLAIMED = "claimed"
    CHALLENGED = "challenged"
    EVIDENCE_SUBMITTED = "evidence_submitted"
    REVISED = "revised"
    SETTLED = "settled"


@dataclass
class AttributionClaim:
    """Someone claims a certain contribution percentage."""
    claim_id: str = field(default_factory=lambda: _uid("CLM-"))
    experiment_id: str = ""
    claimant: str = ""
    claimed_weight: float = 0.0
    justification: str = ""
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "claim_id": self.claim_id,
            "experiment_id": self.experiment_id,
            "claimant": self.claimant,
            "claimed_weight": self.claimed_weight,
            "justification": self.justification,
            "created_at": self.created_at,
        }


@dataclass
class AttributionObjection:
    """Someone disputes a claim."""
    objection_id: str = field(default_factory=lambda: _uid("OBJ-"))
    claim_id: str = ""
    objector: str = ""
    reason: str = ""
    proposed_weight: float = 0.0
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "objection_id": self.objection_id,
            "claim_id": self.claim_id,
            "objector": self.objector,
            "reason": self.reason,
            "proposed_weight": self.proposed_weight,
            "created_at": self.created_at,
        }


@dataclass
class AttributionEvidence:
    """Evidence supporting or refuting a claim."""
    evidence_id: str = field(default_factory=lambda: _uid("AEV-"))
    claim_id: str = ""
    submitted_by: str = ""
    evidence_type: str = ""  # commit_log, witness, metric, document, system_log
    content: str = ""
    supports: bool = True
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "evidence_id": self.evidence_id,
            "claim_id": self.claim_id,
            "submitted_by": self.submitted_by,
            "evidence_type": self.evidence_type,
            "content": self.content,
            "supports": self.supports,
            "created_at": self.created_at,
        }


@dataclass
class AttributionSettlement:
    """Human-settled attribution. This produces much better training data
    than silently outputting 'Sarah contributed 42%'."""
    settlement_id: str = field(default_factory=lambda: _uid("STL-"))
    experiment_id: str = ""
    final_weights: dict[str, float] = field(default_factory=dict)
    settled_by: str = ""
    rationale: str = ""
    dispute_history: list[dict[str, Any]] = field(default_factory=list)
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "settlement_id": self.settlement_id,
            "experiment_id": self.experiment_id,
            "final_weights": self.final_weights,
            "settled_by": self.settled_by,
            "rationale": self.rationale,
            "dispute_history": self.dispute_history,
            "created_at": self.created_at,
        }


@dataclass
class AttributionDispute:
    """Full dispute lifecycle: claim → objection → evidence → revision → settlement."""
    dispute_id: str = field(default_factory=lambda: _uid("DSP-"))
    experiment_id: str = ""
    state: DisputeState = DisputeState.CLAIMED
    claims: list[AttributionClaim] = field(default_factory=list)
    objections: list[AttributionObjection] = field(default_factory=list)
    evidence: list[AttributionEvidence] = field(default_factory=list)
    settlement: Optional[AttributionSettlement] = None
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "dispute_id": self.dispute_id,
            "experiment_id": self.experiment_id,
            "state": self.state.value,
            "claims": [c.to_dict() for c in self.claims],
            "objections": [o.to_dict() for o in self.objections],
            "evidence": [e.to_dict() for e in self.evidence],
            "settlement": self.settlement.to_dict() if self.settlement else None,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# 7. Recognition Claim + 8. Recognition Debt
# ═══════════════════════════════════════════════════════════════

@dataclass
class RecognitionClaim:
    """Economic attribution and organizational recognition are different objects.

    A_i = attributed value
    R_i = recognized value

    RecognitionYield_i = R_i / A_i

    Low Recognition Yield means the organizational mechanism converting
    value into career capital is broken.
    """
    claim_id: str = field(default_factory=lambda: _uid("REC-"))
    employee_id: str = ""
    attributed_value: float = 0.0
    recognized_value: float = 0.0
    recognition_type: str = ""  # promotion, title, scope, compensation, exposure
    status: str = "requested"  # requested → granted → denied → partial
    granted_by: str = ""
    rationale: str = ""
    created_at: str = field(default_factory=_now)

    @property
    def recognition_yield(self) -> float:
        if self.attributed_value <= 0:
            return 0.0
        return self.recognized_value / self.attributed_value

    def to_dict(self) -> dict[str, Any]:
        return {
            "claim_id": self.claim_id,
            "employee_id": self.employee_id,
            "attributed_value": self.attributed_value,
            "recognized_value": self.recognized_value,
            "recognition_yield": self.recognition_yield,
            "recognition_type": self.recognition_type,
            "status": self.status,
            "granted_by": self.granted_by,
            "rationale": self.rationale,
            "created_at": self.created_at,
        }


@dataclass
class RecognitionDebt:
    """RecognitionDebt_i = AttributedCareerCapital_i - SettledCareerCapital_i

    Not legally a debt. Economically, the employee/company relationship
    is out of equilibrium.
    """
    debt_id: str = field(default_factory=lambda: _uid("RDB-"))
    employee_id: str = ""
    attributed_career_capital: float = 0.0
    settled_career_capital: float = 0.0
    verified_value_created: float = 0.0
    reusable_systems: int = 0
    cross_team_improvements: int = 0
    current_title: str = ""
    current_scope: str = ""
    current_compensation: float = 0.0
    created_at: str = field(default_factory=_now)

    @property
    def debt(self) -> float:
        return self.attributed_career_capital - self.settled_career_capital

    @property
    def is_in_equilibrium(self) -> bool:
        return abs(self.debt) < 1.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "debt_id": self.debt_id,
            "employee_id": self.employee_id,
            "attributed_career_capital": self.attributed_career_capital,
            "settled_career_capital": self.settled_career_capital,
            "debt": self.debt,
            "is_in_equilibrium": self.is_in_equilibrium,
            "verified_value_created": self.verified_value_created,
            "reusable_systems": self.reusable_systems,
            "cross_team_improvements": self.cross_team_improvements,
            "current_title": self.current_title,
            "current_scope": self.current_scope,
            "current_compensation": self.current_compensation,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# 9. Career Warrant
# ═══════════════════════════════════════════════════════════════

class CareerRight(str, Enum):
    PROGRAM_OWNERSHIP = "program_ownership"
    EXPANDED_SCOPE = "expanded_scope"
    PROMOTION_REVIEW = "promotion_review"
    DIRECT_REPORTS = "direct_reports"
    BUDGET = "budget"
    EXECUTIVE_EXPOSURE = "executive_exposure"
    COMPENSATION_REVIEW = "compensation_review"
    TITLE_REVIEW = "title_review"
    EQUITY_REVIEW = "equity_review"


@dataclass
class WarrantTrigger:
    """A condition that must be met for the warrant to exercise."""
    metric: str = ""
    operator: str = ">="  # >=, <=, ==, !=
    threshold: float = 0.0
    description: str = ""

    def evaluate(self, actual: float) -> bool:
        if self.operator == ">=":
            return actual >= self.threshold
        elif self.operator == "<=":
            return actual <= self.threshold
        elif self.operator == "==":
            return abs(actual - self.threshold) < 0.001
        elif self.operator == "!=":
            return abs(actual - self.threshold) >= 0.001
        return False

    def to_dict(self) -> dict[str, Any]:
        return {
            "metric": self.metric,
            "operator": self.operator,
            "threshold": self.threshold,
            "description": self.description,
        }


@dataclass
class CareerWarrant:
    """IF trigger conditions met THEN career right is proposed.

    W = (Trigger, CareerRight)

    Career outcomes can become conditionally specified before
    employees assume exceptional project risk.
    """
    warrant_id: str = field(default_factory=lambda: _uid("WRN-"))
    employee_id: str = ""
    experiment_id: str = ""
    triggers: list[WarrantTrigger] = field(default_factory=list)
    career_right: CareerRight = CareerRight.PROMOTION_REVIEW
    status: str = "proposed"  # proposed → approved → triggered → exercised → expired
    approved_by: str = ""
    exercised_at: Optional[str] = None
    created_at: str = field(default_factory=_now)

    def check_triggers(self, metrics: dict[str, float]) -> bool:
        """Check if all triggers are met."""
        for t in self.triggers:
            actual = metrics.get(t.metric, 0.0)
            if not t.evaluate(actual):
                return False
        return True

    def to_dict(self) -> dict[str, Any]:
        return {
            "warrant_id": self.warrant_id,
            "employee_id": self.employee_id,
            "experiment_id": self.experiment_id,
            "triggers": [t.to_dict() for t in self.triggers],
            "career_right": self.career_right.value,
            "status": self.status,
            "approved_by": self.approved_by,
            "exercised_at": self.exercised_at,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# 10. Reusable Primitive + 11. Provenance Dividend
# ═══════════════════════════════════════════════════════════════

@dataclass
class ReusablePrimitive:
    """Sarah invents a pattern for Customer Success.
    It gets reused by HR, Legal, Procurement, Clinical Ops, Finance.

    Sarah shouldn't need to personally execute all five implementations.
    """
    primitive_id: str = field(default_factory=lambda: _uid("PRM-"))
    origin_experiment: str = ""
    originators: list[str] = field(default_factory=list)
    abstraction: str = ""
    implementation: str = ""
    constraints: list[str] = field(default_factory=list)
    demonstrated_domains: list[str] = field(default_factory=list)
    downstream_derivatives: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "primitive_id": self.primitive_id,
            "origin_experiment": self.origin_experiment,
            "originators": self.originators,
            "abstraction": self.abstraction,
            "implementation": self.implementation,
            "constraints": self.constraints,
            "demonstrated_domains": self.demonstrated_domains,
            "downstream_derivatives": self.downstream_derivatives,
            "created_at": self.created_at,
        }


@dataclass
class ProvenanceDividend:
    """PD_i = Σ_j w_{ij} × V_j

    Every downstream derivative pushes some career credit upstream.
    People benefit from creating systems other people can use.
    """
    dividend_id: str = field(default_factory=lambda: _uid("PVD-"))
    employee_id: str = ""
    primitive_id: str = ""
    downstream_implementations: list[dict[str, Any]] = field(default_factory=list)
    total_dividend: float = 0.0
    created_at: str = field(default_factory=_now)

    def compute(self) -> float:
        """PD_i = Σ_j w_{ij} × V_j"""
        total = 0.0
        for impl in self.downstream_implementations:
            w = impl.get("weight", 0.0)
            v = impl.get("value", 0.0)
            total += w * v
        self.total_dividend = total
        return total

    def to_dict(self) -> dict[str, Any]:
        self.compute()
        return {
            "dividend_id": self.dividend_id,
            "employee_id": self.employee_id,
            "primitive_id": self.primitive_id,
            "downstream_implementations": self.downstream_implementations,
            "total_dividend": self.total_dividend,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# 12. Kill Credit
# ═══════════════════════════════════════════════════════════════

@dataclass
class KillReceipt:
    """Employees need credit for stopping bad investments.

    Otherwise everybody learns that creating projects produces visibility
    while killing bad projects produces nothing. That is organizational Goodhart.
    """
    kill_id: str = field(default_factory=lambda: _uid("KIL-"))
    proposed_project: str = ""
    employee_objection: str = ""
    evidence: str = ""
    experiment_id: str = ""
    result: str = ""  # confirmed_bad, not_needed, better_alternative
    investment_prevented: float = 0.0
    estimated_loss_avoided: float = 0.0
    employee_id: str = ""
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kill_id": self.kill_id,
            "proposed_project": self.proposed_project,
            "employee_objection": self.employee_objection,
            "evidence": self.evidence,
            "experiment_id": self.experiment_id,
            "result": self.result,
            "investment_prevented": self.investment_prevented,
            "estimated_loss_avoided": self.estimated_loss_avoided,
            "employee_id": self.employee_id,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# 13. Challenger Market + 14. Internal Short Thesis
# ═══════════════════════════════════════════════════════════════

@dataclass
class ChallengeCase:
    """Bull case, bear case, counterfactual, alternative, cheaper experiment,
    fatal assumption. A challenger who disproves a high-cost idea creates
    information value. Both origination and falsification produce career capital.
    """
    challenge_id: str = field(default_factory=lambda: _uid("CHL-"))
    proposal_id: str = ""
    challenger: str = ""
    challenge_type: str = ""  # bull, bear, counterfactual, alternative, cheaper, fatal_assumption
    content: str = ""
    evidence: str = ""
    falsifiable_test: str = ""
    status: str = "submitted"  # submitted → validated → refuted → confirmed
    information_value: float = 0.0
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "challenge_id": self.challenge_id,
            "proposal_id": self.proposal_id,
            "challenger": self.challenger,
            "challenge_type": self.challenge_type,
            "content": self.content,
            "evidence": self.evidence,
            "falsifiable_test": self.falsifiable_test,
            "status": self.status,
            "information_value": self.information_value,
            "created_at": self.created_at,
        }


@dataclass
class InternalShortThesis:
    """Not literally financial shorting. An employee submits:

    'Initiative X is unlikely to produce the expected ROI because
    assumption Y is wrong.'

    Then specifies a falsifiable test. If correct, that employee gets
    uncertainty-resolution credit. This produces an internal
    prediction/error-correction mechanism.
    """
    thesis_id: str = field(default_factory=lambda: _uid("SHT-"))
    target_initiative: str = ""
    author: str = ""
    thesis: str = ""
    flawed_assumption: str = ""
    falsifiable_test: str = ""
    test_result: Optional[bool] = None  # None=pending, True=thesis correct, False=incorrect
    loss_avoided: float = 0.0
    status: str = "open"  # open → testing → confirmed → refuted → settled
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "thesis_id": self.thesis_id,
            "target_initiative": self.target_initiative,
            "author": self.author,
            "thesis": self.thesis,
            "flawed_assumption": self.flawed_assumption,
            "falsifiable_test": self.falsifiable_test,
            "test_result": self.test_result,
            "loss_avoided": self.loss_avoided,
            "status": self.status,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# 16. Derivative Opportunity
# ═══════════════════════════════════════════════════════════════

@dataclass
class DerivativeOpportunity:
    """The Magnifier needs its own canonical object.

    Experiment E1 → Primitive P1 → E2, E3, E4, E5

    This produces the recursion.
    """
    derivative_id: str = field(default_factory=lambda: _uid("DER-"))
    parent_experiment: str = ""
    primitive_id: str = ""
    target_context: str = ""
    similarity: float = 0.0
    changed_constraints: list[str] = field(default_factory=list)
    expected_transferability: float = 0.0
    new_uncertainties: list[str] = field(default_factory=list)
    owner_candidates: list[str] = field(default_factory=list)
    expected_value: float = 0.0
    status: str = "identified"  # identified → underwritten → active → completed → dormant
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "derivative_id": self.derivative_id,
            "parent_experiment": self.parent_experiment,
            "primitive_id": self.primitive_id,
            "target_context": self.target_context,
            "similarity": self.similarity,
            "changed_constraints": self.changed_constraints,
            "expected_transferability": self.expected_transferability,
            "new_uncertainties": self.new_uncertainties,
            "owner_candidates": self.owner_candidates,
            "expected_value": self.expected_value,
            "status": self.status,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# 15. Dormant Option (enhanced reactivation)
# ═══════════════════════════════════════════════════════════════

@dataclass
class DormantOption:
    """Not REJECTED. DORMANT with reactivation predicates.

    External or internal state changes automatically reactivate opportunities.
    This is vastly better organizational memory.
    """
    option_id: str = field(default_factory=lambda: _uid("DOR-"))
    original_proposal: str = ""
    reason_dormant: str = ""
    reactivation_predicates: list[dict[str, Any]] = field(default_factory=list)
    status: str = "dormant"  # dormant → reactivated → expired
    created_at: str = field(default_factory=_now)
    last_checked: str = field(default_factory=_now)

    def check_reactivation(self, current_state: dict[str, Any]) -> bool:
        """Check if any reactivation predicate is satisfied."""
        for pred in self.reactivation_predicates:
            metric = pred.get("metric", "")
            operator = pred.get("operator", ">=")
            threshold = pred.get("threshold", 0)
            actual = current_state.get(metric, None)
            if actual is None:
                continue
            if operator == ">=" and actual >= threshold:
                return True
            elif operator == "<=" and actual <= threshold:
                return True
            elif operator == "==" and abs(actual - threshold) < 0.001:
                return True
            elif operator == "!=" and abs(actual - threshold) >= 0.001:
                return True
        return False

    def to_dict(self) -> dict[str, Any]:
        return {
            "option_id": self.option_id,
            "original_proposal": self.original_proposal,
            "reason_dormant": self.reason_dormant,
            "reactivation_predicates": self.reactivation_predicates,
            "status": self.status,
            "created_at": self.created_at,
            "last_checked": self.last_checked,
        }
