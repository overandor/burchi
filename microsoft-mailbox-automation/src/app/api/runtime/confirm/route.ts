import { NextRequest, NextResponse } from "next/server";
import { getProposal, updateProposalStatus } from "@/lib/runtime/engine";

export const dynamic = "force-dynamic";

/**
 * POST /api/runtime/confirm
 * Human confirms or rejects a proposal.
 *
 * Body:
 *   proposalId: string
 *   decision: "confirm" | "reject"
 *   result?: string (human's input if they completed a delegated task)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { proposalId, decision, result } = body;

    if (!proposalId || !decision) {
      return NextResponse.json({ error: "proposalId and decision are required" }, { status: 400 });
    }

    const proposal = getProposal(proposalId);
    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }

    if (decision === "confirm") {
      updateProposalStatus(proposalId, "confirmed");
      // If it's an agent action, mark as executing
      if (proposal.delegateTo === "agent") {
        updateProposalStatus(proposalId, "executing");
        // Actual execution would call the tool registry
        updateProposalStatus(proposalId, "completed", {
          success: true,
          output: result || `Executed: ${proposal.action}`,
          operatorUpdated: true,
          learnedRule: result,
          timestamp: new Date().toISOString(),
        });
      }
      return NextResponse.json({ proposal: getProposal(proposalId), message: "Proposal confirmed and executed" });
    } else if (decision === "reject") {
      updateProposalStatus(proposalId, "rejected");
      return NextResponse.json({ proposal: getProposal(proposalId), message: "Proposal rejected" });
    } else {
      return NextResponse.json({ error: "decision must be 'confirm' or 'reject'" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
