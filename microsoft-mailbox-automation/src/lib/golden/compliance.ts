import { ComplianceCheckResult, HypothesisAnatomy, ProcessDefinition, ProcessStep } from "@/types";

const now = () => new Date().toISOString();

// Pharma boundaries: the system may experiment with workflow/operations but must
// never experiment with clinical-judgment surfaces. See GOLDEN NODE §20.

const FORBIDDEN_TERMS = [
  "unapproved claim",
  "off-label",
  "safety information",
  "indication",
  "prescribing pressure",
  "patient-level targeting",
  "fair balance",
  "misleading",
  "clinical judgment",
  "efficacy claim",
  "comparative efficacy",
];

const FORBIDDEN_INTERVENTION_PATTERNS = [
  /modify.*approved claim/i,
  /change.*safety/i,
  /withhold.*safety/i,
  /patient.*target/i,
  /prescrib.*pressure/i,
  /incentiv.*prescri/i,
];

const ALLOWED_WORKFLOW_TERMS = [
  "workflow",
  "sequence",
  "timing",
  "channel",
  "stakeholder order",
  "follow-up",
  "automation",
  "self-service",
  "account prioritization",
  "route design",
  "administrative system",
];

/** Check a hypothesis against pharma boundaries before it can be assigned. */
export function checkHypothesis(h: HypothesisAnatomy): ComplianceCheckResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  const text = [
    h.claim,
    h.intervention,
    h.control,
    h.complianceBoundary,
    h.targetCondition,
    ...(h.fixedConstraints || []),
  ].join(" \n ");

  for (const term of FORBIDDEN_TERMS) {
    if (text.toLowerCase().includes(term)) {
      violations.push(`Forbidden term in hypothesis: "${term}"`);
    }
  }
  for (const pattern of FORBIDDEN_INTERVENTION_PATTERNS) {
    if (pattern.test(text)) {
      violations.push(`Forbidden intervention pattern: ${pattern.source}`);
    }
  }

  if (!h.complianceBoundary || h.complianceBoundary.trim().length === 0) {
    warnings.push("Hypothesis has no explicit compliance boundary");
  }

  const mentionsAllowed = ALLOWED_WORKFLOW_TERMS.some((t) => text.toLowerCase().includes(t));
  if (!mentionsAllowed) {
    warnings.push("Hypothesis does not reference an allowed workflow/operational dimension");
  }

  // Digital-ability inference must not rely on stereotypes.
  const stereotypeTerms = ["age", "older", "elderly", "young", "younger", "appearance", "specialty stereotype", "gender", "demographic", "tech savvy", "not tech savvy"];
  const stereoHit = stereotypeTerms.find((t) => text.toLowerCase().includes(t));
  if (stereoHit) {
    violations.push(`Digital ability must not be inferred from stereotypes ("${stereoHit}")`);
  }

  return { allowed: violations.length === 0, violations, warnings, checkedAt: now() };
}

/** Check a process definition built in the System Builder. */
export function checkProcess(p: ProcessDefinition): ComplianceCheckResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  const allText = [
    p.name,
    p.objective,
    p.complianceBoundary,
    ...p.steps.map((s) => s.label),
    ...p.steps.map((s) => s.condition || ""),
    ...p.eligibilityRules,
  ].join(" \n ");

  for (const term of FORBIDDEN_TERMS) {
    if (allText.toLowerCase().includes(term)) {
      violations.push(`Forbidden term in process: "${term}"`);
    }
  }
  for (const pattern of FORBIDDEN_INTERVENTION_PATTERNS) {
    if (pattern.test(allText)) {
      violations.push(`Forbidden process pattern: ${pattern.source}`);
    }
  }

  if (!p.complianceBoundary || p.complianceBoundary.trim().length === 0) {
    warnings.push("Process has no explicit compliance boundary");
  }

  // Every action step must reference approved content/workflow only.
  for (const step of p.steps) {
    if (step.type === "action" && /unapproved|off-label/i.test(step.label)) {
      violations.push(`Action step "${step.label}" references unapproved content`);
    }
  }

  // Process must contain at least one measurement step to be testable.
  if (!p.steps.some((s: ProcessStep) => s.type === "measurement")) {
    warnings.push("Process has no measurement step; outcomes cannot be attributed");
  }

  return { allowed: violations.length === 0, violations, warnings, checkedAt: now() };
}

/** Whether a modification dimension is permitted under pharma boundaries. */
export function isModifiableDimensionAllowed(
  dimension: string,
  hypothesis: HypothesisAnatomy
): boolean {
  // All defined innovation dimensions are operational; none touch clinical claims.
  const operationalDimensions = [
    "stakeholder",
    "timing",
    "channel",
    "content_sequence",
    "automation_step",
    "followup_interval",
  ];
  if (!operationalDimensions.includes(dimension)) return false;
  // content_sequence is allowed only for approved-content sequencing, not claim edits.
  if (dimension === "content_sequence") {
    return /approved/i.test(hypothesis.complianceBoundary);
  }
  return true;
}
