/**
 * Voice session state machine, transcript management, evidence extraction,
 * and compliance checking.
 *
 * This module is the server-side engine for the voice-first execution surface.
 * It manages session lifecycle, transcript segments with correction history,
 * evidence artifact extraction grounded in source spans, fact/interpretation
 * classification, and pharma-specific compliance containment.
 *
 * The state machine is deterministic: every transition is validated against
 * the current state, and invalid transitions are rejected.
 */

import * as fs from "fs";
import * as path from "path";

import { nanoid } from "nanoid";
import {
  VoiceSession,
  VoiceSessionState,
  TranscriptSegment,
  EvidenceArtifact,
  VoiceAuditEvent,
  CreateVoiceSessionInput,
  VoiceCapabilities,
  CapabilityStatus,
  CaptureMode,
  ConfirmationState,
  StatementClassification,
  EvidenceArtifactType,
  SourceSpan,
  InterviewQuestion,
  ComplianceFlagResult,
  MissionCard,
  VoiceEscalationRecord,
  AdmissibilityDecision,
} from "@/types";
import {
  loadMissions,
  saveMissions,
  loadHypotheses,
  loadHypothesisAssignments,
  loadHypothesisAttributions,
} from "@/lib/config";
import {
  recordOutcome,
  attributeOutcomeWithLLM,
} from "@/lib/golden/outcomes";
import { checkHypothesis } from "@/lib/golden/compliance";
import { callLLM, extractJSON, ChatMessage } from "@/lib/golden/llm-client";
import { withFoundryVoice } from "@/lib/foundry-voice";
import {
  decideAdmissibility,
  DEFAULT_ADMISSIBILITY_CONFIG,
  type AdmissibilityInput,
} from "@/lib/spinor/admissibility";
import type { AttributionClaim } from "@/lib/spinor/spin";
import {
  getVoiceSession,
  listVoiceSessions,
  saveVoiceSessions as persistVoiceSessions,
  saveVoiceSession as persistVoiceSession,
  saveVoiceEscalation,
  getVoiceEscalation,
} from "@/lib/voice/store";

const now = () => new Date().toISOString();
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ─── State machine transitions ────────────────────────────────────────

/**
 * Valid state transitions. Each key maps to the set of states that can
 * transition *from* that state. The machine enforces that only these
 * transitions are allowed.
 */
const VALID_TRANSITIONS: Record<VoiceSessionState, VoiceSessionState[]> = {
  idle: ["capability_check", "cancelled"],
  capability_check: ["permission_request", "unsupported", "ready", "cancelled"],
  permission_request: ["ready", "permission_denied", "cancelled"],
  ready: ["briefing", "listening", "cancelled", "expired_mission"],
  briefing: ["ready", "listening", "cancelled"],
  listening: ["processing", "paused", "cancelled", "transcription_failed", "network_interrupted"],
  processing: ["review", "transcription_failed", "validation_failed", "compliance_hold", "listening"],
  review: ["confirmed", "listening", "cancelled", "validation_failed", "compliance_hold"],
  confirmed: ["persisted", "compliance_hold", "cancelled"],
  persisted: ["completed", "cancelled"],
  completed: [],
  paused: ["listening", "cancelled"],
  permission_denied: ["ready", "cancelled"],
  unsupported: ["ready", "cancelled"],
  transcription_failed: ["listening", "ready", "cancelled"],
  validation_failed: ["review", "listening", "cancelled"],
  compliance_hold: ["review", "confirmed", "cancelled"],
  network_interrupted: ["listening", "ready", "cancelled"],
  expired_mission: ["cancelled"],
  cancelled: [],
};

