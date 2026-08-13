from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any, Optional

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
from rxreserve.pricing import (
    ScenarioPricer,
    Scenario,
    ScenarioSet,
    value_experiment,
)
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
from rxreserve.mailos import MailObject, ObligationStatus
from rxreserve.mailos_engine import RxMailOS


def cmd_create(args):
    db = Database(args.db)
    f = PharmaFrontier(
        problem=args.problem,
        unknowns=args.unknowns.split(";") if args.unknowns else [],
        economic_consequence=args.economic or "",
        quality_patient_consequence=args.quality or "",
        current_workaround=args.workaround or "",
        regulatory_domain=args.regulatory or "",
        cost_of_learning=args.cost or 0,
        maximum_upside=args.upside or 0,
        human_originators=args.originators.split(";") if args.originators else [],
    )
    f.evidence_envelope = EvidenceEnvelope(
        source_signal=args.signal or "",
        source_system=args.source_system or "",
        employee_observation=args.observation or "",
        confidence=args.confidence or 0.0,
        human_verification=bool(args.verified),
    )
    f.contribution_envelope = ContributionEnvelope(
        human_originators=f.human_originators,
        human_contribution=args.human_contrib or "",
        ai_generated_candidates=args.ai_candidates.split(";") if args.ai_candidates else [],
        human_selection=args.human_selection or "",
        human_modifications=args.human_mods or "",
    )
    f.rights_envelope = RightsEnvelope(
        rights_owner=RightsOwner(args.rights_owner) if args.rights_owner else RightsOwner.UNRESOLVED,
        jurisdiction=args.jurisdiction or "",
        governing_agreement=args.agreement or "",
        patent_review_required=not args.no_patent_review,
    )
    db.upsert_frontier(f)
    print(f"Created frontier: {f.frontier_id}")
    print(f"  State: {f.state.value}")
    print(f"  Problem: {f.problem[:80]}")
    db.close()


def cmd_list(args):
    db = Database(args.db)
    frontiers = db.get_all_frontiers()
    if not frontiers:
        print("No frontiers in database.")
        db.close()
        return
    for f in frontiers:
        print(f"  {f.frontier_id[:12]} | {f.state.value:25s} | {f.problem[:60]}")
    db.close()


def cmd_show(args):
    db = Database(args.db)
    f = db.get_frontier(args.frontier_id)
    if not f:
        print(f"Frontier {args.frontier_id} not found")
        sys.exit(1)
    print(json.dumps(f.to_dict(), indent=2))
    db.close()


def cmd_transition(args):
    db = Database(args.db)
    try:
        f = db.transition_frontier(args.frontier_id, FrontierState(args.target), actor=args.actor or "", notes=args.notes or "")
        print(f"Transitioned to: {f.state.value}")
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)
    db.close()


def cmd_history(args):
    db = Database(args.db)
    history = db.get_state_history(args.frontier_id)
    if not history:
        print("No state history.")
        db.close()
        return
    for h in history:
        print(f"  {h['timestamp'][:19]} | {h['from_state']:25s} → {h['to_state']:25s} | {h['actor']} | {h['notes']}")
    db.close()


def cmd_gapswat(args):
    db = Database(args.db)
    f = db.get_frontier(args.frontier_id)
    if not f:
        print(f"Frontier {args.frontier_id} not found")
        sys.exit(1)

    gap = GapAssessment(
        impact=args.impact or 0.5,
        frequency=args.frequency or 0.5,
        unmetness=args.unmetness or 0.5,
    )
    advantage = StrategicAdvantage(
        proprietary_data=args.prop_data or 0,
        domain_expertise=args.expertise or 0,
        existing_infrastructure=args.infrastructure or 0,
        regulatory_position=args.reg_position or 0,
        distribution=args.distribution or 0,
    )
    attribution = AttributionAssessment(
        employee_observed=args.emp_observed or "",
        employee_originated=args.emp_originated or "",
        ai_generated=args.ai_gen or "",
        existed_independently=args.existed or "",
        would_happen_anyway=args.anyway or "",
    )
    transform = TransformAssessment(
        transform_type=TransformType(args.transform) if args.transform else TransformType.NONE,
        magnification_factor=args.magnification or 1.0,
        description=args.transform_desc or "",
    )

    underwriter = GapSWATUnderwriter()
    report = underwriter.underwrite(f, gap, advantage, attribution, transform)
    print(json.dumps(report.to_dict(), indent=2))
    db.close()


def cmd_wargame(args):
    db = Database(args.db)
    f = db.get_frontier(args.frontier_id)
    if not f:
        print(f"Frontier {args.frontier_id} not found")
        sys.exit(1)

    wg = WarGame()
    results = wg.run(f)
    summary = wg.summary(results)
    print(json.dumps(summary, indent=2))
    db.close()


def cmd_price(args):
    db = Database(args.db)
    f = db.get_frontier(args.frontier_id)
    if not f:
        print(f"Frontier {args.frontier_id} not found")
        sys.exit(1)

    pricer = ScenarioPricer()

    # Build scenarios from frontier data
    tech_scenarios = [
        Scenario("technical_success", 0.6, 1.0, "Technical approach is viable"),
        Scenario("technical_partial", 0.3, 0.5, "Partial technical success"),
        Scenario("technical_failure", 0.1, 0.0, "Technical approach fails"),
    ]
    reg_scenarios = [
        Scenario("regulatory_clear", 0.7, 1.0, "No regulatory barriers"),
        Scenario("regulatory_conditional", 0.2, 0.7, "Conditional approval needed"),
        Scenario("regulatory_block", 0.1, 0.0, "Regulatory barrier"),
    ]
    adopt_scenarios = [
        Scenario("adoption_high", 0.5, 1.0, "High adoption"),
        Scenario("adoption_moderate", 0.4, 0.6, "Moderate adoption"),
        Scenario("adoption_low", 0.1, 0.2, "Low adoption"),
    ]
    evidence_scenarios = [
        Scenario("evidence_sufficient", 0.7, 1.0, "Evidence is sufficient"),
        Scenario("evidence_insufficient", 0.3, 0.3, "Evidence gaps remain"),
    ]
    econ_scenarios = [
        Scenario("economic_positive", 0.6, 1.0, "Positive economics"),
        Scenario("economic_marginal", 0.3, 0.5, "Marginal economics"),
        Scenario("economic_negative", 0.1, 0.0, "Negative economics"),
    ]

    scenarios = ScenarioSet(
        technical=tech_scenarios, regulatory=reg_scenarios,
        adoption=adopt_scenarios, evidence=evidence_scenarios,
        economic=econ_scenarios,
    )

    cost_low = f.cost_of_learning * 0.8 if f.cost_of_learning else 50000
    cost_high = f.cost_of_learning * 1.5 if f.cost_of_learning else 150000
    value_low = f.maximum_upside * 0.5 if f.maximum_upside else 300000
    value_high = f.maximum_upside * 1.2 if f.maximum_upside else 800000

    pricing = pricer.price_frontier(
        scenarios,
        implementation_cost_range=(cost_low, cost_high),
        annual_value_range=(value_low, value_high),
        downside_range=(cost_low * 0.5, cost_high * 0.8),
        planned_rollout_cost=args.rollout_cost or 0,
        prob_invalidates_rollout=args.prob_invalidate or 0.15,
    )
    print(json.dumps(pricing.to_dict(), indent=2))
    db.close()


