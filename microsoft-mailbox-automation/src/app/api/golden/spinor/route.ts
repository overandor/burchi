import { NextRequest, NextResponse } from "next/server";
import {
  ensureSpinorInitialized,
  getOrganismForEmployee,
  listOrganisms,
  rankParticipants,
  computeNodeScore,
  getContributionRoles,
  recomputeProfile,
  computeDCS,
  computeMaturity,
} from "@/lib/golden/spinor";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/golden/spinor?employeeId=...&action=organism|leaderboard|profile|score
 *
 * - action=organism (default): build the Hypothesis Organism for the employee
 * - action=leaderboard: rank all participants by node score
 * - action=profile: get participant profile with contribution roles
 * - action=score: get node score breakdown for an employee
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "organism";
    const employeeId = searchParams.get("employeeId");

    ensureSpinorInitialized();

    switch (action) {
      case "organism": {
        if (!employeeId) return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
        const organism = getOrganismForEmployee(employeeId);
        if (!organism) return NextResponse.json({ error: "No active assignment for this employee" }, { status: 404 });
        return NextResponse.json({ organism });
      }

      case "leaderboard": {
        const rankings = rankParticipants();
        return NextResponse.json({ rankings, count: rankings.length });
      }

      case "profile": {
        if (!employeeId) return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
        const profile = recomputeProfile(employeeId);
        const roles = getContributionRoles(employeeId);
        return NextResponse.json({ profile, roles });
      }

      case "score": {
        if (!employeeId) return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
        const result = computeNodeScore(employeeId);
        return NextResponse.json(result);
      }

      case "maturity": {
        const hypothesisId = searchParams.get("hypothesisId");
        if (!hypothesisId) return NextResponse.json({ error: "hypothesisId is required" }, { status: 400 });
        const result = computeMaturity(hypothesisId);
        return NextResponse.json(result);
      }

      case "list": {
        const organisms = listOrganisms();
        return NextResponse.json({ organisms, count: organisms.length });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e: any) {
    console.error("[/api/golden/spinor] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/golden/spinor
 * Body: { action: "compute_dcs", impact, confidence, replicability, novelty, transferability, harm }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.action === "compute_dcs") {
      const dcs = computeDCS(
        Number(body.impact) || 0,
        Number(body.confidence) || 0,
        Number(body.replicability) || 0,
        Number(body.novelty) || 0,
        Number(body.transferability) || 0,
        Number(body.harm) || 0,
      );
      return NextResponse.json({ dcs });
    }
    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
