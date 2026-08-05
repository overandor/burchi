import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  listProposals,
  getProposalById,
  proposeRecombination,
  validateProposal,
  deployProposal,
  rejectProposal,
  findEvolutionCandidates,
  decomposeStrategy,
} from "@/lib/strategy/evolution";

const RecombineSchema = z.object({
  parentStrategyIds: z.array(z.string()).min(1),
  rationale: z.string().min(1),
  expectedImprovement: z.string().min(1),
});

const ActionSchema = z.object({
  action: z.enum(["validate", "deploy", "reject"]),
  proposalId: z.string().min(1),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const candidates = searchParams.get("candidates") === "true";
    const decompose = searchParams.get("decompose");
    const id = searchParams.get("id");

    if (candidates) {
      const result = findEvolutionCandidates();
      return NextResponse.json({ candidates: result, count: result.length });
    }

    if (decompose) {
      const components = decomposeStrategy(decompose);
      return NextResponse.json({ components, count: components.length });
    }

    if (id) {
      const proposal = getProposalById(id);
      if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
      return NextResponse.json(proposal);
    }

    const proposals = listProposals();
    return NextResponse.json({ proposals, count: proposals.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Check if this is a recombination proposal or an action on existing proposal
    if (body.action && body.proposalId) {
      const parsed = ActionSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      const { action, proposalId } = parsed.data;
      let result;
      switch (action) {
        case "validate":
          result = validateProposal(proposalId);
          break;
        case "deploy":
          result = deployProposal(proposalId);
          break;
        case "reject":
          result = rejectProposal(proposalId);
          break;
      }

      if (!result) {
        return NextResponse.json({ error: "Proposal not found or invalid state for action" }, { status: 404 });
      }

      return NextResponse.json({ result });
    }

    // Otherwise, it's a recombination proposal
    const parsed = RecombineSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const proposal = proposeRecombination(
      parsed.data.parentStrategyIds,
      parsed.data.rationale,
      parsed.data.expectedImprovement
    );

    return NextResponse.json({ proposal });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