def cmd_value_experiment(args):
    val = value_experiment(
        cost=args.cost,
        success_upside=args.upside,
        probability_success=args.prob,
        planned_rollout_cost=args.rollout or 0,
        prob_invalidates_rollout=args.prob_invalidate or 0,
    )
    print(json.dumps(val.to_dict(), indent=2))


def cmd_add_experiment(args):
    db = Database(args.db)
    f = db.get_frontier(args.frontier_id)
    if not f:
        print(f"Frontier {args.frontier_id} not found")
        sys.exit(1)

    exp = ExperimentContract(
        frontier_id=args.frontier_id,
        hypothesis=args.hypothesis,
        capital_committed=args.capital or 0,
        owners=args.owners.split(";") if args.owners else [],
        measurement_rules=args.measurement or "",
        stop_conditions=args.stop.split(";") if args.stop else [],
        evidence_requirements=args.evidence.split(";") if args.evidence else [],
        duration_days=args.duration or 14,
        target_metric=args.metric or "",
        target_improvement=args.improvement or 0,
        kill_threshold=args.kill or 0.05,
        expansion_threshold=args.expand or 0.20,
    )
    db.upsert_experiment(exp)
    print(f"Created experiment: {exp.experiment_id}")
    print(json.dumps(exp.to_dict(), indent=2))
    db.close()


def cmd_list_experiments(args):
    db = Database(args.db)
    if args.frontier_id:
        experiments = db.get_experiments_by_frontier(args.frontier_id)
    else:
        experiments = db.get_all_experiments()
    if not experiments:
        print("No experiments in database.")
        db.close()
        return
    for exp in experiments:
        print(f"  {exp.experiment_id[:12]} | {exp.status:10s} | ${exp.capital_committed:>8,.0f} | {exp.hypothesis[:55]}")
    db.close()


def cmd_create_option(args):
    db = Database(args.db)
    predicates = []
    if args.predicate_file:
        import json as _json
        loaded = _json.loads(open(args.predicate_file).read())
        predicates = loaded if isinstance(loaded, list) else [loaded]

    opt = ConditionalInnovationOption(
        frontier_id=args.frontier_id,
        experiment_id=args.experiment_id or "",
        reactivation_predicates=predicates,
        p_technical=args.p_tech or 0.5,
        p_regulatory=args.p_reg or 0.7,
        benefit=args.benefit or 0,
        cost=args.cost or 0,
        dependencies=args.dependencies.split(";") if args.dependencies else [],
        time_horizon_days=args.horizon or 365,
    )
    opt.price()
    db.upsert_option(opt)
    print(f"Created option: {opt.option_id}")
    print(f"  Option value: ${opt.option_value:,.2f}")
    print(json.dumps(opt.to_dict(), indent=2))
    db.close()


def cmd_list_options(args):
    db = Database(args.db)
    if args.dormant_only:
        options = db.get_dormant_options()
    else:
        options = db.get_all_options()
    if not options:
        print("No options in database.")
        db.close()
        return
    for opt in options:
        print(f"  {opt.option_id[:12]} | {opt.status:12s} | value: ${opt.option_value:>10,.2f} | frontier: {opt.frontier_id[:12]}")
    db.close()


def cmd_reprice(args):
    db = Database(args.db)
    options = db.get_all_options()
    if not options:
        print("No options to reprice.")
        db.close()
        return
    for opt in options:
        old = opt.option_value
        opt.price()
        db.upsert_option(opt)
        print(f"  {opt.option_id[:12]} | ${old:>10,.2f} → ${opt.option_value:>10,.2f}")
    db.close()


def cmd_check_reactivation(args):
    db = Database(args.db)
    import json as _json
    metrics = _json.loads(args.metrics) if args.metrics else {}
    events = args.events.split(";") if args.events else []

    options = db.get_dormant_options()
    if not options:
        print("No dormant options to check.")
        db.close()
        return

    for opt in options:
        for pred_group in opt.reactivation_predicates:
            if evaluate_predicate_group(pred_group, metrics, events):
                print(f"  REACTIVATION TRIGGERED: {opt.option_id}")
                print(f"    Frontier: {opt.frontier_id}")
                print(f"    Option value: ${opt.option_value:,.2f}")
                opt.status = "reactivated"
                db.upsert_option(opt)
                break
    db.close()


# ─── LAIDER Commands ───

def cmd_add_hcp(args):
    db = Database(args.db)
    hcp = HCPOpportunityObject(
        name=args.name, specialty=args.specialty or "", institution=args.institution or "",
        territory=args.territory or "", npi=args.npi or "",
        journey_state=HCPJourneyState(args.journey or "unknown"),
        preferred_channel=HCPChannel(args.channel or "in_person"),
        assigned_rep=args.rep or "", assigned_msl=args.msl or "",
        kol_status=args.kol or False, educator_status=args.educator or False,
        patient_panel_size=args.panel or 0,
        therapeutic_areas=args.areas.split(";") if args.areas else [],
    )
    if args.barriers:
        hcp.barriers = args.barriers.split(";")
    if args.needs:
        hcp.needs = args.needs.split(";")
    db.upsert_hcp(hcp)
    print(f"Created HCP: {hcp.name} ({hcp.hcp_id})")
    print(f"  Journey: {hcp.journey_state.value}")
    db.close()


def cmd_list_hcps(args):
    db = Database(args.db)
    if args.state:
        hcps = db.get_hcps_by_state(HCPJourneyState(args.state))
    else:
        hcps = db.get_all_hcps()
    if not hcps:
        print("No HCPs in database.")
        db.close()
        return
    for h in hcps:
        print(f"  {h.hcp_id[:12]} | {h.journey_state.value:30s} | {h.name:25s} | {h.specialty:20s} | {h.territory}")
    db.close()


def cmd_show_hcp(args):
    db = Database(args.db)
    hcp = db.get_hcp(args.hcp_id)
    if not hcp:
        print(f"HCP {args.hcp_id} not found")
        sys.exit(1)
    print(json.dumps(hcp.to_dict(), indent=2))
    db.close()


def cmd_hcp_transition(args):
    db = Database(args.db)
    hcp = db.get_hcp(args.hcp_id)
    if not hcp:
        print(f"HCP {args.hcp_id} not found")
        sys.exit(1)
    target = HCPJourneyState(args.target)
    valid = HCP_TRANSITIONS.get(hcp.journey_state, [])
    if target not in valid:
        print(f"Invalid transition: {hcp.journey_state.value} → {target.value}")
        print(f"Valid: {[s.value for s in valid]}")
        sys.exit(1)
    hcp.journey_state = target
    from datetime import datetime, timezone
    hcp.last_updated = datetime.now(timezone.utc)
    db.upsert_hcp(hcp)
    print(f"Transitioned to: {hcp.journey_state.value}")
    db.close()


def cmd_record_interaction(args):
    db = Database(args.db)
    from datetime import datetime, timezone
    interaction = HCPInteraction(
        hcp_id=args.hcp_id, employee_id=args.employee_id,
        channel=HCPChannel(args.channel or "in_person"),
        timestamp=datetime.now(timezone.utc).isoformat(),
        topic=args.topic or "", question_raised=args.question or "",
        objection_raised=args.objection or "",
        evidence_delivered=args.evidence or "",
        approved_asset_used=args.asset or "",
        outcome=args.outcome or "", next_action=args.next_action or "",
    )
    db.save_interaction(interaction)
    print(f"Recorded interaction: {interaction.interaction_id}")
    db.close()


