import { NextRequest, NextResponse } from "next/server";
import { generateCompetitivePlan, getEmployee } from "@/lib/competitive/engine";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  const requestedId = req.nextUrl.searchParams.get("employeeId") || ctx.user.id;
  const employeeId = getEmployee(requestedId) ? requestedId : "emp-001";

  try {
    const plan = generateCompetitivePlan(employeeId);
    if (!plan) {
      return NextResponse.json(
        { error: `Employee not found: ${employeeId}` },
        { status: 404 },
      );
    }
    return NextResponse.json(plan.trajectory);
  } catch (e) {
    console.error("[api/competitive/trajectory] error:", e);
    return NextResponse.json(
      { error: "Failed to generate trajectory" },
      { status: 500 },
    );
  }
}
