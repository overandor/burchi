/**
 * Membra Evidence Packet Generator — Phase 6
 *
 * Assembles a portable, signed evidence packet containing manifests,
 * signatures, dependency graph, build attestations, test results,
 * execution receipts, provenance events, license and security reports,
 * reproducibility report, appraisal, and Merkle proof.
 */

import { nanoid } from "nanoid";
import { sha256Hex, signMessage, verifySignature, canonicalJSON } from "./crypto";
import { generateAppraisal } from "./appraisal";
import type {
  EvidencePacket,
  GGFUManifest,
  ArtifactGraph,
  ExecutionReceipt,
  ContinuityEvent,
  ScanResult,
  BuildAttestation,
  TestResult,
  LicenseReport,
  SecurityReport,
  ReproducibilityReport,
  MerkleProofBundle,
  SigningKeyPair,
  GGFUSignature,
} from "@/types";

/** Generate a license report from manifests. */
function generateLicenseReport(manifests: GGFUManifest[]): LicenseReport {
  const licenses = manifests.map(m => ({
    ggfuId: m.ggfuId,
    spdxId: m.license.spdxId,
    commercialUse: m.license.commercialUse,
    redistribution: m.license.redistribution,
  }));

  const conflicts: string[] = [];
  const spdxIds = new Set(licenses.map(l => l.spdxId));
  if (spdxIds.has("GPL-3.0") && spdxIds.has("Apache-2.0")) {
    conflicts.push("GPL-3.0 and Apache-2.0 are incompatible for combined distribution");
  }
  if (spdxIds.has("UNLICENSED")) {
    conflicts.push("One or more components are UNLICENSED — cannot distribute");
  }

  const recommendations: string[] = [];
  if (conflicts.length === 0) {
    recommendations.push("No license conflicts detected");
  } else {
    recommendations.push("Resolve license conflicts before distribution");
  }

  return { licenses, conflicts, recommendations };
}

/** Generate a security report from manifests and scan. */
function generateSecurityReport(
  manifests: GGFUManifest[],
  scan?: ScanResult
): SecurityReport {
  const secretFindings: { ggfuId: string; findings: SecurityReport["secretFindings"][0]["findings"] }[] = [];
  const vulnerabilities: string[] = [];

  if (scan) {
    for (const file of scan.files) {
      if (file.secretFindings.length > 0) {
        const manifest = manifests.find(m => m.content.hash === file.contentHash);
        secretFindings.push({
          ggfuId: manifest?.ggfuId ?? "unknown",
          findings: file.secretFindings,
        });
      }
    }
  }

  const recommendations: string[] = [];
  if (secretFindings.length > 0) {
    recommendations.push("Remove all detected secrets and rotate compromised credentials");
  }
  if (vulnerabilities.length === 0 && secretFindings.length === 0) {
    recommendations.push("No security issues detected in automated scan");
  }

  return { secretFindings, vulnerabilities, recommendations };
}

/** Generate a reproducibility report from receipts. */
function generateReproducibilityReport(
  receipts: ExecutionReceipt[]
): ReproducibilityReport {
  if (receipts.length === 0) {
    return {
      reproducible: false,
      attempts: 0,
      successes: 0,
      failures: 0,
      outputHashMatches: [],
      notes: ["No execution receipts available for reproducibility assessment"],
    };
  }

  const successful = receipts.filter(r => r.status === "completed");
  const outputHashes = successful.map(r => r.outputHash);
  const uniqueHashes = new Set(outputHashes.filter(Boolean));
  const reproducible = uniqueHashes.size === 1 && successful.length > 1;

  return {
    reproducible,
    attempts: receipts.length,
    successes: successful.length,
    failures: receipts.length - successful.length,
    outputHashMatches: successful.map(r => r.outputHash === outputHashes[0]),
    notes: reproducible
      ? ["All successful executions produced identical output hashes"]
      : ["Output hashes differ across executions — investigate non-determinism"],
  };
}