def cmd_evidence_path(args):
    fkg = seed_biktarvy_descovy()
    path = fkg.find_evidence_path(args.question, channel=args.channel or "", role=args.role or "")
    print(json.dumps(path.to_dict(), indent=2))


def cmd_franchise_summary(args):
    fkg = seed_biktarvy_descovy()
    print(json.dumps(fkg.summary(), indent=2))


def cmd_create_opportunity(args):
    db = Database(args.db)
    opp = EngagementOpportunity(
        originating_employee=args.employee,
        frontier_id=args.frontier_id or "",
        barrier=args.barrier, intervention=args.intervention,
        approved_assets=args.assets.split(";") if args.assets else [],
        sequence=args.sequence or "",
        initial_cohort_size=args.cohort or 0,
        initial_success_rate=args.success_rate or 0.0,
        addressable_hcps=args.addressable or 0,
        addressable_accounts=args.accounts or 0,
        estimated_value=args.value or 0.0,
        proposed_experiment=args.experiment or "",
    )
    db.upsert_opportunity(opp)
    print(f"Created opportunity: {opp.opportunity_id}")
    print(json.dumps(opp.to_dict(), indent=2))
    db.close()


def cmd_list_opportunities(args):
    db = Database(args.db)
    opps = db.get_all_opportunities()
    if not opps:
        print("No opportunities in database.")
        db.close()
        return
    for o in opps:
        print(f"  {o.opportunity_id[:12]} | {o.experiment_status:12s} | {o.barrier[:40]} | ${o.estimated_value:>8,.0f} | {o.originating_employee}")
    db.close()


def cmd_career(args):
    db = Database(args.db)
    ancestry = InnovationAncestry()
    cg = ConversionGraph()
    fkg = seed_biktarvy_descovy()

    # Load ancestry from DB
    for node in db.load_ancestry_nodes():
        ancestry.graph.add_node(node["node_id"], node_type=node["node_type"],
                                label=node["label"], value=node["value"], **node["metadata"])
    for edge in db.load_ancestry_edges():
        ancestry.graph.add_edge(edge["source"], edge["target"],
                                edge_type=edge["edge_type"], weight=edge["weight"], alpha=edge["alpha"])

    # Load HCPs into conversion graph
    for hcp in db.get_all_hcps():
        cg.add_hcp(hcp)
        if hcp.assigned_rep:
            cg.add_employee(hcp.assigned_rep, role="rep")
            cg.link_rep_hcp(hcp.assigned_rep, hcp.hcp_id)
        if hcp.assigned_msl:
            cg.add_employee(hcp.assigned_msl, role="msl")
            cg.link_msl_hcp(hcp.assigned_msl, hcp.hcp_id)

    agent = CareerAgent(ancestry, cg, fkg)
    state = agent.assess(args.employee_id, name=args.name or "", role=args.role or "", territory=args.territory or "")
    recommendations = agent.recommend(state)

    d = state.to_dict()
    db.upsert_career(args.employee_id, state.name, state.role, state.territory, "", d)
    print(json.dumps(d, indent=2))
    db.close()


def cmd_monster_metric(args):
    db = Database(args.db)
    ancestry = InnovationAncestry()
    for node in db.load_ancestry_nodes():
        ancestry.graph.add_node(node["node_id"], node_type=node["node_type"],
                                label=node["label"], value=node["value"], **node["metadata"])
    for edge in db.load_ancestry_edges():
        ancestry.graph.add_edge(edge["source"], edge["target"],
                                edge_type=edge["edge_type"], weight=edge["weight"], alpha=edge["alpha"])

    result = ancestry.compute_monster_metric(args.employee_id)
    print(json.dumps(result, indent=2))
    db.close()


def cmd_ancestry(args):
    db = Database(args.db)
    ancestry = InnovationAncestry()
    for node in db.load_ancestry_nodes():
        ancestry.graph.add_node(node["node_id"], node_type=node["node_type"],
                                label=node["label"], value=node["value"], **node["metadata"])
    for edge in db.load_ancestry_edges():
        ancestry.graph.add_edge(edge["source"], edge["target"],
                                edge_type=edge["edge_type"], weight=edge["weight"], alpha=edge["alpha"])
    print(json.dumps(ancestry.summary(), indent=2))
    db.close()


def cmd_flywheel(args):
    db = Database(args.db)
    ancestry = InnovationAncestry()
    cg = ConversionGraph()
    fkg = seed_biktarvy_descovy()

    for node in db.load_ancestry_nodes():
        ancestry.graph.add_node(node["node_id"], node_type=node["node_type"],
                                label=node["label"], value=node["value"], **node["metadata"])
    for edge in db.load_ancestry_edges():
        ancestry.graph.add_edge(edge["source"], edge["target"],
                                edge_type=edge["edge_type"], weight=edge["weight"], alpha=edge["alpha"])

    fw = Flywheel(ancestry, cg, fkg)
    for opp in db.get_all_opportunities():
        fw.register_opportunity(opp)

    state = fw.state()
    print(json.dumps(state.to_dict(), indent=2))
    db.close()


def cmd_add_ancestry_node(args):
    db = Database(args.db)
    db.save_ancestry_node(args.node_id, args.node_type, args.label or "", args.value or 0.0, {})
    print(f"Saved ancestry node: {args.node_id}")
    db.close()


def cmd_add_ancestry_edge(args):
    db = Database(args.db)
    db.save_ancestry_edge(args.source, args.target, args.edge_type, args.weight or 1.0, args.alpha or 1.0)
    print(f"Saved ancestry edge: {args.source} → {args.target} ({args.edge_type})")
    db.close()


# ─── Task Completion Commands ───

def cmd_define_task(args):
    db = Database(args.db)
    hcp = db.get_hcp(args.hcp_id)
    if not hcp:
        print(f"HCP {args.hcp_id} not found")
        sys.exit(1)
    fkg = seed_biktarvy_descovy()
    engine = TaskCompletionEngine(fkg)
    task = engine.define_task(
        hcp=hcp, employee_id=args.employee_id,
        task_type=TaskType(args.task_type),
        barrier=args.barrier or "", question=args.question or "",
        objection=args.objection or "",
        channel=args.channel or "email", role=args.role or "rep",
    )
    db.upsert_email_task(task)
    print(f"Defined task: {task.task_id}")
    print(f"  Objective: {task.objective}")
    print(f"  Completion criteria: {task.completion_criteria}")
    print(f"  Verification: {task.verification_method}")
    if task.evidence_path:
        print(f"  Evidence path: {task.evidence_path.get('clinical_topic', 'N/A')}")
        print(f"  Approved assets: {task.approved_assets}")
    db.close()


def cmd_list_tasks(args):
    db = Database(args.db)
    if args.employee_id:
        tasks = db.get_email_tasks_for_employee(args.employee_id)
    elif args.hcp_id:
        tasks = db.get_email_tasks_for_hcp(args.hcp_id)
    else:
        tasks = db.get_all_email_tasks()
    if not tasks:
        print("No email tasks in database.")
        db.close()
        return
    for t in tasks:
        print(f"  {t.task_id[:12]} | {t.status.value:12s} | {t.task_type.value:25s} | {t.objective[:50]}")
    db.close()


