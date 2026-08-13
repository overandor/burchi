from __future__ import annotations

import asyncio
import json
from dataclasses import asdict
from datetime import datetime, timezone
from uuid import uuid4
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from rxreserve.database import Database
from rxreserve.models import (
    PharmaFrontier,
    FrontierState,
    ExperimentContract,
    ConditionalInnovationOption,
    EvidenceEnvelope,
    ContributionEnvelope,
    RightsEnvelope,
    SettlementEnvelope,
    PriorArtState,
    RightsOwner,
    ConfidentialityLevel,
    SettlementState,
    evaluate_predicate_group,
)
from rxreserve.gapswat import (
    GapAssessment,
    StrategicAdvantage,
    AttributionAssessment,
    TransformAssessment,
    TransformType,
    GapSWATUnderwriter,
)
from rxreserve.pricing import Scenario, ScenarioSet, ScenarioPricer, ExperimentValuation
from rxreserve.wargame import WarGame
from rxreserve.hcp import (
    HCPOpportunityObject,
    HCPInteraction,
    HCPJourneyState,
    HCPChannel,
    EngagementOpportunity,
    HCP_TRANSITIONS,
)
from rxreserve.conversion_graph import ConversionGraph
from rxreserve.franchise import FranchiseKnowledgeGraph, seed_biktarvy_descovy
from rxreserve.ancestry import InnovationAncestry
from rxreserve.career_agent import CareerAgent, Flywheel
from rxreserve.task_completion import (
    TaskCompletionEngine,
    EmailTask,
    TaskType,
    TaskStatus,
)
from rxreserve.mailos import MailObject, ObligationStatus, VerificationReceipt
from rxreserve.mailos_engine import RxMailOS, ResponseDebtLedger, EngagementDiagnostic


# --- MailOS Request models ---

class MailIngestRequest(BaseModel):
    from_address: str
    from_name: str = ""
    from_type: str = "rep"
    to: list[str] = []
    subject: str = ""
    body: str = ""
    timestamp: str = ""
    mailbox: str = "inbox"
    hcp_id: str = ""
    employee_id: str = ""
    use_llm: bool = False

class MailOSAssignRequest(BaseModel):
    owner: str
    team: str = ""

class MailOSExecuteRequest(BaseModel):
    evidence: str

class MailOSVerifyRequest(BaseModel):
    verifier: str
    signal: str = ""
    signal_source: str = ""


# --- Request models ---

class FrontierCreate(BaseModel):
    problem: str
    unknowns: list[str] = []
    economic_consequence: str = ""
    quality_patient_consequence: str = ""
    current_workaround: str = ""
    regulatory_domain: str = ""
    cost_of_learning: float = 0.0
    maximum_upside: float = 0.0
    human_originators: list[str] = []
    ai_contribution: str = ""
    source_signal: str = ""
    source_system: str = ""
    employee_observation: str = ""
    evidence_confidence: float = 0.0
    human_verified: bool = False
    human_contribution: str = ""
    ai_candidates: list[str] = []
    human_selection: str = ""
    human_modifications: str = ""
    rights_owner: str = "unresolved"
    jurisdiction: str = ""
    governing_agreement: str = ""


class TransitionRequest(BaseModel):
    target_state: str
    actor: str = ""
    notes: str = ""


class ExperimentCreate(BaseModel):
    frontier_id: str
    hypothesis: str
    capital_committed: float = 0.0
    owners: list[str] = []
    measurement_rules: str = ""
    stop_conditions: list[str] = []
    evidence_requirements: list[str] = []
    duration_days: int = 14
    target_metric: str = ""
    target_improvement: float = 0.0
    kill_threshold: float = 0.05
    expansion_threshold: float = 0.20


class OptionCreate(BaseModel):
    frontier_id: str
    experiment_id: str = ""
    reactivation_predicates: list[dict[str, Any]] = []
    p_technical: float = 0.5
    p_regulatory: float = 0.7
    benefit: float = 0.0
    cost: float = 0.0
    dependencies: list[str] = []
    time_horizon_days: int = 365


class ReactivationCheck(BaseModel):
    metrics: dict[str, float] = {}
    events: list[str] = []


class GapSWATRequest(BaseModel):
    impact: float = 0.5
    frequency: float = 0.5
    unmetness: float = 0.5
    proprietary_data: float = 0.0
    domain_expertise: float = 0.0
    existing_infrastructure: float = 0.0
    regulatory_position: float = 0.0
    distribution: float = 0.0
    employee_observed: str = ""
    employee_originated: str = ""
    ai_generated: str = ""
    existed_independently: str = ""
    would_happen_anyway: str = ""
    transform_type: str = "none"
    magnification_factor: float = 1.0
    transform_description: str = ""


class ExperimentValueRequest(BaseModel):
    cost: float
    success_upside: float
    probability_success: float
    planned_rollout_cost: float = 0.0
    prob_invalidates_rollout: float = 0.0


class PriceRequest(BaseModel):
    rollout_cost: float = 0.0
    prob_invalidate: float = 0.15


# --- LAIDER Request models ---

class HCPCreate(BaseModel):
    name: str
    specialty: str = ""
    institution: str = ""
    territory: str = ""
    npi: str = ""
    journey: str = "unknown"
    channel: str = "in_person"
    rep: str = ""
    msl: str = ""
    kol: bool = False
    educator: bool = False
    panel: int = 0
    areas: list[str] = []
    barriers: list[str] = []
    needs: list[str] = []


class HCPTransitionReq(BaseModel):
    target: str


class InteractionCreate(BaseModel):
    hcp_id: str
    employee_id: str
    channel: str = "in_person"
    topic: str = ""
    question: str = ""
    objection: str = ""
    evidence: str = ""
    asset: str = ""
    outcome: str = ""
    next_action: str = ""


class EvidencePathReq(BaseModel):
    question: str
    channel: str = ""
    role: str = ""


class OpportunityCreate(BaseModel):
    employee: str
    frontier_id: str = ""
    barrier: str
    intervention: str
    assets: list[str] = []
    sequence: str = ""
    cohort: int = 0
    success_rate: float = 0.0
    addressable: int = 0
    accounts: int = 0
    value: float = 0.0
    experiment: str = ""


class CareerAssessReq(BaseModel):
    name: str = ""
    role: str = ""
    territory: str = ""


class TaskDefineRequest(BaseModel):
    hcp_id: str
    employee_id: str
    task_type: str = "barrier_resolution"
    barrier: str = ""
    question: str = ""
    objection: str = ""
    channel: str = "email"
    role: str = "rep"


class TaskDeliveryRequest(BaseModel):
    opened: bool = False
    clicked: bool = False


class TaskCompleteRequest(BaseModel):
    barrier_resolved: bool = False
    question_answered: bool = False


# ─── Design Genome request models (module-level for Pydantic) ───

class DistinctionContractRequest(BaseModel):
    project_name: str
    brief: str = ""
    emotions: list[str] = []
    spatial_signature: str = ""
    interaction_primitive: str = ""
    forbidden_cliche: str = ""
    typography_doctrine: str = ""
    motion_doctrine: str = ""
    density_rule: str = ""
    unique_feature: str = ""

class ProjectCreateRequest(BaseModel):
    project_name: str
    product_category: str = ""
    audience: str = ""
    mood: str = ""
    interaction_purpose: str = ""

class PreferenceRequest(BaseModel):
    project_id: str
    design_decision: str
    user_behavior: str = ""
    measured_outcome: str = ""
    outcome_metric: str = ""
    outcome_value: float = 0.0
    human_preference_score: float = 0.0
    context_tags: list[str] = []


# --- Proprietary System request models (module-level for FastAPI) ---

class RepProfileRequest(BaseModel):
    rep_id: str
    name: str = ""
    role: str = "representative"
    territory_id: str = ""


class MSLResponseRequest(BaseModel):
    response: str
    references: list[str] = []


class TerritoryDefineRequest(BaseModel):
    territory_id: str
    rep_id: str
    hcp_assignments: list[dict] = []
    constraints: dict = {}
    commit_message: str = ""


class FragmentIngestRequest(BaseModel):
    source_type: str = "document"
    source_location: str = ""
    content: str = ""


class TrustSignalRequest(BaseModel):
    signal_type: str
    signal_value: float = None
    weight: float = 1.0
    source: str = ""
    description: str = ""


class TouchClassifyRequest(BaseModel):
    hcp_id: str
    rep_id: str = ""
    planned_channel: str = "in_person"
    touch_reason: str = ""
    hcp_intent: str = ""
    hcp_trust: float = 0.5
    is_kol: bool = False


class AccessStatusRequest(BaseModel):
    status: str
    reason: str = ""
    channels: list[str] = []


class GraphNodeRequest(BaseModel):
    node_type: str
    label: str
    properties: dict = {}


class GraphEdgeRequest(BaseModel):
    source_id: str
    target_id: str
    relation: str
    weight: float = 1.0
    properties: dict = {}


class GovernanceActionRequest(BaseModel):
    agent_id: str
    agent_type: str
    hcp_id: str
    channel: str = ""
    action_type: str = ""


class GovernanceRuleRequest(BaseModel):
    rule_type: str
    description: str
    priority: int = 1


class LoopStartRequest(BaseModel):
    hcp_id: str
    rep_id: str = ""
    agent_id: str = ""
    description: str = ""


class AttributionRequest(BaseModel):
    human_contribution: float
    ai_contribution: float
    verified_value: float
    value_type: str = ""


class SettleRequest(BaseModel):
    employee_credit: float
    economic_settlement: float = 0.0


class CompetitorSignalRequest(BaseModel):
    competitor: str
    signal_type: str
    description: str
    source: str = ""
    source_url: str = ""
    affected_drugs: list[str] = []


class StrategyCreateRequest(BaseModel):
    name: str
    description: str = ""
    target_hcp_count: int = 100
    channel_mix: dict = {}
    touch_frequency_per_month: int = 2
    content_type: str = "clinical"
    msl_involvement: float = 0.3
    territory_optimization: bool = False
    fatigue_awareness: bool = True
    trust_threshold: float = 0.5


class KPIRecordRequest(BaseModel):
    kpi_name: str
    value: float
    notes: str = ""


class SystemCostRequest(BaseModel):
    system_name: str
    implementation_cost: float
    operating_cost_monthly: float


