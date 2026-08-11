import { NextRequest } from "next/server";
import { handleCompleteSession } from "@/lib/voice/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/voice/sessions/:id/complete
 *
 * Marks a voice session as completed.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  return handleCompleteSession(_req, params);
}