def cmd_show_task(args):
    db = Database(args.db)
    task = db.get_email_task(args.task_id)
    if not task:
        print(f"Task {args.task_id} not found")
        sys.exit(1)
    print(json.dumps(task.to_dict(), indent=2))
    db.close()


def cmd_record_delivery(args):
    db = Database(args.db)
    task = db.get_email_task(args.task_id)
    if not task:
        print(f"Task {args.task_id} not found")
        sys.exit(1)
    fkg = seed_biktarvy_descovy()
    engine = TaskCompletionEngine(fkg)
    engine.tasks[task.task_id] = task
    engine.record_delivery(task.task_id, opened=args.opened, clicked=args.clicked)
    db.upsert_email_task(engine.tasks[task.task_id])
    print(f"Recorded delivery: sent={1}, opened={args.opened}, clicked={args.clicked}")
    print(f"  Status: {engine.tasks[task.task_id].status.value}")
    db.close()


def cmd_complete_task(args):
    db = Database(args.db)
    task = db.get_email_task(args.task_id)
    if not task:
        print(f"Task {args.task_id} not found")
        sys.exit(1)
    fkg = seed_biktarvy_descovy()
    engine = TaskCompletionEngine(fkg)
    engine.tasks[task.task_id] = task
    engine.mark_completed(task.task_id, barrier_resolved=args.barrier_resolved,
                          question_answered=args.question_answered)
    db.upsert_email_task(engine.tasks[task.task_id])
    print(f"Task completed: {task.task_id}")
    print(f"  Barrier resolved: {args.barrier_resolved}")
    print(f"  Question answered: {args.question_answered}")
    db.close()


def cmd_verify_task(args):
    db = Database(args.db)
    task = db.get_email_task(args.task_id)
    if not task:
        print(f"Task {args.task_id} not found")
        sys.exit(1)
    hcp = db.get_hcp(task.hcp_id)
    if not hcp:
        print(f"HCP {task.hcp_id} not found")
        sys.exit(1)
    fkg = seed_biktarvy_descovy()
    engine = TaskCompletionEngine(fkg)
    engine.tasks[task.task_id] = task
    verified = engine.verify_completion(task.task_id, hcp)
    db.upsert_email_task(engine.tasks[task.task_id])
    if verified:
        print(f"Task VERIFIED: {task.task_id}")
        print(f"  HCP journey advanced to: {hcp.journey_state.value}")
    else:
        print(f"Task NOT verified: {task.task_id}")
        print(f"  HCP journey: {hcp.journey_state.value} (expected: {task.to_journey_state})")
    db.close()


def cmd_supremacy_report(args):
    db = Database(args.db)
    fkg = seed_biktarvy_descovy()
    engine = TaskCompletionEngine(fkg)
    for task in db.get_all_email_tasks():
        engine.tasks[task.task_id] = task
    report = engine.supremacy_report(employee_id=args.employee_id)
    print(json.dumps(report, indent=2))
    db.close()


def cmd_serve(args):
    import uvicorn
    from rxreserve.server import create_app
    app = create_app(args.db)
    uvicorn.run(app, host=args.host, port=args.port)


# ─── MailOS Commands ───

def cmd_mailos_ingest(args):
    db = Database(args.db)
    mail = MailObject(
        from_address=args.from_address, from_name=args.from_name or "",
        from_type=args.from_type or "rep",
        to_addresses=args.to.split(",") if args.to else [],
        subject=args.subject or "", body=args.body or "",
        timestamp=args.timestamp or "", mailbox=args.mailbox or "inbox",
        matched_hcp_id=args.hcp_id or "", matched_employee_id=args.employee_id or "",
    )
    db.upsert_mail(mail)
    os = RxMailOS()
    result = os.ingest(mail)
    for obj in os.mails.values():
        db.upsert_mail(obj)
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
    print(json.dumps(result, indent=2, default=str))


def cmd_mailos_obligations(args):
    db = Database(args.db)
    obls = db.get_all_obligations()
    if args.status:
        obls = [o for o in obls if o.status.value == args.status]
    if args.system:
        obls = [o for o in obls if o.target_system.value == args.system]
    for o in obls:
        print(f"[{o.status.value:12s}] {o.obligation_id[:8]}  {o.obligation_type:20s}  {o.description[:60]}")
        if o.hcp_id:
            print(f"              HCP: {o.hcp_id[:12]}  Deadline: {o.deadline[:19] if o.deadline else 'N/A'}")
    print(f"\nTotal: {len(obls)}")


def cmd_mailos_assign(args):
    db = Database(args.db)
    obl = db.get_obligation(args.obligation_id)
    if not obl:
        print(f"Obligation {args.obligation_id} not found")
        return
    obl.assigned_owner = args.owner
    obl.assigned_team = args.team or ""
    obl.status = ObligationStatus.ASSIGNED
    obl.status_history.append({"status": "assigned", "timestamp": datetime.now(timezone.utc).isoformat(), "actor": args.owner})
    db.upsert_obligation(obl)
    print(f"Assigned {args.obligation_id} to {args.owner}")


def cmd_mailos_execute(args):
    db = Database(args.db)
    obl = db.get_obligation(args.obligation_id)
    if not obl:
        print(f"Obligation {args.obligation_id} not found")
        return
    obl.evidence_artifact = args.evidence
    obl.status = ObligationStatus.EXECUTED
    obl.status_history.append({"status": "executed", "timestamp": datetime.now(timezone.utc).isoformat(), "actor": obl.assigned_owner})
    db.upsert_obligation(obl)
    print(f"Executed {args.obligation_id} with evidence: {args.evidence}")


def cmd_mailos_verify(args):
    db = Database(args.db)
    obl = db.get_obligation(args.obligation_id)
    if not obl:
        print(f"Obligation {args.obligation_id} not found")
        return
    from rxreserve.mailos import VerificationReceipt
    from datetime import timezone
    receipt = VerificationReceipt(
        obligation_id=obl.obligation_id,
        verification_method=obl.verification_method,
        evidence_artifact=obl.evidence_artifact,
        verified_by=args.verifier,
        verified_at=datetime.now(timezone.utc).isoformat(),
        independent_signal=args.signal or "",
        independent_signal_source=args.signal_source or "",
        is_verified=bool(obl.evidence_artifact),
    )
    obl.status = ObligationStatus.VERIFIED
    obl.verified_by = args.verifier
    obl.verified_at = receipt.verified_at
    obl.closed_at = datetime.now(timezone.utc).isoformat()
    obl.status_history.append({"status": "verified", "timestamp": receipt.verified_at, "actor": args.verifier})
    db.upsert_obligation(obl)
    db.upsert_receipt(receipt)
    print(f"Verified {args.obligation_id} by {args.verifier}")


def cmd_mailos_debt(args):
    db = Database(args.db)
    from rxreserve.mailos_engine import ResponseDebtLedger
    obls = db.get_all_obligations()
    debt = ResponseDebtLedger.compute(obls)
    print(f"Total obligations:    {debt.total_obligations}")
    print(f"Unresolved:           {debt.unresolved}")
    print(f"Overdue:              {debt.overdue}")
    print(f"Escalated:            {debt.escalated}")
    print(f"Verified:             {debt.verified}")
    print(f"Priority score:       {debt.total_priority_score:.1f}")
    if debt.by_type:
        print("\nBy type:")
        for t, c in sorted(debt.by_type.items(), key=lambda x: x[1], reverse=True):
            print(f"  {t:25s} {c}")
    if debt.by_system:
        print("\nBy system:")
        for s, c in sorted(debt.by_system.items(), key=lambda x: x[1], reverse=True):
            print(f"  {s:25s} {c}")
    if debt.top_debts:
        print("\nTop debts:")
        for d in debt.top_debts[:5]:
            print(f"  [{d['priority_score']:6.1f}] {d['type']:20s} {d['description'][:50]}")


