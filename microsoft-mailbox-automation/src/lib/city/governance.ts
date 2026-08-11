import { nanoid } from "nanoid";
import {
  AppIdentity,
  AppLifecycleStage,
  CityState,
  MinimumRequirements,
} from "@/types";
import {
  createAppIdentity,
  transitionStage,
  rejectApp,
  getAppById,
  listApps,
  getEventsForApp,
  recordMaterialEvent,
} from "./identity";
import { conductPriorArtSearch, validateSearchCompleteness } from "./prior-art-search";
import { checkDifferentiation, checkMinimumRequirements } from "./differentiation";
import { authorizeChildApp, hasCapability } from "./capability";
import { createLineageRecord, verifyLineageChain } from "./lineage";
import { assembleIPEvidencePackage, evaluateApp } from "./ip-evidence";
import { buildSignedMerkleRoot, verifyMerkleRoot, verifyHashChain, getKeyPair } from "./merkle-bridge";
import {
  loadCityApps,
  loadCityEvents,
  loadCityMerkleRoots,
  loadCityPriorArtSearches,
  loadCityDifferentiationResults,
  loadCityCapabilityGrants,
  loadCityLineageRecords,
  loadCityIPEvidencePackages,
  loadCityMarketTestResults,
  loadCityEvaluationResults,
} from "@/lib/config";

const now = () => new Date().toISOString();

/** The full admission pipeline for a new app into the city.
 *
 * 1. Ideation: document the market problem.
 * 2. Prior-art search: conduct a structured search with documented boundaries.
 * 3. Differentiation review: verify the app is not a cosmetic variant.
 * 4. Architecture selection: record the architecture decision.
 * 5. Code generation: record model/tool usage.
 * 6. Testing: record test results.
 * 7. Deployment: record deployment info.
 * 8. Market testing: record market test results.
 * 9. Evaluation: check all minimum requirements.
 *
 * At any stage, the app can be rejected if it fails to meet requirements. */
