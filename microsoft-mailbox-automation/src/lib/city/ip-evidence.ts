import { nanoid } from "nanoid";
import {
  IPEvidencePackage,
  MarketTestResult,
  AppEvaluationResult,
  MinimumRequirements,
} from "@/types";
import { hashObject } from "./merkle";
import { recordMaterialEvent } from "./identity";
import { getPriorArtSearchForApp } from "./prior-art-search";
import { getDifferentiationResult, checkMinimumRequirements } from "./differentiation";
import { getLineageRecord } from "./lineage";
import { getKeyPair } from "./merkle-bridge";
import {
  loadCityIPEvidencePackages,
  saveCityIPEvidencePackages,
  loadCityMarketTestResults,
  saveCityMarketTestResults,
  loadCityEvaluationResults,
  saveCityEvaluationResults,
  loadCityEvents,
} from "@/lib/config";
import { buildSignedMerkleRoot } from "./merkle";

const now = () => new Date().toISOString();

/** Assemble the IP evidence package for an app.
 *
 * This package proves where the app came from, what evidence informed
 * its claimed differentiation, which components it inherited, what it
 * changed, how it was executed, and what market or IP position it is
 * attempting to defend. */
export function assembleIPEvidencePackage(appId: string): {
  pkg: IPEvidencePackage;
  error?: string;
} {
  const search = getPriorArtSearchForApp(appId);
  if (!search) {
    return {
      pkg: null as unknown as IPEvidencePackage,
      error: `No prior-art search found for app ${appId}`,
    };
  }

  const diffResult = getDifferentiationResult(appId);
  if (!diffResult) {
    return {
      pkg: null as unknown as IPEvidencePackage,
      error: `No differentiation result found for app ${appId}`,
    };
  }

  const lineage = getLineageRecord(appId);
  if (!lineage) {
    return {
      pkg: null as unknown as IPEvidencePackage,
      error: `No lineage record found for app ${appId}`,
    };
  }

  // Compute current Merkle root.
  const events = loadCityEvents().filter((e) => e.appId === appId);
  const keyPair = getKeyPair(appId);
  let merkleRootHash = "";
  if (keyPair && events.length > 0) {
    const root = buildSignedMerkleRoot(appId, events, keyPair, null);
    merkleRootHash = root.rootHash;
  }

  const pkgBase = {
    id: `ip_${nanoid(10)}`,
    appId,
    priorArtSearchId: search.id,
    differentiationResultId: diffResult.appId,
    differentiatingClaims: search.differentiatingClaims,
    searchBoundaries: search.searchBoundaries,
    sourcesConsulted: search.sources,
    merkleRootHash,
    lineageRecordHash: lineage.contentHash,
    noveltyDisclaimer: search.noveltyDisclaimer,
    patentCounselReviewed: search.differentiatingClaims.some(
      (c) => c.patentCounselReviewed
    ),
    counselReviewNotes: search.differentiatingClaims
      .filter((c) => c.counselAssessment)
      .map((c) => `${c.claim}: ${c.counselAssessment}`)
      .join("; ") || null,
    assembledAt: now(),
  };

  const contentHash = hashObject(pkgBase);
  const pkg: IPEvidencePackage = {
    ...pkgBase,
    contentHash,
  };

  const all = loadCityIPEvidencePackages();
  // Replace existing package for this app if present.
  const idx = all.findIndex((p) => p.appId === appId);
  if (idx >= 0) all[idx] = pkg;
  else all.push(pkg);
  saveCityIPEvidencePackages(all);

  recordMaterialEvent(appId, "ip_evidence_package", {
    packageId: pkg.id,
    merkleRootHash,
    lineageRecordHash: lineage.contentHash,
    differentiatingClaimsCount: search.differentiatingClaims.length,
    sourcesCount: search.sources.length,
    patentCounselReviewed: pkg.patentCounselReviewed,
  }, "system", `IP evidence package assembled: ${search.differentiatingClaims.length} claims, ${search.sources.length} sources`);

  return { pkg };
}

