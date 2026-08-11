import { NextRequest, NextResponse } from "next/server";
import { requireAuthContext } from "@/lib/auth/session";
import {
  createSkill,
  getSkill,
  listSkills,
  recordPerformance,
  findMatchingSkill,
  getMaturityDistribution,
} from "@/lib/workteleport/skill-genome";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const maturity = searchParams.get("maturity") as any;
    const match = searchParams.get("match");
    const distribution = searchParams.get("distribution");

    if (id) {
      const skill = getSkill(ctx.orgId, id);
      if (!skill) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ skill });
    }

    if (distribution === "true") {
      const dist = getMaturityDistribution(ctx.orgId);
      return NextResponse.json({ distribution: dist });
    }

    if (match) {
      const skill = findMatchingSkill(ctx.orgId, match, searchParams.get("content") || "");
      return NextResponse.json({ match: skill || null });
    }

    const skills = listSkills(ctx.orgId, maturity);
    return NextResponse.json({ skills, count: skills.length });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const body = await req.json();

    if (!body.name || !body.description) {
      return NextResponse.json({ error: "name and description are required" }, { status: 400 });
    }

    const skill = createSkill({
      orgId: ctx.orgId,
      name: body.name,
      description: body.description,
      trigger: body.trigger,
      inputSchema: body.inputSchema,
      toolRequirements: body.toolRequirements,
      executionDag: body.executionDag,
      validationTests: body.validationTests,
      modelContribution: body.modelContribution,
      humanContribution: body.humanContribution,
    });

    return NextResponse.json({ skill }, { status: 201 });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const body = await req.json();

    if (!body.skillId || !body.performance) {
      return NextResponse.json({ error: "skillId and performance are required" }, { status: 400 });
    }

    const skill = recordPerformance(ctx.orgId, body.skillId, body.performance);
    return NextResponse.json({ skill });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}