export function admitApp(input: {
  name: string;
  marketProblem: string;
  repository: string;
  deploymentEnvironment: string;
  budgetCents: number;
  license: string;
  marketThesis: string;
  parentAppId?: string;
  priorArtSearch: {
    claim: string;
    searchBoundaries: import("@/types").SearchBoundary;
    sources: { url: string; title: string; type: import("@/types").PriorArtSource["type"]; relevance: "high" | "medium" | "low"; summary: string }[];
    findings: { sourceId: string; description: string; overlap: string; blocksDifferentiation: boolean; withinScope: boolean }[];
    differentiatingClaims: { claim: string; differentiationBasis: string; evidence: string; patentCounselReviewed?: boolean; counselAssessment?: string | null }[];
    summary: string;
    searchConfidence: number;
  };
  inheritedComponents?: { component: string; version: string; modified: boolean; modificationDescription: string | null }[];
  changesFromParent?: string[];
}): {
  app: AppIdentity;
  passed: boolean;
  stage: AppLifecycleStage;
  rejectionReason?: string;
} {
  // Step 1: Create app identity (ideation).
  const { app } = createAppIdentity({
    name: input.name,
    marketProblem: input.marketProblem,
    repository: input.repository,
    deploymentEnvironment: input.deploymentEnvironment,
    budgetCents: input.budgetCents,
    license: input.license,
    marketThesis: input.marketThesis,
    parentAppId: input.parentAppId,
  });

  // If this is a child app, verify the parent has authorized it.
  if (input.parentAppId) {
    if (!hasCapability(input.parentAppId, app.id, "create_child_app")) {
      // Auto-authorize since the parent is creating the child.
      const { grant, error } = authorizeChildApp({
        parentAppId: input.parentAppId,
        childAppId: app.id,
        conditions: [
          "Child must maintain minimum differentiation",
          "Child must conduct independent prior-art search",
          "Child must maintain separate deployment and budget",
        ],
      });
      if (error) {
        rejectApp(app.id, `Failed to authorize child app: ${error}`);
        return { app, passed: false, stage: "rejected", rejectionReason: error };
      }
    }
  }

  // Step 2: Conduct prior-art search.
  transitionStage(app.id, "prior_art_search", "Beginning structured prior-art search");

  const search = conductPriorArtSearch({
    appId: app.id,
    claim: input.priorArtSearch.claim,
    searchBoundaries: input.priorArtSearch.searchBoundaries,
    sources: input.priorArtSearch.sources,
    findings: input.priorArtSearch.findings,
    differentiatingClaims: input.priorArtSearch.differentiatingClaims.map((c) => ({
      claim: c.claim,
      differentiationBasis: c.differentiationBasis,
      evidence: c.evidence,
      patentCounselReviewed: c.patentCounselReviewed ?? false,
      counselAssessment: c.counselAssessment ?? null,
    })),
    summary: input.priorArtSearch.summary,
    searchConfidence: input.priorArtSearch.searchConfidence,
  });

  const searchValidation = validateSearchCompleteness(search);
  if (!searchValidation.valid) {
    rejectApp(app.id, `Prior-art search incomplete: ${searchValidation.issues.join("; ")}`);
    return {
      app,
      passed: false,
      stage: "rejected",
      rejectionReason: `Prior-art search incomplete: ${searchValidation.issues.join("; ")}`,
    };
  }

  // Step 3: Differentiation review.
  transitionStage(app.id, "differentiation_review", "Beginning differentiation review");

  const diffResult = checkDifferentiation(app.id);
  if (!diffResult.passed) {
    rejectApp(app.id, `Differentiation review failed: ${diffResult.failures.join("; ")}`);
    return {
      app,
      passed: false,
      stage: "rejected",
      rejectionReason: `Differentiation review failed: ${diffResult.failures.join("; ")}`,
    };
  }

  // Step 4: Architecture selection.
  transitionStage(app.id, "architecture_selection", "Architecture selected");

  // Step 5: Create lineage record.
  const { record: lineageRecord, error: lineageError } = createLineageRecord({
    appId: app.id,
    inheritedComponents: input.inheritedComponents || [],
    changesFromParent: input.changesFromParent || [],
  });
  if (lineageError) {
    rejectApp(app.id, `Failed to create lineage record: ${lineageError}`);
    return {
      app,
      passed: false,
      stage: "rejected",
      rejectionReason: `Failed to create lineage record: ${lineageError}`,
    };
  }

  // Step 6: Assemble IP evidence package.
  const { pkg, error: ipError } = assembleIPEvidencePackage(app.id);
  if (ipError) {
    rejectApp(app.id, `Failed to assemble IP evidence package: ${ipError}`);
    return {
      app,
      passed: false,
      stage: "rejected",
      rejectionReason: `Failed to assemble IP evidence package: ${ipError}`,
    };
  }

  // App is admitted to the city (but not yet deployed or market-tested).
  transitionStage(app.id, "code_generation", "App admitted to city, beginning development");

  return {
    app: getAppById(app.id)!,
    passed: true,
    stage: "code_generation",
  };
}

/** Compute and sign the current Merkle root for an app. */
export function sealAppLineage(appId: string): {
  rootHash: string;
  error?: string;
} {
  const events = getEventsForApp(appId);
  if (events.length === 0) {
    return { rootHash: "", error: "No events to seal" };
  }

  const keyPair = getKeyPair(appId);
  if (!keyPair) {
    return { rootHash: "", error: `No signing key pair for app ${appId}` };
  }

  const previousRoots = loadCityMerkleRoots().filter((r) => r.appId === appId);
  const previousRootHash = previousRoots.length > 0
    ? previousRoots[previousRoots.length - 1].rootHash
    : null;

  const root = buildSignedMerkleRoot(appId, events, keyPair, previousRootHash);

  // Verify the root.
  const verification = verifyMerkleRoot(root, events);
  if (!verification.valid) {
    return {
      rootHash: root.rootHash,
      error: `Merkle root verification failed: ${verification.reasons.join("; ")}`,
    };
  }

  // Verify hash chain.
  const chainVerification = verifyHashChain(events);
  if (!chainVerification.valid) {
    return {
      rootHash: root.rootHash,
      error: `Hash chain verification failed: ${chainVerification.breaks.map((b) => b.reason).join("; ")}`,
    };
  }

  // Persist the root.
  const { saveCityMerkleRoot } = require("@/lib/config");
  const allRoots = loadCityMerkleRoots();
  allRoots.push(root);
  saveCityMerkleRoot(allRoots);

  return { rootHash: root.rootHash };
}

/** Get the full city state snapshot. */
export function getCityState(): CityState {
  return {
    apps: loadCityApps(),
    events: loadCityEvents(),
    merkleRoots: loadCityMerkleRoots(),
    priorArtSearches: loadCityPriorArtSearches(),
    differentiationResults: loadCityDifferentiationResults(),
    capabilityGrants: loadCityCapabilityGrants(),
    lineageRecords: loadCityLineageRecords(),
    ipEvidencePackages: loadCityIPEvidencePackages(),
    marketTestResults: loadCityMarketTestResults(),
    evaluationResults: loadCityEvaluationResults(),
  };
}

