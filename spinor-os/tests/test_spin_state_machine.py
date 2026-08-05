"""Tests for the SPIN state machine — formal transition engine."""

from __future__ import annotations

import pytest
from datetime import timedelta

from spinor_os.spin import SPIN, SPINState, AutomationStatus
from spinor_os.spin_state_machine import (
    SPINStateMachine,
    SPINTransitionError,
    TransitionContext,
)
from spinor_os.config import AttributionMethod, Direction, OSDefaults
from spinor_os.models import AttributionClaim, PredictedEffect


def make_claim(
    hypothesis_id: str = "HYP-001",
    experiment_id: str = "EXP-001",
    outcome_value: float = 0.2,
    counterfactual: float = 0.05,
    confidence: float = 0.95,
    method: AttributionMethod = AttributionMethod.RCT,
    falsification_survived: bool = True,
    segments: list[str] | None = None,
    territories: list[str] | None = None,
    tested_by: list[str] | None = None,
) -> AttributionClaim:
    return AttributionClaim(
        experiment_id=experiment_id,
        hypothesis_id=hypothesis_id,
        outcome_metric="y_rate",
        outcome_value=outcome_value,
        counterfactual_estimate=counterfactual,
        confidence=confidence,
        method=method,
        falsification_survived=falsification_survived,
        segments=segments or ["enterprise"],
        territories=territories or ["northeast"],
        tested_by=tested_by or ["emp-001"],
    )


def make_spin(state: SPINState = SPINState.DRAFT) -> SPIN:
    spin = SPIN(hypothesis_id="HYP-001", employee_owner="emp-001")
    if state != SPINState.DRAFT:
        spin.state = state
    return spin


class TestStateMachineTransitions:
    """Tests for the formal transition gates."""

    def test_draft_to_prior_art_checked(self):
        sm = SPINStateMachine()
        spin = make_spin()
        ctx = TransitionContext(actor_id="system", actor_role="researcher", prior_art_checked=True)
        ok, reason = sm.can_transition(spin, SPINState.PRIOR_ART_CHECKED, ctx)
        assert ok, reason
        snap = sm.transition(spin, SPINState.PRIOR_ART_CHECKED, ctx)
        assert spin.state == SPINState.PRIOR_ART_CHECKED
        assert spin.verify_chain()

    def test_draft_to_prior_art_blocked_without_prior_art(self):
        sm = SPINStateMachine()
        spin = make_spin()
        ctx = TransitionContext(actor_id="system", actor_role="researcher", prior_art_checked=False)
        ok, reason = sm.can_transition(spin, SPINState.PRIOR_ART_CHECKED, ctx)
        assert not ok
        assert "prior-art" in reason.lower()

    def test_full_forward_journey(self):
        sm = SPINStateMachine()
        spin = make_spin()
        spin.prior_art.tested_in_market = False
        spin.prior_art.source_domains = ["fieldex.com"]
        spin.prior_art.novelty_delta = "No prior test in pharma"

        # DRAFT → PRIOR_ART_CHECKED
        ctx = TransitionContext(actor_id="sys", actor_role="researcher", prior_art_checked=True)
        sm.transition(spin, SPINState.PRIOR_ART_CHECKED, ctx)

        # PRIOR_ART_CHECKED → NOVELTY_QUALIFIED
        ctx = TransitionContext(actor_id="sys", actor_role="researcher", novelty_qualified=True)
        sm.transition(spin, SPINState.NOVELTY_QUALIFIED, ctx)

        # NOVELTY_QUALIFIED → ELIGIBLE
        ctx = TransitionContext(actor_id="sys", actor_role="manager")
        sm.transition(spin, SPINState.ELIGIBLE, ctx)

        # ELIGIBLE → ASSIGNED
        spin.mission_ids.append("MSN-001")
        ctx = TransitionContext(actor_id="sys", actor_role="manager")
        sm.transition(spin, SPINState.ASSIGNED, ctx)

        # ASSIGNED → PREREGISTERED (skip modification)
        ctx = TransitionContext(actor_id="emp-001", actor_role="employee", pre_registered=True)
        sm.transition(spin, SPINState.PREREGISTERED, ctx)

        # PREREGISTERED → EXECUTING
        spin.experiment_ids.append("EXP-001")
        ctx = TransitionContext(actor_id="emp-001", actor_role="employee")
        sm.transition(spin, SPINState.EXECUTING, ctx)

        # EXECUTING → OBSERVED
        claim = make_claim()
        ctx = TransitionContext(actor_id="sys", actor_role="system", claims=[claim])
        sm.transition(spin, SPINState.OBSERVED, ctx)

        # OBSERVED → ATTRIBUTED
        sm.transition(spin, SPINState.ATTRIBUTED, ctx)

        # ATTRIBUTED → REPLICATION_PENDING
        ctx = TransitionContext(actor_id="sys", actor_role="system")
        sm.transition(spin, SPINState.REPLICATION_PENDING, ctx)

        # REPLICATION_PENDING → REPLICATED
        rep_claims = [
            make_claim(tested_by=["emp-002"], segments=["hospital"], territories=["west"]),
            make_claim(tested_by=["emp-003"], segments=["clinic"], territories=["south"]),
            make_claim(tested_by=["emp-001"], segments=["enterprise"], territories=["northeast"]),
        ]
        ctx = TransitionContext(actor_id="sys", actor_role="replication_executor", replication_claims=rep_claims)
        sm.transition(spin, SPINState.REPLICATED, ctx)

        assert spin.replication_count == 3
        assert spin.evidence_tier == "replicated"
        assert spin.verify_chain()

    def test_unauthorized_actor_blocked(self):
        sm = SPINStateMachine()
        spin = make_spin()
        ctx = TransitionContext(actor_id="emp-001", actor_role="compliance", prior_art_checked=True)
        ok, reason = sm.can_transition(spin, SPINState.PRIOR_ART_CHECKED, ctx)
        assert not ok
        assert "not authorized" in reason

    def test_undefined_transition_raises(self):
        sm = SPINStateMachine()
        spin = make_spin()
        ctx = TransitionContext(actor_id="sys", actor_role="system")
        with pytest.raises(SPINTransitionError, match="no transition defined"):
            sm.transition(spin, SPINState.REPLICATED, ctx)

    def test_get_allowed_next(self):
        sm = SPINStateMachine()
        allowed = sm.get_allowed_next(SPINState.DRAFT)
        assert SPINState.PRIOR_ART_CHECKED in allowed
        assert SPINState.RETIRED in allowed  # manual retirement from any state

    def test_suggest_next(self):
        sm = SPINStateMachine()
        spin = make_spin()
        spin.prior_art.source_domains = ["x.com"]
        ctx = TransitionContext(actor_id="sys", actor_role="researcher", prior_art_checked=True)
        suggested = sm.suggest_next(spin, ctx)
        assert suggested == SPINState.PRIOR_ART_CHECKED


