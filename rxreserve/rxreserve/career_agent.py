from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional
from uuid import uuid4

from rxreserve.ancestry import InnovationAncestry
from rxreserve.hcp import HCPOpportunityObject, HCPJourneyState, HCPChannel, EngagementOpportunity
from rxreserve.conversion_graph import ConversionGraph
from rxreserve.franchise import FranchiseKnowledgeGraph


# ─── Employee Career Agent ───
# Models: promotion probability, automation/replacement risk, manager perception,
# visibility deficit, network centrality, revenue contribution, innovation contribution,
# cross-functional influence.
#
# Instead of telling the employee to "work harder," it manufactures valuable opportunities.
#
# Optimization function:
# max(EmployeeCareerValue + CompanyEnterpriseValue + HCPRelevance)
# subject to: Compliance, Privacy, Consent, MedicalGovernance, ApprovedClaims


@dataclass
class EmployeeCareerState:
    """Continuous model of an employee's career trajectory."""
    employee_id: str = ""
    name: str = ""
    role: str = ""
    territory: str = ""
    manager: str = ""

    # Career metrics
    promotion_probability: float = 0.0
    automation_risk: float = 0.0
    manager_perception: float = 0.5
    visibility_deficit: float = 0.5
    network_centrality: float = 0.0
    revenue_contribution: float = 0.0
    innovation_contribution: float = 0.0
    cross_functional_influence: float = 0.0

    # Innovation ancestry
    monster_metric: float = 0.0
    direct_value: float = 0.0
    derivative_value: float = 0.0

    # HCP engagement metrics
    hcps_covered: int = 0
    hcps_engaged: int = 0
    hcps_converted: int = 0
    engagement_quality: float = 0.0

    # Opportunities
    active_opportunities: list[str] = field(default_factory=list)
    recommended_actions: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "employee_id": self.employee_id,
            "name": self.name,
            "role": self.role,
            "territory": self.territory,
            "manager": self.manager,
            "promotion_probability": round(self.promotion_probability, 4),
            "automation_risk": round(self.automation_risk, 4),
            "manager_perception": round(self.manager_perception, 4),
            "visibility_deficit": round(self.visibility_deficit, 4),
            "network_centrality": round(self.network_centrality, 4),
            "revenue_contribution": self.revenue_contribution,
            "innovation_contribution": round(self.innovation_contribution, 4),
            "cross_functional_influence": round(self.cross_functional_influence, 4),
            "monster_metric": round(self.monster_metric, 2),
            "direct_value": round(self.direct_value, 2),
            "derivative_value": round(self.derivative_value, 2),
            "hcps_covered": self.hcps_covered,
            "hcps_engaged": self.hcps_engaged,
            "hcps_converted": self.hcps_converted,
            "engagement_quality": round(self.engagement_quality, 4),
            "active_opportunities": self.active_opportunities,
            "recommended_actions": self.recommended_actions,
        }


