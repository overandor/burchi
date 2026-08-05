"""Tests for the SPIN causal unit — the central novelty object."""

from __future__ import annotations

import pytest
from datetime import timedelta

from spinor_os.spin import (
    SPIN,
    SPINState,
    ContributionEntry,
    ContributionRole,
    HumanModification,
    PriorArtState,
    ReverseTestSpec,
    AutomationStatus,
)
from spinor_os.config import OSDefaults


class TestSPINCreation:
    """Tests for SPIN creation and initial state."""

    def test_spin_creates_with_initial_snapshot(self):
        spin = SPIN(hypothesis_id="HYP-001", employee_owner="emp-001")
        assert spin.state == SPINState.DRAFT
        assert len(spin.snapshots) == 1
        assert spin.snapshots[0].state == SPINState.DRAFT
        assert spin.snapshots[0].content_digest != ""

    def test_spin_rejects_empty_hypothesis_id(self):
        with pytest.raises(ValueError, match="non-empty"):
            SPIN(hypothesis_id="", employee_owner="emp-001")

    def test_spin_rejects_empty_employee_owner(self):
        with pytest.raises(ValueError, match="non-empty"):
            SPIN(hypothesis_id="HYP-001", employee_owner="")

    def test_spin_chain_is_verifiable_on_creation(self):
        spin = SPIN(hypothesis_id="HYP-001", employee_owner="emp-001")
        assert spin.verify_chain() is True

    def test_spin_summary(self):
        spin = SPIN(hypothesis_id="HYP-001", employee_owner="emp-001")
        s = spin.summary()
        assert s["spin_id"] == spin.spin_id
        assert s["state"] == "draft"
        assert s["evidence_tier"] == "observed"
        assert s["chain_intact"] is True


class TestContributionLedger:
    """Tests for the append-only contribution ledger."""

    def test_add_contribution(self):
        spin = SPIN(hypothesis_id="HYP-001", employee_owner="emp-001")
        entry = spin.add_contribution(
            contributor_id="emp-002",
            contributor_role=ContributionRole.REPLICATION_EXECUTOR,
            description="Replicated experiment in northeast territory",
        )
        assert entry.contributor_id == "emp-002"
        assert len(spin.contributions) == 1

    def test_get_contributors_returns_unique(self):
        spin = SPIN(hypothesis_id="HYP-001", employee_owner="emp-001")
        spin.add_contribution("emp-001", ContributionRole.HYPOTHESIS_AUTHOR, "Created hypothesis")
        spin.add_contribution("emp-002", ContributionRole.MISSION_EXECUTOR, "Executed mission")
        spin.add_contribution("emp-001", ContributionRole.HUMAN_MODIFIER, "Modified timing variable")
        contributors = spin.get_contributors()
        assert contributors == ["emp-001", "emp-002"]

    def test_model_assisted_contribution(self):
        spin = SPIN(hypothesis_id="HYP-001", employee_owner="emp-001")
        entry = spin.add_contribution(
            contributor_id="emp-001",
            contributor_role=ContributionRole.HYPOTHESIS_AUTHOR,
            description="Generated hypothesis with model assist",
            model_assisted=True,
            model_id="gpt-oss-20b",
            model_prompt_version="v1.2",
        )
        assert entry.model_assisted is True
        assert entry.model_id == "gpt-oss-20b"


