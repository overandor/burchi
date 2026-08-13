from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from rxreserve.models import (
    PharmaFrontier,
    FrontierState,
    ExperimentContract,
    ConditionalInnovationOption,
    SettlementState,
    EvidenceEnvelope,
    ContributionEnvelope,
    RightsEnvelope,
    SettlementEnvelope,
    PriorArtState,
    RightsOwner,
    ConfidentialityLevel,
    VALID_TRANSITIONS,
    SETTLEMENT_TRANSITIONS,
)
from rxreserve.pricing import ExperimentValuation
from rxreserve.hcp import (
    HCPOpportunityObject,
    HCPInteraction,
    HCPJourneyState,
    HCPChannel,
    EngagementOpportunity,
)
from rxreserve.task_completion import EmailTask, TaskType, TaskStatus
from rxreserve.mailos import (
    MailObject, DecomposedObject, Obligation, ObligationStatus,
    Commitment, HCPIntent, NegativeAction, EngagementDiagnosis,
    ContentDemand, MailEvent, VerificationReceipt, InvisibleWorkChain,
    ObjectType, ObjectPriority, SystemOfRecord,
)
from rxreserve.economic_instruments import (
    UncertaintyAsset,
    InformationValueReceipt,
    ExperimentOption,
    AttributionCapTable,
    RecognitionClaim,
    RecognitionDebt,
    CareerWarrant,
    ReusablePrimitive,
    DerivativeOpportunity,
    KillReceipt,
    ChallengeCase,
    InternalShortThesis,
    DormantOption,
)
from rxreserve.ledger import LedgerEvent, EventType
from rxreserve.economics import (
    EmployeeBalanceSheet,
    ClearingResult,
)


