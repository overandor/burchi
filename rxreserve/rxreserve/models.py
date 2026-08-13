from __future__ import annotations

import enum
import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4


# ─── State Machines ───

class FrontierState(enum.Enum):
    SIGNAL = "SIGNAL"
    FRONTIER_IDENTIFIED = "FRONTIER_IDENTIFIED"
    PRESERVED = "PRESERVED"
    CANONICALIZED = "CANONICALIZED"
    RIGHTS_DETERMINED = "RIGHTS_DETERMINED"
    GAP_VERIFIED = "GAP_VERIFIED"
    PRIOR_ART_ASSESSED = "PRIOR_ART_ASSESSED"
    ADVERSARIALLY_UNDERWRITTEN = "ADVERSARIALLY_UNDERWRITTEN"
    EXPERIMENT_CONTRACTED = "EXPERIMENT_CONTRACTED"
    SPONSORED = "SPONSORED"
    PILOT_RUNNING = "PILOT_RUNNING"
    OUTCOME_OBSERVED = "OUTCOME_OBSERVED"
    EVIDENCE_ADMISSIBLE = "EVIDENCE_ADMISSIBLE"
    VALUE_VERIFIED = "VALUE_VERIFIED"
    ATTRIBUTION_VERIFIED = "ATTRIBUTION_VERIFIED"
    REWARD_VESTED = "REWARD_VESTED"
    EMPLOYEE_SETTLED = "EMPLOYEE_SETTLED"
    REUSABLE_ASSET = "REUSABLE_ASSET"
    DORMANT_OPTION = "DORMANT_OPTION"
    CONDITION_MONITORING = "CONDITION_MONITORING"
    REACTIVATED = "REACTIVATED"


VALID_TRANSITIONS: dict[FrontierState, list[FrontierState]] = {
    FrontierState.SIGNAL: [FrontierState.FRONTIER_IDENTIFIED],
    FrontierState.FRONTIER_IDENTIFIED: [FrontierState.PRESERVED],
    FrontierState.PRESERVED: [FrontierState.CANONICALIZED],
    FrontierState.CANONICALIZED: [FrontierState.RIGHTS_DETERMINED, FrontierState.DORMANT_OPTION],
    FrontierState.RIGHTS_DETERMINED: [FrontierState.GAP_VERIFIED, FrontierState.DORMANT_OPTION],
    FrontierState.GAP_VERIFIED: [FrontierState.PRIOR_ART_ASSESSED, FrontierState.DORMANT_OPTION],
    FrontierState.PRIOR_ART_ASSESSED: [FrontierState.ADVERSARIALLY_UNDERWRITTEN, FrontierState.DORMANT_OPTION],
    FrontierState.ADVERSARIALLY_UNDERWRITTEN: [FrontierState.EXPERIMENT_CONTRACTED, FrontierState.DORMANT_OPTION],
    FrontierState.EXPERIMENT_CONTRACTED: [FrontierState.SPONSORED],
    FrontierState.SPONSORED: [FrontierState.PILOT_RUNNING],
    FrontierState.PILOT_RUNNING: [FrontierState.OUTCOME_OBSERVED],
    FrontierState.OUTCOME_OBSERVED: [FrontierState.EVIDENCE_ADMISSIBLE, FrontierState.DORMANT_OPTION],
    FrontierState.EVIDENCE_ADMISSIBLE: [FrontierState.VALUE_VERIFIED, FrontierState.DORMANT_OPTION],
    FrontierState.VALUE_VERIFIED: [FrontierState.ATTRIBUTION_VERIFIED],
    FrontierState.ATTRIBUTION_VERIFIED: [FrontierState.REWARD_VESTED],
    FrontierState.REWARD_VESTED: [FrontierState.EMPLOYEE_SETTLED],
    FrontierState.EMPLOYEE_SETTLED: [FrontierState.REUSABLE_ASSET],
    FrontierState.REUSABLE_ASSET: [],
    FrontierState.DORMANT_OPTION: [FrontierState.CONDITION_MONITORING],
    FrontierState.CONDITION_MONITORING: [FrontierState.REACTIVATED, FrontierState.DORMANT_OPTION],
    FrontierState.REACTIVATED: [FrontierState.CANONICALIZED, FrontierState.EXPERIMENT_CONTRACTED, FrontierState.PILOT_RUNNING],
}


