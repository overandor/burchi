import { NextRequest } from "next/server";
import {
  handleCreateSession,
  handleListSessions,
} from "@/lib/voice/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/voice/sessions
 * Body: CreateVoiceSessionInput (dailySeedId, experimentId, missionId, etc.)
 *
 * Creates a new voice session linked to a mission.
 * Identity is resolved from the authenticated session, not client input.
 *
 * GET /api/voice/sessions?userId=...
 * Lists sessions for a user.
 */
export async function POST(req: NextRequest) {
  return handleCreateSession(req);
}

export async function GET(req: NextRequest) {
  return handleListSessions(req);
}
