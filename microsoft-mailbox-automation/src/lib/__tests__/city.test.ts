import { test, before, after } from "node:test";
import assert from "node:assert";

import {
  saveCityApps,
  saveCityEvents,
  saveCityMerkleRoot,
  saveCityPriorArtSearches,
  saveCityDifferentiationResults,
  saveCityCapabilityGrants,
  saveCityLineageRecords,
  saveCityIPEvidencePackages,
  saveCityMarketTestResults,
  saveCityEvaluationResults,
} from "../config";

import {
  sha256Hex,
  hashObject,
  canonicalJSON,
  generateSigningKeyPair,
  signMessage,
  verifySignature,
  computeEventHash,
  verifyEventHash,
  buildMerkleTree,
  buildSignedMerkleRoot,
  verifyMerkleRoot,
  verifyHashChain,
  generateMerkleProof,
  verifyMerkleProof,
} from "../city/merkle";

import {
  createAppIdentity,
  recordMaterialEvent,
  getEventsForApp,
  getKeyPair,
  setKeyPair,
  transitionStage,
  getAppById,
  listApps,
  getAncestry,
} from "../city/identity";

import {
  conductPriorArtSearch,
  getPriorArtSearchForApp,
  validateSearchCompleteness,
  NOVELTY_DISCLAIMER,
  getPriorArtCorpus,
} from "../city/prior-art-search";

import {
  checkDifferentiation,
  checkMinimumRequirements,
  computeAppFingerprint,
  jaccardSimilarity,
  bigramSimilarity,
} from "../city/differentiation";

import {
  grantCapability,
  revokeCapability,
  verifyCapabilityGrant,
  hasCapability,
  authorizeChildApp,
} from "../city/capability";

import {
  createLineageRecord,
  getLineageRecord,
  verifyLineageChain,
  getLineageGraphStats,
} from "../city/lineage";

import {
  assembleIPEvidencePackage,
  recordMarketTestResult,
  evaluateApp,
} from "../city/ip-evidence";

import {
  admitApp,
  sealAppLineage,
  getCityState,
  getCityStats,
  verifyAppLineage,
} from "../city/governance";

import { DEFAULT_SEARCH_BOUNDARIES } from "../city/prior-art-search";

// ─── Setup / Teardown ──────────────────────────────────────────────

before(() => {
  saveCityApps([]);
  saveCityEvents([]);
  saveCityMerkleRoot([]);
  saveCityPriorArtSearches([]);
  saveCityDifferentiationResults([]);
  saveCityCapabilityGrants([]);
  saveCityLineageRecords([]);
  saveCityIPEvidencePackages([]);
  saveCityMarketTestResults([]);
  saveCityEvaluationResults([]);
});

after(() => {
  saveCityApps([]);
  saveCityEvents([]);
  saveCityMerkleRoot([]);
  saveCityPriorArtSearches([]);
  saveCityDifferentiationResults([]);
  saveCityCapabilityGrants([]);
  saveCityLineageRecords([]);
  saveCityIPEvidencePackages([]);
  saveCityMarketTestResults([]);
  saveCityEvaluationResults([]);
});

// ─── Merkle Tree Tests ──────────────────────────────────────────────

test("sha256Hex produces deterministic hashes", () => {
  const h1 = sha256Hex("hello");
  const h2 = sha256Hex("hello");
  const h3 = sha256Hex("world");
  assert.strictEqual(h1, h2);
  assert.notStrictEqual(h1, h3);
  assert.strictEqual(h1.length, 64);
});

test("canonicalJSON sorts keys deterministically", () => {
  const objA = { c: 1, a: 2, b: 3 };
  const objB = { a: 2, b: 3, c: 1 };
  assert.strictEqual(canonicalJSON(objA), canonicalJSON(objB));
  assert.strictEqual(hashObject(objA as any), hashObject(objB as any));
});

test("Ed25519 sign and verify round-trip", () => {
  const kp = generateSigningKeyPair();
  const msg = "test message";
  const sig = signMessage(kp.privateKey, msg);
  assert.ok(verifySignature(kp.publicKey, msg, sig));
  assert.ok(!verifySignature(kp.publicKey, "tampered", sig));
});

test("computeEventHash and verifyEventHash", () => {
  const eventBase = {
    id: "evt_test",
    appId: "app_test",
    type: "ideation" as const,
    timestamp: new Date().toISOString(),
    description: "Test event",
    payload: { foo: "bar" },
    previousEventHash: null,
    actor: "test",
    verified: false,
  };
  const hash = computeEventHash(eventBase);
  const event = { ...eventBase, contentHash: hash };
  assert.ok(verifyEventHash(event));

  // Tamper with content
  const tampered = { ...event, description: "Tampered" };
  assert.ok(!verifyEventHash(tampered));
});

