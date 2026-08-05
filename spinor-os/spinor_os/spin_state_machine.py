"""SPIN state machine — formal transition engine for the SPIN lifecycle.

This is the executable state machine that turns "palindromic" from
branding into software behavior.  Every transition has:

    entry conditions
    required evidence
    authorized actor
    permitted mutations
    timeout
    failure condition
    audit event
    rollback state

The state machine is distinct from the existing
:class:`~spinor_os.workflow.ExperimentGovernanceWorkflow` because it
operates at the *organizational* level (tracking the SPIN across
experiments, replications, and deployments) rather than the
*experiment-internal* level (tracking one experiment through its
canonical loop).

States
------
The 19 states are defined in :class:`~spinor_os.spin.SPINState`.
They form a directed graph where the forward journey (DRAFT →
REPLICATED) creates an advantage and the reverse journey
(GOLDEN_NODE_CANDIDATE → RESEARCH) attacks, generalizes, and
renews it.

Transitions
-----------
Each transition is defined as a :class:`TransitionSpec` with formal
gate conditions.  The :class:`SPINStateMachine` enforces these gates
and produces audit events.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from spinor_os.config import OSDefaults, get_logger
from spinor_os.evidence_tiers import EvidenceTier, compute_evidence_tier
from spinor_os.models import AttributionClaim
from spinor_os.spin import (
    AutomationStatus,
    ContributionRole,
    ReverseTestSpec,
    SPIN,
    SPINState,
    SPINSnapshot,
)

LOG = get_logger("spinor_os.spin_state_machine")


# ---------------------------------------------------------------------------
# Transition specification
# ---------------------------------------------------------------------------


@dataclass
class TransitionSpec:
    """Formal specification of one state transition.

    Every field corresponds to a requirement from the manifesto:

    * ``from_state``: the source state
    * ``to_state``: the target state
    * ``entry_conditions``: predicates that must all be True
    * ``required_evidence``: human-readable description of what evidence is needed
    * ``authorized_actors``: set of actor roles permitted to trigger this transition
    * ``timeout_hours``: if set, the transition auto-fails after this duration in the source state
    * ``failure_condition``: what happens if the transition fails (rollback state)
    * ``audit_event_type``: the event type recorded in the snapshot
    """

    from_state: SPINState
    to_state: SPINState
    entry_conditions: list[Callable[[SPIN, "TransitionContext"], bool]] = field(default_factory=list)
    required_evidence: str = ""
    authorized_actors: set[str] = field(default_factory=set)
    timeout_hours: float | None = None
    failure_condition: SPINState | None = None
    audit_event_type: str = ""

    def check_conditions(self, spin: SPIN, ctx: "TransitionContext") -> tuple[bool, str]:
        """Check all entry conditions.  Returns (ok, reason)."""
        for i, cond in enumerate(self.entry_conditions):
            try:
                if not cond(spin, ctx):
                    return False, f"entry condition {i + 1} failed: {self.required_evidence}"
            except Exception as exc:
                return False, f"entry condition {i + 1} raised: {exc}"
        return True, "ok"


@dataclass
class TransitionContext:
    """Context passed to transition gate conditions.

    This carries the runtime data needed to evaluate whether a
    transition is permitted — claims, employee ID, automation status,
    etc.
    """

    actor_id: str = ""
    actor_role: str = ""
    claims: list[AttributionClaim] = field(default_factory=list)
    automation_ready: bool = False
    automation_layer_id: str | None = None
    mechanism: str = ""
    prior_art_checked: bool = False
    novelty_qualified: bool = False
    pre_registered: bool = False
    replication_claims: list[AttributionClaim] = field(default_factory=list)
    reverse_test_passed: bool = False
    reverse_test_expired: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Gate condition predicates
# ---------------------------------------------------------------------------


def _has_prior_art(spin: SPIN, ctx: TransitionContext) -> bool:
    return ctx.prior_art_checked or spin.prior_art.tested_in_market or bool(spin.prior_art.source_domains)


def _has_novelty(spin: SPIN, ctx: TransitionContext) -> bool:
    return ctx.novelty_qualified or bool(spin.prior_art.novelty_delta)


def _has_experiment(spin: SPIN, ctx: TransitionContext) -> bool:
    return len(spin.experiment_ids) > 0


def _has_mission(spin: SPIN, ctx: TransitionContext) -> bool:
    return len(spin.mission_ids) > 0


def _has_modification(spin: SPIN, ctx: TransitionContext) -> bool:
    return len(spin.modifications) > 0


def _is_preregistered(spin: SPIN, ctx: TransitionContext) -> bool:
    return ctx.pre_registered


def _has_outcome(spin: SPIN, ctx: TransitionContext) -> bool:
    return any(c.outcome_value is not None for c in ctx.claims)


def _has_attribution(spin: SPIN, ctx: TransitionContext) -> bool:
    return len(ctx.claims) > 0


def _has_significant_claim(spin: SPIN, ctx: TransitionContext) -> bool:
    return any(c.is_significant() for c in ctx.claims)


def _has_enough_replications(spin: SPIN, ctx: TransitionContext) -> bool:
    sig = [c for c in ctx.replication_claims if c.is_significant()]
    return len(sig) >= spin.required_replications


def _automation_ready(spin: SPIN, ctx: TransitionContext) -> bool:
    return ctx.automation_ready or spin.automation_status != AutomationStatus.HUMAN_ONLY


def _has_mechanism(spin: SPIN, ctx: TransitionContext) -> bool:
    return bool(ctx.mechanism and ctx.mechanism.strip())


def _reverse_test_required(spin: SPIN, ctx: TransitionContext) -> bool:
    """Reverse test is required when reaching AUTOMATED or CHANNEL_CANDIDATE."""
    return spin.state in (SPINState.AUTOMATED, SPINState.CHANNEL_CANDIDATE)


def _reverse_test_scheduled(spin: SPIN, ctx: TransitionContext) -> bool:
    return spin.reverse_test is not None and spin.reverse_test.status == "scheduled"


def _reverse_test_passed(spin: SPIN, ctx: TransitionContext) -> bool:
    return ctx.reverse_test_passed or (
        spin.reverse_test is not None and spin.reverse_test.status == "passed"
    )


def _reverse_test_expired(spin: SPIN, ctx: TransitionContext) -> bool:
    return ctx.reverse_test_expired or (
        spin.reverse_test is not None and spin.reverse_test.is_expired()
    )


# ---------------------------------------------------------------------------
# The state machine
# ---------------------------------------------------------------------------


class SPINTransitionError(ValueError):
    """Raised when an illegal or ungated SPIN transition is requested."""


class SPINStateMachine:
    """Formal state machine governing SPIN lifecycle transitions.

    The machine defines all legal transitions, their gate conditions,
    authorized actors, timeouts, and rollback states.  It produces
    audit events as snapshots in the SPIN's chain.
    """

    def __init__(self, retest_interval_days: int = OSDefaults.RETEST_INTERVAL_DAYS):
        self.retest_interval_days = max(1, retest_interval_days)
        self._transitions: dict[tuple[SPINState, SPINState], TransitionSpec] = {}
        self._build_transitions()

    # ------------------------------------------------------------------
    # Transition table
    # ------------------------------------------------------------------

    def _build_transitions(self) -> None:
        """Define all legal transitions with their gate conditions."""

        # DRAFT → PRIOR_ART_CHECKED
        self._add(TransitionSpec(
            from_state=SPINState.DRAFT,
            to_state=SPINState.PRIOR_ART_CHECKED,
            entry_conditions=[_has_prior_art],
            required_evidence="prior-art research must be completed",
            authorized_actors={"system", "researcher"},
            audit_event_type="prior_art_checked",
        ))

        # PRIOR_ART_CHECKED → NOVELTY_QUALIFIED
        self._add(TransitionSpec(
            from_state=SPINState.PRIOR_ART_CHECKED,
            to_state=SPINState.NOVELTY_QUALIFIED,
            entry_conditions=[_has_novelty],
            required_evidence="novelty delta must be recorded (what is new vs prior art)",
            authorized_actors={"system", "researcher"},
            audit_event_type="novelty_qualified",
        ))

        # NOVELTY_QUALIFIED → ELIGIBLE
        self._add(TransitionSpec(
            from_state=SPINState.NOVELTY_QUALIFIED,
            to_state=SPINState.ELIGIBLE,
            entry_conditions=[lambda s, c: bool(s.employee_owner)],
            required_evidence="an eligible employee must be identified as owner",
            authorized_actors={"system", "manager"},
            audit_event_type="employee_eligible",
        ))

        # ELIGIBLE → ASSIGNED
        self._add(TransitionSpec(
            from_state=SPINState.ELIGIBLE,
            to_state=SPINState.ASSIGNED,
            entry_conditions=[_has_mission],
            required_evidence="a mission must be allocated to the employee",
            authorized_actors={"system", "manager"},
            audit_event_type="mission_assigned",
        ))

        # ASSIGNED → HUMAN_MODIFIED
        self._add(TransitionSpec(
            from_state=SPINState.ASSIGNED,
            to_state=SPINState.HUMAN_MODIFIED,
            entry_conditions=[_has_modification],
            required_evidence="employee must record a structured modification to the hypothesis",
            authorized_actors={"employee", "field_representative"},
            audit_event_type="human_modified",
        ))

        # ASSIGNED → PREREGISTERED (skip modification — employee accepts as-is)
        self._add(TransitionSpec(
            from_state=SPINState.ASSIGNED,
            to_state=SPINState.PREREGISTERED,
            entry_conditions=[_is_preregistered],
            required_evidence="experiment must be pre-registered with success/failure conditions",
            authorized_actors={"employee", "system"},
            audit_event_type="preregistered",
        ))

        # HUMAN_MODIFIED → PREREGISTERED
        self._add(TransitionSpec(
            from_state=SPINState.HUMAN_MODIFIED,
            to_state=SPINState.PREREGISTERED,
            entry_conditions=[_is_preregistered],
            required_evidence="experiment must be pre-registered after human modification",
            authorized_actors={"employee", "system"},
            audit_event_type="preregistered",
        ))

        # PREREGISTERED → EXECUTING
        self._add(TransitionSpec(
            from_state=SPINState.PREREGISTERED,
            to_state=SPINState.EXECUTING,
            entry_conditions=[_has_experiment],
            required_evidence="experiment must be started (has at least one execution event)",
            authorized_actors={"employee"},
            audit_event_type="execution_started",
            timeout_hours=720,  # 30 days
            failure_condition=SPINState.RETIRED,
        ))

        # EXECUTING → OBSERVED
        self._add(TransitionSpec(
            from_state=SPINState.EXECUTING,
            to_state=SPINState.OBSERVED,
            entry_conditions=[_has_outcome],
            required_evidence="at least one outcome value must be observed",
            authorized_actors={"employee", "system"},
            audit_event_type="outcome_observed",
            timeout_hours=720,  # 30 days to observe an outcome
            failure_condition=SPINState.RETIRED,
        ))

        # OBSERVED → ATTRIBUTED
        self._add(TransitionSpec(
            from_state=SPINState.OBSERVED,
            to_state=SPINState.ATTRIBUTED,
            entry_conditions=[_has_attribution, _has_significant_claim],
            required_evidence="an attribution claim must exist and be significant",
            authorized_actors={"system", "analyst"},
            audit_event_type="attribution_computed",
        ))

        # ATTRIBUTED → REPLICATION_PENDING
        self._add(TransitionSpec(
            from_state=SPINState.ATTRIBUTED,
            to_state=SPINState.REPLICATION_PENDING,
            entry_conditions=[lambda s, c: True],  # always proceed to replication
            required_evidence="attribution complete, replication is now required",
            authorized_actors={"system"},
            audit_event_type="replication_required",
        ))

        # REPLICATION_PENDING → REPLICATED
        self._add(TransitionSpec(
            from_state=SPINState.REPLICATION_PENDING,
            to_state=SPINState.REPLICATED,
            entry_conditions=[_has_enough_replications],
            required_evidence=f"at least required_replications significant replication claims",
            authorized_actors={"system", "replication_executor"},
            audit_event_type="replication_completed",
            timeout_hours=1440,  # 60 days
            failure_condition=SPINState.RETIRED,
        ))

        # REPLICATED → GOLDEN_NODE_CANDIDATE
        self._add(TransitionSpec(
            from_state=SPINState.REPLICATED,
            to_state=SPINState.GOLDEN_NODE_CANDIDATE,
            entry_conditions=[_has_mechanism],
            required_evidence="a validated mechanism must be documented",
            authorized_actors={"system", "manager"},
            audit_event_type="golden_node_candidate",
        ))

        # GOLDEN_NODE_CANDIDATE → SYSTEMIZATION_PENDING
        self._add(TransitionSpec(
            from_state=SPINState.GOLDEN_NODE_CANDIDATE,
            to_state=SPINState.SYSTEMIZATION_PENDING,
            entry_conditions=[lambda s, c: True],
            required_evidence="golden node candidate identified, systemization is next",
            authorized_actors={"system", "manager"},
            audit_event_type="systemization_pending",
        ))

        # SYSTEMIZATION_PENDING → AUTOMATED
        self._add(TransitionSpec(
            from_state=SPINState.SYSTEMIZATION_PENDING,
            to_state=SPINState.AUTOMATED,
            entry_conditions=[_automation_ready],
            required_evidence="automation layer must be ready and tested",
            authorized_actors={"system_builder", "automation_architect"},
            audit_event_type="automated",
        ))

        # AUTOMATED → CHANNEL_CANDIDATE
        self._add(TransitionSpec(
            from_state=SPINState.AUTOMATED,
            to_state=SPINState.CHANNEL_CANDIDATE,
            entry_conditions=[lambda s, c: True],
            required_evidence="automated system running, channel viability assessment next",
            authorized_actors={"system", "channel_founder"},
            audit_event_type="channel_candidate",
        ))

        # CHANNEL_CANDIDATE → REVERSE_TEST_REQUIRED
        # AUTOMATED → REVERSE_TEST_REQUIRED (if channel not pursued)
        self._add(TransitionSpec(
            from_state=SPINState.CHANNEL_CANDIDATE,
            to_state=SPINState.REVERSE_TEST_REQUIRED,
            entry_conditions=[_reverse_test_required],
            required_evidence="promotion triggers compulsory reverse falsification",
            authorized_actors={"system"},
            audit_event_type="reverse_test_required",
        ))

        self._add(TransitionSpec(
            from_state=SPINState.AUTOMATED,
            to_state=SPINState.REVERSE_TEST_REQUIRED,
            entry_conditions=[_reverse_test_required],
            required_evidence="automation deployment triggers compulsory reverse test",
            authorized_actors={"system"},
            audit_event_type="reverse_test_required",
        ))

        # REVERSE_TEST_REQUIRED → ADVERSARIAL_EXECUTION
        self._add(TransitionSpec(
            from_state=SPINState.REVERSE_TEST_REQUIRED,
            to_state=SPINState.ADVERSARIAL_EXECUTION,
            entry_conditions=[_reverse_test_scheduled],
            required_evidence="reverse test must be scheduled with failure conditions",
            authorized_actors={"system", "adversarial_tester"},
            audit_event_type="adversarial_execution_started",
            timeout_hours=720,  # 30 days
            failure_condition=SPINState.ROLLED_BACK,
        ))

        # ADVERSARIAL_EXECUTION → REVALIDATED (reverse test passed)
        self._add(TransitionSpec(
            from_state=SPINState.ADVERSARIAL_EXECUTION,
            to_state=SPINState.REVALIDATED,
            entry_conditions=[_reverse_test_passed],
            required_evidence="reverse test must pass (falsification survived)",
            authorized_actors={"adversarial_tester", "system"},
            audit_event_type="revalidated",
        ))

        # ADVERSARIAL_EXECUTION → NARROWED (reverse test partially passed)
        self._add(TransitionSpec(
            from_state=SPINState.ADVERSARIAL_EXECUTION,
            to_state=SPINState.NARROWED,
            entry_conditions=[lambda s, c: not _reverse_test_passed(s, c)],
            required_evidence="reverse test failed — effect narrowed but not eliminated",
            authorized_actors={"adversarial_tester", "system"},
            audit_event_type="narrowed",
        ))

        # ADVERSARIAL_EXECUTION → ROLLED_BACK (reverse test failed completely)
        self._add(TransitionSpec(
            from_state=SPINState.ADVERSARIAL_EXECUTION,
            to_state=SPINState.ROLLED_BACK,
            entry_conditions=[_reverse_test_expired],
            required_evidence="reverse test expired or failed completely — rolling back",
            authorized_actors={"system"},
            audit_event_type="rolled_back",
        ))

        # REVALIDATED → RESEARCH (renewal — feed evidence back)
        self._add(TransitionSpec(
            from_state=SPINState.REVALIDATED,
            to_state=SPINState.RESEARCH,
            entry_conditions=[lambda s, c: True],
            required_evidence="revalidated strategy feeds new research questions",
            authorized_actors={"system"},
            audit_event_type="research_renewal",
        ))

        # NARROWED → RESEARCH
        self._add(TransitionSpec(
            from_state=SPINState.NARROWED,
            to_state=SPINState.RESEARCH,
            entry_conditions=[lambda s, c: True],
            required_evidence="narrowed strategy generates new research questions",
            authorized_actors={"system"},
            audit_event_type="research_renewal",
        ))

        # ROLLED_BACK → RESEARCH
        self._add(TransitionSpec(
            from_state=SPINState.ROLLED_BACK,
            to_state=SPINState.RESEARCH,
            entry_conditions=[lambda s, c: True],
            required_evidence="rolled back strategy returns to research for fundamental revision",
            authorized_actors={"system"},
            audit_event_type="research_renewal",
        ))

        # RETIRED → RESEARCH (retired hypotheses can still generate questions)
        self._add(TransitionSpec(
            from_state=SPINState.RETIRED,
            to_state=SPINState.RESEARCH,
            entry_conditions=[lambda s, c: True],
            required_evidence="retired hypothesis generates final research questions",
            authorized_actors={"system"},
            audit_event_type="research_renewal",
        ))

        # RESEARCH → DRAFT (new cycle begins)
        self._add(TransitionSpec(
            from_state=SPINState.RESEARCH,
            to_state=SPINState.DRAFT,
            entry_conditions=[lambda s, c: True],
            required_evidence="new research cycle, new hypothesis draft",
            authorized_actors={"system", "researcher"},
            audit_event_type="new_cycle",
        ))

        # Any state → RETIRED (manual retirement)
        for state in SPINState:
            if state in (SPINState.RETIRED, SPINState.RESEARCH, SPINState.REVALIDATED):
                continue
            self._add(TransitionSpec(
                from_state=state,
                to_state=SPINState.RETIRED,
                entry_conditions=[lambda s, c: True],
                required_evidence="manual retirement",
                authorized_actors={"manager", "compliance"},
                audit_event_type="retired",
            ))

    def _add(self, spec: TransitionSpec) -> None:
        key = (spec.from_state, spec.to_state)
        if key in self._transitions:
            LOG.warning("overwriting transition %s -> %s", spec.from_state.value, spec.to_state.value)
        self._transitions[key] = spec

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_allowed_next(self, current: SPINState) -> list[SPINState]:
        """Return the states that can legally follow ``current``."""
        return sorted(
            {to for (frm, to) in self._transitions if frm == current},
            key=lambda s: s.value,
        )

    def get_transition_spec(self, from_state: SPINState, to_state: SPINState) -> TransitionSpec | None:
        """Return the transition spec for a given pair, or None."""
        return self._transitions.get((from_state, to_state))

    def can_transition(
        self,
        spin: SPIN,
        to_state: SPINState,
        ctx: TransitionContext,
    ) -> tuple[bool, str]:
        """Check whether a transition is permitted and all gates are met."""
        spec = self._transitions.get((spin.state, to_state))
        if spec is None:
            return False, f"no transition defined from {spin.state.value} to {to_state.value}"

        # Check authorized actor
        if ctx.actor_role and spec.authorized_actors and ctx.actor_role not in spec.authorized_actors:
            return False, f"actor role '{ctx.actor_role}' not authorized (requires one of {spec.authorized_actors})"

        # Check timeout
        if spec.timeout_hours is not None:
            elapsed = (datetime.now(timezone.utc) - spin.updated_at).total_seconds() / 3600
            if elapsed > spec.timeout_hours:
                if spec.failure_condition:
                    return False, f"timeout exceeded ({spec.timeout_hours}h) — should transition to {spec.failure_condition.value}"
                return False, f"timeout exceeded ({spec.timeout_hours}h)"

        return spec.check_conditions(spin, ctx)

    def transition(
        self,
        spin: SPIN,
        to_state: SPINState,
        ctx: TransitionContext,
    ) -> SPINSnapshot:
        """Execute a state transition.

        Raises :class:`SPINTransitionError` if the transition is not
        permitted.  On success, appends a snapshot to the SPIN's chain
        and returns the new snapshot.
        """
        ok, reason = self.can_transition(spin, to_state, ctx)
        if not ok:
            raise SPINTransitionError(reason)

        spec = self._transitions[(spin.state, to_state)]

        # Side effects for specific transitions
        if to_state == SPINState.REVERSE_TEST_REQUIRED:
            self._schedule_reverse_test(spin, ctx)

        if to_state == SPINState.AUTOMATED:
            spin.automation_status = AutomationStatus.SUPERVISED_AUTOMATION
            if ctx.automation_layer_id:
                spin.automation_layer_id = ctx.automation_layer_id

        if to_state == SPINState.REPLICATED:
            spin.replication_count = len([c for c in ctx.replication_claims if c.is_significant()])

        # Update evidence tier on relevant transitions
        if to_state in (SPINState.ATTRIBUTED, SPINState.REPLICATED, SPINState.REVALIDATED):
            all_claims = ctx.claims + ctx.replication_claims
            assessment = compute_evidence_tier(all_claims, spin.required_replications)
            spin.evidence_tier = assessment.tier.value

        # Record contribution
        if ctx.actor_id:
            role_map = {
                "employee": ContributionRole.MISSION_EXECUTOR,
                "field_representative": ContributionRole.MISSION_EXECUTOR,
                "system_builder": ContributionRole.SYSTEM_BUILDER,
                "automation_architect": ContributionRole.AUTOMATION_ARCHITECT,
                "adversarial_tester": ContributionRole.ADVERSARIAL_TESTER,
                "channel_founder": ContributionRole.CHANNEL_FOUNDER,
                "researcher": ContributionRole.HYPOTHESIS_AUTHOR,
                "replication_executor": ContributionRole.REPLICATION_EXECUTOR,
            }
            contrib_role = role_map.get(ctx.actor_role, ContributionRole.REVIEWER)
            spin.add_contribution(
                contributor_id=ctx.actor_id,
                contributor_role=contrib_role,
                description=f"Transition: {spin.state.value} -> {to_state.value}. {spec.required_evidence}",
            )

        snapshot = spin._append_snapshot(
            state=to_state,
            actor_id=ctx.actor_id or "system",
            actor_role=ctx.actor_role or "system",
            reason=spec.required_evidence,
            metadata={
                "audit_event": spec.audit_event_type,
                "from_state": spin.state.value,
                "to_state": to_state.value,
            },
        )

        return snapshot

    def suggest_next(self, spin: SPIN, ctx: TransitionContext) -> SPINState | None:
        """Suggest the next state based on current context.

        Returns ``None`` if no forward transition is currently possible.
        """
        allowed = self.get_allowed_next(spin.state)

        for target in allowed:
            ok, _ = self.can_transition(spin, target, ctx)
            if ok:
                return target

        return None

    def check_timeouts(self, spin: SPIN) -> SPINState | None:
        """Check if the SPIN has exceeded a timeout and should auto-transition.

        Returns the failure state if a timeout has been exceeded, or None.
        """
        for (frm, to), spec in self._transitions.items():
            if frm != spin.state:
                continue
            if spec.timeout_hours is None:
                continue
            elapsed = (datetime.now(timezone.utc) - spin.updated_at).total_seconds() / 3600
            if elapsed > spec.timeout_hours and spec.failure_condition:
                return spec.failure_condition
        return None

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _schedule_reverse_test(self, spin: SPIN, ctx: TransitionContext) -> None:
        """Automatically schedule a reverse falsification test."""
        now = datetime.now(timezone.utc)
        deadline = now + timedelta(days=self.retest_interval_days)

        # Derive failure conditions from the hypothesis's falsification criteria
        # if available, otherwise use generic conditions
        failure_conditions = ctx.metadata.get("failure_conditions", [
            "The effect disappears when tested in a new context",
            "The effect is explained by a confounder not controlled in the original experiment",
        ])
        success_conditions = ctx.metadata.get("success_conditions", [
            "The effect survives replication in an independent context",
            "No confounder explains the result",
        ])

        spin.reverse_test = ReverseTestSpec(
            deadline=deadline,
            tester_id=ctx.metadata.get("tester_id"),
            failure_conditions=failure_conditions,
            success_conditions=success_conditions,
        )

        LOG.info(
            "scheduled reverse test for SPIN %s, deadline %s",
            spin.spin_id,
            deadline.isoformat(),
        )
