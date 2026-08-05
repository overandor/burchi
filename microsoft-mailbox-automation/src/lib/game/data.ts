/* ──────────────────────────────────────────────────────────────────
 * Advantage Foundry — Game Data Layer
 * Shared seed data for the SPINOR-RL game shell. All pages import from here.
 * ────────────────────────────────────────────────────────────────── */

export interface HypothesisMission {
  id: string;
  date: string;
  title: string;
  hypothesis: string;
  strategyId: string;
  strategyName: string;
  strategyClass: "experimental" | "personalized" | "proven";
  assignedTo: string;
  role: string;
  evidenceRequired: string[];
  evolutionaryPaths: EvolutionaryPath[];
  status: "active" | "completed" | "evolved";
  trialNumber: number;
  confidence: number;
  combo: string;
}

export interface EvolutionaryPath {
  id: string;
  name: string;
  description: string;
  mutationType: "recombination" | "parameter_shift" | "context_transfer" | "decomposition";
  feasibility: number;
  expectedLift: number;
  componentsRequired: string[];
}

export interface GoldenNode {
  id: string;
  name: string;
  lineage: string[];
  nodeScore: number;
  scoreBreakdown: NodeScoreBreakdown;
  contributionRoles: { role: string; contributor: string; weight: number }[];
  validatedAt: string;
  replicationCount: number;
  businessChannel: string;
  originHypothesis: string;
  derivatives: string[];
}

export interface NodeScoreBreakdown {
  causalLift: number;
  informationGain: number;
  mutationValue: number;
  replicationQuality: number;
  reusableSystemValue: number;
  complianceRisk: number;
  contamination: number;
  executionCost: number;
}

export interface ExperimentRecord {
  id: string;
  hypothesisId: string;
  hypothesisName: string;
  cohort: string;
  controlGroup: string;
  stoppingRule: string;
  evidenceCaptured: string[];
  status: "running" | "completed" | "stopped";
  startedAt: string;
  trialsCompleted: number;
  trialsPlanned: number;
}

export interface ResultRecord {
  id: string;
  experimentId: string;
  hypothesisName: string;
  lift: number;
  informationGain: number;
  attribution: number;
  confidence: number;
  promotionDecision: "promote" | "hold" | "decompose" | "replicate";
  measuredAt: string;
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  type: "hypothesis_born" | "mutation" | "experiment_started" | "result_recorded" | "golden_node_promoted" | "decomposed" | "replicated" | "channel_archived";
  hypothesisName: string;
  actor: string;
  detail: string;
  derivativeOf?: string;
}

export interface LeaderboardEntry {
  rank: number;
  comboName: string;
  human: string;
  llmConfig: string;
  hypothesis: string;
  nodeScore: number;
  scoreBreakdown: NodeScoreBreakdown;
  roles: string[];
  trials: number;
  successRate: number;
  evidenceLevel: string;
}

/* ── Node Score Formula ── */
export function computeNodeScore(b: NodeScoreBreakdown): number {
  return (
    b.causalLift +
    b.informationGain +
    b.mutationValue +
    b.replicationQuality +
    b.reusableSystemValue -
    b.complianceRisk -
    b.contamination -
    b.executionCost
  );
}

/* ── Seed Data ── */

export const todaysMission: HypothesisMission = {
  id: "mission-2026-08-05",
  date: "2026-08-05",
  title: "Territory Cluster Routing Optimization",
  hypothesis: "Grouping accounts into geographic clusters of 4-6 and routing field visits by cluster proximity reduces travel time by >30% while maintaining or improving accounts_visited_per_day.",
  strategyId: "strat-001",
  strategyName: "Territory Cluster Routing",
  strategyClass: "proven",
  assignedTo: "Field Rep A — Northern California",
  role: "field_representative",
  evidenceRequired: [
    "Before-after travel_time_pct (baseline: 45%)",
    "accounts_visited_per_day (baseline: 6)",
    "HCP engagement quality score per visit",
    "Fuel cost per visit (compliance-trackable)",
    "At least 10 trials across 2 weeks",
  ],
  evolutionaryPaths: [
    {
      id: "path-1",
      name: "Dynamic Re-clustering",
      description: "Recompute clusters weekly based on new account acquisitions and HCP availability patterns",
      mutationType: "parameter_shift",
      feasibility: 0.82,
      expectedLift: 0.12,
      componentsRequired: ["LLM route optimizer", "Account availability feed"],
    },
    {
      id: "path-2",
      name: "Cross-Territory Cluster Sharing",
      description: "Allow adjacent territories to share cluster boundaries for multi-rep coverage",
      mutationType: "context_transfer",
      feasibility: 0.55,
      expectedLift: 0.18,
      componentsRequired: ["Territory boundary manager", "Rep coordination protocol"],
    },
    {
      id: "path-3",
      name: "Decompose into Visit Sequencing + Cluster Formation",
      description: "Split the strategy: cluster formation becomes a planning tool, visit sequencing becomes an execution tool",
      mutationType: "decomposition",
      feasibility: 0.70,
      expectedLift: 0.08,
      componentsRequired: ["Cluster formation algorithm", "Visit sequencing optimizer"],
    },
  ],
  status: "active",
  trialNumber: 48,
  confidence: 0.91,
  combo: "LLM-route-opt × Human-local-knowledge × Algo-assign × Chance-explore",
};