SCHEMA = """
CREATE TABLE IF NOT EXISTS frontiers (
    frontier_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    state TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    fingerprint TEXT,
    problem TEXT,
    unknowns TEXT DEFAULT '[]',
    economic_consequence TEXT DEFAULT '',
    quality_patient_consequence TEXT DEFAULT '',
    current_workaround TEXT DEFAULT '',
    source_evidence TEXT DEFAULT '[]',
    human_originators TEXT DEFAULT '[]',
    ai_contribution TEXT DEFAULT '',
    regulatory_domain TEXT DEFAULT '',
    cost_of_learning REAL DEFAULT 0,
    maximum_upside REAL DEFAULT 0,
    decision_deadline TEXT,
    candidate_experiments TEXT DEFAULT '[]',
    derivative_frontiers TEXT DEFAULT '[]',
    reactivation_predicates TEXT DEFAULT '[]',
    prior_art_state TEXT DEFAULT 'new',
    evidence_envelope TEXT DEFAULT '{}',
    contribution_envelope TEXT DEFAULT '{}',
    rights_envelope TEXT DEFAULT '{}',
    settlement_envelope TEXT DEFAULT '{}',
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS experiments (
    experiment_id TEXT PRIMARY KEY,
    frontier_id TEXT NOT NULL,
    hypothesis TEXT NOT NULL,
    capital_committed REAL DEFAULT 0,
    owners TEXT DEFAULT '[]',
    measurement_rules TEXT DEFAULT '',
    stop_conditions TEXT DEFAULT '[]',
    evidence_requirements TEXT DEFAULT '[]',
    duration_days INTEGER DEFAULT 14,
    target_metric TEXT DEFAULT '',
    target_improvement REAL DEFAULT 0,
    kill_threshold REAL DEFAULT 0.05,
    expansion_threshold REAL DEFAULT 0.20,
    status TEXT DEFAULT 'proposed',
    actual_improvement REAL,
    actual_cost REAL,
    learnings TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (frontier_id) REFERENCES frontiers(frontier_id)
);

CREATE TABLE IF NOT EXISTS options (
    option_id TEXT PRIMARY KEY,
    frontier_id TEXT NOT NULL,
    experiment_id TEXT,
    status TEXT DEFAULT 'dormant',
    created_at TEXT NOT NULL,
    reactivation_predicates TEXT DEFAULT '[]',
    p_technical REAL DEFAULT 0,
    p_regulatory REAL DEFAULT 0,
    benefit REAL DEFAULT 0,
    cost REAL DEFAULT 0,
    dependencies TEXT DEFAULT '[]',
    time_horizon_days INTEGER DEFAULT 365,
    option_value REAL DEFAULT 0,
    last_priced TEXT,
    FOREIGN KEY (frontier_id) REFERENCES frontiers(frontier_id)
);

CREATE TABLE IF NOT EXISTS state_history (
    history_id TEXT PRIMARY KEY,
    frontier_id TEXT NOT NULL,
    from_state TEXT,
    to_state TEXT,
    timestamp TEXT NOT NULL,
    actor TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    FOREIGN KEY (frontier_id) REFERENCES frontiers(frontier_id)
);

CREATE TABLE IF NOT EXISTS valuations (
    valuation_id TEXT PRIMARY KEY,
    frontier_id TEXT NOT NULL,
    experiment_cost REAL,
    success_upside REAL,
    probability_success REAL,
    planned_rollout_cost REAL,
    prob_invalidates_rollout REAL,
    expected_success_value REAL,
    evsi REAL,
    experiment_value REAL,
    is_fundable INTEGER,
    failure_value REAL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (frontier_id) REFERENCES frontiers(frontier_id)
);

CREATE TABLE IF NOT EXISTS hcps (
    hcp_id TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    specialty TEXT DEFAULT '',
    institution TEXT DEFAULT '',
    territory TEXT DEFAULT '',
    npi TEXT DEFAULT '',
    journey_state TEXT DEFAULT 'unknown',
    full_json TEXT,
    created_at TEXT NOT NULL,
    last_updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hcp_interactions (
    interaction_id TEXT PRIMARY KEY,
    hcp_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    channel TEXT DEFAULT 'in_person',
    timestamp TEXT NOT NULL,
    topic TEXT DEFAULT '',
    question_raised TEXT DEFAULT '',
    objection_raised TEXT DEFAULT '',
    evidence_delivered TEXT DEFAULT '',
    approved_asset_used TEXT DEFAULT '',
    outcome TEXT DEFAULT '',
    next_action TEXT DEFAULT '',
    is_compliant INTEGER DEFAULT 1,
    FOREIGN KEY (hcp_id) REFERENCES hcps(hcp_id)
);

CREATE TABLE IF NOT EXISTS engagement_opportunities (
    opportunity_id TEXT PRIMARY KEY,
    originating_employee TEXT,
    frontier_id TEXT,
    barrier TEXT DEFAULT '',
    intervention TEXT DEFAULT '',
    approved_assets TEXT DEFAULT '[]',
    sequence TEXT DEFAULT '',
    initial_cohort_size INTEGER DEFAULT 0,
    initial_success_rate REAL DEFAULT 0,
    addressable_hcps INTEGER DEFAULT 0,
    addressable_accounts INTEGER DEFAULT 0,
    estimated_value REAL DEFAULT 0,
    proposed_experiment TEXT DEFAULT '',
    experiment_status TEXT DEFAULT 'proposed',
    validation_cohort_size INTEGER DEFAULT 0,
    validation_success_rate REAL DEFAULT 0,
    participants TEXT DEFAULT '[]',
    attribution_retained INTEGER DEFAULT 1,
    derivative_opportunities TEXT DEFAULT '[]',
    created_at TEXT NOT NULL,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS employee_career (
    employee_id TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    role TEXT DEFAULT '',
    territory TEXT DEFAULT '',
    manager TEXT DEFAULT '',
    promotion_probability REAL DEFAULT 0,
    automation_risk REAL DEFAULT 0,
    manager_perception REAL DEFAULT 0.5,
    visibility_deficit REAL DEFAULT 0.5,
    network_centrality REAL DEFAULT 0,
    revenue_contribution REAL DEFAULT 0,
    innovation_contribution REAL DEFAULT 0,
    cross_functional_influence REAL DEFAULT 0,
    monster_metric REAL DEFAULT 0,
    direct_value REAL DEFAULT 0,
    derivative_value REAL DEFAULT 0,
    hcps_covered INTEGER DEFAULT 0,
    hcps_engaged INTEGER DEFAULT 0,
    hcps_converted INTEGER DEFAULT 0,
    engagement_quality REAL DEFAULT 0,
    active_opportunities TEXT DEFAULT '[]',
    recommended_actions TEXT DEFAULT '[]',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ancestry_nodes (
    node_id TEXT PRIMARY KEY,
    node_type TEXT NOT NULL,
    label TEXT DEFAULT '',
    value REAL DEFAULT 0,
    metadata TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS ancestry_edges (
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    edge_type TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    alpha REAL DEFAULT 1.0,
    PRIMARY KEY (source, target, edge_type)
);

CREATE TABLE IF NOT EXISTS email_tasks (
    task_id TEXT PRIMARY KEY,
    hcp_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    task_type TEXT DEFAULT 'barrier_resolution',
    status TEXT DEFAULT 'defined',
    objective TEXT DEFAULT '',
    completion_criteria TEXT DEFAULT '',
    verification_method TEXT DEFAULT '',
    barrier TEXT DEFAULT '',
    question TEXT DEFAULT '',
    objection TEXT DEFAULT '',
    evidence_path TEXT DEFAULT '{}',
    approved_assets TEXT DEFAULT '[]',
    from_journey_state TEXT DEFAULT '',
    to_journey_state TEXT DEFAULT '',
    channel_sequence TEXT DEFAULT '[]',
    emails_sent INTEGER DEFAULT 0,
    emails_opened INTEGER DEFAULT 0,
    links_clicked INTEGER DEFAULT 0,
    replies_received INTEGER DEFAULT 0,
    interactions_triggered INTEGER DEFAULT 0,
    barrier_resolved INTEGER DEFAULT 0,
    question_answered INTEGER DEFAULT 0,
    journey_advanced INTEGER DEFAULT 0,
    completion_timestamp TEXT,
    pattern_canonicalized INTEGER DEFAULT 0,
    derivative_created INTEGER DEFAULT 0,
    capability_magnified INTEGER DEFAULT 0,
    interaction_ids TEXT DEFAULT '[]',
    created_at TEXT NOT NULL,
    last_updated TEXT NOT NULL,
    full_json TEXT
);

-- LAIDER economic instruments

CREATE TABLE IF NOT EXISTS ledger_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    actor TEXT DEFAULT '',
    entity_id TEXT DEFAULT '',
    entity_type TEXT DEFAULT '',
    payload TEXT DEFAULT '{}',
    prev_event_id TEXT,
    metadata TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS uncertainties (
    uncertainty_id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    affected_process TEXT DEFAULT '',
    current_decision TEXT DEFAULT '',
    decision_cost REAL DEFAULT 0,
    evidence_available TEXT DEFAULT '',
    confidence_before REAL DEFAULT 0.5,
    possible_answers TEXT DEFAULT '[]',
    value_if_resolved REAL DEFAULT 0,
    resolution_cost REAL DEFAULT 0,
    expiry TEXT,
    owner TEXT DEFAULT '',
    witnesses TEXT DEFAULT '[]',
    state TEXT DEFAULT 'open',
    created_at TEXT NOT NULL,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS experiment_options (
    option_id TEXT PRIMARY KEY,
    uncertainty_id TEXT,
    hypothesis TEXT NOT NULL,
    tranches TEXT DEFAULT '[]',
    current_tranche_index INTEGER DEFAULT 0,
    status TEXT DEFAULT 'proposed',
    created_at TEXT NOT NULL,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS cap_tables (
    cap_table_id TEXT PRIMARY KEY,
    experiment_id TEXT NOT NULL,
    entries TEXT DEFAULT '[]',
    amendments TEXT DEFAULT '[]',
    total_weight REAL DEFAULT 0,
    is_balanced INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS recognition_claims (
    claim_id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    attributed_value REAL DEFAULT 0,
    recognized_value REAL DEFAULT 0,
    recognition_yield REAL DEFAULT 0,
    recognition_type TEXT DEFAULT '',
    status TEXT DEFAULT 'requested',
    granted_by TEXT DEFAULT '',
    rationale TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS recognition_debts (
    debt_id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    attributed_career_capital REAL DEFAULT 0,
    settled_career_capital REAL DEFAULT 0,
    debt REAL DEFAULT 0,
    verified_value_created REAL DEFAULT 0,
    reusable_systems INTEGER DEFAULT 0,
    cross_team_improvements INTEGER DEFAULT 0,
    current_title TEXT DEFAULT '',
    current_scope TEXT DEFAULT '',
    current_compensation REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS career_warrants (
    warrant_id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    experiment_id TEXT,
    triggers TEXT DEFAULT '[]',
    career_right TEXT DEFAULT '',
    status TEXT DEFAULT 'proposed',
    approved_by TEXT DEFAULT '',
    exercised_at TEXT,
    created_at TEXT NOT NULL,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS reusable_primitives (
    primitive_id TEXT PRIMARY KEY,
    origin_experiment TEXT,
    originators TEXT DEFAULT '[]',
    abstraction TEXT DEFAULT '',
    implementation TEXT DEFAULT '',
    constraints TEXT DEFAULT '[]',
    demonstrated_domains TEXT DEFAULT '[]',
    downstream_derivatives TEXT DEFAULT '[]',
    created_at TEXT NOT NULL,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS derivative_opportunities (
    derivative_id TEXT PRIMARY KEY,
    parent_experiment TEXT,
    primitive_id TEXT,
    target_context TEXT DEFAULT '',
    similarity REAL DEFAULT 0,
    changed_constraints TEXT DEFAULT '[]',
    expected_transferability REAL DEFAULT 0,
    new_uncertainties TEXT DEFAULT '[]',
    owner_candidates TEXT DEFAULT '[]',
    expected_value REAL DEFAULT 0,
    status TEXT DEFAULT 'identified',
    created_at TEXT NOT NULL,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS kill_credits (
    kill_id TEXT PRIMARY KEY,
    proposed_project TEXT DEFAULT '',
    employee_objection TEXT DEFAULT '',
    evidence TEXT DEFAULT '',
    experiment_id TEXT,
    result TEXT DEFAULT '',
    investment_prevented REAL DEFAULT 0,
    estimated_loss_avoided REAL DEFAULT 0,
    employee_id TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS challenge_cases (
    challenge_id TEXT PRIMARY KEY,
    proposal_id TEXT,
    challenger TEXT DEFAULT '',
    challenge_type TEXT DEFAULT '',
    content TEXT DEFAULT '',
    evidence TEXT DEFAULT '',
    falsifiable_test TEXT DEFAULT '',
    status TEXT DEFAULT 'submitted',
    information_value REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS short_theses (
    thesis_id TEXT PRIMARY KEY,
    target_initiative TEXT DEFAULT '',
    author TEXT DEFAULT '',
    thesis TEXT DEFAULT '',
    flawed_assumption TEXT DEFAULT '',
    falsifiable_test TEXT DEFAULT '',
    test_result INTEGER,
    loss_avoided REAL DEFAULT 0,
    status TEXT DEFAULT 'open',
    created_at TEXT NOT NULL,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS information_value_receipts (
    receipt_id TEXT PRIMARY KEY,
    uncertainty_id TEXT,
    experiment_id TEXT,
    prior_distribution TEXT DEFAULT '{}',
    posterior_distribution TEXT DEFAULT '{}',
    decision_changed INTEGER DEFAULT 0,
    avoided_commitment TEXT DEFAULT '',
    estimated_loss_avoided REAL DEFAULT 0,
    information_value REAL DEFAULT 0,
    confidence REAL DEFAULT 0,
    evidence TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS dormant_options (
    option_id TEXT PRIMARY KEY,
    original_proposal TEXT DEFAULT '',
    reason_dormant TEXT DEFAULT '',
    reactivation_predicates TEXT DEFAULT '[]',
    status TEXT DEFAULT 'dormant',
    created_at TEXT NOT NULL,
    last_checked TEXT NOT NULL,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS balance_sheets (
    sheet_id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    sheet_type TEXT DEFAULT 'employee',
    full_json TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clearing_results (
    experiment_id TEXT PRIMARY KEY,
    company_utility TEXT DEFAULT '{}',
    employee_utility TEXT DEFAULT '{}',
    governor TEXT DEFAULT '{}',
    company_yes INTEGER DEFAULT 0,
    employee_yes INTEGER DEFAULT 0,
    governor_safe INTEGER DEFAULT 0,
    clears INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS mailos_mails (
    mail_id TEXT PRIMARY KEY,
    from_address TEXT, from_name TEXT, from_type TEXT,
    to_addresses TEXT DEFAULT '[]', cc_addresses TEXT DEFAULT '[]',
    subject TEXT, body TEXT, timestamp TEXT, mailbox TEXT,
    thread_id TEXT, in_reply_to TEXT,
    matched_hcp_id TEXT, matched_employee_id TEXT, matched_account_id TEXT,
    decomposed INTEGER DEFAULT 0, decomposed_object_ids TEXT DEFAULT '[]',
    created_at TEXT NOT NULL, full_json TEXT
);

CREATE TABLE IF NOT EXISTS mailos_objects (
    object_id TEXT PRIMARY KEY,
    mail_id TEXT, object_type TEXT, priority TEXT,
    summary TEXT, detail TEXT, extracted_text TEXT,
    target_system TEXT, target_owner TEXT, routing_confidence REAL,
    hcp_id TEXT, employee_id TEXT, account_id TEXT,
    product TEXT, topic TEXT, clinical_topic TEXT,
    obligation_id TEXT, created_at TEXT NOT NULL, full_json TEXT
);

CREATE TABLE IF NOT EXISTS mailos_obligations (
    obligation_id TEXT PRIMARY KEY,
    object_id TEXT, mail_id TEXT,
    obligation_type TEXT, description TEXT, required_action TEXT,
    policy_reference TEXT, regulatory_context TEXT,
    deadline TEXT, deadline_hours REAL, is_regulatory_deadline INTEGER DEFAULT 0,
    assigned_owner TEXT, assigned_team TEXT, target_system TEXT,
    required_evidence TEXT, evidence_artifact TEXT,
    status TEXT, status_history TEXT DEFAULT '[]',
    escalation_policy TEXT, escalated_to TEXT,
    verification_method TEXT, verified_by TEXT, verified_at TEXT,
    hcp_id TEXT, employee_id TEXT,
    created_at TEXT NOT NULL, closed_at TEXT, full_json TEXT
);

CREATE TABLE IF NOT EXISTS mailos_commitments (
    commitment_id TEXT PRIMARY KEY,
    mail_id TEXT, promisor TEXT, promisor_type TEXT,
    recipient TEXT, recipient_type TEXT,
    requested_action TEXT, deadline TEXT, regulatory_context TEXT,
    system_owner TEXT, linked_obligation_id TEXT,
    status TEXT, evidence TEXT, verified_at TEXT,
    hcp_id TEXT, employee_id TEXT, created_at TEXT NOT NULL, full_json TEXT
);

CREATE TABLE IF NOT EXISTS mailos_intents (
    intent_id TEXT PRIMARY KEY,
    mail_id TEXT, hcp_id TEXT,
    intent_type TEXT, confidence REAL,
    summary TEXT, detail TEXT, extracted_text TEXT,
    relationship_impact TEXT, next_best_action TEXT, negative_action TEXT,
    linked_obligation_ids TEXT DEFAULT '[]', linked_commitment_ids TEXT DEFAULT '[]',
    created_at TEXT NOT NULL, full_json TEXT
);

CREATE TABLE IF NOT EXISTS mailos_negative_actions (
    action_id TEXT PRIMARY KEY,
    hcp_id TEXT, employee_id TEXT,
    action_type TEXT, reason TEXT, duration TEXT, expires_at TEXT,
    source_intent_id TEXT, source_obligation_id TEXT,
    created_at TEXT NOT NULL, full_json TEXT
);

CREATE TABLE IF NOT EXISTS mailos_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT, mail_id TEXT, timestamp TEXT,
    payload TEXT DEFAULT '{}', target_systems TEXT DEFAULT '[]',
    processed_by TEXT DEFAULT '[]', created_at TEXT NOT NULL, full_json TEXT
);

CREATE TABLE IF NOT EXISTS mailos_receipts (
    receipt_id TEXT PRIMARY KEY,
    obligation_id TEXT,
    verification_method TEXT, evidence_artifact TEXT, evidence_link TEXT,
    verified_by TEXT, verified_at TEXT,
    independent_signal TEXT, independent_signal_source TEXT,
    is_verified INTEGER DEFAULT 0, created_at TEXT NOT NULL, full_json TEXT
);

-- Design Genome Runtime tables

CREATE TABLE IF NOT EXISTS genome_sources (
    source_id TEXT PRIMARY KEY,
    url TEXT, creator TEXT, date_discovered TEXT, date_published TEXT,
    category TEXT, license_state TEXT, asset_classification TEXT,
    robots_allowed INTEGER DEFAULT 1, access_policy_checked INTEGER DEFAULT 0,
    rate_limit_respected INTEGER DEFAULT 1, attribution TEXT,
    provenance_chain TEXT DEFAULT '[]', source_hash TEXT,
    is_duplicate INTEGER DEFAULT 0, personal_info_removed INTEGER DEFAULT 0,
    expired INTEGER DEFAULT 0, metadata TEXT DEFAULT '{}',
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS genome_observations (
    observation_id TEXT PRIMARY KEY,
    source_id TEXT, url TEXT, capture_date TEXT NOT NULL,
    screenshot_desktop TEXT, screenshot_tablet TEXT, screenshot_mobile TEXT,
    interaction_trace TEXT,
    page_hierarchy TEXT DEFAULT '{}', interaction_graph TEXT DEFAULT '{}',
    layout_geometry TEXT DEFAULT '{}', typography_ratios TEXT DEFAULT '{}',
    spacing_rhythm TEXT DEFAULT '[]', color_relationships TEXT DEFAULT '{}',
    density_info_hierarchy TEXT DEFAULT '{}', navigation_model TEXT DEFAULT '',
    motion_transitions TEXT DEFAULT '[]', component_topology TEXT DEFAULT '{}',
    brand_personality TEXT DEFAULT '',
    unusual_design_decisions TEXT DEFAULT '[]', usability_problems TEXT DEFAULT '[]',
    performance_score REAL DEFAULT 0, accessibility_score REAL DEFAULT 0,
    commercial_effectiveness REAL,
    trend_velocity REAL DEFAULT 0, novelty_score REAL DEFAULT 0,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS genome_genes (
    gene_id TEXT PRIMARY KEY,
    gene_type TEXT, description TEXT, source_observation_id TEXT,
    principle TEXT, preserve_attributes TEXT DEFAULT '[]',
    transform_attributes TEXT DEFAULT '[]',
    product_categories TEXT DEFAULT '[]', audience_types TEXT DEFAULT '[]',
    mood_tags TEXT DEFAULT '[]', interaction_purposes TEXT DEFAULT '[]',
    novelty_score REAL DEFAULT 0, quality_score REAL DEFAULT 0,
    saturation_score REAL DEFAULT 0, trend_velocity REAL DEFAULT 0,
    transfer_attempts INTEGER DEFAULT 0, successful_transfers INTEGER DEFAULT 0,
    confidence REAL DEFAULT 0, created_at TEXT NOT NULL,
    retired INTEGER DEFAULT 0, retired_reason TEXT DEFAULT '',
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS genome_targets (
    target_id TEXT PRIMARY KEY,
    benchmark_observation_id TEXT, current_render_id TEXT, previous_render_id TEXT,
    visual_identity TEXT, primary_composition TEXT,
    depth_layers INTEGER DEFAULT 0, foreground_background_separation REAL DEFAULT 0,
    motion_character TEXT, typography_character TEXT,
    information_density_target REAL DEFAULT 0,
    lighting_description TEXT, material_behavior TEXT,
    recommended_renderer TEXT, renderer_rationale TEXT,
    errors TEXT DEFAULT '[]',
    spatial_similarity REAL DEFAULT 0, identity_preservation REAL DEFAULT 0,
    next_correction TEXT, next_correction_rationale TEXT,
    created_at TEXT NOT NULL, full_json TEXT
);

CREATE TABLE IF NOT EXISTS genome_contracts (
    contract_id TEXT PRIMARY KEY,
    project_name TEXT, project_brief TEXT,
    required_emotions TEXT DEFAULT '[]', spatial_signature TEXT,
    interaction_primitive TEXT, forbidden_cliche TEXT,
    typography_doctrine TEXT, motion_doctrine TEXT,
    density_rule TEXT, unique_feature TEXT,
    distinction_verified INTEGER DEFAULT 0, distinction_score REAL DEFAULT 0,
    created_at TEXT NOT NULL, full_json TEXT
);

CREATE TABLE IF NOT EXISTS genome_implementations (
    impl_id TEXT PRIMARY KEY,
    project_id TEXT, distinction_contract_id TEXT,
    renderer_type TEXT, architecture_hypothesis TEXT,
    is_prototype INTEGER DEFAULT 0,
    parent_id TEXT, generation INTEGER DEFAULT 0,
    mutation_type TEXT, mutation_description TEXT,
    status TEXT DEFAULT 'proposed',
    best_render_id TEXT, best_quality REAL DEFAULT 0,
    render_history TEXT DEFAULT '[]',
    source_code TEXT DEFAULT '',
    created_at TEXT NOT NULL, full_json TEXT
);

CREATE TABLE IF NOT EXISTS genome_renders (
    render_id TEXT PRIMARY KEY,
    implementation_id TEXT, iteration INTEGER DEFAULT 0,
    desktop_frame_count INTEGER DEFAULT 0, mobile_frame_count INTEGER DEFAULT 0,
    interaction_trace TEXT, performance_trace TEXT DEFAULT '{}',
    renderer_type TEXT,
    quality_json TEXT DEFAULT '{}',
    delta_vs_previous REAL DEFAULT 0, delta_vs_reference REAL DEFAULT 0,
    delta_vs_frontier REAL DEFAULT 0,
    accepted INTEGER DEFAULT 0, rejected_reason TEXT DEFAULT '',
    created_at TEXT NOT NULL, full_json TEXT
);

CREATE TABLE IF NOT EXISTS genome_capabilities (
    capability_id TEXT PRIMARY KEY,
    name TEXT, recognition TEXT, execution TEXT, validation TEXT,
    trigger_conditions TEXT DEFAULT '', perceptual_objective TEXT DEFAULT '',
    renderer_architecture TEXT DEFAULT '', working_implementation_id TEXT DEFAULT '',
    parameter_ranges TEXT DEFAULT '{}',
    failed_alternatives TEXT DEFAULT '[]',
    verified_renders TEXT DEFAULT '[]', interaction_recording_id TEXT DEFAULT '',
    performance_profile TEXT DEFAULT '{}',
    comparison_scores TEXT DEFAULT '{}',
    transfer_products TEXT DEFAULT '[]', transfer_success_count INTEGER DEFAULT 0,
    transfer_test_results TEXT DEFAULT '[]',
    confidence REAL DEFAULT 0,
    quality_factor REAL DEFAULT 0, transferability_factor REAL DEFAULT 0,
    novelty_factor REAL DEFAULT 0, reliability_factor REAL DEFAULT 0,
    saturation_factor REAL DEFAULT 1.0,
    expiration_weight REAL DEFAULT 1.0, last_used TEXT DEFAULT '',
    times_retrieved INTEGER DEFAULT 0,
    source_observation_id TEXT, source_gene_ids TEXT DEFAULT '[]',
    verified_impl_id TEXT,
    status TEXT DEFAULT 'observed',
    depth_reproduced INTEGER DEFAULT 0, motion_reproduced INTEGER DEFAULT 0,
    mobile_preserved INTEGER DEFAULT 0, accessibility_maintained INTEGER DEFAULT 0,
    performance_budget_met INTEGER DEFAULT 0,
    transfers_to_other_products INTEGER DEFAULT 0,
    survives_human_comparison INTEGER DEFAULT 0,
    created_at TEXT NOT NULL, verified_at TEXT, full_json TEXT
);

CREATE TABLE IF NOT EXISTS genome_failures (
    failure_id TEXT PRIMARY KEY,
    capability_id TEXT DEFAULT '', impl_id TEXT DEFAULT '',
    attempted_approach TEXT DEFAULT '', renderer_type TEXT DEFAULT '',
    mutation_axis TEXT DEFAULT '',
    failure_mode TEXT DEFAULT '', failure_description TEXT DEFAULT '',
    render_id TEXT DEFAULT '', quality_score REAL DEFAULT 0,
    quality_breakdown TEXT DEFAULT '{}',
    lesson TEXT DEFAULT '', avoid_pattern TEXT DEFAULT '',
    generation INTEGER DEFAULT 0, parent_impl_id TEXT DEFAULT '',
    created_at TEXT NOT NULL, full_json TEXT
);

CREATE TABLE IF NOT EXISTS genome_transfer_tests (
    test_id TEXT PRIMARY KEY,
    capability_id TEXT DEFAULT '',
    target_product_category TEXT DEFAULT '',
    target_audience TEXT DEFAULT '', target_mood TEXT DEFAULT '',
    transfer_impl_id TEXT DEFAULT '', transfer_render_id TEXT DEFAULT '',
    quality_in_new_context REAL DEFAULT 0,
    identity_preserved INTEGER DEFAULT 0, depth_preserved INTEGER DEFAULT 0,
    motion_preserved INTEGER DEFAULT 0, accessibility_maintained INTEGER DEFAULT 0,
    passed INTEGER DEFAULT 0, failure_reason TEXT DEFAULT '',
    created_at TEXT NOT NULL, full_json TEXT
);

CREATE TABLE IF NOT EXISTS genome_manifests (
    manifest_id TEXT PRIMARY KEY,
    corpus_version TEXT, release_date TEXT NOT NULL,
    source_hashes TEXT DEFAULT '[]', license_states TEXT DEFAULT '{}',
    added_patterns TEXT DEFAULT '[]', retired_patterns TEXT DEFAULT '[]',
    trend_velocity REAL DEFAULT 0, oversaturated_patterns TEXT DEFAULT '[]',
    evaluation_model TEXT, quality_thresholds TEXT DEFAULT '{}',
    generated_design_results TEXT DEFAULT '[]',
    total_observations INTEGER DEFAULT 0, total_genes INTEGER DEFAULT 0,
    total_capabilities INTEGER DEFAULT 0, total_verified_capabilities INTEGER DEFAULT 0,
    full_json TEXT
);

CREATE TABLE IF NOT EXISTS genome_projects (
    archetype_id TEXT PRIMARY KEY,
    project_name TEXT, product_category TEXT, audience TEXT,
    mood TEXT, interaction_purpose TEXT,
    active_gene_ids TEXT DEFAULT '[]', distinction_contract_id TEXT,
    best_impl_id TEXT, best_quality_score REAL DEFAULT 0,
    experience_hypotheses TEXT DEFAULT '[]',
    created_at TEXT NOT NULL, full_json TEXT
);

CREATE TABLE IF NOT EXISTS genome_preferences (
    entry_id TEXT PRIMARY KEY,
    project_id TEXT, design_decision TEXT, user_behavior TEXT,
    measured_outcome TEXT, outcome_metric TEXT, outcome_value REAL DEFAULT 0,
    human_preference_score REAL DEFAULT 0,
    context_tags TEXT DEFAULT '[]', created_at TEXT NOT NULL, full_json TEXT
);

CREATE TABLE IF NOT EXISTS genome_state (
    runtime_id TEXT PRIMARY KEY,
    current_corpus_version TEXT, last_acquisition_run TEXT, last_corpus_release TEXT,
    observation_count INTEGER DEFAULT 0, latent_value_count INTEGER DEFAULT 0,
    attempt_count INTEGER DEFAULT 0, verified_capability_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0, transfer_test_count INTEGER DEFAULT 0,
    frontier_population_count INTEGER DEFAULT 0, candidate_population_count INTEGER DEFAULT 0,
    capability_population_count INTEGER DEFAULT 0, failure_population_count INTEGER DEFAULT 0,
    average_quality REAL DEFAULT 0, quality_trend REAL DEFAULT 0,
    oversaturated_patterns TEXT DEFAULT '[]', retired_pattern_count INTEGER DEFAULT 0,
    saturated_capability_count INTEGER DEFAULT 0,
    active_project_count INTEGER DEFAULT 0,
    total_acquisition_cycles INTEGER DEFAULT 0, total_experiments INTEGER DEFAULT 0,
    total_accepted_mutations INTEGER DEFAULT 0, total_rejected_mutations INTEGER DEFAULT 0,
    total_tournaments INTEGER DEFAULT 0, total_transfer_tests INTEGER DEFAULT 0,
    total_transfer_passes INTEGER DEFAULT 0,
    full_json TEXT
);
"""


