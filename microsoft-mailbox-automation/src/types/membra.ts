// ─── MEMBRA RUNTIME ─────────────────────────────────────────────────
// Proof-to-Collateral Operating System
//
// Converts software and AI artifacts into content-addressed, verifiable,
// metered, reusable execution units (GGFUs) that are assembled at
// runtime and tracked throughout their lifecycle.
//
// Core thesis: a software or AI artifact can be decomposed into
// content-addressed, verifiable, metered, reusable execution units
// that are assembled at runtime and tracked throughout their lifecycle.

// ═══════════════════════════════════════════════════════════════════
// Section 1: GGFU Manifest
// ═══════════════════════════════════════════════════════════════════

/** Schema version for forward compatibility. */
export type MembraSchemaVersion = "0.1.0";

/** The kind of content inside a GGFU unit. */
export type GGFUUnitType =
  | "python_module"
  | "python_package"
  | "wasm_function"
  | "wasm_module"
  | "model_weights"
  | "model_adapter"
  | "prompt_template"
  | "dataset_fragment"
  | "configuration"
  | "tokenizer_segment"
  | "cached_inference_state"
  | "remote_endpoint"
  | "audio_representation"
  | "executable_function"
  | "frame"
  | "proprietary_payload"
  | "documentation"
  | "test_fixture";

/** Execution runtime types supported by the system. */
export type ExecutionRuntime =
  | "python_subprocess"
  | "wasi_preview1"
  | "remote_endpoint"
  | "browser_wasm"
  | "native";

/** Network policy for sandboxed execution. */
export type NetworkPolicy = "deny" | "allow_listed" | "allow_all";

/** Reversibility classification for a unit. */
export type ReversibilityClass =
  | "reversible"
  | "lossy"
  | "non_reversible";

/** Trust classification for remote execution. */
export type RemoteTrustClass =
  | "UNVERIFIED_REMOTE"
  | "SIGNED_PROVIDER"
  | "REPRODUCIBLE_REMOTE"
  | "HARDWARE_ATTESTED"
  | "MULTI_PROVIDER_VERIFIED";

/** Pricing policy for metering. */
export type PricingPolicy = "free" | "informational" | "metered" | "subscription";

/** The content descriptor for a GGFU unit. */
export interface GGFUContent {
  hash: string;
  sizeBytes: number;
  mediaType: string;
  /** Encryption descriptor if the payload is encrypted. */
  encryption: GGFUEncryption | null;
  /** Chunk list if the content is chunked. */
  chunks: GGFUChunkRef[];
}

/** Encryption metadata for private payloads. */
export interface GGFUEncryption {
  algorithm: string;
  keyId: string;
  iv: string;
  authTag: string;
}

/** Reference to a content-defined chunk. */
export interface GGFUChunkRef {
  index: number;
  hash: string;
  sizeBytes: number;
}

/** Interface declaration for a GGFU unit. */
export interface GGFUInterface {
  inputs: Record<string, string>;
  outputs: Record<string, string>;
}

/** Dependency declaration. */
export interface GGFUDependency {
  ggfuId: string;
  constraint: string;
  required: boolean;
  /** Whether this dependency is a shared frame. */
  isFrame: boolean;
}

/** Execution policy for a GGFU unit. */
export interface GGFUExecution {
  runtime: ExecutionRuntime;
  entrypoint: string;
  timeoutMs: number;
  memoryLimitMb: number;
  networkPolicy: NetworkPolicy;
  /** Remote endpoint URL if runtime is "remote_endpoint". */
  remoteEndpointUrl: string | null;
  /** Trust classification for remote execution. */
  remoteTrustClass: RemoteTrustClass | null;
}

/** Reversibility declaration. */
export interface GGFUReversibility {
  classification: ReversibilityClass;
  inverseEntrypoint: string | null;
  proofMethod: string | null;
  /** Expected loss ratio for lossy transformations (0..1). */
  lossRatio: number | null;
}

