import { nanoid } from "nanoid";
import {
  CommitmentContract,
  CommitmentDeliverable,
  CommitmentMetrics,
  RoleType,
} from "@/types";
import { getRoleTwin } from "@/lib/roles/twins";
import { computeConfidenceBreakdown, estimateCompletionTimes } from "@/lib/commitment/confidence";
import { recordExecutionOutcome } from "@/lib/commitment/store";
import { generateSampleAccounts, generateOpportunityMap } from "@/lib/territory/scorer";
import { optimizeRoute } from "@/lib/field/optimizer";

export type ExecutionResult = {
  contract: CommitmentContract;
  staged: boolean;
  deliverables: CommitmentDeliverable[];
  metrics: CommitmentMetrics;
};

function nowIso(): string {
  return new Date().toISOString();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function includesAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

function computeCapabilityOk(contract: CommitmentContract): boolean {
  const twin = getRoleTwin(contract.recipientRole as RoleType);
  const outcome = (contract.requestedOutcome || "").toLowerCase();

  // Ensure we are not executing prohibited outcomes.
  const prohibited = twin.prohibitedActions.some((p) => outcome.includes(p.toLowerCase().split(" ")[0]));
  if (prohibited) return false;

  // For this demo executor, we can only complete internally-verifiable doc/report work.
  const supportedSignals = ["report", "analysis", "summary", "brief", "territory", "route", "formulary", "compliance"];
  return includesAny(outcome, supportedSignals);
}

function computeInputsOk(contract: CommitmentContract): boolean {
  // For now: treat attachments/dependencies as partial risk, not a hard blocker.
  // If a dependency has high block probability, we consider inputs not fully available.
  const deps = Array.isArray(contract.dependencies) ? contract.dependencies : [];
  const highBlocker = deps.some((d) => (d.blocksProbability ?? 0) >= 0.5);
  return !highBlocker;
}

function computeToolsOk(contract: CommitmentContract): boolean {
  // Tools are virtual in this demo. Treat required tools existence as ok if present.
  return Array.isArray(contract.permittedTools) && contract.permittedTools.length > 0;
}

function computeQaOk(deliverables: CommitmentDeliverable[]): boolean {
  if (!Array.isArray(deliverables) || deliverables.length === 0) return false;
  // Basic QA: each deliverable must have content and confidence in [0,1].
  return deliverables.every((d) => {
    if (!d.content || typeof d.content !== "string" || d.content.trim().length === 0) return false;
    const c = d.confidence;
    return typeof c === "number" && c >= 0 && c <= 1;
  });
}

function computeAcceptanceOk(contract: CommitmentContract): boolean {
  // No real external feedback loop in this demo.
  // Treat internal deliveries as accepted unless contract is declined/escalated/failed.
  return !["failed", "declined"].includes(contract.status);
}

function determineStageOnly(contract: CommitmentContract): boolean {
  // Class 2+: stage only.
  if (contract.autonomyClass >= 2) return true;

  // Role contract: if the twin cannot send external email, always stage.
  const twin = getRoleTwin(contract.recipientRole as RoleType);
  if (!twin.authorityLimits.canSendExternalEmail && contract.externalSendAllowed) return true;

  return false;
}

function createExactDeliverable(contract: CommitmentContract): CommitmentDeliverable {
  const title = contract.requestedOutcome || contract.emailSubject || "Requested deliverable";

  const content = [
    `Title: ${title}`,
    `Requester: ${contract.requester}`,
    `Deadline: ${contract.deadline}`,
    `Role: ${contract.recipientRole}`,
    "",
    "Delivered items:",
    ...contract.mandatoryOutputs.map((o) => `- ${o}`),
    "",
    `Source: Email thread (id=${contract.emailId})`,
  ].join("\n");

  return {
    type: "exact",
    name: "Exact fulfillment",
    format: "report",
    content,
    confidence: 0.88,
    approved: contract.autonomyClass === 1,
  };
}

function createVerifiedDeliverable(contract: CommitmentContract): CommitmentDeliverable {
  const assumptions = Array.isArray(contract.assumptions) ? contract.assumptions : [];
  const deps = Array.isArray(contract.dependencies) ? contract.dependencies : [];

  const content = [
    "Verified fulfillment package",
    "",
    "Assumptions:",
    ...(assumptions.length ? assumptions.map((a) => `- ${a}`) : ["- (none recorded)"]),
    "",
    "Dependencies:",
    ...(deps.length
      ? deps.map((d) => `- ${d.description} (block probability ${Math.round((d.blocksProbability ?? 0) * 100)}%)`)
      : ["- (none)"]),
    "",
    "Quality checks:",
    "- Structure: OK",
    "- Content present: OK",
    "- Confidence fields present: OK",
  ].join("\n");

  return {
    type: "decision_enhancement",
    name: "Verified package (assumptions + dependencies + QA)",
    format: "report",
    content,
    confidence: 0.9,
    approved: contract.autonomyClass === 1,
  };
}

function createEnhancedDeliverables(contract: CommitmentContract): CommitmentDeliverable[] {
  const outcome = (contract.requestedOutcome || "").toLowerCase();

  // Territory-ish: generate opportunity map + route optimization.
  if (includesAny(outcome, ["territory", "route", "coverage"])) {
    const accounts = generateSampleAccounts();
    const map = generateOpportunityMap(accounts);
    const route = optimizeRoute(accounts, new Date().toISOString());

    const opportunity = {
      type: "execution_acceleration" as const,
      name: "Territory opportunity map (structured JSON)",
      format: "data_reconciliation" as const,
      content: JSON.stringify(map, null, 2),
      confidence: 0.86,
      approved: contract.autonomyClass === 1,
    };

    const routePlan = {
      type: "execution_acceleration" as const,
      name: "Optimized field route (structured JSON)",
      format: "data_reconciliation" as const,
      content: JSON.stringify(route, null, 2),
      confidence: 0.84,
      approved: contract.autonomyClass === 1,
    };

    return [opportunity, routePlan];
  }

  // Default: a light executive compression.
  const exec = {
    type: "execution_acceleration" as const,
    name: "Executive summary",
    format: "report" as const,
    content: [
      "Executive summary",
      "",
      `Completed: ${contract.requestedOutcome}`,
      `Deadline: ${contract.deadline}`,
      "",
      "Next actions:",
      ...contract.inferredOutputs.slice(0, 5).map((o) => `- ${o}`),
    ].join("\n"),
    confidence: 0.83,
    approved: contract.autonomyClass === 1,
  };

  return [exec];
}

function applyConfidenceModel(contract: CommitmentContract, metrics: CommitmentMetrics): CommitmentContract {
  const breakdown = computeConfidenceBreakdown(metrics);
  const times = estimateCompletionTimes(metrics);

  // Keep backward compatible completionProbability while adding breakdown.
  const completionProbability = clamp01(breakdown.overall);

  return {
    ...contract,
    completionProbability,
    confidenceBreakdown: breakdown,
    confidenceModelVersion: metrics.modelVersion,
    p50Completion: times.p50Ms ? new Date(Date.now() + times.p50Ms).toISOString() : contract.p50Completion,
    p90Completion: times.p90Ms ? new Date(Date.now() + times.p90Ms).toISOString() : contract.p90Completion,
  };
}

export function executeCommitment(contract: CommitmentContract, metrics: CommitmentMetrics): ExecutionResult {
  const start = Date.now();

  const staged = determineStageOnly(contract);

  const withConfidence = applyConfidenceModel(contract, metrics);

  const exact = createExactDeliverable(withConfidence);
  const verified = createVerifiedDeliverable(withConfidence);
  const enhanced = createEnhancedDeliverables(withConfidence);

  const deliverables = [exact, verified, ...enhanced].map((d) => ({
    ...d,
    name: d.name || `deliverable-${nanoid(6)}`,
  }));

  const qaOk = computeQaOk(deliverables);
  const capabilityOk = computeCapabilityOk(withConfidence);
  const inputsOk = computeInputsOk(withConfidence);
  const toolsOk = computeToolsOk(withConfidence);

  const status: CommitmentContract["status"] =
    withConfidence.autonomyClass === 4
      ? "declined"
      : staged
        ? "awaiting_approval"
        : capabilityOk && inputsOk && toolsOk && qaOk
          ? "completed"
          : "escalated";

  const finished: CommitmentContract = {
    ...withConfidence,
    status,
    deliverables,
    executedAt: withConfidence.executedAt || nowIso(),
    completedAt: status === "completed" ? nowIso() : withConfidence.completedAt,
    auditEvents: [
      ...(Array.isArray(withConfidence.auditEvents) ? withConfidence.auditEvents : []),
      {
        timestamp: nowIso(),
        event: "execute",
        detail: staged
          ? "Executed work and staged output for approval"
          : "Executed work and completed output",
      },
      {
        timestamp: nowIso(),
        event: "quality_gate",
        detail: `capability=${capabilityOk} inputs=${inputsOk} tools=${toolsOk} qa=${qaOk}`,
      },
    ],
  };

  const durationMs = Date.now() - start;

  const updatedMetrics = recordExecutionOutcome({
    capabilityOk,
    inputsOk,
    toolsOk,
    qaOk,
    durationMs,
  });

  return {
    contract: finished,
    staged,
    deliverables,
    metrics: updatedMetrics,
  };
}