export const goldenNodes: GoldenNode[] = [
  {
    id: "gn-001",
    name: "Territory Cluster Routing v3",
    lineage: ["Spore: Visit Batching", "Observed: Cluster Hypothesis", "Personalized: Geo-Cluster", "Proven: Territory Cluster Routing", "Golden: v3 with Dynamic Re-clustering"],
    nodeScore: 0,
    scoreBreakdown: {
      causalLift: 0.32,
      informationGain: 0.18,
      mutationValue: 0.14,
      replicationQuality: 0.22,
      reusableSystemValue: 0.20,
      complianceRisk: 0.02,
      contamination: 0.01,
      executionCost: 0.05,
    },
    contributionRoles: [
      { role: "originator", contributor: "LLM Router (gpt-oss)", weight: 0.15 },
      { role: "mutator", contributor: "Field Rep A", weight: 0.25 },
      { role: "executor", contributor: "Field Rep A + B", weight: 0.20 },
      { role: "validator", contributor: "Attribution Engine", weight: 0.15 },
      { role: "replicator", contributor: "Field Rep C (Southern CA)", weight: 0.10 },
      { role: "automator", contributor: "Assignment Engine", weight: 0.10 },
      { role: "channel_architect", contributor: "Regional Manager", weight: 0.05 },
    ],
    validatedAt: "2026-07-28",
    replicationCount: 4,
    businessChannel: "National Field Operations",
    originHypothesis: "Visit Batching reduces travel waste",
    derivatives: ["Dynamic Re-clustering", "Cross-Territory Sharing", "Visit Sequencing Optimizer"],
  },
  {
    id: "gn-002",
    name: "Stakeholder Influence Matrix v2",
    lineage: ["Spore: Relationship Mapping", "Observed: Influence Tracking", "Personalized: Stakeholder Matrix", "Proven: v2 with LLM Graph Analysis"],
    nodeScore: 0,
    scoreBreakdown: {
      causalLift: 0.26,
      informationGain: 0.22,
      mutationValue: 0.10,
      replicationQuality: 0.16,
      reusableSystemValue: 0.18,
      complianceRisk: 0.03,
      contamination: 0.02,
      executionCost: 0.04,
    },
    contributionRoles: [
      { role: "originator", contributor: "Regional Manager", weight: 0.20 },
      { role: "mutator", contributor: "LLM Router (graph analysis)", weight: 0.25 },
      { role: "executor", contributor: "Market Access Team", weight: 0.20 },
      { role: "validator", contributor: "Attribution Engine", weight: 0.15 },
      { role: "replicator", contributor: "Market Access Team B", weight: 0.10 },
      { role: "automator", contributor: "Evolution Engine", weight: 0.05 },
      { role: "channel_architect", contributor: "VP Strategy", weight: 0.05 },
    ],
    validatedAt: "2026-07-15",
    replicationCount: 3,
    businessChannel: "Market Access Strategy",
    originHypothesis: "Relationship mapping improves engagement",
    derivatives: ["Influence Scoring v3", "Stakeholder Network Visualization"],
  },
  {
    id: "gn-003",
    name: "Proactive Compliance Pre-Check",
    lineage: ["Spore: Pre-Submission Review", "Observed: Compliance Gate", "Personalized: Context-Aware Check", "Proven: Proactive Pre-Check"],
    nodeScore: 0,
    scoreBreakdown: {
      causalLift: 0.18,
      informationGain: 0.12,
      mutationValue: 0.08,
      replicationQuality: 0.28,
      reusableSystemValue: 0.25,
      complianceRisk: 0.01,
      contamination: 0.01,
      executionCost: 0.03,
    },
    contributionRoles: [
      { role: "originator", contributor: "Compliance Officer", weight: 0.30 },
      { role: "executor", contributor: "All Field Reps", weight: 0.25 },
      { role: "validator", contributor: "Attribution Engine", weight: 0.20 },
      { role: "replicator", contributor: "National Rollout", weight: 0.15 },
      { role: "automator", contributor: "Assignment Engine", weight: 0.10 },
    ],
    validatedAt: "2026-06-30",
    replicationCount: 8,
    businessChannel: "Compliance Operations",
    originHypothesis: "Pre-check reduces rework",
    derivatives: ["Automated Compliance Gate", "Context-Aware Policy Matching"],
  },
];