/** Get city-level statistics. */
export function getCityStats(): {
  totalApps: number;
  activeApps: number;
  rejectedApps: number;
  retiredApps: number;
  rootApps: number;
  childApps: number;
  totalEvents: number;
  totalMerkleRoots: number;
  totalPriorArtSearches: number;
  totalCapabilityGrants: number;
  totalLineageRecords: number;
  totalIPEvidencePackages: number;
  totalMarketTests: number;
  avgDifferentiationScore: number;
  cosmeticVariantsDetected: number;
  appsByStage: Record<string, number>;
} {
  const apps = loadCityApps();
  const diffResults = loadCityDifferentiationResults();
  const events = loadCityEvents();

  const appsByStage: Record<string, number> = {};
  for (const app of apps) {
    appsByStage[app.stage] = (appsByStage[app.stage] || 0) + 1;
  }

  const avgDiffScore = diffResults.length > 0
    ? diffResults.reduce((sum, r) => sum + r.differentiationScore, 0) / diffResults.length
    : 0;

  return {
    totalApps: apps.length,
    activeApps: apps.filter((a) => a.active).length,
    rejectedApps: apps.filter((a) => a.stage === "rejected").length,
    retiredApps: apps.filter((a) => a.stage === "retired").length,
    rootApps: apps.filter((a) => a.parentAppId === null).length,
    childApps: apps.filter((a) => a.parentAppId !== null).length,
    totalEvents: events.length,
    totalMerkleRoots: loadCityMerkleRoots().length,
    totalPriorArtSearches: loadCityPriorArtSearches().length,
    totalCapabilityGrants: loadCityCapabilityGrants().length,
    totalLineageRecords: loadCityLineageRecords().length,
    totalIPEvidencePackages: loadCityIPEvidencePackages().length,
    totalMarketTests: loadCityMarketTestResults().length,
    avgDifferentiationScore: avgDiffScore,
    cosmeticVariantsDetected: diffResults.filter((r) => r.isCosmeticVariant).length,
    appsByStage,
  };
}

/** Verify the complete lineage of an app: hash chain, Merkle root,
 *  capability grants, and lineage chain. */
export function verifyAppLineage(appId: string): {
  valid: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
} {
  const checks: { name: string; passed: boolean; detail: string }[] = [];

  // 1. Hash chain verification.
  const events = getEventsForApp(appId);
  const chainResult = verifyHashChain(events);
  checks.push({
    name: "hash_chain",
    passed: chainResult.valid,
    detail: chainResult.valid
      ? "Hash chain intact"
      : chainResult.breaks.map((b) => b.reason).join("; "),
  });

  // 2. Merkle root verification.
  const roots = loadCityMerkleRoots().filter((r) => r.appId === appId);
  if (roots.length > 0) {
    const latestRoot = roots[roots.length - 1];
    const rootResult = verifyMerkleRoot(latestRoot, events);
    checks.push({
      name: "merkle_root",
      passed: rootResult.valid,
      detail: rootResult.valid
        ? "Merkle root verified"
        : rootResult.reasons.join("; "),
    });
  } else {
    checks.push({
      name: "merkle_root",
      passed: false,
      detail: "No Merkle root sealed",
    });
  }

  // 3. Lineage chain verification.
  const lineageResult = verifyLineageChain(appId);
  checks.push({
    name: "lineage_chain",
    passed: lineageResult.valid,
    detail: lineageResult.valid
      ? "Lineage chain intact"
      : lineageResult.breaks.map((b) => b.reason).join("; "),
  });

  // 4. Prior-art search exists.
  const search = loadCityPriorArtSearches().find((s) => s.appId === appId);
  checks.push({
    name: "prior_art_search",
    passed: !!search,
    detail: search ? "Prior-art search exists" : "No prior-art search found",
  });

  // 5. IP evidence package exists.
  const ipPkg = loadCityIPEvidencePackages().find((p) => p.appId === appId);
  checks.push({
    name: "ip_evidence_package",
    passed: !!ipPkg,
    detail: ipPkg ? "IP evidence package exists" : "No IP evidence package found",
  });

  return {
    valid: checks.every((c) => c.passed),
    checks,
  };
}
