import { NextRequest, NextResponse } from "next/server";
import { generateCompetitivePlan } from "@/lib/competitive/engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const employeeId = req.nextUrl.searchParams.get("employeeId") || "emp-001";

  try {
    const plan = generateCompetitivePlan(employeeId);
    if (!plan) {
      return NextResponse.json(
        { error: `Employee not found: ${employeeId}` },
        { status: 404 },
      );
    }
    return NextResponse.json(plan);
  } catch (e) {
    console.error("[api/competitive/plan] error:", e);
    return NextResponse.json(
      { error: "Failed to generate competitive plan" },
      { status: 500 },
    );
  }
}
