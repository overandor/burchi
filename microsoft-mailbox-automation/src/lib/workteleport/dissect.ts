/**
 * Hypothesis Dissect-Demoronify-Research-NoveltyMagnify Pipeline
 *
 * Every proposed idea passes through a structured reasoning engine:
 *
 *   Dissect: Break into measurable components (PICO-TMR)
 *   Demoronify: Remove impressive language, produce testable claim
 *   Research: Determine evidence status
 *   Novelty Magnify: Identify what is actually new
 *   Experiment: Convert to controlled field test
 *   Replicate: Distribute versions
 *   Capitalize: Turn into reusable system
 */

import { nanoid } from "nanoid";
import { getDb } from "@/lib/db";
import type {
  DissectedHypothesis,
  NoveltyType,
} from "@/types/workteleport";

// ─── Schema helpers ────────────────────────────────────────────────────

interface DissectRow {
  id: string;
  org_id: string;
  original_claim: string;
  population: string | null;
  intervention: string | null;
  comparison: string | null;
  outcome: string | null;
  timing: string | null;
  mechanism: string | null;
  risk: string | null;
  demoronified_claim: string;
  research_status: string;
  research_summary: string;
  novel_component: string | null;
  novelty_type: string | null;
  experiment_design: string | null;
  replication_plan: string | null;
  capitalization_plan: string | null;
  created_at: string;
}

function rowToDissected(row: DissectRow): DissectedHypothesis {
  return {
    id: row.id,
    orgId: row.org_id,
    originalClaim: row.original_claim,
    population: row.population || "",
    intervention: row.intervention || "",
    comparison: row.comparison || "",
    outcome: row.outcome || "",
    timing: row.timing || "",
    mechanism: row.mechanism || "",
    risk: row.risk || "",
    demoronifiedClaim: row.demoronified_claim,
    researchStatus: row.research_status as DissectedHypothesis["researchStatus"],
    researchSummary: row.research_summary,
    novelComponent: row.novel_component || "",
    noveltyType: (row.novelty_type as NoveltyType) || "new_combination",
    experimentDesign: row.experiment_design || "",
    replicationPlan: row.replication_plan || "",
    capitalizationPlan: row.capitalization_plan || "",
    createdAt: row.created_at,
  };
}

// ─── Stage 1: Dissect ──────────────────────────────────────────────────

export interface DissectResult {
  population: string;
  intervention: string;
  comparison: string;
  outcome: string;
  timing: string;
  mechanism: string;
  risk: string;
}

/**
 * Break a hypothesis into measurable PICO-TMR components.
 * Uses keyword patterns to identify each component.
 */
export function dissectHypothesis(claim: string): DissectResult {
  const lower = claim.toLowerCase();

  // Population: who is affected
  let population = "unspecified";
  const popPatterns = [
    { pattern: /\bphysicians?\b/i, value: "Physicians" },
    { pattern: /\bhcps?\b/i, value: "HCPs" },
    { pattern: /\bpatients?\b/i, value: "Patients" },
    { pattern: /\bemployees?\b/i, value: "Employees" },
    { pattern: /\breps?\b/i, value: "Sales representatives" },
    { pattern: /\bcustomers?\b/i, value: "Customers" },
    { pattern: /\baccounts?\b/i, value: "Accounts" },
  ];
  for (const p of popPatterns) {
    if (p.pattern.test(lower)) { population = p.value; break; }
  }

  // Intervention: what is being done
  let intervention = "unspecified";
  const intPatterns = [
    { pattern: /\bemails?\b/i, value: "Email communication" },
    { pattern: /\bcall\b/i, value: "Phone call" },
    { pattern: /\bmeeting\b/i, value: "In-person meeting" },
    { pattern: /\bcontent\b/i, value: "Educational content" },
    { pattern: /\bfollow.?up\b/i, value: "Follow-up sequence" },
    { pattern: /\bautomation\b/i, value: "Automated workflow" },
    { pattern: /\bsummary\b/i, value: "Summary document" },
  ];
  for (const p of intPatterns) {
    if (p.pattern.test(lower)) { intervention = p.value; break; }
  }

  // Comparison: what is it compared against
  let comparison = "standard practice";
  if (lower.includes("instead of") || lower.includes("compared to") || lower.includes("rather than")) {
    const match = lower.match(/(?:instead of|compared to|rather than)\s+(.+?)(?:\.|$)/i);
    if (match) comparison = match[1].trim();
  }

  // Outcome: what is measured
  let outcome = "response rate";
  const outPatterns = [
    { pattern: /\bresponse rate\b/i, value: "Response rate" },
    { pattern: /\bconversion\b/i, value: "Conversion rate" },
    { pattern: /\bengagement\b/i, value: "Engagement rate" },
    { pattern: /\bmeeting\b/i, value: "Meeting scheduled rate" },
    { pattern: /\bprescription\b/i, value: "Prescription rate" },
    { pattern: /\bsales?\b/i, value: "Sales volume" },
    { pattern: /\bretention\b/i, value: "Retention rate" },
  ];
  for (const p of outPatterns) {
    if (p.pattern.test(lower)) { outcome = p.value; break; }
  }

  // Timing: when
  let timing = "unspecified";
  const timePatterns = [
    { pattern: /\bwithin \d+ hours?\b/i, value: "Within specified hours" },
    { pattern: /\bwithin \d+ days?\b/i, value: "Within specified days" },
    { pattern: /\bdaily\b/i, value: "Daily" },
    { pattern: /\bweekly\b/i, value: "Weekly" },
    { pattern: /\bpre.?meeting\b/i, value: "Pre-meeting" },
    { pattern: /\bpost.?meeting\b/i, value: "Post-meeting" },
  ];
  for (const p of timePatterns) {
    if (p.pattern.test(lower)) { timing = p.value; break; }
  }

  // Mechanism: why it might work
  let mechanism = "unspecified";
  if (lower.includes("because") || lower.includes("may respond better")) {
    const match = lower.match(/(?:because|may respond better|may result in)\s+(.+?)(?:\.|$)/i);
    if (match) mechanism = match[1].trim();
  }

  // Risk: what could go wrong
  let risk = "customer fatigue, compliance review required";
  if (lower.includes("pharma") || lower.includes("physician") || lower.includes("prescription")) {
    risk = "Regulatory compliance: approved content only, fair balance required, no off-label promotion";
  }

  return { population, intervention, comparison, outcome, timing, mechanism, risk };
}

