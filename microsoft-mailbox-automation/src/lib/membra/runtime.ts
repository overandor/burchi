/**
 * Membra Runtime Assembly — Phase 4
 *
 * Resolves a target manifest's dependency graph, retrieves components
 * from content-addressed storage, verifies hashes and signatures,
 * and executes the graph in a sandboxed environment.
 *
 * Also generates execution receipts with per-component attribution.
 */

import { nanoid } from "nanoid";
import { sha256Hex, hashObject, verifyManifestSignature } from "./crypto";
import { ContentAddressedStore } from "./cas";
import type {
  GGFUManifest,
  ExecutionSession,
  ExecutionReceipt,
  ExecutionPolicy,
  ComponentAttribution,
  ExecutionMetrics,
  ArtifactGraph,
} from "@/types";

/** Default execution policy. */
const DEFAULT_POLICY: ExecutionPolicy = {
  network: "deny",
  maxCostUsd: 0.05,
  timeoutMs: 30000,
  memoryLimitMb: 256,
  allowRemote: false,
  allowedRegistries: [],
};

/** Result of resolving a manifest's dependency graph. */
export interface ResolutionResult {
  resolved: boolean;
  manifests: GGFUManifest[];
  missing: string[];
  verificationFailures: { ggfuId: string; reasons: string[] }[];
  cycles: string[][];
}

/** Resolve a manifest and all its dependencies recursively. */
export function resolveGraph(
  targetManifest: GGFUManifest,
  registry: Map<string, GGFUManifest>,
  cas: ContentAddressedStore
): ResolutionResult {
  const resolved: GGFUManifest[] = [];
  const visited = new Set<string>();
  const missing: string[] = [];
  const verificationFailures: { ggfuId: string; reasons: string[] }[] = [];
  const cyclePath: string[] = [];

  function resolve(manifest: GGFUManifest): boolean {
    if (visited.has(manifest.ggfuId)) {
      // Already resolved or in progress (cycle).
      if (cyclePath.includes(manifest.ggfuId)) {
        return false; // Cycle detected.
      }
      return true;
    }
    visited.add(manifest.ggfuId);
    cyclePath.push(manifest.ggfuId);

    // Verify signature.
    if (!verifyManifestSignature(manifest)) {
      verificationFailures.push({
        ggfuId: manifest.ggfuId,
        reasons: ["Signature verification failed"],
      });
      return false;
    }

    // Verify content exists in CAS.
    if (!cas.exists(manifest.content.hash)) {
      missing.push(manifest.content.hash);
      return false;
    }

    // Verify content hash matches stored data.
    if (!cas.verify(manifest.content.hash)) {
      verificationFailures.push({
        ggfuId: manifest.ggfuId,
        reasons: ["Content hash mismatch with stored data"],
      });
      return false;
    }

    // Resolve dependencies.
    for (const dep of manifest.dependencies) {
      if (!dep.required) continue;
      const depManifest = registry.get(dep.ggfuId);
      if (!depManifest) {
        missing.push(dep.ggfuId);
        return false;
      }
      if (!resolve(depManifest)) {
        return false;
      }
    }

    resolved.push(manifest);
    cyclePath.pop();
    return true;
  }

  const result = resolve(targetManifest);
  const cycles: string[][] = [];

  return {
    resolved: result && missing.length === 0 && verificationFailures.length === 0,
    manifests: resolved,
    missing,
    verificationFailures,
    cycles,
  };
}

/** Create an execution session. */
export function createSession(input: {
  targetManifestId: string;
  inputs: Record<string, unknown>;
  policy?: Partial<ExecutionPolicy>;
}): ExecutionSession {
  const sessionId = `ses_${nanoid(16)}`;
  const policy = { ...DEFAULT_POLICY, ...input.policy };
  const inputsHash = sha256Hex(JSON.stringify(input.inputs));

  return {
    sessionId,
    targetManifestId: input.targetManifestId,
    status: "pending",
    startedAt: new Date().toISOString(),
    completedAt: null,
    inputs: input.inputs,
    inputsHash,
    outputs: null,
    outputsHash: null,
    error: null,
    executionPolicy: policy,
    resolvedComponents: [],
    receipts: [],
  };
}

