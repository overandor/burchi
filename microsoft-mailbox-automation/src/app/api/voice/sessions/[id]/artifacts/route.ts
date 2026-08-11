import { NextRequest } from "next/server";
import { handleGetArtifacts } from "@/lib/voice/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/voice/sessions/:id/artifacts
 *
 * Returns all extracted evidence artifacts for a session.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  return handleGetArtifacts(_req, params);
}
