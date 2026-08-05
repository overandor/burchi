/**
 * SPINOR Cross-Category Prior-Art and Contribution Research
 *
 * Internal contribution record and prior-art search taxonomy.
 * This module defines the research framework that the LLM prior-art
 * research prompt uses to evaluate hypotheses against existing work
 * across 13 software categories — not just "LLM software."
 *
 * Contribution ID: SPINOR-CHAT-2026-08-04-PALINDROMIC-RL
 * Source type: Internal design disclosure
 * Recorded date: 2026-08-04
 * Public availability: Undetermined; treat as private unless publication
 *   is independently verified. A private chat is not automatically public
 *   prior art. Under the U.S. prior-art framework, public availability and
 *   the circumstances of disclosure matter. Inventor-originated public
 *   disclosures may also interact with statutory grace-period rules.
 *   (USPTO MPEP §2153)
 * Research status: Internal contribution evidence, not presumed external
 *   prior art.
 *
 * Primary concepts:
 *   - Palindromic organizational research loop (forward creation + reverse falsification)
 *   - Contextual strategy allocation with fair opportunity distribution
 *   - Human–model experimental collaboration
 *   - Employee hypothesis ownership with derivative lineage
 *   - Golden Nodes (validated, transferable methods)
 *   - Hypothesis sprouting and lineage
 *   - Activity-mode rotation (anti-fatigue via conceptual similarity)
 *   - Automation progression from repeatability evidence
 *   - Strategy competition rather than employee competition
 *   - Mailbox-derived behavioral evidence
 *   - Context–Strategy–Execution–Outcome Graph
 *   - Integrated execution, decisioning, and attribution engines
 */

export interface PriorArtCategory {
  id: string;
  name: string;
  searchTerms: string[];
  established: string;
  differentiation: string;
}