class TestReverseTestTrigger:
    """Tests for the compulsory reverse falsification mechanism."""

    def test_automation_triggers_reverse_test(self):
        sm = SPINStateMachine()
        spin = make_spin(SPINState.AUTOMATED)
        ctx = TransitionContext(actor_id="sys", actor_role="system")
        sm.transition(spin, SPINState.REVERSE_TEST_REQUIRED, ctx)
        assert spin.reverse_test is not None
        assert spin.reverse_test.status == "scheduled"

    def test_reverse_test_pass_leads_to_revalidated(self):
        sm = SPINStateMachine()
        spin = make_spin(SPINState.ADVERSARIAL_EXECUTION)
        spin.reverse_test = None  # Will be set by previous transition
        from spinor_os.spin import ReverseTestSpec
        from datetime import datetime, timezone
        rt = ReverseTestSpec(
            deadline=datetime.now(timezone.utc) + timedelta(days=30),
            failure_conditions=["x"],
            success_conditions=["y"],
            status="passed",
            result=True,
        )
        spin.reverse_test = rt
        ctx = TransitionContext(actor_id="tester", actor_role="adversarial_tester", reverse_test_passed=True)
        sm.transition(spin, SPINState.REVALIDATED, ctx)
        assert spin.state == SPINState.REVALIDATED

    def test_reverse_test_fail_leads_to_narrowed(self):
        sm = SPINStateMachine()
        spin = make_spin(SPINState.ADVERSARIAL_EXECUTION)
        ctx = TransitionContext(actor_id="tester", actor_role="adversarial_tester", reverse_test_passed=False)
        sm.transition(spin, SPINState.NARROWED, ctx)
        assert spin.state == SPINState.NARROWED

    def test_renewal_feeds_back_to_research(self):
        sm = SPINStateMachine()
        spin = make_spin(SPINState.REVALIDATED)
        ctx = TransitionContext(actor_id="sys", actor_role="system")
        sm.transition(spin, SPINState.RESEARCH, ctx)
        assert spin.state == SPINState.RESEARCH

        # RESEARCH → DRAFT (new cycle)
        sm.transition(spin, SPINState.DRAFT, ctx)
        assert spin.state == SPINState.DRAFT


class TestTimeoutDetection:
    """Tests for timeout-based auto-transitions."""

    def test_timeout_detected(self):
        sm = SPINStateMachine()
        spin = make_spin(SPINState.EXECUTING)
        # Set updated_at to 40 days ago (timeout is 30 days)
        from datetime import datetime, timezone
        spin.updated_at = datetime.now(timezone.utc) - timedelta(days=40)
        failure = sm.check_timeouts(spin)
        assert failure == SPINState.RETIRED

    def test_no_timeout_when_recent(self):
        sm = SPINStateMachine()
        spin = make_spin(SPINState.EXECUTING)
        failure = sm.check_timeouts(spin)
        assert failure is None