def cmd_mailos_diagnose(args):
    db = Database(args.db)
    from rxreserve.mailos_engine import EngagementDiagnostic
    mails = db.get_all_mails()
    obls = db.get_all_obligations()
    intents = db.get_all_intents()
    diag = EngagementDiagnostic.diagnose(args.hcp_id, mails, obls, intents)
    print(f"HCP: {diag.hcp_id}")
    print(f"Diagnosis: {diag.diagnosis}")
    print(f"Days since reply: {diag.days_since_reply}")
    print(f"Consecutive promo sends: {diag.consecutive_promotional_sends}")
    print(f"Unresolved questions: {diag.unresolved_questions}")
    print(f"Novel evidence delivered: {diag.novel_evidence_delivered}")
    if diag.friction_factors:
        print("Friction factors:")
        for f in diag.friction_factors:
            print(f"  - {f}")
    print(f"Recommended intervention: {diag.recommended_intervention}")
    if diag.recommended_negative_actions:
        print("Negative actions:")
        for na in diag.recommended_negative_actions:
            print(f"  - {na}")


def cmd_mailos_summary(args):
    db = Database(args.db)
    mails = db.get_all_mails()
    obls = db.get_all_obligations()
    intents = db.get_all_intents()
    receipts = db.get_all_receipts()
    print(f"Mails ingested:       {len(mails)}")
    print(f"Obligations compiled: {len(obls)}")
    print(f"Intents extracted:    {len(intents)}")
    print(f"Verifications:        {len(receipts)}")
    pending = [o for o in obls if o.status not in (ObligationStatus.VERIFIED, ObligationStatus.CLOSED)]
    overdue = [o for o in obls if o.status == ObligationStatus.OVERDUE]
    print(f"Pending:              {len(pending)}")
    print(f"Overdue:              {len(overdue)}")


# ─── Design Genome Runtime commands ───

def cmd_genome_state(args):
    from rxreserve.genome_runtime import DesignGenomeRuntime
    rt = DesignGenomeRuntime(db_path=args.db)
    state = rt.get_state()
    print(f"Corpus version:           {state.current_corpus_version}")
    print(f"Observations:             {state.observation_count}")
    print(f"Latent values (genes):    {state.latent_value_count}")
    print(f"Attempts:                 {state.attempt_count}")
    print(f"Verified capabilities:    {state.verified_capability_count}")
    print(f"Average quality:          {state.average_quality:.2f}")
    print(f"Quality trend:            {state.quality_trend:.2f}")
    print(f"Active projects:          {state.active_project_count}")
    print(f"Acquisition cycles:       {state.total_acquisition_cycles}")
    print(f"Experiments:              {state.total_experiments}")
    print(f"Accepted mutations:       {state.total_accepted_mutations}")
    print(f"Rejected mutations:       {state.total_rejected_mutations}")
    if state.oversaturated_patterns:
        print(f"Oversaturated patterns:   {', '.join(state.oversaturated_patterns)}")


def cmd_genome_acquire(args):
    import asyncio
    from rxreserve.genome_runtime import DesignGenomeRuntime
    db = Database(args.db)
    rt = DesignGenomeRuntime(db_path=args.db)
    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(rt.run_acquisition_cycle(max_sources=args.max_sources))
    finally:
        loop.close()
    for source in rt.observation_memory._sources.values():
        db.upsert_genome_source(source)
    for obs in rt.observation_memory.all_observations():
        db.upsert_genome_observation(obs)
    for gene in rt.latent_value_memory.all_genes():
        db.upsert_genome_gene(gene)
    db.upsert_genome_state(rt.get_state())
    print(f"Acquisition cycle complete:")
    print(f"  Sources discovered:  {result.get('sources_discovered', 0)}")
    print(f"  Observations:        {result.get('observations_captured', 0)}")
    print(f"  Genes extracted:     {result.get('genes_extracted', 0)}")
    print(f"  Novel genes:         {result.get('novel_genes', 0)}")


def cmd_genome_contract(args):
    from rxreserve.genome_runtime import DesignGenomeRuntime
    db = Database(args.db)
    rt = DesignGenomeRuntime(db_path=args.db)
    emotions = args.emotions.split(";") if args.emotions else []
    contract = rt.create_distinction_contract(
        project_name=args.project_name, brief=args.brief or "",
        emotions=emotions, spatial_signature=args.spatial or "",
        interaction_primitive=args.interaction or "",
        forbidden_cliche=args.forbidden or "",
        typography_doctrine=args.typography or "",
        motion_doctrine=args.motion or "",
        density_rule=args.density or "",
        unique_feature=args.unique or "",
    )
    db.upsert_genome_contract(contract)
    print(f"Distinction contract created: {contract.contract_id}")
    print(f"  Project: {contract.project_name}")
    print(f"  Unique feature: {contract.unique_feature}")


def cmd_genome_project(args):
    from rxreserve.genome_runtime import DesignGenomeRuntime
    db = Database(args.db)
    rt = DesignGenomeRuntime(db_path=args.db)
    contract = rt._contracts.get(args.contract_id)
    if not contract:
        print(f"Contract {args.contract_id} not found")
        sys.exit(1)
    project = rt.create_project(
        project_name=args.project_name,
        product_category=args.category or "",
        audience=args.audience or "",
        mood=args.mood or "",
        interaction_purpose=args.purpose or "",
        contract=contract,
    )
    db.upsert_genome_project(project)
    print(f"Project created: {project.archetype_id}")
    print(f"  Name: {project.project_name}")
    print(f"  Active genes: {len(project.active_gene_ids)}")


def cmd_genome_experiment(args):
    import asyncio
    from rxreserve.genome_runtime import DesignGenomeRuntime
    db = Database(args.db)
    rt = DesignGenomeRuntime(db_path=args.db)
    project = rt._projects.get(args.archetype_id)
    if not project:
        print(f"Project {args.archetype_id} not found")
        sys.exit(1)
    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(rt.run_experiment(
            project, args.benchmark or None, args.generations))
    finally:
        loop.close()
    for impl in rt.attempt_memory.all_implementations():
        db.upsert_genome_implementation(impl)
    for render in rt.attempt_memory.all_renders():
        db.upsert_genome_render(render)
    for cap in rt.verified_capability_memory._capabilities.values():
        db.upsert_genome_capability(cap)
    db.upsert_genome_project(project)
    db.upsert_genome_state(rt.get_state())
    print(f"Experiment complete:")
    print(f"  Generations:          {result.get('generations_run', 0)}")
    print(f"  Implementations:      {result.get('total_implementations', 0)}")
    print(f"  Accepted mutations:   {result.get('accepted_mutations', 0)}")
    print(f"  Rejected mutations:   {result.get('rejected_mutations', 0)}")
    print(f"  Best quality:         {result.get('best_quality', 0):.2f}")
    print(f"  Capabilities found:   {result.get('capabilities_found', 0)}")