// ─── Stage 2: Demoronify ───────────────────────────────────────────────

/**
 * Remove impressive language that does not produce a testable claim.
 * Replaces marketing-speak with concrete, measurable language.
 */
export function demoronifyHypothesis(claim: string, dissected: DissectResult): string {
  // Replace common marketing phrases with concrete language
  let result = claim;

  const replacements: [RegExp, string][] = [
    [/\bai.?driven\b/gi, "LLM-assisted"],
    [/\boptimize\b/gi, "improve"],
    [/\btransform\b/gi, "change"],
    [/\bleverage\b/gi, "use"],
    [/\bsynergy\b/gi, "combination"],
    [/\brevolutionary\b/gi, "new"],
    [/\bcutting.?edge\b/gi, "new"],
    [/\bnext.?gen(?:eration)?\b/gi, "new"],
    [/\bgame.?changing\b/gi, "different"],
    [/\bseamless\b/gi, "integrated"],
    [/\bempower\b/gi, "enable"],
    [/\bunlock\b/gi, "access"],
    [/\bharness\b/gi, "use"],
    [/\bsupercharge\b/gi, "increase"],
    [/\bdisrupt\b/gi, "replace"],
    [/\binnovate\b/gi, "change"],
  ];

  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }

  // Ensure the claim is testable by adding PICO structure if missing
  return `${dissected.population} who receive ${dissected.intervention.toLowerCase()} will show a different ${dissected.outcome.toLowerCase()} compared to ${dissected.comparison}.`;
}

// ─── Stage 3: Research ─────────────────────────────────────────────────

/**
 * Determine the evidence status of a hypothesis.
 * In production, this would query external research databases.
 * Here we use keyword patterns to estimate evidence level.
 */
export function researchHypothesis(claim: string): {
  status: DissectedHypothesis["researchStatus"];
  summary: string;
} {
  const lower = claim.toLowerCase();

  // Check for established patterns
  if (lower.match(/\bestablished|proven|well.?known|standard practice\b/)) {
    return {
      status: "established",
      summary: "This approach is well-established in the literature and standard practice.",
    };
  }

  // Check for supported patterns
  if (lower.match(/\bsupported|evidence suggests|studies show\b/)) {
    return {
      status: "supported",
      summary: "There is supporting evidence, though some aspects remain untested.",
    };
  }

  // Check for transferred patterns
  if (lower.match(/\bfrom another industry|transferred|adapted from\b/)) {
    return {
      status: "transferred",
      summary: "This approach has been tested in another context and may transfer.",
    };
  }

  // Check for contradicted patterns
  if (lower.match(/\bcontradicted|disproven|failed to show\b/)) {
    return {
      status: "contradicted",
      summary: "Existing evidence contradicts this hypothesis.",
    };
  }

  // Check for plausible patterns
  if (lower.match(/\bplausible|reasonable|likely\b/)) {
    return {
      status: "plausible",
      summary: "The hypothesis is plausible but has not been formally tested.",
    };
  }

  // Default: untested
  return {
    status: "untested",
    summary: "This hypothesis has not been formally tested. It is a novel combination that requires experimental validation.",
  };
}

// ─── Stage 4: Novelty Magnify ──────────────────────────────────────────

/**
 * Identify what is actually new in the hypothesis.
 */
