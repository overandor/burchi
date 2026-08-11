import { NextResponse } from "next/server";
import { generateDirectorAssessment } from "@/lib/runtime/engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/runtime/director
 * Returns the Proactive Director's assessment:
 *   - what should happen next
 *   - what's being neglected
 *   - what can execute without interruption
 *   - what requires approval
 *   - what should be killed
 *   - what should be replicated
 *   - missing human information
 */
export async function GET() {
  try {
    const assessment = generateDirectorAssessment();
    return NextResponse.json(assessment);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
