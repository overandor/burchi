import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { goldenEngine } from "@/lib/golden/engine";
import { listGoldenNodes, getGoldenNodesForEmployee, getGoldenNodeById, listAttributionLedger, getAttributionLedgerForNode } from "@/lib/golden/golden-node";
import { ensureFullDemoSeeded } from "@/lib/golden/demo-seed";

export const dynamic = "force-dynamic";

/** GET /api/golden/golden-nodes?employeeId=...&id=...&ledger=true */
export async function GET(req: NextRequest) {
  try {
    // Ensure demo data is seeded (idempotent)
    ensureFullDemoSeeded();

    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");
    const id = searchParams.get("id");
    const withLedger = searchParams.get("ledger") === "true";

    if (id) {
      const node = getGoldenNodeById(id);
      if (!node) return NextResponse.json({ error: "Golden node not found" }, { status: 404 });
      const ledger = withLedger ? getAttributionLedgerForNode(node.id) : undefined;
      return NextResponse.json({ node, ledger });
    }
    const nodes = employeeId ? getGoldenNodesForEmployee(employeeId) : listGoldenNodes();
    const ledger = withLedger ? listAttributionLedger() : [];
    return NextResponse.json({ goldenNodes: nodes, count: nodes.length, ledger });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

const IdentifySchema = z.object({
  hypothesisId: z.string().min(1),
  originEmployeeId: z.string().min(1),
  originAssignmentId: z.string().min(1),
  replicationCount: z.number().int().min(0),
  replicationTerritories: z.array(z.string()),
});

/** POST /api/golden/golden-nodes — identify a Golden Node candidate from evidence. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = IdentifySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const node = goldenEngine.identifyGoldenNode(
      parsed.data.hypothesisId,
      parsed.data.originEmployeeId,
      parsed.data.originAssignmentId,
      parsed.data.replicationCount,
      parsed.data.replicationTerritories
    );
    if (!node) return NextResponse.json({ error: "Insufficient evidence to identify a Golden Node" }, { status: 404 });
    return NextResponse.json({ node });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

const PromoteSchema = z.object({
  id: z.string().min(1),
  toStage: z.enum(["hypothesis", "local_success", "rep_owned_process", "replicated_method", "organizational_capability", "productized_service", "independent_channel"]),
  channelName: z.string().optional(),
});

/** PATCH /api/golden/golden-nodes — promote a Golden Node to a new stage / channel. */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = PromoteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const node = goldenEngine.promoteGoldenNode(parsed.data.id, parsed.data.toStage, parsed.data.channelName);
    if (!node) return NextResponse.json({ error: "Golden node not found" }, { status: 404 });
    return NextResponse.json({ node });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
