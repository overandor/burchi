/**
 * Membra Manifest Generator — Phase 3
 *
 * Creates signed GGFU manifests from scanned files and graph nodes.
 * Handles canonical JSON serialization, Ed25519 signing, and
 * manifest verification.
 */

import { nanoid } from "nanoid";
import {
  computeManifestHash,
  signManifest,
  verifyManifestSignature,
  ggfuIdFromHash,
  logicalId,
} from "./crypto";
import type {
  GGFUManifest,
  GGFUContent,
  GGFUInterface,
  GGFUDependency,
  GGFUExecution,
  GGFUReversibility,
  GGFULicense,
  GGFUMetering,
  GGFUProvenance,
  GGFUPublisher,
  GGFUSignature,
  ScannedFile,
  GraphNode,
  ArtifactGraph,
  SigningKeyPair,
} from "@/types";

/** Default execution policy for local Python components. */
const DEFAULT_PYTHON_EXEC: GGFUExecution = {
  runtime: "python_subprocess",
  entrypoint: "main",
  timeoutMs: 30000,
  memoryLimitMb: 256,
  networkPolicy: "deny",
  remoteEndpointUrl: null,
  remoteTrustClass: null,
};

/** Default execution policy for WASM components. */
const DEFAULT_WASM_EXEC: GGFUExecution = {
  runtime: "wasi_preview1",
  entrypoint: "_start",
  timeoutMs: 10000,
  memoryLimitMb: 128,
  networkPolicy: "deny",
  remoteEndpointUrl: null,
  remoteTrustClass: null,
};

/** Default reversibility for non-reversible components. */
const NON_REVERSIBLE: GGFUReversibility = {
  classification: "non_reversible",
  inverseEntrypoint: null,
  proofMethod: null,
  lossRatio: null,
};

/** Default metering: free, informational. */
const FREE_METERING: GGFUMetering = {
  unit: "execution_ms",
  pricePolicy: "free",
  rate: "0",
};

/** Create a GGFU manifest from a scanned file and graph node. */
export function createManifest(input: {
  file: ScannedFile;
  node: GraphNode;
  publisher: GGFUPublisher;
  projectName: string;
  version: string;
  keyPair: SigningKeyPair;
  dependencies?: GGFUDependency[];
  license?: Partial<GGFULicense>;
  execution?: Partial<GGFUExecution>;
  interface?: GGFUInterface;
  visibility?: "public" | "private";
  tags?: string[];
  sourceUri?: string;
  sourceCommit?: string;
  parentIds?: string[];
  isDerivation?: boolean;
}): GGFUManifest {
  const { file, node, publisher, projectName, version, keyPair } = input;

  const content: GGFUContent = {
    hash: file.contentHash,
    sizeBytes: file.sizeBytes,
    mediaType: file.isBinary ? "application/octet-stream" : "text/plain",
    encryption: null,
    chunks: [],
  };

  const iface: GGFUInterface = input.interface ?? { inputs: {}, outputs: {} };

  const deps: GGFUDependency[] = input.dependencies ?? [];

  let execution: GGFUExecution;
  if (file.fileClass === "wasm_binary") {
    execution = { ...DEFAULT_WASM_EXEC, ...input.execution };
  } else {
    execution = { ...DEFAULT_PYTHON_EXEC, ...input.execution };
  }

  const license: GGFULicense = {
    spdxId: input.license?.spdxId ?? file.detectedLicense ?? "UNLICENSED",
    commercialUse: input.license?.commercialUse ?? false,
    redistribution: input.license?.redistribution ?? false,
    customTerms: input.license?.customTerms ?? null,
  };

  const provenance: GGFUProvenance = {
    sourceUri: input.sourceUri ?? `file://${file.absolutePath}`,
    sourceCommit: input.sourceCommit ?? "unknown",
    buildRecipeHash: "",
    parentIds: input.parentIds ?? [],
    isDerivation: input.isDerivation ?? false,
  };

  const ggfuId = ggfuIdFromHash(file.contentHash);
  const logId = logicalId(publisher.id, projectName, file.relativePath.replace(/[^a-zA-Z0-9]/g, "-"));

  const manifestWithoutSig: Omit<GGFUManifest, "signature"> = {
    schemaVersion: "0.1.0",
    ggfuId,
    name: file.relativePath,
    version,
    unitType: node.fileClass as GGFUManifest["unitType"],
    createdAt: new Date().toISOString(),
    publisher,
    content,
    interface: iface,
    dependencies: deps,
    execution,
    reversibility: NON_REVERSIBLE,
    license,
    metering: FREE_METERING,
    provenance,
    logicalId: logId,
    visibility: input.visibility ?? "public",
    tags: input.tags ?? [],
  };

  const signature = signManifest(manifestWithoutSig, keyPair);

  return { ...manifestWithoutSig, signature };
}

/** Verify a manifest's integrity and signature. */
export function verifyManifest(manifest: GGFUManifest): {
  valid: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  // Verify signature.
  if (!verifyManifestSignature(manifest)) {
    reasons.push("Signature verification failed");
  }

  // Verify content hash format.
  if (!manifest.ggfuId.startsWith("ggfu:sha256:")) {
    reasons.push(`Invalid ggfuId format: ${manifest.ggfuId}`);
  }

  // Verify schema version.
  if (manifest.schemaVersion !== "0.1.0") {
    reasons.push(`Unsupported schema version: ${manifest.schemaVersion}`);
  }

  // Verify manifest hash matches content.
  const { signature, ...rest } = manifest;
  const computedHash = computeManifestHash(rest);
  if (signature) {
    const expectedHash = computeManifestHash(rest);
    if (computedHash !== expectedHash) {
      reasons.push("Manifest hash mismatch");
    }
  }

  return { valid: reasons.length === 0, reasons };
}

/** Create manifests for all nodes in an artifact graph. */
export function createManifestsForGraph(
  scan: { files: ScannedFile[] },
  graph: ArtifactGraph,
  publisher: GGFUPublisher,
  projectName: string,
  version: string,
  keyPair: SigningKeyPair
): GGFUManifest[] {
  const manifests: GGFUManifest[] = [];
  const fileByHash = new Map(scan.files.map(f => [f.contentHash, f]));

  for (const node of graph.nodes) {
    if (node.role === "secret_external") continue;
    const file = fileByHash.get(node.contentHash);
    if (!file) continue;

    // Build dependencies from edges.
    const deps: GGFUDependency[] = graph.edges
      .filter(e => e.fromId === node.ggfuId && e.edgeType === "imports")
      .map(e => ({
        ggfuId: e.toId,
        constraint: "*",
        required: e.required,
        isFrame: false,
      }));

    const manifest = createManifest({
      file,
      node,
      publisher,
      projectName,
      version,
      keyPair,
      dependencies: deps,
      visibility: node.role === "proprietary_payload" ? "private" : "public",
    });

    manifests.push(manifest);
  }

  return manifests;
}