export function magnifyNovelty(claim: string, dissected: DissectResult): {
  novelComponent: string;
  noveltyType: NoveltyType;
} {
  const lower = claim.toLowerCase();

  if (lower.match(/\bnew audience|different segment|previously untargeted\b/)) {
    return { novelComponent: "A new audience segment not previously targeted", noveltyType: "new_audience" };
  }
  if (lower.match(/\bnew sequence|different order|reorder\b/)) {
    return { novelComponent: "A new sequence of actions", noveltyType: "new_sequence" };
  }
  if (lower.match(/\btiming|when|window|schedule\b/)) {
    return { novelComponent: "A new timing rule", noveltyType: "new_timing_rule" };
  }
  if (lower.match(/\bchannel|email.*call|call.*email|multi.?channel\b/)) {
    return { novelComponent: "A new channel combination", noveltyType: "new_channel_combination" };
  }
  if (lower.match(/\bautomation|automated|workflow\b/)) {
    return { novelComponent: "A new automation of a manual process", noveltyType: "new_automation" };
  }
  if (lower.match(/\bllm|ai.?assist|human.?llm\b/)) {
    return { novelComponent: "A new human-LLM division of labor", noveltyType: "new_human_llm_division" };
  }
  if (lower.match(/\bpersonaliz|individual|custom\b/)) {
    return { novelComponent: "A new personalization variable", noveltyType: "new_personalization_variable" };
  }
  if (lower.match(/\bmeasure|metric|track\b/)) {
    return { novelComponent: "A new measurement method", noveltyType: "new_measurement_method" };
  }

  return { novelComponent: "A new combination of existing processes", noveltyType: "new_combination" };
}

// ─── Full Pipeline ─────────────────────────────────────────────────────

/**
 * Run the full Dissect-Demoronify-Research-NoveltyMagnify pipeline on a hypothesis.
 */
export function processHypothesis(orgId: string, originalClaim: string): DissectedHypothesis {
  const id = `dh_${nanoid(12)}`;

  // Stage 1: Dissect
  const dissected = dissectHypothesis(originalClaim);

  // Stage 2: Demoronify
  const demoronified = demoronifyHypothesis(originalClaim, dissected);

  // Stage 3: Research
  const research = researchHypothesis(originalClaim);

  // Stage 4: Novelty Magnify
  const novelty = magnifyNovelty(originalClaim, dissected);

  // Stage 5: Experiment design
  const experimentDesign = `Controlled field test: ${dissected.population} randomly assigned to ${dissected.intervention} vs ${dissected.comparison}. Measure ${dissected.outcome} over ${dissected.timing}. Success threshold: statistically significant improvement with confidence interval reported.`;

  // Stage 6: Replication plan
  const replicationPlan = `Distribute to 3-5 employees across different territories. Each runs the experiment with their assigned accounts. Compare results across contexts.`;

  // Stage 7: Capitalization plan
  const capitalizationPlan = `If replicated successfully, convert to a standard workflow. Create a Skill Genome for automatic execution. Evaluate as potential Venture Capsule if valuable beyond the original department.`;

  const result: DissectedHypothesis = {
    id,
    orgId,
    originalClaim,
    population: dissected.population,
    intervention: dissected.intervention,
    comparison: dissected.comparison,
    outcome: dissected.outcome,
    timing: dissected.timing,
    mechanism: dissected.mechanism,
    risk: dissected.risk,
    demoronifiedClaim: demoronified,
    researchStatus: research.status,
    researchSummary: research.summary,
    novelComponent: novelty.novelComponent,
    noveltyType: novelty.noveltyType,
    experimentDesign,
    replicationPlan,
    capitalizationPlan,
    createdAt: new Date().toISOString(),
  };

  // Persist
  getDb()
    .prepare(
      `INSERT INTO dissected_hypotheses (
        id, org_id, original_claim, population, intervention,
        comparison, outcome, timing, mechanism, risk,
        demoronified_claim, research_status, research_summary,
        novel_component, novelty_type, experiment_design,
        replication_plan, capitalization_plan
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      result.id,
      result.orgId,
      result.originalClaim,
      result.population,
      result.intervention,
      result.comparison,
      result.outcome,
      result.timing,
      result.mechanism,
      result.risk,
      result.demoronifiedClaim,
      result.researchStatus,
      result.researchSummary,
      result.novelComponent,
      result.noveltyType,
      result.experimentDesign,
      result.replicationPlan,
      result.capitalizationPlan,
    );

  return result;
}

// ─── Query API ─────────────────────────────────────────────────────────

export function getDissectedHypothesis(orgId: string, id: string): DissectedHypothesis | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM dissected_hypotheses WHERE org_id = ? AND id = ?`)
    .get(orgId, id) as DissectRow | undefined;
  return row ? rowToDissected(row) : undefined;
}

export function listDissectedHypotheses(orgId: string): DissectedHypothesis[] {
  const rows = getDb()
    .prepare(`SELECT * FROM dissected_hypotheses WHERE org_id = ? ORDER BY created_at DESC LIMIT 100`)
    .all(orgId) as DissectRow[];
  return rows.map(rowToDissected);
}

export function countDissectedHypotheses(orgId: string): number {
  const row = getDb()
    .prepare(`SELECT count(*) as c FROM dissected_hypotheses WHERE org_id = ?`)
    .get(orgId) as { c: number };
  return row.c;
}
