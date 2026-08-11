/** City of Applications — Public API
 *
 * A governed city of applications in which every application can prove
 * where it came from, what evidence informed its claimed differentiation,
 * which components it inherited, what it changed, how it was executed,
 * and what market or intellectual-property position it is attempting
 * to defend.
 *
 * Core principle: an app cannot prove that no prior art exists. It can
 * only prove that it conducted a defined search, found no material prior
 * art within that scope, and documented the exact differentiating claims.
 * Absolute novelty determinations belong to qualified patent counsel and,
 * ultimately, the relevant patent authorities or courts. */

// Merkle tree and cryptographic primitives
export {
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
} from "./merkle";

// App identity and lifecycle
export {
  createAppIdentity,
  getKeyPair,
  setKeyPair,
  recordMaterialEvent,
  getEventsForApp,
  transitionStage,
  recordModelToolUsage,
  recordSourceHistory,
  updateDeployment,
  recordBudgetSpend,
  rejectApp,
  retireApp,
  listApps,
  getAppById,
  getChildApps,
  getAncestry,
} from "./identity";

// Prior-art search
export {
  conductPriorArtSearch,
  getPriorArtSearchById,
  getPriorArtSearchForApp,
  listPriorArtSearches,
  updateCounselReview,
  validateSearchCompleteness,
  getPriorArtCorpus,
  NOVELTY_DISCLAIMER,
  DEFAULT_SEARCH_BOUNDARIES,
} from "./prior-art-search";

// Differentiation
export {
  checkDifferentiation,
  checkMinimumRequirements,
  getDifferentiationResult,
  listDifferentiationResults,
  computeAppFingerprint,
  jaccardSimilarity,
  bigramSimilarity,
} from "./differentiation";

// Capability grants
export {
  grantCapability,
  revokeCapability,
  verifyCapabilityGrant,
  hasCapability,
  getGrantsFromParent,
  getGrantsToChild,
  listCapabilityGrants,
  authorizeChildApp,
  authorizeNewVersion,
} from "./capability";

// Lineage
export {
  createLineageRecord,
  getLineageRecord,
  listLineageRecords,
  getLineageTree,
  verifyLineageChain,
  getLineageGraphStats,
} from "./lineage";

// IP evidence and evaluation
export {
  assembleIPEvidencePackage,
  getIPEvidencePackage,
  listIPEvidencePackages,
  recordMarketTestResult,
  getMarketTestResults,
  evaluateApp,
  getEvaluationResult,
  listEvaluationResults,
} from "./ip-evidence";

// Governance
export {
  admitApp,
  sealAppLineage,
  getCityState,
  getCityStats,
  verifyAppLineage,
} from "./governance";