/** Get the IP evidence package for an app. */
export function getIPEvidencePackage(appId: string): IPEvidencePackage | undefined {
  return loadCityIPEvidencePackages().find((p) => p.appId === appId);
}

/** List all IP evidence packages. */
export function listIPEvidencePackages(): IPEvidencePackage[] {
  return loadCityIPEvidencePackages();
}

/** Record a market test result for an app. */
export function recordMarketTestResult(input: {
  appId: string;
  hypothesis: string;
  metrics: { metric: string; value: number; unit: string; baseline: number }[];
  supported: boolean;
  evidence: string;
  sampleSize: number;
  durationDays: number;
}): MarketTestResult {
  const resultBase = {
    id: `mkt_${nanoid(10)}`,
    appId: input.appId,
    hypothesis: input.hypothesis,
    metrics: input.metrics,
    supported: input.supported,
    evidence: input.evidence,
    sampleSize: input.sampleSize,
    durationDays: input.durationDays,
    testedAt: now(),
  };

  const contentHash = hashObject(resultBase);
  const result: MarketTestResult = {
    ...resultBase,
    contentHash,
  };

  const all = loadCityMarketTestResults();
  all.push(result);
  saveCityMarketTestResults(all);

  recordMaterialEvent(input.appId, "market_test_result", {
    resultId: result.id,
    hypothesis: input.hypothesis,
    supported: input.supported,
    sampleSize: input.sampleSize,
    durationDays: input.durationDays,
  }, "system", `Market test: ${input.supported ? "SUPPORTED" : "NOT SUPPORTED"} (n=${input.sampleSize})`);

  return result;
}

/** Get market test results for an app. */
export function getMarketTestResults(appId: string): MarketTestResult[] {
  return loadCityMarketTestResults().filter((r) => r.appId === appId);
}

/** Evaluate an app against all minimum requirements. */
export function evaluateApp(
  appId: string,
  opts?: {
    hasDeployment?: boolean;
    hasTests?: boolean;
    reproducible?: boolean;
    securityReviewed?: boolean;
  }
): AppEvaluationResult {
  const minReqs = checkMinimumRequirements(appId, {
    ...opts,
    hasMarketTest: getMarketTestResults(appId).length > 0,
  });
  const diffResult = getDifferentiationResult(appId);
  const marketResults = getMarketTestResults(appId);

  const allPassed =
    minReqs.differentiation &&
    minReqs.operationalIndependence &&
    minReqs.reproducibility &&
    minReqs.security &&
    minReqs.marketTesting;

  // Compute overall score.
  let score = 0;
  if (minReqs.differentiation) score += 0.25;
  if (minReqs.operationalIndependence) score += 0.2;
  if (minReqs.reproducibility) score += 0.15;
  if (minReqs.security) score += 0.15;
  if (minReqs.marketTesting) score += 0.15;
  if (diffResult) score += diffResult.differentiationScore * 0.1;

  const result: AppEvaluationResult = {
    appId,
    minimumRequirements: minReqs,
    differentiationResult: diffResult!,
    marketTestResults: marketResults,
    passed: allPassed,
    score: Math.max(0, Math.min(1, score)),
    evaluatedAt: now(),
  };

  const all = loadCityEvaluationResults();
  const idx = all.findIndex((r) => r.appId === appId);
  if (idx >= 0) all[idx] = result;
  else all.push(result);
  saveCityEvaluationResults(all);

  return result;
}

/** Get the evaluation result for an app. */
export function getEvaluationResult(appId: string): AppEvaluationResult | undefined {
  return loadCityEvaluationResults().find((r) => r.appId === appId);
}

/** List all evaluation results. */
export function listEvaluationResults(): AppEvaluationResult[] {
  return loadCityEvaluationResults();
}
