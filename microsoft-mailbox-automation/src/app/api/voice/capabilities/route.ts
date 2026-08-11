import { NextRequest } from "next/server";
import { handleGetCapabilities } from "@/lib/voice/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/voice/capabilities
 *
 * Returns the default capability schema. The client fills in the actual
 * browser API detection results and posts them back to setCapabilities.
 */
export async function GET(req: NextRequest) {
  return handleGetCapabilities(req);
}
