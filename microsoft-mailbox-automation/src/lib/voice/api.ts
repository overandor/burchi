/**
 * Voice session API controller.
 *
 * Consolidates all voice endpoint logic into one module with
 * input validation and audit logging.
 * This is the "mega system" boundary for voice-first mission execution.
 *
 * Uses auth context when available, falls back to demo context for
 * backwards compatibility with existing voice sessions.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createSession,
  getSession,
  listSessions,
  transitionState,
  setCapabilities,
  cancelSession,
  addTranscriptSegment,
  extractArtifacts,
  confirmArtifacts,
  getSessionArtifacts,
  defaultCapabilities,
} from "@/lib/voice/session";
import { VoiceSession, VoiceCapabilities, VoiceSessionState } from "@/types";
import { getAuthContext } from "@/lib/auth/session";

// Fallback demo context — used when no authenticated session exists
const DEMO_CTX = {
  user: { id: "emp-001", name: "Field Rep", role: "field_representative" },
  orgId: "org-demo",
} as any;

type AuthContext = typeof DEMO_CTX;

async function getCtx(): Promise<AuthContext> {
  try {
    const ctx = await getAuthContext();
    return {
      user: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role },
      orgId: ctx.orgId,
    } as any;
  } catch {
    return DEMO_CTX;
  }
}

class VoiceError extends Error {
  constructor(
    message: string,
    public status: number = 500,
  ) {
    super(message);
    this.name = "VoiceError";
  }
}

function jsonError(message: string, status: number = 500) {
  return NextResponse.json({ error: message }, { status });
}

async function getBody(req: NextRequest): Promise<Record<string, any>> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function canAccess(ctx: AuthContext, session: VoiceSession): boolean {
  // Authenticated users can only access their own sessions;
  // demo context can access all (backwards compat).
  if (ctx.orgId === DEMO_CTX.orgId) return true;
  return session.userId === ctx.user.id;
}

async function withVoiceSession(
  ctx: AuthContext,
  sessionId: string,
): Promise<VoiceSession> {
  const session = getSession(sessionId);
  if (!session) {
    throw new VoiceError("Session not found", 404);
  }
  if (!canAccess(ctx, session)) {
    throw new VoiceError("Not authorized for this session", 403);
  }
  return session;
}

function summarizeSession(session: VoiceSession) {
  return {
    sessionId: session.sessionId,
    state: session.state,
    mission: session.missionId,
    capabilities: session.capabilities,
    complianceRequirements: session.complianceRequirements,
    outcomeId: session.outcomeId,
    attributionId: session.attributionId,
    admissibilityLevel: session.admissibilityDecision?.level,
    escalationReceiptIds: session.escalationReceiptIds,
    expiresAt: session.expiresAt,
  };
}

// ─── Session collection ───────────────────────────────────────────────

export async function handleCreateSession(req: NextRequest) {
  try {
    const ctx = await getCtx();
    const body = await getBody(req);

    const session = createSession(ctx.user.id, ctx.orgId, {
      dailySeedId: body.dailySeedId,
      experimentId: body.experimentId,
      missionId: body.missionId,
      hypothesisId: body.hypothesisId,
      assignmentId: body.assignmentId,
      language: body.language,
      captureMode: body.captureMode,
      audioRetention: body.audioRetention,
    });

    return NextResponse.json(summarizeSession(session));
  } catch (e: any) {
    if (e.name === "VoiceError") {
      return jsonError(e.message, e.status || 500);
    }
    console.error("[voice/api/create] error:", e);
    return jsonError(e.message || "Internal error", 500);
  }
}

export async function handleListSessions(req: NextRequest) {
  try {
    const ctx = await getCtx();
    const { searchParams } = new URL(req.url);
    const requestedUserId = searchParams.get("userId");

    let userId = ctx.user.id;
    if (requestedUserId) {
      userId = requestedUserId;
    }

    const sessions = listSessions(userId);
    return NextResponse.json({
      sessions,
      count: sessions.length,
      userId,
      orgId: ctx.orgId,
    });
  } catch (e: any) {
    console.error("[voice/api/list] error:", e);
    return jsonError(e.message || "Internal error", 500);
  }
}

// ─── Single session ───────────────────────────────────────────────────

export async function handleGetSession(
  _req: NextRequest,
  params: { id: string },
) {
  try {
    const ctx = await getCtx();
    const session = await withVoiceSession(ctx, params.id);
    return NextResponse.json({ session });
  } catch (e: any) {
    if (e.name === "VoiceError") {
      return jsonError(e.message, e.status || 500);
    }
    console.error("[voice/api/get] error:", e);
    return jsonError(e.message || "Internal error", 500);
  }
}

export async function handlePatchSession(
  req: NextRequest,
  params: { id: string },
) {
  try {
    const ctx = await getCtx();
    const session = await withVoiceSession(ctx, params.id);
    const body = await getBody(req);

    if (body.action === "cancel") {
      const cancelled = cancelSession(params.id, ctx.user.id);
      return NextResponse.json({ session: cancelled });
    }

    if (body.capabilities) {
      const updated = setCapabilities(
        params.id,
        body.capabilities as VoiceCapabilities,
      );
      return NextResponse.json({ session: updated });
    }

    if (body.state) {
      const auditType = body.auditEventType;
      const updated = transitionState(
        params.id,
        body.state as VoiceSessionState,
        ctx.user.id,
        auditType,
      );
      return NextResponse.json({ session: updated });
    }

    return jsonError("No action specified", 400);
  } catch (e: any) {
    if (e.name === "VoiceError") {
      return jsonError(e.message, e.status || 500);
    }
    console.error("[voice/api/patch] error:", e);
    return jsonError(e.message || "Internal error", 500);
  }
}

// ─── Transcript segments ──────────────────────────────────────────────

export async function handleAddTranscript(
  req: NextRequest,
  params: { id: string },
) {
  try {
    const ctx = await getCtx();
    const session = await withVoiceSession(ctx, params.id);
    const body = await getBody(req);

    if (!body.text || typeof body.text !== "string") {
      return jsonError("text required", 400);
    }

    if (session.state === "ready" || session.state === "briefing") {
      transitionState(params.id, "listening", ctx.user.id, "voice.recording_started");
    }

    const segment = addTranscriptSegment(
      params.id,
      body.text.trim(),
      typeof body.confidence === "number" ? body.confidence : 0.5,
      typeof body.provider === "string" ? body.provider : "browser",
      typeof body.speaker === "string" ? body.speaker : "employee",
      typeof body.startTime === "number" ? body.startTime : 0,
      typeof body.endTime === "number" ? body.endTime : 0,
    );

    // ─── Create a diary entry from this transcript ───────────────
    // Every spoken segment becomes a diary entry that can flow into the pipeline.
    // This is the REAL voice → diary → pipeline connection.
    let diaryEntry = null;
    try {
      const { createDiaryEntryFromTranscript } = await import("@/lib/voice/diary");
      diaryEntry = await createDiaryEntryFromTranscript({
        sessionId: params.id,
        segmentId: segment.segmentId,
        text: body.text.trim(),
        employeeId: ctx.user.id,
      });
    } catch (e) {
      console.error("[voice/api/transcript] diary creation failed:", e);
      // Don't fail the transcript if diary fails — but log it
    }

    return NextResponse.json({ segment, diaryEntry });
  } catch (e: any) {
    if (e.name === "VoiceError") {
      return jsonError(e.message, e.status || 500);
    }
    console.error("[voice/api/transcript] error:", e);
    return jsonError(e.message || "Internal error", 500);
  }
}

// ─── Extract ──────────────────────────────────────────────────────────

export async function handleExtractArtifacts(
  _req: NextRequest,
  params: { id: string },
) {
  try {
    const ctx = await getCtx();
    await withVoiceSession(ctx, params.id);

    transitionState(params.id, "processing", ctx.user.id);
    const artifacts = await extractArtifacts(params.id);
    transitionState(params.id, "review", ctx.user.id);

    return NextResponse.json({ artifacts, count: artifacts.length });
  } catch (e: any) {
    if (e.name === "VoiceError") {
      return jsonError(e.message, e.status || 500);
    }
    console.error("[voice/api/extract] error:", e);
    return jsonError(e.message || "Internal error", 500);
  }
}

// ─── Confirm ──────────────────────────────────────────────────────────

export async function handleConfirmArtifacts(
  req: NextRequest,
  params: { id: string },
) {
  try {
    const ctx = await getCtx();
    await withVoiceSession(ctx, params.id);
    const body = await getBody(req);

    if (!Array.isArray(body.confirmedIds)) {
      return jsonError("confirmedIds array required", 400);
    }

    if (!Array.isArray(body.corrections)) {
      return jsonError("corrections array required", 400);
    }

    const result = await confirmArtifacts(params.id, body.confirmedIds, ctx.user.id);
    return NextResponse.json(result);
  } catch (e: any) {
    if (e.name === "VoiceError") {
      return jsonError(e.message, e.status || 500);
    }
    console.error("[voice/api/confirm] error:", e);
    return jsonError(e.message || "Internal error", 500);
  }
}

// ─── Complete ─────────────────────────────────────────────────────────

export async function handleCompleteSession(
  _req: NextRequest,
  params: { id: string },
) {
  try {
    const ctx = await getCtx();
    await withVoiceSession(ctx, params.id);

    transitionState(params.id, "completed", ctx.user.id, "voice.session_completed");
    const session = getSession(params.id);
    return NextResponse.json({ session });
  } catch (e: any) {
    if (e.name === "VoiceError") {
      return jsonError(e.message, e.status || 500);
    }
    console.error("[voice/api/complete] error:", e);
    return jsonError(e.message || "Internal error", 500);
  }
}

// ─── Cancel ───────────────────────────────────────────────────────────

export async function handleCancelSession(
  _req: NextRequest,
  params: { id: string },
) {
  try {
    const ctx = await getCtx();
    await withVoiceSession(ctx, params.id);
    const cancelled = cancelSession(params.id, ctx.user.id);
    return NextResponse.json({ session: cancelled });
  } catch (e: any) {
    if (e.name === "VoiceError") {
      return jsonError(e.message, e.status || 500);
    }
    console.error("[voice/api/cancel] error:", e);
    return jsonError(e.message || "Internal error", 500);
  }
}

// ─── Artifacts ────────────────────────────────────────────────────────

export async function handleGetArtifacts(
  _req: NextRequest,
  params: { id: string },
) {
  try {
    const ctx = await getCtx();
    await withVoiceSession(ctx, params.id);
    const artifacts = getSessionArtifacts(params.id);
    return NextResponse.json({ artifacts, count: artifacts.length });
  } catch (e: any) {
    if (e.name === "VoiceError") {
      return jsonError(e.message, e.status || 500);
    }
    console.error("[voice/api/artifacts] error:", e);
    return jsonError(e.message || "Internal error", 500);
  }
}

// ─── Capabilities ─────────────────────────────────────────────────────

export async function handleGetCapabilities(_req: NextRequest) {
  return NextResponse.json({
    capabilities: defaultCapabilities(),
    note: "Use the browser's Web Speech API for speech recognition and synthesis.",
  });
}
