import { NextRequest, NextResponse } from "next/server";
import { goldenEngine } from "@/lib/golden/engine";
import { getActiveAssignmentsForEmployee } from "@/lib/golden/allocation";
import { ensureGoldenSeeded, SEED_EMPLOYEES } from "@/lib/golden/seed";
import {
  loadHypotheses,
  loadPriorArt,
  loadHypothesisOutcomes,
  loadHypothesisAttributions,
  loadDerivatives,
  loadGoldenNodes,
  loadProcesses,
} from "@/lib/config";
import { assembleOrganism } from "@/lib/spinor/scoring";

export const dynamic = "force-dynamic";

/**
 * GET /api/spinor/organism?employeeId=emp-001
 *
 * Returns the Hypothesis Organism for a participant's current primary
 * assignment: the central hypothesis plus surrounding evidence nodes,
 * maturity stage, evidence badge, and Discovery Contribution Score.
 *
 * Seeds the engine on demand (serverless-safe) and allocates a fresh
 * hypothesis if the participant has no active assignment.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId") ?? "emp-001";

    // Ensure the golden store is seeded (idempotent).
    ensureGoldenSeeded();

    let active = getActiveAssignmentsForEmployee(employeeId);
    if (active.length === 0) {
      // Allocate for this employee if nothing is active.
      const employee = SEED_EMPLOYEES.find((e) => e.id === employeeId) ?? SEED_EMPLOYEES[0];
      goldenEngine.allocateForEmployee(employee.id);
      active = getActiveAssignmentsForEmployee(employeeId);
    }
    if (active.length === 0) {
      return NextResponse.json(
        { error: "No assignable hypothesis available for this participant.", organism: null },
        { status: 404 },
      );
    }

    // Primary assignment = the first active one.
    const assignment = active[0];
    const hypotheses = loadHypotheses();
    const hypothesis = hypotheses.find((h) => h.id === assignment.hypothesisId);
    if (!hypothesis) {
      return NextResponse.json({ error: "Hypothesis record missing.", organism: null }, { status: 404 });
    }

    const priorArt = loadPriorArt().find((p) => p.id === hypothesis.priorArtId);
    const organism = assembleOrganism(
      assignment,
      hypothesis,
      priorArt,
      loadHypothesisOutcomes(),
      loadHypothesisAttributions(),
      loadDerivatives(),
      loadGoldenNodes(),
      loadProcesses().map((p) => ({ hypothesisId: p.hypothesisId })),
    );

    return NextResponse.json({ organism, activeCount: active.length });
  } catch (e: any) {
    console.error("[spinor/organism] error:", e);
    return NextResponse.json({ error: e.message, organism: null }, { status: 500 });
  }
}
