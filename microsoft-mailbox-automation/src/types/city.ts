// ─── CITY OF APPLICATIONS ───────────────────────────────────────────
// Evidence-driven system for governing hundreds to thousands of
// independently deployed, economically distinct, cryptographically
// traceable web applications.
//
// Core principle: an app cannot prove that no prior art exists. It can
// only prove that it conducted a defined search, found no material prior
// art within that scope, and documented the exact differentiating claims.
// Absolute novelty determinations belong to qualified patent counsel and
// relevant patent authorities or courts.

/** Lifecycle stages an app passes through from ideation to retirement. */
export type AppLifecycleStage =
  | "ideation"
  | "prior_art_search"
  | "differentiation_review"
  | "architecture_selection"
  | "code_generation"
  | "testing"
  | "deployment"
  | "market_testing"
  | "operating"
  | "versioning"
  | "authorizing_child"
  | "retired"
  | "rejected";

/** Every material event that must produce a content hash. */
export type MaterialEventType =
  | "ideation"
  | "prior_art_review"
  | "architecture_selection"
  | "code_generation"
  | "testing"
  | "deployment"
  | "version_creation"
  | "parent_to_child_authorization"
  | "market_test_result"
  | "differentiation_review"
  | "ip_evidence_package"
  | "budget_allocation"
  | "capability_grant"
  | "capability_revocation"
  | "retirement";

/** A single material event with its content hash. */
export interface MaterialEvent {
  id: string;
  appId: string;
  type: MaterialEventType;
  timestamp: string;
  /** SHA-256 content hash of the event payload. */
  contentHash: string;
  /** Human-readable description of what happened. */
  description: string;
  /** The structured payload that was hashed. */
  payload: Record<string, unknown>;
  /** Hash of the previous event, forming a hash chain. */
  previousEventHash: string | null;
  /** Actor that triggered the event (system, user, or parent app). */
  actor: string;
  /** Whether this event has been verified against its hash. */
  verified: boolean;
}

/** A node in the Merkle tree. */
export interface MerkleNode {
  hash: string;
  leftChildHash: string | null;
  rightChildHash: string | null;
  /** Event ID if this is a leaf node. */
  eventId?: string;
  /** Whether this is a leaf or internal node. */
  isLeaf: boolean;
}

/** The Merkle tree root with its signature. */
export interface MerkleRoot {
  appId: string;
  rootHash: string;
  /** All node hashes in the tree, for verification. */
  nodeHashes: string[];
  /** Leaf hashes in order. */
  leafHashes: string[];
  /** Number of leaves (events) included. */
  leafCount: number;
  /** Ed25519 signature of the root hash, hex-encoded. */
  signature: string;
  /** Public key used to sign, hex-encoded. */
  signingPublicKey: string;
  /** Key ID for key rotation tracking. */
  keyId: string;
  /** When this root was computed and signed. */
  signedAt: string;
  /** Previous root hash, for chain verification. */
  previousRootHash: string | null;
}

/** The independent identity of a single application in the city. */
export interface AppIdentity {
  id: string;
  /** Human-readable name. */
  name: string;
  /** Cryptographically random unique identifier. */
  publicKey: string;
  /** The market problem this app addresses, documented at ideation. */
  marketProblem: string;
  /** Current lifecycle stage. */
  stage: AppLifecycleStage;
  /** Parent app ID if this app was authorized by another app. */
  parentAppId: string | null;
  /** Git repository URL or path. */
  repository: string;
  /** Deployment environment identifier. */
  deploymentEnvironment: string;
  /** Deployment URL if deployed. */
  deploymentUrl: string | null;
  /** Operating budget in USD cents. */
  budgetCents: number;
  /** Budget spent to date in USD cents. */
  budgetSpentCents: number;
  /** License identifier (e.g., MIT, Apache-2.0, proprietary). */
  license: string;
  /** Market thesis: what value this app defends. */
  marketThesis: string;
  /** Model and tool records used during development. */
  modelToolRecords: ModelToolRecord[];
  /** Source history (git commits or equivalent). */
  sourceHistory: SourceHistoryEntry[];
  /** Current version string. */
  version: string;
  /** When this app was created. */
  createdAt: string;
  /** When this app was last updated. */
  updatedAt: string;
  /** Whether this app is currently active. */
  active: boolean;
  /** Reason for rejection if stage is "rejected". */
  rejectionReason: string | null;
}

/** Record of a model or tool used during app development. */
export interface ModelToolRecord {
  id: string;
  name: string;
  version: string;
  role: string;
  usedAt: string;
}