export const PRIOR_ART_CATEGORIES: PriorArtCategory[] = [
  {
    id: "next_best_action",
    name: "Next-best-action and real-time decisioning",
    searchTerms: [
      "next best action",
      "real-time decisioning",
      "context-specific action recommendation",
      "predictive model business rules",
      "sales service employee recommendation",
    ],
    established:
      "Pega describes continuously adapting next-best-action decisioning using customer context, predictive models, business rules, and response feedback. Salesforce provides next-best-action strategies, including Life Sciences territory-scheduled visits and emails.",
    differentiation:
      "Personalized action recommendation alone is not the differentiator. SPINOR's differentiation comes from the constraints, evidence states, organizational mission semantics, and causal lineage wrapped around allocation.",
  },
  {
    id: "contextual_bandits",
    name: "Contextual bandits, reinforcement learning, and adaptive allocation",
    searchTerms: [
      "contextual bandit",
      "exploration exploitation",
      "adaptive allocation",
      "fair contextual bandit",
      "minimum allocation rate",
    ],
    established:
      "Contextual bandits have long been used for adaptive personalized recommendation. Fair contextual-bandit research explicitly considers minimum allocation rates across users.",
    differentiation:
      "SPINOR cannot claim contextual personalization or exploration-exploitation as new by themselves. Its differentiation must come from the constraints, evidence states, organizational mission semantics, and causal lineage wrapped around allocation.",
  },
  {
    id: "experimentation_platforms",
    name: "Experimentation platforms",
    searchTerms: [
      "overlapping experimentation",
      "continuous experimentation",
      "experiment holdout",
      "experiment contamination",
      "organization-wide experimentation",
    ],
    established:
      "Google has described overlapping experimentation systems and continuous experimentation platforms operating across many products.",
    differentiation:
      "SPINOR must not claim that 'an organization continuously runs experiments' is itself novel. The novelty is connecting experiments to versioned hypotheses, contribution ownership, and reverse falsification.",
  },
  {
    id: "causal_inference",
    name: "Causal inference and attribution",
    searchTerms: [
      "causal inference",
      "doubly robust estimation",
      "propensity matching",
      "counterfactual estimation",
      "heterogeneous treatment effects",
      "sensitivity analysis",
    ],
    established:
      "DoWhy provides a unified causal-inference interface and robustness testing. Common matching and even naïvely implemented doubly robust methods can produce misleading confidence intervals.",
    differentiation:
      "SPINOR's Attribution Oracle must orchestrate established estimators and disclose assumptions rather than treating a model-generated explanation as causal analysis.",
  },
  {
    id: "process_mining",
    name: "Process mining and task mining",
    searchTerms: [
      "process mining",
      "task mining",
      "event log process discovery",
      "automation candidate detection",
      "workflow deviation",
    ],
    established:
      "Process mining treats organizational records as event logs containing cases, activities, timestamps, people, and costs. UiPath Task Mining records task variations and generates automation artifacts.",
    differentiation:
      "Mailbox and workflow logs becoming process evidence are established concepts. SPINOR's contribution is connecting those logs to versioned hypotheses, causal experiments, contribution ownership, and reverse falsification.",
  },
  {
    id: "workflow_automation",
    name: "Workflow automation and robotic process automation",
    searchTerms: [
      "robotic process automation",
      "workflow automation",
      "repetitive work detection",
      "approval checkpoint automation",
      "exception escalation",
    ],
    established:
      "RPA systems detect repetitive work, produce automation candidates, execute deterministic tasks, preserve approval checkpoints, and escalate exceptions.",
    differentiation:
      "The novel question is not whether work can be automated, but whether repeatability evidence from controlled organizational experiments automatically changes the human-machine division of labor.",
  },
  {
    id: "knowledge_graphs",
    name: "Organizational knowledge graphs and event sourcing",
    searchTerms: [
      "event sourcing",
      "provenance graph",
      "temporal knowledge graph",
      "organizational memory",
      "contribution graph",
      "lineage system",
    ],
    established:
      "Immutable event histories, provenance graphs, temporal knowledge graphs, and lineage systems are established concepts.",
    differentiation:
      "The Context–Strategy–Execution–Outcome Graph must preserve: hypothesis version, assignment method, SPIN combination, protocol approval, actual execution, deviations, confounders, outcome, attribution, replication, contribution, and automation transition.",
  },
  {
    id: "workforce_allocation",
    name: "Workforce allocation and algorithmic management",
    searchTerms: [
      "algorithmic management",
      "workforce allocation",
      "territory optimization",
      "worker performance scoring",
      "scarce opportunity allocation",
    ],
    established:
      "Workforce allocation systems assign work based on capability, optimize schedules and territories, score worker performance, and allocate scarce opportunities.",
    differentiation:
      "SPINOR must distinguish itself from conventional algorithmic management by making strategy quality—not activity volume or employee rank—the object of competition.",
  },
  {
    id: "gamification",
    name: "Gamification and reputation systems",
    searchTerms: [
      "mission system",
      "employee reputation",
      "contribution scoring",
      "collaborative competition",
      "negative result reward",
      "anti-gaming control",
    ],
    established:
      "Missions, progress, leaderboards, and research reputation are all established gamification concepts.",
    differentiation:
      "The relevant SPINOR structure is: a contribution earns value only when linked to evidence quality, falsification value, replication, transferability, customer value, compliance reliability, or a reusable system.",
  },
  {
    id: "scientific_workflow",
    name: "Scientific workflow and laboratory information systems",
    searchTerms: [
      "hypothesis registration",
      "protocol versioning",
      "electronic laboratory notebook",
      "preregistration",
      "research asset lineage",
    ],
    established:
      "Experiment tracking, protocol versioning, electronic lab notebooks, and preregistration are established in scientific workflow systems.",
    differentiation:
      "SPINOR transfers scientific-workflow principles into organizational execution. The research question is whether those controls have been combined with daily employee work allocation and operational automation.",
  },
  {
    id: "digital_twins",
    name: "Digital twins, simulation, and strategy testing",
    searchTerms: [
      "digital twin",
      "process twin",
      "customer state model",
      "synthetic control",
      "policy simulation",
      "shadow mode testing",
    ],
    established:
      "Account simulations, territory simulations, process twins, and synthetic controls are established concepts.",
    differentiation:
      "Relevant to the Forge, Oracle, and strategy mutation components. The novelty is in connecting simulation to versioned hypothesis testing and causal attribution.",
  },
  {
    id: "compliance_engines",
    name: "Compliance and policy engines",
    searchTerms: [
      "finite state compliance",
      "content approval",
      "immutable review history",
      "policy as code",
      "message locking",
      "adverse event escalation",
    ],
    established:
      "Finite-state compliance systems, content approval, immutable review histories, jurisdiction rules, and policy-as-code are established.",
    differentiation:
      "The compliance state machine should be evaluated separately from LLM safety mechanisms. Regulatory controls must be deterministic, versioned, and auditable.",
  },
  {
    id: "llm_agentic",
    name: "LLM and agentic software",
    searchTerms: [
      "ReAct reasoning acting",
      "Toolformer tool selection",
      "AutoGen multi-agent",
      "LLM hypothesis generation",
      "LLM document synthesis",
      "LLM tool orchestration",
    ],
    established:
      "ReAct established the combination of language-model reasoning and environment actions. Toolformer demonstrated language models selecting and invoking external tools. AutoGen provides multi-agent workflows combining LLMs, humans, and tools.",
    differentiation:
      "SPINOR should not be described as an LLM product. It should be described as a multi-method experimental operating system in which LLMs perform language-intensive research and interpretation functions.",
  },
];

/**
 * Candidate novelty concentrations (not confirmed patentable inventions).
 * A professional patentability search would still need claim-by-claim analysis.
 */