class CareerAgent:
    """The Employee Career Agent.

    Continuously asks: What can this employee do today that simultaneously
    increases company value and makes this employee harder to replace?
    """

    def __init__(
        self,
        ancestry: InnovationAncestry,
        conversion_graph: ConversionGraph,
        franchise_kg: FranchiseKnowledgeGraph,
    ):
        self.ancestry = ancestry
        self.conversion_graph = conversion_graph
        self.franchise_kg = franchise_kg

    def assess(self, employee_id: str, name: str = "", role: str = "", territory: str = "") -> EmployeeCareerState:
        """Build a complete career assessment for an employee."""
        state = EmployeeCareerState(employee_id=employee_id, name=name, role=role, territory=territory)

        # Innovation ancestry → monster metric
        monster = self.ancestry.compute_monster_metric(employee_id)
        state.monster_metric = monster["M_i"]
        state.direct_value = monster["direct_value"]
        state.derivative_value = monster["derivative_value"]
        state.innovation_contribution = min(1.0, state.monster_metric / 500000) if state.monster_metric > 0 else 0.0

        # HCP engagement from conversion graph
        emp_node = f"emp:{employee_id}"
        if emp_node in self.conversion_graph.graph:
            hcp_count = 0
            engaged = 0
            converted = 0
            for _, target, edge_data in self.conversion_graph.graph.edges(emp_node, data=True):
                if edge_data.get("relationship") in ("covers", "scientific_engagement"):
                    hcp_count += 1
                    hcp_data = self.conversion_graph.graph.nodes[target]
                    journey = hcp_data.get("journey_state", "unknown")
                    if journey in ("engaged", "educated", "objection_discovered", "evidence_delivered"):
                        engaged += 1
                    if journey in ("appropriate_clinical_consideration", "continued_engagement"):
                        converted += 1
            state.hcps_covered = hcp_count
            state.hcps_engaged = engaged
            state.hcps_converted = converted
            state.engagement_quality = converted / max(1, hcp_count)

            # Revenue contribution: sum of addressable_value from converted HCPs
            total_revenue = 0.0
            for _, target, edge_data in self.conversion_graph.graph.edges(emp_node, data=True):
                if edge_data.get("relationship") in ("covers", "scientific_engagement"):
                    hcp_data = self.conversion_graph.graph.nodes[target]
                    journey = hcp_data.get("journey_state", "unknown")
                    if journey in ("appropriate_clinical_consideration", "continued_engagement"):
                        total_revenue += hcp_data.get("addressable_value", 0.0)
            state.revenue_contribution = total_revenue

        # Network centrality
        if emp_node in self.conversion_graph.graph:
            degree = self.conversion_graph.graph.degree(emp_node)
            state.network_centrality = min(1.0, degree / 50)  # normalize

        # Promotion probability: combination of innovation, engagement, and visibility
        state.promotion_probability = (
            state.innovation_contribution * 0.3
            + state.engagement_quality * 0.3
            + (1 - state.visibility_deficit) * 0.2
            + state.network_centrality * 0.2
        )

        # Automation risk: high if low innovation and low engagement
        state.automation_risk = max(0.0, 1.0 - state.innovation_contribution * 2 - state.engagement_quality)

        # Cross-functional influence: based on network diversity
        if emp_node in self.conversion_graph.graph:
            neighbor_types = set()
            for neighbor in self.conversion_graph.graph.neighbors(emp_node):
                neighbor_types.add(self.conversion_graph.graph.nodes[neighbor].get("type"))
            state.cross_functional_influence = min(1.0, len(neighbor_types) / 5)

        return state

    def recommend(self, state: EmployeeCareerState) -> list[dict[str, Any]]:
        """Manufacture valuable opportunities for the employee.

        Instead of telling the employee to "work harder," it manufactures
        valuable opportunities.
        """
        recommendations = []

        # 1. If automation risk is high, recommend innovation
        if state.automation_risk > 0.5:
            recommendations.append({
                "priority": "critical",
                "action": "Identify an operational gap in your territory and submit it as a PharmaFrontier",
                "rationale": f"Your automation risk is {state.automation_risk:.0%}. Innovation is your moat.",
                "expected_career_impact": "Reduces automation risk by 30-50% if frontier is canonicalized",
            })

        # 2. If visibility deficit is high, recommend engagement opportunity
        if state.visibility_deficit > 0.5:
            recommendations.append({
                "priority": "high",
                "action": "Join or originate an EngagementOpportunity that generalizes to other territories",
                "rationale": f"Your visibility deficit is {state.visibility_deficit:.0%}. Cross-territory contributions increase manager perception.",
                "expected_career_impact": "Increases manager perception and promotion probability",
            })

        # 3. Find HCPs with unresolved barriers in their territory
        if state.hcps_covered > 0:
            unresolved_hcps = state.hcps_covered - state.hcps_converted
            if unresolved_hcps > 5:
                recommendations.append({
                    "priority": "high",
                    "action": f"{unresolved_hcps} HCPs in your territory show unresolved engagement gaps. Use the Franchise Knowledge Graph to find approved evidence paths.",
                    "rationale": "Each converted HCP contributes ~$50K in enterprise value and increases your innovation contribution.",
                    "expected_career_impact": f"Converting 20% more HCPs would add ${unresolved_hcps * 0.2 * 50000:,.0f} in value",
                })

        # 4. If innovation contribution is low, recommend discovering a pattern
        if state.innovation_contribution < 0.2:
            recommendations.append({
                "priority": "medium",
                "action": "Look for a repeating objection or barrier across multiple HCPs. If you find one, canonicalize it as an EngagementOpportunity.",
                "rationale": "Employees who discover generalizable patterns have higher M_i scores and promotion rates.",
                "expected_career_impact": "Originating one validated opportunity can generate derivative value across the organization",
            })

        # 5. If network centrality is low, recommend cross-functional collaboration
        if state.network_centrality < 0.3:
            recommendations.append({
                "priority": "medium",
                "action": "Coordinate with Medical Affairs on a shared HCP engagement plan",
                "rationale": "Cross-functional collaboration increases network centrality and visibility.",
                "expected_career_impact": "Improves promotion probability and cross-functional influence scores",
            })

        state.recommended_actions = recommendations
        return recommendations


# ─── The Flywheel ───
# Employee → Opportunity → Experiment → HCP → Outcome → Evidence → Employee
#
# One employee discovers something useful.
# LAIDER detects that it generalizes to 600 other HCPs.
# It recruits 20 employees to validate it.
# Their results create evidence.
# The organization discovers which intervention actually works.
# The originating employee receives attribution.
# Other employees see that participation produces promotions, recognition, etc.
# More employees therefore contribute opportunities.
# More opportunities improve the physician-engagement engine.