class TestHumanModification:
    """Tests for structured human modification deltas."""

    def test_record_modification(self):
        spin = SPIN(hypothesis_id="HYP-001", employee_owner="emp-001")
        mod = spin.record_modification(
            modifier_id="emp-001",
            changed_variables={
                "timing": {"from": "morning", "to": "afternoon"},
                "channel": {"from": "email", "to": "phone"},
            },
            rationale="Afternoon calls may reach admin staff more reliably",
            parent_hypothesis_id="HYP-001",
            derivative_hypothesis_id="HYP-002",
        )
        assert len(spin.modifications) == 1
        assert "timing" in mod.variables_changed()
        assert "channel" in mod.variables_changed()
        # Modification also creates a contribution entry
        assert len(spin.contributions) == 1
        assert spin.contributions[0].contributor_role == ContributionRole.HUMAN_MODIFIER

    def test_get_modifications_by_employee(self):
        spin = SPIN(hypothesis_id="HYP-001", employee_owner="emp-001")
        spin.record_modification(
            modifier_id="emp-001",
            changed_variables={"timing": {"from": "am", "to": "pm"}},
            rationale="test",
            parent_hypothesis_id="HYP-001",
            derivative_hypothesis_id="HYP-002",
        )
        spin.record_modification(
            modifier_id="emp-002",
            changed_variables={"channel": {"from": "email", "to": "phone"}},
            rationale="test2",
            parent_hypothesis_id="HYP-001",
            derivative_hypothesis_id="HYP-003",
        )
        emp1_mods = spin.get_modifications_by("emp-001")
        emp2_mods = spin.get_modifications_by("emp-002")
        assert len(emp1_mods) == 1
        assert len(emp2_mods) == 1
        assert emp1_mods[0].variables_changed() == ["timing"]


class TestSnapshotChain:
    """Tests for the content-addressed snapshot chain."""

    def test_chain_remains_verifiable_after_transitions(self):
        spin = SPIN(hypothesis_id="HYP-001", employee_owner="emp-001")
        # Manually append snapshots (simulating transitions)
        spin._append_snapshot(
            state=SPINState.PRIOR_ART_CHECKED,
            actor_id="system",
            actor_role="researcher",
            reason="prior art checked",
        )
        spin._append_snapshot(
            state=SPINState.NOVELTY_QUALIFIED,
            actor_id="system",
            actor_role="researcher",
            reason="novelty qualified",
        )
        assert len(spin.snapshots) == 3
        assert spin.verify_chain() is True

    def test_each_snapshot_links_to_previous(self):
        spin = SPIN(hypothesis_id="HYP-001", employee_owner="emp-001")
        spin._append_snapshot(
            state=SPINState.PRIOR_ART_CHECKED,
            actor_id="system",
            actor_role="researcher",
            reason="prior art checked",
        )
        assert spin.snapshots[1].previous_digest == spin.snapshots[0].content_digest

    def test_latest_digest_property(self):
        spin = SPIN(hypothesis_id="HYP-001", employee_owner="emp-001")
        assert spin.latest_digest == spin.snapshots[-1].content_digest


class TestReverseTest:
    """Tests for the compulsory reverse falsification test."""

    def test_reverse_test_creation(self):
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        rt = ReverseTestSpec(
            deadline=now + timedelta(days=30),
            failure_conditions=["Effect disappears in new context"],
            success_conditions=["Effect survives replication"],
        )
        assert rt.status == "scheduled"
        assert rt.is_expired() is False

    def test_reverse_test_expiry(self):
        from datetime import datetime, timezone
        past = datetime.now(timezone.utc) - timedelta(days=1)
        rt = ReverseTestSpec(
            deadline=past,
            failure_conditions=["x"],
            success_conditions=["y"],
        )
        assert rt.is_expired() is True

    def test_reverse_test_completion(self):
        from datetime import datetime, timezone
        rt = ReverseTestSpec(
            deadline=datetime.now(timezone.utc) + timedelta(days=30),
            failure_conditions=["x"],
            success_conditions=["y"],
        )
        rt.complete(passed=True, evidence={"replicated_in": "northwest"})
        assert rt.status == "passed"
        assert rt.result is True
        assert rt.completed_at is not None


class TestPriorArtState:
    """Tests for the prior-art state object."""

    def test_default_prior_art(self):
        pa = PriorArtState()
        assert pa.tested_in_market is False
        assert pa.source_domains == []

    def test_prior_art_with_evidence(self):
        pa = PriorArtState(
            tested_in_market=False,
            tested_in_adjacent_industries=True,
            adjacent_support_summary="Adjacent SaaS industry shows 15% lift",
            source_domains=["saas.com", "fieldex.com"],
            genuinely_unknown=["Effect in regulated pharma context"],
            novelty_delta="No prior test in pharma field execution with compliance constraints",
        )
        assert pa.tested_in_adjacent_industries is True
        assert len(pa.source_domains) == 2