test("buildMerkleTree produces correct root for single leaf", () => {
  const leaf = sha256Hex("leaf1");
  const { rootHash, nodeHashes } = buildMerkleTree([leaf]);
  assert.strictEqual(rootHash, leaf);
  assert.ok(nodeHashes.includes(leaf));
});

test("buildMerkleTree produces correct root for two leaves", () => {
  const leaf1 = sha256Hex("a");
  const leaf2 = sha256Hex("b");
  const { rootHash } = buildMerkleTree([leaf1, leaf2]);
  const expectedRoot = sha256Hex(leaf1 + leaf2);
  assert.strictEqual(rootHash, expectedRoot);
});

test("buildMerkleTree handles odd number of leaves by duplicating", () => {
  const leaves = [sha256Hex("a"), sha256Hex("b"), sha256Hex("c")];
  const { rootHash } = buildMerkleTree(leaves);
  // Level 1: hash(a+b), hash(c+c)
  const h1 = sha256Hex(leaves[0] + leaves[1]);
  const h2 = sha256Hex(leaves[2] + leaves[2]);
  const expectedRoot = sha256Hex(h1 + h2);
  assert.strictEqual(rootHash, expectedRoot);
});

test("buildSignedMerkleRoot and verifyMerkleRoot round-trip", () => {
  const kp = generateSigningKeyPair();
  const e1Base = { id: "e1", appId: "app1", type: "ideation" as const, timestamp: "2026-01-01T00:00:00Z", description: "d1", payload: {}, previousEventHash: null, actor: "a", verified: false };
  const e2Base = { id: "e2", appId: "app1", type: "prior_art_review" as const, timestamp: "2026-01-02T00:00:00Z", description: "d2", payload: {}, previousEventHash: computeEventHash(e1Base), actor: "a", verified: false };
  const events = [
    { ...e1Base, contentHash: computeEventHash(e1Base) },
    { ...e2Base, contentHash: computeEventHash(e2Base) },
  ];
  const root = buildSignedMerkleRoot("app1", events, kp, null);
  const result = verifyMerkleRoot(root, events);
  assert.ok(result.valid, `Verification failed: ${result.reasons.join("; ")}`);
});

test("verifyMerkleRoot detects tampered events", () => {
  const kp = generateSigningKeyPair();
  const events = [
    { id: "e1", appId: "app1", type: "ideation" as const, timestamp: "2026-01-01T00:00:00Z", description: "d1", payload: {}, previousEventHash: null, actor: "a", verified: false, contentHash: sha256Hex("e1") },
  ];
  const root = buildSignedMerkleRoot("app1", events, kp, null);
  const tampered = [{ ...events[0], description: "tampered" }];
  const result = verifyMerkleRoot(root, tampered);
  assert.ok(!result.valid);
});

test("verifyHashChain detects breaks", () => {
  const events = [
    { id: "e1", appId: "app1", type: "ideation" as const, timestamp: "2026-01-01T00:00:00Z", description: "d1", payload: {}, previousEventHash: null, actor: "a", verified: false, contentHash: sha256Hex("e1") },
    { id: "e2", appId: "app1", type: "prior_art_review" as const, timestamp: "2026-01-02T00:00:00Z", description: "d2", payload: {}, previousEventHash: "wronghash", actor: "a", verified: false, contentHash: sha256Hex("e2") },
  ];
  const result = verifyHashChain(events);
  assert.ok(!result.valid);
  assert.ok(result.breaks.length > 0);
});

test("Merkle proof generation and verification", () => {
  const leaves = [sha256Hex("a"), sha256Hex("b"), sha256Hex("c"), sha256Hex("d")];
  const { rootHash } = buildMerkleTree(leaves);
  const { proof } = generateMerkleProof(leaves, 0);
  assert.ok(verifyMerkleProof(leaves[0], proof, rootHash));
  // Tampered leaf should fail
  assert.ok(!verifyMerkleProof(sha256Hex("x"), proof, rootHash));
});

// ─── Identity Tests ─────────────────────────────────────────────────