/** A source history entry (git commit or equivalent). */
export interface SourceHistoryEntry {
  hash: string;
  author: string;
  timestamp: string;
  message: string;
}

/** The structured prior-art search conducted before implementation. */
export interface PriorArtSearch {
  id: string;
  appId: string;
  /** The claim being searched against. */
  claim: string;
  /** Search boundaries: what was searched and what was not. */
  searchBoundaries: SearchBoundary;
  /** Sources consulted during the search. */
  sources: PriorArtSource[];
  /** What was found within the search scope. */
  findings: PriorArtFinding[];
  /** The specific combination of features believed to be differentiated. */
  differentiatingClaims: DifferentiatingClaim[];
  /** Whether material prior art was found within scope. */
  materialPriorArtFound: boolean;
  /** Summary of the search outcome. */
  summary: string;
  /** Confidence in the search completeness (0..1). */
  searchConfidence: number;
  /** Explicit disclaimer: this search does not constitute a novelty determination. */
  noveltyDisclaimer: string;
  /** Whether patent counsel review is recommended. */
  patentCounselReviewRecommended: boolean;
  /** When the search was conducted. */
  searchedAt: string;
  /** Content hash of the search record. */
  contentHash: string;
}

/** What was searched and what was explicitly excluded. */
export interface SearchBoundary {
  /** Domains searched (e.g., "github.com", "patents.google.com", "scholar.google.com"). */
  domainsSearched: string[];
  /** Date range of publications searched. */
  dateRange: { start: string; end: string };
  /** Keywords and queries used. */
  searchQueries: string[];
  /** Categories searched (extending SPINOR's 13 categories). */
  categoriesSearched: string[];
  /** What was explicitly excluded from the search and why. */
  exclusions: { scope: string; reason: string }[];
  /** Languages searched. */
  languages: string[];
  /** Jurisdictions searched for patents. */
  patentJurisdictions: string[];
}

/** A single source consulted during prior-art search. */
export interface PriorArtSource {
  id: string;
  url: string;
  title: string;
  type: "patent" | "academic_paper" | "open_source_project" | "product" | "documentation" | "blog_post" | "internal_record";
  accessedAt: string;
  relevance: "high" | "medium" | "low";
  summary: string;
}

/** A finding from the prior-art search. */
export interface PriorArtFinding {
  id: string;
  sourceId: string;
  /** What the prior art does. */
  description: string;
  /** How it overlaps with the proposed app. */
  overlap: string;
  /** Whether this finding blocks the differentiating claims. */
  blocksDifferentiation: boolean;
  /** Whether this finding was found within the search boundaries. */
  withinScope: boolean;
}

/** A specific feature combination believed to be differentiated. */
export interface DifferentiatingClaim {
  id: string;
  /** The feature or combination being claimed as differentiated. */
  claim: string;
  /** Why it is believed to differ from found prior art. */
  differentiationBasis: string;
  /** Evidence supporting the differentiation (or "no evidence found within scope"). */
  evidence: string;
  /** Whether this claim has been reviewed by patent counsel. */
  patentCounselReviewed: boolean;
  /** Counsel's assessment if reviewed. */
  counselAssessment: string | null;
}

/** Result of the minimum differentiation check. */
export interface DifferentiationResult {
  appId: string;
  passed: boolean;
  /** Score 0..1, higher = more differentiated. */
  differentiationScore: number;
  /** Specific failures that prevented passing. */
  failures: string[];
  /** Warnings that don't block but should be addressed. */
  warnings: string[];
  /** Whether the app appears to be a cosmetic variant of an existing app. */
  isCosmeticVariant: boolean;
  /** If cosmetic variant, which existing app it resembles. */
  resemblesAppId: string | null;
  /** Similarity score to the most similar existing app (0..1). */
  maxSimilarity: number;
  /** Checked at. */
  checkedAt: string;
}

/** Minimum requirements every app must satisfy. */
export interface MinimumRequirements {
  differentiation: boolean;
  operationalIndependence: boolean;
  reproducibility: boolean;
  security: boolean;
  marketTesting: boolean;
  /** Details for each requirement. */
  details: {
    differentiation: { passed: boolean; reason: string };
    operationalIndependence: { passed: boolean; reason: string };
    reproducibility: { passed: boolean; reason: string };
    security: { passed: boolean; reason: string };
    marketTesting: { passed: boolean; reason: string };
  };
}

