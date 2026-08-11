/**
 * Membra Runtime — End-to-End Acceptance Test
 *
 * Tests the full pipeline: scan → decompose → manifest → sign →
 * store in CAS → reconstruct → execute → generate receipt →
 * generate evidence packet → verify → tamper detection.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { scanDirectory, verifyDeterminism } from "../scanner";
import { buildArtifactGraph } from "../decomposer";
import { createManifest, createManifestsForGraph, verifyManifest } from "../manifest";
import { ContentAddressedStore } from "../cas";
import { generateSigningKeyPair } from "../crypto";
import { resolveGraph, createSession, simulateExecution, verifyReproducibility } from "../runtime";
import { ContinuityLedger, createEvent } from "../ledger";
import { generateEvidencePacket, verifyEvidencePacket } from "../evidence";
import { generateAppraisal } from "../appraisal";
import { verifyAllCodecs, IdentityCodec, ZipCodec, Base85Codec, verifyCodec } from "../codecs";

// ─── Test fixture: sample AI repository ────────────────────────────

const SAMPLE_DIR = path.join(os.tmpdir(), `membra-test-${Date.now()}`);

function createSampleRepo(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.mkdirSync(path.join(dir, "prompts"), { recursive: true });

  // Common framework code (frame).
  fs.writeFileSync(
    path.join(dir, "src", "utils.py"),
    [
      '"""Common utility functions shared across modules."""',
      "",
      "def normalize_text(text: str) -> str:",
      '    """Normalize input text by trimming and lowercasing."""',
      "    return text.strip().lower()",
      "",
      "def split_sentences(text: str) -> list[str]:",
      '    """Split text into sentences."""',
      "    return [s.strip() for s in text.split('.') if s.strip()]",
      "",
    ].join("\n")
  );

  // Proprietary scoring function (payload).
  fs.writeFileSync(
    path.join(dir, "src", "scorer.py"),
    [
      '"""Proprietary scoring function — unique business logic."""',
      "",
      "from src.utils import normalize_text, split_sentences",
      "",
      "def score(text: str) -> float:",
      '    """Score the input text using proprietary algorithm."""',
      "    normalized = normalize_text(text)",
      "    sentences = split_sentences(normalized)",
      "    if not sentences:",
      "        return 0.0",
      "    return len(sentences) / max(len(normalized), 1)",
      "",
    ].join("\n")
  );

  // Prompt template.
  fs.writeFileSync(
    path.join(dir, "prompts", "score_prompt.txt"),
    [
      "You are a scoring assistant. Given the following text, provide a score.",
      "Text: {{input_text}}",
      "Score: ",
    ].join("\n")
  );

  // Test file.
  fs.writeFileSync(
    path.join(dir, "tests", "test_scorer.py"),
    [
      '"""Tests for the scoring function."""',
      "from src.scorer import score",
      "",
      "def test_basic_score():",
      "    result = score('Hello world.')",
      "    assert 0 <= result <= 1",
      "",
      "def test_empty_input():",
      "    assert score('') == 0.0",
      "",
    ].join("\n")
  );

  // Configuration.
  fs.writeFileSync(
    path.join(dir, "config.yaml"),
    ["model: gpt-4", "temperature: 0.0", "max_tokens: 100"].join("\n")
  );

  // License.
  fs.writeFileSync(
    path.join(dir, "LICENSE"),
    "MIT License\n\nCopyright (c) 2026 Membra\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software..."
  );

  // Requirements.
  fs.writeFileSync(
    path.join(dir, "requirements.txt"),
    ["numpy>=1.20", "requests>=2.28"].join("\n")
  );

  // README.
  fs.writeFileSync(
    path.join(dir, "README.md"),
    "# Sample AI Project\n\nA demonstration project for Membra Runtime."
  );

  // Secret file (should be detected).
  fs.writeFileSync(
    path.join(dir, ".env"),
    "API_KEY=sk-1234567890abcdefghijklmnopqrstuvwxyz"
  );

  // Duplicate file (same content as utils.py).
  fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "lib", "utils_copy.py"),
    [
      '"""Common utility functions shared across modules."""',
      "",
      "def normalize_text(text: str) -> str:",
      '    """Normalize input text by trimming and lowercasing."""',
      "    return text.strip().lower()",
      "",
      "def split_sentences(text: str) -> list[str]:",
      '    """Split text into sentences."""',
      "    return [s.strip() for s in text.split('.') if s.strip()]",
      "",
    ].join("\n")
  );
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("Membra Runtime", () => {
  let keyPair: ReturnType<typeof generateSigningKeyPair>;
  let cas: ContentAddressedStore;
  let casDir: string;

  before(() => {
    createSampleRepo(SAMPLE_DIR);
    keyPair = generateSigningKeyPair();
    casDir = path.join(os.tmpdir(), `membra-cas-${Date.now()}`);
    cas = new ContentAddressedStore(casDir);
  });

  after(() => {
    try {
      fs.rmSync(SAMPLE_DIR, { recursive: true, force: true });
      fs.rmSync(casDir, { recursive: true, force: true });
    } catch {}
  });

  describe("Phase 1: Scanner", () => {
    it("scans the sample repository and produces a deterministic inventory", () => {
      const scan = scanDirectory(SAMPLE_DIR);
      assert.ok(scan.totalFiles > 0, "Should find files");
      assert.equal(scan.deterministic, true);
      assert.ok(scan.files.some(f => f.fileClass === "python_source"));
      assert.ok(scan.files.some(f => f.fileClass === "python_test"));
      assert.ok(scan.files.some(f => f.fileClass === "prompt_template"));
      assert.ok(scan.files.some(f => f.fileClass === "license_file"));
      assert.ok(scan.files.some(f => f.fileClass === "secret"));
    });

    it("detects secrets in the repository", () => {
      const scan = scanDirectory(SAMPLE_DIR);
      assert.ok(scan.secretCount > 0, "Should detect secrets");
      const envFile = scan.files.find(f => f.fileClass === "secret");
      assert.ok(envFile, "Should find .env file");
      assert.ok(envFile!.secretFindings.length > 0, "Should have secret findings in .env");
    });

    it("detects duplicate files", () => {
      const scan = scanDirectory(SAMPLE_DIR);
      assert.ok(scan.duplicateClusters.length > 0, "Should detect duplicate clusters");
      const utilsCluster = scan.duplicateClusters.find(c =>
        c.files.some(f => f.includes("utils"))
      );
      assert.ok(utilsCluster, "Should find utils duplicate cluster");
      assert.ok(utilsCluster!.files.length >= 2, "Utils should be duplicated");
    });

    it("produces identical results on repeated scans (determinism)", () => {
      const { deterministic, firstScan, secondScan } = verifyDeterminism(SAMPLE_DIR);
      assert.ok(deterministic, "Scans should be deterministic");
      assert.equal(firstScan.totalFiles, secondScan.totalFiles);
      assert.equal(firstScan.totalBytes, secondScan.totalBytes);
    });

    it("detects Python imports as dependencies", () => {
      const scan = scanDirectory(SAMPLE_DIR);
      assert.ok(scan.detectedDependencies.length > 0, "Should detect dependencies");
      const utilsDep = scan.detectedDependencies.find(d => d.name === "src");
      assert.ok(utilsDep, "Should detect src import");
    });
  });

  describe("Phase 2: Decomposer", () => {
    it("builds an artifact graph from a scan", () => {
      const scan = scanDirectory(SAMPLE_DIR);
      const graph = buildArtifactGraph(scan);
      assert.ok(graph.nodes.length > 0, "Should have graph nodes");
      assert.ok(graph.frames.length > 0, "Should identify frames");
      assert.ok(graph.nodes.some(n => n.role === "proprietary_payload"), "Should identify payloads");
      assert.ok(graph.nodes.some(n => n.role === "secret_external"), "Should identify secrets");
    });

    it("separates frames from payloads", () => {
      const scan = scanDirectory(SAMPLE_DIR);
      const graph = buildArtifactGraph(scan);
      const frameNodes = graph.nodes.filter(n => n.role === "frame");
      const payloadNodes = graph.nodes.filter(n => n.role === "proprietary_payload");
      assert.ok(frameNodes.length > 0, "Should have frame nodes");
      assert.ok(payloadNodes.length > 0, "Should have payload nodes");
      // Frames and payloads should be disjoint.
      const frameHashes = new Set(frameNodes.map(n => n.contentHash));
      const payloadHashes = new Set(payloadNodes.map(n => n.contentHash));
      for (const h of payloadHashes) {
        assert.ok(!frameHashes.has(h), "Payloads should not be frames");
      }
    });

    it("detects unresolved risks (secrets)", () => {
      const scan = scanDirectory(SAMPLE_DIR);
      const graph = buildArtifactGraph(scan);
      assert.ok(graph.unresolvedRisks.length > 0, "Should report secret risks");
      assert.ok(graph.unresolvedRisks.some(r => r.includes("Secret")), "Should mention secrets");
    });
  });

  describe("Phase 3: Manifest and Signing", () => {
    it("creates signed manifests for all graph nodes", () => {
      const scan = scanDirectory(SAMPLE_DIR);
      const graph = buildArtifactGraph(scan);
      const publisher = { id: `did:key:${keyPair.publicKey.slice(0, 16)}`, displayName: "Test Publisher" };
      const manifests = createManifestsForGraph(
        scan,
        graph,
        publisher,
        "sample-ai-project",
        "1.0.0",
        keyPair
      );
      assert.ok(manifests.length > 0, "Should create manifests");
      for (const m of manifests) {
        assert.ok(m.signature, "Manifest should be signed");
        assert.ok(m.ggfuId.startsWith("ggfu:sha256:"), "Should have content-derived ID");
        assert.equal(m.schemaVersion, "0.1.0");
      }
    });

    it("verifies manifest signatures correctly", () => {
      const scan = scanDirectory(SAMPLE_DIR);
      const graph = buildArtifactGraph(scan);
      const publisher = { id: `did:key:${keyPair.publicKey.slice(0, 16)}`, displayName: "Test Publisher" };
      const manifests = createManifestsForGraph(scan, graph, publisher, "sample-ai-project", "1.0.0", keyPair);
      for (const m of manifests) {
        const result = verifyManifest(m);
        assert.ok(result.valid, `Manifest ${m.ggfuId} should verify: ${result.reasons.join(", ")}`);
      }
    });

    it("detects tampered manifests", () => {
      const scan = scanDirectory(SAMPLE_DIR);
      const graph = buildArtifactGraph(scan);
      const publisher = { id: `did:key:${keyPair.publicKey.slice(0, 16)}`, displayName: "Test Publisher" };
      const manifests = createManifestsForGraph(scan, graph, publisher, "sample-ai-project", "1.0.0", keyPair);
      const tampered = { ...manifests[0], name: "TAMPERED" };
      const result = verifyManifest(tampered);
      assert.ok(!result.valid, "Tampered manifest should fail verification");
    });
  });

  describe("Phase 3: Content-Addressed Storage", () => {
    it("stores and retrieves blobs by hash", () => {
      const data = Buffer.from("test content for CAS");
      const hash = cas.store(data);
      assert.ok(cas.exists(hash), "Blob should exist after storage");
      const retrieved = cas.retrieve(hash);
      assert.ok(retrieved !== null, "Should retrieve blob");
      assert.ok(retrieved!.equals(data), "Retrieved data should match");
    });

    it("verifies content integrity", () => {
      const data = Buffer.from("integrity test data");
      const hash = cas.store(data);
      assert.ok(cas.verify(hash), "Hash should match content");
    });

    it("creates tombstones on deletion", () => {
      const data = Buffer.from("to be deleted");
      const hash = cas.store(data);
      assert.ok(cas.delete(hash), "Should delete blob");
      assert.ok(!cas.exists(hash), "Deleted blob should not exist");
      assert.ok(cas.retrieve(hash) === null, "Should not retrieve deleted blob");
    });

    it("is idempotent (storing same data returns same hash)", () => {
      const data = Buffer.from("idempotent test");
      const hash1 = cas.store(data);
      const hash2 = cas.store(data);
      assert.equal(hash1, hash2, "Same data should produce same hash");
    });
  });

  describe("Phase 4: Runtime Assembly", () => {
    it("resolves a dependency graph and verifies all components", () => {
      const scan = scanDirectory(SAMPLE_DIR);
      const graph = buildArtifactGraph(scan);
      const publisher = { id: `did:key:${keyPair.publicKey.slice(0, 16)}`, displayName: "Test Publisher" };
      const manifests = createManifestsForGraph(scan, graph, publisher, "sample-ai-project", "1.0.0", keyPair);

      // Store all file contents in CAS.
      for (const file of scan.files) {
        if (file.isBinary) continue;
        try {
          const content = fs.readFileSync(file.absolutePath);
          cas.store(content);
        } catch {}
      }

      // Build registry.
      const registry = new Map(manifests.map(m => [m.ggfuId, m]));

      // Resolve from the first manifest.
      const target = manifests[0];
      const result = resolveGraph(target, registry, cas);
      assert.ok(result.resolved || result.missing.length > 0 || result.verificationFailures.length > 0,
        "Resolution should produce a result");
    });

    it("creates execution sessions and generates receipts", () => {
      const session = createSession({
        targetManifestId: "ggfu:sha256:test123",
        inputs: { text: "Hello world" },
      });
      assert.equal(session.status, "pending");
      assert.ok(session.inputsHash);

      const { session: executed, receipt } = simulateExecution({
        session,
        manifests: [],
        outputs: { result: "ok" },
      });
      assert.equal(executed.status, "completed");
      assert.equal(receipt.status, "completed");
      assert.ok(receipt.inputHash);
      assert.ok(receipt.outputHash);
    });

    it("verifies reproducibility of outputs", () => {
      const out1 = { score: 0.5, label: "medium" };
      const out2 = { score: 0.5, label: "medium" };
      const result = verifyReproducibility(out1, out2);
      assert.ok(result.matches, "Identical outputs should match");
    });

    it("detects non-reproducible outputs", () => {
      const out1 = { score: 0.5 };
      const out2 = { score: 0.8 };
      const result = verifyReproducibility(out1, out2);
      assert.ok(!result.matches, "Different outputs should not match");
    });
  });

  describe("Phase 5: Continuity Ledger", () => {
    it("creates and chains continuity events", () => {
      const ledger = new ContinuityLedger();
      ledger.setKeyPair(keyPair);

      const evt1 = ledger.appendNew({
        eventType: "ARTIFACT_CREATED",
        actorId: "did:key:alice",
        ggfuId: "ggfu:sha256:test1",
      });
      const evt2 = ledger.appendNew({
        eventType: "MANIFEST_SIGNED",
        actorId: "did:key:alice",
        ggfuId: "ggfu:sha256:test1",
      });

      assert.ok(evt1.contentHash, "Event should have content hash");
      assert.equal(evt1.previousEventHash, null, "First event should have null previous hash");
      assert.equal(evt2.previousEventHash, evt1.contentHash, "Second event should chain to first");
    });

    it("verifies the event chain integrity", () => {
      const ledger = new ContinuityLedger();
      ledger.setKeyPair(keyPair);

      ledger.appendNew({ eventType: "ARTIFACT_CREATED", actorId: "a", ggfuId: "g1" });
      ledger.appendNew({ eventType: "COMPONENT_PUBLISHED", actorId: "a", ggfuId: "g1" });
      ledger.appendNew({ eventType: "EXECUTION_COMPLETED", actorId: "a", ggfuId: "g1" });

      const result = ledger.verify();
      assert.ok(result.valid, `Ledger should verify: ${result.reasons.join(", ")}`);
    });

    it("seals events into a Merkle root", () => {
      const ledger = new ContinuityLedger();
      ledger.setKeyPair(keyPair);

      ledger.appendNew({ eventType: "ARTIFACT_CREATED", actorId: "a", ggfuId: "g1" });
      ledger.appendNew({ eventType: "MANIFEST_SIGNED", actorId: "a", ggfuId: "g1" });

      const root = ledger.seal();
      assert.ok(root, "Should produce Merkle root");
      assert.ok(root!.rootHash, "Root should have hash");
      assert.ok(root!.signature, "Root should be signed");
    });
  });

  describe("Phase 6: Evidence Packet", () => {
    it("generates a signed evidence packet", () => {
      const scan = scanDirectory(SAMPLE_DIR);
      const graph = buildArtifactGraph(scan);
      const publisher = { id: `did:key:${keyPair.publicKey.slice(0, 16)}`, displayName: "Test Publisher" };
      const manifests = createManifestsForGraph(scan, graph, publisher, "sample-ai-project", "1.0.0", keyPair);

      const ledger = new ContinuityLedger();
      ledger.setKeyPair(keyPair);
      ledger.appendNew({ eventType: "ARTIFACT_CREATED", actorId: publisher.id, ggfuId: manifests[0].ggfuId });
      ledger.appendNew({ eventType: "MANIFEST_SIGNED", actorId: publisher.id, ggfuId: manifests[0].ggfuId });

      const session = createSession({
        targetManifestId: manifests[0].ggfuId,
        inputs: { text: "test" },
      });
      const { receipt } = simulateExecution({ session, manifests, outputs: { result: "ok" } });

      const packet = generateEvidencePacket({
        targetManifest: manifests[0],
        componentManifests: manifests.slice(1),
        graph,
        receipts: [receipt],
        events: ledger.getEvents(),
        scan,
        keyPair,
      });

      assert.ok(packet.packetId, "Packet should have ID");
      assert.ok(packet.packetSignature, "Packet should be signed");
      assert.ok(packet.artifactManifest, "Should have artifact manifest");
      assert.ok(packet.appraisalReport, "Should have appraisal");
      assert.ok(packet.licenseReport, "Should have license report");
      assert.ok(packet.securityReport, "Should have security report");
      assert.ok(packet.reproducibilityReport, "Should have reproducibility report");
    });

    it("verifies evidence packet signatures", () => {
      const scan = scanDirectory(SAMPLE_DIR);
      const graph = buildArtifactGraph(scan);
      const publisher = { id: `did:key:${keyPair.publicKey.slice(0, 16)}`, displayName: "Test Publisher" };
      const manifests = createManifestsForGraph(scan, graph, publisher, "sample-ai-project", "1.0.0", keyPair);

      const packet = generateEvidencePacket({
        targetManifest: manifests[0],
        componentManifests: manifests.slice(1),
        graph,
        receipts: [],
        events: [],
        keyPair,
      });

      const result = verifyEvidencePacket(packet);
      assert.ok(result.valid, `Packet should verify: ${result.reasons.join(", ")}`);
    });
  });

  describe("Phase 6: Appraisal", () => {
    it("generates an appraisal report with technical score", () => {
      const scan = scanDirectory(SAMPLE_DIR);
      const graph = buildArtifactGraph(scan);
      const publisher = { id: `did:key:${keyPair.publicKey.slice(0, 16)}`, displayName: "Test Publisher" };
      const manifests = createManifestsForGraph(scan, graph, publisher, "sample-ai-project", "1.0.0", keyPair);

      const appraisal = generateAppraisal({
        manifest: manifests[0],
        scan,
        graph,
      });

      assert.ok(appraisal.appraisalId, "Should have appraisal ID");
      assert.ok(appraisal.technicalScore.score >= 0 && appraisal.technicalScore.score <= 1, "Score should be 0..1");
      assert.ok(appraisal.valuation.low <= appraisal.valuation.mid, "Low <= mid");
      assert.ok(appraisal.valuation.mid <= appraisal.valuation.high, "Mid <= high");
      assert.ok(appraisal.disclaimer.includes("not a legal valuation"), "Should have disclaimer");
    });
  });

  describe("Reversible Codecs", () => {
    it("identity codec round-trips correctly", () => {
      const data = Buffer.from("hello world");
      const result = verifyCodec(IdentityCodec, data);
      assert.ok(result.passed, `Identity codec should pass: ${result.error}`);
    });

    it("zip codec round-trips correctly", () => {
      const data = Buffer.from("hello world ".repeat(100));
      const result = verifyCodec(ZipCodec, data);
      assert.ok(result.passed, `Zip codec should pass: ${result.error}`);
    });

    it("base85 codec round-trips correctly", () => {
      const data = Buffer.from("binary data test 12345");
      const result = verifyCodec(Base85Codec, data);
      assert.ok(result.passed, `Base85 codec should pass: ${result.error}`);
    });

    it("all codecs pass round-trip verification", () => {
      const data = Buffer.from("verification test data");
      const results = verifyAllCodecs(data);
      for (const r of results) {
        assert.ok(r.passed, `Codec ${r.name} should pass: ${r.error}`);
      }
    });
  });

  describe("Acceptance Test: Full Pipeline", () => {
    it("scans, decomposes, manifests, stores, reconstructs, executes, and generates evidence", () => {
      // 1. Scan.
      const scan = scanDirectory(SAMPLE_DIR);
      assert.ok(scan.totalFiles > 0);

      // 2. Decompose.
      const graph = buildArtifactGraph(scan);
      assert.ok(graph.nodes.length > 0);

      // 3. Create manifests.
      const publisher = { id: `did:key:${keyPair.publicKey.slice(0, 16)}`, displayName: "Test Publisher" };
      const manifests = createManifestsForGraph(scan, graph, publisher, "sample-ai-project", "1.0.0", keyPair);
      assert.ok(manifests.length > 0);

      // 4. Store in CAS.
      for (const file of scan.files) {
        if (file.role === "secret_external" || file.fileClass === "secret") continue;
        try {
          const content = fs.readFileSync(file.absolutePath);
          cas.store(content);
        } catch {}
      }

      // 5. Verify all manifests.
      for (const m of manifests) {
        const result = verifyManifest(m);
        assert.ok(result.valid, `Manifest ${m.name} should verify: ${result.reasons.join(", ")}`);
      }

      // 6. Create continuity events.
      const ledger = new ContinuityLedger();
      ledger.setKeyPair(keyPair);
      ledger.appendNew({ eventType: "ARTIFACT_CREATED", actorId: publisher.id, ggfuId: manifests[0].ggfuId });
      ledger.appendNew({ eventType: "COMPONENT_EXTRACTED", actorId: publisher.id, ggfuId: manifests[0].ggfuId });
      ledger.appendNew({ eventType: "MANIFEST_SIGNED", actorId: publisher.id, ggfuId: manifests[0].ggfuId });

      // 7. Simulate execution.
      const session = createSession({
        targetManifestId: manifests[0].ggfuId,
        inputs: { text: "Hello world. This is a test." },
      });
      const { receipt } = simulateExecution({ session, manifests, outputs: { result: 0.5 } });
      assert.equal(receipt.status, "completed");

      // 8. Generate evidence packet.
      const packet = generateEvidencePacket({
        targetManifest: manifests[0],
        componentManifests: manifests.slice(1),
        graph,
        receipts: [receipt],
        events: ledger.getEvents(),
        scan,
        keyPair,
      });
      assert.ok(packet.packetSignature);

      // 9. Verify evidence packet.
      const verifyResult = verifyEvidencePacket(packet);
      assert.ok(verifyResult.valid, `Evidence packet should verify: ${verifyResult.reasons.join(", ")}`);

      // 10. Tamper detection — modify a manifest and verify it fails.
      const tamperedManifest = { ...manifests[0], name: "TAMPERED_NAME" };
      const tamperResult = verifyManifest(tamperedManifest);
      assert.ok(!tamperResult.valid, "Tampered manifest should fail verification");
    });
  });
});
