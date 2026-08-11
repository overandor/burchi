import { NextRequest } from "next/server";
import { handleConfirmArtifacts } from "@/lib/voice/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/voice/sessions/:id/confirm
 * Body: { confirmedArtifactIds: string[] }
 *
 * Confirms extracted artifacts and persists them to the experiment ledger.
 * This is the human confirmation gate — nothing enters the ledger without it.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  return handleConfirmArtifacts(req, params);
}
