/**
 * SPIN engine — orchestrates the SPIN lifecycle over the persistence layer.
 *
 * This is the bridge between the API routes and the SPIN state machine.
 * It provides high-level operations: create, advance, attribute, replicate,
 * promote, reverse-test, and renew.
 */

import {
  SPIN,
  SPINState,
  AttributionClaim,
  AutomationStatus,
  EvidenceTier,
  ContributionRole,
  createSPIN,
  appendSnapshot,
  addContribution,
  recordModification,
  computeEvidenceTier,
  scheduleReverseTest,
  completeReverseTest,
  verifyChain,
  getContributors,
  spinSummary,
  OS_DEFAULTS,
} from "./spin";
import { SPINStateMachine, TransitionContext, getStateMachine } from "./spin-state-machine";
import {
  saveSpin,
  loadSpin,
  loadAllSpins,
  loadSpinsByState,
  loadSpinsByEmployee,
  saveClaim,
  loadClaims,
  deleteSpin,
  getSpinCount,
  getStateDistribution,
  dbHealth,
} from "./spin-db";
import { getEngineStats } from "./email-engine";

export type {
  SPIN,
  AttributionClaim,
};

export {
  SPINState,
  AutomationStatus,
  EvidenceTier,
  ContributionRole,
  createSPIN,
  computeEvidenceTier,
  scheduleReverseTest,
  completeReverseTest,
  verifyChain,
  getContributors,
  spinSummary,
  saveSpin,
  loadSpin,
  loadAllSpins,
  loadSpinsByState,
  loadSpinsByEmployee,
  saveClaim,
  loadClaims,
  deleteSpin,
  getSpinCount,
  getStateDistribution,
  dbHealth,
  getStateMachine,
  OS_DEFAULTS,
};

// ---------------------------------------------------------------------------
// High-level operations
// ---------------------------------------------------------------------------

export function createNewSPIN(params: {
  hypothesisId: string;
  employeeOwner: string;
  claim: string;
  intervention: string;
  control: string;
  population: string;
  primaryUncertainty: string;
  complianceBoundary: string;
}): SPIN {
  const spin = createSPIN(params);
  saveSpin(spin);
  return spin;
}

export function advanceSPIN(
  spinId: string,
  toState: SPINState,
  ctx: TransitionContext,
): { spin: SPIN; snapshot: ReturnType<typeof appendSnapshot> } {
  const spin = loadSpin(spinId);
  if (!spin) throw new Error(`SPIN not found: ${spinId}`);

  // For transitions that recompute the evidence tier, merge stored claims
  // into the context so claims added via addClaimToSPIN are not lost.
  if ([SPINState.ATTRIBUTED, SPINState.REPLICATED, SPINState.REVALIDATED].includes(toState)) {
    const storedClaims = loadClaims(spinId);
    if (storedClaims.length > 0) {
      const contextClaims = [...(ctx.claims || []), ...(ctx.replicationClaims || [])];
      const seen = new Set(contextClaims.map((c) => c.claimId));
      const merged = [...contextClaims, ...storedClaims.filter((c) => !seen.has(c.claimId))];
      ctx = { ...ctx, claims: merged };
    }
  }

  const sm = getStateMachine();
  const snapshot = sm.transition(spin, toState, ctx);
  saveSpin(spin);
  return { spin, snapshot };
}

export function suggestNextState(spinId: string, ctx: TransitionContext): SPINState | null {
  const spin = loadSpin(spinId);
  if (!spin) return null;
  return getStateMachine().suggestNext(spin, ctx);
}

export function addClaimToSPIN(spinId: string, claim: AttributionClaim): SPIN {
  const spin = loadSpin(spinId);
  if (!spin) throw new Error(`SPIN not found: ${spinId}`);

  spin.claimIds.push(claim.claimId);
  saveClaim(spinId, claim);

  // Recompute evidence tier
  const allClaims = loadClaims(spinId);
  const assessment = computeEvidenceTier(allClaims, spin.requiredReplications);
  spin.evidenceTier = assessment.tier;

  saveSpin(spin);
  return spin;
}

export function addReplicationClaim(spinId: string, claim: AttributionClaim): SPIN {
  const spin = loadSpin(spinId);
  if (!spin) throw new Error(`SPIN not found: ${spinId}`);

  spin.claimIds.push(claim.claimId);
  saveClaim(spinId, claim);

  // Update replication count
  const allClaims = loadClaims(spinId);
  const sigClaims = allClaims.filter(
    (c) => c.falsificationSurvived && c.confidence >= OS_DEFAULTS.CONFIDENCE_THRESHOLD && c.causalEffect !== null,
  );
  spin.replicationCount = sigClaims.length;

  // Recompute evidence tier
  const assessment = computeEvidenceTier(allClaims, spin.requiredReplications);
  spin.evidenceTier = assessment.tier;

  saveSpin(spin);
  return spin;
}

export function runReverseTest(
  spinId: string,
  passed: boolean,
  evidence?: Record<string, unknown>,
): SPIN {
  const spin = loadSpin(spinId);
  if (!spin) throw new Error(`SPIN not found: ${spinId}`);
  if (!spin.reverseTest) throw new Error("No reverse test scheduled for this SPIN");

  completeReverseTest(spin, passed, evidence);
  saveSpin(spin);
  return spin;
}

export function getSPINWithClaims(spinId: string): { spin: SPIN; claims: AttributionClaim[] } | null {
  const spin = loadSpin(spinId);
  if (!spin) return null;
  const claims = loadClaims(spinId);
  return { spin, claims };
}

export function getDashboardStats(): {
  totalSpins: number;
  accounts: number;
  goldenNodes: number;
  activeExperiments: number;
  stateDistribution: Record<string, number>;
  evidenceDistribution: Record<string, number>;
  reverseTestsPending: number;
  chainIntegrityOk: boolean;
} {
  const allSpins = loadAllSpins();
  const stateDist = getStateDistribution();
  const evidenceDist: Record<string, number> = {};
  let reverseTestsPending = 0;
  let chainOk = true;

  for (const spin of allSpins) {
    evidenceDist[spin.evidenceTier] = (evidenceDist[spin.evidenceTier] || 0) + 1;
    if (spin.reverseTest && spin.reverseTest.status === "scheduled") reverseTestsPending++;
    if (!verifyChain(spin)) chainOk = false;
  }

  // Aggregate real data from email engine and golden systems
  const emailStats = { signals: 0, hypotheses: 0, experiments: 0, analyzed: 0, goldenNodes: 0 };
  try {
    const stats = getEngineStats();
    emailStats.signals = stats.signals;
    emailStats.hypotheses = stats.hypotheses;
    emailStats.experiments = stats.experiments;
    emailStats.analyzed = stats.analyzed;
    emailStats.goldenNodes = stats.goldenNodes;
    stateDist.executing = (stateDist.executing || 0) + (stats.experiments - stats.analyzed);
    stateDist.replication_pending = (stateDist.replication_pending || 0) + stats.analyzed - stats.goldenNodes;
    stateDist.replicated = (stateDist.replicated || 0) + stats.goldenNodes;
  } catch (e) {
    console.error("[spin dashboard] email engine error:", e);
  }

  return {
    totalSpins: allSpins.length + emailStats.experiments,
    accounts: emailStats.signals,
    goldenNodes: emailStats.goldenNodes,
    activeExperiments: emailStats.experiments,
    stateDistribution: stateDist,
    evidenceDistribution: evidenceDist,
    reverseTestsPending,
    chainIntegrityOk: chainOk,
  };
}
