import { NextRequest, NextResponse } from "next/server";
import { getManagerLabView } from "@/lib/competitive/engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const managerId = req.nextUrl.searchParams.get("managerId") || "emp-007";

  try {
    const view = getManagerLabView(managerId);
    if (!view) {
      return NextResponse.json(
        { error: `Manager not found or not a manager role: ${managerId}` },
        { status: 404 },
      );
    }
    return NextResponse.json(view);
  } catch (e) {
    console.error("[api/competitive/manager] error:", e);
    return NextResponse.json(
      { error: "Failed to get manager lab view" },
      { status: 500 },
    );
  }
}
