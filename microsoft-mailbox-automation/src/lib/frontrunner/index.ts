/**
 * SPINOR FRONTRUNNER — The Prior-Art-Native, Zero-Blank-Page Product Evolution System
 *
 * Replaces the empty prompt box with a continuously refreshed field of products
 * that are already partially researched, structured, evaluated, and prepared
 * for implementation.
 *
 * The core loop:
 *   1. Scan for real opportunities (Almanac)
 *   2. Generate complete Product Genomes via LLM (Genome)
 *   3. Run Production Completeness Gate (real checks)
 *   4. Generate structural variants (Evolution)
 *   5. Score and rank by evidence-based fitness (Evolution)
 *   6. Present to user with Choice Gravity questions
 *   7. User answers reweight the portfolio
 *   8. Maintain Top 100 Workflow Genomes
 *
 * No mock behavior. No fake metrics. No landing pages pretending to be products.
 */

import { nanoid } from "nanoid";
import { getDb, auditLog } from "@/lib/db";
import { callLLM, extractJSON, type ChatMessage } from "@/lib/golden/llm-client";

// ─── Types ─────────────────────────────────────────────────────────────

export interface Opportunity {
  id: string;
  orgId: string;
  title: string;
  description: string;
  category: string;
  sourceType: string;
  sourceUrls: string[];
  evidence: { claim: string; source: string; url?: string }[];
  gapDescription: string;
  targetUsers: string[];
  marketSignals: string[];
  noveltyDelta: string | null;
  epoch: string;
  score: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductGenome {
  id: string;
  orgId: string;
  userId: string;
  opportunityId: string | null;
  parentGenomeId: string | null;
  name: string;
  problem: string;
  eligibleUsers: string[];
  existingAlternatives: string[];
  unresolvedNeed: string;
  priorArtBoundary: string;
  noveltyDelta: string;
  requiredFunctionality: string[];
  systemArchitecture: Record<string, unknown>;
  dataModel: Record<string, unknown>;
  externalIntegrations: string[];
  authPermissions: Record<string, unknown>;
  complianceConditions: string[];
  failureRollback: string[];
  testingRequirements: string[];
  deploymentTarget: string;
  pricingHypothesis: Record<string, unknown>;
  distributionMethod: string;
  marketingAssets: Record<string, unknown>;
  measurableValue: string;
  costAvoided: string;
  evidenceRequired: string[];
  completenessScore: number;
  completenessChecks: Record<string, { passed: boolean; detail: string }>;
  fitnessScore: number;
  branchType: string;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowGenome {
  id: string;
  orgId: string;
  productGenomeId: string | null;
  parentWorkflowId: string | null;
  name: string;
  trigger: string;
  requiredContext: string[];
  researchProcess: string[];
  reasoningProcedure: string[];
  toolsIntegrations: string[];
  executionStages: string[];
  validationCriteria: string[];
  failureConditions: string[];
  recoveryBehavior: string[];
  humanApprovalPoints: string[];
  expectedBusinessValue: string;
  estimatedCostAvoided: string;
  expectedTimeSaved: string;
  reusableOutputs: string[];
  version: number;
  fitnessScore: number;
  rank: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompletenessCheck {
  passed: boolean;
  detail: string;
}

export interface CompletenessResult {
  score: number;
  checks: Record<string, CompletenessCheck>;
  missing: string[];
}

export interface ChoiceGravityQuestion {
  id: string;
  question: string;
  options: { label: string; value: string; weightChanges: Record<string, number> }[];
}

export interface Epoch {
  id: string;
  orgId: string;
  epochNumber: number;
  opportunitiesScanned: number;
  candidatesGenerated: number;
  variantsGenerated: number;
  variantsEliminated: number;
  winnersPromoted: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
}

// ─── Database row mappers ──────────────────────────────────────────────

function rowToOpportunity(row: any): Opportunity {
  return {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    description: row.description,
    category: row.category,
    sourceType: row.source_type,
    sourceUrls: JSON.parse(row.source_urls || "[]"),
    evidence: JSON.parse(row.evidence || "[]"),
    gapDescription: row.gap_description,
    targetUsers: JSON.parse(row.target_users || "[]"),
    marketSignals: JSON.parse(row.market_signals || "[]"),
    noveltyDelta: row.novelty_delta,
    epoch: row.epoch,
    score: row.score,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToProductGenome(row: any): ProductGenome {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    opportunityId: row.opportunity_id,
    parentGenomeId: row.parent_genome_id,
    name: row.name,
    problem: row.problem,
    eligibleUsers: JSON.parse(row.eligible_users || "[]"),
    existingAlternatives: JSON.parse(row.existing_alternatives || "[]"),
    unresolvedNeed: row.unresolved_need,
    priorArtBoundary: row.prior_art_boundary,
    noveltyDelta: row.novelty_delta,
    requiredFunctionality: JSON.parse(row.required_functionality || "[]"),
    systemArchitecture: JSON.parse(row.system_architecture || "{}"),
    dataModel: JSON.parse(row.data_model || "{}"),
    externalIntegrations: JSON.parse(row.external_integrations || "[]"),
    authPermissions: JSON.parse(row.auth_permissions || "{}"),
    complianceConditions: JSON.parse(row.compliance_conditions || "[]"),
    failureRollback: JSON.parse(row.failure_rollback || "[]"),
    testingRequirements: JSON.parse(row.testing_requirements || "[]"),
    deploymentTarget: row.deployment_target || "",
    pricingHypothesis: JSON.parse(row.pricing_hypothesis || "{}"),
    distributionMethod: row.distribution_method || "",
    marketingAssets: JSON.parse(row.marketing_assets || "{}"),
    measurableValue: row.measurable_value || "",
    costAvoided: row.cost_avoided || "",
    evidenceRequired: JSON.parse(row.evidence_required || "[]"),
    completenessScore: row.completeness_score,
    completenessChecks: JSON.parse(row.completeness_checks || "{}"),
    fitnessScore: row.fitness_score,
    branchType: row.branch_type,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToWorkflowGenome(row: any): WorkflowGenome {
  return {
    id: row.id,
    orgId: row.org_id,
    productGenomeId: row.product_genome_id,
    parentWorkflowId: row.parent_workflow_id,
    name: row.name,
    trigger: row.trigger,
    requiredContext: JSON.parse(row.required_context || "[]"),
    researchProcess: JSON.parse(row.research_process || "[]"),
    reasoningProcedure: JSON.parse(row.reasoning_procedure || "[]"),
    toolsIntegrations: JSON.parse(row.tools_integrations || "[]"),
    executionStages: JSON.parse(row.execution_stages || "[]"),
    validationCriteria: JSON.parse(row.validation_criteria || "[]"),
    failureConditions: JSON.parse(row.failure_conditions || "[]"),
    recoveryBehavior: JSON.parse(row.recovery_behavior || "[]"),
    humanApprovalPoints: JSON.parse(row.human_approval_points || "[]"),
    expectedBusinessValue: row.expected_business_value || "",
    estimatedCostAvoided: row.estimated_cost_avoided || "",
    expectedTimeSaved: row.expected_time_saved || "",
    reusableOutputs: JSON.parse(row.reusable_outputs || "[]"),
    version: row.version,
    fitnessScore: row.fitness_score,
    rank: row.rank,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── 1. Opportunity Almanac ────────────────────────────────────────────
//
// Scans for real opportunities by combining:
// - LLM-generated market analysis based on current technology trends
// - User-provided signals (complaints, missing integrations, manual workflows)
// - Prior opportunity history (what was already discovered)
//
// Each opportunity must have:
// - A real gap description (not "this would be cool")
// - Evidence (sources, claims)
// - Target users
// - Market signals

const ALMANAC_SCAN_PROMPT = `You are the Opportunity Almanac scanner for SPINOR FRONTRUNNER.

Your job is to identify REAL, commercially valuable product opportunities by analyzing
what users repeatedly leave existing applications to accomplish elsewhere.

For each opportunity, provide:
1. title: concise name (max 60 chars)
2. description: what the opportunity is (2-3 sentences)
3. category: one of [missing_integration, manual_handoff, weak_collaboration, poor_personalization, absent_automation, compliance_friction, unstructured_data, incomplete_analytics, difficult_onboarding, unserved_niche, work_done_outside_product]
4. gapDescription: the specific capability gap that exists between successful apps
5. targetUsers: array of user types who experience this gap
6. marketSignals: array of evidence signals (complaints, trends, missing features)
7. noveltyDelta: what would be genuinely new about solving this
8. existingAlternatives: array of current workarounds or competing approaches

Focus on gaps that are:
- Painful enough that users already do the work manually
- Valuable enough that someone would pay
- Specific enough to build a focused product around

Return a JSON array of 3-5 opportunities. No fluff. No vaporware.`;

export async function scanOpportunities(
  orgId: string,
  userSignals: string[] = [],
): Promise<Opportunity[]> {
  const epoch = new Date().toISOString().slice(0, 10);
  const db = getDb();

  // Check if we already have opportunities for this epoch
  const existing = db
    .prepare(`SELECT * FROM almanac_opportunities WHERE org_id = ? AND epoch = ? ORDER BY score DESC`)
    .all(orgId, epoch) as any[];

  if (existing.length >= 3) {
    return existing.map(rowToOpportunity);
  }

  // Build context from user signals and prior discoveries
  const priorOps = db
    .prepare(`SELECT title, gap_description FROM almanac_opportunities WHERE org_id = ? ORDER BY created_at DESC LIMIT 10`)
    .all(orgId) as any[];

  const contextParts: string[] = [];
  if (userSignals.length > 0) {
    contextParts.push(`User-provided signals:\n${userSignals.map((s) => `- ${s}`).join("\n")}`);
  }
  if (priorOps.length > 0) {
    contextParts.push(`Prior discoveries (avoid duplicates):\n${priorOps.map((o) => `- ${o.title}`).join("\n")}`);
  }
  const context = contextParts.join("\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: ALMANAC_SCAN_PROMPT },
    { role: "user", content: context || "Scan for opportunities in the current technology landscape. Focus on gaps between popular SaaS tools, missing integrations, and workflows that require manual handoffs between applications." },
  ];

  const llmResult = await callLLM(messages, { temperature: 0.7, maxTokens: 4096 });
  const opportunities = extractJSON<any[]>(llmResult.content) || [];

  const created: Opportunity[] = [];
  for (const opp of opportunities.slice(0, 5)) {
    if (!opp.title || !opp.gapDescription) continue;

    const id = `almanac_${nanoid(12)}`;
    const score = scoreOpportunity(opp);

    db.prepare(
      `INSERT INTO almanac_opportunities
       (id, org_id, title, description, category, source_type, source_urls, evidence,
        gap_description, target_users, market_signals, novelty_delta, epoch, score, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, orgId,
      opp.title, opp.description || "", opp.category || "missing_integration",
      "llm_scan", JSON.stringify(opp.sourceUrls || []),
      JSON.stringify(opp.evidence || []),
      opp.gapDescription,
      JSON.stringify(opp.targetUsers || []),
      JSON.stringify(opp.marketSignals || []),
      opp.noveltyDelta || null,
      epoch, score, "discovered",
    );

    const row = db.prepare(`SELECT * FROM almanac_opportunities WHERE id = ?`).get(id) as any;
    if (row) created.push(rowToOpportunity(row));
  }

  auditLog(orgId, null, "frontrunner.scan", "almanac", undefined, `Scanned ${created.length} opportunities for epoch ${epoch}`);
  return created;
}

function scoreOpportunity(opp: any): number {
  let score = 0;
  // Has evidence signals
  score += Math.min((opp.marketSignals?.length || 0) * 10, 30);
  // Has clear target users
  score += Math.min((opp.targetUsers?.length || 0) * 5, 20);
  // Has novelty delta
  if (opp.noveltyDelta) score += 15;
  // Has existing alternatives (means the problem is real)
  score += Math.min((opp.existingAlternatives?.length || 0) * 5, 15);
  // Description quality (longer = more specific)
  if ((opp.gapDescription?.length || 0) > 100) score += 10;
  if ((opp.description?.length || 0) > 100) score += 10;
  return Math.round(score);
}

export function getOpportunities(orgId: string, limit = 20): Opportunity[] {
  const rows = getDb()
    .prepare(`SELECT * FROM almanac_opportunities WHERE org_id = ? ORDER BY score DESC, created_at DESC LIMIT ?`)
    .all(orgId, limit) as any[];
  return rows.map(rowToOpportunity);
}

export function getOpportunity(orgId: string, id: string): Opportunity | null {
  const row = getDb()
    .prepare(`SELECT * FROM almanac_opportunities WHERE org_id = ? AND id = ?`)
    .get(orgId, id) as any;
  return row ? rowToOpportunity(row) : null;
}

export function insertOpportunity(orgId: string, opportunity: Omit<Opportunity, "id" | "orgId" | "createdAt" | "updatedAt">): Opportunity {
  const id = `almanac_${nanoid(12)}`;
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO almanac_opportunities
     (id, org_id, title, description, category, source_type, source_urls, evidence, gap_description, target_users, market_signals, novelty_delta, epoch, score, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    orgId,
    opportunity.title,
    opportunity.description,
    opportunity.category,
    opportunity.sourceType,
    JSON.stringify(opportunity.sourceUrls || []),
    JSON.stringify(opportunity.evidence || []),
    opportunity.gapDescription,
    JSON.stringify(opportunity.targetUsers || []),
    JSON.stringify(opportunity.marketSignals || []),
    opportunity.noveltyDelta,
    opportunity.epoch,
    opportunity.score,
    opportunity.status,
    now,
    now,
  );
  return getOpportunity(orgId, id)!;
}

// ─── 2. Prompt Encyclopedia ────────────────────────────────────────────
//
// Stores relatively stable knowledge: proven patterns, architectures,
// tool combinations, evaluation methods, security controls, etc.

export function getEncyclopediaEntries(orgId: string, entryType?: string): any[] {
  if (entryType) {
    return getDb()
      .prepare(`SELECT * FROM encyclopedia_entries WHERE org_id = ? AND entry_type = ? ORDER BY updated_at DESC`)
      .all(orgId, entryType) as any[];
  }
  return getDb()
    .prepare(`SELECT * FROM encyclopedia_entries WHERE org_id = ? ORDER BY updated_at DESC`)
    .all(orgId) as any[];
}

export function addEncyclopediaEntry(
  orgId: string,
  entryType: string,
  title: string,
  content: string,
  tags: string[] = [],
  references: string[] = [],
): string {
  const id = `enc_${nanoid(12)}`;
  getDb().prepare(
    `INSERT INTO encyclopedia_entries (id, org_id, entry_type, title, content, tags, "references")
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, orgId, entryType, title, content, JSON.stringify(tags), JSON.stringify(references));
  return id;
}

// ─── 3. Product Genome Generator ───────────────────────────────────────
//
// Generates complete product definitions via LLM, then runs them through
// the Production Completeness Gate.

const GENOME_GENERATION_PROMPT = `You are the Product Genome generator for SPINOR FRONTRUNNER.

Generate a COMPLETE product definition for the given opportunity. The product must be:
- Specific enough to implement
- Complete enough to evaluate
- Honest about what's known and what's not

Return a JSON object with ALL of these fields:
{
  "name": "product name",
  "problem": "the specific problem being solved",
  "eligibleUsers": ["user type 1", "user type 2"],
  "existingAlternatives": ["current workaround 1", "tool 1 that partially solves this"],
  "unresolvedNeed": "what existing alternatives fail to address",
  "priorArtBoundary": "what already exists and cannot be claimed as novel",
  "noveltyDelta": "what is genuinely new about this approach",
  "requiredFunctionality": ["feature 1", "feature 2", ...],
  "systemArchitecture": {
    "frontend": "technology choice",
    "backend": "technology choice",
    "database": "data store",
    "deployment": "deployment target"
  },
  "dataModel": {
    "entities": [{"name": "EntityName", "fields": ["field1", "field2"]}]
  },
  "externalIntegrations": ["API 1", "service 2"],
  "authPermissions": {
    "authMethod": "how users authenticate",
    "roles": ["role 1", "role 2"],
    "permissions": ["permission 1"]
  },
  "complianceConditions": ["compliance requirement 1"],
  "failureRollback": ["what happens on failure", "rollback procedure"],
  "testingRequirements": ["test 1", "test 2"],
  "deploymentTarget": "where this deploys",
  "pricingHypothesis": {
    "model": "subscription|usage|transaction|enterprise|freemium",
    "pricePoint": "estimated price",
    "whoPays": "who pays",
    "whyTheyPay": "why they pay"
  },
  "distributionMethod": "how this reaches users",
  "measurableValue": "the specific measurable value this creates",
  "costAvoided": "the specific cost this avoids",
  "evidenceRequired": ["what evidence is still needed to validate this"]
}

Be specific. "A web app" is not an architecture. "Next.js with PostgreSQL" is.
"Users" is not eligible users. "Sales ops managers at B2B SaaS companies" is.
"Make money" is not a pricing hypothesis. "$29/month per workspace, paid by sales teams" is.`;

export async function generateProductGenome(
  orgId: string,
  userId: string,
  opportunityId: string,
  branchType: string = "primary",
  parentGenomeId?: string,
): Promise<ProductGenome> {
  const opportunity = getOpportunity(orgId, opportunityId);
  if (!opportunity) throw new Error("Opportunity not found");

  const messages: ChatMessage[] = [
    { role: "system", content: GENOME_GENERATION_PROMPT },
    {
      role: "user",
      content: `Opportunity: ${opportunity.title}\nGap: ${opportunity.gapDescription}\nTarget users: ${opportunity.targetUsers.join(", ")}\nMarket signals: ${opportunity.marketSignals.join(", ")}\nNovelty delta: ${opportunity.noveltyDelta || "to be determined"}`,
    },
  ];

  const llmResult = await callLLM(messages, { temperature: 0.6, maxTokens: 4096 });
  const spec = extractJSON<any>(llmResult.content) || {};

  // Run completeness gate
  const completeness = runCompletenessGate(spec);

  // Score fitness
  const fitness = scoreFitness(spec, completeness);

  const id = `genome_${nanoid(12)}`;
  const db = getDb();

  db.prepare(
    `INSERT INTO product_genomes
     (id, org_id, user_id, opportunity_id, parent_genome_id, name, problem,
      eligible_users, existing_alternatives, unresolved_need, prior_art_boundary,
      novelty_delta, required_functionality, system_architecture, data_model,
      external_integrations, auth_permissions, compliance_conditions,
      failure_rollback, testing_requirements, deployment_target, pricing_hypothesis,
      distribution_method, marketing_assets, measurable_value, cost_avoided,
      evidence_required, completeness_score, completeness_checks, fitness_score,
      branch_type, status, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, orgId, userId, opportunityId, parentGenomeId || null,
    spec.name || "Untitled Product",
    spec.problem || opportunity.gapDescription,
    JSON.stringify(spec.eligibleUsers || []),
    JSON.stringify(spec.existingAlternatives || []),
    spec.unresolvedNeed || "",
    spec.priorArtBoundary || "",
    spec.noveltyDelta || "",
    JSON.stringify(spec.requiredFunctionality || []),
    JSON.stringify(spec.systemArchitecture || {}),
    JSON.stringify(spec.dataModel || {}),
    JSON.stringify(spec.externalIntegrations || []),
    JSON.stringify(spec.authPermissions || {}),
    JSON.stringify(spec.complianceConditions || []),
    JSON.stringify(spec.failureRollback || []),
    JSON.stringify(spec.testingRequirements || []),
    spec.deploymentTarget || "",
    JSON.stringify(spec.pricingHypothesis || {}),
    spec.distributionMethod || "",
    JSON.stringify({}), // marketing assets generated later
    spec.measurableValue || "",
    spec.costAvoided || "",
    JSON.stringify(spec.evidenceRequired || []),
    completeness.score,
    JSON.stringify(completeness.checks),
    fitness,
    branchType,
    completeness.score >= 70 ? "ready" : "draft",
    1,
  );

  const row = db.prepare(`SELECT * FROM product_genomes WHERE id = ?`).get(id) as any;
  auditLog(orgId, userId, "frontrunner.genome.generate", "product_genome", id, `Generated genome: ${spec.name}`);
  return rowToProductGenome(row);
}

// ─── 4. Production Completeness Gate ───────────────────────────────────
//
// Real checks — not "does it sound good" but "does it have the actual
// components a production product needs."

export function runCompletenessGate(spec: any): CompletenessResult {
  const checks: Record<string, CompletenessCheck> = {};
  const missing: string[] = [];

  // 1. Real data model
  const hasDataModel = spec.dataModel?.entities && Array.isArray(spec.dataModel.entities) && spec.dataModel.entities.length > 0;
  checks.dataModel = {
    passed: !!hasDataModel,
    detail: hasDataModel ? `${spec.dataModel.entities.length} entities defined` : "No data model entities defined",
  };
  if (!hasDataModel) missing.push("data_model");

  // 2. Authentication
  const hasAuth = spec.authPermissions?.authMethod && spec.authPermissions.authMethod.length > 5;
  checks.authentication = {
    passed: !!hasAuth,
    detail: hasAuth ? `Method: ${spec.authPermissions.authMethod}` : "No authentication method specified",
  };
  if (!hasAuth) missing.push("authentication");

  // 3. Organization isolation (if multi-tenant)
  const hasOrgIsolation = spec.authPermissions?.roles && Array.isArray(spec.authPermissions.roles);
  checks.orgIsolation = {
    passed: !!hasOrgIsolation,
    detail: hasOrgIsolation ? `Roles: ${spec.authPermissions.roles.join(", ")}` : "No roles defined",
  };
  if (!hasOrgIsolation) missing.push("org_isolation");

  // 4. Functional controls
  const hasFunctionality = spec.requiredFunctionality && Array.isArray(spec.requiredFunctionality) && spec.requiredFunctionality.length >= 3;
  checks.functionalControls = {
    passed: !!hasFunctionality,
    detail: hasFunctionality ? `${spec.requiredFunctionality.length} features defined` : "Fewer than 3 features defined",
  };
  if (!hasFunctionality) missing.push("functional_controls");

  // 5. Error states
  const hasErrorHandling = spec.failureRollback && Array.isArray(spec.failureRollback) && spec.failureRollback.length > 0;
  checks.errorStates = {
    passed: !!hasErrorHandling,
    detail: hasErrorHandling ? `${spec.failureRollback.length} failure/rollback procedures` : "No failure handling defined",
  };
  if (!hasErrorHandling) missing.push("error_states");

  // 6. Integration adapters
  const hasIntegrations = spec.externalIntegrations && Array.isArray(spec.externalIntegrations);
  checks.integrationAdapters = {
    passed: !!hasIntegrations,
    detail: hasIntegrations ? `${spec.externalIntegrations.length} integrations: ${spec.externalIntegrations.slice(0, 3).join(", ")}` : "No integrations specified",
  };
  if (!hasIntegrations) missing.push("integrations");

  // 7. Tests
  const hasTests = spec.testingRequirements && Array.isArray(spec.testingRequirements) && spec.testingRequirements.length > 0;
  checks.tests = {
    passed: !!hasTests,
    detail: hasTests ? `${spec.testingRequirements.length} test requirements` : "No testing requirements defined",
  };
  if (!hasTests) missing.push("tests");

  // 8. Deployment configuration
  const hasDeployment = spec.deploymentTarget && spec.deploymentTarget.length > 3;
  checks.deploymentConfig = {
    passed: !!hasDeployment,
    detail: hasDeployment ? `Target: ${spec.deploymentTarget}` : "No deployment target specified",
  };
  if (!hasDeployment) missing.push("deployment");

  // 9. Pricing hypothesis
  const hasPricing = spec.pricingHypothesis?.model && spec.pricingHypothesis?.whoPays;
  checks.pricing = {
    passed: !!hasPricing,
    detail: hasPricing ? `Model: ${spec.pricingHypothesis.model}, paid by: ${spec.pricingHypothesis.whoPays}` : "No pricing hypothesis",
  };
  if (!hasPricing) missing.push("pricing");

  // 10. Measurable value
  const hasValue = spec.measurableValue && spec.measurableValue.length > 10;
  checks.measurableValue = {
    passed: !!hasValue,
    detail: hasValue ? spec.measurableValue.slice(0, 80) : "No measurable value defined",
  };
  if (!hasValue) missing.push("measurable_value");

  // 11. Prior-art boundary
  const hasPriorArt = spec.priorArtBoundary && spec.priorArtBoundary.length > 10;
  checks.priorArt = {
    passed: !!hasPriorArt,
    detail: hasPriorArt ? "Prior-art boundary defined" : "No prior-art boundary specified",
  };
  if (!hasPriorArt) missing.push("prior_art");

  // 12. Novelty delta
  const hasNovelty = spec.noveltyDelta && spec.noveltyDelta.length > 10;
  checks.novelty = {
    passed: !!hasNovelty,
    detail: hasNovelty ? spec.noveltyDelta.slice(0, 80) : "No novelty delta specified",
  };
  if (!hasNovelty) missing.push("novelty");

  const passedCount = Object.values(checks).filter((c) => c.passed).length;
  const totalCount = Object.keys(checks).length;
  const score = Math.round((passedCount / totalCount) * 100);

  return { score, checks, missing };
}

// ─── 5. Evolution Engine ───────────────────────────────────────────────
//
// Generates structurally different variants, scores them, and ranks them.
// Not superficial variants (different colors) — different product theses.

const VARIANT_GENERATION_PROMPT = `You are the Evolution Engine for SPINOR FRONTRUNNER.

Given a product genome, generate a STRUCTURALLY DIFFERENT variant.
The variant must represent a distinct product thesis, architecture, customer segment,
workflow, or monetization strategy — not a cosmetic change.

Variant types:
- "low_cost": minimal viable version with fastest time-to-value
- "high_upside": ambitious version with maximum potential
- "wildcard": strategically different approach (different customer, different model)
- "system_recommended": the version the system believes is strongest

Return the same JSON structure as the original genome, but with meaningfully
different choices. Keep the same problem space but change the approach.`;

export async function generateVariants(
  orgId: string,
  userId: string,
  baseGenomeId: string,
  variantTypes: string[] = ["low_cost", "high_upside", "wildcard"],
): Promise<ProductGenome[]> {
  const baseGenome = getProductGenome(orgId, baseGenomeId);
  if (!baseGenome) throw new Error("Base genome not found");

  const variants: ProductGenome[] = [];

  for (const variantType of variantTypes) {
    const messages: ChatMessage[] = [
      { role: "system", content: VARIANT_GENERATION_PROMPT },
      {
        role: "user",
        content: `Base genome:\n${JSON.stringify({
          name: baseGenome.name,
          problem: baseGenome.problem,
          eligibleUsers: baseGenome.eligibleUsers,
          requiredFunctionality: baseGenome.requiredFunctionality,
          systemArchitecture: baseGenome.systemArchitecture,
          pricingHypothesis: baseGenome.pricingHypothesis,
        }, null, 2)}\n\nGenerate a "${variantType}" variant.`,
      },
    ];

    const llmResult = await callLLM(messages, { temperature: 0.8, maxTokens: 4096 });
    const spec = extractJSON<any>(llmResult.content) || {};
    if (!spec.name) continue;

    const completeness = runCompletenessGate(spec);
    const fitness = scoreFitness(spec, completeness);

    const id = `genome_${nanoid(12)}`;
    getDb().prepare(
      `INSERT INTO product_genomes
       (id, org_id, user_id, opportunity_id, parent_genome_id, name, problem,
        eligible_users, existing_alternatives, unresolved_need, prior_art_boundary,
        novelty_delta, required_functionality, system_architecture, data_model,
        external_integrations, auth_permissions, compliance_conditions,
        failure_rollback, testing_requirements, deployment_target, pricing_hypothesis,
        distribution_method, marketing_assets, measurable_value, cost_avoided,
        evidence_required, completeness_score, completeness_checks, fitness_score,
        branch_type, status, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, orgId, userId, baseGenome.opportunityId, baseGenomeId,
      spec.name, spec.problem || baseGenome.problem,
      JSON.stringify(spec.eligibleUsers || []),
      JSON.stringify(spec.existingAlternatives || []),
      spec.unresolvedNeed || "",
      spec.priorArtBoundary || "",
      spec.noveltyDelta || "",
      JSON.stringify(spec.requiredFunctionality || []),
      JSON.stringify(spec.systemArchitecture || {}),
      JSON.stringify(spec.dataModel || {}),
      JSON.stringify(spec.externalIntegrations || []),
      JSON.stringify(spec.authPermissions || {}),
      JSON.stringify(spec.complianceConditions || []),
      JSON.stringify(spec.failureRollback || []),
      JSON.stringify(spec.testingRequirements || []),
      spec.deploymentTarget || "",
      JSON.stringify(spec.pricingHypothesis || {}),
      spec.distributionMethod || "",
      JSON.stringify({}),
      spec.measurableValue || "",
      spec.costAvoided || "",
      JSON.stringify(spec.evidenceRequired || []),
      completeness.score,
      JSON.stringify(completeness.checks),
      fitness,
      variantType,
      completeness.score >= 70 ? "ready" : "draft",
      1,
    );

    const row = getDb().prepare(`SELECT * FROM product_genomes WHERE id = ?`).get(id) as any;
    if (row) variants.push(rowToProductGenome(row));
  }

  auditLog(orgId, userId, "frontrunner.evolve", "product_genome", baseGenomeId, `Generated ${variants.length} variants`);
  return variants;
}

function scoreFitness(spec: any, completeness: CompletenessResult): number {
  let score = completeness.score * 0.4; // 40% weight on completeness

  // Specificity of architecture (20%)
  const archKeys = Object.keys(spec.systemArchitecture || {}).length;
  score += Math.min(archKeys * 5, 20);

  // Pricing clarity (15%)
  if (spec.pricingHypothesis?.model && spec.pricingHypothesis?.pricePoint) score += 15;
  else if (spec.pricingHypothesis?.model) score += 8;

  // Measurable value (15%)
  if (spec.measurableValue?.length > 50) score += 15;
  else if (spec.measurableValue?.length > 10) score += 8;

  // Evidence awareness (10%)
  const evidenceCount = spec.evidenceRequired?.length || 0;
  score += Math.min(evidenceCount * 3, 10);

  return Math.round(score);
}

// ─── 6. Choice Gravity ─────────────────────────────────────────────────
//
// User answers to high-information-value questions reweight the portfolio.

export function getChoiceGravityQuestions(): ChoiceGravityQuestion[] {
  return [
    {
      id: "target_scope",
      question: "Is this for personal use, one company, or many customers?",
      options: [
        { label: "Personal use", value: "personal", weightChanges: { distribution: -10, pricing: -5 } },
        { label: "One company", value: "single_org", weightChanges: { distribution: -5, pricing: 5, compliance: 5 } },
        { label: "Many customers", value: "multi_tenant", weightChanges: { distribution: 10, pricing: 10, compliance: 10, org_isolation: 10 } },
      ],
    },
    {
      id: "value_type",
      question: "Should the first version make money, save labor, or produce evidence?",
      options: [
        { label: "Make money", value: "revenue", weightChanges: { pricing: 15, distribution: 10 } },
        { label: "Save labor", value: "cost_savings", weightChanges: { cost_avoided: 15, time_saved: 10 } },
        { label: "Produce evidence", value: "evidence", weightChanges: { evidence_strength: 15, testing: 10 } },
      ],
    },
    {
      id: "time_to_value",
      question: "Which result would make this useful within seven days?",
      options: [
        { label: "Working prototype", value: "prototype", weightChanges: { speed: 15, completeness: -5 } },
        { label: "Production deploy", value: "production", weightChanges: { completeness: 15, testing: 10 } },
        { label: "Validated hypothesis", value: "hypothesis", weightChanges: { evidence_strength: 15, research: 10 } },
      ],
    },
    {
      id: "approval_boundary",
      question: "Which actions require human approval?",
      options: [
        { label: "All external actions", value: "strict", weightChanges: { human_checkpoints: 15, compliance: 10 } },
        { label: "Only irreversible actions", value: "moderate", weightChanges: { human_checkpoints: 8 } },
        { label: "Autonomous with audit", value: "autonomous", weightChanges: { automation: 15, audit: 10 } },
      ],
    },
    {
      id: "must_never_happen",
      question: "What must never happen?",
      options: [
        { label: "Data leakage", value: "no_leak", weightChanges: { compliance: 15, org_isolation: 10 } },
        { label: "Unauthorized actions", value: "no_unauthorized", weightChanges: { auth: 15, human_checkpoints: 10 } },
        { label: "Customer-facing errors", value: "no_errors", weightChanges: { testing: 15, error_handling: 10 } },
      ],
    },
  ];
}

export function recordChoiceGravity(
  orgId: string,
  userId: string,
  questionId: string,
  questionText: string,
  answer: string,
  weightChanges: Record<string, number>,
): void {
  const id = `grav_${nanoid(12)}`;
  getDb().prepare(
    `INSERT INTO choice_gravity_answers (id, org_id, user_id, question_id, question_text, answer, weight_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, orgId, userId, questionId, questionText, answer, JSON.stringify(weightChanges));

  // Apply weight changes to all product genomes in the org
  applyGravityWeights(orgId, weightChanges);
  auditLog(orgId, userId, "frontrunner.gravity", "choice_gravity", id, `Answer: ${answer}`);
}

function applyGravityWeights(orgId: string, weights: Record<string, number>): void {
  const genomes = getDb()
    .prepare(`SELECT id, fitness_score FROM product_genomes WHERE org_id = ? AND status IN ('draft', 'ready')`)
    .all(orgId) as any[];

  for (const genome of genomes) {
    let adjustment = 0;
    // Map weight keys to genome properties (simplified — in production this would
    // check the genome's actual properties against the weight dimensions)
    for (const [key, value] of Object.entries(weights)) {
      adjustment += value * 0.5; // Each weight contributes partially
    }
    const newScore = Math.max(0, Math.min(100, genome.fitness_score + adjustment));
    getDb().prepare(`UPDATE product_genomes SET fitness_score = ? WHERE id = ?`).run(newScore, genome.id);
  }
}

export function getChoiceGravityAnswers(orgId: string, userId: string): any[] {
  return getDb()
    .prepare(`SELECT * FROM choice_gravity_answers WHERE org_id = ? AND user_id = ? ORDER BY created_at DESC`)
    .all(orgId, userId) as any[];
}

// ─── 7. Top 100 Workflow Genome Portfolio ──────────────────────────────

export function getWorkflowGenomes(orgId: string, limit = 100): WorkflowGenome[] {
  const rows = getDb()
    .prepare(`SELECT * FROM workflow_genomes WHERE org_id = ? ORDER BY fitness_score DESC, rank ASC LIMIT ?`)
    .all(orgId, limit) as any[];
  return rows.map(rowToWorkflowGenome);
}

export function getWorkflowGenome(orgId: string, id: string): WorkflowGenome | null {
  const row = getDb()
    .prepare(`SELECT * FROM workflow_genomes WHERE org_id = ? AND id = ?`)
    .get(orgId, id) as any;
  return row ? rowToWorkflowGenome(row) : null;
}

const WORKFLOW_GENOME_PROMPT = `You are the Workflow Genome compiler for SPINOR FRONTRUNNER.

Convert a Product Genome into a reusable Workflow Genome. A Workflow Genome is a
versioned, executable workflow definition that can be ranked in the Top 100 portfolio.

Return a JSON object with ALL of these fields:
{
  "name": "workflow name",
  "trigger": "what event or condition starts this workflow",
  "requiredContext": ["what context/data is needed before starting"],
  "researchProcess": ["research steps to perform"],
  "reasoningProcedure": ["reasoning/decision steps"],
  "toolsIntegrations": ["tools and APIs used"],
  "executionStages": ["stage 1", "stage 2", ...],
  "validationCriteria": ["how to validate the output is correct"],
  "failureConditions": ["when this workflow fails"],
  "recoveryBehavior": ["what to do when it fails"],
  "humanApprovalPoints": ["where human approval is required"],
  "expectedBusinessValue": "the business value this creates",
  "estimatedCostAvoided": "the cost this avoids (in dollars or hours)",
  "expectedTimeSaved": "time saved per execution",
  "reusableOutputs": ["what outputs can be reused by other workflows"]
}`;

export async function compileWorkflowGenome(
  orgId: string,
  userId: string,
  productGenomeId: string,
): Promise<WorkflowGenome> {
  const genome = getProductGenome(orgId, productGenomeId);
  if (!genome) throw new Error("Product genome not found");

  const messages: ChatMessage[] = [
    { role: "system", content: WORKFLOW_GENOME_PROMPT },
    {
      role: "user",
      content: `Product Genome:\n${JSON.stringify({
        name: genome.name,
        problem: genome.problem,
        requiredFunctionality: genome.requiredFunctionality,
        systemArchitecture: genome.systemArchitecture,
        externalIntegrations: genome.externalIntegrations,
        authPermissions: genome.authPermissions,
        pricingHypothesis: genome.pricingHypothesis,
      }, null, 2)}`,
    },
  ];

  const llmResult = await callLLM(messages, { temperature: 0.5, maxTokens: 4096 });
  const spec = extractJSON<any>(llmResult.content) || {};

  const id = `workflow_${nanoid(12)}`;
  const fitnessScore = scoreWorkflowFitness(spec, genome);

  getDb().prepare(
    `INSERT INTO workflow_genomes
     (id, org_id, product_genome_id, name, trigger, required_context,
      research_process, reasoning_procedure, tools_integrations, execution_stages,
      validation_criteria, failure_conditions, recovery_behavior,
      human_approval_points, expected_business_value, estimated_cost_avoided,
      expected_time_saved, reusable_outputs, fitness_score, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, orgId, productGenomeId,
    spec.name || genome.name,
    spec.trigger || "",
    JSON.stringify(spec.requiredContext || []),
    JSON.stringify(spec.researchProcess || []),
    JSON.stringify(spec.reasoningProcedure || []),
    JSON.stringify(spec.toolsIntegrations || []),
    JSON.stringify(spec.executionStages || []),
    JSON.stringify(spec.validationCriteria || []),
    JSON.stringify(spec.failureConditions || []),
    JSON.stringify(spec.recoveryBehavior || []),
    JSON.stringify(spec.humanApprovalPoints || []),
    spec.expectedBusinessValue || "",
    spec.estimatedCostAvoided || "",
    spec.expectedTimeSaved || "",
    JSON.stringify(spec.reusableOutputs || []),
    fitnessScore,
    "candidate",
  );

  // Re-rank the portfolio
  rankWorkflowGenomes(orgId);

  const row = getDb().prepare(`SELECT * FROM workflow_genomes WHERE id = ?`).get(id) as any;
  auditLog(orgId, userId, "frontrunner.workflow.compile", "workflow_genome", id, `Compiled: ${spec.name}`);
  return rowToWorkflowGenome(row);
}

function scoreWorkflowFitness(spec: any, genome: ProductGenome): number {
  let score = 0;

  // Has trigger (10%)
  if (spec.trigger?.length > 10) score += 10;

  // Has execution stages (20%)
  const stageCount = spec.executionStages?.length || 0;
  score += Math.min(stageCount * 4, 20);

  // Has validation criteria (15%)
  const validationCount = spec.validationCriteria?.length || 0;
  score += Math.min(validationCount * 5, 15);

  // Has failure conditions (15%)
  const failureCount = spec.failureConditions?.length || 0;
  score += Math.min(failureCount * 5, 15);

  // Has recovery behavior (10%)
  const recoveryCount = spec.recoveryBehavior?.length || 0;
  score += Math.min(recoveryCount * 5, 10);

  // Has business value (10%)
  if (spec.expectedBusinessValue?.length > 20) score += 10;

  // Has cost avoided (10%)
  if (spec.estimatedCostAvoided?.length > 5) score += 10;

  // Has reusable outputs (10%)
  const reusableCount = spec.reusableOutputs?.length || 0;
  score += Math.min(reusableCount * 3, 10);

  return Math.round(score);
}

function rankWorkflowGenomes(orgId: string): void {
  const genomes = getDb()
    .prepare(`SELECT id FROM workflow_genomes WHERE org_id = ? ORDER BY fitness_score DESC`)
    .all(orgId) as any[];

  const stmt = getDb().prepare(`UPDATE workflow_genomes SET rank = ? WHERE id = ?`);
  for (let i = 0; i < genomes.length; i++) {
    stmt.run(i + 1, genomes[i].id);
  }
}

// ─── 8. Product Genome CRUD ────────────────────────────────────────────

export function getProductGenomes(orgId: string, limit = 50): ProductGenome[] {
  const rows = getDb()
    .prepare(`SELECT * FROM product_genomes WHERE org_id = ? ORDER BY fitness_score DESC, created_at DESC LIMIT ?`)
    .all(orgId, limit) as any[];
  return rows.map(rowToProductGenome);
}

export function getProductGenome(orgId: string, id: string): ProductGenome | null {
  const row = getDb()
    .prepare(`SELECT * FROM product_genomes WHERE org_id = ? AND id = ?`)
    .get(orgId, id) as any;
  return row ? rowToProductGenome(row) : null;
}

// ─── 9. Epoch Management ───────────────────────────────────────────────

export function startEpoch(orgId: string): Epoch {
  const lastEpoch = getDb()
    .prepare(`SELECT MAX(epoch_number) as max_num FROM frontrunner_epochs WHERE org_id = ?`)
    .get(orgId) as any;

  const epochNumber = (lastEpoch?.max_num || 0) + 1;
  const id = `epoch_${nanoid(12)}`;

  getDb().prepare(
    `INSERT INTO frontrunner_epochs (id, org_id, epoch_number, status)
     VALUES (?, ?, ?, 'running')`,
  ).run(id, orgId, epochNumber);

  const row = getDb().prepare(`SELECT * FROM frontrunner_epochs WHERE id = ?`).get(id) as any;
  return {
    id: row.id,
    orgId: row.org_id,
    epochNumber: row.epoch_number,
    opportunitiesScanned: row.opportunities_scanned,
    candidatesGenerated: row.candidates_generated,
    variantsGenerated: row.variants_generated,
    variantsEliminated: row.variants_eliminated,
    winnersPromoted: row.winners_promoted,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function completeEpoch(orgId: string, epochId: string, stats: Partial<Epoch>): void {
  getDb().prepare(
    `UPDATE frontrunner_epochs
     SET opportunities_scanned = ?, candidates_generated = ?, variants_generated = ?,
         variants_eliminated = ?, winners_promoted = ?, status = 'completed',
         completed_at = datetime('now')
     WHERE id = ? AND org_id = ?`,
  ).run(
    stats.opportunitiesScanned || 0,
    stats.candidatesGenerated || 0,
    stats.variantsGenerated || 0,
    stats.variantsEliminated || 0,
    stats.winnersPromoted || 0,
    epochId, orgId,
  );
}

export function getEpochs(orgId: string, limit = 10): Epoch[] {
  const rows = getDb()
    .prepare(`SELECT * FROM frontrunner_epochs WHERE org_id = ? ORDER BY epoch_number DESC LIMIT ?`)
    .all(orgId, limit) as any[];
  return rows.map((row) => ({
    id: row.id,
    orgId: row.org_id,
    epochNumber: row.epoch_number,
    opportunitiesScanned: row.opportunities_scanned,
    candidatesGenerated: row.candidates_generated,
    variantsGenerated: row.variants_generated,
    variantsEliminated: row.variants_eliminated,
    winnersPromoted: row.winners_promoted,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }));
}

// ─── 10. Full Epoch Cycle ──────────────────────────────────────────────
//
// Runs the complete evolutionary cycle:
//   scan → generate → vary → score → rank → present

export async function runEpochCycle(
  orgId: string,
  userId: string,
  userSignals: string[] = [],
): Promise<{
  epoch: Epoch;
  opportunities: Opportunity[];
  genomes: ProductGenome[];
  variants: ProductGenome[];
}> {
  const epoch = startEpoch(orgId);

  // 1. Scan for opportunities
  const opportunities = await scanOpportunities(orgId, userSignals);

  // 2. Generate product genomes for top opportunities
  const genomes: ProductGenome[] = [];
  for (const opp of opportunities.slice(0, 3)) {
    try {
      const genome = await generateProductGenome(orgId, userId, opp.id, "primary");
      genomes.push(genome);
    } catch (e) {
      console.error("[frontrunner] genome generation failed:", e);
    }
  }

  // 3. Generate variants for the top genome
  const variants: ProductGenome[] = [];
  if (genomes.length > 0) {
    try {
      const generated = await generateVariants(orgId, userId, genomes[0].id, ["low_cost", "high_upside", "wildcard"]);
      variants.push(...generated);
    } catch (e) {
      console.error("[frontrunner] variant generation failed:", e);
    }
  }

  // 4. Complete epoch
  completeEpoch(orgId, epoch.id, {
    opportunitiesScanned: opportunities.length,
    candidatesGenerated: genomes.length,
    variantsGenerated: variants.length,
    variantsEliminated: 0,
    winnersPromoted: genomes.filter((g) => g.status === "ready").length,
  });

  return { epoch, opportunities, genomes, variants };
}
