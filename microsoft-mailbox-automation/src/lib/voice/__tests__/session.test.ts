/**
 * Tests for the voice session state machine, transcript management,
 * evidence extraction, and compliance checking.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ensureDefaultOrg, createUser } from "@/lib/db";
import {
  createSession,
  getSession,
  transitionState,
  cancelSession,
  addTranscriptSegment,
  correctTranscriptSegment,
  getEffectiveText,
  confirmSegment,
  discardSegment,
  extractArtifacts,
  checkCompliance,
  generateInterviewQuestions,
  parseVoiceCommand,
  defaultCapabilities,
  setCapabilities,
  confirmArtifacts,
} from "@/lib/voice/session";
import { EvidenceArtifact, VoiceCapabilities } from "@/types";

before(() => {
  ensureDefaultOrg();
  try {
    createUser("emp-001", "foundry", "voice-test@company.com", "Voice Test User", "field_rep", null);
  } catch {
    // user may already exist between test runs
  }
});

// ─── State Machine Tests ──────────────────────────────────────────────

describe("Voice Session State Machine", () => {
  it("createSession creates a session in idle state", () => {
    const session = createSession("emp-001", "foundry", {});
    assert.ok(session.sessionId.match(/^vs-/));
    assert.equal(session.state, "idle");
    assert.equal(session.userId, "emp-001");
    assert.equal(session.organizationId, "foundry");
    assert.deepEqual(session.transcriptSegments, []);
    assert.deepEqual(session.extractedArtifacts, []);
    assert.equal(session.auditEvents.length, 1);
    assert.equal(session.auditEvents[0].eventType, "voice.session_created");
  });

  it("getSession retrieves a created session", () => {
    const session = createSession("emp-001", "foundry", {});
    const retrieved = getSession(session.sessionId);
    assert.ok(retrieved);
    assert.equal(retrieved!.sessionId, session.sessionId);
  });

  it("transitionState allows valid transitions", () => {
    const session = createSession("emp-001", "foundry", {});
    const updated = transitionState(session.sessionId, "capability_check", "emp-001");
    assert.equal(updated.state, "capability_check");
  });

  it("transitionState rejects invalid transitions", () => {
    const session = createSession("emp-001", "foundry", {});
    assert.throws(
      () => transitionState(session.sessionId, "listening", "emp-001"),
      /Invalid transition/,
    );
  });

  it("cancelSession transitions to cancelled", () => {
    const session = createSession("emp-001", "foundry", {});
    const cancelled = cancelSession(session.sessionId, "emp-001");
    assert.equal(cancelled.state, "cancelled");
    assert.ok(
      cancelled.auditEvents.some((e) => e.eventType === "voice.session_cancelled"),
    );
  });

  it("full state machine path: idle → capability_check → ... → completed", () => {
    const session = createSession("emp-001", "foundry", {});
    const id = session.sessionId;

    transitionState(id, "capability_check", "emp-001");
    transitionState(id, "permission_request", "emp-001");
    transitionState(id, "ready", "emp-001");
    transitionState(id, "briefing", "emp-001");
    transitionState(id, "listening", "emp-001", "voice.recording_started");
    transitionState(id, "processing", "emp-001");
    transitionState(id, "review", "emp-001");
    transitionState(id, "confirmed", "emp-001");
    transitionState(id, "persisted", "emp-001");
    const final = transitionState(id, "completed", "emp-001", "voice.session_completed");

    assert.equal(final.state, "completed");
  });
});

// ─── Capability Detection Tests ───────────────────────────────────────

describe("Capability Detection", () => {
  it("defaultCapabilities returns checking states", () => {
    const caps = defaultCapabilities();
    assert.equal(caps.speechRecognition, "checking");
    assert.equal(caps.speechSynthesis, "checking");
    assert.equal(caps.microphonePermission, "checking");
  });

  it("setCapabilities transitions to ready when speech is supported", () => {
    const session = createSession("emp-001", "foundry", {});
    const caps: VoiceCapabilities = {
      ...defaultCapabilities(),
      speechRecognition: "supported",
      speechSynthesis: "supported",
      microphonePermission: "supported" as any,
      secureContext: true,
      browser: "Chrome",
      audioDeviceAvailable: true,
    };
    const updated = setCapabilities(session.sessionId, caps);
    assert.equal(updated.state, "ready");
    assert.equal(updated.capabilities?.speechRecognition, "supported");
  });

  it("setCapabilities transitions to unsupported when both are unsupported", () => {
    const session = createSession("emp-001", "foundry", {});
    const caps: VoiceCapabilities = {
      ...defaultCapabilities(),
      speechRecognition: "unsupported",
      speechSynthesis: "unsupported",
      microphonePermission: "unsupported" as any,
    };
    const updated = setCapabilities(session.sessionId, caps);
    assert.equal(updated.state, "unsupported");
  });

  it("setCapabilities transitions to permission_denied when mic is denied", () => {
    const session = createSession("emp-001", "foundry", {});
    const caps: VoiceCapabilities = {
      ...defaultCapabilities(),
      speechRecognition: "supported",
      speechSynthesis: "supported",
      microphonePermission: "permission_denied",
    };
    const updated = setCapabilities(session.sessionId, caps);
    assert.equal(updated.state, "permission_denied");
  });
});

// ─── Transcript Management Tests ──────────────────────────────────────

describe("Transcript Management", () => {
  it("addTranscriptSegment creates an unconfirmed segment", () => {
    const session = createSession("emp-001", "foundry", {});
    const segment = addTranscriptSegment(
      session.sessionId,
      "I met with Dr. Morgan's office.",
      0.95,
      "browser",
    );
    assert.ok(segment.segmentId.match(/^seg-/));
    assert.equal(segment.transcriptText, "I met with Dr. Morgan's office.");
    assert.equal(segment.confirmationState, "unconfirmed");
    assert.equal(segment.confidence, 0.95);
  });

  it("correctTranscriptSegment preserves original and adds correction", () => {
    const session = createSession("emp-001", "foundry", {});
    const segment = addTranscriptSegment(
      session.sessionId,
      "I met with Dr. Morgan's office.",
      0.95,
      "browser",
    );
    const corrected = correctTranscriptSegment(
      session.sessionId,
      segment.segmentId,
      "I met with Dr. Morgan's office. The nurse manager agreed.",
      "emp-001",
      "Added missing context",
    );
    // Original is preserved
    assert.equal(corrected.transcriptText, "I met with Dr. Morgan's office.");
    // Correction is in history
    assert.equal(corrected.correctionHistory.length, 1);
    assert.ok(corrected.correctionHistory[0].correctedText.includes("nurse manager"));
    assert.equal(corrected.confirmationState, "corrected");
  });

  it("getEffectiveText returns corrected text when available", () => {
    const session = createSession("emp-001", "foundry", {});
    const segment = addTranscriptSegment(
      session.sessionId,
      "Original text.",
      0.5,
      "browser",
    );
    assert.equal(getEffectiveText(segment), "Original text.");

    const corrected = correctTranscriptSegment(
      session.sessionId,
      segment.segmentId,
      "Corrected text.",
      "emp-001",
    );
    assert.equal(getEffectiveText(corrected), "Corrected text.");
  });

  it("confirmSegment marks segment as confirmed", () => {
    const session = createSession("emp-001", "foundry", {});
    const segment = addTranscriptSegment(
      session.sessionId,
      "Test observation.",
      0.9,
      "browser",
    );
    const confirmed = confirmSegment(session.sessionId, segment.segmentId, "emp-001");
    assert.equal(confirmed.confirmationState, "confirmed");
  });

  it("discardSegment marks segment as discarded", () => {
    const session = createSession("emp-001", "foundry", {});
    const segment = addTranscriptSegment(
      session.sessionId,
      "Test observation.",
      0.9,
      "browser",
    );
    const discarded = discardSegment(session.sessionId, segment.segmentId);
    assert.equal(discarded.confirmationState, "discarded");
  });

  it("multiple corrections preserve full history", () => {
    const session = createSession("emp-001", "foundry", {});
    const segment = addTranscriptSegment(
      session.sessionId,
      "First version.",
      0.5,
      "browser",
    );
    correctTranscriptSegment(session.sessionId, segment.segmentId, "Second version.", "emp-001");
    correctTranscriptSegment(session.sessionId, segment.segmentId, "Third version.", "emp-001");
    const updated = getSession(session.sessionId);
    const seg = updated!.transcriptSegments.find((s) => s.segmentId === segment.segmentId);
    assert.equal(seg!.correctionHistory.length, 2);
    assert.equal(seg!.transcriptText, "First version."); // original never overwritten
    assert.equal(getEffectiveText(seg!), "Third version.");
  });
});

// ─── Compliance Checking Tests ────────────────────────────────────────

describe("Compliance Checking", () => {
  function makeArtifact(text: string): EvidenceArtifact {
    return {
      artifactId: "test-art",
      sessionId: "test-session",
      artifactType: "observation",
      sourceSpans: [{ segmentId: "seg-1", startChar: 0, endChar: text.length, excerpt: text }],
      normalizedStatement: text,
      confidence: 0.5,
      uncertainty: "test",
      evidenceStatus: "proposed",
      requiredReview: true,
      complianceFlags: [],
      humanConfirmationState: "unconfirmed",
      classification: "directly_observed_fact",
      createdAt: new Date().toISOString(),
    };
  }

  it("detects adverse event language", () => {
    const artifact = makeArtifact("The patient experienced an adverse event after taking the medication.");
    const result = checkCompliance(artifact);
    assert.equal(result.flagged, true);
    assert.equal(result.flagType, "adverse_event");
    assert.equal(result.escalationRequired, true);
    assert.ok(result.escalationReceiptId);
  });

  it("detects product complaint language", () => {
    const artifact = makeArtifact("This is a product complaint about damaged packaging.");
    const result = checkCompliance(artifact);
    assert.equal(result.flagged, true);
    assert.equal(result.flagType, "product_complaint");
    assert.equal(result.escalationRequired, true);
  });

  it("detects off-label promotional content", () => {
    const artifact = makeArtifact("The off-label use showed great efficacy.");
    const result = checkCompliance(artifact);
    assert.equal(result.flagged, true);
    assert.equal(result.flagType, "promotional_content");
    assert.equal(result.escalationRequired, false);
  });

  it("does not flag clean operational observations", () => {
    const artifact = makeArtifact("The nurse manager completed the workflow on time.");
    const result = checkCompliance(artifact);
    assert.equal(result.flagged, false);
  });
});

// ─── Voice Command Parsing Tests ──────────────────────────────────────

describe("Voice Command Parsing", () => {
  it("parses 'start mission'", () => {
    const result = parseVoiceCommand("Start the mission");
    assert.ok(result);
    assert.equal(result!.command, "start_mission");
  });

  it("parses 'read the hypothesis'", () => {
    const result = parseVoiceCommand("Read the hypothesis");
    assert.ok(result);
    assert.equal(result!.command, "read_hypothesis");
  });

  it("parses 'correction'", () => {
    const result = parseVoiceCommand("Correction: it was the nurse coordinator");
    assert.ok(result);
    assert.equal(result!.command, "correct_transcript");
    assert.ok(result!.args!.includes("nurse coordinator"));
  });

  it("parses 'add a confounder'", () => {
    const result = parseVoiceCommand("Add a confounder");
    assert.ok(result);
    assert.equal(result!.command, "add_confounder");
  });

  it("parses 'submit the observation'", () => {
    const result = parseVoiceCommand("Submit the observation");
    assert.ok(result);
    assert.equal(result!.command, "confirm_evidence");
  });

  it("parses 'pause'", () => {
    const result = parseVoiceCommand("Pause");
    assert.ok(result);
    assert.equal(result!.command, "pause");
  });

  it("parses 'skip'", () => {
    const result = parseVoiceCommand("Skip");
    assert.ok(result);
    assert.equal(result!.command, "skip");
  });

  it("parses 'I don't know'", () => {
    const result = parseVoiceCommand("I don't know");
    assert.ok(result);
    assert.equal(result!.command, "dont_know");
  });

  it("returns null for non-command text", () => {
    const result = parseVoiceCommand("The weather is nice today.");
    assert.equal(result, null);
  });
});

// ─── Guided Interview Tests ───────────────────────────────────────────

describe("Guided Interview", () => {
  it("generateInterviewQuestions returns the full question set", () => {
    const session = createSession("emp-001", "foundry", {});
    const questions = generateInterviewQuestions(session);
    assert.equal(questions.length, 11);
    assert.equal(questions[0].prompt, "What happened?");
    assert.equal(questions[0].required, true);
    assert.equal(questions[0].asked, false);
  });

  it("interview questions include all required categories", () => {
    const session = createSession("emp-001", "foundry", {});
    const questions = generateInterviewQuestions(session);
    const categories = questions.map((q) => q.category);
    assert.ok(categories.includes("what_happened"));
    assert.ok(categories.includes("what_observed"));
    assert.ok(categories.includes("outcome_recorded"));
    assert.ok(categories.includes("safety_events"));
    assert.ok(categories.includes("confidence"));
  });
});