test("createAppIdentity creates app with signing key pair", () => {
  const { app, keyPair } = createAppIdentity({
    name: "Test App",
    marketProblem: "Test problem",
    repository: "https://github.com/test/app",
    deploymentEnvironment: "staging",
    budgetCents: 100000,
    license: "MIT",
    marketThesis: "Test thesis",
  });
  assert.ok(app.id.startsWith("app_"));
  assert.strictEqual(app.stage, "ideation");
  assert.ok(app.publicKey.length > 0);
  assert.ok(keyPair.privateKey.length > 0);
  assert.strictEqual(app.parentAppId, null);

  // Verify ideation event was recorded.
  const events = getEventsForApp(app.id);
  assert.ok(events.length >= 1);
  assert.strictEqual(events[0].type, "ideation");
  assert.ok(events[0].contentHash.length > 0);
});

test("recordMaterialEvent creates hash-chained events", () => {
  const { app } = createAppIdentity({
    name: "Chain Test",
    marketProblem: "Chain problem",
    repository: "https://github.com/test/chain",
    deploymentEnvironment: "dev",
    budgetCents: 50000,
    license: "Apache-2.0",
    marketThesis: "Chain thesis",
  });

  const event = recordMaterialEvent(app.id, "code_generation", { tool: "test" }, "test");
  assert.ok(event.contentHash.length > 0);

  const events = getEventsForApp(app.id);
  assert.ok(events.length >= 2);

  // Verify hash chain.
  const chainResult = verifyHashChain(events);
  assert.ok(chainResult.valid, `Hash chain broken: ${chainResult.breaks.map(b => b.reason).join("; ")}`);
});

test("transitionStage updates app stage", () => {
  const { app } = createAppIdentity({
    name: "Stage Test",
    marketProblem: "Stage problem",
    repository: "https://github.com/test/stage",
    deploymentEnvironment: "dev",
    budgetCents: 50000,
    license: "MIT",
    marketThesis: "Stage thesis",
  });

  const updated = transitionStage(app.id, "testing", "Moving to testing");
  assert.strictEqual(updated?.stage, "testing");
});

test("getAncestry returns full chain", () => {
  const { app: parent } = createAppIdentity({
    name: "Parent",
    marketProblem: "Parent problem",
    repository: "https://github.com/test/parent",
    deploymentEnvironment: "prod",
    budgetCents: 100000,
    license: "MIT",
    marketThesis: "Parent thesis",
  });

  const { app: child } = createAppIdentity({
    name: "Child",
    marketProblem: "Child problem",
    repository: "https://github.com/test/child",
    deploymentEnvironment: "staging",
    budgetCents: 50000,
    license: "MIT",
    marketThesis: "Child thesis",
    parentAppId: parent.id,
  });

  const ancestry = getAncestry(child.id);
  assert.strictEqual(ancestry.length, 2);
  assert.strictEqual(ancestry[0].id, parent.id);
  assert.strictEqual(ancestry[1].id, child.id);
});

// ─── Prior-Art Search Tests ─────────────────────────────────────────

test("conductPriorArtSearch creates search with novelty disclaimer", () => {
  const { app } = createAppIdentity({
    name: "PA Test",
    marketProblem: "PA problem",
    repository: "https://github.com/test/pa",
    deploymentEnvironment: "dev",
    budgetCents: 50000,
    license: "MIT",
    marketThesis: "PA thesis",
  });

  const search = conductPriorArtSearch({
    appId: app.id,
    claim: "A novel approach to X using Y",
    searchBoundaries: {
      ...DEFAULT_SEARCH_BOUNDARIES,
      searchQueries: ["novel approach X Y", "X using Y"],
      categoriesSearched: ["workflow_automation", "llm_agentic"],
    },
    sources: [
      { url: "https://github.com/example/repo", title: "Example Repo", type: "open_source_project", relevance: "medium", summary: "Similar but different" },
    ],
    findings: [
      { sourceId: "src_0", description: "Existing tool does X", overlap: "Same domain", blocksDifferentiation: false, withinScope: true },
    ],
    differentiatingClaims: [
      { claim: "Combines X with Y in a novel way", differentiationBasis: "No existing tool combines these", evidence: "Search found no combination" },
    ],
    summary: "Searched GitHub and Google Patents. Found related tools but none combining X with Y.",
    searchConfidence: 0.7,
  });

  assert.ok(search.id.startsWith("pas_"));
  assert.ok(search.noveltyDisclaimer.includes("does not constitute"));
  assert.ok(search.noveltyDisclaimer.includes("patent"));
  assert.strictEqual(search.materialPriorArtFound, false);
  assert.strictEqual(search.patentCounselReviewRecommended, false);
  assert.ok(search.contentHash.length > 0);
});