class SettlementState(enum.Enum):
    NO_RIGHT = "NO_RIGHT"
    PROPOSED_RIGHT = "PROPOSED_RIGHT"
    SIGNED_CONDITIONAL_RIGHT = "SIGNED_CONDITIONAL_RIGHT"
    MILESTONE_EARNED = "MILESTONE_EARNED"
    VERIFICATION_PENDING = "VERIFICATION_PENDING"
    VESTED_RECEIVABLE = "VESTED_RECEIVABLE"
    PAID = "PAID"


SETTLEMENT_TRANSITIONS: dict[SettlementState, list[SettlementState]] = {
    SettlementState.NO_RIGHT: [SettlementState.PROPOSED_RIGHT],
    SettlementState.PROPOSED_RIGHT: [SettlementState.SIGNED_CONDITIONAL_RIGHT],
    SettlementState.SIGNED_CONDITIONAL_RIGHT: [SettlementState.MILESTONE_EARNED],
    SettlementState.MILESTONE_EARNED: [SettlementState.VERIFICATION_PENDING],
    SettlementState.VERIFICATION_PENDING: [SettlementState.VESTED_RECEIVABLE],
    SettlementState.VESTED_RECEIVABLE: [SettlementState.PAID],
    SettlementState.PAID: [],
}


class RightsOwner(enum.Enum):
    EMPLOYEE = "employee"
    EMPLOYER = "employer"
    JOINT = "joint"
    ASSIGNED = "assigned"
    UNRESOLVED = "unresolved"


class ConfidentialityLevel(enum.Enum):
    PUBLIC = "public"
    INTERNAL = "internal"
    CONFIDENTIAL = "confidential"
    TRADE_SECRET_CANDIDATE = "trade_secret_candidate"
    PRIVILEGED = "privileged"


class PriorArtState(enum.Enum):
    NEW = "new"
    OVERLAPPING = "overlapping"
    ALREADY_ATTEMPTED = "already_attempted"
    ALREADY_PATENTED = "already_patented"
    COMMODITIZED = "commoditized"


# ─── Four Immutable Envelopes ───

@dataclass
class EvidenceEnvelope:
    """A. Evidence Envelope — what authorized data proves the gap?"""
    source_signal: str = ""
    source_hash: str = ""
    timestamp: str = ""
    source_system: str = ""
    employee_observation: str = ""
    supporting_evidence: list[dict[str, Any]] = field(default_factory=list)
    extraction_method: str = ""
    confidence: float = 0.0
    human_verification: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_signal": self.source_signal,
            "source_hash": self.source_hash,
            "timestamp": self.timestamp,
            "source_system": self.source_system,
            "employee_observation": self.employee_observation,
            "supporting_evidence": self.supporting_evidence,
            "extraction_method": self.extraction_method,
            "confidence": self.confidence,
            "human_verification": self.human_verification,
        }


@dataclass
class ContributionEnvelope:
    """B. Contribution Envelope — who contributed what?

    USPTO treats AI as a tool; inventorship belongs to natural persons.
    """
    human_originators: list[str] = field(default_factory=list)
    human_contribution: str = ""
    ai_generated_candidates: list[str] = field(default_factory=list)
    human_selection: str = ""
    human_modifications: str = ""
    collaborator_contributions: list[dict[str, str]] = field(default_factory=list)
    experiment_design_contribution: str = ""
    execution_contribution: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "human_originators": self.human_originators,
            "human_contribution": self.human_contribution,
            "ai_generated_candidates": self.ai_generated_candidates,
            "human_selection": self.human_selection,
            "human_modifications": self.human_modifications,
            "collaborator_contributions": self.collaborator_contributions,
            "experiment_design_contribution": self.experiment_design_contribution,
            "execution_contribution": self.execution_contribution,
        }


