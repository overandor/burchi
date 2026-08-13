"""LAIDER Balance Sheets, Market Clearing, and Enhanced State Vector.

These are not scores. They are economic statements.
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
# Employee Economic Balance Sheet
# ═══════════════════════════════════════════════════════════════

@dataclass
class EmployeeBalanceSheet:
    """Don't produce a score. Produce an economic balance sheet.

    ASSETS: what the employee has accumulated
    LIABILITIES: what erodes their position
    OPTIONS: what they can exercise
    """
    employee_id: str = ""
    as_of: str = field(default_factory=_now)

    # ASSETS
    verified_value_created: float = 0.0
    reusable_primitives: list[str] = field(default_factory=list)
    information_value: float = 0.0
    organizational_relationships: list[str] = field(default_factory=list)
    decision_rights: list[str] = field(default_factory=list)
    owned_systems: list[str] = field(default_factory=list)
    domain_knowledge: list[str] = field(default_factory=list)
    portable_proofs: list[str] = field(default_factory=list)
    sponsor_relationships: list[str] = field(default_factory=list)
    strategic_adjacency: list[str] = field(default_factory=list)

    # LIABILITIES
    automatable_work_hours: float = 0.0
    single_manager_dependence: bool = False
    obsolete_skills: list[str] = field(default_factory=list)
    invisible_labor_hours: float = 0.0
    unsettled_recognition_debt: float = 0.0
    low_scope_execution: float = 0.0
    political_concentration: float = 0.0
    knowledge_trapped: float = 0.0  # 0-1, how much knowledge is only in this person

    # VALUATION RATES (configurable — replace with actual values when available)
    primitive_value_rate: float = 100_000   # value per reusable primitive
    system_value_rate: float = 50_000       # value per owned system
    automatable_hourly_rate: float = 200    # cost per automatable hour
    invisible_hourly_rate: float = 150      # cost per invisible labor hour
    low_scope_penalty: float = 100_000      # penalty per unit low-scope execution
    political_concentration_penalty: float = 200_000  # penalty per unit political concentration

    # OPTIONS
    promotion_eligibility: bool = False
    scope_expansion_opportunities: list[str] = field(default_factory=list)
    program_ownership_candidates: list[str] = field(default_factory=list)
    internal_transfer_options: list[str] = field(default_factory=list)
    new_initiative_opportunities: list[str] = field(default_factory=list)
    external_employment_value: float = 0.0
    entrepreneurial_spinout_potential: float = 0.0

    @property
    def total_assets(self) -> float:
        return (
            self.verified_value_created
            + self.information_value
            + len(self.reusable_primitives) * self.primitive_value_rate
            + len(self.owned_systems) * self.system_value_rate
        )

    @property
    def total_liabilities(self) -> float:
        return (
            self.unsettled_recognition_debt
            + self.automatable_work_hours * self.automatable_hourly_rate
            + self.invisible_labor_hours * self.invisible_hourly_rate
            + self.low_scope_execution * self.low_scope_penalty
            + self.political_concentration * self.political_concentration_penalty
        )

    @property
    def net_economic_position(self) -> float:
        return self.total_assets - self.total_liabilities

    def to_dict(self) -> dict[str, Any]:
        return {
            "employee_id": self.employee_id,
            "as_of": self.as_of,
            "assets": {
                "verified_value_created": self.verified_value_created,
                "reusable_primitives": self.reusable_primitives,
                "information_value": self.information_value,
                "organizational_relationships": self.organizational_relationships,
                "decision_rights": self.decision_rights,
                "owned_systems": self.owned_systems,
                "domain_knowledge": self.domain_knowledge,
                "portable_proofs": self.portable_proofs,
                "sponsor_relationships": self.sponsor_relationships,
                "strategic_adjacency": self.strategic_adjacency,
            },
            "liabilities": {
                "automatable_work_hours": self.automatable_work_hours,
                "single_manager_dependence": self.single_manager_dependence,
                "obsolete_skills": self.obsolete_skills,
                "invisible_labor_hours": self.invisible_labor_hours,
                "unsettled_recognition_debt": self.unsettled_recognition_debt,
                "low_scope_execution": self.low_scope_execution,
                "political_concentration": self.political_concentration,
                "knowledge_trapped": self.knowledge_trapped,
            },
            "options": {
                "promotion_eligibility": self.promotion_eligibility,
                "scope_expansion_opportunities": self.scope_expansion_opportunities,
                "program_ownership_candidates": self.program_ownership_candidates,
                "internal_transfer_options": self.internal_transfer_options,
                "new_initiative_opportunities": self.new_initiative_opportunities,
                "external_employment_value": self.external_employment_value,
                "entrepreneurial_spinout_potential": self.entrepreneurial_spinout_potential,
            },
            "total_assets": self.total_assets,
            "total_liabilities": self.total_liabilities,
            "net_economic_position": self.net_economic_position,
        }


# ═══════════════════════════════════════════════════════════════
# Company Human-Capital Balance Sheet
# ═══════════════════════════════════════════════════════════════

@dataclass
class CompanyBalanceSheet:
    """The same graph works for both sides."""
    as_of: str = field(default_factory=_now)

    # Hidden assets
    hidden_capabilities: list[dict[str, Any]] = field(default_factory=list)
    unresolved_valuable_uncertainty: list[str] = field(default_factory=list)
    underutilized_employees: list[str] = field(default_factory=list)
    unclaimed_opportunities: list[str] = field(default_factory=list)
    reusable_internal_primitives: list[str] = field(default_factory=list)

    # Hidden liabilities
    key_person_concentration: list[dict[str, Any]] = field(default_factory=list)
    automation_exposure: float = 0.0
    recognition_debt_total: float = 0.0
    succession_gaps: list[str] = field(default_factory=list)
    coalition_bottlenecks: list[str] = field(default_factory=list)
    knowledge_concentration: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "as_of": self.as_of,
            "hidden_assets": {
                "hidden_capabilities": self.hidden_capabilities,
                "unresolved_valuable_uncertainty": self.unresolved_valuable_uncertainty,
                "underutilized_employees": self.underutilized_employees,
                "unclaimed_opportunities": self.unclaimed_opportunities,
                "reusable_internal_primitives": self.reusable_internal_primitives,
            },
            "hidden_liabilities": {
                "key_person_concentration": self.key_person_concentration,
                "automation_exposure": self.automation_exposure,
                "recognition_debt_total": self.recognition_debt_total,
                "succession_gaps": self.succession_gaps,
                "coalition_bottlenecks": self.coalition_bottlenecks,
                "knowledge_concentration": self.knowledge_concentration,
            },
        }


# ═══════════════════════════════════════════════════════════════
# Human Residual
# ═══════════════════════════════════════════════════════════════

@dataclass
class HumanResidual:
    """Work = Automatable + Augmentable + HumanResidual

    Maximize: HumanResidualValue / TotalEmployeeTime over time.

    That is a better target than 'AI adoption.'
    """
    employee_id: str = ""
    judgments_ai_cannot_make: list[str] = field(default_factory=list)
    relationships_required: list[str] = field(default_factory=list)
    authority_required: list[str] = field(default_factory=list)
    ambiguity_handled: list[str] = field(default_factory=list)
    novel_problems_solved: list[str] = field(default_factory=list)
    coalition_capability: list[str] = field(default_factory=list)
    contextual_knowledge: list[str] = field(default_factory=list)
    risk_ownership: list[str] = field(default_factory=list)
    total_employee_time_hours: float = 0.0
    automatable_hours: float = 0.0
    augmentable_hours: float = 0.0
    residual_hours: float = 0.0

    @property
    def residual_ratio(self) -> float:
        if self.total_employee_time_hours <= 0:
            return 0.0
        return self.residual_hours / self.total_employee_time_hours

    @property
    def residual_value_density(self) -> float:
        """How much residual value per hour of residual work."""
        if self.residual_hours <= 0:
            return 0.0
        # Count of residual activities as a proxy for value
        return len(self.judgments_ai_cannot_make) + len(self.relationships_required) + len(self.novel_problems_solved)

    def to_dict(self) -> dict[str, Any]:
        return {
            "employee_id": self.employee_id,
            "judgments_ai_cannot_make": self.judgments_ai_cannot_make,
            "relationships_required": self.relationships_required,
            "authority_required": self.authority_required,
            "ambiguity_handled": self.ambiguity_handled,
            "novel_problems_solved": self.novel_problems_solved,
            "coalition_capability": self.coalition_capability,
            "contextual_knowledge": self.contextual_knowledge,
            "risk_ownership": self.risk_ownership,
            "total_employee_time_hours": self.total_employee_time_hours,
            "automatable_hours": self.automatable_hours,
            "augmentable_hours": self.augmentable_hours,
            "residual_hours": self.residual_hours,
            "residual_ratio": self.residual_ratio,
            "residual_value_density": self.residual_value_density,
        }


# ═══════════════════════════════════════════════════════════════
# Automation Dividend
# ═══════════════════════════════════════════════════════════════

@dataclass
class AutomationDividend:
    """If AI removes 20 hours/week and Sarah gets 20 more hours of identical
    work, LAIDER failed.

    AutomationDividend = Value(NewHigherOrderWork) - Value(DisplacedWork)

    The automation should create a career upgrade path:
    automate execution → supervise system → own process → redesign adjacent → own portfolio
    """
    dividend_id: str = field(default_factory=lambda: _uid("DIV-"))
    employee_id: str = ""
    displaced_work_description: str = ""
    displaced_work_value: float = 0.0
    new_higher_order_work: str = ""
    new_work_value: float = 0.0
    career_path: list[str] = field(default_factory=list)  # execution→supervise→own→redesign→portfolio
    current_stage: int = 0
    created_at: str = field(default_factory=_now)

    @property
    def dividend(self) -> float:
        return self.new_work_value - self.displaced_work_value

    def to_dict(self) -> dict[str, Any]:
        return {
            "dividend_id": self.dividend_id,
            "employee_id": self.employee_id,
            "displaced_work_description": self.displaced_work_description,
            "displaced_work_value": self.displaced_work_value,
            "new_higher_order_work": self.new_higher_order_work,
            "new_work_value": self.new_work_value,
            "dividend": self.dividend,
            "career_path": self.career_path,
            "current_stage": self.current_stage,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# Enhanced State Vector
# ═══════════════════════════════════════════════════════════════

@dataclass
class StateVector:
    """S_i = (V, V̇, V̈, I, İ, P, D, A, Y, N, H, R)

    Still no mega-score. Management sees the vector.

    Dimension  Meaning
    V          realized verified value
    V̇         rate of value creation (first derivative)
    V̈         acceleration of value creation (second derivative)
    I          information value
    İ          rate of information value creation
    P          reusable primitive creation
    D          downstream derivative value
    A          attributable contribution
    Y          recognition yield
    N          network leverage
    H          human residual
    R          replacement exposure
    """
    employee_id: str = ""

    # V: realized verified value
    V: float = 0.0
    V_dot: float = 0.0  # V̇
    V_ddot: float = 0.0  # V̈

    # I: information value
    I: float = 0.0
    I_dot: float = 0.0  # İ

    # P: reusable primitive creation
    P: int = 0  # count of primitives
    P_value: float = 0.0  # total value of primitives

    # D: downstream derivative value
    D: float = 0.0

    # A: attributable contribution
    A: float = 0.0  # total attributed value across all experiments

    # Y: recognition yield = R_i / A_i
    Y: float = 0.0  # recognized / attributed

    # N: network leverage
    N: float = 0.0  # network centrality or leverage score

    # H: human residual
    H: float = 0.0  # residual_ratio or residual_value_density

    # R: replacement exposure
    R: float = 0.0  # 0 = irreplaceable, 1 = fully replaceable

    computed_at: str = field(default_factory=_now)

    def as_vector(self) -> tuple[float, ...]:
        """Return as a plain tuple for mathematical operations."""
        return (self.V, self.V_dot, self.V_ddot, self.I, self.I_dot,
                float(self.P), self.D, self.A, self.Y, self.N, self.H, self.R)

    def to_dict(self) -> dict[str, Any]:
        return {
            "employee_id": self.employee_id,
            "V": self.V,
            "V_dot": self.V_dot,
            "V_ddot": self.V_ddot,
            "I": self.I,
            "I_dot": self.I_dot,
            "P": self.P,
            "P_value": self.P_value,
            "D": self.D,
            "A": self.A,
            "Y": self.Y,
            "N": self.N,
            "H": self.H,
            "R": self.R,
            "computed_at": self.computed_at,
            "vector": list(self.as_vector()),
        }


# ═══════════════════════════════════════════════════════════════
# Two-Sided Market Clearing
# ═══════════════════════════════════════════════════════════════

@dataclass
class CompanyUtility:
    """U_C(E) = p_E × V_E + I_E + R_E - C_E - Risk_E

    V_E: direct expected value
    I_E: information value
    R_E: reusable primitive value
    C_E: capital/resource cost
    Risk_E: risk-adjusted cost
    """
    p_e: float = 0.0  # probability of success
    V_e: float = 0.0  # direct expected value
    I_e: float = 0.0  # information value
    R_e: float = 0.0  # reusable primitive value
    C_e: float = 0.0  # capital/resource cost
    Risk_e: float = 0.0  # risk-adjusted cost

    @property
    def utility(self) -> float:
        return self.p_e * self.V_e + self.I_e + self.R_e - self.C_e - self.Risk_e

    def to_dict(self) -> dict[str, Any]:
        return {
            "p_e": self.p_e,
            "V_e": self.V_e,
            "I_e": self.I_e,
            "R_e": self.R_e,
            "C_e": self.C_e,
            "Risk_e": self.Risk_e,
            "utility": self.utility,
        }


@dataclass
class EmployeeUtility:
    """U_P(E) = CareerCapital + SkillAppreciation + Scope + NetworkLeverage
               - PoliticalRisk - ReplacementExposure - OpportunityCost
    """
    career_capital: float = 0.0
    skill_appreciation: float = 0.0
    scope: float = 0.0
    network_leverage: float = 0.0
    political_risk: float = 0.0
    replacement_exposure: float = 0.0
    opportunity_cost: float = 0.0

    @property
    def utility(self) -> float:
        return (
            self.career_capital
            + self.skill_appreciation
            + self.scope
            + self.network_leverage
            - self.political_risk
            - self.replacement_exposure
            - self.opportunity_cost
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "career_capital": self.career_capital,
            "skill_appreciation": self.skill_appreciation,
            "scope": self.scope,
            "network_leverage": self.network_leverage,
            "political_risk": self.political_risk,
            "replacement_exposure": self.replacement_exposure,
            "opportunity_cost": self.opportunity_cost,
            "utility": self.utility,
        }


class GovernorDecision(str, Enum):
    SAFE = "SAFE"
    REVIEW = "REVIEW"
    BLOCKED = "BLOCKED"


@dataclass
class GovernorAssessment:
    """Governor(E) = SAFE | REVIEW | BLOCKED

    Checks compliance, privacy, consent, medical governance, auditability.
    """
    decision: GovernorDecision = GovernorDecision.SAFE
    compliance_flags: list[str] = field(default_factory=list)
    privacy_flags: list[str] = field(default_factory=list)
    consent_verified: bool = True
    medical_governance_approved: bool = True
    audit_trail_complete: bool = True
    notes: str = ""

    @property
    def is_safe(self) -> bool:
        return self.decision == GovernorDecision.SAFE

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision.value,
            "compliance_flags": self.compliance_flags,
            "privacy_flags": self.privacy_flags,
            "consent_verified": self.consent_verified,
            "medical_governance_approved": self.medical_governance_approved,
            "audit_trail_complete": self.audit_trail_complete,
            "notes": self.notes,
        }


@dataclass
class ClearingResult:
    """CLEAR(E) = CompanyYES ∧ EmployeeYES ∧ GovernorSAFE

    The experiment clears only when all three conditions are met.
    That is much stronger than a ranking score.
    """
    experiment_id: str = ""
    company_utility: CompanyUtility = field(default_factory=CompanyUtility)
    employee_utility: EmployeeUtility = field(default_factory=EmployeeUtility)
    governor: GovernorAssessment = field(default_factory=GovernorAssessment)

    @property
    def company_yes(self) -> bool:
        return self.company_utility.utility > 0

    @property
    def employee_yes(self) -> bool:
        return self.employee_utility.utility > 0

    @property
    def governor_safe(self) -> bool:
        return self.governor.is_safe

    @property
    def clears(self) -> bool:
        """CLEAR(E) = CompanyYES ∧ EmployeeYES ∧ GovernorSAFE"""
        return self.company_yes and self.employee_yes and self.governor_safe

    def to_dict(self) -> dict[str, Any]:
        return {
            "experiment_id": self.experiment_id,
            "company_utility": self.company_utility.to_dict(),
            "employee_utility": self.employee_utility.to_dict(),
            "governor": self.governor.to_dict(),
            "company_yes": self.company_yes,
            "employee_yes": self.employee_yes,
            "governor_safe": self.governor_safe,
            "clears": self.clears,
        }


class MarketExchange:
    """Two-sided internal market clearing.

    Scarce company assets: money, manager attention, executive attention,
    compute, data access, engineering capacity, legal capacity, operational
    bandwidth, political capital.

    Scarce employee assets: time, attention, domain judgment, credibility,
    relationships, career risk budget, specialized knowledge.

    LAIDER clears both sides simultaneously. That is the economic control plane.
    """

    def __init__(self) -> None:
        self._clearings: dict[str, ClearingResult] = {}

    def clear(
        self,
        experiment_id: str,
        company: CompanyUtility,
        employee: EmployeeUtility,
        governor: GovernorAssessment,
    ) -> ClearingResult:
        """Evaluate whether an experiment clears the two-sided market."""
        result = ClearingResult(
            experiment_id=experiment_id,
            company_utility=company,
            employee_utility=employee,
            governor=governor,
        )
        self._clearings[experiment_id] = result
        return result

    def get(self, experiment_id: str) -> Optional[ClearingResult]:
        return self._clearings.get(experiment_id)

    def all_clearings(self) -> list[ClearingResult]:
        return list(self._clearings.values())

    def cleared_experiments(self) -> list[ClearingResult]:
        return [c for c in self._clearings.values() if c.clears]

    def blocked_experiments(self) -> list[ClearingResult]:
        return [c for c in self._clearings.values() if not c.clears]

    def summary(self) -> dict[str, Any]:
        cleared = self.cleared_experiments()
        blocked = self.blocked_experiments()
        return {
            "total_evaluated": len(self._clearings),
            "cleared": len(cleared),
            "blocked": len(blocked),
            "clear_rate": len(cleared) / max(len(self._clearings), 1),
        }