// Compute node scores
goldenNodes.forEach((n) => { n.nodeScore = computeNodeScore(n.scoreBreakdown); });

export const experiments: ExperimentRecord[] = [
  {
    id: "exp-001",
    hypothesisId: "strat-002",
    hypothesisName: "Stakeholder Influence Matrix",
    cohort: "Market Access Team A (8 reps)",
    controlGroup: "Market Access Team B (8 reps, no matrix)",
    stoppingRule: "Stop after 20 trials or if lift > 15% with p < 0.05",
    evidenceCaptured: ["HCP engagement scores", "Meeting conversion rate", "Time-to-decision", "Stakeholder map depth"],
    status: "running",
    startedAt: "2026-07-20",
    trialsCompleted: 14,
    trialsPlanned: 20,
  },
  {
    id: "exp-002",
    hypothesisId: "strat-007",
    hypothesisName: "Time-Block Discipline",
    cohort: "Field Rep A (solo, 2-week trial)",
    controlGroup: "Historical baseline (same rep, prior 2 weeks)",
    stoppingRule: "Stop after 10 trials or if efficiency drops below baseline for 3 consecutive days",
    evidenceCaptured: ["Deep work hours/day", "Interrupted task count", "Email response latency", "Self-reported focus quality"],
    status: "completed",
    startedAt: "2026-07-10",
    trialsCompleted: 10,
    trialsPlanned: 10,
  },
  {
    id: "exp-003",
    hypothesisId: "strat-008",
    hypothesisName: "Dynamic Resource Reallocation",
    cohort: "Regional Manager A (weekly reallocation)",
    controlGroup: "Regional Manager B (static allocation)",
    stoppingRule: "Stop after 8 trials or if budget variance exceeds 15%",
    evidenceCaptured: ["Budget utilization rate", "ROI per allocated dollar", "Opportunity cost estimate", "Reallocation decision latency"],
    status: "stopped",
    startedAt: "2026-07-05",
    trialsCompleted: 5,
    trialsPlanned: 8,
  },
];

export const results: ResultRecord[] = [
  {
    id: "res-001",
    experimentId: "exp-002",
    hypothesisName: "Time-Block Discipline",
    lift: 0.22,
    informationGain: 0.14,
    attribution: 0.68,
    confidence: 0.82,
    promotionDecision: "replicate",
    measuredAt: "2026-07-24",
  },
  {
    id: "res-002",
    experimentId: "exp-003",
    hypothesisName: "Dynamic Resource Reallocation",
    lift: -0.05,
    informationGain: 0.08,
    attribution: 0.31,
    confidence: 0.45,
    promotionDecision: "decompose",
    measuredAt: "2026-07-18",
  },
  {
    id: "res-003",
    experimentId: "exp-001",
    hypothesisName: "Stakeholder Influence Matrix",
    lift: 0.17,
    informationGain: 0.19,
    attribution: 0.74,
    confidence: 0.88,
    promotionDecision: "promote",
    measuredAt: "2026-08-01",
  },
];

