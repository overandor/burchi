import { NextRequest } from "next/server";
import {
  handleGetSession,
  handlePatchSession,
} from "@/lib/voice/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/voice/sessions/:id
 * Returns the full session state.
 *
 * PATCH /api/voice/sessions/:id
 * Body: { state?: VoiceSessionState, capabilities?: VoiceCapabilities, action?: "cancel" }
 * Transitions state or updates capabilities.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  return handleGetSession(_req, params);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  return handlePatchSession(req, params);
}
