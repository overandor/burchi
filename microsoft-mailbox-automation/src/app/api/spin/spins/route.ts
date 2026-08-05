import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  loadAllSpins,
  loadSpinsByState,
  loadSpinsByEmployee,
  getSpinCount,
  getStateDistribution,
  dbHealth,
  spinSummary,
  createNewSPIN,
} from "@/lib/spinor/spin-engine";

const CreateSchema = z.object({
  hypothesisId: z.string().min(1),
  employeeOwner: z.string().min(1),
  claim: z.string().min(1),
  intervention: z.string().min(1),
  control: z.string().min(1),
  population: z.string().min(1),
  primaryUncertainty: z.string().min(1),
  complianceBoundary: z.string().min(1),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const state = searchParams.get("state");
    const employeeId = searchParams.get("employeeId");
    const summary = searchParams.get("summary") === "true";

    let spins;
    if (state) {
      spins = loadSpinsByState(state as any);
    } else if (employeeId) {
      spins = loadSpinsByEmployee(employeeId);
    } else {
      spins = loadAllSpins();
    }

    const result = summary ? spins.map(spinSummary) : spins;

    return NextResponse.json({
      spins: result,
      count: spins.length,
      totalInDb: getSpinCount(),
      stateDistribution: getStateDistribution(),
      db: dbHealth(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const spin = createNewSPIN(parsed.data);
    return NextResponse.json({ spin, spinId: spin.spinId }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