def create_app(db_path: str = "rxreserve.db") -> FastAPI:
    app = FastAPI(title="RxReserve", description="Pharmaceutical Frontier Reserve")
    db = Database(db_path)

    @app.get("/api/frontiers")
    def list_frontiers(state: Optional[str] = None):
        if state:
            frontiers = db.get_frontiers_by_state(FrontierState(state))
        else:
            frontiers = db.get_all_frontiers()
        return [f.to_dict() for f in frontiers]

    @app.get("/api/frontiers/{frontier_id}")
    def get_frontier(frontier_id: str):
        f = db.get_frontier(frontier_id)
        if not f:
            raise HTTPException(404, "Frontier not found")
        return f.to_dict()

    @app.post("/api/frontiers")
    def create_frontier(req: FrontierCreate):
        f = PharmaFrontier(
            problem=req.problem, unknowns=req.unknowns,
            economic_consequence=req.economic_consequence,
            quality_patient_consequence=req.quality_patient_consequence,
            current_workaround=req.current_workaround,
            regulatory_domain=req.regulatory_domain,
            cost_of_learning=req.cost_of_learning,
            maximum_upside=req.maximum_upside,
            human_originators=req.human_originators,
            ai_contribution=req.ai_contribution,
        )
        f.evidence_envelope = EvidenceEnvelope(
            source_signal=req.source_signal, source_system=req.source_system,
            employee_observation=req.employee_observation,
            confidence=req.evidence_confidence, human_verification=req.human_verified,
        )
        f.contribution_envelope = ContributionEnvelope(
            human_originators=req.human_originators,
            human_contribution=req.human_contribution,
            ai_generated_candidates=req.ai_candidates,
            human_selection=req.human_selection,
            human_modifications=req.human_modifications,
        )
        f.rights_envelope = RightsEnvelope(
            rights_owner=RightsOwner(req.rights_owner),
            jurisdiction=req.jurisdiction,
            governing_agreement=req.governing_agreement,
        )
        db.upsert_frontier(f)
        return f.to_dict()

    @app.post("/api/frontiers/{frontier_id}/transition")
    def transition(frontier_id: str, req: TransitionRequest):
        try:
            f = db.transition_frontier(frontier_id, FrontierState(req.target_state), req.actor, req.notes)
            return f.to_dict()
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.get("/api/frontiers/{frontier_id}/history")
    def get_history(frontier_id: str):
        return db.get_state_history(frontier_id)

    @app.delete("/api/frontiers/{frontier_id}")
    def delete_frontier(frontier_id: str):
        db.delete_frontier(frontier_id)
        return {"deleted": frontier_id}

    # --- GapSWAT ---

    @app.post("/api/frontiers/{frontier_id}/gapswat")
    def run_gapswat(frontier_id: str, req: GapSWATRequest):
        f = db.get_frontier(frontier_id)
        if not f:
            raise HTTPException(404, "Frontier not found")
        gap = GapAssessment(impact=req.impact, frequency=req.frequency, unmetness=req.unmetness)
        advantage = StrategicAdvantage(
            proprietary_data=req.proprietary_data, domain_expertise=req.domain_expertise,
            existing_infrastructure=req.existing_infrastructure, regulatory_position=req.regulatory_position,
            distribution=req.distribution,
        )
        attribution = AttributionAssessment(
            employee_observed=req.employee_observed, employee_originated=req.employee_originated,
            ai_generated=req.ai_generated, existed_independently=req.existed_independently,
            would_happen_anyway=req.would_happen_anyway,
        )
        transform = TransformAssessment(
            transform_type=TransformType(req.transform_type),
            magnification_factor=req.magnification_factor,
            description=req.transform_description,
        )
        underwriter = GapSWATUnderwriter()
        report = underwriter.underwrite(f, gap, advantage, attribution, transform)
        return report.to_dict()

    # --- War-Game ---

    @app.post("/api/frontiers/{frontier_id}/wargame")
    def run_wargame(frontier_id: str):
        f = db.get_frontier(frontier_id)
        if not f:
            raise HTTPException(404, "Frontier not found")
        wg = WarGame()
        results = wg.run(f)
        return wg.summary(results)

    # --- Pricing ---

    @app.post("/api/frontiers/{frontier_id}/price")
    def price_frontier(frontier_id: str, req: PriceRequest):
        f = db.get_frontier(frontier_id)
        if not f:
            raise HTTPException(404, "Frontier not found")
        pricer = ScenarioPricer()
        scenarios = ScenarioSet(
            technical=[Scenario("success", 0.6, 1.0), Scenario("partial", 0.3, 0.5), Scenario("fail", 0.1, 0.0)],
            regulatory=[Scenario("clear", 0.7, 1.0), Scenario("conditional", 0.2, 0.7), Scenario("block", 0.1, 0.0)],
            adoption=[Scenario("high", 0.5, 1.0), Scenario("moderate", 0.4, 0.6), Scenario("low", 0.1, 0.2)],
            evidence=[Scenario("sufficient", 0.7, 1.0), Scenario("insufficient", 0.3, 0.3)],
            economic=[Scenario("positive", 0.6, 1.0), Scenario("marginal", 0.3, 0.5), Scenario("negative", 0.1, 0.0)],
        )
        cost_low = f.cost_of_learning * 0.8 or 50000
        cost_high = f.cost_of_learning * 1.5 or 150000
        val_low = f.maximum_upside * 0.5 or 300000
        val_high = f.maximum_upside * 1.2 or 800000
        pricing = pricer.price_frontier(
            scenarios,
            implementation_cost_range=(cost_low, cost_high),
            annual_value_range=(val_low, val_high),
            downside_range=(cost_low * 0.5, cost_high * 0.8),
            planned_rollout_cost=req.rollout_cost,
            prob_invalidates_rollout=req.prob_invalidate,
        )
        return pricing.to_dict()

    # --- Experiment Value ---

    @app.post("/api/value-experiment")
    def value_exp(req: ExperimentValueRequest):
        val = value_experiment(
            cost=req.cost, success_upside=req.success_upside,
            probability_success=req.probability_success,
            planned_rollout_cost=req.planned_rollout_cost,
            prob_invalidates_rollout=req.prob_invalidates_rollout,
        )
        return val.to_dict()

    # --- Experiments ---

    @app.get("/api/experiments")
    def list_experiments(frontier_id: Optional[str] = None):
        if frontier_id:
            return [e.to_dict() for e in db.get_experiments_by_frontier(frontier_id)]
        return [e.to_dict() for e in db.get_all_experiments()]

    @app.post("/api/experiments")
    def create_experiment(req: ExperimentCreate):
        exp = ExperimentContract(
            frontier_id=req.frontier_id, hypothesis=req.hypothesis,
            capital_committed=req.capital_committed, owners=req.owners,
            measurement_rules=req.measurement_rules, stop_conditions=req.stop_conditions,
            evidence_requirements=req.evidence_requirements, duration_days=req.duration_days,
            target_metric=req.target_metric, target_improvement=req.target_improvement,
            kill_threshold=req.kill_threshold, expansion_threshold=req.expansion_threshold,
        )
        db.upsert_experiment(exp)
        return exp.to_dict()

    # --- Options ---

    @app.get("/api/options")
    def list_options(dormant_only: bool = False):
        if dormant_only:
            return [o.to_dict() for o in db.get_dormant_options()]
        return [o.to_dict() for o in db.get_all_options()]

    @app.post("/api/options")
    def create_option(req: OptionCreate):
        opt = ConditionalInnovationOption(
            frontier_id=req.frontier_id, experiment_id=req.experiment_id,
            reactivation_predicates=req.reactivation_predicates,
            p_technical=req.p_technical, p_regulatory=req.p_regulatory,
            benefit=req.benefit, cost=req.cost,
            dependencies=req.dependencies, time_horizon_days=req.time_horizon_days,
        )
        opt.price()
        db.upsert_option(opt)
        return opt.to_dict()

    @app.post("/api/options/reprice")
    def reprice_all():
        options = db.get_all_options()
        results = []
        for opt in options:
            old = opt.option_value
            opt.price()
            db.upsert_option(opt)
            results.append({"option_id": opt.option_id, "old_value": old, "new_value": opt.option_value})
        return results

    @app.post("/api/options/check-reactivation")
    def check_reactivation(req: ReactivationCheck):
        options = db.get_dormant_options()
        reactivated = []
        for opt in options:
            for pred_group in opt.reactivation_predicates:
                if evaluate_predicate_group(pred_group, req.metrics, req.events):
                    opt.status = "reactivated"
                    db.upsert_option(opt)
                    reactivated.append(opt.to_dict())
                    break
        return {"reactivated": reactivated, "checked": len(options)}

    # ─── LAIDER: HCP endpoints ───

    @app.post("/api/hcps")
    def create_hcp(req: HCPCreate):
        hcp = HCPOpportunityObject(
            name=req.name, specialty=req.specialty, institution=req.institution,
            territory=req.territory, npi=req.npi,
            journey_state=HCPJourneyState(req.journey),
            preferred_channel=HCPChannel(req.channel),
            assigned_rep=req.rep, assigned_msl=req.msl,
            kol_status=req.kol, educator_status=req.educator,
            patient_panel_size=req.panel, therapeutic_areas=req.areas,
            barriers=req.barriers, needs=req.needs,
        )
        db.upsert_hcp(hcp)
        return hcp.to_dict()

    @app.get("/api/hcps")
    def list_hcps(state: str = ""):
        if state:
            return [h.to_dict() for h in db.get_hcps_by_state(HCPJourneyState(state))]
        return [h.to_dict() for h in db.get_all_hcps()]

    @app.get("/api/hcps/{hcp_id}")
    def get_hcp(hcp_id: str):
        hcp = db.get_hcp(hcp_id)
        if not hcp:
            raise HTTPException(404, "HCP not found")
        return hcp.to_dict()

    @app.post("/api/hcps/{hcp_id}/transition")
    def hcp_transition(hcp_id: str, req: HCPTransitionReq):
        hcp = db.get_hcp(hcp_id)
        if not hcp:
            raise HTTPException(404, "HCP not found")
        target = HCPJourneyState(req.target)
        valid = HCP_TRANSITIONS.get(hcp.journey_state, [])
        if target not in valid:
            raise HTTPException(400, f"Invalid transition: {hcp.journey_state.value} → {req.target}")
        hcp.journey_state = target
        from datetime import datetime, timezone
        hcp.last_updated = datetime.now(timezone.utc)
        db.upsert_hcp(hcp)
        return hcp.to_dict()

    # ─── LAIDER: Interactions ───

    @app.post("/api/interactions")
    def create_interaction(req: InteractionCreate):
        from datetime import datetime, timezone
        interaction = HCPInteraction(
            hcp_id=req.hcp_id, employee_id=req.employee_id,
            channel=HCPChannel(req.channel),
            timestamp=datetime.now(timezone.utc).isoformat(),
            topic=req.topic, question_raised=req.question,
            objection_raised=req.objection, evidence_delivered=req.evidence,
            approved_asset_used=req.asset, outcome=req.outcome,
            next_action=req.next_action,
        )
        db.save_interaction(interaction)
        return interaction.to_dict()

    @app.get("/api/interactions/hcp/{hcp_id}")
    def get_hcp_interactions(hcp_id: str):
        return db.get_interactions_for_hcp(hcp_id)

    @app.get("/api/interactions/employee/{employee_id}")
    def get_employee_interactions(employee_id: str):
        return db.get_interactions_for_employee(employee_id)

    # ─── LAIDER: Franchise Knowledge Graph ───

    @app.get("/api/franchise/summary")
    def franchise_summary():
        fkg = seed_biktarvy_descovy()
        return fkg.summary()

    @app.post("/api/franchise/evidence-path")
    def find_evidence_path(req: EvidencePathReq):
        fkg = seed_biktarvy_descovy()
        path = fkg.find_evidence_path(req.question, channel=req.channel, role=req.role)
        return path.to_dict()

    # ─── LAIDER: Engagement Opportunities ───

    @app.post("/api/opportunities")
    def create_opportunity(req: OpportunityCreate):
        opp = EngagementOpportunity(
            originating_employee=req.employee, frontier_id=req.frontier_id,
            barrier=req.barrier, intervention=req.intervention,
            approved_assets=req.assets, sequence=req.sequence,
            initial_cohort_size=req.cohort, initial_success_rate=req.success_rate,
            addressable_hcps=req.addressable, addressable_accounts=req.accounts,
            estimated_value=req.value, proposed_experiment=req.experiment,
        )
        db.upsert_opportunity(opp)
        return opp.to_dict()

    @app.get("/api/opportunities")
    def list_opportunities():
        return [o.to_dict() for o in db.get_all_opportunities()]

    @app.get("/api/opportunities/{opp_id}")
    def get_opportunity(opp_id: str):
        opp = db.get_opportunity(opp_id)
        if not opp:
            raise HTTPException(404, "Opportunity not found")
        return opp.to_dict()

    # ─── LAIDER: Career Agent ───

    def _load_ancestry(db: Database) -> InnovationAncestry:
        ancestry = InnovationAncestry()
        for node in db.load_ancestry_nodes():
            ancestry.graph.add_node(node["node_id"], node_type=node["node_type"],
                                    label=node["label"], value=node["value"], **node["metadata"])
        for edge in db.load_ancestry_edges():
            ancestry.graph.add_edge(edge["source"], edge["target"],
                                    edge_type=edge["edge_type"], weight=edge["weight"], alpha=edge["alpha"])
        return ancestry

    def _load_conversion_graph(db: Database) -> ConversionGraph:
        cg = ConversionGraph()
        for hcp in db.get_all_hcps():
            cg.add_hcp(hcp)
            if hcp.assigned_rep:
                cg.add_employee(hcp.assigned_rep, role="rep")
                cg.link_rep_hcp(hcp.assigned_rep, hcp.hcp_id)
            if hcp.assigned_msl:
                cg.add_employee(hcp.assigned_msl, role="msl")
                cg.link_msl_hcp(hcp.assigned_msl, hcp.hcp_id)
        return cg

    @app.post("/api/career/{employee_id}")
    def assess_career(employee_id: str, req: CareerAssessReq):
        ancestry = _load_ancestry(db)
        cg = _load_conversion_graph(db)
        fkg = seed_biktarvy_descovy()
        agent = CareerAgent(ancestry, cg, fkg)
        state = agent.assess(employee_id, name=req.name, role=req.role, territory=req.territory)
        agent.recommend(state)
        d = state.to_dict()
        db.upsert_career(employee_id, state.name, state.role, state.territory, "", d)
        return d

    @app.get("/api/career/{employee_id}")
    def get_career(employee_id: str):
        career = db.get_career(employee_id)
        if not career:
            raise HTTPException(404, "Career assessment not found")
        return career

    @app.get("/api/career")
    def list_careers():
        return db.get_all_careers()

    # ─── LAIDER: Monster Metric ───

    @app.get("/api/ancestry/monster-metric/{employee_id}")
    def get_monster_metric(employee_id: str):
        ancestry = _load_ancestry(db)
        return ancestry.compute_monster_metric(employee_id)

    @app.get("/api/ancestry/summary")
    def ancestry_summary():
        ancestry = _load_ancestry(db)
        return ancestry.summary()

    # ─── LAIDER: Flywheel ───

    @app.get("/api/flywheel")
    def flywheel_state():
        ancestry = _load_ancestry(db)
        cg = _load_conversion_graph(db)
        fkg = seed_biktarvy_descovy()
        fw = Flywheel(ancestry, cg, fkg)
        for opp in db.get_all_opportunities():
            fw.register_opportunity(opp)
        return fw.state().to_dict()

    # ─── Task Completion (Supremacy over Delivery) ───

    @app.post("/api/tasks/define")
    def define_task(req: TaskDefineRequest):
        hcp = db.get_hcp(req.hcp_id)
        if not hcp:
            raise HTTPException(status_code=404, detail=f"HCP {req.hcp_id} not found")
        fkg = seed_biktarvy_descovy()
        engine = TaskCompletionEngine(fkg)
        task = engine.define_task(
            hcp=hcp, employee_id=req.employee_id,
            task_type=TaskType(req.task_type),
            barrier=req.barrier, question=req.question, objection=req.objection,
            channel=req.channel, role=req.role,
        )
        db.upsert_email_task(task)
        return task.to_dict()

    @app.get("/api/tasks")
    def list_tasks(employee_id: Optional[str] = None, hcp_id: Optional[str] = None):
        if employee_id:
            return [t.to_dict() for t in db.get_email_tasks_for_employee(employee_id)]
        elif hcp_id:
            return [t.to_dict() for t in db.get_email_tasks_for_hcp(hcp_id)]
        return [t.to_dict() for t in db.get_all_email_tasks()]

    @app.get("/api/tasks/{task_id}")
    def get_task(task_id: str):
        task = db.get_email_task(task_id)
        if not task:
            raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
        return task.to_dict()

    @app.post("/api/tasks/{task_id}/delivery")
    def record_delivery(task_id: str, req: TaskDeliveryRequest):
        task = db.get_email_task(task_id)
        if not task:
            raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
        fkg = seed_biktarvy_descovy()
        engine = TaskCompletionEngine(fkg)
        engine.tasks[task.task_id] = task
        engine.record_delivery(task.task_id, opened=req.opened, clicked=req.clicked)
        db.upsert_email_task(engine.tasks[task.task_id])
        return engine.tasks[task.task_id].to_dict()

    @app.post("/api/tasks/{task_id}/complete")
    def complete_task(task_id: str, req: TaskCompleteRequest):
        task = db.get_email_task(task_id)
        if not task:
            raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
        fkg = seed_biktarvy_descovy()
        engine = TaskCompletionEngine(fkg)
        engine.tasks[task.task_id] = task
        engine.mark_completed(task.task_id, barrier_resolved=req.barrier_resolved,
                              question_answered=req.question_answered)
        db.upsert_email_task(engine.tasks[task.task_id])
        return engine.tasks[task.task_id].to_dict()

    @app.post("/api/tasks/{task_id}/verify")
    def verify_task(task_id: str):
        task = db.get_email_task(task_id)
        if not task:
            raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
        hcp = db.get_hcp(task.hcp_id)
        if not hcp:
            raise HTTPException(status_code=404, detail=f"HCP {task.hcp_id} not found")
        fkg = seed_biktarvy_descovy()
        engine = TaskCompletionEngine(fkg)
        engine.tasks[task.task_id] = task
        verified = engine.verify_completion(task.task_id, hcp)
        db.upsert_email_task(engine.tasks[task.task_id])
        return {"verified": verified, "task": engine.tasks[task.task_id].to_dict()}

    @app.get("/api/supremacy-report")
    def supremacy_report(employee_id: Optional[str] = None):
        fkg = seed_biktarvy_descovy()
        engine = TaskCompletionEngine(fkg)
        for task in db.get_all_email_tasks():
            engine.tasks[task.task_id] = task
        return engine.supremacy_report(employee_id=employee_id)

    # ─── MailOS Endpoints ───

    @app.post("/api/mailos/ingest")
    def mailos_ingest(req: MailIngestRequest):
        mail = MailObject(
            from_address=req.from_address, from_name=req.from_name,
            from_type=req.from_type, to_addresses=req.to,
            subject=req.subject, body=req.body,
            timestamp=req.timestamp, mailbox=req.mailbox,
            matched_hcp_id=req.hcp_id, matched_employee_id=req.employee_id,
        )
        db.upsert_mail(mail)
        os = RxMailOS(use_llm=req.use_llm)
        result = os.ingest(mail)
        for o in os.objects.values():
            db.upsert_decomposed_object(o)
        for obl in os.obligations.values():
            db.upsert_obligation(obl)
        for c in os.commitments.values():
            db.upsert_commitment(c)
        for i in os.intents.values():
            db.upsert_intent(i)
        for na in os.negative_actions.values():
            db.upsert_negative_action(na)
        for ev in os.event_bus.events:
            db.upsert_mail_event(ev)
        return result

    @app.get("/api/mailos/obligations")
    def mailos_obligations(status: Optional[str] = None, system: Optional[str] = None):
        obls = db.get_all_obligations()
        if status:
            obls = [o for o in obls if o.status.value == status]
        if system:
            obls = [o for o in obls if o.target_system.value == system]
        return [o.to_dict() for o in obls]

    @app.get("/api/mailos/obligations/{obligation_id}")
    def mailos_get_obligation(obligation_id: str):
        obl = db.get_obligation(obligation_id)
        if not obl:
            raise HTTPException(404, "Obligation not found")
        return obl.to_dict()

    @app.post("/api/mailos/obligations/{obligation_id}/assign")
    def mailos_assign(obligation_id: str, req: MailOSAssignRequest):
        obl = db.get_obligation(obligation_id)
        if not obl:
            raise HTTPException(404, "Obligation not found")
        obl.assigned_owner = req.owner
        obl.assigned_team = req.team
        obl.status = ObligationStatus.ASSIGNED
        obl.status_history.append({"status": "assigned", "timestamp": datetime.now(timezone.utc).isoformat(), "actor": req.owner})
        db.upsert_obligation(obl)
        return obl.to_dict()

    @app.post("/api/mailos/obligations/{obligation_id}/execute")
    def mailos_execute(obligation_id: str, req: MailOSExecuteRequest):
        obl = db.get_obligation(obligation_id)
        if not obl:
            raise HTTPException(404, "Obligation not found")
        obl.evidence_artifact = req.evidence
        obl.status = ObligationStatus.EXECUTED
        obl.status_history.append({"status": "executed", "timestamp": datetime.now(timezone.utc).isoformat(), "actor": obl.assigned_owner})
        db.upsert_obligation(obl)
        return obl.to_dict()

    @app.post("/api/mailos/obligations/{obligation_id}/verify")
    def mailos_verify(obligation_id: str, req: MailOSVerifyRequest):
        obl = db.get_obligation(obligation_id)
        if not obl:
            raise HTTPException(404, "Obligation not found")
        receipt = VerificationReceipt(
            obligation_id=obl.obligation_id,
            verification_method=obl.verification_method,
            evidence_artifact=obl.evidence_artifact,
            verified_by=req.verifier,
            verified_at=datetime.now(timezone.utc).isoformat(),
            independent_signal=req.signal,
            independent_signal_source=req.signal_source,
            is_verified=bool(obl.evidence_artifact),
        )
        obl.status = ObligationStatus.VERIFIED
        obl.verified_by = req.verifier
        obl.verified_at = receipt.verified_at
        obl.closed_at = datetime.now(timezone.utc).isoformat()
        obl.status_history.append({"status": "verified", "timestamp": receipt.verified_at, "actor": req.verifier})
        db.upsert_obligation(obl)
        db.upsert_receipt(receipt)
        return {"obligation": obl.to_dict(), "receipt": receipt.to_dict()}

    @app.get("/api/mailos/debt")
    def mailos_debt():
        obls = db.get_all_obligations()
        return ResponseDebtLedger.compute(obls).to_dict()

    @app.get("/api/mailos/diagnose/{hcp_id}")
    def mailos_diagnose(hcp_id: str):
        mails = db.get_all_mails()
        obls = db.get_all_obligations()
        intents = db.get_all_intents()
        return EngagementDiagnostic.diagnose(hcp_id, mails, obls, intents).to_dict()

    @app.get("/api/mailos/intents")
    def mailos_intents():
        return [i.to_dict() for i in db.get_all_intents()]

    @app.get("/api/mailos/commitments")
    def mailos_commitments():
        return [c.to_dict() for c in db.get_all_commitments()]

    @app.get("/api/mailos/mails")
    def mailos_mails():
        return [m.to_dict() for m in db.get_all_mails()]

    @app.get("/api/mailos/receipts")
    def mailos_receipts():
        return [r.to_dict() for r in db.get_all_receipts()]

    @app.get("/api/mailos/summary")
    def mailos_summary():
        mails = db.get_all_mails()
        obls = db.get_all_obligations()
        intents = db.get_all_intents()
        receipts = db.get_all_receipts()
        pending = [o for o in obls if o.status not in (ObligationStatus.VERIFIED, ObligationStatus.CLOSED)]
        overdue = [o for o in obls if o.status == ObligationStatus.OVERDUE]
        return {
            "mails_ingested": len(mails),
            "obligations_compiled": len(obls),
            "intents_extracted": len(intents),
            "verifications": len(receipts),
            "pending": len(pending),
            "overdue": len(overdue),
        }

    # ─── Email Source Endpoints ───

    @app.post("/api/mailos/imap")
    def mailos_imap_fetch(host: str, port: int = 993, username: str = "",
                          password: str = "", mailbox: str = "INBOX",
                          limit: int = 20, use_llm: bool = True):
        """Fetch emails from an IMAP mailbox and ingest them."""
        from rxreserve.mail_sources import IMAPSource
        source = IMAPSource(host=host, port=port, username=username,
                           password=password, mailbox=mailbox)
        try:
            mails = source.fetch_recent(limit=limit, unseen_only=True)
        except Exception as e:
            raise HTTPException(400, f"IMAP connection failed: {str(e)}")

        results = []
        os_engine = RxMailOS(use_llm=use_llm)
        for mail in mails:
            db.upsert_mail(mail)
            result = os_engine.ingest(mail)
            for o in os_engine.objects.values():
                db.upsert_decomposed_object(o)
            for obl in os_engine.obligations.values():
                db.upsert_obligation(obl)
            for c in os_engine.commitments.values():
                db.upsert_commitment(c)
            for i in os_engine.intents.values():
                db.upsert_intent(i)
            for na in os_engine.negative_actions.values():
                db.upsert_negative_action(na)
            for ev in os_engine.event_bus.events:
                db.upsert_mail_event(ev)
            results.append({
                "from": mail.from_name,
                "subject": mail.subject,
                "objects": len(result.get("objects", [])),
                "obligations": len(result.get("obligations", [])),
            })
        return {"fetched": len(results), "emails": results}

    # ─── Design Genome Runtime ───

    from rxreserve.genome_runtime import DesignGenomeRuntime
    from rxreserve.design_genome import SourceCategory, DistinctionContract

    genome_runtime: Optional[DesignGenomeRuntime] = None

    def _get_genome() -> DesignGenomeRuntime:
        nonlocal genome_runtime
        if genome_runtime is None:
            genome_runtime = DesignGenomeRuntime(db_path=db_path)
        return genome_runtime

    @app.get("/api/genome/state")
    def genome_get_state():
        rt = _get_genome()
        return rt.get_state().to_dict()

    @app.get("/api/genome/summary")
    def genome_summary():
        rt = _get_genome()
        return rt.summary()

    @app.post("/api/genome/acquire")
    def genome_acquire(max_sources: int = 10):
        import asyncio as _asyncio
        rt = _get_genome()
        loop = None
        try:
            loop = _asyncio.new_event_loop()
            result = loop.run_until_complete(rt.run_acquisition_cycle(max_sources=max_sources))
        finally:
            if loop:
                loop.close()
        # Persist to database
        for source in rt.observation_memory._sources.values():
            db.upsert_genome_source(source)
        for obs in rt.observation_memory.all_observations():
            db.upsert_genome_observation(obs)
        for gene in rt.latent_value_memory.all_genes():
            db.upsert_genome_gene(gene)
        db.upsert_genome_state(rt.get_state())
        return result

    @app.post("/api/genome/contract")
    def genome_create_contract(req: DistinctionContractRequest):
        rt = _get_genome()
        contract = rt.create_distinction_contract(
            project_name=req.project_name, brief=req.brief,
            emotions=req.emotions, spatial_signature=req.spatial_signature,
            interaction_primitive=req.interaction_primitive,
            forbidden_cliche=req.forbidden_cliche,
            typography_doctrine=req.typography_doctrine,
            motion_doctrine=req.motion_doctrine,
            density_rule=req.density_rule,
            unique_feature=req.unique_feature,
        )
        db.upsert_genome_contract(contract)
        return contract.to_dict()

    @app.post("/api/genome/project")
    def genome_create_project(req: ProjectCreateRequest, contract_id: str = ""):
        rt = _get_genome()
        contract = rt._contracts.get(contract_id)
        if not contract:
            raise HTTPException(400, "Distinction contract not found. Create one first.")
        project = rt.create_project(
            project_name=req.project_name,
            product_category=req.product_category,
            audience=req.audience, mood=req.mood,
            interaction_purpose=req.interaction_purpose,
            contract=contract,
        )
        db.upsert_genome_project(project)
        return project.to_dict()

    @app.post("/api/genome/experiment")
    def genome_run_experiment(archetype_id: str, benchmark_observation_id: str = "",
                              max_generations: int = 10):
        import asyncio as _asyncio
        rt = _get_genome()
        project = rt._projects.get(archetype_id)
        if not project:
            raise HTTPException(404, "Project not found")
        loop = None
        try:
            loop = _asyncio.new_event_loop()
            result = loop.run_until_complete(rt.run_experiment(
                project, benchmark_observation_id or None, max_generations))
        finally:
            if loop:
                loop.close()
        # Persist results
        for impl in rt.attempt_memory.all_implementations():
            db.upsert_genome_implementation(impl)
        for render in rt.attempt_memory.all_renders():
            db.upsert_genome_render(render)
        for cap in rt.verified_capability_memory._capabilities.values():
            db.upsert_genome_capability(cap)
        if project:
            db.upsert_genome_project(project)
        db.upsert_genome_state(rt.get_state())
        return result

    @app.post("/api/genome/release")
    def genome_release_corpus(version: str = ""):
        rt = _get_genome()
        manifest = rt.release_corpus(version or None)
        db.upsert_genome_manifest(manifest)
        db.upsert_genome_state(rt.get_state())
        return manifest.to_dict()

    @app.get("/api/genome/observations")
    def genome_list_observations():
        return db.get_all_genome_observations()

    @app.get("/api/genome/genes")
    def genome_list_genes(active_only: bool = False):
        return db.get_all_genome_genes(active_only=active_only)

    @app.get("/api/genome/capabilities")
    def genome_list_capabilities(verified_only: bool = False):
        return db.get_all_genome_capabilities(verified_only=verified_only)

    @app.get("/api/genome/projects")
    def genome_list_projects():
        return db.get_all_genome_projects()

    @app.get("/api/genome/manifests")
    def genome_list_manifests():
        return db.get_all_genome_manifests()

    @app.post("/api/genome/preference")
    def genome_record_preference(req: PreferenceRequest):
        rt = _get_genome()
        pref = rt.record_preference(
            project_id=req.project_id,
            design_decision=req.design_decision,
            user_behavior=req.user_behavior,
            measured_outcome=req.measured_outcome,
            outcome_metric=req.outcome_metric,
            outcome_value=req.outcome_value,
            human_preference_score=req.human_preference_score,
            context_tags=req.context_tags,
        )
        db.upsert_genome_preference(pref)
        return pref.to_dict()

    @app.get("/api/genome/failures")
    def genome_list_failures():
        return db.get_all_genome_failures()

    @app.get("/api/genome/transfer-tests")
    def genome_list_transfer_tests():
        return db.get_all_genome_transfer_tests()

    @app.get("/api/genome/skill-weights")
    def genome_skill_weights():
        """Get capabilities ranked by skill weight."""
        rt = _get_genome()
        caps = rt.verified_capability_memory.get_by_weight(limit=20)
        return [
            {
                "capability_id": c.capability_id,
                "name": c.name,
                "status": c.status.value,
                "skill_weight": c.skill_weight,
                "quality_factor": c.quality_factor,
                "transferability_factor": c.transferability_factor,
                "novelty_factor": c.novelty_factor,
                "reliability_factor": c.reliability_factor,
                "saturation_factor": c.saturation_factor,
                "times_retrieved": c.times_retrieved,
                "probe_pass_rate": c.probe_pass_rate,
            }
            for c in caps
        ]

    @app.get("/api/genome/curator")
    def genome_curator_summary():
        """Get Curator population summary."""
        rt = _get_genome()
        return rt.curator.summary()

    @app.get("/api/genome/judge")
    def genome_judge_summary():
        """Get Browser Judge summary."""
        rt = _get_genome()
        return rt.judge.summary()

    # ─── Real Data Sources (OpenFDA, ClinicalTrials.gov, NPI, PubMed) ───

    from rxreserve.real_data_sources import RealDataSources
    _rds: Optional[RealDataSources] = None

    def _get_rds() -> RealDataSources:
        nonlocal _rds
        if _rds is None:
            _rds = RealDataSources()
        return _rds

    @app.get("/api/real/sources")
    def real_sources_summary():
        """List available real public data sources."""
        return _get_rds().summary()

    @app.get("/api/real/drug-labels/{drug_name}")
    def real_drug_labels(drug_name: str, limit: int = 3):
        """Fetch real FDA drug labels from OpenFDA."""
        return [l.__dict__ for l in _get_rds().fetch_drug_labels(drug_name, limit)]

    @app.get("/api/real/adverse-events/{drug_name}")
    def real_adverse_events(drug_name: str, limit: int = 25):
        """Fetch real adverse event reports from OpenFDA FAERS."""
        return [e.__dict__ for e in _get_rds().fetch_adverse_events(drug_name, limit)]

    @app.get("/api/real/clinical-trials")
    def real_clinical_trials(sponsor: str = "Gilead", condition: str = "",
                             limit: int = 20):
        """Fetch real clinical trials from ClinicalTrials.gov."""
        return [t.__dict__ for t in _get_rds().fetch_clinical_trials(sponsor, condition, limit)]

    @app.get("/api/real/hcps")
    def real_hcps(specialty: str = "Infectious Disease", state: str = "CA",
                  limit: int = 10):
        """Fetch real healthcare providers from NPPES NPI Registry."""
        return [h.__dict__ for h in _get_rds().fetch_real_hcps(specialty, state, limit)]

    @app.get("/api/real/pubmed")
    def real_pubmed(query: str, max_results: int = 5):
        """Fetch real published evidence from PubMed."""
        return [e.__dict__ for e in _get_rds().fetch_pubmed_evidence(query, max_results)]

    @app.get("/api/real/drug-classes/{drug_name}")
    def real_drug_classes(drug_name: str):
        """Fetch therapeutic classifications from RxClass."""
        return _get_rds().fetch_drug_classes(drug_name)

    @app.post("/api/real/enrich/defrag")
    def real_enrich_defrag(drug_names: list[str] = None):
        """Enrich the Defragmentation Engine with real FDA + FAERS data."""
        from rxreserve.proprietary import DefragmentationEngine
        engine = DefragmentationEngine()
        stats = _get_rds().enrich_defragmentation_engine(engine, drug_names)
        graph = engine.graph_summary()
        return {"enrichment": stats, "knowledge_graph": graph}

    @app.post("/api/real/enrich/trust/{hcp_id}")
    def real_enrich_trust(hcp_id: str, drug_name: str = "Biktarvy"):
        """Enrich HCP Trust Trajectory with real FAERS adverse event signals."""
        from rxreserve.proprietary import HCPTrustTrajectory
        trust = HCPTrustTrajectory()
        stats = _get_rds().enrich_trust_trajectory(trust, hcp_id, drug_name)
        traj = trust.compute_trajectory(hcp_id)
        return {"enrichment": stats, "trajectory": traj.__dict__}

    # ─── Pharma Crawler (public-record data crawling) ───

    from rxreserve.pharma_crawler import PharmaCrawler
    _crawler: Optional[PharmaCrawler] = None

    def _get_crawler() -> PharmaCrawler:
        nonlocal _crawler
        if _crawler is None:
            _crawler = PharmaCrawler()
        return _crawler

    @app.get("/api/crawl/sources")
    def crawl_sources_summary():
        """List all crawlable public pharma data sources."""
        return _get_crawler().sources_summary()

    @app.get("/api/crawl/open-payments")
    def crawl_open_payments(npi: str = "", year: str = "2023", limit: int = 20):
        """Crawl CMS Open Payments (Sunshine Act) — manufacturer payments to physicians."""
        records = _get_crawler().crawl_open_payments(physician_npi=npi, year=year, limit=limit)
        return [r.__dict__ for r in records]

    @app.get("/api/crawl/orange-book")
    def crawl_orange_book(drug_name: str = "", limit: int = 20):
        """Crawl FDA Orange Book — approved drug products and patent dates."""
        records = _get_crawler().crawl_orange_book(drug_name=drug_name, limit=limit)
        return [r.__dict__ for r in records]

    @app.get("/api/crawl/nih-reporter")
    def crawl_nih_reporter(query: str = "HIV PrEP", limit: int = 20):
        """Crawl NIH RePORTER — federally funded research grants."""
        records = _get_crawler().crawl_nih_reporter(query=query, limit=limit)
        return [r.__dict__ for r in records]

    @app.get("/api/crawl/drug-shortages")
    def crawl_drug_shortages(limit: int = 50):
        """Crawl FDA Drug Shortages database."""
        records = _get_crawler().crawl_drug_shortages(limit=limit)
        return [r.__dict__ for r in records]

    @app.get("/api/crawl/medicaid")
    def crawl_medicaid(state: str = "CA", year: str = "2023", limit: int = 50):
        """Crawl state Medicaid drug utilization data."""
        records = _get_crawler().crawl_medicaid_drug_utilization(state=state, year=year, limit=limit)
        return [r.__dict__ for r in records]

    @app.get("/api/crawl/340b")
    def crawl_340b(state: str = "", limit: int = 50):
        """Crawl 340B covered entities database."""
        records = _get_crawler().crawl_340b_covered_entities(state=state, limit=limit)
        return [r.__dict__ for r in records]

    @app.post("/api/crawl/enrich/trust/{hcp_id}")
    def crawl_enrich_trust(hcp_id: str, npi: str):
        """Enrich HCP Trust Trajectory with real Open Payments data."""
        from rxreserve.proprietary import HCPTrustTrajectory
        trust = HCPTrustTrajectory()
        stats = _get_crawler().enrich_trust_with_payments(trust, npi, hcp_id)
        traj = trust.compute_trajectory(hcp_id)
        return {"enrichment": stats, "trajectory": traj.__dict__}

    @app.post("/api/crawl/enrich/defrag")
    def crawl_enrich_defrag():
        """Enrich Defragmentation Engine with real drug shortage data."""
        from rxreserve.proprietary import DefragmentationEngine
        engine = DefragmentationEngine()
        stats = _get_crawler().enrich_defrag_with_shortages(engine)
        graph = engine.graph_summary()
        return {"enrichment": stats, "knowledge_graph": graph}

    @app.post("/api/crawl/all")
    def crawl_all(drug_name: str = "Biktarvy", npi: str = "", state: str = "CA"):
        """Run the full crawl pipeline across all public sources."""
        return _get_crawler().crawl_all(drug_name=drug_name, hcp_npi=npi, state=state)

    # ═══════════════════════════════════════════════════════════════════
    # 12 Proprietary Systems — full API surface
    # ═══════════════════════════════════════════════════════════════════

    from rxreserve.proprietary import (
        RepPersonalAgent, RepProfile, AgentActionType, AgentChannel,
        MSLRouter, MSLRouteStatus,
        TerritoryAsCode,
        DefragmentationEngine, FragmentType,
        HCPTrustTrajectory, TrustTrend,
        RepInboxDefrag, InboxItemPriority,
        CostPerCallHalver, TouchValue,
        HCPFatigueIntelligence, FatigueLevel,
        HCPAccessRedirect, AccessStatus,
        EngagementGraph,
        AgentPopulationGovernance, GovernanceRuleType, AgentActionRequest,
        AttributionSettlementLoop, LoopStage,
        CompetitiveIntelligenceAgent, CompetitorSignalType, ThreatLevel,
        LaunchReadinessAnalyzer, SimulationStrategy,
        MeasurementFramework,
    )

    # Singletons for stateful systems
    _rep_agents: dict[str, RepPersonalAgent] = {}
    _msl_router = MSLRouter()
    _territory_tac = TerritoryAsCode(database=db)
    _defrag_engine = DefragmentationEngine()
    _trust_model = HCPTrustTrajectory()
    _inbox_defrag: dict[str, RepInboxDefrag] = {}
    _cost_halver = CostPerCallHalver()
    _fatigue = HCPFatigueIntelligence()
    _access_redirect = HCPAccessRedirect()
    _engagement_graph = EngagementGraph()
    _governance = AgentPopulationGovernance()
    _closed_loop = AttributionSettlementLoop()
    _ci_agent = CompetitiveIntelligenceAgent()
    _launch_sim = LaunchReadinessAnalyzer(database=db)
    _measurement = MeasurementFramework()

    def _get_rep_agent(rep_id: str, name: str = "", territory: str = "") -> RepPersonalAgent:
        if rep_id not in _rep_agents:
            _rep_agents[rep_id] = RepPersonalAgent(RepProfile(
                rep_id=rep_id, name=name, territory_id=territory))
        return _rep_agents[rep_id]

    def _get_inbox(rep_id: str) -> RepInboxDefrag:
        if rep_id not in _inbox_defrag:
            _inbox_defrag[rep_id] = RepInboxDefrag()
        return _inbox_defrag[rep_id]

    # ─── 1. Rep Personal Agent (15 endpoints) ───

    @app.post("/api/proprietary/rep-agent/create")
    def rep_agent_create(req: RepProfileRequest):
        agent = _get_rep_agent(req.rep_id, req.name, req.territory_id)
        return agent.summary()

    @app.get("/api/proprietary/rep-agent/{rep_id}/summary")
    def rep_agent_summary(rep_id: str):
        agent = _rep_agents.get(rep_id)
        if not agent:
            raise HTTPException(404, "Rep agent not found")
        return agent.summary()

    @app.post("/api/proprietary/rep-agent/{rep_id}/ingest-signals")
    def rep_agent_ingest(rep_id: str, hcp_id: str):
        agent = _rep_agents.get(rep_id)
        if not agent:
            raise HTTPException(404, "Rep agent not found")
        obligations = db.get_all_obligations()
        intents = db.get_all_intents()
        mails = db.get_all_mails()
        actions = agent.ingest_signals(hcp_id, obligations, intents, mails)
        return [a.__dict__ for a in actions]

    @app.get("/api/proprietary/rep-agent/{rep_id}/actions")
    def rep_agent_actions(rep_id: str, status: str = ""):
        agent = _rep_agents.get(rep_id)
        if not agent:
            raise HTTPException(404, "Rep agent not found")
        actions = agent.actions
        if status == "pending":
            actions = agent.pending_approval()
        elif status == "autonomous":
            actions = agent.autonomous_actions()
        elif status == "executed":
            actions = [a for a in actions if a.executed]
        return [a.__dict__ for a in actions]

    @app.post("/api/proprietary/rep-agent/{rep_id}/approve/{action_id}")
    def rep_agent_approve(rep_id: str, action_id: str):
        agent = _rep_agents.get(rep_id)
        if not agent:
            raise HTTPException(404, "Rep agent not found")
        result = agent.approve_action(action_id)
        if not result:
            raise HTTPException(404, "Action not found")
        return result.__dict__

    @app.post("/api/proprietary/rep-agent/{rep_id}/reject/{action_id}")
    def rep_agent_reject(rep_id: str, action_id: str, reason: str = ""):
        agent = _rep_agents.get(rep_id)
        if not agent:
            raise HTTPException(404, "Rep agent not found")
        result = agent.reject_action(action_id, reason)
        if not result:
            raise HTTPException(404, "Action not found")
        return result.__dict__

    @app.post("/api/proprietary/rep-agent/{rep_id}/execute/{action_id}")
    def rep_agent_execute(rep_id: str, action_id: str, outcome: str = ""):
        agent = _rep_agents.get(rep_id)
        if not agent:
            raise HTTPException(404, "Rep agent not found")
        result = agent.execute_action(action_id, outcome)
        if not result:
            raise HTTPException(400, "Action not approved or not found")
        return result.__dict__

    @app.get("/api/proprietary/rep-agent/{rep_id}/pending")
    def rep_agent_pending(rep_id: str):
        agent = _rep_agents.get(rep_id)
        if not agent:
            raise HTTPException(404, "Rep agent not found")
        return [a.__dict__ for a in agent.pending_approval()]

    @app.get("/api/proprietary/rep-agent/{rep_id}/autonomous")
    def rep_agent_autonomous(rep_id: str):
        agent = _rep_agents.get(rep_id)
        if not agent:
            raise HTTPException(404, "Rep agent not found")
        return [a.__dict__ for a in agent.autonomous_actions()]

    @app.get("/api/proprietary/rep-agents")
    def rep_agents_list():
        return [agent.summary() for agent in _rep_agents.values()]

    @app.post("/api/proprietary/rep-agent/{rep_id}/ingest-mail")
    def rep_agent_ingest_mail(rep_id: str, mail_id: str):
        agent = _rep_agents.get(rep_id)
        if not agent:
            raise HTTPException(404, "Rep agent not found")
        mail = db.get_mail(mail_id)
        if not mail:
            raise HTTPException(404, "Mail not found")
        actions = agent.ingest_signals(
            mail.matched_hcp_id or "",
            db.get_all_obligations(),
            db.get_all_intents(),
            [mail.__dict__ if hasattr(mail, '__dict__') else mail],
        )
        return [a.__dict__ for a in actions]

    @app.get("/api/proprietary/rep-agent/{rep_id}/hcp/{hcp_id}/history")
    def rep_agent_hcp_history(rep_id: str, hcp_id: str):
        agent = _rep_agents.get(rep_id)
        if not agent:
            raise HTTPException(404, "Rep agent not found")
        return agent.hcp_history.get(hcp_id, [])

    @app.post("/api/proprietary/rep-agent/{rep_id}/log-interaction")
    def rep_agent_log_interaction(rep_id: str, hcp_id: str, interaction: dict = None):
        agent = _rep_agents.get(rep_id)
        if not agent:
            raise HTTPException(404, "Rep agent not found")
        agent.hcp_history.setdefault(hcp_id, []).append(interaction or {})
        return {"logged": True}

    @app.get("/api/proprietary/rep-agent/{rep_id}/learned-preferences")
    def rep_agent_preferences(rep_id: str):
        agent = _rep_agents.get(rep_id)
        if not agent:
            raise HTTPException(404, "Rep agent not found")
        return agent.learned_preferences

    @app.post("/api/proprietary/rep-agent/{rep_id}/update-preferences")
    def rep_agent_update_prefs(rep_id: str, preferences: dict):
        agent = _rep_agents.get(rep_id)
        if not agent:
            raise HTTPException(404, "Rep agent not found")
        agent.learned_preferences.update(preferences)
        return agent.learned_preferences

    # ─── 2. MSL Router (12 endpoints) ───

    @app.post("/api/proprietary/msl-router/detect")
    def msl_detect(hcp_id: str, rep_id: str):
        routes = _msl_router.detect_medical_need(
            hcp_id, rep_id,
            obligations=db.get_all_obligations(),
            intents=db.get_all_intents(),
            mails=db.get_all_mails(),
        )
        return [r.__dict__ for r in routes]

    @app.get("/api/proprietary/msl-router/routes")
    def msl_routes(status: str = ""):
        routes = list(_msl_router.routes.values())
        if status:
            routes = [r for r in routes if r.status.value == status]
        return [r.__dict__ for r in routes]

    @app.get("/api/proprietary/msl-router/pending")
    def msl_pending():
        return [r.__dict__ for r in _msl_router.pending_routes()]

    @app.get("/api/proprietary/msl-router/summary")
    def msl_summary():
        return _msl_router.summary()

    @app.get("/api/proprietary/msl-router/evidence/{drug_name}")
    def msl_evidence(drug_name: str):
        return _msl_router.evidence_store.get(drug_name.lower(), [])

    @app.get("/api/proprietary/msl-router/{route_id}")
    def msl_route_detail(route_id: str):
        route = _msl_router.routes.get(route_id)
        if not route:
            raise HTTPException(404, "Route not found")
        return route.__dict__

    @app.post("/api/proprietary/msl-router/{route_id}/route")
    def msl_route_route(route_id: str, msl_id: str = ""):
        return _msl_router.route_to_msl(route_id, msl_id).__dict__

    @app.post("/api/proprietary/msl-router/{route_id}/accept")
    def msl_route_accept(route_id: str, msl_id: str):
        return _msl_router.msl_accept(route_id, msl_id).__dict__

    @app.post("/api/proprietary/msl-router/{route_id}/respond")
    def msl_route_respond(route_id: str, msl_id: str, req: MSLResponseRequest):
        return _msl_router.msl_respond(route_id, msl_id, req.response, req.references).__dict__

    @app.post("/api/proprietary/msl-router/{route_id}/deliver")
    def msl_route_deliver(route_id: str):
        try:
            return _msl_router.deliver_through_rep(route_id).__dict__
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.post("/api/proprietary/msl-router/{route_id}/reject")
    def msl_route_reject(route_id: str, msl_id: str, reason: str):
        return _msl_router.msl_reject(route_id, msl_id, reason).__dict__

    @app.post("/api/proprietary/msl-router/{route_id}/assign-msl")
    def msl_assign(route_id: str, hcp_id: str, msl_id: str):
        _msl_router.msl_assignments[hcp_id] = msl_id
        return {"assigned": True, "hcp_id": hcp_id, "msl_id": msl_id}

    # ─── 3. Territory-as-Code (14 endpoints) ───

    @app.post("/api/proprietary/territory/define")
    def territory_define(req: TerritoryDefineRequest):
        terr = _territory_tac.define_territory(
            req.territory_id, req.rep_id,
            req.hcp_assignments, req.constraints, req.commit_message)
        return terr.__dict__

    @app.get("/api/proprietary/territory/{territory_id}/active")
    def territory_active(territory_id: str):
        terr = _territory_tac.get_active(territory_id)
        if not terr:
            raise HTTPException(404, "Territory not found")
        return terr.__dict__

    @app.get("/api/proprietary/territory/{territory_id}/version/{version}")
    def territory_version(territory_id: str, version: int):
        terr = _territory_tac.get_version(territory_id, version)
        if not terr:
            raise HTTPException(404, "Version not found")
        return terr.__dict__

    @app.get("/api/proprietary/territory/{territory_id}/diff")
    def territory_diff(territory_id: str, v1: int, v2: int):
        return _territory_tac.diff(territory_id, v1, v2)

    @app.post("/api/proprietary/territory/{territory_id}/analyze/{version}")
    def territory_analyze(territory_id: str, version: int):
        return _territory_tac.analyze(territory_id, version).__dict__

    @app.post("/api/proprietary/territory/{territory_id}/deploy/{version}")
    def territory_deploy(territory_id: str, version: int):
        return _territory_tac.deploy(territory_id, version).__dict__

    @app.get("/api/proprietary/territory/{territory_id}/history")
    def territory_history(territory_id: str):
        return _territory_tac.history(territory_id)

    @app.get("/api/proprietary/territories")
    def territories_list():
        return [{"territory_id": tid, "versions": len(vs),
                 "active_version": next((v.version for v in reversed(vs) if v.is_active), None)}
                for tid, vs in _territory_tac.territories.items()]

    @app.get("/api/proprietary/territory/{territory_id}/analyses")
    def territory_analyses(territory_id: str):
        return [a.__dict__ for a in _territory_tac.analyses
                if a.territory_id == territory_id]

    @app.get("/api/proprietary/territory/{territory_id}/hcps")
    def territory_hcps(territory_id: str):
        terr = _territory_tac.get_active(territory_id)
        if not terr:
            raise HTTPException(404, "Territory not found")
        return terr.hcp_assignments

    @app.get("/api/proprietary/territory/{territory_id}/constraints")
    def territory_constraints(territory_id: str):
        terr = _territory_tac.get_active(territory_id)
        if not terr:
            raise HTTPException(404, "Territory not found")
        return terr.constraints

    @app.post("/api/proprietary/territory/{territory_id}/add-hcp")
    def territory_add_hcp(territory_id: str, hcp_id: str, priority: str = "medium",
                          target_visits: int = 1):
        terr = _territory_tac.get_active(territory_id)
        if not terr:
            raise HTTPException(404, "Territory not found")
        new_assignments = list(terr.hcp_assignments)
        new_assignments.append({"hcp_id": hcp_id, "priority": priority,
                                "target_visits": target_visits})
        new_terr = _territory_tac.define_territory(
            territory_id, terr.rep_id, new_assignments,
            terr.constraints, f"Added HCP {hcp_id}")
        return new_terr.__dict__

    @app.post("/api/proprietary/territory/{territory_id}/remove-hcp")
    def territory_remove_hcp(territory_id: str, hcp_id: str):
        terr = _territory_tac.get_active(territory_id)
        if not terr:
            raise HTTPException(404, "Territory not found")
        new_assignments = [h for h in terr.hcp_assignments if h["hcp_id"] != hcp_id]
        new_terr = _territory_tac.define_territory(
            territory_id, terr.rep_id, new_assignments,
            terr.constraints, f"Removed HCP {hcp_id}")
        return new_terr.__dict__

    @app.get("/api/proprietary/territory/{territory_id}/rep")
    def territory_rep(territory_id: str):
        terr = _territory_tac.get_active(territory_id)
        if not terr:
            raise HTTPException(404, "Territory not found")
        return {"rep_id": terr.rep_id, "territory_id": territory_id}

    # ─── 4. Defragmentation Engine (10 endpoints) ───

    @app.post("/api/proprietary/defrag/ingest")
    def defrag_ingest(req: FragmentIngestRequest):
        try:
            ft = FragmentType(req.source_type)
        except ValueError:
            ft = FragmentType.UNKNOWN
        frag = _defrag_engine.ingest_fragment(ft, req.source_location, req.content)
        return frag.__dict__

    @app.post("/api/proprietary/defrag/process/{fragment_id}")
    def defrag_process(fragment_id: str):
        try:
            return _defrag_engine.process_fragment(fragment_id).__dict__
        except KeyError:
            raise HTTPException(404, "Fragment not found")

    @app.post("/api/proprietary/defrag/process-all")
    def defrag_process_all():
        return _defrag_engine.process_all()

    @app.get("/api/proprietary/defrag/fragments")
    def defrag_fragments(processed: bool = None):
        frags = list(_defrag_engine.fragments.values())
        if processed is not None:
            frags = [f for f in frags if f.processed == processed]
        return [{"fragment_id": f.fragment_id, "source_type": f.source_type.value,
                 "source_location": f.source_location, "processed": f.processed,
                 "confidence": f.confidence,
                 "entity_count": len(f.extracted_entities)} for f in frags]

    @app.get("/api/proprietary/defrag/graph/summary")
    def defrag_graph_summary():
        return _defrag_engine.graph_summary()

    @app.get("/api/proprietary/defrag/graph/nodes")
    def defrag_graph_nodes(node_type: str = ""):
        nodes = list(_defrag_engine.nodes.values())
        if node_type:
            nodes = [n for n in nodes if n.node_type == node_type]
        return [n.__dict__ for n in nodes]

    @app.get("/api/proprietary/defrag/graph/edges")
    def defrag_graph_edges(relation: str = ""):
        edges = list(_defrag_engine.edges.values())
        if relation:
            edges = [e for e in edges if e.relation == relation]
        return [e.__dict__ for e in edges]

    @app.get("/api/proprietary/defrag/query/hcp/{hcp_name}")
    def defrag_query_hcp(hcp_name: str):
        return _defrag_engine.query_hcp(hcp_name)

    @app.get("/api/proprietary/defrag/stats")
    def defrag_stats():
        return {
            "total_fragments": len(_defrag_engine.fragments),
            "processed": sum(1 for f in _defrag_engine.fragments.values() if f.processed),
            "nodes": len(_defrag_engine.nodes),
            "edges": len(_defrag_engine.edges),
        }

    @app.get("/api/proprietary/defrag/{fragment_id}")
    def defrag_fragment_detail(fragment_id: str):
        frag = _defrag_engine.fragments.get(fragment_id)
        if not frag:
            raise HTTPException(404, "Fragment not found")
        return frag.__dict__

    # ─── 5. HCP Trust Trajectory (12 endpoints) ───

    @app.post("/api/proprietary/trust/{hcp_id}/signal")
    def trust_add_signal(hcp_id: str, req: TrustSignalRequest):
        sig = _trust_model.add_signal(hcp_id, req.signal_type, req.signal_value,
                                       req.weight, req.source, req.description)
        return sig.__dict__

    @app.post("/api/proprietary/trust/{hcp_id}/compute")
    def trust_compute(hcp_id: str, days_since_last_contact: int = 0):
        traj = _trust_model.compute_trajectory(
            hcp_id,
            obligations=db.get_all_obligations(),
            intents=db.get_all_intents(),
            days_since_last_contact=days_since_last_contact,
        )
        return traj.__dict__

    @app.get("/api/proprietary/trust/portfolio")
    def trust_portfolio():
        return _trust_model.portfolio_summary()

    @app.get("/api/proprietary/trust/trajectories")
    def trust_all_trajectories():
        return {hid: t.__dict__ for hid, t in _trust_model.trajectories.items()}

    @app.get("/api/proprietary/trust/critical")
    def trust_critical():
        return {hid: t.__dict__ for hid, t in _trust_model.trajectories.items()
                if t.intervention_urgency in ("high", "critical")}

    @app.get("/api/proprietary/trust/declining")
    def trust_declining():
        return {hid: t.__dict__ for hid, t in _trust_model.trajectories.items()
                if t.trend in (TrustTrend.DECLINING, TrustTrend.CRITICAL)}

    @app.get("/api/proprietary/trust/{hcp_id}")
    def trust_get(hcp_id: str):
        traj = _trust_model.trajectories.get(hcp_id)
        if not traj:
            raise HTTPException(404, "No trajectory computed yet")
        return traj.__dict__

    @app.get("/api/proprietary/trust/{hcp_id}/signals")
    def trust_signals(hcp_id: str):
        return [s.__dict__ for s in _trust_model.signals.get(hcp_id, [])]

    @app.get("/api/proprietary/trust/{hcp_id}/recommendations")
    def trust_recommendations(hcp_id: str):
        traj = _trust_model.trajectories.get(hcp_id)
        if not traj:
            raise HTTPException(404, "No trajectory computed")
        return {"recommendations": traj.recommended_actions, "urgency": traj.intervention_urgency}

    @app.get("/api/proprietary/trust/{hcp_id}/prediction")
    def trust_prediction(hcp_id: str):
        traj = _trust_model.trajectories.get(hcp_id)
        if not traj:
            raise HTTPException(404, "No trajectory computed")
        return {
            "current": traj.current_trust,
            "predicted_30d": traj.predicted_trust_30d,
            "predicted_90d": traj.predicted_trust_90d,
            "trend": traj.trend.value,
            "velocity": traj.velocity,
            "decline_risk": traj.decline_risk,
        }

    @app.delete("/api/proprietary/trust/{hcp_id}/signals")
    def trust_clear_signals(hcp_id: str):
        _trust_model.signals.pop(hcp_id, None)
        _trust_model.trajectories.pop(hcp_id, None)
        return {"cleared": True}

    @app.get("/api/proprietary/trust/{hcp_id}/summary")
    def trust_summary(hcp_id: str):
        traj = _trust_model.trajectories.get(hcp_id)
        if not traj:
            raise HTTPException(404, "No trajectory computed")
        return {
            "hcp_id": hcp_id,
            "trust": traj.current_trust,
            "trend": traj.trend.value,
            "urgency": traj.intervention_urgency,
            "signals": traj.signal_count,
            "positive": traj.positive_signals,
            "negative": traj.negative_signals,
            "confidence": traj.confidence,
        }

    # ─── 6. Rep Inbox Defrag (10 endpoints) ───

    @app.post("/api/proprietary/inbox/{rep_id}/ingest-email")
    def inbox_ingest_email(rep_id: str, mail_id: str):
        inbox = _get_inbox(rep_id)
        mail = db.get_mail(mail_id)
        if not mail:
            raise HTTPException(404, "Mail not found")
        item = inbox.ingest_email(rep_id, mail.__dict__ if hasattr(mail, '__dict__') else mail)
        return item.__dict__

    @app.post("/api/proprietary/inbox/{rep_id}/ingest-obligation")
    def inbox_ingest_obligation(rep_id: str, obligation_id: str):
        inbox = _get_inbox(rep_id)
        obl = db.get_obligation(obligation_id)
        if not obl:
            raise HTTPException(404, "Obligation not found")
        item = inbox.ingest_obligation(rep_id, obl.__dict__ if hasattr(obl, '__dict__') else obl)
        return item.__dict__

    @app.post("/api/proprietary/inbox/{rep_id}/ingest-intent")
    def inbox_ingest_intent(rep_id: str, intent_id: str):
        inbox = _get_inbox(rep_id)
        intents = db.get_all_intents()
        intent = next((i for i in intents if i.get("intent_id") == intent_id), None)
        if not intent:
            raise HTTPException(404, "Intent not found")
        item = inbox.ingest_intent(rep_id, intent)
        return item.__dict__

    @app.post("/api/proprietary/inbox/{rep_id}/consolidate")
    def inbox_consolidate(rep_id: str):
        inbox = _get_inbox(rep_id)
        items = inbox.consolidate(rep_id)
        return [i.__dict__ for i in items]

    @app.get("/api/proprietary/inbox/{rep_id}/queue")
    def inbox_queue(rep_id: str, limit: int = 20):
        inbox = _get_inbox(rep_id)
        return [i.__dict__ for i in inbox.get_queue(rep_id, limit)]

    @app.post("/api/proprietary/inbox/{rep_id}/complete/{item_id}")
    def inbox_complete(rep_id: str, item_id: str):
        inbox = _get_inbox(rep_id)
        result = inbox.complete_item(rep_id, item_id)
        if not result:
            raise HTTPException(404, "Item not found")
        return result.__dict__

    @app.get("/api/proprietary/inbox/{rep_id}/summary")
    def inbox_summary(rep_id: str):
        inbox = _get_inbox(rep_id)
        return inbox.summary(rep_id)

    @app.get("/api/proprietary/inbox/{rep_id}/critical")
    def inbox_critical(rep_id: str):
        inbox = _get_inbox(rep_id)
        return [i.__dict__ for i in inbox.inboxes.get(rep_id, [])
                if i.priority == InboxItemPriority.CRITICAL and not i.completed]

    @app.get("/api/proprietary/inbox/{rep_id}/pending")
    def inbox_pending(rep_id: str):
        inbox = _get_inbox(rep_id)
        return [i.__dict__ for i in inbox.inboxes.get(rep_id, []) if not i.completed]

    @app.delete("/api/proprietary/inbox/{rep_id}/clear")
    def inbox_clear(rep_id: str):
        _inbox_defrag.pop(rep_id, None)
        return {"cleared": True}

    # ─── 7. Cost-per-call Halver (10 endpoints) ───

    @app.post("/api/proprietary/cost-halver/classify")
    def cost_halver_classify(req: TouchClassifyRequest):
        decision = _cost_halver.classify_touch(
            req.hcp_id, req.rep_id, req.planned_channel,
            req.touch_reason, req.hcp_intent, req.hcp_trust, req.is_kol)
        return decision.__dict__

    @app.post("/api/proprietary/cost-halver/batch")
    def cost_halver_batch(touches: list[dict]):
        decisions = _cost_halver.batch_optimize(touches)
        return [d.__dict__ for d in decisions]

    @app.post("/api/proprietary/cost-halver/{decision_id}/execute")
    def cost_halver_execute(decision_id: str):
        result = _cost_halver.execute_auto(decision_id)
        if not result:
            raise HTTPException(400, "Not auto-executable or not found")
        return result.__dict__

    @app.get("/api/proprietary/cost-halver/decisions")
    def cost_halver_decisions(executed: bool = None):
        decisions = list(_cost_halver.decisions.values())
        if executed is not None:
            decisions = [d for d in decisions if d.executed == executed]
        return [d.__dict__ for d in decisions]

    @app.get("/api/proprietary/cost-halver/summary")
    def cost_halver_summary():
        return _cost_halver.summary()

    @app.get("/api/proprietary/cost-halver/savings")
    def cost_halver_savings():
        s = _cost_halver.summary()
        return {
            "total_cost_savings": s.get("total_cost_savings", 0),
            "total_time_savings_minutes": s.get("total_time_savings_minutes", 0),
            "avg_savings_per_touch": s.get("avg_savings_per_touch", 0),
        }

    @app.get("/api/proprietary/cost-halver/channels")
    def cost_halver_channels():
        return _cost_halver.channel_costs

    @app.get("/api/proprietary/cost-halver/auto-executable")
    def cost_halver_auto():
        return [d.__dict__ for d in _cost_halver.decisions.values() if d.auto_executable and not d.executed]

    @app.get("/api/proprietary/cost-halver/hcp/{hcp_id}")
    def cost_halver_hcp(hcp_id: str):
        return [d.__dict__ for d in _cost_halver.decisions.values() if d.hcp_id == hcp_id]

    @app.get("/api/proprietary/cost-halver/{decision_id}")
    def cost_halver_detail(decision_id: str):
        d = _cost_halver.decisions.get(decision_id)
        if not d:
            raise HTTPException(404, "Decision not found")
        return d.__dict__

    # ─── 8. HCP Fatigue Intelligence (10 endpoints) ───

    @app.post("/api/proprietary/fatigue/{hcp_id}/log-contact")
    def fatigue_log_contact(hcp_id: str, channel: str = "", rep_id: str = ""):
        _fatigue.log_contact(hcp_id, channel, rep_id=rep_id)
        return {"logged": True}

    @app.post("/api/proprietary/fatigue/{hcp_id}/log-signal")
    def fatigue_log_signal(hcp_id: str, signal: str):
        _fatigue.log_fatigue_signal(hcp_id, signal)
        return {"logged": True}

    @app.get("/api/proprietary/fatigue/{hcp_id}")
    def fatigue_state(hcp_id: str):
        return _fatigue.compute_fatigue(hcp_id).__dict__

    @app.get("/api/proprietary/fatigue/{hcp_id}/can-contact")
    def fatigue_can_contact(hcp_id: str):
        allowed, reason = _fatigue.can_contact(hcp_id)
        return {"can_contact": allowed, "reason": reason}

    @app.get("/api/proprietary/fatigue/{hcp_id}/contacts")
    def fatigue_contacts(hcp_id: str):
        return _fatigue.contact_log.get(hcp_id, [])

    @app.get("/api/proprietary/fatigue/summary")
    def fatigue_summary():
        return _fatigue.summary()

    @app.get("/api/proprietary/fatigue/critical")
    def fatigue_critical():
        return {hid: s.__dict__ for hid, s in _fatigue.states.items()
                if s.level == FatigueLevel.CRITICAL}

    @app.get("/api/proprietary/fatigue/cooling")
    def fatigue_cooling():
        return {hid: s.__dict__ for hid, s in _fatigue.states.items() if s.cooling_until}

    @app.get("/api/proprietary/fatigue/all")
    def fatigue_all():
        return {hid: s.__dict__ for hid, s in _fatigue.states.items()}

    @app.get("/api/proprietary/fatigue/thresholds")
    def fatigue_thresholds():
        return _fatigue.CONTACT_THRESHOLDS

    # ─── 9. HCP Access Redirect (10 endpoints) ───

    @app.post("/api/proprietary/access/{hcp_id}/status")
    def access_set_status(hcp_id: str, req: AccessStatusRequest):
        try:
            status = AccessStatus(req.status)
        except ValueError:
            raise HTTPException(400, f"Invalid status: {req.status}")
        profile = _access_redirect.set_access_status(hcp_id, status, req.reason, req.channels)
        return profile.__dict__

    @app.post("/api/proprietary/access/{hcp_id}/attempt")
    def access_log_attempt(hcp_id: str, success: bool):
        _access_redirect.log_access_attempt(hcp_id, success)
        return {"logged": True}

    @app.get("/api/proprietary/access/{hcp_id}")
    def access_check(hcp_id: str):
        accessible, reason, alternatives = _access_redirect.check_access(hcp_id)
        return {"accessible": accessible, "reason": reason, "alternatives": alternatives}

    @app.get("/api/proprietary/access/{hcp_id}/redirect")
    def access_redirect(hcp_id: str):
        return _access_redirect.redirect(hcp_id)

    @app.post("/api/proprietary/access/{hcp_id}/similar")
    def access_set_similar(hcp_id: str, similar: list[str]):
        _access_redirect.register_similar_hcps(hcp_id, similar)
        return {"registered": True}

    @app.get("/api/proprietary/access/summary")
    def access_summary():
        return _access_redirect.summary()

    @app.post("/api/proprietary/access/batch-check")
    def access_batch_check(hcp_ids: list[str]):
        return _access_redirect.batch_check(hcp_ids)

    @app.get("/api/proprietary/access/no-see")
    def access_no_see():
        return [p.__dict__ for p in _access_redirect.profiles.values()
                if p.access_status == AccessStatus.NO_SEE]

    @app.get("/api/proprietary/access/restricted")
    def access_restricted():
        return [p.__dict__ for p in _access_redirect.profiles.values()
                if p.access_status == AccessStatus.RESTRICTED]

    @app.get("/api/proprietary/access/{hcp_id}/profile")
    def access_profile(hcp_id: str):
        p = _access_redirect.profiles.get(hcp_id)
        if not p:
            raise HTTPException(404, "No access profile")
        return p.__dict__

    # ─── 10. Engagement Graph (15 endpoints) ───

    @app.post("/api/proprietary/engagement-graph/node")
    def graph_add_node(req: GraphNodeRequest):
        node = _engagement_graph.add_node(req.node_type, req.label, **req.properties)
        return node.__dict__

    @app.post("/api/proprietary/engagement-graph/edge")
    def graph_add_edge(req: GraphEdgeRequest):
        edge = _engagement_graph.add_edge(req.source_id, req.target_id, req.relation, req.weight, **req.properties)
        return edge.__dict__

    @app.get("/api/proprietary/engagement-graph/node/{node_id}")
    def graph_get_node(node_id: str):
        node = _engagement_graph.get_node(node_id)
        if not node:
            raise HTTPException(404, "Node not found")
        return node.__dict__

    @app.get("/api/proprietary/engagement-graph/nodes")
    def graph_nodes(node_type: str = ""):
        nodes = _engagement_graph.get_nodes_by_type(node_type) if node_type else list(_engagement_graph.nodes.values())
        return [n.__dict__ for n in nodes]

    @app.get("/api/proprietary/engagement-graph/{node_id}/neighbors")
    def graph_neighbors(node_id: str, relation: str = ""):
        neighbors = _engagement_graph.get_neighbors(node_id, relation)
        return [n.__dict__ for n in neighbors]

    @app.get("/api/proprietary/engagement-graph/{node_id}/edges")
    def graph_node_edges(node_id: str, relation: str = ""):
        edges = _engagement_graph.get_edges(node_id, relation)
        return [e.__dict__ for e in edges]

    @app.get("/api/proprietary/engagement-graph/query/hcp/{hcp_id}")
    def graph_query_hcp(hcp_id: str):
        return _engagement_graph.query_hcp(hcp_id)

    @app.get("/api/proprietary/engagement-graph/path")
    def graph_path(source_id: str, target_id: str, max_depth: int = 4):
        path = _engagement_graph.find_path(source_id, target_id, max_depth)
        return {"path": path, "found": len(path) > 0}

    @app.get("/api/proprietary/engagement-graph/{node_id}/subgraph")
    def graph_subgraph(node_id: str, depth: int = 2):
        return _engagement_graph.subgraph(node_id, depth)

    @app.get("/api/proprietary/engagement-graph/summary")
    def graph_summary():
        return _engagement_graph.summary()

    @app.get("/api/proprietary/engagement-graph/edges")
    def graph_all_edges(relation: str = ""):
        edges = list(_engagement_graph.edges.values())
        if relation:
            edges = [e for e in edges if e.relation == relation]
        return [e.__dict__ for e in edges]

    @app.delete("/api/proprietary/engagement-graph/node/{node_id}")
    def graph_delete_node(node_id: str):
        _engagement_graph.nodes.pop(node_id, None)
        return {"deleted": True}

    @app.get("/api/proprietary/engagement-graph/types")
    def graph_types():
        return {t: len(ids) for t, ids in _engagement_graph._type_index.items()}

    @app.post("/api/proprietary/engagement-graph/batch-nodes")
    def graph_batch_nodes(nodes: list[dict]):
        results = []
        for n in nodes:
            node = _engagement_graph.add_node(n.get("node_type", ""), n.get("label", ""),
                                               **n.get("properties", {}))
            results.append(node.__dict__)
        return results

    @app.post("/api/proprietary/engagement-graph/batch-edges")
    def graph_batch_edges(edges: list[dict]):
        results = []
        for e in edges:
            edge = _engagement_graph.add_edge(e["source_id"], e["target_id"],
                                               e["relation"], e.get("weight", 1.0),
                                               **e.get("properties", {}))
            results.append(edge.__dict__)
        return results

    # ─── 11. Agent Population Governance (12 endpoints) ───

    @app.post("/api/proprietary/governance/check")
    def governance_check(req: GovernanceActionRequest):
        request = AgentActionRequest(**req.__dict__)
        approved, reason = _governance.check_action(request)
        return {"approved": approved, "reason": reason, "request_id": request.request_id}

    @app.get("/api/proprietary/governance/rules")
    def governance_rules():
        return _governance.get_rules()

    @app.get("/api/proprietary/governance/violations")
    def governance_violations():
        return [v.__dict__ for v in _governance.violations]

    @app.get("/api/proprietary/governance/{hcp_id}/actions")
    def governance_hcp_actions(hcp_id: str):
        return _governance.get_hcp_actions(hcp_id)

    @app.get("/api/proprietary/governance/summary")
    def governance_summary():
        return _governance.summary()

    @app.post("/api/proprietary/governance/rules")
    def governance_add_rule(req: GovernanceRuleRequest):
        try:
            rtype = GovernanceRuleType(req.rule_type)
        except ValueError:
            raise HTTPException(400, f"Invalid rule type: {req.rule_type}")
        rule = _governance.add_rule(rtype, req.description, req.priority)
        return rule.__dict__

    @app.get("/api/proprietary/governance/rule/{rule_id}")
    def governance_rule_detail(rule_id: str):
        rule = _governance.rules.get(rule_id)
        if not rule:
            raise HTTPException(404, "Rule not found")
        return rule.__dict__

    @app.post("/api/proprietary/governance/rule/{rule_id}/toggle")
    def governance_rule_toggle(rule_id: str, enabled: bool):
        rule = _governance.rules.get(rule_id)
        if not rule:
            raise HTTPException(404, "Rule not found")
        rule.enabled = enabled
        return rule.__dict__

    @app.get("/api/proprietary/governance/agents")
    def governance_agents():
        agent_ids = set()
        for actions in _governance.action_log.values():
            for a in actions:
                agent_ids.add(a.agent_id)
        return list(agent_ids)

    @app.get("/api/proprietary/governance/violation-types")
    def governance_violation_types():
        return {rtype.value: rtype.value for rtype in GovernanceRuleType}

    @app.delete("/api/proprietary/governance/violations")
    def governance_clear_violations():
        _governance.violations.clear()
        return {"cleared": True}

    @app.get("/api/proprietary/governance/{hcp_id}/can-act")
    def governance_can_act(hcp_id: str, agent_type: str, channel: str = ""):
        req = AgentActionRequest(agent_id="check", agent_type=agent_type,
                                  hcp_id=hcp_id, channel=channel, action_type="check")
        approved, reason = _governance.check_action(req)
        return {"can_act": approved, "reason": reason}

    # ─── 11b. Merge Protocol: Optimistic Concurrency Control (8 endpoints) ───

    @app.post("/api/proprietary/governance/merge/begin")
    def merge_begin(file_path: str, agent_id: str, agent_type: str = "general"):
        """An agent begins editing a file. Records base revision."""
        return _governance.begin_file_edit(file_path, agent_id, agent_type)

    @app.post("/api/proprietary/governance/merge/{session_id}/propose")
    def merge_propose(session_id: str, req: dict):
        """An agent proposes a change. Runs three-way merge + constitution validation."""
        proposed_content = req.get("proposed_content", "")
        reasoning = req.get("reasoning", "")
        return _governance.propose_file_edit(session_id, proposed_content, reasoning)

    @app.post("/api/proprietary/governance/merge/{session_id}/commit")
    def merge_commit(session_id: str):
        """Commit a proposed change after successful merge."""
        return _governance.commit_file_edit(session_id)

    @app.post("/api/proprietary/governance/merge/{session_id}/rebase")
    def merge_rebase(session_id: str, req: dict):
        """Rebase a stale proposal after intervening changes."""
        new_proposed = req.get("proposed_content", "")
        return _governance.rebase_file_edit(session_id, new_proposed)

    @app.post("/api/proprietary/governance/merge/{session_id}/abort")
    def merge_abort(session_id: str):
        """Abort an edit session."""
        ok = _governance.abort_file_edit(session_id)
        return {"aborted": ok}

    @app.get("/api/proprietary/governance/merge/{session_id}")
    def merge_session_detail(session_id: str):
        """Get details of an edit session."""
        session = _governance.get_edit_session(session_id)
        if session is None:
            raise HTTPException(404, "Session not found")
        return session

    @app.get("/api/proprietary/governance/merge/active")
    def merge_active_sessions():
        """Get all active edit sessions."""
        return _governance.active_edit_sessions()

    @app.get("/api/proprietary/governance/merge/summary")
    def merge_summary():
        """Get merge orchestrator summary."""
        return _governance.merge_orchestrator.summary()

    # ─── 12. Attribution-Settlement Closed Loop (15 endpoints) ───

    @app.post("/api/proprietary/closed-loop/start")
    def loop_start(req: LoopStartRequest):
        loop_id = _closed_loop.start_loop(req.hcp_id, req.rep_id, req.agent_id, req.description)
        return {"loop_id": loop_id}

    @app.post("/api/proprietary/closed-loop/{loop_id}/event")
    def loop_add_event(loop_id: str, stage: str, description: str = "", data: dict = None):
        try:
            st = LoopStage(stage)
        except ValueError:
            raise HTTPException(400, f"Invalid stage: {stage}")
        event = _closed_loop.add_event(loop_id, st, data, description)
        return event.__dict__

    @app.post("/api/proprietary/closed-loop/{loop_id}/attribute")
    def loop_attribute(loop_id: str, req: AttributionRequest):
        settlement = _closed_loop.attribute(loop_id, req.human_contribution,
                                            req.ai_contribution, req.verified_value,
                                            req.value_type)
        return settlement.__dict__

    @app.post("/api/proprietary/closed-loop/{loop_id}/settle")
    def loop_settle(loop_id: str, req: SettleRequest):
        settlement = _closed_loop.settle(loop_id, req.employee_credit, req.economic_settlement)
        # Set rep_id from loop
        events = _closed_loop.loops.get(loop_id, [])
        if events:
            settlement.rep_id = events[0].rep_id
            settlement.hcp_id = events[0].hcp_id
        return settlement.__dict__

    @app.get("/api/proprietary/closed-loop/{loop_id}")
    def loop_detail(loop_id: str):
        return _closed_loop.get_loop(loop_id)

    @app.get("/api/proprietary/closed-loop/{loop_id}/trace")
    def loop_trace(loop_id: str):
        loop = _closed_loop.get_loop(loop_id)
        return {"stages": loop["stages"], "events": loop["events"]}

    @app.get("/api/proprietary/closed-loop/complete")
    def loop_complete():
        return _closed_loop.complete_loops()

    @app.get("/api/proprietary/closed-loop/in-progress")
    def loop_in_progress():
        all_ids = set(_closed_loop.loops.keys())
        settled_ids = {lid for lid, s in _closed_loop.settlements.items() if s.settled}
        in_progress = all_ids - settled_ids
        return [_closed_loop.get_loop(lid) for lid in in_progress]

    @app.get("/api/proprietary/closed-loop/summary")
    def loop_summary():
        return _closed_loop.summary()

    @app.get("/api/proprietary/closed-loop/employee/{rep_id}/capital")
    def loop_employee_capital(rep_id: str):
        return _closed_loop.employee_career_capital(rep_id)

    @app.get("/api/proprietary/closed-loop/{loop_id}/settlement")
    def loop_settlement(loop_id: str):
        s = _closed_loop.settlements.get(loop_id)
        if not s:
            raise HTTPException(404, "No settlement")
        return s.__dict__

    @app.get("/api/proprietary/closed-loop/all")
    def loop_all():
        return {lid: _closed_loop.get_loop(lid) for lid in _closed_loop.loops}

    @app.get("/api/proprietary/closed-loop/{loop_id}/stage")
    def loop_current_stage(loop_id: str):
        events = _closed_loop.loops.get(loop_id, [])
        if not events:
            raise HTTPException(404, "Loop not found")
        return {"current_stage": events[-1].stage.value, "total_events": len(events)}

    @app.get("/api/proprietary/closed-loop/stages")
    def loop_stages():
        return {"stages": [s.value for s in LoopStage]}

    @app.get("/api/proprietary/closed-loop/{loop_id}/is-complete")
    def loop_is_complete(loop_id: str):
        s = _closed_loop.settlements.get(loop_id)
        return {"complete": s.settled if s else False}

    # ─── Closed-loop integration (10 endpoints) ───

    @app.post("/api/proprietary/integrate/full-cycle")
    def integrate_full_cycle(hcp_id: str, rep_id: str, drug_name: str = "Biktarvy"):
        """Run the full detect → propose → execute → measure → attribute → settle cycle."""
        # 1. DETECT
        loop_id = _closed_loop.start_loop(hcp_id, rep_id, agent_id="rep_agent",
                                          description=f"Full cycle for {hcp_id}")

        # 2. PROPOSE — rep agent generates actions
        agent = _get_rep_agent(rep_id)
        actions = agent.ingest_signals(hcp_id, db.get_all_obligations(),
                                        db.get_all_intents(), db.get_all_mails())
        _closed_loop.add_event(loop_id, LoopStage.PROPOSE,
                               {"actions": len(actions)}, f"Proposed {len(actions)} actions")

        # 3. EXECUTE — governance check + execute first action
        if actions:
            req = AgentActionRequest(agent_id=rep_id, agent_type="rep_agent",
                                     hcp_id=hcp_id, action_type=actions[0].action_type.value)
            approved, reason = _governance.check_action(req)
            if approved:
                agent.approve_action(actions[0].action_id)
                agent.execute_action(actions[0].action_id, "Executed via full cycle")
                _closed_loop.add_event(loop_id, LoopStage.EXECUTE,
                                       {"action": actions[0].action_type.value}, "Action executed")

        # 4. MEASURE — compute trust trajectory
        traj = _trust_model.compute_trajectory(hcp_id, db.get_all_obligations(),
                                                db.get_all_intents())
        _closed_loop.add_event(loop_id, LoopStage.MEASURE,
                               {"trust": traj.current_trust, "trend": traj.trend.value},
                               f"Trust: {traj.current_trust}, trend: {traj.trend.value}")

        # 5. ATTRIBUTE
        settlement = _closed_loop.attribute(loop_id, human_contribution=0.6,
                                             ai_contribution=0.4,
                                             verified_value=traj.current_trust * 10000,
                                             value_type="trust_improvement")

        # 6. SETTLE
        _closed_loop.settle(loop_id, employee_credit=1.0,
                           economic_settlement=traj.current_trust * 500)

        return _closed_loop.get_loop(loop_id)

    @app.get("/api/proprietary/integrate/dashboard")
    def integrate_dashboard():
        """Unified dashboard across all 12 systems."""
        return {
            "rep_agents": len(_rep_agents),
            "msl_router": _msl_router.summary(),
            "territories": len(_territory_tac.territories),
            "defrag": _defrag_engine.graph_summary(),
            "trust": _trust_model.portfolio_summary(),
            "inbox": {rid: _get_inbox(rid).summary(rid) for rid in _inbox_defrag},
            "cost_halver": _cost_halver.summary(),
            "fatigue": _fatigue.summary(),
            "access": _access_redirect.summary(),
            "engagement_graph": _engagement_graph.summary(),
            "governance": _governance.summary(),
            "closed_loop": _closed_loop.summary(),
            "competitive_intelligence": _ci_agent.summary(),
            "launch_analyzer": _launch_sim.summary(),
            "measurement": _measurement.summary(),
        }

    @app.get("/api/proprietary/systems")
    def proprietary_systems_list():
        """List all 15 proprietary systems and their status."""
        return {
            "total_systems": 15,
            "systems": [
                {"id": 1, "name": "Rep Personal Agent", "endpoints": 15, "built": True},
                {"id": 2, "name": "MSL Router", "endpoints": 12, "built": True},
                {"id": 3, "name": "Territory-as-Code", "endpoints": 14, "built": True},
                {"id": 4, "name": "Defragmentation Engine", "endpoints": 10, "built": True},
                {"id": 5, "name": "HCP Trust Trajectory", "endpoints": 12, "built": True},
                {"id": 6, "name": "Rep Inbox Defrag", "endpoints": 10, "built": True},
                {"id": 7, "name": "Cost-per-call Halver", "endpoints": 10, "built": True},
                {"id": 8, "name": "HCP Fatigue Intelligence", "endpoints": 10, "built": True},
                {"id": 9, "name": "HCP Access Redirect", "endpoints": 10, "built": True},
                {"id": 10, "name": "Engagement Graph", "endpoints": 15, "built": True},
                {"id": 11, "name": "Agent Population Governance", "endpoints": 12, "built": True},
                {"id": 12, "name": "Attribution-Settlement Closed Loop", "endpoints": 15, "built": True},
                {"id": 13, "name": "Competitive Intelligence Agent", "endpoints": 12, "built": True},
                {"id": 14, "name": "Launch Readiness Analyzer", "endpoints": 12, "built": True},
                {"id": 15, "name": "Measurement Framework + ROI Engine", "endpoints": 12, "built": True},
            ],
            "total_endpoints": 181,
        }

    @app.post("/api/proprietary/integrate/seed-engagement-graph")
    def integrate_seed_graph(hcp_ids: list[str] = None):
        """Seed the engagement graph with HCPs from the database."""
        hcps = db.get_all_hcps()
        if hcp_ids:
            hcps = [h for h in hcps if h.hcp_id in hcp_ids]
        count = 0
        for hcp in hcps:
            _engagement_graph.add_node("hcp", hcp.name, hcp_id=hcp.hcp_id,
                                       specialty=hcp.specialty, territory=hcp.territory)
            count += 1
        return {"seeded": count, "total_nodes": len(_engagement_graph.nodes)}

    @app.post("/api/proprietary/integrate/sync-trust-from-mailos")
    def integrate_sync_trust():
        """Sync trust trajectories from MailOS obligations and intents."""
        obligations = db.get_all_obligations()
        intents = db.get_all_intents()
        hcp_ids = set()
        for o in obligations:
            hcp_ids.add(o.get("hcp_id", ""))
        for i in intents:
            hcp_ids.add(i.get("hcp_id", ""))
        hcp_ids.discard("")
        results = {}
        for hcp_id in hcp_ids:
            traj = _trust_model.compute_trajectory(hcp_id, obligations, intents)
            results[hcp_id] = {"trust": traj.current_trust, "trend": traj.trend.value}
        return {"synced": len(results), "trajectories": results}

    @app.post("/api/proprietary/integrate/governance-check-batch")
    def integrate_governance_batch(actions: list[dict]):
        """Check a batch of agent actions against governance rules."""
        results = []
        for a in actions:
            req = AgentActionRequest(**a)
            approved, reason = _governance.check_action(req)
            results.append({"request_id": req.request_id, "approved": approved, "reason": reason})
        return results

    @app.get("/api/proprietary/integrate/hcp-360/{hcp_id}")
    def integrate_hcp_360(hcp_id: str):
        """360-degree view of an HCP across all 12 systems."""
        return {
            "hcp_id": hcp_id,
            "trust": _trust_model.trajectories.get(hcp_id).__dict__ if hcp_id in _trust_model.trajectories else None,
            "fatigue": _fatigue.compute_fatigue(hcp_id).__dict__,
            "access": _access_redirect.redirect(hcp_id),
            "engagement_graph": _engagement_graph.query_hcp(hcp_id),
            "governance_actions": _governance.get_hcp_actions(hcp_id),
            "cost_halver": [d.__dict__ for d in _cost_halver.decisions.values() if d.hcp_id == hcp_id],
        }

    @app.post("/api/proprietary/integrate/ingest-to-all")
    def integrate_ingest_to_all(mail_id: str, rep_id: str = ""):
        """Ingest a mail into all relevant systems (defrag, trust, inbox, rep agent)."""
        results = {}
        mail = db.get_mail(mail_id)
        if not mail:
            raise HTTPException(404, "Mail not found")
        mail_dict = mail.__dict__ if hasattr(mail, '__dict__') else mail
        hcp_id = mail_dict.get("matched_hcp_id", "")

        # Defrag
        frag = _defrag_engine.ingest_fragment(
            FragmentType.EMAIL, f"mail:{mail_id}",
            mail_dict.get("body", ""))
        _defrag_engine.process_fragment(frag.fragment_id)
        results["defrag"] = {"fragment_id": frag.fragment_id}

        # Trust
        if hcp_id:
            _trust_model.add_signal(hcp_id, "positive_interaction", source="mailos",
                                    description=mail_dict.get("subject", ""))
            results["trust"] = {"signal_added": True}

        # Inbox
        if rep_id:
            inbox = _get_inbox(rep_id)
            item = inbox.ingest_email(rep_id, mail_dict)
            results["inbox"] = {"item_id": item.item_id}

        # Rep agent
        if rep_id and hcp_id:
            agent = _get_rep_agent(rep_id)
            actions = agent.ingest_signals(hcp_id, db.get_all_obligations(),
                                            db.get_all_intents(), [mail_dict])
            results["rep_agent"] = {"actions": len(actions)}

        return results

    @app.get("/api/proprietary/integrate/closed-loop-stats")
    def integrate_loop_stats():
        """Stats across the closed loop + all systems."""
        return {
            "closed_loop": _closed_loop.summary(),
            "governance": _governance.summary(),
            "trust_portfolio": _trust_model.portfolio_summary(),
            "fatigue": _fatigue.summary(),
            "access": _access_redirect.summary(),
            "cost_savings": _cost_halver.summary(),
            "defrag": _defrag_engine.graph_summary(),
            "engagement_graph": _engagement_graph.summary(),
        }

    @app.post("/api/proprietary/integrate/reset")
    def integrate_reset():
        """Reset all proprietary system state."""
        _rep_agents.clear()
        _msl_router = MSLRouter()
        _territory_tac = TerritoryAsCode(database=db)
        _defrag_engine = DefragmentationEngine()
        _trust_model = HCPTrustTrajectory()
        _inbox_defrag.clear()
        _cost_halver = CostPerCallHalver()
        _fatigue = HCPFatigueIntelligence()
        _access_redirect = HCPAccessRedirect()
        _engagement_graph = EngagementGraph()
        _governance = AgentPopulationGovernance()
        _closed_loop = AttributionSettlementLoop()
        _ci_agent = CompetitiveIntelligenceAgent()
        _launch_sim = LaunchReadinessAnalyzer(database=db)
        _measurement = MeasurementFramework()
        return {"reset": True}

    # ─── 13. Competitive Intelligence Agent (12 endpoints) ───

    @app.post("/api/proprietary/ci/register-hcp")
    def ci_register_hcp(body: dict = None):
        body = body or {}
        _ci_agent.register_hcp(body.get("hcp_id", ""), body.get("specialty", ""),
                               body.get("prescribed_drugs", []))
        return {"registered": True, "hcp_id": body.get("hcp_id", "")}

    @app.post("/api/proprietary/ci/signal")
    def ci_ingest_signal(req: CompetitorSignalRequest):
        try:
            stype = CompetitorSignalType(req.signal_type)
        except ValueError:
            raise HTTPException(400, f"Invalid signal type: {req.signal_type}")
        signal = _ci_agent.ingest_signal(
            req.competitor, stype, req.description,
            req.source, req.source_url, req.affected_drugs)
        return signal.__dict__

    @app.get("/api/proprietary/ci/signals")
    def ci_signals(competitor: str = "", threat_level: str = "",
                   signal_type: str = "", unacknowledged_only: bool = False):
        signals = _ci_agent.get_signals(competitor, threat_level, signal_type, unacknowledged_only)
        return [s.__dict__ for s in signals]

    @app.get("/api/proprietary/ci/critical")
    def ci_critical():
        return [s.__dict__ for s in _ci_agent.get_critical_threats()]

    @app.get("/api/proprietary/ci/summary")
    def ci_summary():
        return _ci_agent.summary()

    @app.get("/api/proprietary/ci/competitors")
    def ci_competitors():
        return _ci_agent.COMPETITORS

    @app.get("/api/proprietary/ci/congress-calendar")
    def ci_congress_calendar():
        return _ci_agent.CONGRESS_CALENDAR

    @app.get("/api/proprietary/ci/signal-types")
    def ci_signal_types():
        return {st.value: st.value for st in CompetitorSignalType}

    @app.get("/api/proprietary/ci/threat-levels")
    def ci_threat_levels():
        return {tl.value: tl.value for tl in ThreatLevel}

    @app.get("/api/proprietary/ci/competitor/{competitor}")
    def ci_competitor_summary(competitor: str):
        return _ci_agent.competitor_summary(competitor)

    @app.get("/api/proprietary/ci/hcp/{hcp_id}/exposure")
    def ci_hcp_exposure(hcp_id: str):
        return _ci_agent.hcp_threat_exposure(hcp_id)

    @app.get("/api/proprietary/ci/{signal_id}")
    def ci_signal_detail(signal_id: str):
        signal = _ci_agent.signals.get(signal_id)
        if not signal:
            raise HTTPException(404, "Signal not found")
        return signal.__dict__

    @app.post("/api/proprietary/ci/{signal_id}/acknowledge")
    def ci_acknowledge(signal_id: str, acknowledged_by: str = ""):
        signal = _ci_agent.acknowledge(signal_id, acknowledged_by)
        if not signal:
            raise HTTPException(404, "Signal not found")
        return signal.__dict__

    # ─── 14. Launch Readiness Analyzer (12 endpoints) ───

    @app.post("/api/proprietary/analyzer/load-from-db")
    def analyzer_load_from_db(territory: str = ""):
        try:
            count = _launch_sim.load_from_database(territory)
            return {"loaded": count, "source": "database"}
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.post("/api/proprietary/analyzer/load-panel")
    def analyzer_load_panel(hcps: list[dict]):
        count = _launch_sim.load_hcp_panel(hcps)
        return {"loaded": count, "source": "manual"}

    @app.post("/api/proprietary/analyzer/strategy")
    def analyzer_create_strategy(req: StrategyCreateRequest):
        strategy = _launch_sim.create_strategy(req.name, **{
            k: v for k, v in req.__dict__.items() if k != "name"
        })
        return strategy.__dict__

    @app.post("/api/proprietary/analyzer/{strategy_id}/analyze")
    def analyzer_run(strategy_id: str, scenario: str = "default"):
        try:
            result = _launch_sim.analyze_strategy(strategy_id, scenario)
            return result.__dict__
        except KeyError:
            raise HTTPException(404, "Strategy not found")
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.post("/api/proprietary/analyzer/auto-generate")
    def analyzer_auto_generate(count: int = 100):
        strategies = _launch_sim.auto_generate_strategies(count)
        return [s.__dict__ for s in strategies]

    @app.post("/api/proprietary/analyzer/batch-analyze")
    def analyzer_batch(scenario: str = "default", count: int = 50):
        strategies = _launch_sim.auto_generate_strategies(count)
        results = _launch_sim.batch_analyze(strategies, scenario)
        return [r.__dict__ for r in results]

    @app.get("/api/proprietary/analyzer/results")
    def analyzer_results(strategy_id: str = ""):
        results = _launch_sim.get_results(strategy_id)
        return [r.__dict__ for r in results]

    @app.get("/api/proprietary/analyzer/best")
    def analyzer_best(scenario: str = "default"):
        result = _launch_sim.get_best_strategy(scenario)
        if not result:
            raise HTTPException(404, "No analysis results yet")
        return result.__dict__

    @app.get("/api/proprietary/analyzer/strategies")
    def analyzer_strategies():
        return [s.__dict__ for s in _launch_sim.strategies.values()]

    @app.get("/api/proprietary/analyzer/summary")
    def analyzer_summary():
        return _launch_sim.summary()

    @app.get("/api/proprietary/analyzer/hcp-panel")
    def analyzer_hcp_panel():
        return {"panel_size": len(_launch_sim.hcp_panel),
                "hcps": _launch_sim.hcp_panel[:100]}

    @app.get("/api/proprietary/analyzer/score-weights")
    def analyzer_score_weights():
        return _launch_sim.SCORE_WEIGHTS

    @app.get("/api/proprietary/analyzer/{strategy_id}")
    def analyzer_strategy_detail(strategy_id: str):
        strategy = _launch_sim.strategies.get(strategy_id)
        if not strategy:
            raise HTTPException(404, "Strategy not found")
        return strategy.__dict__

    # ─── 15. Measurement Framework + ROI Engine (12 endpoints) ───

    @app.post("/api/proprietary/measurement/kpi")
    def measurement_record_kpi(req: KPIRecordRequest):
        try:
            measurement = _measurement.record_measurement(req.kpi_name, req.value, req.notes)
            return measurement.__dict__
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.get("/api/proprietary/measurement/kpis")
    def measurement_all_kpis():
        return _measurement.get_all_kpis()

    @app.get("/api/proprietary/measurement/kpi/{kpi_name}")
    def measurement_kpi_detail(kpi_name: str):
        current = _measurement.get_kpi_current(kpi_name)
        if not current:
            raise HTTPException(404, "No measurements for this KPI")
        return current.__dict__

    @app.get("/api/proprietary/measurement/kpi/{kpi_name}/history")
    def measurement_kpi_history(kpi_name: str, limit: int = 30):
        history = _measurement.get_kpi_history(kpi_name, limit)
        return [m.__dict__ for m in history]

    @app.post("/api/proprietary/measurement/system-cost")
    def measurement_set_cost(req: SystemCostRequest):
        _measurement.set_system_cost(req.system_name, req.implementation_cost, req.operating_cost_monthly)
        return {"set": True}

    @app.post("/api/proprietary/measurement/roi/{system_name}")
    def measurement_roi(system_name: str, period: str = "", months_operating: int = 12):
        report = _measurement.generate_roi_report(system_name, period, months_operating)
        return report.__dict__

    @app.get("/api/proprietary/measurement/roi-reports")
    def measurement_roi_reports():
        return _measurement.get_roi_reports()

    @app.get("/api/proprietary/measurement/dashboard")
    def measurement_dashboard():
        return _measurement.get_dashboard()

    @app.get("/api/proprietary/measurement/summary")
    def measurement_summary():
        return _measurement.summary()

    @app.get("/api/proprietary/measurement/kpi-definitions")
    def measurement_kpi_defs():
        return _measurement.KPIS

    @app.post("/api/proprietary/measurement/employee-count")
    def measurement_set_employee_count(count: int):
        _measurement.employee_count = count
        return {"set": True, "employee_count": count}

    @app.get("/api/proprietary/measurement/systems-tracked")
    def measurement_systems_tracked():
        return {"systems": list(_measurement.system_costs.keys()),
                "count": len(_measurement.system_costs)}

    # ─── 16. Taste Oracle (design genome taste memory) ───

    from rxreserve.oracle import TasteOracle, PerceptualTarget
    _taste_oracle = TasteOracle()

    @app.get("/api/oracle/summary")
    def oracle_summary():
        return _taste_oracle.summary()

    @app.post("/api/oracle/extract-genes")
    def oracle_extract_genes(observation: dict = None):
        from rxreserve.design_genome import DesignObservation
        obs = DesignObservation(url=observation.get("url", ""),
                                brand_personality=observation.get("brand_personality", ""),
                                navigation_model=observation.get("navigation_model", ""))
        genes, evaluation = _taste_oracle.extract_genes(obs)
        return {"genes": [g.__dict__ for g in genes], "evaluation": evaluation}

    @app.post("/api/oracle/evaluate")
    def oracle_evaluate(render: dict = None):
        from rxreserve.browser_lab import RenderResult
        r = RenderResult(implementation_id=render.get("implementation_id", ""))
        q = _taste_oracle.evaluate_quality(r)
        return q.__dict__ if hasattr(q, '__dict__') else {"quality": str(q)}

    # ─── 17. Scout (compliant web discovery) ───

    from rxreserve.scout import Scout
    _scout = Scout()

    @app.get("/api/scout/summary")
    def scout_summary():
        return _scout.summary()

    @app.get("/api/scout/sources")
    def scout_discover(max_per_category: int = 5):
        sources = _scout.discover_sources(max_per_category=max_per_category)
        return [s.__dict__ if hasattr(s, '__dict__') else str(s) for s in sources]

    @app.get("/api/scout/oversaturated")
    def scout_oversaturated():
        return _scout.get_oversaturated_patterns()

    # ─── 18. Visual Engineer (evolutionary builder) ───

    from rxreserve.builder import VisualEngineer, MutationType
    _visual_engineer = VisualEngineer()

    @app.get("/api/builder/summary")
    def builder_summary():
        return _visual_engineer.summary()

    @app.get("/api/builder/stats")
    def builder_stats():
        return _visual_engineer.get_stats().__dict__ if hasattr(_visual_engineer.get_stats(), '__dict__') else _visual_engineer.get_stats()

    @app.post("/api/builder/project")
    def builder_start_project(body: dict = None):
        body = body or {}
        from rxreserve.oracle import PerceptualTarget
        from rxreserve.browser_lab import DistinctionContract
        target = PerceptualTarget(
            visual_identity=body.get("visual_identity", ""),
            primary_composition=body.get("primary_composition", ""),
            typography_character=body.get("typography_character", ""))
        contract = DistinctionContract(
            project_name=body.get("name", "unnamed"),
            project_brief=body.get("brief", ""),
            required_emotions=body.get("emotions", []))
        project_id = body.get("project_id", f"proj-{uuid4().hex[:8]}")
        impls = _visual_engineer.start_project(target, contract, project_id)
        return {"project_id": project_id, "implementations": len(impls)}

    @app.post("/api/builder/submit-render")
    def builder_submit_render(body: dict = None):
        body = body or {}
        from rxreserve.browser_lab import RenderResult
        render = RenderResult(implementation_id=body.get("implementation_id", ""))
        result = _visual_engineer.submit_render(body.get("project_id", ""), render)
        return {"result": str(result)}

    @app.post("/api/builder/evolve")
    def builder_evolve(body: dict = None):
        body = body or {}
        result = _visual_engineer.evolve_generation(body.get("project_id", ""))
        return {"evolved": True, "result": str(result)}

    @app.get("/api/builder/best")
    def builder_best():
        best = _visual_engineer.get_best()
        return {"best": str(best)} if best else {"best": None}

    @app.get("/api/builder/stagnant")
    def builder_stagnant():
        return {"stagnant": _visual_engineer.is_stagnant() if hasattr(_visual_engineer, 'is_stagnant') else False}

    @app.post("/api/builder/capability")
    def builder_propose_capability(body: dict = None):
        body = body or {}
        cap = _visual_engineer.propose_capability(
            body.get("name", ""), body.get("description", ""))
        return {"capability": str(cap)}

    # ─── 19. Browser Lab (rendering + evaluation) ───

    from rxreserve.browser_lab import BrowserLab, BrowserJudge, MultiAxisEvaluator, LighthouseEvaluator
    _browser_lab = BrowserLab()
    _browser_judge = BrowserJudge()
    _multi_axis = MultiAxisEvaluator()

    @app.get("/api/browser-lab/summary")
    def browser_lab_summary():
        return _browser_lab.summary()

    @app.post("/api/browser-lab/evaluate")
    async def browser_lab_evaluate(body: dict = None):
        body = body or {}
        result = await _browser_lab.evaluate_implementation(
            body.get("html", "<html><body><h1>Test</h1></body></html>"),
            body.get("project_id", ""))
        return {"result": str(result)}

    @app.get("/api/browser-lab/judge/summary")
    def browser_judge_summary():
        return _browser_judge.summary()

    @app.post("/api/browser-lab/judge/compare")
    def browser_judge_compare(body: dict = None):
        body = body or {}
        result = _browser_judge.compare(
            body.get("render_a_id", ""), body.get("render_b_id", ""))
        return {"comparison": str(result)}

    @app.post("/api/browser-lab/judge/rank")
    def browser_judge_rank(body: list = None):
        body = body or []
        result = _browser_judge.rank(body)
        return {"ranking": str(result)}

    @app.post("/api/browser-lab/lighthouse")
    async def browser_lab_lighthouse(body: dict = None):
        body = body or {}
        audit = await LighthouseEvaluator.audit(
            body.get("url", ""),
            performance_trace=body.get("performance_trace"),
            source_code=body.get("source_code", ""))
        return audit

    @app.post("/api/browser-lab/lighthouse/wcag")
    def browser_lab_wcag(body: dict = None):
        body = body or {}
        passes, violations = LighthouseEvaluator.check_wcag_2_2(body)
        return {"passes": passes, "violations": violations}

    # ─── 20. Canonical Ledger (event-sourced state) ───

    from rxreserve.ledger import CanonicalLedger, EventType
    _ledger = CanonicalLedger()

    @app.get("/api/ledger/summary")
    def ledger_summary():
        return _ledger.summary()

    @app.get("/api/ledger/events")
    def ledger_events(entity_id: str = ""):
        if entity_id:
            events = _ledger.get_events_for_entity(entity_id)
        else:
            events = _ledger.all_events()
        return [e.__dict__ if hasattr(e, '__dict__') else str(e) for e in events]

    @app.post("/api/ledger/record")
    def ledger_record(body: dict = None):
        body = body or {}
        try:
            etype = EventType(body.get("event_type", "state_change"))
        except ValueError:
            etype = EventType.STATE_CHANGE
        event_id = _ledger.record(
            etype,
            actor=body.get("actor", ""),
            entity_id=body.get("entity_id", ""),
            entity_type=body.get("entity_type", ""),
            payload=body.get("data", {}))
        return {"recorded": True, "event_id": event_id}

    @app.get("/api/ledger/audit/{entity_id}")
    def ledger_audit(entity_id: str):
        trail = _ledger.audit_trail(entity_id)
        return {"entity_id": entity_id, "audit_trail": str(trail)}

    @app.get("/api/ledger/project/{entity_id}")
    def ledger_project(entity_id: str):
        state = _ledger.project(entity_id)
        return {"entity_id": entity_id, "projected_state": str(state)}

    @app.post("/api/ledger/replay")
    def ledger_replay(body: dict = None):
        body = body or {}
        result = _ledger.replay(body.get("from_event", 0))
        return {"replay": str(result)}

    # ─── 21. Agent Merge (optimistic concurrency for agents) ───

    from rxreserve.agent_merge import ThreeWayMerger, MergeOrchestrator, ArchitecturalConstitution
    _merger = ThreeWayMerger()
    _merge_orchestrator = MergeOrchestrator()
    _constitution = ArchitecturalConstitution()

    @app.post("/api/agent-merge/merge")
    def agent_merge_merge(body: dict = None):
        body = body or {}
        result = _merger.merge(
            body.get("base", ""), body.get("current", ""), body.get("proposed", ""))
        return result.__dict__ if hasattr(result, '__dict__') else {"result": str(result)}

    @app.get("/api/agent-merge/orchestrator/summary")
    def agent_merge_summary():
        return _merge_orchestrator.summary()

    @app.get("/api/agent-merge/orchestrator/sessions")
    def agent_merge_sessions():
        sessions = _merge_orchestrator.active_sessions()
        return {"sessions": [str(s) for s in sessions]}

    @app.post("/api/agent-merge/orchestrator/begin")
    def agent_merge_begin(body: dict = None):
        body = body or {}
        session = _merge_orchestrator.begin_edit(
            body.get("agent_id", ""), body.get("file_path", ""))
        return {"session": str(session)}

    @app.post("/api/agent-merge/orchestrator/propose")
    def agent_merge_propose(body: dict = None):
        body = body or {}
        result = _merge_orchestrator.propose(
            body.get("session_id", ""), body.get("proposed_content", ""))
        return {"result": str(result)}

    @app.post("/api/agent-merge/orchestrator/commit")
    def agent_merge_commit(body: dict = None):
        body = body or {}
        result = _merge_orchestrator.commit(body.get("session_id", ""))
        return {"result": str(result)}

    @app.post("/api/agent-merge/orchestrator/abort")
    def agent_merge_abort(body: dict = None):
        body = body or {}
        result = _merge_orchestrator.abort(body.get("session_id", ""))
        return {"result": str(result)}

    @app.get("/api/agent-merge/orchestrator/history/{session_id}")
    def agent_merge_history(session_id: str):
        history = _merge_orchestrator.session_history(session_id)
        return {"history": [str(h) for h in history]}

    @app.get("/api/agent-merge/constitution/invariants")
    def agent_merge_invariants():
        return _constitution.summary() if hasattr(_constitution, 'summary') else {}

    # ─── 22. Economics (balance sheets + utility) ───

    from rxreserve.economics import EmployeeBalanceSheet, CompanyBalanceSheet, StateVector
    _employee_bs = EmployeeBalanceSheet(employee_id="default")
    _company_bs = CompanyBalanceSheet()

    @app.get("/api/economics/employee/summary")
    def economics_employee_summary():
        return _employee_bs.to_dict() if hasattr(_employee_bs, 'to_dict') else {"employee_id": "default"}

    @app.get("/api/economics/company/summary")
    def economics_company_summary():
        return _company_bs.to_dict() if hasattr(_company_bs, 'to_dict') else {}

    @app.get("/api/economics/state-vector")
    def economics_state_vector():
        sv = StateVector()
        return sv.to_dict() if hasattr(sv, 'to_dict') else {"state": str(sv)}

    # ─── 23. Services (ledger, underwriter, exchange, oracle, attribution, magnifier) ───

    from rxreserve.services import (LedgerService, UnderwriterService, ExchangeService,
                                     OracleService, AttributionService, MagnifierService)
    _ledger_service = LedgerService()
    _underwriter = UnderwriterService()
    _exchange = ExchangeService()
    _oracle_service = OracleService()
    _attribution_service = AttributionService()
    _magnifier = MagnifierService()

    @app.get("/api/services/ledger/summary")
    def services_ledger_summary():
        return _ledger_service.summary() if hasattr(_ledger_service, 'summary') else {}

    @app.get("/api/services/underwriter/summary")
    def services_underwriter_summary():
        return _underwriter.summary() if hasattr(_underwriter, 'summary') else {}

    @app.post("/api/services/underwriter/underwrite")
    def services_underwriter_underwrite(body: dict = None):
        body = body or {}
        # UnderwriterService.underwrite requires complex typed args;
        # return summary for now — full underwriting requires constructing
        # UncertaintyAsset, ExperimentOption, utility objects, and GovernorAssessment
        return {"result": "underwrite requires typed args (UncertaintyAsset, ExperimentOption, etc.)",
                "summary": _underwriter.summary()}

    @app.get("/api/services/exchange/summary")
    def services_exchange_summary():
        return _exchange.summary() if hasattr(_exchange, 'summary') else {}

    @app.post("/api/services/exchange/clear")
    def services_exchange_clear(body: dict = None):
        body = body or {}
        if hasattr(_exchange, 'cleared_market'):
            result = _exchange.cleared_market()
            return {"result": str(result)}
        return {"result": None}

    @app.get("/api/services/exchange/opportunities")
    def services_exchange_opportunities():
        if hasattr(_exchange, 'opportunity_market'):
            return {"opportunities": str(_exchange.opportunity_market())}
        return {"opportunities": []}

    @app.get("/api/services/oracle/summary")
    def services_oracle_summary():
        return _oracle_service.summary() if hasattr(_oracle_service, 'summary') else {}

    @app.get("/api/services/attribution/summary")
    def services_attribution_summary():
        return _attribution_service.summary() if hasattr(_attribution_service, 'summary') else {}

    @app.get("/api/services/magnifier/summary")
    def services_magnifier_summary():
        return _magnifier.summary() if hasattr(_magnifier, 'summary') else {}

    # ─── 24. Real-Time Streaming Data (WebSocket + auto-ingest) ───

    from rxreserve.stream import (
        create_default_stream_manager, StreamManager, StreamEvent,
        FDAAdverseEventStream, FDADrugRecallStream, FDADrugLabelStream,
        ClinicalTrialsStream, PubMedStream, NPIRegistryStream,
    )

    _stream_mgr = create_default_stream_manager()

    def _ingest_stream_event(event: StreamEvent) -> None:
        """Auto-feed streaming events into proprietary systems."""
        try:
            if "trust" in event.targets:
                for hcp_id in list(_trust_model.signals.keys()):
                    reaction = event.data.get("reactions", ["unknown"])
                    reaction_str = reaction[0] if isinstance(reaction, list) and reaction else "unknown"
                    _trust_model.add_signal(
                        hcp_id, "adverse_experience",
                        signal_value=-0.15, source=event.source,
                        description=f"FDA AE: {reaction_str} ({event.data.get('drug_name', '')})")
            if "ci" in event.targets:
                from rxreserve.proprietary import CompetitorSignalType
                competitor = "Unknown"
                drug = event.data.get("drug_name", event.data.get("query_drug", ""))
                sig_type = CompetitorSignalType.KOL_PUBLICATION
                if event.event_type == "competitor_trial":
                    competitor = event.data.get("sponsor", "Unknown")
                    sig_type = CompetitorSignalType.CLINICAL_TRIAL_READOUT
                elif event.event_type == "new_publication":
                    competitor = "Academic KOL"
                    sig_type = CompetitorSignalType.KOL_PUBLICATION
                elif event.event_type == "new_drug_recall":
                    competitor = event.data.get("recalling_firm", "Unknown")
                    sig_type = CompetitorSignalType.LABEL_CHANGE
                elif event.event_type == "new_drug_label":
                    competitor = event.data.get("manufacturer", "Unknown")
                    sig_type = CompetitorSignalType.LABEL_CHANGE
                desc = (event.data.get("title") or event.data.get("reason_for_recall") or
                        (event.data.get("reactions", ["event"])[0] if event.data.get("reactions") else "event"))
                _ci_agent.ingest_signal(
                    competitor=competitor,
                    signal_type=sig_type,
                    description=str(desc)[:300],
                    source=event.source,
                    affected_drugs=[drug] if drug else [])
            if "defrag" in event.targets:
                from rxreserve.proprietary import FragmentType
                content = json.dumps(event.data, default=str)
                _defrag_engine.ingest_fragment(
                    FragmentType.UNKNOWN, event.source, content)
            if "engagement_graph" in event.targets and event.event_type == "new_hcp":
                _engagement_graph.add_node(
                    "hcp", event.data.get("name", ""),
                    npi=event.data.get("npi", ""),
                    specialty=event.data.get("specialty", ""),
                    state=event.data.get("state", ""))
        except Exception:
            pass  # don't let ingest errors kill the stream

    _stream_mgr.set_ingest_callback(_ingest_stream_event)

    @app.on_event("startup")
    async def _start_streams():
        await _stream_mgr.start()

    @app.on_event("shutdown")
    async def _stop_streams():
        await _stream_mgr.stop()

    @app.get("/api/stream/status")
    def stream_status():
        """Get status of all streaming sources."""
        return _stream_mgr.status()

    @app.get("/api/stream/sources")
    def stream_sources():
        """List all streaming data sources with compliance metadata."""
        sources = []
        for s in _stream_mgr.sources.values():
            sources.append({
                "name": s.name,
                "interval_seconds": s.interval,
                "events_emitted": s.event_count,
                "running": s._running,
                "api_url": s.api_url,
                "free": not s.license_required,
                "license_required": s.license_required,
                "auth_required": s.auth_required,
                "api_key_required": False,
                "compliantly_sourced": not s.license_required and not s.auth_required,
            })
        return {
            "sources": sources,
            "total_sources": len(_stream_mgr.sources),
            "subscribers": len(_stream_mgr._subscribers),
            "all_free": all(not s.license_required for s in _stream_mgr.sources.values()),
            "all_no_auth": all(not s.auth_required for s in _stream_mgr.sources.values()),
            "all_compliantly_sourced": all(
                not s.license_required and not s.auth_required
                for s in _stream_mgr.sources.values()),
        }

    @app.get("/api/stream/events")
    def stream_events(limit: int = 50, source: str = ""):
        """Get recent events from the stream buffer (REST pull)."""
        if source:
            return {"events": _stream_mgr.events_by_source(source, limit)}
        return {"events": _stream_mgr.recent_events(limit)}

    @app.get("/api/stream/events/{source_name}")
    def stream_events_by_source(source_name: str, limit: int = 50):
        """Get recent events from a specific source."""
        return {"source": source_name,
                "events": _stream_mgr.events_by_source(source_name, limit)}

    @app.post("/api/stream/poll/{source_name}")
    async def stream_poll_now(source_name: str):
        """Manually trigger a poll of a specific source (don't wait for interval)."""
        source = _stream_mgr.sources.get(source_name)
        if not source:
            raise HTTPException(404, f"Source {source_name} not found")
        items = await source.poll()
        new_count = 0
        for item in items:
            item_id = source.item_id(item)
            if item_id in source._seen_ids:
                continue
            source._seen_ids.add(item_id)
            event = source.make_event(item)
            source.event_count += 1
            new_count += 1
            # Buffer + auto-ingest + fan out
            _stream_mgr._all_events.append(event)
            if _stream_mgr._ingest_callback:
                try:
                    _stream_mgr._ingest_callback(event)
                except Exception:
                    pass
            for sub in list(_stream_mgr._subscribers):
                try:
                    sub.put_nowait(event)
                except asyncio.QueueFull:
                    pass
        return {"source": source_name, "polled": len(items), "new": new_count}

    @app.post("/api/stream/poll-all")
    async def stream_poll_all():
        """Manually trigger a poll of all sources."""
        results = {}
        for name, source in _stream_mgr.sources.items():
            items = await source.poll()
            new_count = 0
            for item in items:
                item_id = source.item_id(item)
                if item_id in source._seen_ids:
                    continue
                source._seen_ids.add(item_id)
                event = source.make_event(item)
                source.event_count += 1
                new_count += 1
                # Buffer + auto-ingest + fan out
                _stream_mgr._all_events.append(event)
                if _stream_mgr._ingest_callback:
                    try:
                        _stream_mgr._ingest_callback(event)
                    except Exception:
                        pass
                for sub in list(_stream_mgr._subscribers):
                    try:
                        sub.put_nowait(event)
                    except asyncio.QueueFull:
                        pass
            results[name] = {"polled": len(items), "new": new_count}
        return results

    @app.websocket("/ws/stream")
    async def ws_stream(ws: WebSocket):
        """WebSocket: real-time push of all stream events.

        Like Binance WebSocket — connect and receive a live push of every
        new adverse event, drug recall, clinical trial, publication, and
        HCP registration as they happen.

        Optional query params:
          ?sources=fda_adverse_events,pubmed  — filter to specific sources
          ?targets=trust,ci                   — filter by ingest targets
        """
        await ws.accept()
        sources_filter = ws.query_params.get("sources", "")
        targets_filter = ws.query_params.get("targets", "")
        sources_set = set(sources_filter.split(",")) if sources_filter else None
        targets_set = set(targets_filter.split(",")) if targets_filter else None

        queue = _stream_mgr.subscribe()
        try:
            # Send initial status
            await ws.send_json({"type": "connected",
                                "status": _stream_mgr.status()})
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    # Apply filters
                    if sources_set and event.source not in sources_set:
                        continue
                    if targets_set and not set(event.targets) & targets_set:
                        continue
                    await ws.send_json({"type": "event", "event": asdict(event)})
                except asyncio.TimeoutError:
                    # Send heartbeat
                    await ws.send_json({"type": "heartbeat",
                                        "timestamp": datetime.now(timezone.utc).isoformat()})
        except WebSocketDisconnect:
            pass
        finally:
            _stream_mgr.unsubscribe(queue)

    @app.websocket("/ws/stream/{source_name}")
    async def ws_stream_source(ws: WebSocket, source_name: str):
        """WebSocket: real-time push from a single source."""
        await ws.accept()
        source = _stream_mgr.sources.get(source_name)
        if not source:
            await ws.send_json({"type": "error", "message": f"Source {source_name} not found"})
            await ws.close()
            return

        queue = _stream_mgr.subscribe()
        try:
            await ws.send_json({"type": "connected", "source": source_name,
                                "status": source.status()})
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    if event.source != source_name:
                        continue
                    await ws.send_json({"type": "event", "event": asdict(event)})
                except asyncio.TimeoutError:
                    await ws.send_json({"type": "heartbeat",
                                        "timestamp": datetime.now(timezone.utc).isoformat()})
        except WebSocketDisconnect:
            pass
        finally:
            _stream_mgr.unsubscribe(queue)

    # ─── 25. KPI Evolution Engine (GA-based infinite KPI derivatives) ───

    from rxreserve.kpi_evolution import KPIEvolutionEngine

    _kpi_engine = KPIEvolutionEngine(
        population_limit=200,
        kill_ratio=0.2,
        replicate_ratio=0.3,
        genesis_count=10,
        cycle_interval_hours=1.0,
    )

    # Feed stream events into the KPI engine
    def _feed_kpi_engine(events: list) -> None:
        _kpi_engine.feed_events([e if isinstance(e, dict) else asdict(e) for e in events])

    # Override the stream ingest to also feed KPI engine
    _original_ingest = _stream_mgr._ingest_callback

    def _combined_ingest(event) -> None:
        _original_ingest(event)
        _kpi_engine.feed_events([asdict(event)] + _kpi_engine._event_buffer[:499])

    _stream_mgr.set_ingest_callback(_combined_ingest)

    @app.on_event("startup")
    async def _start_kpi_engine():
        # Crash recovery: restore population from last checkpoint
        restored = _kpi_engine.restore()
        if restored:
            print(f"[KPI Evolution] Restored from checkpoint: gen {_kpi_engine.generation}, "
                  f"{len([k for k in _kpi_engine.population.values() if k.alive])} alive KPIs")
        else:
            print("[KPI Evolution] No checkpoint found — starting fresh with seed KPIs")
        asyncio.create_task(_kpi_engine.run())

    @app.on_event("shutdown")
    async def _stop_kpi_engine():
        _kpi_engine.stop()  # saves final checkpoint

    @app.get("/api/kpi-evolution/status")
    def kpi_evolution_status():
        """Get KPI evolution engine status."""
        return _kpi_engine.status()

    @app.get("/api/kpi-evolution/population")
    def kpi_evolution_population(sort_by: str = "fitness", limit: int = 50):
        """Get alive KPIs in the population."""
        return {"kpis": _kpi_engine.alive_kpis(sort_by=sort_by, limit=limit),
                "total": len([k for k in _kpi_engine.population.values() if k.alive])}

    @app.get("/api/kpi-evolution/graveyard")
    def kpi_evolution_graveyard(limit: int = 20):
        """Get killed KPIs (the ones that didn't survive)."""
        return {"dead": _kpi_engine.dead_kpis(limit=limit),
                "total_died": _kpi_engine.total_died}

    @app.get("/api/kpi-evolution/top")
    def kpi_evolution_top(limit: int = 10):
        """Get top-performing KPIs by fitness."""
        return {"top_kpis": _kpi_engine.alive_kpis(sort_by="fitness", limit=limit)}

    @app.get("/api/kpi-evolution/genesis")
    def kpi_evolution_genesis(limit: int = 20):
        """Get KPIs created via genesis (brand new from source fields)."""
        alive = [k.to_dict() for k in _kpi_engine.population.values()
                 if k.alive and k.mutation_type == "genesis"]
        alive.sort(key=lambda k: k["generation"], reverse=True)
        return {"genesis_kpis": alive[:limit], "total": len(alive)}

    @app.get("/api/kpi-evolution/lineage/{kpi_id}")
    def kpi_evolution_lineage(kpi_id: str):
        """Trace a KPI's evolutionary lineage (ancestors + children)."""
        return _kpi_engine.kpi_lineage(kpi_id)

    @app.get("/api/kpi-evolution/history")
    def kpi_evolution_history(limit: int = 20):
        """Get recent evolution cycle results."""
        return {"cycles": _kpi_engine.evolution_history(limit=limit)}

    @app.get("/api/kpi-evolution/sources")
    def kpi_evolution_sources():
        """Get distribution of KPIs by data source."""
        return {"distribution": _kpi_engine.source_distribution()}

    @app.get("/api/kpi-evolution/mutations")
    def kpi_evolution_mutations():
        """Get distribution of KPIs by mutation type."""
        return {"distribution": _kpi_engine.mutation_distribution()}

    @app.post("/api/kpi-evolution/cycle")
    def kpi_evolution_run_cycle():
        """Manually trigger one evolution cycle (measure → kill → replicate → genesis)."""
        # Feed latest stream events before running cycle
        events = _stream_mgr.recent_events(limit=500)
        _kpi_engine.feed_events(events)
        result = _kpi_engine.run_cycle()
        return result

    @app.post("/api/kpi-evolution/feed")
    def kpi_evolution_feed():
        """Feed current stream events into the KPI engine for measurement."""
        events = _stream_mgr.recent_events(limit=500)
        _kpi_engine.feed_events(events)
        return {"fed": len(events), "buffer_size": len(_kpi_engine._event_buffer)}

    @app.post("/api/kpi-evolution/checkpoint")
    def kpi_evolution_checkpoint():
        """Manually save a checkpoint for crash recovery."""
        path = _kpi_engine.checkpoint()
        return {"saved": bool(path), "path": path,
                "generation": _kpi_engine.generation,
                "alive": len([k for k in _kpi_engine.population.values() if k.alive])}

    @app.post("/api/kpi-evolution/restore")
    def kpi_evolution_restore():
        """Restore population from last checkpoint."""
        restored = _kpi_engine.restore()
        return {"restored": restored,
                "generation": _kpi_engine.generation,
                "alive": len([k for k in _kpi_engine.population.values() if k.alive])}

    @app.get("/api/kpi-evolution/schedule")
    def kpi_evolution_schedule():
        """Get the 24/6 evolution schedule."""
        now = datetime.now(timezone.utc)
        return {
            "schedule": "24/6",
            "description": "Runs 24 hours/day, 6 days/week. Pauses on rest day.",
            "rest_day": _kpi_engine.rest_day,
            "rest_day_index": _kpi_engine.REST_DAY,
            "is_rest_day": _kpi_engine._is_rest_day(),
            "is_maintenance_hour": _kpi_engine._is_rest_hour(),
            "maintenance_window": "03:00-04:00 UTC (checkpoint + graveyard cleanup)",
            "cycle_interval_hours": _kpi_engine.cycle_interval / 3600,
            "current_utc": now.isoformat(),
            "current_weekday": now.strftime("%A"),
            "running": _kpi_engine._running,
        }

    @app.post("/api/kpi-evolution/cleanup")
    def kpi_evolution_cleanup():
        """Clean up graveyard (remove old dead KPIs)."""
        removed = _kpi_engine._cleanup_graveyard()
        return {"removed": removed,
                "graveyard_size": len([k for k in _kpi_engine.population.values() if not k.alive])}

    # ─── 26. LLM KPI Genesis Service (live crawling + LLM-generated KPIs) ───

    from rxreserve.llm_kpi_genesis import LLMKPIGenesisService

    _llm_genesis = LLMKPIGenesisService(population_limit=100, genesis_interval_hours=1.0)

    @app.on_event("startup")
    async def _start_llm_genesis():
        asyncio.create_task(_llm_genesis.run())

    @app.on_event("shutdown")
    async def _stop_llm_genesis():
        _llm_genesis.stop()

    @app.get("/api/llm-genesis/status")
    def llm_genesis_status():
        """Get LLM KPI genesis service status."""
        return _llm_genesis.status()

    @app.get("/api/llm-genesis/kpis")
    def llm_genesis_kpis(sort_by: str = "fitness", limit: int = 50):
        """Get LLM-generated KPIs."""
        return {"kpis": _llm_genesis.alive_kpis(sort_by=sort_by, limit=limit)}

    @app.get("/api/llm-genesis/dimensions")
    def llm_genesis_dimensions():
        """Get the full dimension tree discovered by the LLM."""
        return {"dimensions": _llm_genesis.dimensions(),
                "total_dimensions": len(_llm_genesis.discovered_dimensions),
                "total_sub_dimensions": sum(len(v) for v in _llm_genesis.discovered_dimensions.values())}

    @app.get("/api/llm-genesis/dimensions/{dimension}")
    def llm_genesis_kpis_by_dimension(dimension: str):
        """Get KPIs in a specific dimension."""
        return {"dimension": dimension,
                "kpis": _llm_genesis.kpis_by_dimension(dimension)}

    @app.post("/api/llm-genesis/genesis")
    def llm_genesis_trigger():
        """Manually trigger LLM KPI genesis (discover new KPIs from real data)."""
        events = _stream_mgr.recent_events(limit=500)
        _llm_genesis.feed_events(events)
        new_kpis = _llm_genesis.llm_genesis()
        return {"generated": len(new_kpis),
                "kpis": [k.to_dict() for k in new_kpis]}

    @app.post("/api/llm-genesis/refine/{kpi_id}")
    def llm_genesis_refine(kpi_id: str):
        """Manually trigger LLM refinement of a specific KPI."""
        child = _llm_genesis.llm_refine(kpi_id)
        if child:
            return {"refined": True, "kpi": child.to_dict()}
        return {"refined": False, "error": "Could not refine KPI"}

    @app.post("/api/llm-genesis/granulate/{dimension}")
    def llm_genesis_granulate(dimension: str):
        """Use LLM to granulate a dimension into finer sub-dimensions."""
        new_subs = _llm_genesis.llm_granulate(dimension)
        return {"dimension": dimension,
                "new_sub_dimensions": new_subs,
                "all_sub_dimensions": _llm_genesis.discovered_dimensions.get(dimension, [])}

    @app.post("/api/llm-genesis/cycle")
    def llm_genesis_cycle():
        """Manually trigger one full LLM evolution cycle."""
        events = _stream_mgr.recent_events(limit=500)
        _llm_genesis.feed_events(events)
        return _llm_genesis.run_cycle()

    @app.post("/api/llm-genesis/feed")
    def llm_genesis_feed():
        """Feed current stream events into the LLM genesis service."""
        events = _stream_mgr.recent_events(limit=500)
        _llm_genesis.feed_events(events)
        return {"fed": len(events), "buffer": len(_llm_genesis._event_buffer)}

    @app.get("/api/llm-genesis/history")
    def llm_genesis_history(limit: int = 20):
        """Get recent genesis history."""
        return {"history": _llm_genesis.genesis_history[-limit:]}

    @app.websocket("/ws/llm-genesis")
    async def ws_llm_genesis(ws: WebSocket):
        """WebSocket: real-time push of LLM KPI genesis events."""
        await ws.accept()
        last_gen = 0
        try:
            await ws.send_json({"type": "connected", "status": _llm_genesis.status()})
            while True:
                if _llm_genesis.generation > last_gen:
                    last_gen = _llm_genesis.generation
                    await ws.send_json({
                        "type": "cycle_complete",
                        "status": _llm_genesis.status(),
                        "top_kpis": _llm_genesis.alive_kpis(sort_by="fitness", limit=5),
                    })
                await asyncio.sleep(1.0)
        except WebSocketDisconnect:
            pass

    @app.websocket("/ws/kpi-evolution")
    async def ws_kpi_evolution(ws: WebSocket):
        """WebSocket: real-time push of KPI evolution events.

        Pushes a message every time an evolution cycle runs, including
        which KPIs were born, which died, and fitness scores.
        """
        await ws.accept()
        last_gen = 0
        try:
            await ws.send_json({"type": "connected", "status": _kpi_engine.status()})
            while True:
                if _kpi_engine.generation > last_gen:
                    last_gen = _kpi_engine.generation
                    await ws.send_json({
                        "type": "cycle_complete",
                        "status": _kpi_engine.status(),
                        "latest_cycle": _kpi_engine.cycle_history[-1] if _kpi_engine.cycle_history else None,
                        "top_kpis": _kpi_engine.alive_kpis(sort_by="fitness", limit=5),
                    })
                await asyncio.sleep(1.0)
        except WebSocketDisconnect:
            pass

    return app