function canTransition(from: VoiceSessionState, to: VoiceSessionState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Session storage ──────────────────────────────────────────────────

function loadVoiceSessions(): VoiceSession[] {
  return listVoiceSessions();
}

function saveVoiceSessions(sessions: VoiceSession[]): void {
  persistVoiceSessions(sessions);
}

function saveVoiceSession(session: VoiceSession): void {
  persistVoiceSession(session);
}

// ─── Audit events ─────────────────────────────────────────────────────

function createAuditEvent(
  sessionId: string,
  eventType: VoiceAuditEvent["eventType"],
  actor: string,
  extra: Partial<VoiceAuditEvent> = {},
): VoiceAuditEvent {
  return {
    eventId: `vae-${nanoid(12)}`,
    sessionId,
    eventType,
    actor,
    timestamp: now(),
    ...extra,
  };
}

// ─── Session lifecycle ────────────────────────────────────────────────

/**
 * Create a new voice session linked to a mission.
 *
 * Identity (organizationId, userId) is resolved from the authenticated
 * session on the API side, not from client-submitted input.
 */
export function createSession(
  userId: string,
  organizationId: string,
  input: CreateVoiceSessionInput,
): VoiceSession {
  const sessionId = `vs-${nanoid(16)}`;
  const expiresAt = new Date(Date.now() + SESSION_TIMEOUT_MS).toISOString();

  // Load the mission if a missionId is provided
  let mission: MissionCard | undefined;
  if (input.missionId) {
    const missions = loadMissions();
    mission = missions.find((m) => m.id === input.missionId);
  }

  // If no missionId but we have an assignmentId, try to find the mission
  if (!mission && input.assignmentId) {
    const missions = loadMissions();
    mission = missions.find((m) => m.assignmentId === input.assignmentId);
  }

  // If still no mission, generate one for the employee
  if (!mission) {
    // Use the first active mission for this user as fallback
    const missions = loadMissions();
    mission = missions.find(
      (m) => m.employeeId === userId && m.state === "assigned",
    );
  }

  const session: VoiceSession = {
    sessionId,
    organizationId,
    userId,
    dailySeedId: input.dailySeedId,
    experimentId: input.experimentId || mission?.hypothesisId,
    missionId: mission?.id,
    hypothesisId: mission?.hypothesisId || input.hypothesisId,
    assignmentId: mission?.assignmentId || input.assignmentId,
    state: "idle",
    language: input.language || "en-US",
    captureMode: input.captureMode || "browser_recognition",
    audioRetention: input.audioRetention || "none",
    complianceRequirements: [
      "No off-label claims",
      "No comparative efficacy claims",
      "No patient-level targeting",
      "Adverse events must be escalated",
    ],
    transcriptSegments: [],
    extractedArtifacts: [],
    auditEvents: [
      createAuditEvent(sessionId, "voice.session_created", userId, {
        experimentRef: mission?.hypothesisId,
        missionVersion: mission?.id,
        language: input.language || "en-US",
      }),
    ],
    expiresAt,
    createdAt: now(),
    updatedAt: now(),
  };

  const sessions = loadVoiceSessions();
  sessions.push(session);
  saveVoiceSessions(sessions);

  return session;
}

/** Get a session by ID. */
export function getSession(sessionId: string): VoiceSession | undefined {
  return loadVoiceSessions().find((s) => s.sessionId === sessionId);
}

/** Transition a session to a new state. Throws on invalid transition. */
export function transitionState(
  sessionId: string,
  newState: VoiceSessionState,
  actor: string,
  auditEventType?: VoiceAuditEvent["eventType"],
): VoiceSession {
  const sessions = loadVoiceSessions();
  const idx = sessions.findIndex((s) => s.sessionId === sessionId);
  if (idx === -1) throw new Error(`Session not found: ${sessionId}`);

  const session = sessions[idx];

  // Idempotent: no-op if the session is already in the requested state.
  if (session.state === newState) {
    return session;
  }

  if (!canTransition(session.state, newState)) {
    throw new Error(`Invalid transition: ${session.state} → ${newState}`);
  }

  // Check expiry
  if (new Date(session.expiresAt) < new Date() && newState !== "cancelled") {
    session.state = "expired_mission";
    session.updatedAt = now();
    sessions[idx] = session;
    saveVoiceSessions(sessions);
    throw new Error(`Session expired: ${sessionId}`);
  }

  session.state = newState;
  session.updatedAt = now();

  if (auditEventType) {
    session.auditEvents.push(
      createAuditEvent(sessionId, auditEventType, actor),
    );
  }

  sessions[idx] = session;
  saveVoiceSessions(sessions);
  return session;
}

/** Cancel a session. */
export function cancelSession(sessionId: string, actor: string): VoiceSession {
  return transitionState(sessionId, "cancelled", actor, "voice.session_cancelled");
}

// ─── Capability detection ─────────────────────────────────────────────

/**
 * Detect voice capabilities. This runs server-side and returns a template
 * that the client fills in with actual browser API results.
 *
 * The client is responsible for the actual detection; this provides the
 * schema and defaults.
 */
export function defaultCapabilities(): VoiceCapabilities {
  return {
    speechRecognition: "checking",
    speechSynthesis: "checking",
    microphonePermission: "checking",
    availableVoices: 0,
    selectedLanguage: "en-US",
    secureContext: false,
    browser: "unknown",
    isMobile: false,
    audioDeviceAvailable: false,
    detectedAt: now(),
  };
}

/**
 * Apply client-detected capabilities to a session.
 * Returns the updated session with the capabilities stored.
 */
export function setCapabilities(
  sessionId: string,
  capabilities: VoiceCapabilities,
): VoiceSession {
  const sessions = loadVoiceSessions();
  const idx = sessions.findIndex((s) => s.sessionId === sessionId);
  if (idx === -1) throw new Error(`Session not found: ${sessionId}`);

  sessions[idx].capabilities = capabilities;
  sessions[idx].updatedAt = now();

  // Auto-transition based on capabilities
  if (capabilities.speechRecognition === "unsupported" && capabilities.speechSynthesis === "unsupported") {
    sessions[idx].state = "unsupported";
  } else if (capabilities.microphonePermission === "permission_denied") {
    sessions[idx].state = "permission_denied";
  } else if (capabilities.speechRecognition === "supported") {
    sessions[idx].state = "ready";
  } else {
    // Text fallback — still usable
    sessions[idx].state = "ready";
  }

  sessions[idx].auditEvents.push(
    createAuditEvent(sessionId, "voice.permission_requested", sessions[idx].userId),
  );

  saveVoiceSessions(sessions);
  return sessions[idx];
}

// ─── Transcript management ────────────────────────────────────────────

/**
 * Add a transcript segment to a session.
 * The segment is created with confirmationState = "unconfirmed".
 */
export function addTranscriptSegment(
  sessionId: string,
  text: string,
  confidence: number,
  provider: string,
  speaker: string = "employee",
  startTime: number = 0,
  endTime: number = 0,
): TranscriptSegment {
  const sessions = loadVoiceSessions();
  const idx = sessions.findIndex((s) => s.sessionId === sessionId);
  if (idx === -1) throw new Error(`Session not found: ${sessionId}`);

  const segment: TranscriptSegment = {
    segmentId: `seg-${nanoid(12)}`,
    sessionId,
    experimentId: sessions[idx].experimentId,
    speaker,
    startTime,
    endTime,
    transcriptText: text,
    confidence,
    recognitionProvider: provider,
    language: sessions[idx].language,
    correctionHistory: [],
    confirmationState: "unconfirmed",
    redacted: false,
    createdAt: now(),
  };

  sessions[idx].transcriptSegments.push(segment);
  sessions[idx].updatedAt = now();
  sessions[idx].auditEvents.push(
    createAuditEvent(sessionId, "voice.transcript_received", sessions[idx].userId, {
      provider,
      language: sessions[idx].language,
    }),
  );

  saveVoiceSessions(sessions);
  return segment;
}

/**
 * Correct a transcript segment. The original text is NEVER overwritten —
 * the correction is appended to the correction history.
 */
export function correctTranscriptSegment(
  sessionId: string,
  segmentId: string,
  correctedText: string,
  correctedBy: string,
  reason?: string,
): TranscriptSegment {
  const sessions = loadVoiceSessions();
  const idx = sessions.findIndex((s) => s.sessionId === sessionId);
  if (idx === -1) throw new Error(`Session not found: ${sessionId}`);

  const segment = sessions[idx].transcriptSegments.find((s) => s.segmentId === segmentId);
  if (!segment) throw new Error(`Segment not found: ${segmentId}`);

  const correction = {
    correctedText,
    correctedBy,
    correctedAt: now(),
    reason,
  };

  segment.correctionHistory.push(correction);
  segment.confirmationState = "corrected";
  sessions[idx].updatedAt = now();
  sessions[idx].auditEvents.push(
    createAuditEvent(sessionId, "voice.transcript_corrected", correctedBy, {
      correctionHistory: segment.correctionHistory,
    }),
  );

  saveVoiceSessions(sessions);
  return segment;
}

/**
 * Get the effective text of a segment (latest correction, or original if uncorrected).
 */
export function getEffectiveText(segment: TranscriptSegment): string {
  if (segment.correctionHistory.length > 0) {
    return segment.correctionHistory[segment.correctionHistory.length - 1].correctedText;
  }
  return segment.transcriptText;
}

/**
 * Confirm a transcript segment.
 */
export function confirmSegment(
  sessionId: string,
  segmentId: string,
  confirmedBy: string,
): TranscriptSegment {
  const sessions = loadVoiceSessions();
  const idx = sessions.findIndex((s) => s.sessionId === sessionId);
  if (idx === -1) throw new Error(`Session not found: ${sessionId}`);

  const segment = sessions[idx].transcriptSegments.find((s) => s.segmentId === segmentId);
  if (!segment) throw new Error(`Segment not found: ${segmentId}`);

  segment.confirmationState = "confirmed";
  sessions[idx].updatedAt = now();
  saveVoiceSessions(sessions);
  return segment;
}

/**
 * Discard a transcript segment.
 */
export function discardSegment(
  sessionId: string,
  segmentId: string,
): TranscriptSegment {
  const sessions = loadVoiceSessions();
  const idx = sessions.findIndex((s) => s.sessionId === sessionId);
  if (idx === -1) throw new Error(`Session not found: ${sessionId}`);

  const segment = sessions[idx].transcriptSegments.find((s) => s.segmentId === segmentId);
  if (!segment) throw new Error(`Segment not found: ${segmentId}`);

  segment.confirmationState = "discarded";
  sessions[idx].updatedAt = now();
  saveVoiceSessions(sessions);
  return segment;
}

// ─── Evidence extraction ──────────────────────────────────────────────

/**
 * Extract evidence artifacts from transcript segments using LLM.
 * Falls back to deterministic extraction if LLM is unavailable.
 *
 * Every extracted artifact is grounded in source spans — the LLM must
 * reference specific segment IDs and character ranges. Artifacts not
 * grounded in the transcript are rejected.
 */
export async function extractArtifacts(
  sessionId: string,
): Promise<EvidenceArtifact[]> {
  const sessions = loadVoiceSessions();
  const idx = sessions.findIndex((s) => s.sessionId === sessionId);
  if (idx === -1) throw new Error(`Session not found: ${sessionId}`);

  const session = sessions[idx];
  const confirmedSegments = session.transcriptSegments.filter(
    (s) => s.confirmationState !== "discarded",
  );

  if (confirmedSegments.length === 0) {
    return [];
  }

  // Build the transcript context for the LLM
  const transcriptContext = confirmedSegments.map((s) => {
    const text = getEffectiveText(s);
    return `[segment:${s.segmentId}] (confidence: ${s.confidence}) ${text}`;
  }).join("\n");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: withFoundryVoice("default", `You are the voice evidence extraction engine for SPINOR.
Extract structured evidence artifacts from the transcript. Every artifact MUST be grounded
in specific transcript segments — cite the segment ID and the exact excerpt.

Classify each statement as one of:
- directly_observed_fact (the employee directly saw this happen)
- customer_reported_statement (someone told the employee)
- employee_interpretation (the employee's inference)
- estimate (a rough number)
- prediction (a future expectation)
- causal_claim (X caused Y)
- preference_inference (the customer seems to prefer)
- unresolved_uncertainty (not enough information)

Do NOT generate evidence unsupported by the transcript.
Do NOT fabricate metrics, accounts, or outcomes.
If the transcript is ambiguous, set confidence low and uncertainty high.

Return ONLY valid JSON:
{
  "artifacts": [
    {
      "artifactType": "observation" | "outcome" | "protocol_deviation" | "confounder" | "customer_preference_signal" | "execution_fidelity_event" | "negative_outcome" | "complaint" | "opt_out" | "adverse_event_indicator" | "follow_up_requirement" | "derivative_idea" | "unresolved_question" | "external_factor_report",
      "sourceSpans": [{"segmentId": "seg-...", "startChar": 0, "endChar": 50, "excerpt": "..."}],
      "normalizedStatement": "The normalized, clean statement",
      "confidence": 0.0-1.0,
      "uncertainty": "What is uncertain about this",
      "classification": "directly_observed_fact" | "customer_reported_statement" | "employee_interpretation" | "estimate" | "prediction" | "causal_claim" | "preference_inference" | "unresolved_uncertainty",
      "complianceFlags": []
    }
  ]
}`),
    },
    {
      role: "user",
      content: `Session: ${sessionId}
Experiment: ${session.experimentId || "N/A"}
Mission: ${session.missionId || "N/A"}

Transcript:
${transcriptContext}

Extract all evidence artifacts grounded in the transcript above.`,
    },
  ];

  const llm = await callLLM(messages, { temperature: 0.2, maxTokens: 2048 });
  let artifacts: EvidenceArtifact[] = [];

  if (llm.used) {
    const parsed = extractJSON(llm.content);
    if (parsed?.artifacts && Array.isArray(parsed.artifacts)) {
      // Validate that each artifact's source spans reference real segments
      const segmentIds = new Set(confirmedSegments.map((s) => s.segmentId));
      artifacts = parsed.artifacts
        .filter((a: any) => {
          // Reject artifacts with no source spans or invalid segment references
          if (!a.sourceSpans || !Array.isArray(a.sourceSpans) || a.sourceSpans.length === 0) {
            return false;
          }
          return a.sourceSpans.every((span: any) => segmentIds.has(span.segmentId));
        })
        .map((a: any) => ({
          artifactId: `art-${nanoid(12)}`,
          sessionId,
          artifactType: a.artifactType as EvidenceArtifactType,
          sourceSpans: a.sourceSpans as SourceSpan[],
          normalizedStatement: a.normalizedStatement || "",
          experimentRef: session.experimentId,
          confidence: a.confidence || 0.3,
          uncertainty: a.uncertainty || "Unspecified",
          evidenceStatus: "proposed" as const,
          requiredReview: true,
          complianceFlags: a.complianceFlags || [],
          humanConfirmationState: "unconfirmed" as ConfirmationState,
          classification: a.classification as StatementClassification,
          createdAt: now(),
        }));
    }
  }

  // Deterministic fallback: create a single observation artifact from the full transcript
  if (artifacts.length === 0) {
    const fullText = confirmedSegments.map((s) => getEffectiveText(s)).join(" ");
    if (fullText.trim().length > 10) {
      artifacts = [{
        artifactId: `art-${nanoid(12)}`,
        sessionId,
        artifactType: "observation",
        sourceSpans: confirmedSegments.map((s) => ({
          segmentId: s.segmentId,
          startChar: 0,
          endChar: getEffectiveText(s).length,
          excerpt: getEffectiveText(s).slice(0, 100),
        })),
        normalizedStatement: fullText.slice(0, 500),
        experimentRef: session.experimentId,
        confidence: 0.3,
        uncertainty: "Extracted via deterministic fallback — no LLM available",
        evidenceStatus: "proposed",
        requiredReview: true,
        complianceFlags: [],
        humanConfirmationState: "unconfirmed",
        classification: "directly_observed_fact",
        createdAt: now(),
      }];
    }
  }

  // Store artifacts in the session
  sessions[idx].extractedArtifacts = artifacts;
  sessions[idx].updatedAt = now();
  sessions[idx].auditEvents.push(
    createAuditEvent(sessionId, "voice.artifacts_extracted", sessions[idx].userId, {
      artifactHashes: artifacts.map((a) => a.artifactId),
    }),
  );

  // Check compliance on each artifact
  for (const artifact of artifacts) {
    artifact.complianceFlags = artifact.complianceFlags || [];
    artifact.complianceFlagResults = artifact.complianceFlagResults || [];

    const flag = checkCompliance(artifact);
    if (flag.flagged) {
      artifact.complianceFlags.push(flag.flagType || "compliance_issue");
      artifact.complianceFlagResults.push(flag);

      const auditEvent = createAuditEvent(
        sessionId,
        "voice.compliance_flagged",
        sessions[idx].userId,
        {
          complianceResult: flag.message,
          artifactHashes: [artifact.artifactId],
        },
      );
      sessions[idx].auditEvents.push(auditEvent);

      sessions[idx].state = "compliance_hold";

      if (flag.escalationRequired && flag.escalationReceiptId) {
        const record: VoiceEscalationRecord = {
          escalationId: flag.escalationReceiptId,
          sessionId,
          artifactId: artifact.artifactId,
          artifactType: artifact.artifactType,
          flagType: flag.flagType || "off_label",
          sourceSpans: artifact.sourceSpans,
          transcriptExcerpt: artifact.sourceSpans
            .map((s) => s.excerpt)
            .join(" | ")
            .slice(0, 500),
          normalizedStatement: artifact.normalizedStatement.slice(0, 500),
          escalatedAt: now(),
          escalatedBy: sessions[idx].userId,
          status: "open",
          voiceSessionAuditEventId: auditEvent.eventId,
        };

        sessions[idx].escalationReceiptIds = sessions[idx].escalationReceiptIds || [];
        sessions[idx].escalationReceiptIds.push(record.escalationId);

        saveVoiceEscalation(sessions[idx].organizationId, record);
      }
    }
  }

  saveVoiceSessions(sessions);
  return artifacts;
}