export const CANDIDATE_NOVELTY_DELTAS = [
  {
    id: "spin_causal_unit",
    name: "The SPIN causal unit",
    description:
      "Results belong to a versioned combination of human judgment, hypothesis, customer context, territory, model contribution, execution method, timing, assignment method, external conditions, and chance.",
  },
  {
    id: "reverse_research_pass",
    name: "Compulsory reverse research pass",
    description:
      "A successful method is automatically converted into mechanism-isolation, falsification, boundary-testing, and redistribution missions.",
  },
  {
    id: "strategy_competition",
    name: "Strategy competition instead of employee competition",
    description:
      "Employees receive opportunity-normalized support, while strategies—not workers—face experimental comparison.",
  },
  {
    id: "evidence_driven_automation",
    name: "Evidence-driven automation progression",
    description:
      "A workflow becomes an automation candidate because stored evidence shows it is stable, repeatable, sufficiently low-risk, and understood—not simply because it is frequent.",
  },
  {
    id: "hypothesis_ownership_lineage",
    name: "Hypothesis ownership with causal lineage",
    description:
      "Human modifications create explicit derivatives with authorship, parentage, changed variables, evidence requirements, and downstream contribution credit.",
  },
  {
    id: "one_graph_evidence_to_spinout",
    name: "One graph spanning evidence through spinout",
    description:
      "The same provenance chain links mailbox signals, mission assignment, human execution, causal interpretation, replication, process ownership, automation, and potential business-channel formation.",
  },
  {
    id: "anti_fatigue_similarity",
    name: "Anti-fatigue based on conceptual mission similarity",
    description:
      "Activity Genome similarity rotates cognitive mode and research responsibility, rather than merely changing task wording.",
  },
] as const;

/**
 * LLM responsibilities — what LLMs may do in SPINOR.
 */
export const LLM_RESPONSIBILITIES = [
  "Convert prose into structured claims",
  "Synthesize internal and external research",
  "Locate contradictions",
  "Suggest novelty dimensions",
  "Generate candidate confounders",
  "Draft understandable protocols",
  "Create controlled derivatives",
  "Explain assignment logic",
  "Interpret structured causal outputs",
  "Propose automation and spinout questions",
] as const;

/**
 * Non-LLM responsibilities — what deterministic or specialized systems must perform.
 */
export const NON_LLM_RESPONSIBILITIES = [
  "Identity and access control",
  "Organization isolation",
  "Event storage",
  "Provenance hashing",
  "State transitions",
  "Experiment assignment",
  "Randomization",
  "Constrained optimization",
  "Fairness accounting",
  "Effect calculation",
  "Confidence intervals",
  "Causal estimation",
  "Statistical power",
  "Stopping rules",
  "Policy enforcement",
  "Approved-content locking",
  "Adverse-event routing",
  "Audit receipts",
  "Workflow execution",
] as const;

/**
 * The full SPINOR loop that prior-art comparison must evaluate against.
 */
export const SPINOR_LOOP = [
  "Evidence ingestion",
  "Hypothesis asset",
  "Research Gauntlet",
  "Constrained allocation",
  "Human modification",
  "Versioned SPIN",
  "Real execution",
  "Provenance capture",
  "Cautious attribution",
  "Derivative generation",
  "Independent replication",
  "Golden Node governance",
  "Automation progression",
  "Reverse falsification",
  "Renewed research",
] as const;

/**
 * Build the prior-art research system prompt that instructs the LLM to
 * evaluate a hypothesis claim against all 13 categories, not just "LLM software."
 */
export function buildPriorArtPrompt(claim: string): string {
  const categories = PRIOR_ART_CATEGORIES.map(
    (c) => `- ${c.name}: ${c.established}`
  ).join("\n");

  return `You are a prior-art research engine for SPINOR, a multi-method experimental operating system.
Evaluate the given hypothesis claim against existing work across ALL of the following software categories:

${categories}

Do NOT search only for "LLM sales assistant" or "AI gamification." Search every technical component.
The research question is: Which SPINOR elements are established independently, which combinations
have already been implemented, and where does the proposed closed research-to-execution-to-falsification
loop remain technically differentiated?

Compare the claim against the full SPINOR loop:
${SPINOR_LOOP.join(" → ")}

Return ONLY valid JSON with this exact structure:
{
  "testedInMarket": boolean,
  "testedInAdjacentIndustries": boolean,
  "adjacentSupportSummary": "1-2 sentence summary of evidence across categories",
  "sourceDomains": ["domain1", "domain2"],
  "responsibleComponent": "the component that appears responsible for the effect, or null",
  "requiredConditions": ["condition1", "condition2"],
  "risksAndConfounders": ["risk1", "risk2"],
  "genuinelyUnknown": ["unknown1"],
  "categoryOverlap": ["category_id1", "category_id2"],
  "noveltyDelta": "what remains technically differentiated after this sweep"
}

Be conservative. Distinguish "nobody has tested this" from "somebody tested this and it failed"
from "evidence is too poor to know." Do NOT fabricate specific study citations.
LLMs perform research and interpretation; deterministic systems handle analytics, causal estimation,
compliance, and execution. Do not describe SPINOR as an LLM product.`;
}
