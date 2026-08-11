import { NextRequest, NextResponse } from "next/server";
import {
  decideAdmissibility,
  deriveInputFromSpin,
  DEFAULT_ADMISSIBILITY_CONFIG,
  AdmissibilityInput,
} from "@/lib/spinor/admissibility";
import { loadAllSpins, loadClaims } from "@/lib/spinor/spin-db";
import { createSPIN, AttributionClaim } from "@/lib/spinor/spin";
import { loadExperiments } from "@/lib/spinor/email-engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/spinor/admissibility?recordId=SPIN-XYZ
 *   Returns the admissibility decision for a stored SPIN record.
 *
 * POST /api/spinor/admissibility
 *   Body: AdmissibilityInput — returns a decision for arbitrary evidence.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const recordId = searchParams.get("recordId");

    if (recordId) {
      const spin = loadAllSpins().find((s) => s.spinId === recordId);
      if (!spin) {
        return NextResponse.json({ error: "Record not found", decision: null }, { status: 404 });
      }
      const claims = loadClaims(recordId);
      const input = deriveInputFromSpin(spin, claims);
      const decision = decideAdmissibility(input);
      return NextResponse.json({ decision, input });
    }

    // No recordId — return decisions for all stored SPINs, falling back to email experiments
    let spins = loadAllSpins();
    let decisions: any[] = [];

    if (spins.length > 0) {
      decisions = spins.map((spin) => {
        const claims = loadClaims(spin.spinId);
        const input = deriveInputFromSpin(spin, claims);
        return decideAdmissibility(input);
      });
    } else {
      // Fallback: derive admissibility decisions from real email experiments
      const experiments = loadExperiments();
      for (const exp of experiments) {
        const input: AdmissibilityInput = {
          recordId: exp.id,
          observationCount: exp.outcome ? 1 : 0,
          hasComparison: !!exp.controlOutcome,
          executionFidelity: exp.outcome ? 1.0 : 0.5,
          preRegistered: exp.status !== "hypothesized",
          hasExplicitTreatmentAndComparison: !!exp.variation && !!exp.controlCondition,
          hasEligibilityCriteria: !!exp.approvedContentVersion,
          hasAssignmentMethod: !!exp.employeeId,
          hasFixedPrimaryMetric: !!exp.outcome,
          hasObservationWindow: !!exp.sendTiming,
          hasFidelityCapture: exp.status !== "hypothesized",
          prohibitedVariableChanged: false,
          complianceApproved: exp.complianceChecked,
          hasUnresolvedCompliance: !exp.complianceChecked,
          claims: exp.outcome ? [{
            claimId: exp.id,
            experimentId: exp.id,
            hypothesisId: exp.hypothesisId,
            outcomeMetric: "email_response",
            outcomeValue: exp.outcome === "qualified_response" ? 1 : exp.outcome === "no_response" ? 0 : 0.5,
            counterfactualEstimate: exp.controlOutcome ? (exp.controlOutcome === "qualified_response" ? 1 : 0) : null,
            causalEffect: null,
            confidence: 0.85,
            method: "rct",
            evidence: [exp.outcome, exp.outcomeDescription || ""],
            segments: [],
            territories: [],
            testedBy: [exp.employeeId],
            falsificationSurvived: false,
            significanceLevel: 0.05,
          }] : [],
          independentReplications: 0,
          experimentCount: 1,
          hasFailureBoundary: !!exp.complianceNotes,
          transferabilityDemonstrated: false,
          economicValueExceedsCost: (exp.profitContribution?.total || 0) > 0,
          hasCompleteContributionLedger: !!exp.outcomeAt,
          unresolvedConfounders: [],
        };
        decisions.push(decideAdmissibility(input));
      }
    }
    return NextResponse.json({ decisions, count: decisions.length });
  } catch (e: any) {
    console.error("[spinor/admissibility] GET error:", e);
    return NextResponse.json({ error: e.message, decision: null }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input: AdmissibilityInput = {
      recordId: body.recordId ?? `REC-${Date.now()}`,
      observationCount: Number(body.observationCount ?? 0),
      hasComparison: !!body.hasComparison,
      executionFidelity: Number(body.executionFidelity ?? 0),
      preRegistered: !!body.preRegistered,
      hasExplicitTreatmentAndComparison: !!body.hasExplicitTreatmentAndComparison,
      hasEligibilityCriteria: !!body.hasEligibilityCriteria,
      hasAssignmentMethod: !!body.hasAssignmentMethod,
      hasFixedPrimaryMetric: !!body.hasFixedPrimaryMetric,
      hasObservationWindow: !!body.hasObservationWindow,
      hasFidelityCapture: !!body.hasFidelityCapture,
      prohibitedVariableChanged: !!body.prohibitedVariableChanged,
      complianceApproved: !!body.complianceApproved,
      hasUnresolvedCompliance: !!body.hasUnresolvedCompliance,
      claims: body.claims ?? [],
      independentReplications: Number(body.independentReplications ?? 0),
      experimentCount: Number(body.experimentCount ?? 1),
      hasFailureBoundary: !!body.hasFailureBoundary,
      transferabilityDemonstrated: !!body.transferabilityDemonstrated,
      economicValueExceedsCost: !!body.economicValueExceedsCost,
      hasCompleteContributionLedger: !!body.hasCompleteContributionLedger,
      unresolvedConfounders: body.unresolvedConfounders ?? [],
    };
    const decision = decideAdmissibility(input);
    return NextResponse.json({ decision });
  } catch (e: any) {
    console.error("[spinor/admissibility] POST error:", e);
    return NextResponse.json({ error: e.message, decision: null }, { status: 500 });
  }
}