test("validateSearchCompleteness catches missing elements", () => {
  const { app } = createAppIdentity({
    name: "Validation Test",
    marketProblem: "Validation problem",
    repository: "https://github.com/test/val",
    deploymentEnvironment: "dev",
    budgetCents: 50000,
    license: "MIT",
    marketThesis: "Validation thesis",
  });

  const search = conductPriorArtSearch({
    appId: app.id,
    claim: "Test claim",
    searchBoundaries: {
      ...DEFAULT_SEARCH_BOUNDARIES,
      searchQueries: [],
    },
    sources: [],
    findings: [],
    differentiatingClaims: [],
    summary: "Empty search",
    searchConfidence: 0.1,
  });

  const validation = validateSearchCompleteness(search);
  assert.ok(!validation.valid);
  assert.ok(validation.issues.length >= 4);
});

test("NOVELTY_DISCLAIMER contains required language", () => {
  assert.ok(NOVELTY_DISCLAIMER.includes("does not constitute"));
  assert.ok(NOVELTY_DISCLAIMER.includes("patent counsel"));
  assert.ok(NOVELTY_DISCLAIMER.includes("patent authorities"));
});

test("getPriorArtCorpus aggregates across searches", () => {
  const corpus = getPriorArtCorpus();
  assert.ok(typeof corpus.totalSearches === "number");
  assert.ok(typeof corpus.totalSources === "number");
});

// ─── Differentiation Tests ──────────────────────────────────────────

test("jaccardSimilarity computes set overlap", () => {
  assert.strictEqual(jaccardSimilarity(["a", "b", "c"], ["a", "b", "c"]), 1);
  assert.strictEqual(jaccardSimilarity(["a", "b"], ["c", "d"]), 0);
  const sim = jaccardSimilarity(["a", "b", "c"], ["a", "b", "d"]);
  assert.ok(sim > 0 && sim < 1);
});

test("bigramSimilarity detects text overlap", () => {
  const sim = bigramSimilarity("hello world foo", "hello world bar");
  assert.ok(sim > 0 && sim < 1);
  assert.strictEqual(bigramSimilarity("identical text here", "identical text here"), 1);
});

test("checkDifferentiation rejects cosmetic variants", () => {
  // Create first app with prior-art search.
  const { app: app1 } = createAppIdentity({
    name: "Original App",
    marketProblem: "Automated email processing for research labs",
    repository: "https://github.com/test/original",
    deploymentEnvironment: "prod",
    budgetCents: 100000,
    license: "MIT",
    marketThesis: "Process research emails faster using AI",
  });

  conductPriorArtSearch({
    appId: app1.id,
    claim: "AI email processing for labs",
    searchBoundaries: { ...DEFAULT_SEARCH_BOUNDARIES, searchQueries: ["AI email processing labs"] },
    sources: [{ url: "https://example.com", title: "Example", type: "product", relevance: "low", summary: "Related" }],
    findings: [],
    differentiatingClaims: [{ claim: "Novel AI approach", differentiationBasis: "No existing tool", evidence: "Search found none" }],
    summary: "Searched and found no direct match.",
    searchConfidence: 0.7,
  });

  checkDifferentiation(app1.id);

  // Create a near-identical app (cosmetic variant).
  const { app: app2 } = createAppIdentity({
    name: "Original App Clone",
    marketProblem: "Automated email processing for research labs",
    repository: "https://github.com/test/clone",
    deploymentEnvironment: "prod",
    budgetCents: 100000,
    license: "MIT",
    marketThesis: "Process research emails faster using AI",
  });

  conductPriorArtSearch({
    appId: app2.id,
    claim: "AI email processing for labs",
    searchBoundaries: { ...DEFAULT_SEARCH_BOUNDARIES, searchQueries: ["AI email processing labs"] },
    sources: [{ url: "https://example.com", title: "Example", type: "product", relevance: "low", summary: "Related" }],
    findings: [],
    differentiatingClaims: [{ claim: "Novel AI approach", differentiationBasis: "No existing tool", evidence: "Search found none" }],
    summary: "Searched and found no direct match.",
    searchConfidence: 0.7,
  });

  const diffResult = checkDifferentiation(app2.id);
  assert.ok(diffResult.isCosmeticVariant, "Should detect cosmetic variant");
  assert.ok(diffResult.maxSimilarity >= 0.65, `Similarity ${diffResult.maxSimilarity} should exceed threshold`);
});