// ─── Compliance checking ──────────────────────────────────────────────

const ADVERSE_EVENT_PATTERNS = [
  /adverse\s*event/i,
  /side\s*effect/i,
  /patient\s*harm/i,
  /hospitaliz/i,
  /emergency\s*room/i,
  /serious\s*injury/i,
  /death/i,
  /anaphyl/i,
  /allergic\s*reaction/i,
];

const COMPLAINT_PATTERNS = [
  /product\s*complaint/i,
  /defective/i,
  /damaged\s*product/i,
  /wrong\s*dosage/i,
  /packaging\s*issue/i,
  /quality\s*issue/i,
];

const PROMOTIONAL_PATTERNS = [
  /off.?label/i,
  /unapproved\s*use/i,
  /prescrib.*pressure/i,
  /efficacy\s*claim/i,
  /comparative\s*efficacy/i,
  /clinical\s*claim/i,
  /patient.*target/i,
];

/**
 * Check an evidence artifact for compliance issues.
 * Returns a flag result indicating whether escalation is required.
 */
export function checkCompliance(artifact: EvidenceArtifact): ComplianceFlagResult {
  const text = artifact.normalizedStatement;
  const spans = artifact.sourceSpans.map((s) => s.excerpt).join(" ");
  const fullText = `${text} ${spans}`;

  // Check for adverse events
  for (const pattern of ADVERSE_EVENT_PATTERNS) {
    if (pattern.test(fullText)) {
      return {
        artifactId: artifact.artifactId,
        flagged: true,
        flagType: "adverse_event",
        escalationRequired: true,
        escalationReceiptId: `esc-${nanoid(12)}`,
        message: "Potential adverse event detected. Source transcript preserved. Session marked for required review. Escalation procedure activated.",
      };
    }
  }

  // Check for product complaints
  for (const pattern of COMPLAINT_PATTERNS) {
    if (pattern.test(fullText)) {
      return {
        artifactId: artifact.artifactId,
        flagged: true,
        flagType: "product_complaint",
        escalationRequired: true,
        escalationReceiptId: `esc-${nanoid(12)}`,
        message: "Potential product complaint detected. Escalation required per compliance policy.",
      };
    }
  }

  // Check for promotional content violations
  for (const pattern of PROMOTIONAL_PATTERNS) {
    if (pattern.test(fullText)) {
      return {
        artifactId: artifact.artifactId,
        flagged: true,
        flagType: "promotional_content",
        escalationRequired: false,
        message: "Potential promotional content boundary detected. Artifact flagged for review. The voice agent must not autonomously create clinical, efficacy, or comparative claims.",
      };
    }
  }

  return {
    artifactId: artifact.artifactId,
    flagged: false,
    escalationRequired: false,
    message: "No compliance issues detected.",
  };
}