@dataclass
class RightsEnvelope:
    """C. Rights Envelope — cannot be reduced to employee_owns=true/false.

    WIPO shows materially different employee-invention ownership and
    remuneration regimes across jurisdictions.
    """
    rights_owner: RightsOwner = RightsOwner.UNRESOLVED
    inventor_status: str = ""
    assignment_obligation: str = ""
    governing_agreement: str = ""
    jurisdiction: str = ""
    confidentiality: ConfidentialityLevel = ConfidentialityLevel.CONFIDENTIAL
    external_disclosure_allowed: bool = False
    patent_review_required: bool = True
    employee_reward_rights: str = ""
    transferability: str = ""
    rights_confidence: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "rights_owner": self.rights_owner.value,
            "inventor_status": self.inventor_status,
            "assignment_obligation": self.assignment_obligation,
            "governing_agreement": self.governing_agreement,
            "jurisdiction": self.jurisdiction,
            "confidentiality": self.confidentiality.value,
            "external_disclosure_allowed": self.external_disclosure_allowed,
            "patent_review_required": self.patent_review_required,
            "employee_reward_rights": self.employee_reward_rights,
            "transferability": self.transferability,
            "rights_confidence": self.rights_confidence,
        }


@dataclass
class SettlementEnvelope:
    """D. Settlement Envelope — only exists when contractual reward terms exist."""
    reward_contract_id: str = ""
    covered_frontier: str = ""
    covered_contributors: list[str] = field(default_factory=list)
    milestones: list[dict[str, Any]] = field(default_factory=list)
    verification_method: str = ""
    payment_formula: str = ""
    caps: dict[str, float] = field(default_factory=dict)
    attribution_rule: str = ""
    dispute_process: str = ""
    vesting_conditions: str = ""
    termination_conditions: str = ""
    transfer_restrictions: str = ""
    settlement_state: SettlementState = SettlementState.NO_RIGHT

    def to_dict(self) -> dict[str, Any]:
        return {
            "reward_contract_id": self.reward_contract_id,
            "covered_frontier": self.covered_frontier,
            "covered_contributors": self.covered_contributors,
            "milestones": self.milestones,
            "verification_method": self.verification_method,
            "payment_formula": self.payment_formula,
            "caps": self.caps,
            "attribution_rule": self.attribution_rule,
            "dispute_process": self.dispute_process,
            "vesting_conditions": self.vesting_conditions,
            "termination_conditions": self.termination_conditions,
            "transfer_restrictions": self.transfer_restrictions,
            "settlement_state": self.settlement_state.value,
        }


# ─── PharmaFrontier — the root object ───

