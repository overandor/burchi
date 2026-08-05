import { NextRequest, NextResponse } from "next/server";
import { generateMission, getActiveMissions, updateMissionState, MISSION_CLASS_CONFIG } from "@/lib/spinor-rl/engine";
import { MissionClass } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/spinor-rl/mission?employeeId=emp-001
 * Returns active missions for the employee.
 *
 * POST /api/spinor-rl/mission
 * Body: { employeeId, missionClass? }
 * Generates a new mission card.
 *
 * PATCH /api/spinor-rl/mission
 * Body: { missionId, state }
 * Updates mission state.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId") || "emp-001";
    const missions = getActiveMissions(employeeId);
    return NextResponse.json({ missions, count: missions.length, missionClasses: MISSION_CLASS_CONFIG });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const employeeId = body.employeeId || "emp-001";
    const missionClass = body.missionClass as MissionClass | undefined;
    const result = await generateMission(employeeId, missionClass);
    return NextResponse.json({
      mission: result.mission,
      llmUsed: result.llmUsed,
      llmError: result.llmError,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { missionId, state } = body;
    if (!missionId || !state) {
      return NextResponse.json({ error: "missionId and state required" }, { status: 400 });
    }
    const mission = updateMissionState(missionId, state);
    if (!mission) return NextResponse.json({ error: "Mission not found" }, { status: 404 });
    return NextResponse.json({ mission });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