def cmd_genome_release(args):
    from rxreserve.genome_runtime import DesignGenomeRuntime
    db = Database(args.db)
    rt = DesignGenomeRuntime(db_path=args.db)
    manifest = rt.release_corpus(args.version or None)
    db.upsert_genome_manifest(manifest)
    db.upsert_genome_state(rt.get_state())
    print(f"Corpus released: {manifest.corpus_version}")
    print(f"  Total observations:       {manifest.total_observations}")
    print(f"  Total genes:              {manifest.total_genes}")
    print(f"  Total capabilities:       {manifest.total_capabilities}")
    print(f"  Verified capabilities:    {manifest.total_verified_capabilities}")
    if manifest.retired_patterns:
        print(f"  Retired patterns:         {', '.join(manifest.retired_patterns)}")


def cmd_genome_observations(args):
    db = Database(args.db)
    observations = db.get_all_genome_observations()
    print(f"Total observations: {len(observations)}")
    for obs in observations[:20]:
        print(f"  [{obs.get('observation_id', '')[:8]}] {obs.get('url', '')} "
              f"quality={obs.get('quality_score', 0):.2f}")


def cmd_genome_genes(args):
    db = Database(args.db)
    genes = db.get_all_genome_genes(active_only=args.active_only)
    print(f"Total genes: {len(genes)}")
    for g in genes[:20]:
        status = "RETIRED" if g.get("retired") else "active"
        print(f"  [{g.get('gene_id', '')[:8]}] {g.get('gene_type', '')} "
              f"confidence={g.get('confidence', 0):.2f} ({status})")


def cmd_genome_capabilities(args):
    db = Database(args.db)
    caps = db.get_all_genome_capabilities(verified_only=args.verified_only)
    print(f"Total capabilities: {len(caps)}")
    for c in caps[:20]:
        print(f"  [{c.get('capability_id', '')[:8]}] {c.get('name', '')} "
              f"status={c.get('status', '')} confidence={c.get('confidence', 0):.2f}")


def cmd_genome_projects(args):
    db = Database(args.db)
    projects = db.get_all_genome_projects()
    print(f"Total projects: {len(projects)}")
    for p in projects:
        print(f"  [{p.get('archetype_id', '')[:8]}] {p.get('project_name', '')} "
              f"best_quality={p.get('best_quality_score', 0):.2f}")


def cmd_genome_summary(args):
    from rxreserve.genome_runtime import DesignGenomeRuntime
    rt = DesignGenomeRuntime(db_path=args.db)
    s = rt.summary()
    print(json.dumps(s, indent=2))


def cmd_genome_failures(args):
    db = Database(args.db)
    failures = db.get_all_genome_failures()
    for f in failures:
        print(f"[{f['failure_mode']}] {f['failure_id'][:12]}  q={f['quality_score']:.3f}  {f['failure_description'][:80]}")


def cmd_genome_transfer_tests(args):
    db = Database(args.db)
    tests = db.get_all_genome_transfer_tests()
    for t in tests:
        status = "PASSED" if t["passed"] else "FAILED"
        print(f"[{status}] {t['test_id'][:12]}  cap={t['capability_id'][:12]}  q={t['quality_in_new_context']:.3f}  target={t['target_product_category']}")


def cmd_genome_skill_weights(args):
    from rxreserve.genome_runtime import DesignGenomeRuntime
    rt = DesignGenomeRuntime(db_path=args.db)
    caps = rt.verified_capability_memory.get_by_weight(limit=20)
    for c in caps:
        print(f"w={c.skill_weight:.4f}  {c.capability_id[:12]}  {c.name[:40]}  status={c.status.value}  retrieved={c.times_retrieved}")


def cmd_genome_curator(args):
    from rxreserve.genome_runtime import DesignGenomeRuntime
    rt = DesignGenomeRuntime(db_path=args.db)
    print(json.dumps(rt.curator.summary(), indent=2))