/** Generate a complete evidence packet. */
export function generateEvidencePacket(input: {
  targetManifest: GGFUManifest;
  componentManifests: GGFUManifest[];
  graph: ArtifactGraph;
  receipts: ExecutionReceipt[];
  events: ContinuityEvent[];
  scan?: ScanResult;
  buildAttestations?: BuildAttestation[];
  testResults?: TestResult[];
  keyPair: SigningKeyPair;
  merkleProof?: MerkleProofBundle;
}): EvidencePacket {
  const {
    targetManifest,
    componentManifests,
    graph,
    receipts,
    events,
    scan,
    buildAttestations,
    testResults,
    keyPair,
  } = input;

  const allManifests = [targetManifest, ...componentManifests];
  const licenseReport = generateLicenseReport(allManifests);
  const securityReport = generateSecurityReport(allManifests, scan);
  const reproducibilityReport = generateReproducibilityReport(receipts);

  const appraisal = generateAppraisal({
    manifest: targetManifest,
    scan,
    graph,
    receipts,
    events,
    testResults: testResults?.map(t => ({
      passed: t.passed,
      testCount: t.testCount,
      failureCount: t.failureCount,
    })),
  });

  const signatures = allManifests
    .filter(m => m.signature)
    .map(m => ({ ggfuId: m.ggfuId, signature: m.signature! }));

  const merkleProof: MerkleProofBundle = input.merkleProof ?? {
    rootHash: sha256Hex(events.map(e => e.contentHash).join("")),
    leafHash: events[0]?.contentHash ?? sha256Hex(""),
    proof: [],
    signature: signMessage(keyPair.privateKey, sha256Hex(events.map(e => e.contentHash).join(""))),
    signingPublicKey: keyPair.publicKey,
  };

  // Build packet without signature first.
  const packetWithoutSig: Omit<EvidencePacket, "packetSignature"> = {
    packetId: `pkt_${nanoid(16)}`,
    targetGgfuId: targetManifest.ggfuId,
    targetName: targetManifest.name,
    generatedAt: new Date().toISOString(),
    artifactManifest: targetManifest,
    componentManifests,
    dependencyGraph: graph,
    signatures,
    buildAttestations: buildAttestations ?? [],
    testResults: testResults ?? [],
    executionReceipts: receipts,
    provenanceEvents: events,
    licenseReport,
    securityReport,
    reproducibilityReport,
    appraisalReport: appraisal,
    merkleProof,
  };

  // Sign the packet.
  const packetHash = sha256Hex(canonicalJSON(packetWithoutSig));
  const packetSignature: GGFUSignature = {
    algorithm: "ed25519",
    publicKey: keyPair.publicKey,
    value: signMessage(keyPair.privateKey, packetHash),
    signedAt: new Date().toISOString(),
  };

  return { ...packetWithoutSig, packetSignature };
}

/** Verify an evidence packet's signature. */
export function verifyEvidencePacket(packet: EvidencePacket): {
  valid: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (!packet.packetSignature) {
    reasons.push("Packet has no signature");
  } else {
    const { packetSignature, ...rest } = packet;
    const packetHash = sha256Hex(canonicalJSON(rest));
    if (!verifySignature(packetSignature.publicKey, packetHash, packetSignature.value)) {
      reasons.push("Packet signature verification failed");
    }
  }

  // Verify manifest signatures.
  const allManifests = [packet.artifactManifest, ...packet.componentManifests];
  for (const manifest of allManifests) {
    if (manifest.signature) {
      const { signature, ...rest } = manifest;
      const manifestHash = sha256Hex(canonicalJSON(rest));
      if (!verifySignature(signature.publicKey, manifestHash, signature.value)) {
        reasons.push(`Manifest signature failed for ${manifest.ggfuId}`);
      }
    }
  }

  return { valid: reasons.length === 0, reasons };
}