@dataclass
class FlywheelState:
    """The two compounding networks:
    1. Employee network effect: Employees ↑ → organizational intelligence ↑
    2. HCP learning effect: HCP interactions ↑ → engagement intelligence ↑
    """
    employees_active: int = 0
    opportunities_generated: int = 0
    experiments_running: int = 0
    hcps_engaged: int = 0
    outcomes_verified: int = 0
    evidence_accumulated: int = 0
    total_value_created: float = 0.0
    total_derivative_value: float = 0.0
    employees_promoted: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "employees_active": self.employees_active,
            "opportunities_generated": self.opportunities_generated,
            "experiments_running": self.experiments_running,
            "hcps_engaged": self.hcps_engaged,
            "outcomes_verified": self.outcomes_verified,
            "evidence_accumulated": self.evidence_accumulated,
            "total_value_created": round(self.total_value_created, 2),
            "total_derivative_value": round(self.total_derivative_value, 2),
            "employees_promoted": self.employees_promoted,
        }


class Flywheel:
    """Orchestrates the flywheel: employee → opportunity → experiment →
    HCP → outcome → evidence → employee.

    Two compounding networks operating simultaneously:
    - Employee network effect
    - HCP learning effect
    """

    def __init__(
        self,
        ancestry: InnovationAncestry,
        conversion_graph: ConversionGraph,
        franchise_kg: FranchiseKnowledgeGraph,
    ):
        self.ancestry = ancestry
        self.conversion_graph = conversion_graph
        self.franchise_kg = franchise_kg
        self.opportunities: dict[str, EngagementOpportunity] = {}

    def register_opportunity(self, opp: EngagementOpportunity) -> None:
        """An employee discovers a pattern that works. LAIDER canonicalizes it."""
        self.opportunities[opp.opportunity_id] = opp

        # Add to ancestry graph
        self.ancestry.add_employee(opp.originating_employee)
        gap_id = f"gap_{opp.opportunity_id[:8]}"
        self.ancestry.add_gap(gap_id, opp.barrier)
        self.ancestry.employee_discovered_gap(opp.originating_employee, gap_id)

        intv_id = f"intv_{opp.opportunity_id[:8]}"
        self.ancestry.add_intervention(intv_id, opp.intervention)
        self.ancestry.employee_originated_intervention(opp.originating_employee, intv_id)
        self.ancestry.gap_addressed_by_intervention(gap_id, intv_id)

    def validate_opportunity(self, opportunity_id: str, cohort_size: int, success_rate: float, value: float) -> None:
        """An experiment validates the opportunity. Attribution is retained."""
        opp = self.opportunities.get(opportunity_id)
        if not opp:
            return

        opp.validation_cohort_size = cohort_size
        opp.validation_success_rate = success_rate
        opp.experiment_status = "validated"
        opp.estimated_value = value

        # Add value to ancestry
        exp_id = f"exp_{opportunity_id[:8]}"
        val_id = f"val_{opportunity_id[:8]}"
        self.ancestry.add_experiment(exp_id, opp.intervention)
        self.ancestry.add_value(val_id, value, opp.intervention)
        self.ancestry.intervention_tested_by_experiment(f"intv_{opportunity_id[:8]}", exp_id)
        self.ancestry.experiment_generated_value(exp_id, val_id)

    def create_derivative(self, parent_opportunity_id: str, deriv_id: str, value: float, alpha: float = 0.3) -> None:
        """A derivative innovation built on the original. The originator retains attribution."""
        parent = self.opportunities.get(parent_opportunity_id)
        if not parent:
            return

        parent.derivative_opportunities.append(deriv_id)
        self.ancestry.add_derivative(deriv_id, value, f"Derivative of {parent.barrier}")
        self.ancestry.value_derived_from(f"val_{parent_opportunity_id[:8]}", deriv_id, alpha)

    def magnify_to_capability(self, opportunity_id: str, capability_id: str, description: str) -> None:
        """A validated opportunity becomes an enterprise capability.

        site → enterprise, workflow → platform, single indication → reusable capability
        """
        opp = self.opportunities.get(opportunity_id)
        if not opp:
            return
        self.ancestry.add_capability(capability_id, description)
        self.ancestry.derivative_magnified_into_capability(f"deriv_{opportunity_id[:8]}", capability_id)

    def state(self) -> FlywheelState:
        """Current flywheel state."""
        return FlywheelState(
            employees_active=len({o.originating_employee for o in self.opportunities.values()}),
            opportunities_generated=len(self.opportunities),
            experiments_running=sum(1 for o in self.opportunities.values() if o.experiment_status == "proposed"),
            hcps_engaged=sum(o.addressable_hcps for o in self.opportunities.values()),
            outcomes_verified=sum(1 for o in self.opportunities.values() if o.experiment_status == "validated"),
            evidence_accumulated=self.franchise_kg.summary().get("active_evidence", 0),
            total_value_created=sum(o.estimated_value for o in self.opportunities.values()),
            total_derivative_value=sum(
                self.ancestry.compute_monster_metric(o.originating_employee)["derivative_value"]
                for o in self.opportunities.values()
            ),
        )