test("checkDifferentiation passes for genuinely distinct apps", () => {
  const { app: appA } = createAppIdentity({
    name: "Supply Chain Optimizer",
    marketProblem: "Logistics route optimization for mid-size distributors",
    repository: "https://github.com/test/sco",
    deploymentEnvironment: "prod",
    budgetCents: 200000,
    license: "Apache-2.0",
    marketThesis: "Reduce delivery costs through predictive routing",
  });

  conductPriorArtSearch({
    appId: appA.id,
    claim: "Predictive route optimization for distributors",
    searchBoundaries: { ...DEFAULT_SEARCH_BOUNDARIES, searchQueries: ["predictive route optimization distributors"] },
    sources: [{ url: "https://example.com/routing", title: "Routing Tool", type: "product", relevance: "medium", summary: "Related routing tool" }],
    findings: [{ sourceId: "src_0", description: "Existing routing tool", overlap: "Same domain", blocksDifferentiation: false, withinScope: true }],
    differentiatingClaims: [
      { claim: "Combines weather data with delivery patterns", differentiationBasis: "No existing tool combines these data sources", evidence: "Search found no combination" },
      { claim: "Real-time rerouting based on traffic", differentiationBasis: "Existing tools use static routes", evidence: "Search found only static routing" },
    ],
    summary: "Found routing tools but none with weather+traffic combination.",
    searchConfidence: 0.75,
  });

  const result = checkDifferentiation(appA.id);
  assert.ok(result.passed, `Should pass: ${result.failures.join("; ")}`);
  assert.ok(!result.isCosmeticVariant);
});

// ─── Capability Grant Tests ─────────────────────────────────────────

test("grantCapability creates signed grant", () => {
  const { app: parent, keyPair } = createAppIdentity({
    name: "Grant Parent",
    marketProblem: "Parent problem",
    repository: "https://github.com/test/gp",
    deploymentEnvironment: "prod",
    budgetCents: 100000,
    license: "MIT",
    marketThesis: "Parent thesis",
  });

  const { app: child } = createAppIdentity({
    name: "Grant Child",
    marketProblem: "Child problem",
    repository: "https://github.com/test/gc",
    deploymentEnvironment: "staging",
    budgetCents: 50000,
    license: "MIT",
    marketThesis: "Child thesis",
  });

  const { grant, error } = grantCapability({
    parentAppId: parent.id,
    childAppId: child.id,
    capability: "create_child_app",
    conditions: ["Must maintain differentiation"],
  });

  assert.ok(!error, `Grant error: ${error}`);
  assert.ok(grant.contentHash.length > 0);
  assert.ok(grant.signature.length > 0);

  const verification = verifyCapabilityGrant(grant);
  assert.ok(verification.valid, `Verification failed: ${verification.reasons.join("; ")}`);
});

test("hasCapability checks valid grants", () => {
  const { app: parent } = createAppIdentity({
    name: "Cap Parent",
    marketProblem: "Parent problem",
    repository: "https://github.com/test/cp",
    deploymentEnvironment: "prod",
    budgetCents: 100000,
    license: "MIT",
    marketThesis: "Parent thesis",
  });

  const { app: child } = createAppIdentity({
    name: "Cap Child",
    marketProblem: "Child problem",
    repository: "https://github.com/test/cc",
    deploymentEnvironment: "staging",
    budgetCents: 50000,
    license: "MIT",
    marketThesis: "Child thesis",
  });

  assert.ok(!hasCapability(parent.id, child.id, "create_child_app"));

  grantCapability({
    parentAppId: parent.id,
    childAppId: child.id,
    capability: "create_child_app",
    conditions: [],
  });

  assert.ok(hasCapability(parent.id, child.id, "create_child_app"));
});

test("revokeCapability invalidates grant", () => {
  const { app: parent } = createAppIdentity({
    name: "Revoke Parent",
    marketProblem: "Parent problem",
    repository: "https://github.com/test/rp",
    deploymentEnvironment: "prod",
    budgetCents: 100000,
    license: "MIT",
    marketThesis: "Parent thesis",
  });

  const { app: child } = createAppIdentity({
    name: "Revoke Child",
    marketProblem: "Child problem",
    repository: "https://github.com/test/rc",
    deploymentEnvironment: "staging",
    budgetCents: 50000,
    license: "MIT",
    marketThesis: "Child thesis",
  });

  const { grant } = grantCapability({
    parentAppId: parent.id,
    childAppId: child.id,
    capability: "create_child_app",
    conditions: [],
  });

  assert.ok(hasCapability(parent.id, child.id, "create_child_app"));

  revokeCapability(grant.id, "Policy violation");
  assert.ok(!hasCapability(parent.id, child.id, "create_child_app"));
});