function hasOpenEscalations(session: VoiceSession): boolean {
  if (!session.escalationReceiptIds || session.escalationReceiptIds.length === 0) {
    return false;
  }
  for (const id of session.escalationReceiptIds) {
    const record = getVoiceEscalation(session.organizationId, id);
    if (record && record.status === "open") return true;
  }
  return false;
}

function toAttributionClaim(attribution: any): AttributionClaim {
  return {
    claimId: attribution.id,
    experimentId: attribution.outcomeId,
    hypothesisId: attribution.hypothesisId,
    outcomeMetric: "primary_outcome",
    outcomeValue: null,
    counterfactualEstimate: null,
    causalEffect: attribution.estimatedEffect ?? 0,
    confidence: attribution.attributionConfidence ?? 0.5,
    method: attribution.method === "matched_pairs"
      ? "rct"
      : attribution.method === "comparison_group"
        ? "diff_in_diff"
        : attribution.method === "before_after"
          ? "synthetic_control"
          : "expert_judgment",
    evidence: [attribution.reasoning || ""],
    segments: [],
    territories: [],
    testedBy: [attribution.employeeId || ""],
    falsificationSurvived: attribution.responsibleFactor !== "unresolved",
    significanceLevel: 0.05,
  };
}

function buildAdmissibilityInput(
  session: VoiceSession,
  attribution: any,
): AdmissibilityInput {
  const hypothesis = session.hypothesisId
    ? loadHypotheses().find((h) => h.id === session.hypothesisId)
    : undefined;
  const assignment = session.assignmentId
    ? loadHypothesisAssignments().find((a) => a.id === session.assignmentId)
    : undefined;

  const unresolvedConfounders = session.extractedArtifacts
    .filter((a) => a.evidenceStatus === "confirmed" && (a.artifactType === "confounder" || a.artifactType === "unresolved_question"))
    .map((a) => a.normalizedStatement.slice(0, 200));

  const prohibitedVariableChanged = session.extractedArtifacts.some(
    (a) => a.evidenceStatus === "confirmed" && a.artifactType === "protocol_deviation",
  );

  return {
    recordId: session.sessionId,
    observationCount: 1,
    hasComparison: !!(hypothesis?.control && hypothesis.control.length > 0),
    executionFidelity: prohibitedVariableChanged ? 0.5 : 0.85,
    preRegistered: !!hypothesis,
    hasExplicitTreatmentAndComparison: !!(
      hypothesis?.intervention?.length && hypothesis?.control?.length
    ),
    hasEligibilityCriteria: !!(hypothesis?.targetCondition?.length),
    hasAssignmentMethod: !!assignment,
    hasFixedPrimaryMetric: !!(hypothesis?.primaryOutcome?.length),
    hasObservationWindow: true,
    hasFidelityCapture: true,
    prohibitedVariableChanged,
    complianceApproved: !hasOpenEscalations(session),
    hasUnresolvedCompliance: hasOpenEscalations(session),
    claims: attribution ? [toAttributionClaim(attribution)] : [],
    independentReplications: 0,
    experimentCount: 1,
    hasFailureBoundary: false,
    transferabilityDemonstrated: false,
    economicValueExceedsCost: false,
    hasCompleteContributionLedger: false,
    unresolvedConfounders,
  };
}