/** License declaration. */
export interface GGFULicense {
  spdxId: string;
  commercialUse: boolean;
  redistribution: boolean;
  /** Custom terms if not using a standard SPDX license. */
  customTerms: string | null;
}

/** Metering rules. */
export interface GGFUMetering {
  unit: "execution_ms" | "invocation" | "token" | "byte" | "second";
  pricePolicy: PricingPolicy;
  rate: string;
}

/** Provenance information. */
export interface GGFUProvenance {
  sourceUri: string;
  sourceCommit: string;
  buildRecipeHash: string;
  parentIds: string[];
  /** Whether this unit was derived from another unit. */
  isDerivation: boolean;
}

/** Cryptographic signature. */
export interface GGFUSignature {
  algorithm: "ed25519";
  publicKey: string;
  value: string;
  signedAt: string;
}

/** Publisher identity. */
export interface GGFUPublisher {
  id: string;
  displayName: string;
}

/** The complete GGFU manifest. */
export interface GGFUManifest {
  schemaVersion: MembraSchemaVersion;
  ggfuId: string;
  name: string;
  version: string;
  unitType: GGFUUnitType;
  createdAt: string;
  publisher: GGFUPublisher;
  content: GGFUContent;
  interface: GGFUInterface;
  dependencies: GGFUDependency[];
  execution: GGFUExecution;
  reversibility: GGFUReversibility;
  license: GGFULicense;
  metering: GGFUMetering;
  provenance: GGFUProvenance;
  signature: GGFUSignature | null;
  /** Logical identifier stable across versions. */
  logicalId: string;
  /** Whether this unit is public or private. */
  visibility: "public" | "private";
  /** Tags for discovery and classification. */
  tags: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Section 2: Scanner Types
// ═══════════════════════════════════════════════════════════════════

/** File classification categories. */
export type FileClass =
  | "python_source"
  | "python_test"
  | "wasm_binary"
  | "model_weights"
  | "model_config"
  | "prompt_template"
  | "dataset"
  | "configuration"
  | "documentation"
  | "license_file"
  | "secret"
  | "binary"
  | "asset"
  | "manifest"
  | "unknown";

/** A scanned file entry. */
export interface ScannedFile {
  relativePath: string;
  absolutePath: string;
  fileClass: FileClass;
  role?: ComponentRole;
  sizeBytes: number;
  contentHash: string;
  /** Detected encoding. */
  encoding: string;
  /** Detected language if source code. */
  language: string | null;
  /** Whether the file is binary. */
  isBinary: boolean;
  /** Detected license if identifiable. */
  detectedLicense: string | null;
  /** Secret detection results. */
  secretFindings: SecretFinding[];
  /** Detected dependencies in this file. */
  detectedDependencies: string[];
}

/** A detected secret in a file. */
export interface SecretFinding {
  line: number;
  column: number;
  pattern: string;
  severity: "critical" | "high" | "medium" | "low";
  maskedValue: string;
}

/** Result of scanning an artifact. */
export interface ScanResult {
  scanId: string;
  sourceUri: string;
  sourceType: "git" | "local_dir" | "python_package" | "model_bundle" | "url";
  scannedAt: string;
  files: ScannedFile[];
  totalFiles: number;
  totalBytes: number;
  duplicateClusters: DuplicateCluster[];
  detectedDependencies: DependencyInventory[];
  secretCount: number;
  licenseSummary: Record<string, number>;
  /** Whether the scan is deterministic (same input → same output). */
  deterministic: boolean;
}

/** A cluster of files with identical content hashes. */
export interface DuplicateCluster {
  contentHash: string;
  files: string[];
  sizeBytes: number;
}

/** A detected dependency. */
export interface DependencyInventory {
  name: string;
  version: string | null;
  type: "python_import" | "npm_require" | "system" | "model_dependency";
  foundIn: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Section 3: Decomposer Types
// ═══════════════════════════════════════════════════════════════════

/** Classification of a component as frame or payload. */
export type ComponentRole = "frame" | "proprietary_payload" | "external_dependency" | "execution_only" | "optional_asset" | "secret_external";

/** A node in the dependency graph. */
export interface GraphNode {
  ggfuId: string;
  name: string;
  role: ComponentRole;
  fileClass: FileClass;
  contentHash: string;
  sizeBytes: number;
  isDuplicate: boolean;
  /** If duplicate, points to the canonical version. */
  canonicalId: string | null;
}

/** An edge in the dependency graph. */
export interface GraphEdge {
  fromId: string;
  toId: string;
  edgeType: "depends_on" | "imports" | "calls" | "contains" | "derives_from";
  required: boolean;
}

/** The complete decomposed artifact graph. */
export interface ArtifactGraph {
  graphId: string;
  scanId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  frames: FrameDefinition[];
  payloads: PayloadDefinition[];
  cycles: string[][];
  unresolvedRisks: string[];
  createdAt: string;
}

/** A reusable frame shared across multiple GGFUs. */
export interface FrameDefinition {
  frameId: string;
  name: string;
  componentIds: string[];
  contentHash: string;
  /** How many artifacts share this frame. */
  reuseCount: number;
}

/** A proprietary payload inserted into a frame. */
export interface PayloadDefinition {
  payloadId: string;
  name: string;
  componentIds: string[];
  contentHash: string;
  /** The frame this payload is designed for. */
  frameId: string | null;
  isEncrypted: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Section 4: Continuity Ledger
// ═══════════════════════════════════════════════════════════════════

/** Event types in the continuity ledger. */
export type ContinuityEventType =
  | "ARTIFACT_CREATED"
  | "ARTIFACT_IMPORTED"
  | "COMPONENT_EXTRACTED"
  | "MANIFEST_SIGNED"
  | "COMPONENT_PUBLISHED"
  | "COMPONENT_RETRIEVED"
  | "COMPONENT_VERIFIED"
  | "EXECUTION_STARTED"
  | "EXECUTION_COMPLETED"
  | "EXECUTION_FAILED"
  | "OUTPUT_CREATED"
  | "DERIVATION_CREATED"
  | "LICENSE_GRANTED"
  | "LICENSE_REVOKED"
  | "REFERENCE_RECORDED"
  | "APPRAISAL_GENERATED";

/** A continuity event in the append-only ledger. */
export interface ContinuityEvent {
  eventId: string;
  eventType: ContinuityEventType;
  timestamp: string;
  actorId: string;
  ggfuId: string;
  sessionId: string | null;
  inputHash: string | null;
  outputHash: string | null;
  metrics: ExecutionMetrics | null;
  previousEventHash: string | null;
  contentHash: string;
  signature: string | null;
  signingPublicKey: string | null;
  /** Additional event-specific payload. */
  payload: Record<string, unknown>;
}

/** Resource consumption metrics for an execution. */
export interface ExecutionMetrics {
  durationMs: number;
  cpuMs: number;
  peakMemoryMb: number;
  bytesReceived: number;
  bytesSent: number;
  endpointCalls: number;
}

/** A signed Merkle root for a batch of continuity events. */
export interface ContinuityMerkleRoot {
  rootHash: string;
  nodeHashes: string[];
  leafHashes: string[];
  leafCount: number;
  signature: string;
  signingPublicKey: string;
  keyId: string;
  signedAt: string;
  previousRootHash: string | null;
}

// ═══════════════════════════════════════════════════════════════════
// Section 5: Execution Receipt
// ═══════════════════════════════════════════════════════════════════

/** A receipt proving an execution occurred with specific inputs and outputs. */
export interface ExecutionReceipt {
  receiptId: string;
  sessionId: string;
  targetManifestId: string;
  startedAt: string;
  completedAt: string;
  status: "completed" | "failed" | "timeout";
  inputHash: string;
  outputHash: string | null;
  error: string | null;
  metrics: ExecutionMetrics;
  /** Per-component attribution. */
  componentAttribution: ComponentAttribution[];
  /** Policy decisions made during execution. */
  policyDecisions: string[];
  /** Operator table used (if contextual operators were active). */
  operatorTableHash: string | null;
  signature: string | null;
}

/** Attribution of execution time and resources to a specific component. */
export interface ComponentAttribution {
  ggfuId: string;
  name: string;
  durationMs: number;
  cpuMs: number;
  calls: number;
  bytesTransferred: number;
  /** Estimated cost in USD. */
  estimatedCostUsd: number;
}

// ═══════════════════════════════════════════════════════════════════
// Section 6: Appraisal
// ═══════════════════════════════════════════════════════════════════

/** Dimensions scored in an artifact appraisal. */
export interface AppraisalDimensions {
  reproducibility: number;
  security: number;
  maintainability: number;
  dependencyStability: number;
  testCoverage: number;
  documentationQuality: number;
  provenanceCompleteness: number;
  licenseClarity: number;
  uniqueness: number;
  usageEvidence: number;
  integrationCost: number;
  replacementCost: number;
  marketRelevance: number;
}

/** The computed technical score. */
export interface TechnicalScore {
  score: number;
  breakdown: {
    dimension: string;
    weight: number;
    value: number;
    contribution: number;
  }[];
}

/** A valuation range with assumptions. */
export interface ValuationRange {
  low: number;
  mid: number;
  high: number;
  currency: string;
  assumptions: string[];
  confidenceDiscount: number;
}

/** The complete appraisal report. */
export interface AppraisalReport {
  appraisalId: string;
  targetGgfuId: string;
  targetName: string;
  generatedAt: string;
  dimensions: AppraisalDimensions;
  technicalScore: TechnicalScore;
  valuation: ValuationRange;
  securityFindings: string[];
  dependencyRisks: string[];
  evidenceReferences: string[];
  /** Explicit disclaimer. */
  disclaimer: string;
}

// ═══════════════════════════════════════════════════════════════════
// Section 7: Evidence Packet
// ═══════════════════════════════════════════════════════════════════

/** A portable, signed evidence packet. */
export interface EvidencePacket {
  packetId: string;
  targetGgfuId: string;
  targetName: string;
  generatedAt: string;
  artifactManifest: GGFUManifest;
  componentManifests: GGFUManifest[];
  dependencyGraph: ArtifactGraph;
  signatures: { ggfuId: string; signature: GGFUSignature }[];
  buildAttestations: BuildAttestation[];
  testResults: TestResult[];
  executionReceipts: ExecutionReceipt[];
  provenanceEvents: ContinuityEvent[];
  licenseReport: LicenseReport;
  securityReport: SecurityReport;
  reproducibilityReport: ReproducibilityReport;
  appraisalReport: AppraisalReport;
  merkleProof: MerkleProofBundle;
  /** Packet-level signature. */
  packetSignature: GGFUSignature | null;
}

/** A build attestation. */
export interface BuildAttestation {
  buildId: string;
  ggfuId: string;
  builtAt: string;
  buildRecipeHash: string;
  outputHash: string;
  reproducible: boolean;
  environment: Record<string, string>;
}

/** A test result. */
export interface TestResult {
  testId: string;
  ggfuId: string;
  passed: boolean;
  testCount: number;
  failureCount: number;
  durationMs: number;
  output: string;
}

/** License report summarizing all component licenses. */
export interface LicenseReport {
  licenses: { ggfuId: string; spdxId: string; commercialUse: boolean; redistribution: boolean }[];
  conflicts: string[];
  recommendations: string[];
}

/** Security report. */
export interface SecurityReport {
  secretFindings: { ggfuId: string; findings: SecretFinding[] }[];
  vulnerabilities: string[];
  recommendations: string[];
}

/** Reproducibility report. */
export interface ReproducibilityReport {
  reproducible: boolean;
  attempts: number;
  successes: number;
  failures: number;
  outputHashMatches: boolean[];
  notes: string[];
}

/** Merkle proof bundle for inclusion verification. */
export interface MerkleProofBundle {
  rootHash: string;
  leafHash: string;
  proof: { hash: string; isRight: boolean }[];
  signature: string;
  signingPublicKey: string;
}

// ═══════════════════════════════════════════════════════════════════
// Section 8: Reversible Codec Plugin Interface
// ═══════════════════════════════════════════════════════════════════

/** A reversible transformation codec. */
export interface ReversibleCodec {
  name: string;
  version: string;
  encode(source: Buffer): Buffer;
  decode(encoded: Buffer): Buffer;
  verify(source: Buffer, encoded: Buffer): boolean;
}

/** Registry of available codecs. */
export interface CodecRegistry {
  codecs: { name: string; version: string; classification: ReversibilityClass }[];
}

// ═══════════════════════════════════════════════════════════════════
// Section 9: Contextual Operators
// ═══════════════════════════════════════════════════════════════════

/** An operator definition with context-dependent behavior. */
export interface ContextualOperator {
  operator: string;
  namespace: string;
  profiles: OperatorProfile[];
}

/** A profile under which an operator behaves differently. */
export interface OperatorProfile {
  name: string;
  effectiveFrom: string;
  effectiveUntil: string;
  behavior: string;
  resolution: Record<string, unknown>;
}

/** An operator table used during a specific execution. */
export interface OperatorTable {
  tableId: string;
  operators: ContextualOperator[];
  selectedProfile: string;
  tableHash: string;
  signedAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// Section 10: Registry and Storage
// ═══════════════════════════════════════════════════════════════════

/** A registry entry for a published unit. */
export interface RegistryEntry {
  logicalId: string;
  version: string;
  ggfuId: string;
  manifestHash: string;
  publisherId: string;
  publishedAt: string;
  visibility: "public" | "private";
  deprecated: boolean;
  deprecationReason: string | null;
}

/** A content-addressed storage entry. */
export interface CASEntry {
  hash: string;
  sizeBytes: number;
  mediaType: string;
  storedAt: string;
  /** Storage backend identifier. */
  backend: "local" | "s3" | "registry" | "peer";
  /** Whether the content is encrypted. */
  encrypted: boolean;
  /** Tombstone if deleted. */
  tombstone: boolean;
}

/** A remote endpoint declaration. */
export interface RemoteEndpoint {
  endpointId: string;
  ggfuId: string;
  url: string;
  trustClass: RemoteTrustClass;
  healthCheckUrl: string | null;
  lastHealthCheck: string | null;
  healthy: boolean;
  pricing: { unit: string; rate: string } | null;
}

// ═══════════════════════════════════════════════════════════════════
// Section 11: Execution Session
// ═══════════════════════════════════════════════════════════════════

/** An execution session. */
export interface ExecutionSession {
  sessionId: string;
  targetManifestId: string;
  status: "pending" | "resolving" | "executing" | "completed" | "failed" | "timeout";
  startedAt: string;
  completedAt: string | null;
  inputs: Record<string, unknown>;
  inputsHash: string;
  outputs: Record<string, unknown> | null;
  outputsHash: string | null;
  error: string | null;
  executionPolicy: ExecutionPolicy;
  resolvedComponents: string[];
  receipts: ExecutionReceipt[];
}

/** Execution policy for a session. */
export interface ExecutionPolicy {
  network: NetworkPolicy;
  maxCostUsd: number;
  timeoutMs: number;
  memoryLimitMb: number;
  allowRemote: boolean;
  allowedRegistries: string[];
}
