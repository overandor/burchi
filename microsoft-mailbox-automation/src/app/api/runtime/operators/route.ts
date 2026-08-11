import { NextRequest, NextResponse } from "next/server";
import { listOperators, createOperator, getOperator } from "@/lib/runtime/engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/runtime/operators — list all reconciliation operators
 * POST /api/runtime/operators — create a new operator
 */
export async function GET() {
  return NextResponse.json({ operators: listOperators() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name } = body;
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const op = createOperator(name);
    return NextResponse.json({ operator: op, message: "Operator created" });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
