import { NextRequest, NextResponse } from "next/server";
import {
  loadHypotheses,
  loadHypothesisOutcomes,
  loadHypothesisAttributions,
  loadHypothesisAssignments,
  loadGoldenNodes,
  loadDerivatives,
  loadPriorArt,
} from "@/lib/config";
import { ensureFullDemoSeeded } from "@/lib/golden/demo-seed";
import { loadAllSpins } from "@/lib/spinor/spin-db";

export const dynamic = "force-dynamic";

/**
 * GET /api/trajectory
 *
 * Returns the full research development trajectory — the defensive,
 * hard-to-replicate chain that shows how each hypothesis evolved from
 * initial prior-art check through execution, attribution, golden node
 * identification, and derivative generation.
 *
 * This is the proprietary moat: the trajectory itself is the IP.
 */
export async function GET(req: NextRequest) {
  try {
    ensureFullDemoSeeded();

    const hypotheses = loadHypotheses();
    const outcomes = loadHypothesisOutcomes();
    const attributions = loadHypothesisAttributions();
    const assignments = loadHypothesisAssignments();
    const goldenNodes = loadGoldenNodes();
    const derivatives = loadDerivatives();
    const priorArt = loadPriorArt();
    let spins: any[] = [];
    try { spins = loadAllSpins(); } catch { /* spin db may not be ready */ }

    // Build trajectory entries — one per hypothesis, enriched with
    // its full lineage: prior art → assignment → outcome → attribution
    // → golden node → derivatives → SPIN
    const trajectory = hypotheses.map((h) => {
      const hOutcomes = outcomes.filter((o) => o.hypothesisId === h.id);
      const hAttributions = attributions.filter((a) => a.hypothesisId === h.id);
      const hAssignments = assignments.filter((a) => a.hypothesisId === h.id);
      const hDerivatives = derivatives.filter((d) => d.parentHypothesisId === h.id);
      const hPriorArt = priorArt.filter((p) => p.hypothesisClaim === h.claim);
      const hSpins = spins.filter((s: any) => s.hypothesisId === h.id);

      const successfulOutcomes = hOutcomes.filter((o) => !o.falsified);
      const falsifiedOutcomes = hOutcomes.filter((o) => o.falsified);
      const hGoldenNodes = goldenNodes.filter((gn: any) => gn.hypothesisId === h.id);

      // Compute trajectory stage
      let stage: "prior_art" | "assigned" | "executing" | "observed" | "attributed" | "golden" | "replicated" | "capitalized" = "prior_art";
      if (hGoldenNodes.length > 0) stage = "golden";
      else if (hAttributions.length > 0) stage = "attributed";
      else if (hOutcomes.length > 0) stage = "observed";
      else if (hAssignments.length > 0) stage = "assigned";

      // Compute defensibility score — how hard is this trajectory to replicate?
      const priorArtCount = hPriorArt.length;
      const outcomeCount = hOutcomes.length;
      const attributionCount = hAttributions.length;
      const derivativeCount = hDerivatives.length;
      const spinCount = hSpins.length;
      const goldenNodeCount = hGoldenNodes.length;
      const replicationCount = hGoldenNodes.reduce((sum: number, gn: any) => sum + (gn.replicationCount || 0), 0);

      // Defensibility = weighted sum of trajectory depth
      const defensibility = Math.min(
        100,
        priorArtCount * 5 +
        outcomeCount * 15 +
        attributionCount * 20 +
        derivativeCount * 10 +
        spinCount * 15 +
        goldenNodeCount * 25 +
        replicationCount * 10,
      );

      // Build the lineage chain (the defensive moat)
      const lineage: Array<{
        step: string;
        timestamp: string;
        actor: string;
        detail: string;
        evidenceType: string;
      }> = [];

      for (const pa of hPriorArt) {
        lineage.push({
          step: "Prior Art Check",
          timestamp: pa.researchedAt || "",
          actor: "system",
          detail: `Evidence: ${pa.evidenceState} — ${pa.adjacentSupportSummary?.slice(0, 100) || "no adjacent support"}`,
          evidenceType: "prior_art",
        });
      }

      for (const a of hAssignments) {
        lineage.push({
          step: "Assignment",
          timestamp: a.assignedAt || "",
          actor: a.employeeId || "system",
          detail: `Assigned to ${a.employeeId} — state: ${a.state}`,
          evidenceType: "assignment",
        });
      }

      for (const o of hOutcomes) {
        lineage.push({
          step: o.falsified ? "Falsification" : "Outcome Observed",
          timestamp: o.observedAt || "",
          actor: o.employeeId || "system",
          detail: o.outcomeDescription?.slice(0, 120) || "",
          evidenceType: o.falsified ? "falsification" : "outcome",
        });
      }

      for (const a of hAttributions) {
        lineage.push({
          step: "Causal Attribution",
          timestamp: a.attributedAt || "",
          actor: "attribution_engine",
          detail: `Method: ${a.method} — responsible: ${a.responsibleFactor} — unexplained variance: ${a.unexplainedVariance?.toFixed(2) || "N/A"}`,
          evidenceType: "attribution",
        });
      }

      for (const d of hDerivatives) {
        lineage.push({
          step: "Derivative Proposed",
          timestamp: d.createdAt || "",
          actor: d.origin || "system",
          detail: `${d.modifiedDimension?.replace(/_/g, " ")}: ${d.claim?.slice(0, 100) || ""}`,
          evidenceType: "derivative",
        });
      }

      for (const gn of hGoldenNodes) {
        lineage.push({
          step: "Golden Node Identified",
          timestamp: gn.createdAt || gn.promotedAt || "",
          actor: "golden_node_engine",
          detail: `Stage: ${gn.stage} — Replications: ${gn.replicationCount || 0} — Economic value: $${gn.economicValue || 0}`,
          evidenceType: "golden_node",
        });
      }

      for (const s of hSpins) {
        lineage.push({
          step: `SPIN ${s.state || "created"}`,
          timestamp: s.createdAt || s.updatedAt || "",
          actor: "spin_engine",
          detail: `SPIN ${s.spinId} — state: ${s.state}`,
          evidenceType: "spin",
        });
      }

      // Sort lineage by timestamp
      lineage.sort((a, b) => {
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      });

      return {
        hypothesisId: h.id,
        hypothesisClaim: h.claim || "",
        population: h.targetCondition || "",
        intervention: h.intervention || "",
        control: h.control || "",
        outcome: h.primaryOutcome || "",
        stage,
        defensibility,
        lineage,
        stats: {
          priorArt: priorArtCount,
          assignments: hAssignments.length,
          outcomes: outcomeCount,
          successful: successfulOutcomes.length,
          falsified: falsifiedOutcomes.length,
          attributions: attributionCount,
          derivatives: derivativeCount,
          goldenNodes: goldenNodeCount,
          replications: replicationCount,
          spins: spinCount,
        },
      };
    });

    // Sort by defensibility (highest first)
    trajectory.sort((a, b) => b.defensibility - a.defensibility);

    // Compute aggregate stats
    const aggregate = {
      totalHypotheses: hypotheses.length,
      totalOutcomes: outcomes.length,
      totalAttributions: attributions.length,
      totalDerivatives: derivatives.length,
      totalGoldenNodes: goldenNodes.length,
      totalSpins: spins.length,
      totalPriorArt: priorArt.length,
      avgDefensibility: trajectory.length > 0
        ? Math.round(trajectory.reduce((sum, t) => sum + t.defensibility, 0) / trajectory.length)
        : 0,
      maxDefensibility: trajectory.length > 0 ? Math.max(...trajectory.map((t) => t.defensibility)) : 0,
      stageDistribution: {
        prior_art: trajectory.filter((t) => t.stage === "prior_art").length,
        assigned: trajectory.filter((t) => t.stage === "assigned").length,
        observed: trajectory.filter((t) => t.stage === "observed").length,
        attributed: trajectory.filter((t) => t.stage === "attributed").length,
        golden: trajectory.filter((t) => t.stage === "golden").length,
      },
    };

    return NextResponse.json({
      trajectory,
      aggregate,
      generatedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("[trajectory] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
