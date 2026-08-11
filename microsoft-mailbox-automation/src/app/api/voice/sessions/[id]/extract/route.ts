import { NextRequest } from "next/server";
import { handleExtractArtifacts } from "@/lib/voice/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/voice/sessions/:id/extract
 *
 * Extracts evidence artifacts from the session's transcript segments.
 * Transitions to processing → review.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  return handleExtractArtifacts(_req, params);
}
