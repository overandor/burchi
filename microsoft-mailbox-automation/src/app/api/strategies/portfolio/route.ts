import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { getPortfolio, listAssignments, acceptAssignment, modifyAssignment, rejectAssignment } from "@/lib/strategy/assignment";
import { getAuthContext } from "@/lib/auth/session";

const PortfolioSchema = z.object({
  employeeId: z.string().min(1),
  role: z.enum(["field_representative", "regional_manager", "medical_affairs", "market_access", "compliance"]),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId") || ctx.user.id;
    const role = searchParams.get("role") || ctx.user.role || "field_representative";

    // Validate role
    const validRoles = ["field_representative", "regional_manager", "medical_affairs", "market_access", "compliance"];
    const validatedRole = validRoles.includes(role) ? role : "field_representative";

    const portfolio = getPortfolio(employeeId, validatedRole as any);
    return NextResponse.json(portfolio);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

const AcceptSchema = z.object({
  action: z.enum(["accept", "modify", "reject"]),
  assignmentId: z.string().min(1),
  modificationNotes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = AcceptSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { action, assignmentId, modificationNotes } = parsed.data;

    let result;
    switch (action) {
      case "accept":
        result = acceptAssignment(assignmentId);
        break;
      case "modify":
        result = modifyAssignment(assignmentId, modificationNotes || "");
        break;
      case "reject":
        result = rejectAssignment(assignmentId);
        break;
    }

    if (!result) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }

    return NextResponse.json({ assignment: result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