def main():
    import argparse
    parser = argparse.ArgumentParser(prog="rxreserve", description="RxReserve — Pharmaceutical Frontier Reserve")
    parser.add_argument("--db", default="rxreserve.db", help="Database path")
    sub = parser.add_subparsers(dest="command", required=True)

    # create
    p = sub.add_parser("create", help="Create a new PharmaFrontier")
    p.add_argument("--problem", required=True)
    p.add_argument("--unknowns", help="Semicolon-separated")
    p.add_argument("--economic")
    p.add_argument("--quality")
    p.add_argument("--workaround")
    p.add_argument("--regulatory")
    p.add_argument("--cost", type=float)
    p.add_argument("--upside", type=float)
    p.add_argument("--originators", help="Semicolon-separated")
    p.add_argument("--signal")
    p.add_argument("--source-system")
    p.add_argument("--observation")
    p.add_argument("--confidence", type=float)
    p.add_argument("--verified", action="store_true")
    p.add_argument("--human-contrib")
    p.add_argument("--ai-candidates", help="Semicolon-separated")
    p.add_argument("--human-selection")
    p.add_argument("--human-mods")
    p.add_argument("--rights-owner", choices=["employee", "employer", "joint", "assigned", "unresolved"])
    p.add_argument("--jurisdiction")
    p.add_argument("--agreement")
    p.add_argument("--no-patent-review", action="store_true")
    p.set_defaults(func=cmd_create)

    # list
    sub.add_parser("list", help="List all frontiers").set_defaults(func=cmd_list)

    # show
    p = sub.add_parser("show", help="Show frontier details")
    p.add_argument("frontier_id")
    p.set_defaults(func=cmd_show)

    # transition
    p = sub.add_parser("transition", help="Transition frontier state")
    p.add_argument("frontier_id")
    p.add_argument("target", choices=[s.value for s in FrontierState])
    p.add_argument("--actor")
    p.add_argument("--notes")
    p.set_defaults(func=cmd_transition)

    # history
    p = sub.add_parser("history", help="Show state history")
    p.add_argument("frontier_id")
    p.set_defaults(func=cmd_history)

    # gapswat
    p = sub.add_parser("gapswat", help="Run GapSWAT underwriting")
    p.add_argument("frontier_id")
    p.add_argument("--impact", type=float)
    p.add_argument("--frequency", type=float)
    p.add_argument("--unmetness", type=float)
    p.add_argument("--prop-data", type=float)
    p.add_argument("--expertise", type=float)
    p.add_argument("--infrastructure", type=float)
    p.add_argument("--reg-position", type=float)
    p.add_argument("--distribution", type=float)
    p.add_argument("--emp-observed")
    p.add_argument("--emp-originated")
    p.add_argument("--ai-gen")
    p.add_argument("--existed")
    p.add_argument("--anyway")
    p.add_argument("--transform", choices=[t.value for t in TransformType])
    p.add_argument("--magnification", type=float)
    p.add_argument("--transform-desc")
    p.set_defaults(func=cmd_gapswat)

    # wargame
    p = sub.add_parser("wargame", help="Run adversarial war-game")
    p.add_argument("frontier_id")
    p.set_defaults(func=cmd_wargame)

    # price
    p = sub.add_parser("price", help="Deterministic scenario pricing")
    p.add_argument("frontier_id")
    p.add_argument("--rollout-cost", type=float)
    p.add_argument("--prob-invalidate", type=float)
    p.set_defaults(func=cmd_price)

    # value-experiment
    p = sub.add_parser("value-experiment", help="Value an experiment with EVSI")
    p.add_argument("--cost", type=float, required=True)
    p.add_argument("--upside", type=float, required=True)
    p.add_argument("--prob", type=float, required=True)
    p.add_argument("--rollout", type=float)
    p.add_argument("--prob-invalidate", type=float)
    p.set_defaults(func=cmd_value_experiment)

    # add-experiment
    p = sub.add_parser("add-experiment", help="Add experiment contract")
    p.add_argument("--frontier-id", required=True)
    p.add_argument("--hypothesis", required=True)
    p.add_argument("--capital", type=float)
    p.add_argument("--owners", help="Semicolon-separated")
    p.add_argument("--measurement")
    p.add_argument("--stop", help="Semicolon-separated")
    p.add_argument("--evidence", help="Semicolon-separated")
    p.add_argument("--duration", type=int)
    p.add_argument("--metric")
    p.add_argument("--improvement", type=float)
    p.add_argument("--kill", type=float)
    p.add_argument("--expand", type=float)
    p.set_defaults(func=cmd_add_experiment)

    # list-experiments
    p = sub.add_parser("list-experiments", help="List experiments")
    p.add_argument("--frontier-id")
    p.set_defaults(func=cmd_list_experiments)

    # create-option
    p = sub.add_parser("create-option", help="Create conditional innovation option")
    p.add_argument("--frontier-id", required=True)
    p.add_argument("--experiment-id")
    p.add_argument("--predicate-file", help="JSON file with reactivation predicates")
    p.add_argument("--p-tech", type=float)
    p.add_argument("--p-reg", type=float)
    p.add_argument("--benefit", type=float)
    p.add_argument("--cost", type=float)
    p.add_argument("--dependencies", help="Semicolon-separated")
    p.add_argument("--horizon", type=int)
    p.set_defaults(func=cmd_create_option)

    # list-options
    p = sub.add_parser("list-options", help="List innovation options")
    p.add_argument("--dormant-only", action="store_true")
    p.set_defaults(func=cmd_list_options)

    # reprice
    sub.add_parser("reprice", help="Reprice all options").set_defaults(func=cmd_reprice)

    # check-reactivation
    p = sub.add_parser("check-reactivation", help="Check if dormant options should reactivate")
    p.add_argument("--metrics", help="JSON dict of current metrics")
    p.add_argument("--events", help="Semicolon-separated events")
    p.set_defaults(func=cmd_check_reactivation)

    # serve
    p = sub.add_parser("serve", help="Start REST API server")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8001)
    p.set_defaults(func=cmd_serve)

    # ─── LAIDER commands ───

    # add-hcp
    p = sub.add_parser("add-hcp", help="Add an HCP to the conversion graph")
    p.add_argument("--name", required=True)
    p.add_argument("--specialty")
    p.add_argument("--institution")
    p.add_argument("--territory")
    p.add_argument("--npi")
    p.add_argument("--journey", default="unknown")
    p.add_argument("--channel", default="in_person")
    p.add_argument("--rep", help="Assigned rep employee_id")
    p.add_argument("--msl", help="Assigned MSL employee_id")
    p.add_argument("--kol", action="store_true")
    p.add_argument("--educator", action="store_true")
    p.add_argument("--panel", type=int, help="Patient panel size")
    p.add_argument("--areas", help="Therapeutic areas, semicolon-separated")
    p.add_argument("--barriers", help="Known barriers, semicolon-separated")
    p.add_argument("--needs", help="Known needs, semicolon-separated")
    p.set_defaults(func=cmd_add_hcp)

    # list-hcps
    p = sub.add_parser("list-hcps", help="List all HCPs")
    p.add_argument("--state", help="Filter by journey state")
    p.set_defaults(func=cmd_list_hcps)

    # show-hcp
    p = sub.add_parser("show-hcp", help="Show HCP details")
    p.add_argument("hcp_id")
    p.set_defaults(func=cmd_show_hcp)

    # hcp-transition
    p = sub.add_parser("hcp-transition", help="Transition HCP journey state")
    p.add_argument("hcp_id")
    p.add_argument("target")
    p.set_defaults(func=cmd_hcp_transition)

    # record-interaction
    p = sub.add_parser("record-interaction", help="Record an HCP interaction")
    p.add_argument("--hcp-id", required=True)
    p.add_argument("--employee-id", required=True)
    p.add_argument("--channel", default="in_person")
    p.add_argument("--topic")
    p.add_argument("--question")
    p.add_argument("--objection")
    p.add_argument("--evidence")
    p.add_argument("--asset")
    p.add_argument("--outcome")
    p.add_argument("--next-action")
    p.set_defaults(func=cmd_record_interaction)

    # evidence-path
    p = sub.add_parser("evidence-path", help="Find approved evidence path for a question")
    p.add_argument("question")
    p.add_argument("--channel")
    p.add_argument("--role")
    p.set_defaults(func=cmd_evidence_path)

    # franchise-summary
    sub.add_parser("franchise-summary", help="Show franchise knowledge graph summary").set_defaults(func=cmd_franchise_summary)

    # create-opportunity
    p = sub.add_parser("create-opportunity", help="Create an engagement opportunity")
    p.add_argument("--employee", required=True)
    p.add_argument("--frontier-id")
    p.add_argument("--barrier", required=True)
    p.add_argument("--intervention", required=True)
    p.add_argument("--assets", help="Approved assets, semicolon-separated")
    p.add_argument("--sequence")
    p.add_argument("--cohort", type=int)
    p.add_argument("--success-rate", type=float)
    p.add_argument("--addressable", type=int)
    p.add_argument("--accounts", type=int)
    p.add_argument("--value", type=float)
    p.add_argument("--experiment")
    p.set_defaults(func=cmd_create_opportunity)

    # list-opportunities
    sub.add_parser("list-opportunities", help="List engagement opportunities").set_defaults(func=cmd_list_opportunities)

    # career
    p = sub.add_parser("career", help="Assess employee career state")
    p.add_argument("employee_id")
    p.add_argument("--name")
    p.add_argument("--role")
    p.add_argument("--territory")
    p.set_defaults(func=cmd_career)

    # monster-metric
    p = sub.add_parser("monster-metric", help="Compute innovation ancestry monster metric")
    p.add_argument("employee_id")
    p.set_defaults(func=cmd_monster_metric)

    # ancestry
    sub.add_parser("ancestry", help="Show ancestry graph summary").set_defaults(func=cmd_ancestry)

    # flywheel
    sub.add_parser("flywheel", help="Show flywheel state").set_defaults(func=cmd_flywheel)

    # add-ancestry-node
    p = sub.add_parser("add-ancestry-node", help="Add a node to the ancestry graph")
    p.add_argument("--node-id", required=True)
    p.add_argument("--node-type", required=True, choices=["employee", "gap", "intervention", "experiment", "value", "derivative", "capability"])
    p.add_argument("--label")
    p.add_argument("--value", type=float)
    p.set_defaults(func=cmd_add_ancestry_node)

    # add-ancestry-edge
    p = sub.add_parser("add-ancestry-edge", help="Add an edge to the ancestry graph")
    p.add_argument("--source", required=True)
    p.add_argument("--target", required=True)
    p.add_argument("--edge-type", required=True)
    p.add_argument("--weight", type=float)
    p.add_argument("--alpha", type=float)
    p.set_defaults(func=cmd_add_ancestry_edge)

    # ─── Task Completion ───

    # define-task
    p = sub.add_parser("define-task", help="Define an email task from an HCP's barrier/question")
    p.add_argument("--hcp-id", required=True)
    p.add_argument("--employee-id", required=True)
    p.add_argument("--task-type", default="barrier_resolution",
                   choices=[t.value for t in TaskType])
    p.add_argument("--barrier")
    p.add_argument("--question")
    p.add_argument("--objection")
    p.add_argument("--channel", default="email")
    p.add_argument("--role", default="rep")
    p.set_defaults(func=cmd_define_task)

    # list-tasks
    p = sub.add_parser("list-tasks", help="List email tasks")
    p.add_argument("--employee-id")
    p.add_argument("--hcp-id")
    p.set_defaults(func=cmd_list_tasks)

    # show-task
    p = sub.add_parser("show-task", help="Show email task details")
    p.add_argument("task_id")
    p.set_defaults(func=cmd_show_task)

    # record-delivery
    p = sub.add_parser("record-delivery", help="Record email delivery (Level 0 metric)")
    p.add_argument("task_id")
    p.add_argument("--opened", action="store_true")
    p.add_argument("--clicked", action="store_true")
    p.set_defaults(func=cmd_record_delivery)

    # complete-task
    p = sub.add_parser("complete-task", help="Mark task as completed (Level 2 — SUPREMACY)")
    p.add_argument("task_id")
    p.add_argument("--barrier-resolved", action="store_true")
    p.add_argument("--question-answered", action="store_true")
    p.set_defaults(func=cmd_complete_task)

    # verify-task
    p = sub.add_parser("verify-task", help="Verify task completion via HCP journey advancement")
    p.add_argument("task_id")
    p.set_defaults(func=cmd_verify_task)

    # supremacy-report
    p = sub.add_parser("supremacy-report", help="Show task completion vs delivery supremacy report")
    p.add_argument("--employee-id")
    p.set_defaults(func=cmd_supremacy_report)

    # mailos ingest
    p = sub.add_parser("mailos-ingest", help="Ingest an email into RxMailOS")
    p.add_argument("--from-address", required=True)
    p.add_argument("--from-name", default="")
    p.add_argument("--from-type", default="rep", choices=["rep", "hcp", "msl", "employee"])
    p.add_argument("--to", help="Comma-separated recipients")
    p.add_argument("--subject", default="")
    p.add_argument("--body", default="")
    p.add_argument("--timestamp", default="")
    p.add_argument("--mailbox", default="inbox")
    p.add_argument("--hcp-id", default="")
    p.add_argument("--employee-id", default="")
    p.set_defaults(func=cmd_mailos_ingest)

    # mailos obligations
    p = sub.add_parser("mailos-obligations", help="List mailos obligations")
    p.add_argument("--status", default="")
    p.add_argument("--system", default="")
    p.set_defaults(func=cmd_mailos_obligations)

    # mailos assign
    p = sub.add_parser("mailos-assign", help="Assign an obligation")
    p.add_argument("obligation_id")
    p.add_argument("--owner", required=True)
    p.add_argument("--team", default="")
    p.set_defaults(func=cmd_mailos_assign)

    # mailos execute
    p = sub.add_parser("mailos-execute", help="Execute an obligation with evidence")
    p.add_argument("obligation_id")
    p.add_argument("--evidence", required=True)
    p.set_defaults(func=cmd_mailos_execute)

    # mailos verify
    p = sub.add_parser("mailos-verify", help="Verify an obligation")
    p.add_argument("obligation_id")
    p.add_argument("--verifier", required=True)
    p.add_argument("--signal", default="")
    p.add_argument("--signal-source", default="")
    p.set_defaults(func=cmd_mailos_verify)

    # mailos debt
    sub.add_parser("mailos-debt", help="Show response debt ledger").set_defaults(func=cmd_mailos_debt)

    # mailos diagnose
    p = sub.add_parser("mailos-diagnose", help="Diagnose HCP engagement")
    p.add_argument("hcp_id")
    p.set_defaults(func=cmd_mailos_diagnose)

    # mailos summary
    sub.add_parser("mailos-summary", help="Show mailos summary").set_defaults(func=cmd_mailos_summary)

    # ─── Design Genome Runtime ───

    # genome-state
    sub.add_parser("genome-state", help="Show Design Genome runtime state").set_defaults(func=cmd_genome_state)

    # genome-acquire
    p = sub.add_parser("genome-acquire", help="Run a Design Genome acquisition cycle")
    p.add_argument("--max-sources", type=int, default=10)
    p.set_defaults(func=cmd_genome_acquire)

    # genome-contract
    p = sub.add_parser("genome-contract", help="Create a Distinction Contract")
    p.add_argument("--project-name", required=True)
    p.add_argument("--brief")
    p.add_argument("--emotions", help="Semicolon-separated")
    p.add_argument("--spatial")
    p.add_argument("--interaction")
    p.add_argument("--forbidden")
    p.add_argument("--typography")
    p.add_argument("--motion")
    p.add_argument("--density")
    p.add_argument("--unique")
    p.set_defaults(func=cmd_genome_contract)

    # genome-project
    p = sub.add_parser("genome-project", help="Create a Design Genome project")
    p.add_argument("--contract-id", required=True)
    p.add_argument("--project-name", required=True)
    p.add_argument("--category")
    p.add_argument("--audience")
    p.add_argument("--mood")
    p.add_argument("--purpose")
    p.set_defaults(func=cmd_genome_project)

    # genome-experiment
    p = sub.add_parser("genome-experiment", help="Run a Design Genome experiment")
    p.add_argument("archetype_id")
    p.add_argument("--benchmark")
    p.add_argument("--generations", type=int, default=10)
    p.set_defaults(func=cmd_genome_experiment)

    # genome-release
    p = sub.add_parser("genome-release", help="Release a new corpus version")
    p.add_argument("--version")
    p.set_defaults(func=cmd_genome_release)

    # genome-observations
    sub.add_parser("genome-observations", help="List Design Genome observations").set_defaults(func=cmd_genome_observations)

    # genome-genes
    p = sub.add_parser("genome-genes", help="List Design Genome genes")
    p.add_argument("--active-only", action="store_true")
    p.set_defaults(func=cmd_genome_genes)

    # genome-capabilities
    p = sub.add_parser("genome-capabilities", help="List Design Genome capabilities")
    p.add_argument("--verified-only", action="store_true")
    p.set_defaults(func=cmd_genome_capabilities)

    # genome-projects
    sub.add_parser("genome-projects", help="List Design Genome projects").set_defaults(func=cmd_genome_projects)

    # genome-summary
    sub.add_parser("genome-summary", help="Show Design Genome summary").set_defaults(func=cmd_genome_summary)

    # genome-failures
    sub.add_parser("genome-failures", help="List Design Genome failure records").set_defaults(func=cmd_genome_failures)

    # genome-transfer-tests
    sub.add_parser("genome-transfer-tests", help="List Design Genome transfer tests").set_defaults(func=cmd_genome_transfer_tests)

    # genome-skill-weights
    sub.add_parser("genome-skill-weights", help="Show capabilities ranked by skill weight").set_defaults(func=cmd_genome_skill_weights)

    # genome-curator
    sub.add_parser("genome-curator", help="Show Curator population summary").set_defaults(func=cmd_genome_curator)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
