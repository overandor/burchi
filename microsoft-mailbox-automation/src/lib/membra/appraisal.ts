/**
 * Membra Appraisal — Phase 6
 *
 * Scores artifacts on reproducibility, security, maintainability,
 * dependency stability, provenance, license clarity, uniqueness,
 * and usage evidence. Generates valuation ranges with assumptions.
 */

import { nanoid } from "nanoid";
import type {
  AppraisalReport,
  AppraisalDimensions,
  TechnicalScore,
  ValuationRange,
  GGFUManifest,
  ScanResult,
  ArtifactGraph,
  ExecutionReceipt,
  ContinuityEvent,
} from "@/types";

const APPRAISAL_DISCLAIMER =
  "This appraisal is generated from automated technical analysis and is not a legal valuation, " +
  "audited financial assessment, or guarantee of market value. All assumptions are listed in the report.";

const SCORE_WEIGHTS: { dimension: keyof AppraisalDimensions; weight: number }[] = [
  { dimension: "reproducibility", weight: 0.20 },
  { dimension: "security", weight: 0.15 },
  { dimension: "maintainability", weight: 0.15 },
  { dimension: "testCoverage", weight: 0.10 },
  { dimension: "provenanceCompleteness", weight: 0.10 },
  { dimension: "licenseClarity", weight: 0.10 },
  { dimension: "uniqueness", weight: 0.10 },
  { dimension: "usageEvidence", weight: 0.10 },
];

/** Compute a technical score from appraisal dimensions. */
export function computeTechnicalScore(dimensions: AppraisalDimensions): TechnicalScore {
  const breakdown = SCORE_WEIGHTS.map(({ dimension, weight }) => {
    const value = dimensions[dimension];
    return {
      dimension,
      weight,
      value,
      contribution: weight * value,
    };
  });

  const score = breakdown.reduce((sum, b) => sum + b.contribution, 0);
  return { score, breakdown };
}

/** Compute appraisal dimensions from available evidence. */
export function computeDimensions(input: {
  manifest: GGFUManifest;
  scan?: ScanResult;
  graph?: ArtifactGraph;
  receipts?: ExecutionReceipt[];
  events?: ContinuityEvent[];
  testResults?: { passed: boolean; testCount: number; failureCount: number }[];
}): AppraisalDimensions {
  const { manifest, scan, graph, receipts, events, testResults } = input;

  // Reproducibility: based on whether we have receipts with matching output hashes.
  let reproducibility = 0.5;
  if (receipts && receipts.length > 0) {
    const successful = receipts.filter(r => r.status === "completed").length;
    reproducibility = Math.min(1, successful / Math.max(receipts.length, 1));
  }

  // Security: penalize for secret findings.
  let security = 0.8;
  if (scan) {
    const secretPenalty = Math.min(0.5, scan.secretCount * 0.1);
    security = 0.8 - secretPenalty;
  }

  // Maintainability: based on documentation presence and file organization.
  let maintainability = 0.5;
  if (scan) {
    const docFiles = scan.files.filter(f => f.fileClass === "documentation").length;
    const totalFiles = scan.totalFiles || 1;
    maintainability = Math.min(1, 0.3 + (docFiles / totalFiles) * 2);
  }

  // Dependency stability: based on number of dependencies (fewer = more stable).
  let dependencyStability = 0.7;
  if (scan) {
    const depCount = scan.detectedDependencies.length;
    dependencyStability = Math.max(0.2, 1 - depCount * 0.05);
  }

  // Test coverage: based on test file ratio.
  let testCoverage = 0.3;
  if (scan) {
    const testFiles = scan.files.filter(f => f.fileClass === "python_test").length;
    const sourceFiles = scan.files.filter(f => f.fileClass === "python_source").length;
    if (sourceFiles > 0) {
      testCoverage = Math.min(1, testFiles / sourceFiles);
    }
  }
  if (testResults && testResults.length > 0) {
    const passed = testResults.filter(t => t.passed).length;
    testCoverage = Math.min(1, (testCoverage + passed / testResults.length) / 2);
  }

  // Documentation quality.
  let documentationQuality = 0.4;
  if (scan) {
    const docFiles = scan.files.filter(f => f.fileClass === "documentation").length;
    documentationQuality = Math.min(1, 0.3 + docFiles * 0.1);
  }

  // Provenance completeness.
  let provenanceCompleteness = 0.5;
  if (manifest.provenance.sourceUri !== "unknown") provenanceCompleteness += 0.2;
  if (manifest.provenance.sourceCommit !== "unknown") provenanceCompleteness += 0.15;
  if (manifest.provenance.buildRecipeHash) provenanceCompleteness += 0.15;
  provenanceCompleteness = Math.min(1, provenanceCompleteness);
  if (events && events.length > 0) {
    provenanceCompleteness = Math.min(1, provenanceCompleteness + 0.1);
  }

  // License clarity.
  let licenseClarity = 0.3;
  if (manifest.license.spdxId !== "UNLICENSED") licenseClarity = 0.8;
  if (manifest.license.spdxId === "UNLICENSED" && manifest.license.customTerms) licenseClarity = 0.5;

  // Uniqueness: based on duplicate ratio.
  let uniqueness = 0.7;
  if (scan && scan.totalFiles > 0) {
    const duplicateFiles = scan.duplicateClusters.reduce((sum, c) => sum + c.files.length - 1, 0);
    uniqueness = Math.max(0.2, 1 - duplicateFiles / scan.totalFiles);
  }

  // Usage evidence: based on execution receipts.
  let usageEvidence = 0.2;
  if (receipts && receipts.length > 0) {
    usageEvidence = Math.min(1, 0.3 + receipts.length * 0.15);
  }

  // Integration cost (higher = harder to integrate).
  let integrationCost = 0.5;
  if (manifest.dependencies.length > 5) integrationCost = 0.8;
  if (manifest.dependencies.length <= 2) integrationCost = 0.3;

  // Replacement cost (higher = harder to replace).
  let replacementCost = 0.5;
  if (uniqueness > 0.7) replacementCost = 0.8;
  if (uniqueness < 0.4) replacementCost = 0.3;

  // Market relevance.
  let marketRelevance = 0.5;
  if (manifest.tags.includes("ai") || manifest.tags.includes("llm")) marketRelevance = 0.8;

  return {
    reproducibility,
    security,
    maintainability,
    dependencyStability,
    testCoverage,
    documentationQuality,
    provenanceCompleteness,
    licenseClarity,
    uniqueness,
    usageEvidence,
    integrationCost,
    replacementCost,
    marketRelevance,
  };
}