class Database:
    """SQLite persistence for RxReserve."""

    def __init__(self, db_path: str = "rxreserve.db"):
        self.db_path = db_path
        self.conn: Optional[sqlite3.Connection] = None
        self._connect()
        self._migrate()

    def _connect(self) -> None:
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")

    def _migrate(self) -> None:
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        if self.conn:
            self.conn.close()

    # --- Frontiers ---

    def upsert_frontier(self, f: PharmaFrontier) -> None:
        d = f.to_dict()
        self.conn.execute(
            """
            INSERT INTO frontiers (frontier_id, created_at, state, version, fingerprint,
                problem, unknowns, economic_consequence, quality_patient_consequence,
                current_workaround, source_evidence, human_originators, ai_contribution,
                regulatory_domain, cost_of_learning, maximum_upside, decision_deadline,
                candidate_experiments, derivative_frontiers, reactivation_predicates,
                prior_art_state, evidence_envelope, contribution_envelope,
                rights_envelope, settlement_envelope, full_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(frontier_id) DO UPDATE SET
                state=excluded.state, version=excluded.version, fingerprint=excluded.fingerprint,
                problem=excluded.problem, unknowns=excluded.unknowns,
                economic_consequence=excluded.economic_consequence,
                quality_patient_consequence=excluded.quality_patient_consequence,
                current_workaround=excluded.current_workaround,
                source_evidence=excluded.source_evidence,
                human_originators=excluded.human_originators,
                ai_contribution=excluded.ai_contribution,
                regulatory_domain=excluded.regulatory_domain,
                cost_of_learning=excluded.cost_of_learning,
                maximum_upside=excluded.maximum_upside,
                decision_deadline=excluded.decision_deadline,
                candidate_experiments=excluded.candidate_experiments,
                derivative_frontiers=excluded.derivative_frontiers,
                reactivation_predicates=excluded.reactivation_predicates,
                prior_art_state=excluded.prior_art_state,
                evidence_envelope=excluded.evidence_envelope,
                contribution_envelope=excluded.contribution_envelope,
                rights_envelope=excluded.rights_envelope,
                settlement_envelope=excluded.settlement_envelope,
                full_json=excluded.full_json
            """,
            (
                f.frontier_id, f.created_at.isoformat(), f.state.value, f.version,
                d["fingerprint"], f.problem, json.dumps(f.unknowns),
                f.economic_consequence, f.quality_patient_consequence,
                f.current_workaround, json.dumps(f.source_evidence),
                json.dumps(f.human_originators), f.ai_contribution,
                f.regulatory_domain, f.cost_of_learning, f.maximum_upside,
                f.decision_deadline, json.dumps(f.candidate_experiments),
                json.dumps(f.derivative_frontiers),
                json.dumps(f.reactivation_predicates),
                f.prior_art_state.value,
                json.dumps(d["evidence_envelope"]),
                json.dumps(d["contribution_envelope"]),
                json.dumps(d["rights_envelope"]),
                json.dumps(d["settlement_envelope"]),
                json.dumps(d),
            ),
        )
        self.conn.commit()

    def get_frontier(self, frontier_id: str) -> Optional[PharmaFrontier]:
        row = self.conn.execute("SELECT full_json FROM frontiers WHERE frontier_id = ?", (frontier_id,)).fetchone()
        if not row:
            return None
        return self._json_to_frontier(row["full_json"])

    def get_all_frontiers(self) -> list[PharmaFrontier]:
        rows = self.conn.execute("SELECT full_json FROM frontiers ORDER BY created_at DESC").fetchall()
        return [self._json_to_frontier(r["full_json"]) for r in rows]

    def get_frontiers_by_state(self, state: FrontierState) -> list[PharmaFrontier]:
        rows = self.conn.execute("SELECT full_json FROM frontiers WHERE state = ? ORDER BY created_at DESC", (state.value,)).fetchall()
        return [self._json_to_frontier(r["full_json"]) for r in rows]

    def delete_frontier(self, frontier_id: str) -> None:
        self.conn.execute("DELETE FROM frontiers WHERE frontier_id = ?", (frontier_id,))
        self.conn.commit()

    def transition_frontier(self, frontier_id: str, target: FrontierState, actor: str = "", notes: str = "") -> PharmaFrontier:
        f = self.get_frontier(frontier_id)
        if not f:
            raise ValueError(f"Frontier {frontier_id} not found")

        valid = VALID_TRANSITIONS.get(f.state, [])
        if target not in valid:
            raise ValueError(f"Invalid transition: {f.state.value} → {target.value}. Valid: {[s.value for s in valid]}")

        old_state = f.state
        f.state = target
        f.version += 1
        self.upsert_frontier(f)

        self.conn.execute(
            "INSERT INTO state_history (history_id, frontier_id, from_state, to_state, timestamp, actor, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (str(uuid4()), frontier_id, old_state.value, target.value, datetime.now(timezone.utc).isoformat(), actor, notes),
        )
        self.conn.commit()
        return f

    def get_state_history(self, frontier_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM state_history WHERE frontier_id = ? ORDER BY timestamp", (frontier_id,)).fetchall()
        return [dict(r) for r in rows]

    # --- Experiments ---

    def upsert_experiment(self, exp: ExperimentContract) -> None:
        self.conn.execute(
            """
            INSERT INTO experiments (experiment_id, frontier_id, hypothesis, capital_committed, owners,
                measurement_rules, stop_conditions, evidence_requirements, duration_days,
                target_metric, target_improvement, kill_threshold, expansion_threshold,
                status, actual_improvement, actual_cost, learnings, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(experiment_id) DO UPDATE SET
                hypothesis=excluded.hypothesis, capital_committed=excluded.capital_committed,
                owners=excluded.owners, measurement_rules=excluded.measurement_rules,
                stop_conditions=excluded.stop_conditions,
                evidence_requirements=excluded.evidence_requirements,
                duration_days=excluded.duration_days, target_metric=excluded.target_metric,
                target_improvement=excluded.target_improvement,
                kill_threshold=excluded.kill_threshold,
                expansion_threshold=excluded.expansion_threshold,
                status=excluded.status, actual_improvement=excluded.actual_improvement,
                actual_cost=excluded.actual_cost, learnings=excluded.learnings
            """,
            (
                exp.experiment_id, exp.frontier_id, exp.hypothesis, exp.capital_committed,
                json.dumps(exp.owners), exp.measurement_rules,
                json.dumps(exp.stop_conditions), json.dumps(exp.evidence_requirements),
                exp.duration_days, exp.target_metric, exp.target_improvement,
                exp.kill_threshold, exp.expansion_threshold, exp.status,
                exp.actual_improvement, exp.actual_cost, exp.learnings,
                exp.created_at.isoformat(),
            ),
        )
        self.conn.commit()

    def get_experiment(self, experiment_id: str) -> Optional[ExperimentContract]:
        row = self.conn.execute("SELECT * FROM experiments WHERE experiment_id = ?", (experiment_id,)).fetchone()
        if not row:
            return None
        return self._row_to_experiment(row)

    def get_experiments_by_frontier(self, frontier_id: str) -> list[ExperimentContract]:
        rows = self.conn.execute("SELECT * FROM experiments WHERE frontier_id = ?", (frontier_id,)).fetchall()
        return [self._row_to_experiment(r) for r in rows]

    def get_all_experiments(self) -> list[ExperimentContract]:
        rows = self.conn.execute("SELECT * FROM experiments ORDER BY created_at DESC").fetchall()
        return [self._row_to_experiment(r) for r in rows]

    # --- Options ---

    def upsert_option(self, opt: ConditionalInnovationOption) -> None:
        self.conn.execute(
            """
            INSERT INTO options (option_id, frontier_id, experiment_id, status, created_at,
                reactivation_predicates, p_technical, p_regulatory, benefit, cost,
                dependencies, time_horizon_days, option_value, last_priced)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(option_id) DO UPDATE SET
                status=excluded.status, reactivation_predicates=excluded.reactivation_predicates,
                p_technical=excluded.p_technical, p_regulatory=excluded.p_regulatory,
                benefit=excluded.benefit, cost=excluded.cost,
                dependencies=excluded.dependencies, time_horizon_days=excluded.time_horizon_days,
                option_value=excluded.option_value, last_priced=excluded.last_priced
            """,
            (
                opt.option_id, opt.frontier_id, opt.experiment_id, opt.status,
                opt.created_at.isoformat(), json.dumps(opt.reactivation_predicates),
                opt.p_technical, opt.p_regulatory, opt.benefit, opt.cost,
                json.dumps(opt.dependencies), opt.time_horizon_days,
                opt.option_value, opt.last_priced,
            ),
        )
        self.conn.commit()

    def get_option(self, option_id: str) -> Optional[ConditionalInnovationOption]:
        row = self.conn.execute("SELECT * FROM options WHERE option_id = ?", (option_id,)).fetchone()
        if not row:
            return None
        return self._row_to_option(row)

    def get_all_options(self) -> list[ConditionalInnovationOption]:
        rows = self.conn.execute("SELECT * FROM options ORDER BY created_at DESC").fetchall()
        return [self._row_to_option(r) for r in rows]

    def get_dormant_options(self) -> list[ConditionalInnovationOption]:
        rows = self.conn.execute("SELECT * FROM options WHERE status IN ('dormant', 'monitoring') ORDER BY option_value DESC").fetchall()
        return [self._row_to_option(r) for r in rows]

    # --- Valuations ---

    def save_valuation(self, frontier_id: str, val: ExperimentValuation) -> str:
        vid = str(uuid4())
        self.conn.execute(
            """INSERT INTO valuations (valuation_id, frontier_id, experiment_cost, success_upside,
               probability_success, planned_rollout_cost, prob_invalidates_rollout,
               expected_success_value, evsi, experiment_value, is_fundable, failure_value, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (vid, frontier_id, val.experiment_cost, val.success_upside, val.probability_success,
             val.planned_rollout_cost, val.prob_invalidates_rollout,
             val.expected_success_value, val.evsi, val.experiment_value,
             int(val.is_fundable), val.failure_value, datetime.now(timezone.utc).isoformat()),
        )
        self.conn.commit()
        return vid

    # --- Converters ---

    @staticmethod
    def _json_to_frontier(j: str) -> PharmaFrontier:
        d = json.loads(j)
        f = PharmaFrontier(
            frontier_id=d["frontier_id"],
            created_at=datetime.fromisoformat(d["created_at"]),
            state=FrontierState(d["state"]),
            version=d["version"],
            problem=d["problem"],
            unknowns=d["unknowns"],
            economic_consequence=d["economic_consequence"],
            quality_patient_consequence=d["quality_patient_consequence"],
            current_workaround=d["current_workaround"],
            source_evidence=d["source_evidence"],
            human_originators=d["human_originators"],
            ai_contribution=d["ai_contribution"],
            regulatory_domain=d["regulatory_domain"],
            cost_of_learning=d["cost_of_learning"],
            maximum_upside=d["maximum_upside"],
            decision_deadline=d["decision_deadline"],
            candidate_experiments=d["candidate_experiments"],
            derivative_frontiers=d["derivative_frontiers"],
            reactivation_predicates=d["reactivation_predicates"],
            prior_art_state=PriorArtState(d["prior_art_state"]),
        )
        ee = d["evidence_envelope"]
        f.evidence_envelope = EvidenceEnvelope(**ee)
        ce = d["contribution_envelope"]
        f.contribution_envelope = ContributionEnvelope(**ce)
        re = d["rights_envelope"]
        f.rights_envelope = RightsEnvelope(
            rights_owner=RightsOwner(re["rights_owner"]),
            inventor_status=re["inventor_status"],
            assignment_obligation=re["assignment_obligation"],
            governing_agreement=re["governing_agreement"],
            jurisdiction=re["jurisdiction"],
            confidentiality=ConfidentialityLevel(re["confidentiality"]),
            external_disclosure_allowed=re["external_disclosure_allowed"],
            patent_review_required=re["patent_review_required"],
            employee_reward_rights=re["employee_reward_rights"],
            transferability=re["transferability"],
            rights_confidence=re["rights_confidence"],
        )
        se = d["settlement_envelope"]
        f.settlement_envelope = SettlementEnvelope(
            reward_contract_id=se["reward_contract_id"],
            covered_frontier=se["covered_frontier"],
            covered_contributors=se["covered_contributors"],
            milestones=se["milestones"],
            verification_method=se["verification_method"],
            payment_formula=se["payment_formula"],
            caps=se["caps"],
            attribution_rule=se["attribution_rule"],
            dispute_process=se["dispute_process"],
            vesting_conditions=se["vesting_conditions"],
            termination_conditions=se["termination_conditions"],
            transfer_restrictions=se["transfer_restrictions"],
            settlement_state=SettlementState(se["settlement_state"]),
        )
        return f

    @staticmethod
    def _row_to_experiment(row: sqlite3.Row) -> ExperimentContract:
        return ExperimentContract(
            experiment_id=row["experiment_id"], frontier_id=row["frontier_id"],
            hypothesis=row["hypothesis"], capital_committed=row["capital_committed"],
            owners=json.loads(row["owners"]), measurement_rules=row["measurement_rules"],
            stop_conditions=json.loads(row["stop_conditions"]),
            evidence_requirements=json.loads(row["evidence_requirements"]),
            duration_days=row["duration_days"], target_metric=row["target_metric"],
            target_improvement=row["target_improvement"],
            kill_threshold=row["kill_threshold"],
            expansion_threshold=row["expansion_threshold"],
            status=row["status"], actual_improvement=row["actual_improvement"],
            actual_cost=row["actual_cost"], learnings=row["learnings"],
            created_at=datetime.fromisoformat(row["created_at"]),
        )

    @staticmethod
    def _row_to_option(row: sqlite3.Row) -> ConditionalInnovationOption:
        opt = ConditionalInnovationOption(
            option_id=row["option_id"], frontier_id=row["frontier_id"],
            experiment_id=row["experiment_id"], status=row["status"],
            created_at=datetime.fromisoformat(row["created_at"]),
            reactivation_predicates=json.loads(row["reactivation_predicates"]),
            p_technical=row["p_technical"], p_regulatory=row["p_regulatory"],
            benefit=row["benefit"], cost=row["cost"],
            dependencies=json.loads(row["dependencies"]),
            time_horizon_days=row["time_horizon_days"],
            option_value=row["option_value"], last_priced=row["last_priced"],
        )
        return opt

    # --- HCPs ---

    def upsert_hcp(self, hcp: HCPOpportunityObject) -> None:
        d = hcp.to_dict()
        self.conn.execute(
            """INSERT INTO hcps (hcp_id, name, specialty, institution, territory, npi,
               journey_state, full_json, created_at, last_updated)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(hcp_id) DO UPDATE SET
               name=excluded.name, specialty=excluded.specialty,
               institution=excluded.institution, territory=excluded.territory,
               npi=excluded.npi, journey_state=excluded.journey_state,
               full_json=excluded.full_json, last_updated=excluded.last_updated""",
            (hcp.hcp_id, hcp.name, hcp.specialty, hcp.institution, hcp.territory,
             hcp.npi, hcp.journey_state.value, json.dumps(d),
             hcp.created_at.isoformat(), hcp.last_updated.isoformat()),
        )
        self.conn.commit()

    def get_hcp(self, hcp_id: str) -> Optional[HCPOpportunityObject]:
        row = self.conn.execute("SELECT full_json FROM hcps WHERE hcp_id = ?", (hcp_id,)).fetchone()
        if not row:
            return None
        return self._json_to_hcp(row["full_json"])

    def get_all_hcps(self) -> list[HCPOpportunityObject]:
        rows = self.conn.execute("SELECT full_json FROM hcps ORDER BY last_updated DESC").fetchall()
        return [self._json_to_hcp(r["full_json"]) for r in rows]

    def get_hcps_by_state(self, state: HCPJourneyState) -> list[HCPOpportunityObject]:
        rows = self.conn.execute("SELECT full_json FROM hcps WHERE journey_state = ?", (state.value,)).fetchall()
        return [self._json_to_hcp(r["full_json"]) for r in rows]

    def delete_hcp(self, hcp_id: str) -> None:
        self.conn.execute("DELETE FROM hcps WHERE hcp_id = ?", (hcp_id,))
        self.conn.commit()

    # --- HCP Interactions ---

    def save_interaction(self, interaction: HCPInteraction) -> None:
        self.conn.execute(
            """INSERT INTO hcp_interactions (interaction_id, hcp_id, employee_id, channel,
               timestamp, topic, question_raised, objection_raised, evidence_delivered,
               approved_asset_used, outcome, next_action, is_compliant)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (interaction.interaction_id, interaction.hcp_id, interaction.employee_id,
             interaction.channel.value, interaction.timestamp, interaction.topic,
             interaction.question_raised, interaction.objection_raised,
             interaction.evidence_delivered, interaction.approved_asset_used,
             interaction.outcome, interaction.next_action, int(interaction.is_compliant)),
        )
        self.conn.commit()

    def get_interactions_for_hcp(self, hcp_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM hcp_interactions WHERE hcp_id = ? ORDER BY timestamp DESC", (hcp_id,)).fetchall()
        return [dict(r) for r in rows]

    def get_interactions_for_employee(self, employee_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM hcp_interactions WHERE employee_id = ? ORDER BY timestamp DESC", (employee_id,)).fetchall()
        return [dict(r) for r in rows]

    # --- Engagement Opportunities ---

    def upsert_opportunity(self, opp: EngagementOpportunity) -> None:
        d = opp.to_dict()
        self.conn.execute(
            """INSERT INTO engagement_opportunities (opportunity_id, originating_employee,
               frontier_id, barrier, intervention, approved_assets, sequence,
               initial_cohort_size, initial_success_rate, addressable_hcps,
               addressable_accounts, estimated_value, proposed_experiment,
               experiment_status, validation_cohort_size, validation_success_rate,
               participants, attribution_retained, derivative_opportunities,
               created_at, full_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(opportunity_id) DO UPDATE SET
               experiment_status=excluded.experiment_status,
               validation_cohort_size=excluded.validation_cohort_size,
               validation_success_rate=excluded.validation_success_rate,
               estimated_value=excluded.estimated_value,
               participants=excluded.participants,
               derivative_opportunities=excluded.derivative_opportunities,
               full_json=excluded.full_json""",
            (opp.opportunity_id, opp.originating_employee, opp.frontier_id,
             opp.barrier, opp.intervention, json.dumps(opp.approved_assets),
             opp.sequence, opp.initial_cohort_size, opp.initial_success_rate,
             opp.addressable_hcps, opp.addressable_accounts, opp.estimated_value,
             opp.proposed_experiment, opp.experiment_status,
             opp.validation_cohort_size, opp.validation_success_rate,
             json.dumps(opp.participants), int(opp.attribution_retained),
             json.dumps(opp.derivative_opportunities),
             opp.created_at.isoformat(), json.dumps(d)),
        )
        self.conn.commit()

    def get_opportunity(self, opp_id: str) -> Optional[EngagementOpportunity]:
        row = self.conn.execute("SELECT full_json FROM engagement_opportunities WHERE opportunity_id = ?", (opp_id,)).fetchone()
        if not row:
            return None
        return self._json_to_opportunity(row["full_json"])

    def get_all_opportunities(self) -> list[EngagementOpportunity]:
        rows = self.conn.execute("SELECT full_json FROM engagement_opportunities ORDER BY created_at DESC").fetchall()
        return [self._json_to_opportunity(r["full_json"]) for r in rows]

    # --- Employee Career ---

    def upsert_career(self, employee_id: str, name: str, role: str, territory: str,
                      manager: str, career_dict: dict[str, Any]) -> None:
        self.conn.execute(
            """INSERT INTO employee_career (employee_id, name, role, territory, manager,
               promotion_probability, automation_risk, manager_perception,
               visibility_deficit, network_centrality, revenue_contribution,
               innovation_contribution, cross_functional_influence, monster_metric,
               direct_value, derivative_value, hcps_covered, hcps_engaged,
               hcps_converted, engagement_quality, active_opportunities,
               recommended_actions, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(employee_id) DO UPDATE SET
               promotion_probability=excluded.promotion_probability,
               automation_risk=excluded.automation_risk,
               manager_perception=excluded.manager_perception,
               visibility_deficit=excluded.visibility_deficit,
               network_centrality=excluded.network_centrality,
               revenue_contribution=excluded.revenue_contribution,
               innovation_contribution=excluded.innovation_contribution,
               cross_functional_influence=excluded.cross_functional_influence,
               monster_metric=excluded.monster_metric,
               direct_value=excluded.direct_value,
               derivative_value=excluded.derivative_value,
               hcps_covered=excluded.hcps_covered,
               hcps_engaged=excluded.hcps_engaged,
               hcps_converted=excluded.hcps_converted,
               engagement_quality=excluded.engagement_quality,
               active_opportunities=excluded.active_opportunities,
               recommended_actions=excluded.recommended_actions,
               updated_at=excluded.updated_at""",
            (employee_id, name, role, territory, manager,
             career_dict.get("promotion_probability", 0),
             career_dict.get("automation_risk", 0),
             career_dict.get("manager_perception", 0.5),
             career_dict.get("visibility_deficit", 0.5),
             career_dict.get("network_centrality", 0),
             career_dict.get("revenue_contribution", 0),
             career_dict.get("innovation_contribution", 0),
             career_dict.get("cross_functional_influence", 0),
             career_dict.get("monster_metric", 0),
             career_dict.get("direct_value", 0),
             career_dict.get("derivative_value", 0),
             career_dict.get("hcps_covered", 0),
             career_dict.get("hcps_engaged", 0),
             career_dict.get("hcps_converted", 0),
             career_dict.get("engagement_quality", 0),
             json.dumps(career_dict.get("active_opportunities", [])),
             json.dumps(career_dict.get("recommended_actions", [])),
             datetime.now(timezone.utc).isoformat()),
        )
        self.conn.commit()

    def get_career(self, employee_id: str) -> Optional[dict[str, Any]]:
        row = self.conn.execute("SELECT * FROM employee_career WHERE employee_id = ?", (employee_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["active_opportunities"] = json.loads(d.get("active_opportunities", "[]"))
        d["recommended_actions"] = json.loads(d.get("recommended_actions", "[]"))
        return d

    def get_all_careers(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM employee_career ORDER BY monster_metric DESC").fetchall()
        results = []
        for row in rows:
            d = dict(row)
            d["active_opportunities"] = json.loads(d.get("active_opportunities", "[]"))
            d["recommended_actions"] = json.loads(d.get("recommended_actions", "[]"))
            results.append(d)
        return results

    # --- Ancestry Graph ---

    def save_ancestry_node(self, node_id: str, node_type: str, label: str, value: float, metadata: dict) -> None:
        self.conn.execute(
            """INSERT OR REPLACE INTO ancestry_nodes (node_id, node_type, label, value, metadata)
               VALUES (?, ?, ?, ?, ?)""",
            (node_id, node_type, label, value, json.dumps(metadata)),
        )
        self.conn.commit()

    def save_ancestry_edge(self, source: str, target: str, edge_type: str, weight: float, alpha: float) -> None:
        self.conn.execute(
            """INSERT OR REPLACE INTO ancestry_edges (source, target, edge_type, weight, alpha)
               VALUES (?, ?, ?, ?, ?)""",
            (source, target, edge_type, weight, alpha),
        )
        self.conn.commit()

    def load_ancestry_nodes(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM ancestry_nodes").fetchall()
        return [{"node_id": r["node_id"], "node_type": r["node_type"], "label": r["label"],
                 "value": r["value"], "metadata": json.loads(r["metadata"])} for r in rows]

    def load_ancestry_edges(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM ancestry_edges").fetchall()
        return [{"source": r["source"], "target": r["target"], "edge_type": r["edge_type"],
                 "weight": r["weight"], "alpha": r["alpha"]} for r in rows]

    # --- Email Tasks (Task Completion) ---

    def upsert_email_task(self, task: EmailTask) -> None:
        d = task.to_dict()
        self.conn.execute(
            """INSERT INTO email_tasks (task_id, hcp_id, employee_id, task_type, status,
               objective, completion_criteria, verification_method, barrier, question,
               objection, evidence_path, approved_assets, from_journey_state,
               to_journey_state, channel_sequence, emails_sent, emails_opened,
               links_clicked, replies_received, interactions_triggered, barrier_resolved,
               question_answered, journey_advanced, completion_timestamp,
               pattern_canonicalized, derivative_created, capability_magnified,
               interaction_ids, created_at, last_updated, full_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(task_id) DO UPDATE SET
               status=excluded.status, emails_sent=excluded.emails_sent,
               emails_opened=excluded.emails_opened, links_clicked=excluded.links_clicked,
               replies_received=excluded.replies_received,
               interactions_triggered=excluded.interactions_triggered,
               barrier_resolved=excluded.barrier_resolved,
               question_answered=excluded.question_answered,
               journey_advanced=excluded.journey_advanced,
               completion_timestamp=excluded.completion_timestamp,
               pattern_canonicalized=excluded.pattern_canonicalized,
               derivative_created=excluded.derivative_created,
               capability_magnified=excluded.capability_magnified,
               interaction_ids=excluded.interaction_ids,
               last_updated=excluded.last_updated,
               full_json=excluded.full_json""",
            (task.task_id, task.hcp_id, task.employee_id, task.task_type.value,
             task.status.value, task.objective, task.completion_criteria,
             task.verification_method, task.barrier, task.question, task.objection,
             json.dumps(task.evidence_path or {}), json.dumps(task.approved_assets),
             task.from_journey_state, task.to_journey_state,
             json.dumps(task.channel_sequence), task.emails_sent, task.emails_opened,
             task.links_clicked, task.replies_received, task.interactions_triggered,
             int(task.barrier_resolved), int(task.question_answered),
             int(task.journey_advanced), task.completion_timestamp,
             int(task.pattern_canonicalized), int(task.derivative_created),
             int(task.capability_magnified), json.dumps(task.interaction_ids),
             task.created_at.isoformat(), task.last_updated.isoformat(),
             json.dumps(d)),
        )
        self.conn.commit()

    def get_email_task(self, task_id: str) -> Optional[EmailTask]:
        row = self.conn.execute("SELECT full_json FROM email_tasks WHERE task_id = ?", (task_id,)).fetchone()
        if not row:
            return None
        return self._json_to_email_task(row["full_json"])

    def get_all_email_tasks(self) -> list[EmailTask]:
        rows = self.conn.execute("SELECT full_json FROM email_tasks ORDER BY created_at DESC").fetchall()
        return [self._json_to_email_task(r["full_json"]) for r in rows]

    def get_email_tasks_for_employee(self, employee_id: str) -> list[EmailTask]:
        rows = self.conn.execute("SELECT full_json FROM email_tasks WHERE employee_id = ? ORDER BY created_at DESC", (employee_id,)).fetchall()
        return [self._json_to_email_task(r["full_json"]) for r in rows]

    def get_email_tasks_for_hcp(self, hcp_id: str) -> list[EmailTask]:
        rows = self.conn.execute("SELECT full_json FROM email_tasks WHERE hcp_id = ? ORDER BY created_at DESC", (hcp_id,)).fetchall()
        return [self._json_to_email_task(r["full_json"]) for r in rows]

    # --- MailOS Persistence ---

    def upsert_mail(self, mail: MailObject) -> None:
        d = mail.to_dict()
        self.conn.execute(
            """INSERT INTO mailos_mails (mail_id, from_address, from_name, from_type,
               to_addresses, cc_addresses, subject, body, timestamp, mailbox,
               thread_id, in_reply_to, matched_hcp_id, matched_employee_id,
               matched_account_id, decomposed, decomposed_object_ids, created_at, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(mail_id) DO UPDATE SET
               decomposed=excluded.decomposed,
               decomposed_object_ids=excluded.decomposed_object_ids,
               matched_hcp_id=excluded.matched_hcp_id,
               matched_employee_id=excluded.matched_employee_id,
               full_json=excluded.full_json""",
            (mail.mail_id, mail.from_address, mail.from_name, mail.from_type,
             json.dumps(mail.to_addresses), json.dumps(mail.cc_addresses),
             mail.subject, mail.body, mail.timestamp, mail.mailbox,
             mail.thread_id, mail.in_reply_to, mail.matched_hcp_id,
             mail.matched_employee_id, mail.matched_account_id,
             int(mail.decomposed), json.dumps(mail.decomposed_object_ids),
             mail.created_at.isoformat(), json.dumps(d)),
        )
        self.conn.commit()

    def get_mail(self, mail_id: str) -> Optional[MailObject]:
        row = self.conn.execute("SELECT full_json FROM mailos_mails WHERE mail_id = ?", (mail_id,)).fetchone()
        return self._json_to_mail(row["full_json"]) if row else None

    def get_all_mails(self) -> list[MailObject]:
        rows = self.conn.execute("SELECT full_json FROM mailos_mails ORDER BY created_at DESC").fetchall()
        return [self._json_to_mail(r["full_json"]) for r in rows]

    def upsert_decomposed_object(self, obj: DecomposedObject) -> None:
        d = obj.to_dict()
        self.conn.execute(
            """INSERT INTO mailos_objects (object_id, mail_id, object_type, priority,
               summary, detail, extracted_text, target_system, target_owner,
               routing_confidence, hcp_id, employee_id, account_id, product, topic,
               clinical_topic, obligation_id, created_at, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(object_id) DO UPDATE SET obligation_id=excluded.obligation_id, full_json=excluded.full_json""",
            (obj.object_id, obj.mail_id, obj.object_type.value, obj.priority.value,
             obj.summary, obj.detail, obj.extracted_text, obj.target_system.value,
             obj.target_owner, obj.routing_confidence, obj.hcp_id, obj.employee_id,
             obj.account_id, obj.product, obj.topic, obj.clinical_topic,
             obj.obligation_id, obj.created_at.isoformat(), json.dumps(d)),
        )
        self.conn.commit()

    def get_all_objects(self) -> list[DecomposedObject]:
        rows = self.conn.execute("SELECT full_json FROM mailos_objects ORDER BY created_at DESC").fetchall()
        return [self._json_to_decomposed_object(r["full_json"]) for r in rows]

    def upsert_obligation(self, obl: Obligation) -> None:
        d = obl.to_dict()
        self.conn.execute(
            """INSERT INTO mailos_obligations (obligation_id, object_id, mail_id,
               obligation_type, description, required_action, policy_reference,
               regulatory_context, deadline, deadline_hours, is_regulatory_deadline,
               assigned_owner, assigned_team, target_system, required_evidence,
               evidence_artifact, status, status_history, escalation_policy,
               escalated_to, verification_method, verified_by, verified_at,
               hcp_id, employee_id, created_at, closed_at, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(obligation_id) DO UPDATE SET
               status=excluded.status, assigned_owner=excluded.assigned_owner,
               evidence_artifact=excluded.evidence_artifact,
               verified_by=excluded.verified_by, verified_at=excluded.verified_at,
               closed_at=excluded.closed_at, status_history=excluded.status_history,
               full_json=excluded.full_json""",
            (obl.obligation_id, obl.object_id, obl.mail_id, obl.obligation_type,
             obl.description, obl.required_action, obl.policy_reference,
             obl.regulatory_context, obl.deadline, obl.deadline_hours,
             int(obl.is_regulatory_deadline), obl.assigned_owner, obl.assigned_team,
             obl.target_system.value, obl.required_evidence, obl.evidence_artifact,
             obl.status.value, json.dumps(obl.status_history), obl.escalation_policy,
             obl.escalated_to, obl.verification_method, obl.verified_by, obl.verified_at,
             obl.hcp_id, obl.employee_id, obl.created_at.isoformat(), obl.closed_at,
             json.dumps(d)),
        )
        self.conn.commit()

    def get_obligation(self, obligation_id: str) -> Optional[Obligation]:
        row = self.conn.execute("SELECT full_json FROM mailos_obligations WHERE obligation_id = ?", (obligation_id,)).fetchone()
        return self._json_to_obligation(row["full_json"]) if row else None

    def get_all_obligations(self) -> list[Obligation]:
        rows = self.conn.execute("SELECT full_json FROM mailos_obligations ORDER BY created_at DESC").fetchall()
        return [self._json_to_obligation(r["full_json"]) for r in rows]

    def upsert_commitment(self, c: Commitment) -> None:
        d = c.to_dict()
        self.conn.execute(
            """INSERT INTO mailos_commitments (commitment_id, mail_id, promisor,
               promisor_type, recipient, recipient_type, requested_action, deadline,
               regulatory_context, system_owner, linked_obligation_id, status,
               evidence, verified_at, hcp_id, employee_id, created_at, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(commitment_id) DO UPDATE SET status=excluded.status,
               evidence=excluded.evidence, verified_at=excluded.verified_at, full_json=excluded.full_json""",
            (c.commitment_id, c.mail_id, c.promisor, c.promisor_type, c.recipient,
             c.recipient_type, c.requested_action, c.deadline, c.regulatory_context,
             c.system_owner.value, c.linked_obligation_id, c.status.value,
             c.evidence, c.verified_at, c.hcp_id, c.employee_id,
             c.created_at.isoformat(), json.dumps(d)),
        )
        self.conn.commit()

    def get_all_commitments(self) -> list[Commitment]:
        rows = self.conn.execute("SELECT full_json FROM mailos_commitments ORDER BY created_at DESC").fetchall()
        return [self._json_to_commitment(r["full_json"]) for r in rows]

    def upsert_intent(self, intent: HCPIntent) -> None:
        d = intent.to_dict()
        self.conn.execute(
            """INSERT INTO mailos_intents (intent_id, mail_id, hcp_id, intent_type,
               confidence, summary, detail, extracted_text, relationship_impact,
               next_best_action, negative_action, linked_obligation_ids,
               linked_commitment_ids, created_at, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(intent_id) DO UPDATE SET full_json=excluded.full_json""",
            (intent.intent_id, intent.mail_id, intent.hcp_id, intent.intent_type.value,
             intent.confidence, intent.summary, intent.detail, intent.extracted_text,
             intent.relationship_impact, intent.next_best_action, intent.negative_action,
             json.dumps(intent.linked_obligation_ids), json.dumps(intent.linked_commitment_ids),
             intent.created_at.isoformat(), json.dumps(d)),
        )
        self.conn.commit()

    def get_all_intents(self) -> list[HCPIntent]:
        rows = self.conn.execute("SELECT full_json FROM mailos_intents ORDER BY created_at DESC").fetchall()
        return [self._json_to_intent(r["full_json"]) for r in rows]

    def upsert_negative_action(self, na: NegativeAction) -> None:
        d = na.to_dict()
        self.conn.execute(
            """INSERT INTO mailos_negative_actions (action_id, hcp_id, employee_id,
               action_type, reason, duration, expires_at, source_intent_id,
               source_obligation_id, created_at, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(action_id) DO UPDATE SET full_json=excluded.full_json""",
            (na.action_id, na.hcp_id, na.employee_id, na.action_type.value,
             na.reason, na.duration, na.expires_at, na.source_intent_id,
             na.source_obligation_id, na.created_at.isoformat(), json.dumps(d)),
        )
        self.conn.commit()

    def upsert_mail_event(self, ev: MailEvent) -> None:
        d = ev.to_dict()
        self.conn.execute(
            """INSERT INTO mailos_events (event_id, event_type, mail_id, timestamp,
               payload, target_systems, processed_by, created_at, full_json)
               VALUES (?,?,?,?,?,?,?,?,?)
               ON CONFLICT(event_id) DO UPDATE SET processed_by=excluded.processed_by, full_json=excluded.full_json""",
            (ev.event_id, ev.event_type.value, ev.mail_id, ev.timestamp,
             json.dumps(ev.payload), json.dumps(ev.target_systems),
             json.dumps(ev.processed_by), ev.created_at.isoformat(), json.dumps(d)),
        )
        self.conn.commit()

    def upsert_receipt(self, r: VerificationReceipt) -> None:
        d = r.to_dict()
        self.conn.execute(
            """INSERT INTO mailos_receipts (receipt_id, obligation_id,
               verification_method, evidence_artifact, evidence_link, verified_by,
               verified_at, independent_signal, independent_signal_source,
               is_verified, created_at, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(receipt_id) DO UPDATE SET full_json=excluded.full_json""",
            (r.receipt_id, r.obligation_id, r.verification_method,
             r.evidence_artifact, r.evidence_link, r.verified_by, r.verified_at,
             r.independent_signal, r.independent_signal_source, int(r.is_verified),
             r.created_at.isoformat(), json.dumps(d)),
        )
        self.conn.commit()

    def get_all_receipts(self) -> list[VerificationReceipt]:
        rows = self.conn.execute("SELECT full_json FROM mailos_receipts ORDER BY created_at DESC").fetchall()
        return [self._json_to_receipt(r["full_json"]) for r in rows]

    # --- LAIDER Converters ---

    @staticmethod
    def _json_to_hcp(j: str) -> HCPOpportunityObject:
        d = json.loads(j)
        hcp = HCPOpportunityObject(
            hcp_id=d["hcp_id"], name=d["name"], specialty=d["specialty"],
            institution=d["institution"], territory=d["territory"], npi=d["npi"],
            journey_state=HCPJourneyState(d["journey_state"]),
            context=d["context"], patient_panel_size=d["patient_panel_size"],
            therapeutic_areas=d["therapeutic_areas"], needs=d["needs"],
            barriers=d["barriers"], questions=d["questions"],
            interactions=d["interactions"], objection_history=d["objection_history"],
            evidence_history=d["evidence_history"],
            preferred_channel=HCPChannel(d["preferred_channel"]),
            best_time=d["best_time"], hcp_connections=d["hcp_connections"],
            kol_status=d["kol_status"], educator_status=d["educator_status"],
            approved_evidence_delivered=d["approved_evidence_delivered"],
            next_recommended_action=d["next_recommended_action"],
            next_action_rationale=d["next_action_rationale"],
            next_action_channel=HCPChannel(d["next_action_channel"]),
            engagement_score=d["engagement_score"],
            conversion_probability=d["conversion_probability"],
            addressable_value=d["addressable_value"],
            assigned_rep=d["assigned_rep"], assigned_msl=d["assigned_msl"],
            created_at=datetime.fromisoformat(d["created_at"]),
            last_updated=datetime.fromisoformat(d["last_updated"]),
        )
        return hcp

    @staticmethod
    def _json_to_opportunity(j: str) -> EngagementOpportunity:
        d = json.loads(j)
        return EngagementOpportunity(
            opportunity_id=d["opportunity_id"],
            created_at=datetime.fromisoformat(d["created_at"]),
            originating_employee=d["originating_employee"],
            frontier_id=d["frontier_id"],
            barrier=d["barrier"], intervention=d["intervention"],
            approved_assets=d["approved_assets"], sequence=d["sequence"],
            initial_cohort_size=d["initial_cohort_size"],
            initial_success_rate=d["initial_success_rate"],
            addressable_hcps=d["addressable_hcps"],
            addressable_accounts=d["addressable_accounts"],
            estimated_value=d["estimated_value"],
            proposed_experiment=d["proposed_experiment"],
            experiment_status=d["experiment_status"],
            validation_cohort_size=d["validation_cohort_size"],
            validation_success_rate=d["validation_success_rate"],
            participants=d["participants"],
            attribution_retained=d["attribution_retained"],
            derivative_opportunities=d["derivative_opportunities"],
        )

    @staticmethod
    def _json_to_email_task(j: str) -> EmailTask:
        d = json.loads(j)
        return EmailTask(
            task_id=d["task_id"], hcp_id=d["hcp_id"], employee_id=d["employee_id"],
            task_type=TaskType(d["task_type"]), status=TaskStatus(d["status"]),
            objective=d["objective"], completion_criteria=d["completion_criteria"],
            verification_method=d["verification_method"],
            barrier=d["barrier"], question=d["question"], objection=d["objection"],
            evidence_path=d.get("evidence_path"), approved_assets=d.get("approved_assets", []),
            from_journey_state=d.get("from_journey_state", ""),
            to_journey_state=d.get("to_journey_state", ""),
            channel_sequence=d.get("channel_sequence", []),
            emails_sent=d.get("emails_sent", 0), emails_opened=d.get("emails_opened", 0),
            links_clicked=d.get("links_clicked", 0),
            replies_received=d.get("replies_received", 0),
            interactions_triggered=d.get("interactions_triggered", 0),
            barrier_resolved=d.get("barrier_resolved", False),
            question_answered=d.get("question_answered", False),
            journey_advanced=d.get("journey_advanced", False),
            completion_timestamp=d.get("completion_timestamp"),
            pattern_canonicalized=d.get("pattern_canonicalized", False),
            derivative_created=d.get("derivative_created", False),
            capability_magnified=d.get("capability_magnified", False),
            interaction_ids=d.get("interaction_ids", []),
            created_at=datetime.fromisoformat(d["created_at"]),
            last_updated=datetime.fromisoformat(d["last_updated"]),
        )

    # --- MailOS Converters ---

    @staticmethod
    def _json_to_mail(j: str) -> MailObject:
        d = json.loads(j)
        return MailObject(
            mail_id=d["mail_id"], from_address=d.get("from_address", ""),
            from_name=d.get("from_name", ""), from_type=d.get("from_type", ""),
            to_addresses=d.get("to_addresses", []), cc_addresses=d.get("cc_addresses", []),
            subject=d.get("subject", ""), body=d.get("body", ""),
            timestamp=d.get("timestamp", ""), mailbox=d.get("mailbox", ""),
            thread_id=d.get("thread_id", ""), in_reply_to=d.get("in_reply_to", ""),
            matched_hcp_id=d.get("matched_hcp_id", ""),
            matched_employee_id=d.get("matched_employee_id", ""),
            matched_account_id=d.get("matched_account_id", ""),
            decomposed=d.get("decomposed", False),
            decomposed_object_ids=d.get("decomposed_object_ids", []),
            created_at=datetime.fromisoformat(d["created_at"]),
        )

    @staticmethod
    def _json_to_decomposed_object(j: str) -> DecomposedObject:
        d = json.loads(j)
        return DecomposedObject(
            object_id=d["object_id"], mail_id=d.get("mail_id", ""),
            object_type=ObjectType(d.get("object_type", "commercial_followup")),
            priority=ObjectPriority(d.get("priority", "medium")),
            summary=d.get("summary", ""), detail=d.get("detail", ""),
            extracted_text=d.get("extracted_text", ""),
            target_system=SystemOfRecord(d.get("target_system", "crm")),
            target_owner=d.get("target_owner", ""),
            routing_confidence=d.get("routing_confidence", 0.0),
            hcp_id=d.get("hcp_id", ""), employee_id=d.get("employee_id", ""),
            account_id=d.get("account_id", ""), product=d.get("product", ""),
            topic=d.get("topic", ""), clinical_topic=d.get("clinical_topic", ""),
            obligation_id=d.get("obligation_id", ""),
            created_at=datetime.fromisoformat(d["created_at"]),
        )

    @staticmethod
    def _json_to_obligation(j: str) -> Obligation:
        d = json.loads(j)
        return Obligation(
            obligation_id=d["obligation_id"], object_id=d.get("object_id", ""),
            mail_id=d.get("mail_id", ""), obligation_type=d.get("obligation_type", ""),
            description=d.get("description", ""), required_action=d.get("required_action", ""),
            policy_reference=d.get("policy_reference", ""),
            regulatory_context=d.get("regulatory_context", ""),
            deadline=d.get("deadline", ""), deadline_hours=d.get("deadline_hours", 0.0),
            is_regulatory_deadline=d.get("is_regulatory_deadline", False),
            assigned_owner=d.get("assigned_owner", ""),
            assigned_team=d.get("assigned_team", ""),
            target_system=SystemOfRecord(d.get("target_system", "crm")),
            required_evidence=d.get("required_evidence", ""),
            evidence_artifact=d.get("evidence_artifact", ""),
            status=ObligationStatus(d.get("status", "defined")),
            status_history=d.get("status_history", []),
            escalation_policy=d.get("escalation_policy", ""),
            escalated_to=d.get("escalated_to", ""),
            verification_method=d.get("verification_method", ""),
            verified_by=d.get("verified_by", ""), verified_at=d.get("verified_at", ""),
            hcp_id=d.get("hcp_id", ""), employee_id=d.get("employee_id", ""),
            created_at=datetime.fromisoformat(d["created_at"]),
            closed_at=d.get("closed_at"),
        )

    @staticmethod
    def _json_to_commitment(j: str) -> Commitment:
        d = json.loads(j)
        from rxreserve.mailos import CommitmentStatus
        return Commitment(
            commitment_id=d["commitment_id"], mail_id=d.get("mail_id", ""),
            promisor=d.get("promisor", ""), promisor_type=d.get("promisor_type", ""),
            recipient=d.get("recipient", ""), recipient_type=d.get("recipient_type", ""),
            requested_action=d.get("requested_action", ""),
            deadline=d.get("deadline", ""), regulatory_context=d.get("regulatory_context", ""),
            system_owner=SystemOfRecord(d.get("system_owner", "crm")),
            linked_obligation_id=d.get("linked_obligation_id", ""),
            status=CommitmentStatus(d.get("status", "promised")),
            evidence=d.get("evidence", ""), verified_at=d.get("verified_at", ""),
            hcp_id=d.get("hcp_id", ""), employee_id=d.get("employee_id", ""),
            created_at=datetime.fromisoformat(d["created_at"]),
        )

    @staticmethod
    def _json_to_intent(j: str) -> HCPIntent:
        d = json.loads(j)
        from rxreserve.mailos import HCPIntentType
        return HCPIntent(
            intent_id=d["intent_id"], mail_id=d.get("mail_id", ""),
            hcp_id=d.get("hcp_id", ""),
            intent_type=HCPIntentType(d.get("intent_type", "treatment_question")),
            confidence=d.get("confidence", 0.0),
            summary=d.get("summary", ""), detail=d.get("detail", ""),
            extracted_text=d.get("extracted_text", ""),
            relationship_impact=d.get("relationship_impact", ""),
            next_best_action=d.get("next_best_action", ""),
            negative_action=d.get("negative_action", ""),
            linked_obligation_ids=d.get("linked_obligation_ids", []),
            linked_commitment_ids=d.get("linked_commitment_ids", []),
            created_at=datetime.fromisoformat(d["created_at"]),
        )

    @staticmethod
    def _json_to_receipt(j: str) -> VerificationReceipt:
        d = json.loads(j)
        return VerificationReceipt(
            receipt_id=d["receipt_id"], obligation_id=d.get("obligation_id", ""),
            verification_method=d.get("verification_method", ""),
            evidence_artifact=d.get("evidence_artifact", ""),
            evidence_link=d.get("evidence_link", ""),
            verified_by=d.get("verified_by", ""), verified_at=d.get("verified_at", ""),
            independent_signal=d.get("independent_signal", ""),
            independent_signal_source=d.get("independent_signal_source", ""),
            is_verified=d.get("is_verified", False),
            created_at=datetime.fromisoformat(d["created_at"]),
        )

    # --- Design Genome Runtime ---

    def upsert_genome_source(self, source) -> None:
        d = source.to_dict()
        self.conn.execute(
            """INSERT INTO genome_sources (source_id, url, creator, date_discovered,
               date_published, category, license_state, asset_classification,
               robots_allowed, access_policy_checked, rate_limit_respected,
               attribution, provenance_chain, source_hash, is_duplicate,
               personal_info_removed, expired, metadata, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(source_id) DO UPDATE SET full_json=excluded.full_json""",
            (source.source_id, source.url, source.creator, source.date_discovered,
             source.date_published, source.category.value, source.license_state.value,
             source.asset_classification.value, int(source.robots_allowed),
             int(source.access_policy_checked), int(source.rate_limit_respected),
             source.attribution, json.dumps(source.provenance_chain), source.source_hash,
             int(source.is_duplicate), int(source.personal_info_removed),
             int(source.expired), json.dumps(source.metadata), json.dumps(d)),
        )
        self.conn.commit()

    def upsert_genome_observation(self, obs) -> None:
        d = obs.to_dict()
        self.conn.execute(
            """INSERT INTO genome_observations (observation_id, source_id, url,
               capture_date, screenshot_desktop, screenshot_tablet, screenshot_mobile,
               interaction_trace, page_hierarchy, interaction_graph, layout_geometry,
               typography_ratios, spacing_rhythm, color_relationships,
               density_info_hierarchy, navigation_model, motion_transitions,
               component_topology, brand_personality, unusual_design_decisions,
               usability_problems, performance_score, accessibility_score,
               commercial_effectiveness, trend_velocity, novelty_score, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(observation_id) DO UPDATE SET full_json=excluded.full_json""",
            (obs.observation_id, obs.source_id, obs.url, obs.capture_date,
             d.get("screenshot_desktop", ""), d.get("screenshot_tablet", ""),
             d.get("screenshot_mobile", ""),
             json.dumps(obs.interaction_trace.to_dict()) if obs.interaction_trace else None,
             json.dumps(obs.page_hierarchy), json.dumps(obs.interaction_graph),
             json.dumps(obs.layout_geometry), json.dumps(obs.typography_ratios),
             json.dumps(obs.spacing_rhythm), json.dumps(obs.color_relationships),
             json.dumps(obs.density_info_hierarchy), obs.navigation_model,
             json.dumps(obs.motion_transitions), json.dumps(obs.component_topology),
             obs.brand_personality, json.dumps(obs.unusual_design_decisions),
             json.dumps(obs.usability_problems), obs.performance_score,
             obs.accessibility_score, obs.commercial_effectiveness,
             obs.trend_velocity, obs.novelty_score, json.dumps(d)),
        )
        self.conn.commit()

    def upsert_genome_gene(self, gene) -> None:
        d = gene.to_dict()
        self.conn.execute(
            """INSERT INTO genome_genes (gene_id, gene_type, description,
               source_observation_id, principle, preserve_attributes,
               transform_attributes, product_categories, audience_types,
               mood_tags, interaction_purposes, novelty_score, quality_score,
               saturation_score, trend_velocity, transfer_attempts,
               successful_transfers, confidence, created_at, retired,
               retired_reason, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(gene_id) DO UPDATE SET
               saturation_score=excluded.saturation_score,
               trend_velocity=excluded.trend_velocity,
               transfer_attempts=excluded.transfer_attempts,
               successful_transfers=excluded.successful_transfers,
               confidence=excluded.confidence, retired=excluded.retired,
               retired_reason=excluded.retired_reason, full_json=excluded.full_json""",
            (gene.gene_id, gene.gene_type.value, gene.description,
             gene.source_observation_id, gene.principle,
             json.dumps(gene.preserve_attributes), json.dumps(gene.transform_attributes),
             json.dumps(gene.product_categories), json.dumps(gene.audience_types),
             json.dumps(gene.mood_tags), json.dumps(gene.interaction_purposes),
             gene.novelty_score, gene.quality_score, gene.saturation_score,
             gene.trend_velocity, gene.transfer_attempts, gene.successful_transfers,
             gene.confidence, gene.created_at, int(gene.retired),
             gene.retired_reason, json.dumps(d)),
        )
        self.conn.commit()

    def upsert_genome_implementation(self, impl) -> None:
        d = impl.to_dict()
        self.conn.execute(
            """INSERT INTO genome_implementations (impl_id, project_id,
               distinction_contract_id, renderer_type, architecture_hypothesis,
               is_prototype, parent_id, generation, mutation_type,
               mutation_description, status, best_render_id, best_quality,
               render_history, source_code, created_at, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(impl_id) DO UPDATE SET
               status=excluded.status, best_render_id=excluded.best_render_id,
               best_quality=excluded.best_quality,
               render_history=excluded.render_history, full_json=excluded.full_json""",
            (impl.impl_id, impl.project_id, impl.distinction_contract_id,
             impl.renderer_type.value, impl.architecture_hypothesis,
             int(impl.is_prototype), impl.parent_id, impl.generation,
             impl.mutation_type, impl.mutation_description, impl.status.value,
             impl.best_render_id, impl.best_quality,
             json.dumps(impl.render_history), impl.source_code,
             impl.created_at, json.dumps(d)),
        )
        self.conn.commit()

    def upsert_genome_render(self, render) -> None:
        d = render.to_dict()
        self.conn.execute(
            """INSERT INTO genome_renders (render_id, implementation_id, iteration,
               desktop_frame_count, mobile_frame_count, interaction_trace,
               performance_trace, renderer_type, quality_json,
               delta_vs_previous, delta_vs_reference, delta_vs_frontier,
               accepted, rejected_reason, created_at, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(render_id) DO UPDATE SET full_json=excluded.full_json""",
            (render.render_id, render.implementation_id, render.iteration,
             len(render.desktop_frames), len(render.mobile_frames),
             json.dumps(render.interaction_trace.to_dict()) if render.interaction_trace else None,
             json.dumps(render.performance_trace), render.renderer_type.value,
             json.dumps(render.quality.to_dict()),
             render.delta_vs_previous, render.delta_vs_reference,
             render.delta_vs_frontier, int(render.accepted),
             render.rejected_reason, render.created_at, json.dumps(d)),
        )
        self.conn.commit()

    def upsert_genome_capability(self, cap) -> None:
        d = cap.to_dict()
        self.conn.execute(
            """INSERT INTO genome_capabilities (capability_id, name, recognition,
               execution, validation, transfer_products, transfer_success_count,
               confidence, source_observation_id, source_gene_ids,
               verified_impl_id, status, depth_reproduced, motion_reproduced,
               mobile_preserved, accessibility_maintained, performance_budget_met,
               transfers_to_other_products, survives_human_comparison,
               created_at, verified_at, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(capability_id) DO UPDATE SET
               status=excluded.status, confidence=excluded.confidence,
               verified_at=excluded.verified_at, full_json=excluded.full_json""",
            (cap.capability_id, cap.name, cap.recognition, cap.execution,
             cap.validation, json.dumps(cap.transfer_products),
             cap.transfer_success_count, cap.confidence,
             cap.source_observation_id, json.dumps(cap.source_gene_ids),
             cap.verified_impl_id, cap.status.value,
             int(cap.depth_reproduced), int(cap.motion_reproduced),
             int(cap.mobile_preserved), int(cap.accessibility_maintained),
             int(cap.performance_budget_met), int(cap.transfers_to_other_products),
             int(cap.survives_human_comparison), cap.created_at, cap.verified_at,
             json.dumps(d)),
        )
        self.conn.commit()

    def upsert_genome_contract(self, contract) -> None:
        d = contract.to_dict()
        self.conn.execute(
            """INSERT INTO genome_contracts (contract_id, project_name, project_brief,
               required_emotions, spatial_signature, interaction_primitive,
               forbidden_cliche, typography_doctrine, motion_doctrine, density_rule,
               unique_feature, distinction_verified, distinction_score,
               created_at, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(contract_id) DO UPDATE SET
               distinction_verified=excluded.distinction_verified,
               distinction_score=excluded.distinction_score, full_json=excluded.full_json""",
            (contract.contract_id, contract.project_name, contract.project_brief,
             json.dumps(contract.required_emotions), contract.spatial_signature,
             contract.interaction_primitive, contract.forbidden_cliche,
             contract.typography_doctrine, contract.motion_doctrine,
             contract.density_rule, contract.unique_feature,
             int(contract.distinction_verified), contract.distinction_score,
             contract.created_at, json.dumps(d)),
        )
        self.conn.commit()

    def upsert_genome_project(self, project) -> None:
        d = project.to_dict()
        self.conn.execute(
            """INSERT INTO genome_projects (archetype_id, project_name,
               product_category, audience, mood, interaction_purpose,
               active_gene_ids, distinction_contract_id, best_impl_id,
               best_quality_score, experience_hypotheses, created_at, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(archetype_id) DO UPDATE SET
               active_gene_ids=excluded.active_gene_ids,
               best_impl_id=excluded.best_impl_id,
               best_quality_score=excluded.best_quality_score,
               experience_hypotheses=excluded.experience_hypotheses,
               full_json=excluded.full_json""",
            (project.archetype_id, project.project_name, project.product_category,
             project.audience, project.mood, project.interaction_purpose,
             json.dumps(project.active_gene_ids), project.distinction_contract_id,
             project.best_impl_id, project.best_quality_score,
             json.dumps(project.experience_hypotheses), project.created_at,
             json.dumps(d)),
        )
        self.conn.commit()

    def upsert_genome_manifest(self, manifest) -> None:
        d = manifest.to_dict()
        self.conn.execute(
            """INSERT INTO genome_manifests (manifest_id, corpus_version,
               release_date, source_hashes, license_states, added_patterns,
               retired_patterns, trend_velocity, oversaturated_patterns,
               evaluation_model, quality_thresholds, generated_design_results,
               total_observations, total_genes, total_capabilities,
               total_verified_capabilities, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(manifest_id) DO UPDATE SET full_json=excluded.full_json""",
            (manifest.manifest_id, manifest.corpus_version, manifest.release_date,
             json.dumps(manifest.source_hashes), json.dumps(manifest.license_states),
             json.dumps(manifest.added_patterns), json.dumps(manifest.retired_patterns),
             manifest.trend_velocity, json.dumps(manifest.oversaturated_patterns),
             manifest.evaluation_model, json.dumps(manifest.quality_thresholds),
             json.dumps(manifest.generated_design_results),
             manifest.total_observations, manifest.total_genes,
             manifest.total_capabilities, manifest.total_verified_capabilities,
             json.dumps(d)),
        )
        self.conn.commit()

    def upsert_genome_preference(self, pref) -> None:
        d = pref.to_dict()
        self.conn.execute(
            """INSERT INTO genome_preferences (entry_id, project_id, design_decision,
               user_behavior, measured_outcome, outcome_metric, outcome_value,
               human_preference_score, context_tags, created_at, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(entry_id) DO UPDATE SET full_json=excluded.full_json""",
            (pref.entry_id, pref.project_id, pref.design_decision,
             pref.user_behavior, pref.measured_outcome, pref.outcome_metric,
             pref.outcome_value, pref.human_preference_score,
             json.dumps(pref.context_tags), pref.created_at, json.dumps(d)),
        )
        self.conn.commit()

    def upsert_genome_state(self, state) -> None:
        d = state.to_dict()
        self.conn.execute(
            """INSERT INTO genome_state (runtime_id, current_corpus_version,
               last_acquisition_run, last_corpus_release, observation_count,
               latent_value_count, attempt_count, verified_capability_count,
               failure_count, transfer_test_count,
               frontier_population_count, candidate_population_count,
               capability_population_count, failure_population_count,
               average_quality, quality_trend, oversaturated_patterns,
               retired_pattern_count, saturated_capability_count,
               active_project_count,
               total_acquisition_cycles, total_experiments,
               total_accepted_mutations, total_rejected_mutations,
               total_tournaments, total_transfer_tests, total_transfer_passes,
               full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(runtime_id) DO UPDATE SET full_json=excluded.full_json""",
            (state.runtime_id, state.current_corpus_version,
             state.last_acquisition_run, state.last_corpus_release,
             state.observation_count, state.latent_value_count,
             state.attempt_count, state.verified_capability_count,
             state.failure_count, state.transfer_test_count,
             state.frontier_population_count, state.candidate_population_count,
             state.capability_population_count, state.failure_population_count,
             state.average_quality, state.quality_trend,
             json.dumps(state.oversaturated_patterns),
             state.retired_pattern_count, state.saturated_capability_count,
             state.active_project_count,
             state.total_acquisition_cycles, state.total_experiments,
             state.total_accepted_mutations, state.total_rejected_mutations,
             state.total_tournaments, state.total_transfer_tests,
             state.total_transfer_passes,
             json.dumps(d)),
        )
        self.conn.commit()

    def upsert_genome_failure(self, failure) -> None:
        d = failure.to_dict()
        self.conn.execute(
            """INSERT INTO genome_failures (failure_id, capability_id, impl_id,
               attempted_approach, renderer_type, mutation_axis,
               failure_mode, failure_description, render_id, quality_score,
               quality_breakdown, lesson, avoid_pattern,
               generation, parent_impl_id, created_at, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(failure_id) DO UPDATE SET full_json=excluded.full_json""",
            (failure.failure_id, failure.capability_id, failure.impl_id,
             failure.attempted_approach, failure.renderer_type, failure.mutation_axis,
             failure.failure_mode, failure.failure_description,
             failure.render_id, failure.quality_score,
             json.dumps(failure.quality_breakdown),
             failure.lesson, failure.avoid_pattern,
             failure.generation, failure.parent_impl_id,
             failure.created_at, json.dumps(d)),
        )
        self.conn.commit()

    def upsert_genome_transfer_test(self, test) -> None:
        d = test.to_dict()
        self.conn.execute(
            """INSERT INTO genome_transfer_tests (test_id, capability_id,
               target_product_category, target_audience, target_mood,
               transfer_impl_id, transfer_render_id,
               quality_in_new_context, identity_preserved, depth_preserved,
               motion_preserved, accessibility_maintained,
               passed, failure_reason, created_at, full_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(test_id) DO UPDATE SET full_json=excluded.full_json""",
            (test.test_id, test.capability_id,
             test.target_product_category, test.target_audience, test.target_mood,
             test.transfer_impl_id, test.transfer_render_id,
             test.quality_in_new_context,
             int(test.identity_preserved), int(test.depth_preserved),
             int(test.motion_preserved), int(test.accessibility_maintained),
             int(test.passed), test.failure_reason,
             test.created_at, json.dumps(d)),
        )
        self.conn.commit()

    def get_genome_state(self, runtime_id: str) -> Optional[dict[str, Any]]:
        row = self.conn.execute("SELECT full_json FROM genome_state WHERE runtime_id = ?", (runtime_id,)).fetchone()
        return json.loads(row["full_json"]) if row else None

    def get_all_genome_observations(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT full_json FROM genome_observations ORDER BY capture_date DESC").fetchall()
        return [json.loads(r["full_json"]) for r in rows]

    def get_all_genome_genes(self, active_only: bool = False) -> list[dict[str, Any]]:
        if active_only:
            rows = self.conn.execute("SELECT full_json FROM genome_genes WHERE retired = 0 ORDER BY created_at DESC").fetchall()
        else:
            rows = self.conn.execute("SELECT full_json FROM genome_genes ORDER BY created_at DESC").fetchall()
        return [json.loads(r["full_json"]) for r in rows]

    def get_all_genome_capabilities(self, verified_only: bool = False) -> list[dict[str, Any]]:
        if verified_only:
            rows = self.conn.execute("SELECT full_json FROM genome_capabilities WHERE status IN ('verified', 'production') ORDER BY verified_at DESC").fetchall()
        else:
            rows = self.conn.execute("SELECT full_json FROM genome_capabilities ORDER BY created_at DESC").fetchall()
        return [json.loads(r["full_json"]) for r in rows]

    def get_all_genome_failures(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT full_json FROM genome_failures ORDER BY created_at DESC").fetchall()
        return [json.loads(r["full_json"]) for r in rows]

    def get_all_genome_transfer_tests(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT full_json FROM genome_transfer_tests ORDER BY created_at DESC").fetchall()
        return [json.loads(r["full_json"]) for r in rows]

    def get_all_genome_projects(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT full_json FROM genome_projects ORDER BY created_at DESC").fetchall()
        return [json.loads(r["full_json"]) for r in rows]

    def get_all_genome_manifests(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT full_json FROM genome_manifests ORDER BY release_date DESC").fetchall()
        return [json.loads(r["full_json"]) for r in rows]