export const historyEntries: HistoryEntry[] = [
  { id: "h-001", timestamp: "2026-06-15", type: "hypothesis_born", hypothesisName: "Visit Batching", actor: "LLM Router", detail: "Pattern detected in email data: 40% of field rep time spent in transit" },
  { id: "h-002", timestamp: "2026-06-18", type: "experiment_started", hypothesisName: "Visit Batching", actor: "Assignment Engine", detail: "Assigned to Field Rep A as exploration mission" },
  { id: "h-003", timestamp: "2026-06-25", type: "result_recorded", hypothesisName: "Visit Batching", actor: "Attribution Engine", detail: "travel_time_pct reduced from 45% to 32%, lift = 0.29" },
  { id: "h-004", timestamp: "2026-06-28", type: "mutation", hypothesisName: "Geo-Cluster Routing", actor: "Field Rep A", detail: "Mutated: batch by geographic proximity instead of account type", derivativeOf: "Visit Batching" },
  { id: "h-005", timestamp: "2026-07-02", type: "replicated", hypothesisName: "Geo-Cluster Routing", actor: "Field Rep C", detail: "Replicated in Southern California territory with 0.24 lift" },
  { id: "h-006", timestamp: "2026-07-15", type: "golden_node_promoted", hypothesisName: "Stakeholder Influence Matrix v2", actor: "VP Strategy", detail: "Promoted to Market Access Strategy channel after 3 replications" },
  { id: "h-007", timestamp: "2026-07-20", type: "experiment_started", hypothesisName: "Stakeholder Influence Matrix", actor: "Assignment Engine", detail: "Cohort experiment with control group launched" },
  { id: "h-008", timestamp: "2026-07-28", type: "golden_node_promoted", hypothesisName: "Territory Cluster Routing v3", actor: "Regional Manager", detail: "Promoted to National Field Operations after 4 replications, node score = 0.97" },
  { id: "h-009", timestamp: "2026-07-30", type: "decomposed", hypothesisName: "Visit Sequencing Optimizer", actor: "Evolution Engine", detail: "Decomposed from Territory Cluster Routing — sequencing component extracted as independent hypothesis", derivativeOf: "Territory Cluster Routing" },
  { id: "h-010", timestamp: "2026-08-01", type: "result_recorded", hypothesisName: "Stakeholder Influence Matrix", actor: "Attribution Engine", detail: "lift = 0.17, confidence = 0.88, promotion decision: PROMOTE" },
  { id: "h-011", timestamp: "2026-08-03", type: "channel_archived", hypothesisName: "Proactive Compliance Pre-Check", actor: "Compliance Operations", detail: "Archived as business channel after 8 replications across all territories" },
  { id: "h-012", timestamp: "2026-08-05", type: "hypothesis_born", hypothesisName: "Dynamic Re-clustering", actor: "Evolution Engine", detail: "New spore: recompute clusters weekly based on account availability patterns", derivativeOf: "Territory Cluster Routing v3" },
];