/** Generate a valuation range from dimensions and technical score. */
export function computeValuation(
  dimensions: AppraisalDimensions,
  technicalScore: TechnicalScore,
  replacementCostEstimate: number
): ValuationRange {
  const qualityFactor = technicalScore.score;
  const demandFactor = dimensions.marketRelevance;
  const transferabilityFactor = 1 - dimensions.integrationCost;
  const confidenceDiscount = 0.6; // Conservative.

  const base = replacementCostEstimate * qualityFactor * demandFactor * transferabilityFactor;

  return {
    low: Math.round(base * 0.5 * confidenceDiscount),
    mid: Math.round(base * confidenceDiscount),
    high: Math.round(base * 1.5 * confidenceDiscount),
    currency: "USD",
    assumptions: [
      `Replacement cost estimate: $${replacementCostEstimate}`,
      `Technical quality factor: ${qualityFactor.toFixed(3)}`,
      `Demand factor: ${demandFactor.toFixed(3)}`,
      `Transferability factor: ${transferabilityFactor.toFixed(3)}`,
      `Confidence discount: ${confidenceDiscount.toFixed(2)}`,
      "Valuation is informational, not audited.",
    ],
    confidenceDiscount,
  };
}

/** Generate a complete appraisal report. */
export function generateAppraisal(input: {
  manifest: GGFUManifest;
  scan?: ScanResult;
  graph?: ArtifactGraph;
  receipts?: ExecutionReceipt[];
  events?: ContinuityEvent[];
  testResults?: { passed: boolean; testCount: number; failureCount: number }[];
  replacementCostEstimate?: number;
}): AppraisalReport {
  const dimensions = computeDimensions(input);
  const technicalScore = computeTechnicalScore(dimensions);
  const valuation = computeValuation(
    dimensions,
    technicalScore,
    input.replacementCostEstimate ?? 10000
  );

  const securityFindings: string[] = [];
  if (input.scan) {
    for (const file of input.scan.files) {
      for (const finding of file.secretFindings) {
        securityFindings.push(
          `${file.relativePath}:${finding.line} — ${finding.pattern} (${finding.severity})`
        );
      }
    }
  }

  const dependencyRisks: string[] = [];
  if (input.scan) {
    for (const dep of input.scan.detectedDependencies) {
      if (!dep.version) {
        dependencyRisks.push(`${dep.name}: unpinned version (found in ${dep.foundIn.length} file(s))`);
      }
    }
  }

  return {
    appraisalId: `appraisal_${nanoid(12)}`,
    targetGgfuId: input.manifest.ggfuId,
    targetName: input.manifest.name,
    generatedAt: new Date().toISOString(),
    dimensions,
    technicalScore,
    valuation,
    securityFindings,
    dependencyRisks,
    evidenceReferences: [
      ...(input.receipts ?? []).map(r => r.receiptId),
      ...(input.events ?? []).map(e => e.eventId),
    ],
    disclaimer: APPRAISAL_DISCLAIMER,
  };
}
