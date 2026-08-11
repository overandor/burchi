import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { assignStrategies, EmployeeContext } from "@/lib/strategy/assignment";
import { ensureStrategiesSeeded } from "@/lib/strategy/library";

const roleMap: Record<string, string> = {
  field_rep: "field_representative",
  field_representative: "field_representative",
  regional_manager: "regional_manager",
  medical_affairs: "medical_affairs",
  market_access: "market_access",
  compliance: "compliance",
};

const AssignSchema = z.object({
  employeeId: z.string().min(1),
  role: z.preprocess((v) => roleMap[String(v)] ?? v, z.enum(["field_representative", "regional_manager", "medical_affairs", "market_access", "compliance"])),
  territoryType: z.string().optional(),
  workloadLevel: z.enum(["low", "medium", "high"]).optional(),
  stakeholderSegment: z.string().optional(),
  productPortfolio: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = AssignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    ensureStrategiesSeeded();

    const ctx: EmployeeContext = {
      employeeId: parsed.data.employeeId,
      role: parsed.data.role,
      territoryType: parsed.data.territoryType,
      workloadLevel: parsed.data.workloadLevel,
      stakeholderSegment: parsed.data.stakeholderSegment,
      productPortfolio: parsed.data.productPortfolio,
    };

    const newAssignments = assignStrategies(ctx);
    return NextResponse.json({ assigned: newAssignments, count: newAssignments.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
