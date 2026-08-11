import { NextResponse } from "next/server";
import { requireAuthContext } from "@/lib/auth/session";
import {
  getWorkteleportDashboard,
  getWorkteleportMissionSuggestions,
  getExperimentTwinCandidates,
  findSkillMatches,
} from "@/lib/workteleport/spinor-integration";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const ctx = await requireAuthContext();
    const { searchParams } = new URL(req.url);
    const view = searchParams.get("view") || "dashboard";

    switch (view) {
      case "dashboard":
        const dashboard = getWorkteleportDashboard(ctx.orgId);
        return NextResponse.json(dashboard);

      case "missions":
        const suggestions = getWorkteleportMissionSuggestions(ctx.orgId);
        return NextResponse.json({ suggestions, count: suggestions.length });

      case "twins":
        const twinCandidates = getExperimentTwinCandidates(ctx.orgId);
        return NextResponse.json({ candidates: twinCandidates });

      case "skill-match":
        const contentType = searchParams.get("contentType") || "email";
        const content = searchParams.get("content") || "";
        const matches = findSkillMatches(ctx.orgId, contentType, content);
        return NextResponse.json({ matches });

      default:
        return NextResponse.json({ error: "Unknown view" }, { status: 400 });
    }
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}
