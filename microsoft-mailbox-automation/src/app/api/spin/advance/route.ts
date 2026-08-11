import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { advanceSPIN, suggestNextState, loadSpin } from "@/lib/spinor/spin-engine";
import { SPINState } from "@/lib/spinor/spin";
import { TransitionContext } from "@/lib/spinor/spin-state-machine";

const AdvanceSchema = z.object({
  spinId: z.string().min(1),
  toState: z.enum([
    "draft", "prior_art_checked", "novelty_qualified", "eligible",
    "assigned", "human_modified", "preregistered", "executing",
    "observed", "attributed", "replication_pending", "replicated",
    "golden_node_candidate", "systemization_pending", "automated",
    "channel_candidate", "reverse_test_required", "adversarial_execution",
    "revalidated", "narrowed", "rolled_back", "retired", "research",
  ]),
  actorId: z.string().min(1),
  actorRole: z.string().min(1),
  claims: z.array(z.any()).optional(),
  automationReady: z.boolean().optional(),
  automationLayerId: z.string().optional(),
  mechanism: z.string().optional(),
  priorArtChecked: z.boolean().optional(),
  noveltyQualified: z.boolean().optional(),
  preRegistered: z.boolean().optional(),
  replicationClaims: z.array(z.any()).optional(),
  reverseTestPassed: z.boolean().optional(),
  reverseTestExpired: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = AdvanceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { spinId, toState, ...ctxFields } = parsed.data;
    const ctx: TransitionContext = { ...ctxFields } as TransitionContext;

    const { spin, snapshot } = advanceSPIN(spinId, toState as SPINState, ctx);
    return NextResponse.json({ spin, snapshot, state: spin.state });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const spinId = searchParams.get("spinId");
    if (!spinId) return NextResponse.json({ error: "spinId required" }, { status: 400 });

    const spin = loadSpin(spinId);
    if (!spin) return NextResponse.json({ error: "SPIN not found" }, { status: 404 });

    const ctx: TransitionContext = { actorId: "system", actorRole: "system" };
    const suggested = suggestNextState(spinId, ctx);
    const allowed = (await import("@/lib/spinor/spin-state-machine")).getStateMachine().getAllowedNext(spin.state);

    return NextResponse.json({
      currentState: spin.state,
      allowedNext: allowed,
      suggestedNext: suggested,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
