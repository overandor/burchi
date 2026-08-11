import { NextRequest, NextResponse } from "next/server";
import { enrichDatasets, getOperator } from "@/lib/runtime/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/runtime/enrich
 * Enrich multiple datasets using a reconciliation operator.
 * Each run updates the operator — the asset is the accumulated machinery.
 *
 * Body:
 *   operatorId: string
 *   datasets: { [sourceName: string]: Record<string, unknown>[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { operatorId, datasets } = body;

    if (!operatorId || !datasets) {
      return NextResponse.json({ error: "operatorId and datasets are required" }, { status: 400 });
    }

    const op = getOperator(operatorId);
    if (!op) {
      return NextResponse.json({ error: "Operator not found" }, { status: 404 });
    }

    if (typeof datasets !== "object" || Array.isArray(datasets)) {
      return NextResponse.json({ error: "datasets must be an object mapping source names to record arrays" }, { status: 400 });
    }

    const result = enrichDatasets(operatorId, datasets);
    return NextResponse.json({
      canonicalRecords: result.canonical.length,
      conflicts: result.conflicts,
      operatorVersion: result.updatedOperator.version,
      operatorFitness: result.updatedOperator.fitness,
      datasetsProcessed: result.updatedOperator.datasetsProcessed,
      canonical: result.canonical.slice(0, 100), // cap response size
      totalCount: result.canonical.length,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
