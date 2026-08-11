import { NextRequest } from "next/server";
import { handleCancelSession } from "@/lib/voice/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/voice/sessions/:id/cancel
 *
 * Cancels a voice session. Valid from any non-terminal state.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  return handleCancelSession(_req, params);
}
