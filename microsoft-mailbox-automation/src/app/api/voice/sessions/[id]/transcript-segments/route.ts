import { NextRequest } from "next/server";
import { handleAddTranscript } from "@/lib/voice/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/voice/sessions/:id/transcript-segments
 * Body: { text, confidence, provider, speaker?, startTime?, endTime? }
 *
 * Adds a transcript segment to the session.
 * The segment is created with confirmationState = "unconfirmed".
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  return handleAddTranscript(req, params);
}
