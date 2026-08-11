import { nanoid } from "nanoid";
import {
  AppIdentity,
  DifferentiationResult,
  PriorArtSearch,
  MinimumRequirements,
} from "@/types";
import { recordMaterialEvent } from "./identity";
import { getPriorArtSearchForApp } from "./prior-art-search";
import {
  loadCityApps,
  loadCityDifferentiationResults,
  saveCityDifferentiationResults,
} from "@/lib/config";

const now = () => new Date().toISOString();

/** Minimum similarity threshold below which two apps are considered
 *  genuinely distinct. Above this, they may be cosmetic variants. */
const COSMETIC_VARIANT_THRESHOLD = 0.65;

/** Minimum differentiation score required to pass admission. */
const MIN_DIFFERENTIATION_SCORE = 0.35;

/** Compute a feature fingerprint for an app based on its identity
 *  and prior-art search. This is a deterministic textual fingerprint
 *  used for similarity comparison — not a semantic embedding. */
export function computeAppFingerprint(app: AppIdentity, search?: PriorArtSearch): string[] {
  const features: string[] = [];

  // Market problem features.
  features.push(`problem:${normalize(app.marketProblem)}`);
  features.push(`thesis:${normalize(app.marketThesis)}`);
  features.push(`name:${normalize(app.name)}`);

  // Prior-art differentiating claims.
  if (search) {
    for (const dc of search.differentiatingClaims) {
      features.push(`claim:${normalize(dc.claim)}`);
    }
    for (const src of search.sources) {
      features.push(`src:${normalize(src.title)}`);
    }
  }

  return features;
}

/** Normalize text for comparison: lowercase, strip punctuation,
 *  collapse whitespace. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Compute Jaccard similarity between two sets of features. */
export function jaccardSimilarity(setA: string[], setB: string[]): number {
  if (setA.length === 0 && setB.length === 0) return 1;
  if (setA.length === 0 || setB.length === 0) return 0;
  const setASet = new Set(setA);
  const setBSet = new Set(setB);
  let intersection = 0;
  for (const item of setASet) {
    if (setBSet.has(item)) intersection++;
  }
  const union = setASet.size + setBSet.size - intersection;
  return intersection / union;
}

/** Compute token overlap similarity (bigram-based for more granularity). */
export function bigramSimilarity(textA: string, textB: string): number {
  const bigramsA = extractBigrams(normalize(textA));
  const bigramsB = extractBigrams(normalize(textB));
  return jaccardSimilarity(bigramsA, bigramsB);
}