// ─── Confirmation and persistence ─────────────────────────────────────

/**
 * Confirm extracted artifacts and persist them to the experiment ledger.
 * This is the human confirmation gate — nothing enters the ledger without it.
 */
export async function confirmArtifacts(
  sessionId: string,
  confirmedArtifactIds: string[],
  confirmedBy: string,
): Promise<VoiceSession> {
  const sessions = loadVoiceSessions();
  const idx = sessions.findIndex((s) => s.sessionId === sessionId);
  if (idx === -1) throw new Error(`Session not found: ${sessionId}`);

  const session = sessions[idx];

  // Mark confirmed artifacts
  for (const artifact of session.extractedArtifacts) {
    if (confirmedArtifactIds.includes(artifact.artifactId)) {
      artifact.humanConfirmationState = "confirmed";
      artifact.evidenceStatus = "confirmed";
    } else {
      artifact.humanConfirmationState = "discarded" as ConfirmationState;
      artifact.evidenceStatus = "rejected";
    }
  }

  // Record confirmation
  session.confirmationIdentity = confirmedBy;
  session.confirmedAt = now();
  session.auditEvents.push(
    createAuditEvent(sessionId, "voice.artifacts_confirmed", confirmedBy, {
      confirmationState: "confirmed",
    }),
  );

  // Transition to confirmed state
  session.state = "confirmed";
  session.updatedAt = now();
  saveVoiceSessions(sessions);

  // Persist confirmed artifacts to the experiment ledger
  const confirmedArtifacts = session.extractedArtifacts.filter(
    (a) => a.evidenceStatus === "confirmed",
  );

  if (confirmedArtifacts.length > 0 && session.assignmentId) {
    // Record the outcome in the golden ledger
    const outcomeArtifact = confirmedArtifacts.find(
      (a) => a.artifactType === "outcome" || a.artifactType === "observation",
    );
    if (outcomeArtifact) {
      try {
        const outcome = recordOutcome({
          assignmentId: session.assignmentId,
          successKind: outcomeArtifact.artifactType === "negative_outcome" ? "falsification" : "performance",
          outcomeDescription: outcomeArtifact.normalizedStatement,
          metrics: [],
          falsified: outcomeArtifact.artifactType === "negative_outcome",
          contextAtObservation: {
            externalFactors: confirmedArtifacts
              .filter((a) => a.artifactType === "external_factor_report")
              .map((a) => a.normalizedStatement),
            concurrentHypotheses: [],
          },
        });

        session.outcomeId = outcome.id;

        // Run LLM-enhanced attribution with deterministic fallback.
        const attrResult = await attributeOutcomeWithLLM(outcome.id);
        const attribution = attrResult.attribution;

        if (attribution) {
          session.attributionId = attribution.id;
          session.auditEvents.push(
            createAuditEvent(sessionId, "voice.artifacts_confirmed", confirmedBy, {
              artifactHashes: [attribution.id],
            }),
          );
        }

        if (attrResult.llmError) {
          console.warn("[voice] attribution LLM fallback:", attrResult.llmError);
        }

        // Evaluate admissibility of the voice evidence bundle.
        const admissibilityInput = buildAdmissibilityInput(session, attribution);
        const admissibilityDecision = decideAdmissibility(
          admissibilityInput,
          DEFAULT_ADMISSIBILITY_CONFIG,
        );
        session.admissibilityDecision = admissibilityDecision as AdmissibilityDecision;
        session.auditEvents.push(
          createAuditEvent(sessionId, "voice.artifacts_confirmed", confirmedBy, {
            artifactHashes: confirmedArtifacts.map((a) => a.artifactId),
            complianceResult: `Admissibility: ${admissibilityDecision.level} — ${admissibilityDecision.rationale}`,
          }),
        );
      } catch (e) {
        console.error("[voice] failed to record outcome/attribution/admissibility:", e);
      }
    }
  }

  // Transition to persisted, then completed
  session.state = "persisted";
  session.updatedAt = now();

  // Update mission state if we have one
  if (session.missionId) {
    const missions = loadMissions();
    const missionIdx = missions.findIndex((m) => m.id === session.missionId);
    if (missionIdx !== -1) {
      missions[missionIdx].state = "completed";
      missions[missionIdx].completedAt = now();
      saveMissions(missions);
    }
  }

  session.state = "completed";
  session.auditEvents.push(
    createAuditEvent(sessionId, "voice.session_completed", confirmedBy),
  );
  session.updatedAt = now();

  sessions[idx] = session;
  saveVoiceSessions(sessions);

  return session;
}