// ─── Lineage Tests ──────────────────────────────────────────────────

test("createLineageRecord links app to ancestry", () => {
  const { app: parent } = createAppIdentity({
    name: "Lineage Parent",
    marketProblem: "Parent problem",
    repository: "https://github.com/test/lp",
    deploymentEnvironment: "prod",
    budgetCents: 100000,
    license: "MIT",
    marketThesis: "Parent thesis",
  });

  const { app: child } = createAppIdentity({
    name: "Lineage Child",
    marketProblem: "Child problem",
    repository: "https://github.com/test/lc",
    deploymentEnvironment: "staging",
    budgetCents: 50000,
    license: "MIT",
    marketThesis: "Child thesis",
    parentAppId: parent.id,
  });

  // Authorize the child.
  authorizeChildApp({
    parentAppId: parent.id,
    childAppId: child.id,
    conditions: ["Must maintain differentiation"],
  });

  const { record, error } = createLineageRecord({
    appId: child.id,
    inheritedComponents: [
      { component: "auth-module", version: "1.0.0", modified: false, modificationDescription: null },
    ],
    changesFromParent: ["Different market segment", "New UI layer"],
  });

  assert.ok(!error, `Lineage error: ${error}`);
  assert.strictEqual(record.parentAppId, parent.id);
  assert.ok(record.ancestorAppIds.includes(parent.id));
  assert.strictEqual(record.inheritedComponents.length, 1);
  assert.ok(record.contentHash.length > 0);
});

test("verifyLineageChain detects missing capability grants", () => {
  const { app: parent } = createAppIdentity({
    name: "Chain Parent",
    marketProblem: "Parent problem",
    repository: "https://github.com/test/cp2",
    deploymentEnvironment: "prod",
    budgetCents: 100000,
    license: "MIT",
    marketThesis: "Parent thesis",
  });

  const { app: child } = createAppIdentity({
    name: "Chain Child",
    marketProblem: "Child problem",
    repository: "https://github.com/test/cc2",
    deploymentEnvironment: "staging",
    budgetCents: 50000,
    license: "MIT",
    marketThesis: "Child thesis",
    parentAppId: parent.id,
  });

  // Don't authorize — should fail.
  const result = verifyLineageChain(child.id);
  assert.ok(!result.valid);
  assert.ok(result.breaks.some(b => b.reason.includes("create_child_app")));
});

test("getLineageGraphStats computes graph metrics", () => {
  const stats = getLineageGraphStats();
  assert.ok(typeof stats.totalApps === "number");
  assert.ok(typeof stats.rootApps === "number");
  assert.ok(typeof stats.maxDepth === "number");
  assert.ok(stats.totalApps >= 0);
});

// ─── IP Evidence Package Tests ──────────────────────────────────────

test("assembleIPEvidencePackage requires prior-art and differentiation", () => {
  const { app } = createAppIdentity({
    name: "IP Test",
    marketProblem: "IP problem",
    repository: "https://github.com/test/ip",
    deploymentEnvironment: "dev",
    budgetCents: 50000,
    license: "MIT",
    marketThesis: "IP thesis",
  });

  // Without prior-art search or differentiation, should fail.
  const { error } = assembleIPEvidencePackage(app.id);
  assert.ok(error);
});

test("recordMarketTestResult creates hashed result", () => {
  const { app } = createAppIdentity({
    name: "Market Test App",
    marketProblem: "Market problem",
    repository: "https://github.com/test/mt",
    deploymentEnvironment: "prod",
    budgetCents: 50000,
    license: "MIT",
    marketThesis: "Market thesis",
  });

  const result = recordMarketTestResult({
    appId: app.id,
    hypothesis: "Users will pay $10/month",
    metrics: [{ metric: "conversion_rate", value: 0.05, unit: "ratio", baseline: 0.02 }],
    supported: true,
    evidence: "5% conversion vs 2% baseline in 30-day test",
    sampleSize: 200,
    durationDays: 30,
  });

  assert.ok(result.contentHash.length > 0);
  assert.ok(result.supported);
});

// ─── Governance: Full Admission Pipeline Tests ──────────────────────