/** Extract bigrams from normalized text. */
function extractBigrams(text: string): string[] {
  const words = text.split(" ").filter((w) => w.length > 0);
  if (words.length < 2) return words;
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]}_${words[i + 1]}`);
  }
  return bigrams;
}

/** Check differentiation of an app against all existing apps.
 *  This is the anti-cosmetic-variation guard: it prevents hundreds
 *  of copies of the same app wearing different hats. */
export function checkDifferentiation(appId: string): DifferentiationResult {
  const apps = loadCityApps();
  const app = apps.find((a) => a.id === appId);
  if (!app) {
    return {
      appId,
      passed: false,
      differentiationScore: 0,
      failures: ["App not found"],
      warnings: [],
      isCosmeticVariant: false,
      resemblesAppId: null,
      maxSimilarity: 0,
      checkedAt: now(),
    };
  }

  const search = getPriorArtSearchForApp(appId);
  const appFingerprint = computeAppFingerprint(app, search);

  const failures: string[] = [];
  const warnings: string[] = [];
  let maxSimilarity = 0;
  let resemblesAppId: string | null = null;

  // Compare against all other apps.
  for (const other of apps) {
    if (other.id === appId) continue;
    if (other.stage === "rejected" || other.stage === "retired") continue;

    const otherSearch = getPriorArtSearchForApp(other.id);
    const otherFingerprint = computeAppFingerprint(other, otherSearch);

    const featureSim = jaccardSimilarity(appFingerprint, otherFingerprint);
    const problemSim = bigramSimilarity(app.marketProblem, other.marketProblem);
    const thesisSim = bigramSimilarity(app.marketThesis, other.marketThesis);

    // Weighted similarity: features carry more weight than raw text.
    const combinedSim = featureSim * 0.5 + problemSim * 0.25 + thesisSim * 0.25;

    if (combinedSim > maxSimilarity) {
      maxSimilarity = combinedSim;
      resemblesAppId = other.id;
    }

    if (combinedSim >= COSMETIC_VARIANT_THRESHOLD) {
      failures.push(
        `Cosmetic variant of app ${other.id} (${other.name}): similarity ${combinedSim.toFixed(2)} ` +
        `exceeds threshold ${COSMETIC_VARIANT_THRESHOLD}`
      );
    }
  }

  // Check prior-art search quality.
  if (!search) {
    failures.push("No prior-art search conducted");
  } else {
    if (search.differentiatingClaims.length === 0) {
      failures.push("No differentiating claims identified in prior-art search");
    }
    if (search.materialPriorArtFound) {
      failures.push("Material prior art found within search scope that blocks differentiation");
    }
    if (search.searchConfidence < 0.3) {
      warnings.push(`Search confidence low (${search.searchConfidence.toFixed(2)})`);
    }
    if (!search.patentCounselReviewRecommended && search.differentiatingClaims.length > 3) {
      warnings.push("Multiple differentiating claims but patent counsel review not recommended");
    }
  }

  // Compute differentiation score.
  let score = 0;
  if (search) {
    score += Math.min(0.3, search.differentiatingClaims.length * 0.1);
    score += search.searchConfidence * 0.2;
    if (!search.materialPriorArtFound) score += 0.2;
  }
  // Lower score for high similarity to existing apps.
  score += Math.max(0, 0.3 - maxSimilarity * 0.3);

  const isCosmeticVariant = maxSimilarity >= COSMETIC_VARIANT_THRESHOLD;
  const passed = failures.length === 0 && score >= MIN_DIFFERENTIATION_SCORE;

  const result: DifferentiationResult = {
    appId,
    passed,
    differentiationScore: Math.max(0, Math.min(1, score)),
    failures,
    warnings,
    isCosmeticVariant,
    resemblesAppId,
    maxSimilarity,
    checkedAt: now(),
  };

  const all = loadCityDifferentiationResults();
  // Replace existing result for this app if present.
  const idx = all.findIndex((r) => r.appId === appId);
  if (idx >= 0) all[idx] = result;
  else all.push(result);
  saveCityDifferentiationResults(all);

  recordMaterialEvent(appId, "differentiation_review", {
    passed,
    score: result.differentiationScore,
    isCosmeticVariant,
    resemblesAppId,
    maxSimilarity,
    failures,
    warnings,
  }, "system", `Differentiation review: ${passed ? "PASSED" : "FAILED"} (score ${result.differentiationScore.toFixed(2)})`);

  return result;
}

/** Check minimum requirements for app admission to the city. */
export function checkMinimumRequirements(
  appId: string,
  opts?: {
    hasDeployment?: boolean;
    hasTests?: boolean;
    hasMarketTest?: boolean;
    reproducible?: boolean;
    securityReviewed?: boolean;
  }
): MinimumRequirements {
  const apps = loadCityApps();
  const app = apps.find((a) => a.id === appId);
  if (!app) {
    return {
      differentiation: false,
      operationalIndependence: false,
      reproducibility: false,
      security: false,
      marketTesting: false,
      details: {
        differentiation: { passed: false, reason: "App not found" },
        operationalIndependence: { passed: false, reason: "App not found" },
        reproducibility: { passed: false, reason: "App not found" },
        security: { passed: false, reason: "App not found" },
        marketTesting: { passed: false, reason: "App not found" },
      },
    };
  }

  const diffResult = loadCityDifferentiationResults().find((r) => r.appId === appId);

  const differentiationPassed = diffResult?.passed ?? false;
  const operationalIndependencePassed =
    app.repository.length > 0 &&
    app.deploymentEnvironment.length > 0 &&
    app.budgetCents > 0;
  const reproducibilityPassed = opts?.reproducible ?? false;
  const securityPassed = opts?.securityReviewed ?? false;
  const marketTestingPassed = opts?.hasMarketTest ?? false;

  return {
    differentiation: differentiationPassed,
    operationalIndependence: operationalIndependencePassed,
    reproducibility: reproducibilityPassed,
    security: securityPassed,
    marketTesting: marketTestingPassed,
    details: {
      differentiation: {
        passed: differentiationPassed,
        reason: differentiationPassed
          ? "Differentiation review passed"
          : diffResult?.failures.join("; ") || "No differentiation review conducted",
      },
      operationalIndependence: {
        passed: operationalIndependencePassed,
        reason: operationalIndependencePassed
          ? "Has separate repository, deployment environment, and budget"
          : "Missing repository, deployment environment, or budget",
      },
      reproducibility: {
        passed: reproducibilityPassed,
        reason: reproducibilityPassed
          ? "Build is reproducible from source"
          : "Reproducibility not verified",
      },
      security: {
        passed: securityPassed,
        reason: securityPassed
          ? "Security review completed"
          : "Security review not completed",
      },
      marketTesting: {
        passed: marketTestingPassed,
        reason: marketTestingPassed
          ? "Market test conducted with results"
          : "No market test conducted",
      },
    },
  };
}

/** Get the differentiation result for an app. */
export function getDifferentiationResult(appId: string): DifferentiationResult | undefined {
  return loadCityDifferentiationResults().find((r) => r.appId === appId);
}

/** List all differentiation results. */
export function listDifferentiationResults(): DifferentiationResult[] {
  return loadCityDifferentiationResults();
}