@dataclass
class PharmaFrontier:
    """Root object: what economically important thing does the organization
    not yet know, and what is the cheapest admissible experiment capable of
    resolving it?
    """

    frontier_id: str = field(default_factory=lambda: str(uuid4()))
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    state: FrontierState = FrontierState.SIGNAL
    version: int = 1

    # Core fields
    problem: str = ""
    unknowns: list[str] = field(default_factory=list)
    economic_consequence: str = ""
    quality_patient_consequence: str = ""
    current_workaround: str = ""
    source_evidence: list[dict[str, Any]] = field(default_factory=list)
    human_originators: list[str] = field(default_factory=list)
    ai_contribution: str = ""
    regulatory_domain: str = ""
    cost_of_learning: float = 0.0
    maximum_upside: float = 0.0
    decision_deadline: Optional[str] = None
    candidate_experiments: list[str] = field(default_factory=list)
    derivative_frontiers: list[str] = field(default_factory=list)
    reactivation_predicates: list[dict[str, Any]] = field(default_factory=list)

    # Four envelopes
    evidence_envelope: EvidenceEnvelope = field(default_factory=EvidenceEnvelope)
    contribution_envelope: ContributionEnvelope = field(default_factory=ContributionEnvelope)
    rights_envelope: RightsEnvelope = field(default_factory=RightsEnvelope)
    settlement_envelope: SettlementEnvelope = field(default_factory=SettlementEnvelope)

    # Prior art
    prior_art_state: PriorArtState = PriorArtState.NEW

    def fingerprint(self) -> str:
        d = self.to_dict()
        d.pop("fingerprint", None)
        return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()[:32]

    def to_dict(self) -> dict[str, Any]:
        d = {
            "frontier_id": self.frontier_id,
            "created_at": self.created_at.isoformat(),
            "state": self.state.value,
            "version": self.version,
            "problem": self.problem,
            "unknowns": self.unknowns,
            "economic_consequence": self.economic_consequence,
            "quality_patient_consequence": self.quality_patient_consequence,
            "current_workaround": self.current_workaround,
            "source_evidence": self.source_evidence,
            "human_originators": self.human_originators,
            "ai_contribution": self.ai_contribution,
            "regulatory_domain": self.regulatory_domain,
            "cost_of_learning": self.cost_of_learning,
            "maximum_upside": self.maximum_upside,
            "decision_deadline": self.decision_deadline,
            "candidate_experiments": self.candidate_experiments,
            "derivative_frontiers": self.derivative_frontiers,
            "reactivation_predicates": self.reactivation_predicates,
            "evidence_envelope": self.evidence_envelope.to_dict(),
            "contribution_envelope": self.contribution_envelope.to_dict(),
            "rights_envelope": self.rights_envelope.to_dict(),
            "settlement_envelope": self.settlement_envelope.to_dict(),
            "prior_art_state": self.prior_art_state.value,
        }
        d["fingerprint"] = hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()[:32]
        return d


# ─── Experiment Contract ───

@dataclass
class ExperimentContract:
    """After experiment approval, the organization commits capital, owners,
    measurement rules, stop conditions and evidence requirements.
    """
    experiment_id: str = field(default_factory=lambda: str(uuid4()))
    frontier_id: str = ""
    hypothesis: str = ""
    capital_committed: float = 0.0
    owners: list[str] = field(default_factory=list)
    measurement_rules: str = ""
    stop_conditions: list[str] = field(default_factory=list)
    evidence_requirements: list[str] = field(default_factory=list)
    duration_days: int = 14
    target_metric: str = ""
    target_improvement: float = 0.0
    kill_threshold: float = 0.05
    expansion_threshold: float = 0.20

    # Results
    status: str = "proposed"  # proposed, funded, running, succeeded, failed, killed, scaled
    actual_improvement: Optional[float] = None
    actual_cost: Optional[float] = None
    learnings: str = ""
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "experiment_id": self.experiment_id,
            "frontier_id": self.frontier_id,
            "hypothesis": self.hypothesis,
            "capital_committed": self.capital_committed,
            "owners": self.owners,
            "measurement_rules": self.measurement_rules,
            "stop_conditions": self.stop_conditions,
            "evidence_requirements": self.evidence_requirements,
            "duration_days": self.duration_days,
            "target_metric": self.target_metric,
            "target_improvement": self.target_improvement,
            "kill_threshold": self.kill_threshold,
            "expansion_threshold": self.expansion_threshold,
            "status": self.status,
            "actual_improvement": self.actual_improvement,
            "actual_cost": self.actual_cost,
            "learnings": self.learnings,
            "created_at": self.created_at.isoformat(),
        }


# ─── Conditional Innovation Option ───

