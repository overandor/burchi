/**
 * SPIN state machine — formal transition engine for the SPIN lifecycle.
 *
 * 19 states, each transition has:
 *   entry conditions, required evidence, authorized actors,
 *   timeout, failure condition, audit event.
 *
 * The forward journey (DRAFT → REPLICATED) creates an advantage.
 * The reverse journey (GOLDEN_NODE_CANDIDATE → RESEARCH) attacks it.
 *
 * Promotion-triggered reverse falsification is the most distinctive
 * operational mechanism: AUTOMATED/CHANNEL_CANDIDATE automatically
 * schedules an adversarial reverse test.
 */

import {
  SPIN,
  SPINState,
  SPINSnapshot,
  AttributionClaim,
  AutomationStatus,
  EvidenceTier,
  ContributionRole,
  appendSnapshot,
  addContribution,
  scheduleReverseTest,
  computeEvidenceTier,
  OS_DEFAULTS,
} from "./spin";

// ---------------------------------------------------------------------------
// Transition context
// ---------------------------------------------------------------------------

export interface TransitionContext {
  actorId: string;
  actorRole: string;
  claims?: AttributionClaim[];
  automationReady?: boolean;
  automationLayerId?: string;
  mechanism?: string;
  priorArtChecked?: boolean;
  noveltyQualified?: boolean;
  preRegistered?: boolean;
  replicationClaims?: AttributionClaim[];
  reverseTestPassed?: boolean;
  reverseTestExpired?: boolean;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Transition specification
// ---------------------------------------------------------------------------

interface TransitionSpec {
  from: SPINState;
  to: SPINState;
  conditions: ((spin: SPIN, ctx: TransitionContext) => boolean)[];
  requiredEvidence: string;
  authorizedActors: Set<string>;
  timeoutHours?: number;
  failureState?: SPINState;
  auditEvent: string;
}

// ---------------------------------------------------------------------------
// Gate condition predicates
// ---------------------------------------------------------------------------

const hasPriorArt = (_s: SPIN, ctx: TransitionContext) =>
  !!ctx.priorArtChecked;

const hasNovelty = (spin: SPIN, ctx: TransitionContext) =>
  !!ctx.noveltyQualified || !!spin.priorArt.noveltyDelta;

const hasExperiment = (spin: SPIN) => spin.experimentIds.length > 0;
const hasMission = (spin: SPIN) => spin.missionIds.length > 0;
const hasModification = (spin: SPIN) => spin.modifications.length > 0;
const isPreregistered = (_s: SPIN, ctx: TransitionContext) => !!ctx.preRegistered;
const hasOutcome = (_s: SPIN, ctx: TransitionContext) =>
  !!ctx.claims?.some((c) => c.outcomeValue !== null);
const hasAttribution = (_s: SPIN, ctx: TransitionContext) =>
  !!ctx.claims?.length;

const isSignificant = (c: AttributionClaim) =>
  c.falsificationSurvived &&
  c.confidence >= OS_DEFAULTS.CONFIDENCE_THRESHOLD &&
  c.causalEffect !== null &&
  Math.abs(c.causalEffect) > 0;

const hasSignificantClaim = (_s: SPIN, ctx: TransitionContext) =>
  !!ctx.claims?.some(isSignificant);

const hasEnoughReplications = (spin: SPIN, ctx: TransitionContext) => {
  const sig = (ctx.replicationClaims || []).filter(isSignificant);
  return sig.length >= spin.requiredReplications;
};

const automationReady = (spin: SPIN, ctx: TransitionContext) =>
  !!ctx.automationReady || spin.automationStatus !== AutomationStatus.HUMAN_ONLY;

const hasMechanism = (_s: SPIN, ctx: TransitionContext) =>
  !!ctx.mechanism?.trim();

const reverseTestScheduled = (spin: SPIN) =>
  spin.reverseTest !== null && spin.reverseTest.status === "scheduled";

const reverseTestPassed = (spin: SPIN, ctx: TransitionContext) =>
  !!ctx.reverseTestPassed ||
  (spin.reverseTest !== null && spin.reverseTest.status === "passed");

const reverseTestExpired = (spin: SPIN, ctx: TransitionContext) =>
  !!ctx.reverseTestExpired ||
  (spin.reverseTest !== null && spin.reverseTest.status === "expired");

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

const TRANSITIONS: TransitionSpec[] = [
  // DRAFT → PRIOR_ART_CHECKED
  {
    from: SPINState.DRAFT,
    to: SPINState.PRIOR_ART_CHECKED,
    conditions: [hasPriorArt],
    requiredEvidence: "prior-art research must be completed",
    authorizedActors: new Set(["system", "researcher"]),
    auditEvent: "prior_art_checked",
  },
  // PRIOR_ART_CHECKED → NOVELTY_QUALIFIED
  {
    from: SPINState.PRIOR_ART_CHECKED,
    to: SPINState.NOVELTY_QUALIFIED,
    conditions: [hasNovelty],
    requiredEvidence: "novelty delta must be recorded",
    authorizedActors: new Set(["system", "researcher"]),
    auditEvent: "novelty_qualified",
  },
  // NOVELTY_QUALIFIED → ELIGIBLE
  {
    from: SPINState.NOVELTY_QUALIFIED,
    to: SPINState.ELIGIBLE,
    conditions: [(s) => !!s.employeeOwner],
    requiredEvidence: "an eligible employee must be identified",
    authorizedActors: new Set(["system", "manager"]),
    auditEvent: "employee_eligible",
  },
  // ELIGIBLE → ASSIGNED
  {
    from: SPINState.ELIGIBLE,
    to: SPINState.ASSIGNED,
    conditions: [hasMission],
    requiredEvidence: "a mission must be allocated",
    authorizedActors: new Set(["system", "manager"]),
    auditEvent: "mission_assigned",
  },
  // ASSIGNED → HUMAN_MODIFIED
  {
    from: SPINState.ASSIGNED,
    to: SPINState.HUMAN_MODIFIED,
    conditions: [hasModification],
    requiredEvidence: "employee must record a structured modification",
    authorizedActors: new Set(["employee", "field_representative"]),
    auditEvent: "human_modified",
  },
  // ASSIGNED → PREREGISTERED (skip modification)
  {
    from: SPINState.ASSIGNED,
    to: SPINState.PREREGISTERED,
    conditions: [isPreregistered],
    requiredEvidence: "experiment must be pre-registered",
    authorizedActors: new Set(["employee", "system"]),
    auditEvent: "preregistered",
  },
  // HUMAN_MODIFIED → PREREGISTERED
  {
    from: SPINState.HUMAN_MODIFIED,
    to: SPINState.PREREGISTERED,
    conditions: [isPreregistered],
    requiredEvidence: "experiment must be pre-registered after modification",
    authorizedActors: new Set(["employee", "system"]),
    auditEvent: "preregistered",
  },
  // PREREGISTERED → EXECUTING
  {
    from: SPINState.PREREGISTERED,
    to: SPINState.EXECUTING,
    conditions: [hasExperiment],
    requiredEvidence: "experiment must be started",
    authorizedActors: new Set(["employee"]),
    auditEvent: "execution_started",
    timeoutHours: 720,
    failureState: SPINState.RETIRED,
  },
  // EXECUTING → OBSERVED
  {
    from: SPINState.EXECUTING,
    to: SPINState.OBSERVED,
    conditions: [hasOutcome],
    requiredEvidence: "at least one outcome value must be observed",
    authorizedActors: new Set(["employee", "system"]),
    auditEvent: "outcome_observed",
    timeoutHours: 720,
    failureState: SPINState.RETIRED,
  },
  // OBSERVED → ATTRIBUTED
  {
    from: SPINState.OBSERVED,
    to: SPINState.ATTRIBUTED,
    conditions: [hasAttribution, hasSignificantClaim],
    requiredEvidence: "an attribution claim must exist and be significant",
    authorizedActors: new Set(["system", "analyst"]),
    auditEvent: "attribution_computed",
  },
  // ATTRIBUTED → REPLICATION_PENDING
  {
    from: SPINState.ATTRIBUTED,
    to: SPINState.REPLICATION_PENDING,
    conditions: [() => true],
    requiredEvidence: "attribution complete, replication is required",
    authorizedActors: new Set(["system"]),
    auditEvent: "replication_required",
  },
  // REPLICATION_PENDING → REPLICATED
  {
    from: SPINState.REPLICATION_PENDING,
    to: SPINState.REPLICATED,
    conditions: [hasEnoughReplications],
    requiredEvidence: "at least required_replications significant replication claims",
    authorizedActors: new Set(["system", "replication_executor"]),
    auditEvent: "replication_completed",
    timeoutHours: 1440,
    failureState: SPINState.RETIRED,
  },
  // REPLICATED → GOLDEN_NODE_CANDIDATE
  {
    from: SPINState.REPLICATED,
    to: SPINState.GOLDEN_NODE_CANDIDATE,
    conditions: [hasMechanism],
    requiredEvidence: "a validated mechanism must be documented",
    authorizedActors: new Set(["system", "manager"]),
    auditEvent: "golden_node_candidate",
  },
  // GOLDEN_NODE_CANDIDATE → SYSTEMIZATION_PENDING
  {
    from: SPINState.GOLDEN_NODE_CANDIDATE,
    to: SPINState.SYSTEMIZATION_PENDING,
    conditions: [() => true],
    requiredEvidence: "golden node candidate identified, systemization next",
    authorizedActors: new Set(["system", "manager"]),
    auditEvent: "systemization_pending",
  },
  // SYSTEMIZATION_PENDING → AUTOMATED
  {
    from: SPINState.SYSTEMIZATION_PENDING,
    to: SPINState.AUTOMATED,
    conditions: [automationReady],
    requiredEvidence: "automation layer must be ready and tested",
    authorizedActors: new Set(["system_builder", "automation_architect"]),
    auditEvent: "automated",
  },
  // AUTOMATED → CHANNEL_CANDIDATE
  {
    from: SPINState.AUTOMATED,
    to: SPINState.CHANNEL_CANDIDATE,
    conditions: [() => true],
    requiredEvidence: "automated system running, channel viability next",
    authorizedActors: new Set(["system", "channel_founder"]),
    auditEvent: "channel_candidate",
  },
  // CHANNEL_CANDIDATE → REVERSE_TEST_REQUIRED
  {
    from: SPINState.CHANNEL_CANDIDATE,
    to: SPINState.REVERSE_TEST_REQUIRED,
    conditions: [() => true],
    requiredEvidence: "promotion triggers compulsory reverse falsification",
    authorizedActors: new Set(["system"]),
    auditEvent: "reverse_test_required",
  },
  // AUTOMATED → REVERSE_TEST_REQUIRED (if channel not pursued)
  {
    from: SPINState.AUTOMATED,
    to: SPINState.REVERSE_TEST_REQUIRED,
    conditions: [() => true],
    requiredEvidence: "automation deployment triggers compulsory reverse test",
    authorizedActors: new Set(["system"]),
    auditEvent: "reverse_test_required",
  },
  // REVERSE_TEST_REQUIRED → ADVERSARIAL_EXECUTION
  {
    from: SPINState.REVERSE_TEST_REQUIRED,
    to: SPINState.ADVERSARIAL_EXECUTION,
    conditions: [reverseTestScheduled],
    requiredEvidence: "reverse test must be scheduled with failure conditions",
    authorizedActors: new Set(["system", "adversarial_tester"]),
    auditEvent: "adversarial_execution_started",
    timeoutHours: 720,
    failureState: SPINState.ROLLED_BACK,
  },
  // ADVERSARIAL_EXECUTION → REVALIDATED
  {
    from: SPINState.ADVERSARIAL_EXECUTION,
    to: SPINState.REVALIDATED,
    conditions: [reverseTestPassed],
    requiredEvidence: "reverse test must pass",
    authorizedActors: new Set(["adversarial_tester", "system"]),
    auditEvent: "revalidated",
  },
  // ADVERSARIAL_EXECUTION → NARROWED
  {
    from: SPINState.ADVERSARIAL_EXECUTION,
    to: SPINState.NARROWED,
    conditions: [(s, ctx) => !reverseTestPassed(s, ctx)],
    requiredEvidence: "reverse test failed — effect narrowed",
    authorizedActors: new Set(["adversarial_tester", "system"]),
    auditEvent: "narrowed",
  },
  // ADVERSARIAL_EXECUTION → ROLLED_BACK
  {
    from: SPINState.ADVERSARIAL_EXECUTION,
    to: SPINState.ROLLED_BACK,
    conditions: [reverseTestExpired],
    requiredEvidence: "reverse test expired or failed completely",
    authorizedActors: new Set(["system"]),
    auditEvent: "rolled_back",
  },
  // Terminal → RESEARCH (renewal)
  ...([SPINState.REVALIDATED, SPINState.NARROWED, SPINState.ROLLED_BACK, SPINState.RETIRED] as SPINState[]).map((from) => ({
    from,
    to: SPINState.RESEARCH,
    conditions: [() => true],
    requiredEvidence: "evidence feeds new research questions",
    authorizedActors: new Set(["system"]),
    auditEvent: "research_renewal",
  })),
  // RESEARCH → DRAFT (new cycle)
  {
    from: SPINState.RESEARCH,
    to: SPINState.DRAFT,
    conditions: [() => true],
    requiredEvidence: "new research cycle, new hypothesis draft",
    authorizedActors: new Set(["system", "researcher"]),
    auditEvent: "new_cycle",
  },
];

// Build lookup map
const transitionMap = new Map<string, TransitionSpec>();
for (const t of TRANSITIONS) {
  transitionMap.set(`${t.from}:${t.to}`, t);
}

// Add manual retirement from any state
for (const state of Object.values(SPINState)) {
  if (state === SPINState.RETIRED || state === SPINState.RESEARCH || state === SPINState.REVALIDATED) continue;
  const key = `${state}:${SPINState.RETIRED}`;
  if (!transitionMap.has(key)) {
    transitionMap.set(key, {
      from: state,
      to: SPINState.RETIRED,
      conditions: [() => true],
      requiredEvidence: "manual retirement",
      authorizedActors: new Set(["manager", "compliance"]),
      auditEvent: "retired",
    });
  }
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export class SPINStateMachine {
  private retestIntervalDays: number;

  constructor(retestIntervalDays: number = OS_DEFAULTS.RETEST_INTERVAL_DAYS) {
    this.retestIntervalDays = retestIntervalDays;
  }

  getAllowedNext(current: SPINState): SPINState[] {
    const result: SPINState[] = [];
    for (const [key, spec] of transitionMap) {
      if (spec.from === current) {
        result.push(spec.to);
      }
    }
    return result.sort((a, b) => a.localeCompare(b));
  }

  canTransition(spin: SPIN, to: SPINState, ctx: TransitionContext): { ok: boolean; reason: string } {
    const spec = transitionMap.get(`${spin.state}:${to}`);
    if (!spec) {
      return { ok: false, reason: `no transition defined from ${spin.state} to ${to}` };
    }

    if (ctx.actorRole && spec.authorizedActors.size > 0 && !spec.authorizedActors.has(ctx.actorRole)) {
      return { ok: false, reason: `actor role '${ctx.actorRole}' not authorized (requires one of ${[...spec.authorizedActors].join(", ")})` };
    }

    if (spec.timeoutHours) {
      const elapsedHours = (Date.now() - new Date(spin.updatedAt).getTime()) / 3_600_000;
      if (elapsedHours > spec.timeoutHours) {
        if (spec.failureState) {
          return { ok: false, reason: `timeout exceeded (${spec.timeoutHours}h) — should transition to ${spec.failureState}` };
        }
        return { ok: false, reason: `timeout exceeded (${spec.timeoutHours}h)` };
      }
    }

    for (let i = 0; i < spec.conditions.length; i++) {
      try {
        if (!spec.conditions[i](spin, ctx)) {
          return { ok: false, reason: `entry condition ${i + 1} failed: ${spec.requiredEvidence}` };
        }
      } catch (e) {
        return { ok: false, reason: `entry condition ${i + 1} raised: ${e}` };
      }
    }

    return { ok: true, reason: "ok" };
  }

  transition(spin: SPIN, to: SPINState, ctx: TransitionContext): SPINSnapshot {
    const { ok, reason } = this.canTransition(spin, to, ctx);
    if (!ok) throw new Error(`SPIN transition error: ${reason}`);

    const spec = transitionMap.get(`${spin.state}:${to}`)!;

    // Side effects
    if (to === SPINState.REVERSE_TEST_REQUIRED) {
      scheduleReverseTest(spin, this.retestIntervalDays);
    }

    if (to === SPINState.AUTOMATED) {
      spin.automationStatus = AutomationStatus.SUPERVISED_AUTOMATION;
      if (ctx.automationLayerId) spin.automationLayerId = ctx.automationLayerId;
    }

    if (to === SPINState.REPLICATED) {
      spin.replicationCount = (ctx.replicationClaims || []).filter(isSignificant).length;
    }

    // Update evidence tier
    if ([SPINState.ATTRIBUTED, SPINState.REPLICATED, SPINState.REVALIDATED].includes(to)) {
      const allClaims = [...(ctx.claims || []), ...(ctx.replicationClaims || [])];
      const assessment = computeEvidenceTier(allClaims, spin.requiredReplications);
      spin.evidenceTier = assessment.tier;
    }

    // Record contribution
    if (ctx.actorId) {
      const roleMap: Record<string, ContributionRole> = {
        employee: ContributionRole.MISSION_EXECUTOR,
        field_representative: ContributionRole.MISSION_EXECUTOR,
        system_builder: ContributionRole.SYSTEM_BUILDER,
        automation_architect: ContributionRole.AUTOMATION_ARCHITECT,
        adversarial_tester: ContributionRole.ADVERSARIAL_TESTER,
        channel_founder: ContributionRole.CHANNEL_FOUNDER,
        researcher: ContributionRole.HYPOTHESIS_AUTHOR,
        replication_executor: ContributionRole.REPLICATION_EXECUTOR,
      };
      addContribution(spin, ctx.actorId, roleMap[ctx.actorRole] || ContributionRole.REVIEWER, `Transition: ${spin.state} → ${to}. ${spec.requiredEvidence}`);
    }

    return appendSnapshot(spin, to, ctx.actorId || "system", ctx.actorRole || "system", spec.requiredEvidence, {
      auditEvent: spec.auditEvent,
      fromState: spin.state,
      toState: to,
    });
  }

  suggestNext(spin: SPIN, ctx: TransitionContext): SPINState | null {
    const allowed = this.getAllowedNext(spin.state);
    for (const target of allowed) {
      const { ok } = this.canTransition(spin, target, ctx);
      if (ok) return target;
    }
    return null;
  }

  checkTimeouts(spin: SPIN): SPINState | null {
    for (const [key, spec] of transitionMap) {
      if (spec.from !== spin.state) continue;
      if (!spec.timeoutHours) continue;
      const elapsedHours = (Date.now() - new Date(spin.updatedAt).getTime()) / 3_600_000;
      if (elapsedHours > spec.timeoutHours && spec.failureState) {
        return spec.failureState;
      }
    }
    return null;
  }
}

// Singleton
let _machine: SPINStateMachine | null = null;
export function getStateMachine(): SPINStateMachine {
  if (!_machine) _machine = new SPINStateMachine();
  return _machine;
}