export const leaderboard: LeaderboardEntry[] = [
  {
    rank: 1,
    comboName: "LLM-route-opt × Human-local × Algo-assign",
    human: "Field Rep A",
    llmConfig: "gpt-oss:20b (route optimization)",
    hypothesis: "Territory Cluster Routing v3",
    nodeScore: 0,
    scoreBreakdown: { causalLift: 0.32, informationGain: 0.18, mutationValue: 0.14, replicationQuality: 0.22, reusableSystemValue: 0.20, complianceRisk: 0.02, contamination: 0.01, executionCost: 0.05 },
    roles: ["originator", "mutator", "executor", "validator", "replicator", "automator", "channel_architect"],
    trials: 47,
    successRate: 0.91,
    evidenceLevel: "experimentally_supported",
  },
  {
    rank: 2,
    comboName: "LLM-graph × Human-relationship × Algo-match",
    human: "Market Access Team A",
    llmConfig: "gpt-oss:20b (graph analysis)",
    hypothesis: "Stakeholder Influence Matrix v2",
    nodeScore: 0,
    scoreBreakdown: { causalLift: 0.26, informationGain: 0.22, mutationValue: 0.10, replicationQuality: 0.16, reusableSystemValue: 0.18, complianceRisk: 0.03, contamination: 0.02, executionCost: 0.04 },
    roles: ["originator", "mutator", "executor", "validator", "replicator", "channel_architect"],
    trials: 38,
    successRate: 0.85,
    evidenceLevel: "experimentally_supported",
  },
  {
    rank: 3,
    comboName: "LLM-policy × Human-judgment × Algo-gate",
    human: "Compliance Officer",
    llmConfig: "gpt-oss:20b (policy matching)",
    hypothesis: "Proactive Compliance Pre-Check",
    nodeScore: 0,
    scoreBreakdown: { causalLift: 0.18, informationGain: 0.12, mutationValue: 0.08, replicationQuality: 0.28, reusableSystemValue: 0.25, complianceRisk: 0.01, contamination: 0.01, executionCost: 0.03 },
    roles: ["originator", "executor", "validator", "replicator", "automator"],
    trials: 31,
    successRate: 0.95,
    evidenceLevel: "experimentally_supported",
  },
  {
    rank: 4,
    comboName: "LLM-summarize × Human-cadence × Algo-schedule",
    human: "Field Rep B",
    llmConfig: "gpt-oss:20b (summarization)",
    hypothesis: "Batched Communication Windows",
    nodeScore: 0,
    scoreBreakdown: { causalLift: 0.15, informationGain: 0.10, mutationValue: 0.06, replicationQuality: 0.12, reusableSystemValue: 0.14, complianceRisk: 0.01, contamination: 0.01, executionCost: 0.03 },
    roles: ["originator", "executor", "validator"],
    trials: 24,
    successRate: 0.78,
    evidenceLevel: "probable_contribution",
  },
  {
    rank: 5,
    comboName: "LLM-score × Human-territory × Algo-rank",
    human: "Regional Manager A",
    llmConfig: "gpt-oss:20b (scoring)",
    hypothesis: "Data-Driven Account Targeting",
    nodeScore: 0,
    scoreBreakdown: { causalLift: 0.12, informationGain: 0.14, mutationValue: 0.04, replicationQuality: 0.08, reusableSystemValue: 0.10, complianceRisk: 0.02, contamination: 0.01, executionCost: 0.04 },
    roles: ["originator", "executor", "validator"],
    trials: 19,
    successRate: 0.72,
    evidenceLevel: "probable_contribution",
  },
  {
    rank: 6,
    comboName: "LLM-agenda × Human-dynamics × Algo-cadence",
    human: "Cross-Functional Team",
    llmConfig: "gpt-oss:20b (agenda optimization)",
    hypothesis: "Cross-Functional Sync Cadence",
    nodeScore: 0,
    scoreBreakdown: { causalLift: 0.08, informationGain: 0.06, mutationValue: 0.03, replicationQuality: 0.06, reusableSystemValue: 0.08, complianceRisk: 0.01, contamination: 0.01, executionCost: 0.02 },
    roles: ["originator", "executor"],
    trials: 15,
    successRate: 0.68,
    evidenceLevel: "observed_association",
  },
  {
    rank: 7,
    comboName: "LLM-prioritize × Human-rhythm × Algo-block",
    human: "Field Rep A (solo)",
    llmConfig: "gpt-oss:20b (prioritization)",
    hypothesis: "Time-Block Discipline",
    nodeScore: 0,
    scoreBreakdown: { causalLift: 0.06, informationGain: 0.08, mutationValue: 0.02, replicationQuality: 0.04, reusableSystemValue: 0.05, complianceRisk: 0.0, contamination: 0.01, executionCost: 0.02 },
    roles: ["originator", "executor", "validator"],
    trials: 10,
    successRate: 0.64,
    evidenceLevel: "observed_association",
  },
  {
    rank: 8,
    comboName: "LLM-roi × Human-budget × Algo-reallocate",
    human: "Regional Manager A",
    llmConfig: "gpt-oss:20b (ROI prediction)",
    hypothesis: "Dynamic Resource Reallocation",
    nodeScore: 0,
    scoreBreakdown: { causalLift: -0.02, informationGain: 0.05, mutationValue: 0.01, replicationQuality: 0.02, reusableSystemValue: 0.03, complianceRisk: 0.03, contamination: 0.02, executionCost: 0.06 },
    roles: ["originator", "executor"],
    trials: 5,
    successRate: 0.55,
    evidenceLevel: "unresolved",
  },
];

leaderboard.forEach((e) => { e.nodeScore = computeNodeScore(e.scoreBreakdown); });