@dataclass
class ConditionalInnovationOption:
    """The most original primitive. When an experiment fails, it doesn't die —
    it becomes a dormant option with reactivation predicates.

    O_t = f(P_technical, P_regulatory, Benefit, Cost, Dependencies, Time)

    The object has time-dependent value. That's the Reserve.
    """
    option_id: str = field(default_factory=lambda: str(uuid4()))
    frontier_id: str = ""
    experiment_id: str = ""
    status: str = "dormant"  # dormant, monitoring, reactivated, exercised, expired
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Reactivation predicates (typed)
    reactivation_predicates: list[dict[str, Any]] = field(default_factory=list)

    # Pricing inputs
    p_technical: float = 0.0
    p_regulatory: float = 0.0
    benefit: float = 0.0
    cost: float = 0.0
    dependencies: list[str] = field(default_factory=list)
    time_horizon_days: int = 365

    # Pricing output (repriced continuously)
    option_value: float = 0.0
    last_priced: Optional[str] = None

    def price(self) -> float:
        """O_t = f(P_technical, P_regulatory, Benefit, Cost, Dependencies, Time)"""
        dep_discount = 1.0 - (len(self.dependencies) * 0.1)
        time_discount = 1.0 - min(0.5, self.time_horizon_days / 3650.0)
        raw = self.p_technical * self.p_regulatory * self.benefit - self.cost
        self.option_value = raw * dep_discount * time_discount
        self.last_priced = datetime.now(timezone.utc).isoformat()
        return self.option_value

    def to_dict(self) -> dict[str, Any]:
        return {
            "option_id": self.option_id,
            "frontier_id": self.frontier_id,
            "experiment_id": self.experiment_id,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "reactivation_predicates": self.reactivation_predicates,
            "p_technical": self.p_technical,
            "p_regulatory": self.p_regulatory,
            "benefit": self.benefit,
            "cost": self.cost,
            "dependencies": self.dependencies,
            "time_horizon_days": self.time_horizon_days,
            "option_value": round(self.option_value, 2),
            "last_priced": self.last_priced,
        }


# ─── Reactivation Predicates ───

class PredicateType(enum.Enum):
    REGULATORY = "RegulatoryPredicate"
    PATENT = "PatentPredicate"
    DATASET = "DatasetPredicate"
    MODEL_PERFORMANCE = "ModelPerformancePredicate"
    COST = "CostPredicate"
    EQUIPMENT = "EquipmentPredicate"
    BUDGET = "BudgetPredicate"
    SPONSOR = "SponsorPredicate"
    EVIDENCE = "EvidencePredicate"
    PRIORITY = "PriorityPredicate"


@dataclass
class ReactivationPredicate:
    """Typed predicate for event-driven reactivation.

    conditional orders for corporate innovation.
    """
    predicate_type: PredicateType
    metric: str = ""
    operator: str = ">="
    value: float = 0.0
    event: str = ""

    def evaluate(self, current_metrics: dict[str, float], events: list[str]) -> bool:
        if self.event:
            return self.event in events
        if self.metric and self.metric in current_metrics:
            current = current_metrics[self.metric]
            if self.operator == ">=":
                return current >= self.value
            elif self.operator == "<=":
                return current <= self.value
            elif self.operator == ">":
                return current > self.value
            elif self.operator == "<":
                return current < self.value
            elif self.operator == "==":
                return current == self.value
        return False

    def to_dict(self) -> dict[str, Any]:
        return {
            "predicate_type": self.predicate_type.value,
            "metric": self.metric,
            "operator": self.operator,
            "value": self.value,
            "event": self.event,
        }


def evaluate_predicate_group(
    group: dict[str, Any],
    current_metrics: dict[str, float],
    events: list[str],
) -> bool:
    """Evaluate an all/any predicate group."""
    if "all" in group:
        return all(
            evaluate_predicate_group(sub, current_metrics, events)
            if isinstance(sub, dict) and ("all" in sub or "any" in sub)
            else _evaluate_leaf(sub, current_metrics, events)
            for sub in group["all"]
        )
    elif "any" in group:
        return any(
            evaluate_predicate_group(sub, current_metrics, events)
            if isinstance(sub, dict) and ("all" in sub or "any" in sub)
            else _evaluate_leaf(sub, current_metrics, events)
            for sub in group["any"]
        )
    return False


def _evaluate_leaf(leaf: dict[str, Any], metrics: dict[str, float], events: list[str]) -> bool:
    if "event" in leaf:
        return leaf["event"] in events
    metric = leaf.get("metric", "")
    operator = leaf.get("operator", ">=")
    value = leaf.get("value", 0)
    if metric in metrics:
        current = metrics[metric]
        if operator == ">=":
            return current >= value
        elif operator == "<=":
            return current <= value
        elif operator == ">":
            return current > value
        elif operator == "<":
            return current < value
        elif operator == "==":
            return current == value
    return False
