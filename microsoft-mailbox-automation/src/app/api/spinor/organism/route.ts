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
import { getDemoDataPolicy } from "@/lib/spinor/demo-policy";

export const dynamic = "force-dynamic";

/**
 * GET /api/spinor/organism?employeeId=emp-001
 *
 * Returns the Hypothesis Organism for a participant's current primary
 * assignment: the central hypothesis plus surrounding evidence nodes,
 * maturity stage, evidence badge, and Discovery Contribution Score.
 *
 * Development fixtures are seeded only when demo mode is enabled. Production
 * returns an explicit empty state instead of silently manufacturing evidence.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const demoPolicy = getDemoDataPolicy();
    const requestedEmployeeId = searchParams.get("employeeId");

    if (!requestedEmployeeId && !demoPolicy.enabled) {
      return NextResponse.json(
        {
          error: "employeeId is required outside demo mode.",
          organism: null,
          activeCount: 0,
          demoMode: false,
          dataOrigin: "production",
        },
        { status: 400 },
      );
    }

    const employeeId = requestedEmployeeId ?? "emp-001";

    if (loadHypotheses().length === 0 && demoPolicy.enabled) {
      ensureGoldenSeeded();
    }

    let active = getActiveAssignmentsForEmployee(employeeId);
    if (active.length === 0) {
      if (!demoPolicy.enabled) {
        return NextResponse.json({
          organism: null,
          activeCount: 0,
          demoMode: false,
          dataOrigin: "production",
          emptyState: {
            code: "NO_ACTIVE_ASSIGNMENT",
            message:
              "No approved Daily Seed is assigned. Connect evidence, create an approved hypothesis, or allocate an existing hypothesis.",
          },
        });
      }

      const employee = SEED_EMPLOYEES.find((candidate) => candidate.id === employeeId);
      if (!employee) {
        return NextResponse.json(
          {
            error: "Unknown demo participant.",
            organism: null,
            activeCount: 0,
            demoMode: true,
            dataOrigin: "demo",
          },
          { status: 404 },
        );
      }

      goldenEngine.allocateForEmployee(employee.id);
      active = getActiveAssignmentsForEmployee(employeeId);
    }

    if (active.length === 0) {
      return NextResponse.json(
        {
          error: "No assignable hypothesis available for this participant.",
          organism: null,
          activeCount: 0,
          demoMode: demoPolicy.enabled,
          dataOrigin: demoPolicy.enabled ? "demo" : "production",
        },
        { status: 404 },
      );
    }

    const assignment = active[0];
    const hypotheses = loadHypotheses();
    const hypothesis = hypotheses.find((candidate) => candidate.id === assignment.hypothesisId);
    if (!hypothesis) {
      return NextResponse.json(
        {
          error: "Hypothesis record missing.",
          organism: null,
          activeCount: active.length,
          demoMode: demoPolicy.enabled,
          dataOrigin: demoPolicy.enabled ? "demo" : "production",
        },
        { status: 404 },
      );
    }

    const priorArt = loadPriorArt().find((record) => record.id === hypothesis.priorArtId);
    const organism = assembleOrganism(
      assignment,
      hypothesis,
      priorArt,
      loadHypothesisOutcomes(),
      loadHypothesisAttributions(),
      loadDerivatives(),
      loadGoldenNodes(),
      loadProcesses().map((process) => ({ hypothesisId: process.hypothesisId })),
    );

    return NextResponse.json({
      organism,
      activeCount: active.length,
      demoMode: demoPolicy.enabled,
      dataOrigin: demoPolicy.enabled ? "demo" : "production",
      demoPolicy: {
        source: demoPolicy.source,
        reason: demoPolicy.reason,
      },
    });
  } catch (error: unknown) {
    console.error("[spinor/organism] error:", error);
    const message = error instanceof Error ? error.message : "Unknown organism error";
    return NextResponse.json({ error: message, organism: null }, { status: 500 });
  }
}