/** A capability grant from a parent app to a child or successor. */
export interface CapabilityGrant {
  id: string;
  /** The app granting the capability. */
  parentAppId: string;
  /** The app receiving the capability. */
  childAppId: string;
  /** What capability is being granted. */
  capability: GrantCapability;
  /** Conditions under which the grant is valid. */
  conditions: string[];
  /** When the grant was made. */
  grantedAt: string;
  /** When the grant expires, if applicable. */
  expiresAt: string | null;
  /** Whether the grant has been revoked. */
  revoked: boolean;
  /** Reason for revocation if applicable. */
  revocationReason: string | null;
  /** Content hash of the grant record. */
  contentHash: string;
  /** Signature of the parent app's key over the content hash. */
  signature: string;
}

/** Types of capabilities a parent can grant to a child. */
export type GrantCapability =
  | "create_child_app"
  | "create_new_version"
  | "inherit_infrastructure"
  | "inherit_prior_art_corpus"
  | "inherit_deployment_pattern"
  | "market_to_parent_audience"
  | "use_parent_brand";

/** The lineage record linking an app to its ancestry. */
export interface LineageRecord {
  id: string;
  appId: string;
  /** Parent app ID if this app was authorized by another. */
  parentAppId: string | null;
  /** All ancestor app IDs from root to parent. */
  ancestorAppIds: string[];
  /** Child app IDs authorized by this app. */
  childAppIds: string[];
  /** Sibling app IDs (same parent). */
  siblingAppIds: string[];
  /** Components inherited from parent. */
  inheritedComponents: InheritedComponent[];
  /** What this app changed relative to its parent. */
  changesFromParent: string[];
  /** Merkle root hash at the time of this lineage record. */
  merkleRootHash: string;
  /** When this lineage record was created. */
  createdAt: string;
  /** Content hash of the lineage record. */
  contentHash: string;
}

/** A component inherited from a parent app. */
export interface InheritedComponent {
  component: string;
  version: string;
  /** Whether it was modified from the parent's version. */
  modified: boolean;
  /** What was modified, if anything. */
  modificationDescription: string | null;
}

/** The IP evidence package for a single app. */
export interface IPEvidencePackage {
  id: string;
  appId: string;
  /** The prior-art search record. */
  priorArtSearchId: string;
  /** The differentiation review result. */
  differentiationResultId: string;
  /** All differentiating claims. */
  differentiatingClaims: DifferentiatingClaim[];
  /** Search boundaries documented. */
  searchBoundaries: SearchBoundary;
  /** Sources consulted. */
  sourcesConsulted: PriorArtSource[];
  /** Merkle root at the time of packaging. */
  merkleRootHash: string;
  /** Lineage record hash. */
  lineageRecordHash: string;
  /** Explicit disclaimer about novelty determinations. */
  noveltyDisclaimer: string;
  /** Whether patent counsel has reviewed this package. */
  patentCounselReviewed: boolean;
  /** Counsel review notes if available. */
  counselReviewNotes: string | null;
  /** When this package was assembled. */
  assembledAt: string;
  /** Content hash of the entire package. */
  contentHash: string;
}

/** Market test result for an app. */
export interface MarketTestResult {
  id: string;
  appId: string;
  /** What was tested. */
  hypothesis: string;
  /** Metrics observed. */
  metrics: { metric: string; value: number; unit: string; baseline: number }[];
  /** Whether the market test supported the thesis. */
  supported: boolean;
  /** Evidence supporting the conclusion. */
  evidence: string;
  /** Sample size. */
  sampleSize: number;
  /** Test duration in days. */
  durationDays: number;
  /** When the test was conducted. */
  testedAt: string;
  /** Content hash of the test result. */
  contentHash: string;
}

/** The evaluation result for an app. */
export interface AppEvaluationResult {
  appId: string;
  minimumRequirements: MinimumRequirements;
  differentiationResult: DifferentiationResult;
  marketTestResults: MarketTestResult[];
  /** Overall pass/fail. */
  passed: boolean;
  /** Overall score 0..1. */
  score: number;
  /** Evaluated at. */
  evaluatedAt: string;
}

/** The full city state snapshot. */
export interface CityState {
  apps: AppIdentity[];
  events: MaterialEvent[];
  merkleRoots: MerkleRoot[];
  priorArtSearches: PriorArtSearch[];
  differentiationResults: DifferentiationResult[];
  capabilityGrants: CapabilityGrant[];
  lineageRecords: LineageRecord[];
  ipEvidencePackages: IPEvidencePackage[];
  marketTestResults: MarketTestResult[];
  evaluationResults: AppEvaluationResult[];
}

/** Key pair for signing Merkle roots. */
export interface SigningKeyPair {
  publicKey: string;
  privateKey: string;
  keyId: string;
  createdAt: string;
}