test("admitApp succeeds for a genuinely differentiated app", () => {
  const result = admitApp({
    name: "Healthcare Scheduler AI",
    marketProblem: "Clinics waste 20+ hours/week on manual appointment scheduling",
    repository: "https://github.com/test/hsa",
    deploymentEnvironment: "staging",
    budgetCents: 500000,
    license: "Apache-2.0",
    marketThesis: "Reduce clinic scheduling overhead by 60% using constraint-based AI",
    priorArtSearch: {
      claim: "AI-powered appointment scheduling for healthcare clinics",
      searchBoundaries: {
        ...DEFAULT_SEARCH_BOUNDARIES,
        searchQueries: ["AI appointment scheduling healthcare", "clinic scheduling automation"],
        categoriesSearched: ["workflow_automation", "llm_agentic"],
      },
      sources: [
        { url: "https://github.com/example/scheduler", title: "Basic Scheduler", type: "open_source_project", relevance: "medium", summary: "Simple calendar tool" },
        { url: "https://patents.google.com/patent/US123", title: "Scheduling Patent", type: "patent", relevance: "low", summary: "Related but different domain" },
      ],
      findings: [
        { sourceId: "src_0", description: "Basic calendar scheduler", overlap: "Same domain but no AI", blocksDifferentiation: false, withinScope: true },
      ],
      differentiatingClaims: [
        { claim: "Constraint-based AI that optimizes for patient preferences", differentiationBasis: "No existing tool uses constraint optimization", evidence: "Search found only simple calendar tools" },
        { claim: "Real-time rescheduling based on no-show prediction", differentiationBasis: "No existing tool predicts no-shows", evidence: "Search found no no-show prediction in scheduling" },
      ],
      summary: "Found basic scheduling tools but none with AI optimization or no-show prediction.",
      searchConfidence: 0.75,
    },
    inheritedComponents: [],
    changesFromParent: [],
  });

  assert.ok(result.passed, `Admission failed: ${result.rejectionReason}`);
  assert.notStrictEqual(result.stage, "rejected");
  assert.ok(result.app.id.startsWith("app_"));
});

test("admitApp rejects app with material prior art found", () => {
  const result = admitApp({
    name: "Clone of Existing Tool",
    marketProblem: "Email automation for sales teams",
    repository: "https://github.com/test/clone",
    deploymentEnvironment: "staging",
    budgetCents: 100000,
    license: "MIT",
    marketThesis: "Automate sales emails",
    priorArtSearch: {
      claim: "Automated email sending for sales",
      searchBoundaries: {
        ...DEFAULT_SEARCH_BOUNDARIES,
        searchQueries: ["automated sales email"],
      },
      sources: [
        { url: "https://github.com/example/seq", title: "Outreach.io Clone", type: "open_source_project", relevance: "high", summary: "Exact same feature set" },
      ],
      findings: [
        { sourceId: "src_0", description: "Identical tool exists", overlap: "Same features, same market", blocksDifferentiation: true, withinScope: true },
      ],
      differentiatingClaims: [
        { claim: "Different UI color scheme", differentiationBasis: "Different colors", evidence: "None" },
      ],
      summary: "Found identical existing tool.",
      searchConfidence: 0.6,
    },
  });

  assert.ok(!result.passed);
  assert.strictEqual(result.stage, "rejected");
  assert.ok(result.rejectionReason);
});

test("admitApp rejects app with incomplete prior-art search", () => {
  const result = admitApp({
    name: "Incomplete Search App",
    marketProblem: "Some problem",
    repository: "https://github.com/test/incomplete",
    deploymentEnvironment: "staging",
    budgetCents: 100000,
    license: "MIT",
    marketThesis: "Some thesis",
    priorArtSearch: {
      claim: "Some claim",
      searchBoundaries: {
        ...DEFAULT_SEARCH_BOUNDARIES,
        searchQueries: [],
      },
      sources: [],
      findings: [],
      differentiatingClaims: [],
      summary: "Did not search",
      searchConfidence: 0.1,
    },
  });

  assert.ok(!result.passed);
  assert.strictEqual(result.stage, "rejected");
});

// ─── Seal and Verify Tests ──────────────────────────────────────────