/** Generate an execution receipt. */
export function generateReceipt(input: {
  sessionId: string;
  targetManifestId: string;
  startedAt: string;
  completedAt: string;
  status: "completed" | "failed" | "timeout";
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown> | null;
  error?: string | null;
  metrics: ExecutionMetrics;
  componentAttribution: ComponentAttribution[];
  policyDecisions?: string[];
  operatorTableHash?: string | null;
}): ExecutionReceipt {
  const receiptId = `rcpt_${nanoid(16)}`;
  const inputHash = sha256Hex(JSON.stringify(input.inputs));
  const outputHash = input.outputs ? sha256Hex(JSON.stringify(input.outputs)) : null;

  return {
    receiptId,
    sessionId: input.sessionId,
    targetManifestId: input.targetManifestId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    status: input.status,
    inputHash,
    outputHash,
    error: input.error ?? null,
    metrics: input.metrics,
    componentAttribution: input.componentAttribution,
    policyDecisions: input.policyDecisions ?? [],
    operatorTableHash: input.operatorTableHash ?? null,
    signature: null,
  };

}

/** Verify that a reconstructed output matches the original. */
export function verifyReproducibility(
  originalOutput: Record<string, unknown>,
  reconstructedOutput: Record<string, unknown>
): { matches: boolean; originalHash: string; reconstructedHash: string } {
  const originalHash = sha256Hex(JSON.stringify(originalOutput));
  const reconstructedHash = sha256Hex(JSON.stringify(reconstructedOutput));
  return {
    matches: originalHash === reconstructedHash,
    originalHash,
    reconstructedHash,
  };
}

/** Simulate execution of a resolved graph (prototype mode).
 *
 *  In the real prototype, this would dispatch to Python subprocesses,
 *  WASM runtimes, or remote endpoints. For now, it produces a receipt
 *  with deterministic metrics based on the resolved components.
 */
export function simulateExecution(input: {
  session: ExecutionSession;
  manifests: GGFUManifest[];
  outputs?: Record<string, unknown>;
}): { session: ExecutionSession; receipt: ExecutionReceipt } {
  const session = { ...input.session };
  const startedAt = session.startedAt;
  const completedAt = new Date().toISOString();

  // Build component attribution.
  const attribution: ComponentAttribution[] = input.manifests.map(m => ({
    ggfuId: m.ggfuId,
    name: m.name,
    durationMs: Math.max(1, m.content.sizeBytes / 1000),
    cpuMs: Math.max(1, m.content.sizeBytes / 2000),
    calls: 1,
    bytesTransferred: m.content.sizeBytes,
    estimatedCostUsd: 0,
  }));

  const totalDuration = attribution.reduce((sum, a) => sum + a.durationMs, 0);
  const totalCpu = attribution.reduce((sum, a) => sum + a.cpuMs, 0);
  const totalBytes = attribution.reduce((sum, a) => sum + a.bytesTransferred, 0);

  const metrics: ExecutionMetrics = {
    durationMs: totalDuration,
    cpuMs: totalCpu,
    peakMemoryMb: Math.max(...input.manifests.map(m => m.execution.memoryLimitMb), 0),
    bytesReceived: totalBytes,
    bytesSent: 0,
    endpointCalls: 0,
  };

  const outputs = input.outputs ?? { result: "simulated" };

  const receipt = generateReceipt({
    sessionId: session.sessionId,
    targetManifestId: session.targetManifestId,
    startedAt,
    completedAt,
    status: "completed",
    inputs: session.inputs,
    outputs,
    metrics,
    componentAttribution: attribution,
    policyDecisions: [`network=${session.executionPolicy.network}`, `timeout=${session.executionPolicy.timeoutMs}ms`],
  });

  session.status = "completed";
  session.completedAt = completedAt;
  session.outputs = outputs;
  session.outputsHash = receipt.outputHash;
  session.resolvedComponents = input.manifests.map(m => m.ggfuId);
  session.receipts = [receipt];

  return { session, receipt };
}