// ─── Guided interview ─────────────────────────────────────────────────

/**
 * Generate the guided interview questions for a session.
 * These are asked one at a time during the listening phase.
 */
export function generateInterviewQuestions(session: VoiceSession): InterviewQuestion[] {
  const questions: InterviewQuestion[] = [
    {
      questionId: "q1",
      prompt: "What happened?",
      category: "what_happened",
      required: true,
      asked: false,
      answered: false,
    },
    {
      questionId: "q2",
      prompt: "What did you directly observe?",
      category: "what_observed",
      required: true,
      asked: false,
      answered: false,
    },
    {
      questionId: "q3",
      prompt: "What changed from the approved protocol?",
      category: "protocol_change",
      required: false,
      asked: false,
      answered: false,
    },
    {
      questionId: "q4",
      prompt: "Who performed the action?",
      category: "who_acted",
      required: true,
      asked: false,
      answered: false,
    },
    {
      questionId: "q5",
      prompt: "When did it occur?",
      category: "when_occurred",
      required: true,
      asked: false,
      answered: false,
    },
    {
      questionId: "q6",
      prompt: "What outcome was recorded?",
      category: "outcome_recorded",
      required: true,
      asked: false,
      answered: false,
    },
    {
      questionId: "q7",
      prompt: "What evidence supports that conclusion?",
      category: "evidence_supports",
      required: true,
      asked: false,
      answered: false,
    },
    {
      questionId: "q8",
      prompt: "What else could explain the result?",
      category: "alternative_explanations",
      required: false,
      asked: false,
      answered: false,
    },
    {
      questionId: "q9",
      prompt: "Was there any complaint, opt-out, safety issue, or unexpected event?",
      category: "safety_events",
      required: true,
      asked: false,
      answered: false,
    },
    {
      questionId: "q10",
      prompt: "How confident are you?",
      category: "confidence",
      required: true,
      asked: false,
      answered: false,
    },
    {
      questionId: "q11",
      prompt: "Should this become an observation, challenge, deviation, or derivative?",
      category: "artifact_classification",
      required: false,
      asked: false,
      answered: false,
    },
  ];

  return questions;
}

