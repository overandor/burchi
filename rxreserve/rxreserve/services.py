"""LAIDER Six Economic Services.

These are not UI features. They are the runtime economic control plane.

1. laider_ledger     — Canonical append-only economic history
2. laider_underwriter — Employee Advocate, Company Prosecutor, Risk Governor
3. laider_exchange   — Clears employee × problem × experiment × sponsor × capital
4. laider_oracle     — Measures baseline, treatment, counterfactual, outcome, confidence
5. laider_attribution — Cap table, claims, evidence, disputes, settlement
6. laider_magnifier  — Outcome → primitive → adjacency → derivative → new underwriting

Everything else becomes an application built over these primitives.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from rxreserve.ledger import (
    CanonicalLedger,
    EventType,
    LedgerEvent,
    validate_transition,
)
from rxreserve.economic_instruments import (
    UncertaintyAsset,
    InformationValueReceipt,
    ExperimentOption,
    CapitalTranche,
    TrancheStage,
    AttributionCapTable,
    AttributionEntry,
    AttributionDispute,
    AttributionClaim,
    AttributionObjection,
    AttributionEvidence,
    AttributionSettlement,
    RecognitionClaim,
    RecognitionDebt,
    CareerWarrant,
    WarrantTrigger,
    CareerRight,
    ReusablePrimitive,
    ProvenanceDividend,
    KillReceipt,
    ChallengeCase,
    InternalShortThesis,
    DerivativeOpportunity,
    DormantOption,
)
from rxreserve.economics import (
    StateVector,
    EmployeeBalanceSheet,
    CompanyBalanceSheet,
    HumanResidual,
    AutomationDividend,
    CompanyUtility,
    EmployeeUtility,
    GovernorAssessment,
    GovernorDecision,
    ClearingResult,
    MarketExchange,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(prefix: str = "") -> str:
    return f"{prefix}{uuid4().hex[:12]}"


# ═══════════════════════════════════════════════════════════════
# 1. LAIDER Ledger Service
# ═══════════════════════════════════════════════════════════════

class LedgerService:
    """Canonical append-only economic history.

    Never mutate history. Everything else becomes projections over this event log.
    """

    def __init__(self, ledger: Optional[CanonicalLedger] = None) -> None:
        self.ledger = ledger or CanonicalLedger()

    def record_observation(self, observer: str, entity_id: str, observation: dict[str, Any]) -> str:
        return self.ledger.record(
            EventType.OBSERVATION_RECORDED,
            actor=observer,
            entity_id=entity_id,
            entity_type="observation",
            payload=observation,
        )

    def create_uncertainty(self, owner: str, uncertainty: UncertaintyAsset) -> str:
        return self.ledger.record(
            EventType.UNCERTAINTY_CREATED,
            actor=owner,
            entity_id=uncertainty.uncertainty_id,
            entity_type="uncertainty",
            payload=uncertainty.to_dict(),
        )

    def propose_hypothesis(self, proposer: str, uncertainty_id: str, hypothesis: dict[str, Any]) -> str:
        return self.ledger.record(
            EventType.HYPOTHESIS_PROPOSED,
            actor=proposer,
            entity_id=uncertainty_id,
            entity_type="hypothesis",
            payload=hypothesis,
        )

    def contract_experiment(self, sponsor: str, experiment: ExperimentOption) -> str:
        return self.ledger.record(
            EventType.EXPERIMENT_CONTRACTED,
            actor=sponsor,
            entity_id=experiment.option_id,
            entity_type="experiment",
            payload=experiment.to_dict(),
        )

    def reserve_capital(self, approver: str, experiment_id: str, capital: dict[str, Any]) -> str:
        return self.ledger.record(
            EventType.CAPITAL_RESERVED,
            actor=approver,
            entity_id=experiment_id,
            entity_type="capital",
            payload=capital,
        )

    def start_experiment(self, actor: str, experiment_id: str) -> str:
        return self.ledger.record(
            EventType.EXPERIMENT_STARTED,
            actor=actor,
            entity_id=experiment_id,
            entity_type="experiment",
            payload={"started_at": _now()},
        )

    def measure_outcome(self, oracle: str, experiment_id: str, outcome: dict[str, Any]) -> str:
        return self.ledger.record(
            EventType.OUTCOME_MEASURED,
            actor=oracle,
            entity_id=experiment_id,
            entity_type="outcome",
            payload=outcome,
        )

    def verify_value(self, verifier: str, experiment_id: str, value: dict[str, Any]) -> str:
        return self.ledger.record(
            EventType.VALUE_VERIFIED,
            actor=verifier,
            entity_id=experiment_id,
            entity_type="value",
            payload=value,
        )

    def settle_attribution(self, settler: str, experiment_id: str, settlement: AttributionSettlement) -> str:
        return self.ledger.record(
            EventType.ATTRIBUTION_SETTLED,
            actor=settler,
            entity_id=experiment_id,
            entity_type="attribution",
            payload=settlement.to_dict(),
        )

    def grant_recognition(self, granter: str, employee_id: str, recognition: dict[str, Any]) -> str:
        return self.ledger.record(
            EventType.RECOGNITION_GRANTED,
            actor=granter,
            entity_id=employee_id,
            entity_type="recognition",
            payload=recognition,
        )

    def extract_primitive(self, actor: str, experiment_id: str, primitive: ReusablePrimitive) -> str:
        return self.ledger.record(
            EventType.PRIMITIVE_EXTRACTED,
            actor=actor,
            entity_id=experiment_id,
            entity_type="primitive",
            payload=primitive.to_dict(),
        )

    def generate_derivative(self, actor: str, experiment_id: str, derivative: DerivativeOpportunity) -> str:
        return self.ledger.record(
            EventType.DERIVATIVE_GENERATED,
            actor=actor,
            entity_id=experiment_id,
            entity_type="derivative",
            payload=derivative.to_dict(),
        )

    def record_information_value(self, actor: str, experiment_id: str, ivr: InformationValueReceipt) -> str:
        return self.ledger.record(
            EventType.INFORMATION_VALUE_RECORDED,
            actor=actor,
            entity_id=experiment_id,
            entity_type="information_value",
            payload=ivr.to_dict(),
        )

    def credit_kill(self, actor: str, kill: KillReceipt) -> str:
        return self.ledger.record(
            EventType.KILL_CREDITED,
            actor=actor,
            entity_id=kill.kill_id,
            entity_type="kill_credit",
            payload=kill.to_dict(),
        )

    def issue_warrant(self, approver: str, warrant: CareerWarrant) -> str:
        return self.ledger.record(
            EventType.CAREER_WARRANT_ISSUED,
            actor=approver,
            entity_id=warrant.warrant_id,
            entity_type="career_warrant",
            payload=warrant.to_dict(),
        )

    def exercise_warrant(self, actor: str, warrant_id: str) -> str:
        return self.ledger.record(
            EventType.CAREER_WARRANT_EXERCISED,
            actor=actor,
            entity_id=warrant_id,
            entity_type="career_warrant",
            payload={"exercised_at": _now()},
        )

    def advance_tranche(self, actor: str, experiment_id: str, tranche_info: dict[str, Any]) -> str:
        return self.ledger.record(
            EventType.TRANCHE_ADVANCED,
            actor=actor,
            entity_id=experiment_id,
            entity_type="tranche",
            payload=tranche_info,
        )

    def kill_tranche(self, actor: str, experiment_id: str, kill_info: dict[str, Any]) -> str:
        return self.ledger.record(
            EventType.TRANCHE_KILLED,
            actor=actor,
            entity_id=experiment_id,
            entity_type="tranche",
            payload=kill_info,
        )

    def project(self, entity_id: str) -> dict[str, Any]:
        return self.ledger.project(entity_id)

    def audit_trail(self, entity_id: str) -> list[dict[str, Any]]:
        return self.ledger.audit_trail(entity_id)

    def summary(self) -> dict[str, Any]:
        return self.ledger.summary()


# ═══════════════════════════════════════════════════════════════
# 2. LAIDER Underwriter Service
# ═══════════════════════════════════════════════════════════════

@dataclass
class UnderwritingResult:
    """Result of underwriting an experiment from three independent perspectives."""
    experiment_id: str = ""
    employee_advocate: dict[str, Any] = field(default_factory=dict)
    company_prosecutor: dict[str, Any] = field(default_factory=dict)
    risk_governor: GovernorAssessment = field(default_factory=GovernorAssessment)
    recommendation: str = ""  # FUND, REJECT, DORMANT, REVIEW
    rationale: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "experiment_id": self.experiment_id,
            "employee_advocate": self.employee_advocate,
            "company_prosecutor": self.company_prosecutor,
            "risk_governor": self.risk_governor.to_dict(),
            "recommendation": self.recommendation,
            "rationale": self.rationale,
        }


class UnderwriterService:
    """Runs Employee Advocate, Company Prosecutor, and Risk Governor independently.

    The Employee Advocate argues for the employee's career benefit.
    The Company Prosecutor argues against funding (adversarial).
    The Risk Governor checks compliance, privacy, consent, governance.
    """

    def __init__(self, ledger: Optional[LedgerService] = None) -> None:
        self.ledger = ledger

    def underwrite(
        self,
        experiment_id: str,
        uncertainty: UncertaintyAsset,
        experiment: ExperimentOption,
        employee_id: str,
        company_utility: CompanyUtility,
        employee_utility: EmployeeUtility,
        governor: GovernorAssessment,
    ) -> UnderwritingResult:
        # Employee Advocate: argues for the employee
        emp_case = {
            "career_capital_gain": employee_utility.career_capital,
            "skill_appreciation": employee_utility.skill_appreciation,
            "scope_expansion": employee_utility.scope,
            "network_leverage": employee_utility.network_leverage,
            "political_risk": employee_utility.political_risk,
            "replacement_exposure": employee_utility.replacement_exposure,
            "net_employee_utility": employee_utility.utility,
            "recommendation": "SUPPORT" if employee_utility.utility > 0 else "OPPOSE",
        }

        # Company Prosecutor: adversarial case against funding
        prosecutor_concerns: list[str] = []
        if company_utility.p_e < 0.3:
            prosecutor_concerns.append("Low probability of success")
        if company_utility.C_e > company_utility.p_e * company_utility.V_e:
            prosecutor_concerns.append("Cost exceeds expected direct value")
        if company_utility.Risk_e > 0.3 * (company_utility.p_e * company_utility.V_e):
            prosecutor_concerns.append("Risk-adjusted cost too high")
        if not uncertainty.value_if_resolved:
            prosecutor_concerns.append("Uncertainty has no quantified value")

        prosecutor_case = {
            "concerns": prosecutor_concerns,
            "expected_value": company_utility.utility,
            "information_value": company_utility.I_e,
            "primitive_value": company_utility.R_e,
            "recommendation": "FUND" if company_utility.utility > 0 and not prosecutor_concerns else "CHALLENGE",
        }

        # Synthesize
        if not governor.is_safe:
            recommendation = "REJECT"
            rationale = "Governor blocked: compliance/governance failure"
        elif company_utility.utility <= 0:
            recommendation = "REJECT"
            rationale = "Company utility negative"
        elif employee_utility.utility <= 0:
            recommendation = "DORMANT"
            rationale = "Employee utility negative — preserve as dormant option"
        elif prosecutor_concerns:
            recommendation = "REVIEW"
            rationale = f"Prosecutor raised {len(prosecutor_concerns)} concerns"
        else:
            recommendation = "FUND"
            rationale = "All three agents agree: company YES, employee YES, governor SAFE"

        result = UnderwritingResult(
            experiment_id=experiment_id,
            employee_advocate=emp_case,
            company_prosecutor=prosecutor_case,
            risk_governor=governor,
            recommendation=recommendation,
            rationale=rationale,
        )

        if self.ledger:
            self.ledger.ledger.record(
                EventType.EMPLOYEE_TWIN_UNDERWRITTEN,
                actor=employee_id,
                entity_id=experiment_id,
                entity_type="underwriting",
                payload=emp_case,
            )
            self.ledger.ledger.record(
                EventType.COMPANY_TWIN_UNDERWRITTEN,
                actor="company_prosecutor",
                entity_id=experiment_id,
                entity_type="underwriting",
                payload=prosecutor_case,
            )
            self.ledger.ledger.record(
                EventType.GOVERNOR_REVIEWED,
                actor="risk_governor",
                entity_id=experiment_id,
                entity_type="underwriting",
                payload=governor.to_dict(),
            )

        return result


# ═══════════════════════════════════════════════════════════════
# 3. LAIDER Exchange Service
# ═══════════════════════════════════════════════════════════════

class ExchangeService:
    """Clears: employee × problem × experiment × sponsor × capital.

    The market asks: which human × uncertainty × experiment combination
    produces the best mutually acceptable frontier?

    LAIDER manufactures the opportunity first. That is fundamentally
    different from skills matching.
    """

    def __init__(self) -> None:
        self.market = MarketExchange()
        self._uncertainties: dict[str, UncertaintyAsset] = {}
        self._experiments: dict[str, ExperimentOption] = {}
        self._assignments: dict[str, dict[str, Any]] = {}  # experiment_id → assignment

    def register_uncertainty(self, uncertainty: UncertaintyAsset) -> None:
        self._uncertainties[uncertainty.uncertainty_id] = uncertainty

    def register_experiment(self, experiment: ExperimentOption) -> None:
        self._experiments[experiment.option_id] = experiment

    def evaluate(
        self,
        experiment_id: str,
        company: CompanyUtility,
        employee: EmployeeUtility,
        governor: GovernorAssessment,
    ) -> ClearingResult:
        """CLEAR(E) = CompanyYES ∧ EmployeeYES ∧ GovernorSAFE"""
        return self.market.clear(experiment_id, company, employee, governor)

    def assign(self, experiment_id: str, employee_id: str, sponsor: str, capital: float) -> dict[str, Any]:
        """Assign an employee + sponsor + capital to a cleared experiment."""
        assignment = {
            "assignment_id": _uid("ASG-"),
            "experiment_id": experiment_id,
            "employee_id": employee_id,
            "sponsor": sponsor,
            "capital": capital,
            "assigned_at": _now(),
        }
        self._assignments[experiment_id] = assignment
        return assignment

    def opportunity_market(self) -> list[dict[str, Any]]:
        """List all available opportunities (uncleared experiments + open uncertainties)."""
        opportunities = []
        for u_id, u in self._uncertainties.items():
            if u.state == "open":
                opportunities.append({
                    "type": "uncertainty",
                    "id": u_id,
                    "question": u.question,
                    "value_if_resolved": u.value_if_resolved,
                    "resolution_cost": u.resolution_cost,
                    "owner": u.owner,
                })
        for e_id, e in self._experiments.items():
            clearing = self.market.get(e_id)
            if clearing and not clearing.clears:
                opportunities.append({
                    "type": "experiment",
                    "id": e_id,
                    "hypothesis": e.hypothesis,
                    "status": e.status,
                    "clearing": clearing.to_dict(),
                })
        return opportunities

    def cleared_market(self) -> list[dict[str, Any]]:
        """List all cleared experiments with assignments."""
        results = []
        for c in self.market.cleared_experiments():
            assignment = self._assignments.get(c.experiment_id, {})
            results.append({
                "experiment_id": c.experiment_id,
                "clearing": c.to_dict(),
                "assignment": assignment,
            })
        return results

    def summary(self) -> dict[str, Any]:
        return {
            "market": self.market.summary(),
            "open_uncertainties": sum(1 for u in self._uncertainties.values() if u.state == "open"),
            "registered_experiments": len(self._experiments),
            "assignments": len(self._assignments),
        }


# ═══════════════════════════════════════════════════════════════
# 4. LAIDER Oracle Service
# ═══════════════════════════════════════════════════════════════

@dataclass
class MeasurementResult:
    """Outcome of measuring an experiment."""
    experiment_id: str = ""
    baseline: float = 0.0
    treatment: float = 0.0
    counterfactual_estimate: float = 0.0
    effect_size: float = 0.0
    confidence: float = 0.0
    is_statistically_significant: bool = False
    evidence_quality: str = ""  # low, medium, high
    artifacts: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "experiment_id": self.experiment_id,
            "baseline": self.baseline,
            "treatment": self.treatment,
            "counterfactual_estimate": self.counterfactual_estimate,
            "effect_size": self.effect_size,
            "confidence": self.confidence,
            "is_statistically_significant": self.is_statistically_significant,
            "evidence_quality": self.evidence_quality,
            "artifacts": self.artifacts,
        }


class OracleService:
    """Measures: baseline, treatment, counterfactual, outcome, confidence.

    The Oracle is the truth mechanism. It converts observations into
    economically legible evidence.
    """

    def __init__(self, ledger: Optional[LedgerService] = None) -> None:
        self.ledger = ledger
        self._measurements: dict[str, MeasurementResult] = {}

    def measure_baseline(self, experiment_id: str, metric: str, value: float) -> str:
        """Record the baseline measurement before intervention."""
        if self.ledger:
            return self.ledger.ledger.record(
                EventType.BASELINE_MEASURED,
                actor="oracle",
                entity_id=experiment_id,
                entity_type="measurement",
                payload={"metric": metric, "value": value, "type": "baseline"},
            )
        return ""

    def measure_outcome(
        self,
        experiment_id: str,
        baseline: float,
        treatment: float,
        counterfactual: float = 0.0,
        confidence: float = 0.0,
        artifacts: Optional[list[str]] = None,
    ) -> MeasurementResult:
        """Measure the outcome of an experiment."""
        effect_size = treatment - baseline
        is_sig = abs(effect_size) > 0.05 * max(abs(baseline), 1.0) and confidence > 0.8

        if effect_size > 0.05 * max(abs(baseline), 1.0) and confidence > 0.9:
            quality = "high"
        elif confidence > 0.7:
            quality = "medium"
        else:
            quality = "low"

        result = MeasurementResult(
            experiment_id=experiment_id,
            baseline=baseline,
            treatment=treatment,
            counterfactual_estimate=counterfactual,
            effect_size=effect_size,
            confidence=confidence,
            is_statistically_significant=is_sig,
            evidence_quality=quality,
            artifacts=artifacts or [],
        )
        self._measurements[experiment_id] = result

        if self.ledger:
            self.ledger.measure_outcome("oracle", experiment_id, result.to_dict())

        return result

    def compute_information_value(
        self,
        experiment_id: str,
        uncertainty_id: str,
        prior_p_bad: float,
        loss_if_bad: float,
        posterior_p_bad: float = 0.0,
        decision_changed: bool = False,
    ) -> InformationValueReceipt:
        """Compute the information value of an experiment.

        IV = P(bad decision without experiment) × Loss_avoided
        """
        ivr = InformationValueReceipt(
            uncertainty_id=uncertainty_id,
            experiment_id=experiment_id,
            prior_distribution={"bad": prior_p_bad, "good": 1 - prior_p_bad},
            posterior_distribution={"bad": posterior_p_bad, "good": 1 - posterior_p_bad},
            decision_changed=decision_changed,
            estimated_loss_avoided=loss_if_bad * (prior_p_bad - posterior_p_bad),
            confidence=1 - posterior_p_bad,
        )
        if self.ledger:
            self.ledger.record_information_value("oracle", experiment_id, ivr)
        return ivr

    def get_measurement(self, experiment_id: str) -> Optional[MeasurementResult]:
        return self._measurements.get(experiment_id)

    def summary(self) -> dict[str, Any]:
        return {
            "total_measurements": len(self._measurements),
            "significant_results": sum(1 for m in self._measurements.values() if m.is_statistically_significant),
            "high_quality": sum(1 for m in self._measurements.values() if m.evidence_quality == "high"),
        }


# ═══════════════════════════════════════════════════════════════
# 5. LAIDER Attribution Service
# ═══════════════════════════════════════════════════════════════

class AttributionService:
    """Maintains: cap table, claims, evidence, disputes, settlement.

    Do not pretend attribution is objective. Make disagreement first-class.
    """

    def __init__(self, ledger: Optional[LedgerService] = None) -> None:
        self.ledger = ledger
        self._cap_tables: dict[str, AttributionCapTable] = {}  # experiment_id → cap table
        self._disputes: dict[str, AttributionDispute] = {}  # experiment_id → dispute
        self._recognition_claims: list[RecognitionClaim] = []
        self._recognition_debts: dict[str, RecognitionDebt] = {}  # employee_id → debt
        self._warrants: list[CareerWarrant] = []

    def create_cap_table(self, experiment_id: str, entries: list[AttributionEntry]) -> AttributionCapTable:
        """Establish the cap table before the experiment begins."""
        ct = AttributionCapTable(experiment_id=experiment_id, entries=entries)
        self._cap_tables[experiment_id] = ct
        if self.ledger:
            self.ledger.ledger.record(
                EventType.ATTRIBUTION_PROPOSED,
                actor="attribution_service",
                entity_id=experiment_id,
                entity_type="attribution",
                payload=ct.to_dict(),
            )
        return ct

    def get_cap_table(self, experiment_id: str) -> Optional[AttributionCapTable]:
        return self._cap_tables.get(experiment_id)

    def file_claim(self, experiment_id: str, claim: AttributionClaim) -> AttributionDispute:
        """File an attribution claim, creating a dispute if needed."""
        if experiment_id not in self._disputes:
            self._disputes[experiment_id] = AttributionDispute(experiment_id=experiment_id)
        dispute = self._disputes[experiment_id]
        dispute.claims.append(claim)
        if self.ledger:
            self.ledger.ledger.record(
                EventType.ATTRIBUTION_PROPOSED,
                actor=claim.claimant,
                entity_id=experiment_id,
                entity_type="attribution_claim",
                payload=claim.to_dict(),
            )
        return dispute

    def file_objection(self, experiment_id: str, objection: AttributionObjection) -> AttributionDispute:
        """File an objection to a claim."""
        dispute = self._disputes.get(experiment_id)
        if not dispute:
            dispute = AttributionDispute(experiment_id=experiment_id)
            self._disputes[experiment_id] = dispute
        dispute.objections.append(objection)
        dispute.state = __import__("rxreserve.economic_instruments", fromlist=["DisputeState"]).DisputeState.CHALLENGED
        if self.ledger:
            self.ledger.ledger.record(
                EventType.ATTRIBUTION_CHALLENGED,
                actor=objection.objector,
                entity_id=experiment_id,
                entity_type="attribution_objection",
                payload=objection.to_dict(),
            )
        return dispute

    def submit_evidence(self, experiment_id: str, evidence: AttributionEvidence) -> AttributionDispute:
        """Submit evidence for or against a claim."""
        dispute = self._disputes.get(experiment_id)
        if not dispute:
            dispute = AttributionDispute(experiment_id=experiment_id)
            self._disputes[experiment_id] = dispute
        dispute.evidence.append(evidence)
        if self.ledger:
            self.ledger.ledger.record(
                EventType.ATTRIBUTION_CHALLENGED,
                actor=evidence.submitted_by,
                entity_id=experiment_id,
                entity_type="attribution_evidence",
                payload=evidence.to_dict(),
            )
        return dispute

    def settle(self, experiment_id: str, settled_by: str, final_weights: dict[str, float], rationale: str) -> AttributionSettlement:
        """Human-settled attribution. Produces (claim, evidence, objection, settlement)."""
        dispute = self._disputes.get(experiment_id)
        history = []
        if dispute:
            history = [c.to_dict() for c in dispute.claims] + [o.to_dict() for o in dispute.objections]

        settlement = AttributionSettlement(
            experiment_id=experiment_id,
            final_weights=final_weights,
            settled_by=settled_by,
            rationale=rationale,
            dispute_history=history,
        )
        if dispute:
            dispute.settlement = settlement
            dispute.state = __import__("rxreserve.economic_instruments", fromlist=["DisputeState"]).DisputeState.SETTLED

        if self.ledger:
            self.ledger.settle_attribution(settled_by, experiment_id, settlement)

        return settlement

    def request_recognition(self, employee_id: str, attributed_value: float, recognition_type: str) -> RecognitionClaim:
        """Request organizational recognition for attributed value."""
        claim = RecognitionClaim(
            employee_id=employee_id,
            attributed_value=attributed_value,
            recognition_type=recognition_type,
        )
        self._recognition_claims.append(claim)
        if self.ledger:
            self.ledger.ledger.record(
                EventType.RECOGNITION_REQUESTED,
                actor=employee_id,
                entity_id=employee_id,
                entity_type="recognition",
                payload=claim.to_dict(),
            )
        return claim

    def grant_recognition(self, claim: RecognitionClaim, granted_by: str, recognized_value: float, rationale: str) -> RecognitionClaim:
        """Grant recognition, computing recognition yield."""
        claim.recognized_value = recognized_value
        claim.granted_by = granted_by
        claim.rationale = rationale
        claim.status = "granted" if recognized_value >= claim.attributed_value else "partial"
        if self.ledger:
            self.ledger.grant_recognition(granted_by, claim.employee_id, claim.to_dict())
        return claim

    def compute_recognition_debt(self, employee_id: str, attributed_capital: float, settled_capital: float,
                                  verified_value: float = 0, reusable_systems: int = 0,
                                  cross_team: int = 0, title: str = "", scope: str = "",
                                  comp: float = 0) -> RecognitionDebt:
        """RecognitionDebt_i = AttributedCareerCapital_i - SettledCareerCapital_i"""
        debt = RecognitionDebt(
            employee_id=employee_id,
            attributed_career_capital=attributed_capital,
            settled_career_capital=settled_capital,
            verified_value_created=verified_value,
            reusable_systems=reusable_systems,
            cross_team_improvements=cross_team,
            current_title=title,
            current_scope=scope,
            current_compensation=comp,
        )
        self._recognition_debts[employee_id] = debt
        return debt

    def issue_warrant(self, approver: str, employee_id: str, experiment_id: str,
                      triggers: list[WarrantTrigger], right: CareerRight) -> CareerWarrant:
        """Issue a career warrant: IF triggers THEN career right."""
        warrant = CareerWarrant(
            employee_id=employee_id,
            experiment_id=experiment_id,
            triggers=triggers,
            career_right=right,
            approved_by=approver,
            status="approved",
        )
        self._warrants.append(warrant)
        if self.ledger:
            self.ledger.issue_warrant(approver, warrant)
        return warrant

    def check_warrants(self, employee_id: str, metrics: dict[str, float]) -> list[CareerWarrant]:
        """Check if any warrants for this employee are triggered."""
        triggered = []
        for w in self._warrants:
            if w.employee_id == employee_id and w.status == "approved":
                if w.check_triggers(metrics):
                    w.status = "triggered"
                    triggered.append(w)
                    if self.ledger:
                        self.ledger.exercise_warrant(employee_id, w.warrant_id)
        return triggered

    def get_dispute(self, experiment_id: str) -> Optional[AttributionDispute]:
        return self._disputes.get(experiment_id)

    def get_recognition_debt(self, employee_id: str) -> Optional[RecognitionDebt]:
        return self._recognition_debts.get(employee_id)

    def summary(self) -> dict[str, Any]:
        return {
            "cap_tables": len(self._cap_tables),
            "active_disputes": sum(1 for d in self._disputes.values() if d.state.value != "settled"),
            "settled_disputes": sum(1 for d in self._disputes.values() if d.state.value == "settled"),
            "recognition_claims": len(self._recognition_claims),
            "recognition_debts": len(self._recognition_debts),
            "warrants_issued": len(self._warrants),
            "warrants_triggered": sum(1 for w in self._warrants if w.status == "triggered"),
        }


# ═══════════════════════════════════════════════════════════════
# 6. LAIDER Magnifier Service
# ═══════════════════════════════════════════════════════════════

class MagnifierService:
    """Turns: outcome → primitive → adjacency → derivative opportunities → new underwriting.

    This is the recursive engine. Everything else feeds it or settles what it creates.

    E_t → (O_t, P_t, I_t)

    where:
    - O_t = observed outcome
    - P_t = reusable primitives
    - I_t = information gained

    And those produce a new opportunity set:
    Ω_{t+1} = f(O_t, P_t, I_t, G_t)

    Then: Ω_{t+1} → Underwrite → Experiment → Evidence → Ω_{t+2}

    That's LAIDER².
    """

    def __init__(self, ledger: Optional[LedgerService] = None) -> None:
        self.ledger = ledger
        self._primitives: dict[str, ReusablePrimitive] = {}
        self._derivatives: dict[str, DerivativeOpportunity] = {}
        self._provenance_dividends: dict[str, ProvenanceDividend] = {}  # employee_id → dividend
        self._dormant_options: dict[str, DormantOption] = {}

    def extract_primitive(
        self,
        experiment_id: str,
        originators: list[str],
        abstraction: str,
        implementation: str,
        constraints: Optional[list[str]] = None,
        domain: str = "",
    ) -> ReusablePrimitive:
        """Extract a reusable primitive from a completed experiment."""
        prim = ReusablePrimitive(
            origin_experiment=experiment_id,
            originators=originators,
            abstraction=abstraction,
            implementation=implementation,
            constraints=constraints or [],
            demonstrated_domains=[domain] if domain else [],
        )
        self._primitives[prim.primitive_id] = prim
        if self.ledger:
            self.ledger.extract_primitive("magnifier", experiment_id, prim)
        return prim

    def generate_derivative(
        self,
        parent_experiment: str,
        primitive_id: str,
        target_context: str,
        similarity: float = 0.0,
        changed_constraints: Optional[list[str]] = None,
        expected_value: float = 0.0,
        new_uncertainties: Optional[list[str]] = None,
        owner_candidates: Optional[list[str]] = None,
    ) -> DerivativeOpportunity:
        """Generate a derivative opportunity from a primitive in a new context."""
        deriv = DerivativeOpportunity(
            parent_experiment=parent_experiment,
            primitive_id=primitive_id,
            target_context=target_context,
            similarity=similarity,
            changed_constraints=changed_constraints or [],
            expected_value=expected_value,
            new_uncertainties=new_uncertainties or [],
            owner_candidates=owner_candidates or [],
        )
        self._derivatives[deriv.derivative_id] = deriv

        # Link to primitive
        if primitive_id in self._primitives:
            self._primitives[primitive_id].downstream_derivatives.append(deriv.derivative_id)

        if self.ledger:
            self.ledger.generate_derivative("magnifier", parent_experiment, deriv)

        return deriv

    def compute_provenance_dividend(
        self,
        employee_id: str,
        primitive_id: str,
        downstream: list[dict[str, Any]],
    ) -> ProvenanceDividend:
        """PD_i = Σ_j w_{ij} × V_j

        Every downstream derivative pushes some career credit upstream.
        """
        div = ProvenanceDividend(
            employee_id=employee_id,
            primitive_id=primitive_id,
            downstream_implementations=downstream,
        )
        div.compute()
        self._provenance_dividends[employee_id] = div
        return div

    def store_dormant(self, proposal: str, reason: str, predicates: list[dict[str, Any]]) -> DormantOption:
        """Store a rejected proposal as a dormant option with reactivation predicates."""
        opt = DormantOption(
            original_proposal=proposal,
            reason_dormant=reason,
            reactivation_predicates=predicates,
        )
        self._dormant_options[opt.option_id] = opt
        return opt

    def check_dormant_reactivation(self, current_state: dict[str, Any]) -> list[DormantOption]:
        """Check all dormant options for reactivation."""
        reactivated = []
        for opt in self._dormant_options.values():
            if opt.status == "dormant" and opt.check_reactivation(current_state):
                opt.status = "reactivated"
                reactivated.append(opt)
                if self.ledger:
                    self.ledger.ledger.record(
                        EventType.DERIVATIVE_REACTIVATED,
                        actor="magnifier",
                        entity_id=opt.option_id,
                        entity_type="dormant_option",
                        payload=opt.to_dict(),
                    )
        return reactivated

    def new_opportunity_set(
        self,
        experiment_id: str,
        outcome: dict[str, Any],
        primitives: list[ReusablePrimitive],
        information: dict[str, Any],
        org_graph: dict[str, Any],
    ) -> list[DerivativeOpportunity]:
        """Ω_{t+1} = f(O_t, P_t, I_t, G_t)

        The recursive engine: outcome → primitives → information → new opportunities.
        """
        new_opportunities = []
        for prim in primitives:
            # Find adjacent domains in the org graph
            domains = org_graph.get("domains", [])
            for domain in domains:
                if domain not in prim.demonstrated_domains:
                    # Compute similarity from demonstrated domains to target
                    if prim.demonstrated_domains:
                        # Text-based similarity: overlap of domain names
                        target_lower = domain.lower()
                        similarities = []
                        for d in prim.demonstrated_domains:
                            d_lower = d.lower()
                            # Exact match = 1.0, substring overlap = high, shared words = moderate
                            if d_lower == target_lower:
                                similarities.append(1.0)
                            elif target_lower in d_lower or d_lower in target_lower:
                                similarities.append(0.8)
                            else:
                                target_words = set(target_lower.split())
                                d_words = set(d_lower.split())
                                overlap = len(target_words & d_words)
                                total = len(target_words | d_words)
                                similarities.append(overlap / total if total > 0 else 0.0)
                        similarity = max(similarities) if similarities else 0.0
                    else:
                        # No demonstrated domains — similarity from abstraction text
                        abstraction_lower = prim.abstraction.lower()
                        domain_lower = domain.lower()
                        a_words = set(abstraction_lower.split())
                        d_words = set(domain_lower.split())
                        overlap = len(a_words & d_words)
                        total = len(a_words | d_words)
                        similarity = overlap / total if total > 0 else 0.1

                    # Expected value scales with similarity
                    base_value = outcome.get("value", 0)
                    expected_value = base_value * similarity * 0.5

                    deriv = self.generate_derivative(
                        parent_experiment=experiment_id,
                        primitive_id=prim.primitive_id,
                        target_context=domain,
                        similarity=similarity,
                        expected_value=expected_value,
                        new_uncertainties=[f"Does {prim.abstraction} transfer to {domain}?"],
                        owner_candidates=prim.originators,
                    )
                    new_opportunities.append(deriv)
        return new_opportunities

    def get_primitive(self, primitive_id: str) -> Optional[ReusablePrimitive]:
        return self._primitives.get(primitive_id)

    def get_derivative(self, derivative_id: str) -> Optional[DerivativeOpportunity]:
        return self._derivatives.get(derivative_id)

    def all_primitives(self) -> list[ReusablePrimitive]:
        return list(self._primitives.values())

    def all_derivatives(self) -> list[DerivativeOpportunity]:
        return list(self._derivatives.values())

    def all_dormant(self) -> list[DormantOption]:
        return list(self._dormant_options.values())

    def summary(self) -> dict[str, Any]:
        return {
            "primitives_extracted": len(self._primitives),
            "derivatives_generated": len(self._derivatives),
            "dormant_options": len(self._dormant_options),
            "provenance_dividends": len(self._provenance_dividends),
            "reactivation_checks": sum(1 for d in self._dormant_options.values() if d.status == "reactivated"),
        }


# ═══════════════════════════════════════════════════════════════
# LAIDER Runtime — all six services together
# ═══════════════════════════════════════════════════════════════

class LAIDER:
    """The complete LAIDER runtime: six economic services operating together.

    laider_ledger      → self.ledger
    laider_underwriter → self.underwriter
    laider_exchange    → self.exchange
    laider_oracle      → self.oracle
    laider_attribution → self.attribution
    laider_magnifier   → self.magnifier
    """

    def __init__(self) -> None:
        self.ledger = LedgerService()
        self.underwriter = UnderwriterService(self.ledger)
        self.exchange = ExchangeService()
        self.oracle = OracleService(self.ledger)
        self.attribution = AttributionService(self.ledger)
        self.magnifier = MagnifierService(self.ledger)

    def summary(self) -> dict[str, Any]:
        return {
            "ledger": self.ledger.summary(),
            "exchange": self.exchange.summary(),
            "oracle": self.oracle.summary(),
            "attribution": self.attribution.summary(),
            "magnifier": self.magnifier.summary(),
        }