export const evidenceIntake = [
  { id: "ei-1", source: "Gmail — dr.gilead@mailbox.local", type: "commitment", summary: "HCP meeting scheduled for Thursday — requires pre-visit brief", timestamp: "2026-08-05T09:12:00Z", processed: true },
  { id: "ei-2", source: "Gmail — dr.gilead@mailbox.local", type: "signal", summary: "Regional manager requests Q3 territory realignment proposal", timestamp: "2026-08-05T08:45:00Z", processed: true },
  { id: "ei-3", source: "Gmail — dr.gilead@mailbox.local", type: "behavioral", summary: "Pattern: 40% of emails involve scheduling — candidate for batched comms", timestamp: "2026-08-05T08:30:00Z", processed: true },
  { id: "ei-4", source: "Gmail — dr.gilead@mailbox.local", type: "commitment", summary: "Compliance review needed before Friday field visit", timestamp: "2026-08-04T16:20:00Z", processed: true },
  { id: "ei-5", source: "Gmail — dr.gilead@mailbox.local", type: "attachment", summary: "Q2 territory performance spreadsheet — extractable data points", timestamp: "2026-08-04T14:05:00Z", processed: false },
  { id: "ei-6", source: "Microsoft 365 — connected", type: "signal", summary: "Stakeholder email chain reveals decision-maker shift at Account #47", timestamp: "2026-08-04T11:15:00Z", processed: true },
];

export const foundryData = {
  priorArt: [
    { id: "pa-1", name: "Territory Routing (legacy)", source: "Historical — 2024 field ops", relevance: 0.85, description: "Static territory assignments with manual route planning. Travel time: 45%." },
    { id: "pa-2", name: "Stakeholder Mapping (academic)", source: "Published research — 2023", relevance: 0.72, description: "Graph-theoretic approach to influence mapping in B2B sales." },
    { id: "pa-3", name: "Compliance Gate (regulatory)", source: "FDA guidance — 2022", relevance: 0.90, description: "Pre-submission compliance review reduces rework by 30%." },
    { id: "pa-4", name: "Time Blocking (productivity)", source: "Cal Newport — Deep Work", relevance: 0.45, description: "Academic time management framework. Not field-tested in pharma." },
  ],
  noveltyChecks: [
    { id: "nc-1", hypothesis: "Dynamic Re-clustering", closestPrior: "Territory Routing (legacy)", noveltyDelta: "Weekly recompute vs static assignment", noveltyScore: 0.78 },
    { id: "nc-2", hypothesis: "Cross-Territory Sharing", closestPrior: "Territory Routing (legacy)", noveltyDelta: "Shared boundaries vs exclusive territories", noveltyScore: 0.65 },
    { id: "nc-3", hypothesis: "Influence Scoring v3", closestPrior: "Stakeholder Mapping (academic)", noveltyDelta: "LLM-extracted vs survey-based", noveltyScore: 0.82 },
  ],
  variations: [
    { id: "v-1", name: "Cluster size = 3-4", parent: "Territory Cluster Routing", parameter: "cluster_size", value: "3-4", trials: 5, lift: 0.18, status: "tested" },
    { id: "v-2", name: "Cluster size = 4-6", parent: "Territory Cluster Routing", parameter: "cluster_size", value: "4-6", trials: 12, lift: 0.32, status: "validated" },
    { id: "v-3", name: "Cluster size = 7-10", parent: "Territory Cluster Routing", parameter: "cluster_size", value: "7-10", trials: 3, lift: 0.05, status: "rejected" },
    { id: "v-4", name: "Recompute = daily", parent: "Territory Cluster Routing v3", parameter: "recompute_freq", value: "daily", trials: 0, lift: 0, status: "untested" },
    { id: "v-5", name: "Recompute = weekly", parent: "Territory Cluster Routing v3", parameter: "recompute_freq", value: "weekly", trials: 0, lift: 0, status: "untested" },
  ],
  mutationControls: [
    { id: "mc-1", control: "Mutation rate", value: 0.15, description: "Probability of assigning experimental vs proven strategy" },
    { id: "mc-2", control: "Exploration budget", value: 0.25, description: "Fraction of trials allocated to exploration" },
    { id: "mc-3", control: "Decomposition threshold", value: 0.50, description: "Minimum contribution score to decompose a strategy" },
    { id: "mc-4", control: "Promotion threshold", value: 0.80, description: "Minimum confidence to promote to Golden Node" },
    { id: "mc-5", control: "Contamination penalty", value: 0.02, description: "Score deduction for cross-contamination between experiments" },
  ],
};