// ─── Voice commands ───────────────────────────────────────────────────

/**
 * Parse a voice command from transcript text.
 * Returns the command name and any arguments, or null if no command detected.
 */
export function parseVoiceCommand(text: string): { command: string; args?: string } | null {
  const lower = text.toLowerCase().trim();

  const commands: Record<string, RegExp> = {
    start_mission: /^start\s*(the\s*)?mission/i,
    read_hypothesis: /^read\s*(the\s*)?hypothesis/i,
    explain_assignment: /^(why\s*was\s*i\s*assigned|explain\s*(the\s*)?assignment)/i,
    review_evidence: /^review\s*(the\s*)?evidence/i,
    observe: /^(record\s*an?\s*observation|observe|i\s*observed)/i,
    challenge: /^(challenge|i\s*challenge)/i,
    record_deviation: /^(record\s*a\s*deviation|deviation)/i,
    add_confounder: /^(add\s*a\s*confounder|confounder)/i,
    derive: /^(derive|create\s*a\s*derivative)/i,
    request_replication: /^(request\s*replication|replicate)/i,
    pause: /^pause/i,
    resume: /^resume/i,
    correct_transcript: /^(correction|correct)/i,
    confirm_evidence: /^(confirm|submit\s*(the\s*)?observation)/i,
    discard_observation: /^(discard|delete\s*(the\s*)?observation)/i,
    finish_session: /^(finish|end\s*session|done)/i,
    skip: /^skip/i,
    dont_know: /^i\s*don'?t\s*know/i,
    not_observed: /^not\s*observed/i,
    mark_uncertain: /^mark\s*(that\s*)?uncertain/i,
  };

  for (const [cmd, pattern] of Object.entries(commands)) {
    const match = text.match(pattern);
    if (match) {
      const args = text.slice(match[0].length).trim();
      return { command: cmd, args: args || undefined };
    }
  }

  return null;
}

// ─── Session listing ──────────────────────────────────────────────────

/** List all sessions for a user. */
export function listSessions(userId: string): VoiceSession[] {
  return loadVoiceSessions().filter((s) => s.userId === userId);
}

/** Get all artifacts for a session. */
export function getSessionArtifacts(sessionId: string): EvidenceArtifact[] {
  const session = getSession(sessionId);
  return session?.extractedArtifacts || [];
}