test("sealAppLineage creates verifiable Merkle root", () => {
  const { app } = createAppIdentity({
    name: "Seal Test",
    marketProblem: "Seal problem",
    repository: "https://github.com/test/seal",
    deploymentEnvironment: "dev",
    budgetCents: 50000,
    license: "MIT",
    marketThesis: "Seal thesis",
  });

  recordMaterialEvent(app.id, "code_generation", { data: "test" }, "test");
  recordMaterialEvent(app.id, "testing", { tests: "passed" }, "test");

  const { rootHash, error } = sealAppLineage(app.id);
  assert.ok(!error, `Seal error: ${error}`);
  assert.ok(rootHash.length > 0);

  // Verify lineage.
  const verification = verifyAppLineage(app.id);
  // hash_chain and merkle_root should pass; lineage_chain and others may not
  // since we didn't create a lineage record or prior-art search.
  const hashChainCheck = verification.checks.find(c => c.name === "hash_chain");
  assert.ok(hashChainCheck?.passed, `Hash chain: ${hashChainCheck?.detail}`);
  const merkleRootCheck = verification.checks.find(c => c.name === "merkle_root");
  assert.ok(merkleRootCheck?.passed, `Merkle root: ${merkleRootCheck?.detail}`);
});

// ─── City State and Stats Tests ─────────────────────────────────────

test("getCityState returns complete snapshot", () => {
  const state = getCityState();
  assert.ok(Array.isArray(state.apps));
  assert.ok(Array.isArray(state.events));
  assert.ok(Array.isArray(state.merkleRoots));
  assert.ok(Array.isArray(state.priorArtSearches));
  assert.ok(Array.isArray(state.differentiationResults));
  assert.ok(Array.isArray(state.capabilityGrants));
  assert.ok(Array.isArray(state.lineageRecords));
  assert.ok(Array.isArray(state.ipEvidencePackages));
  assert.ok(Array.isArray(state.marketTestResults));
  assert.ok(Array.isArray(state.evaluationResults));
});

test("getCityStats returns metrics", () => {
  const stats = getCityStats();
  assert.ok(typeof stats.totalApps === "number");
  assert.ok(typeof stats.activeApps === "number");
  assert.ok(typeof stats.cosmeticVariantsDetected === "number");
  assert.ok(typeof stats.avgDifferentiationScore === "number");
  assert.ok(stats.totalApps > 0, "Should have apps from previous tests");
});

// ─── Minimum Requirements Tests ─────────────────────────────────────

test("checkMinimumRequirements returns detailed breakdown", () => {
  const { app } = createAppIdentity({
    name: "Min Req Test",
    marketProblem: "Min req problem",
    repository: "https://github.com/test/minreq",
    deploymentEnvironment: "dev",
    budgetCents: 50000,
    license: "MIT",
    marketThesis: "Min req thesis",
  });

  const reqs = checkMinimumRequirements(app.id, {
    reproducible: true,
    securityReviewed: true,
  });

  assert.ok(typeof reqs.differentiation === "boolean");
  assert.ok(typeof reqs.operationalIndependence === "boolean");
  assert.ok(reqs.operationalIndependence, "Should have repo, env, and budget");
  assert.ok(reqs.reproducibility);
  assert.ok(reqs.security);
  assert.ok(!reqs.marketTesting, "No market test conducted yet");
  assert.ok(reqs.details.operationalIndependence.passed);
});

// ─── Evaluate App Tests ─────────────────────────────────────────────

test("evaluateApp computes overall score", () => {
  const { app } = createAppIdentity({
    name: "Eval Test",
    marketProblem: "Eval problem",
    repository: "https://github.com/test/eval",
    deploymentEnvironment: "prod",
    budgetCents: 100000,
    license: "MIT",
    marketThesis: "Eval thesis",
  });

  conductPriorArtSearch({
    appId: app.id,
    claim: "Unique claim for evaluation",
    searchBoundaries: { ...DEFAULT_SEARCH_BOUNDARIES, searchQueries: ["unique evaluation claim"] },
    sources: [{ url: "https://example.com", title: "Example", type: "product", relevance: "low", summary: "Not related" }],
    findings: [],
    differentiatingClaims: [{ claim: "Unique feature combination", differentiationBasis: "No existing tool", evidence: "Search found none" }],
    summary: "No prior art found.",
    searchConfidence: 0.7,
  });

  checkDifferentiation(app.id);
  recordMarketTestResult({
    appId: app.id,
    hypothesis: "Test hypothesis",
    metrics: [{ metric: "conversion", value: 0.1, unit: "ratio", baseline: 0.05 }],
    supported: true,
    evidence: "Test evidence",
    sampleSize: 100,
    durationDays: 14,
  });

  const result = evaluateApp(app.id, {
    reproducible: true,
    securityReviewed: true,
  });

  assert.ok(typeof result.score === "number");
  assert.ok(result.score > 0);
  assert.ok(typeof result.passed === "boolean");
});
