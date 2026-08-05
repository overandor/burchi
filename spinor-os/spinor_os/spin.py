"""SPIN — the canonical causal unit of SPINOR OS.

A SPIN (Single Provenance-Instrumented Node) binds together every artifact
produced during the organizational progression of one causal claim:

    evidence
    + prior-art state
    + hypothesis version
    + assignment policy
    + employee eligibility
    + human modification
    + model contribution
    + execution protocol
    + contextual conditions
    + outcome
    + attribution
    + replication
    + automation status
    + compulsory reverse test

The SPIN is the strongest candidate novelty concentration.  W3C PROV-O
provides a foundation ontology but does not define this organizational
lifecycle.  The SPIN schema is an independently-derived specification
that encodes the full forward-and-reverse journey as a single versioned
object with content-addressed provenance.

Design principles
-----------------
1.  **Immutable snapshots.**  Every state transition produces a new SPIN
    snapshot with a content digest.  Snapshots are append-only.
2.  **Human modification is first-class.**  When an employee modifies a
    hypothesis, the modification is captured as a structured delta, not
    a free-text note.  This preserves inventorship evidence.
3.  **Reverse falsification is compulsory.**  Promotion to a production
    state automatically schedules an adversarial reverse test.  The SPIN
    cannot reach a terminal "deployed" state without a scheduled reverse
    pass.
4.  **Evidence tier is explicit.**  Every SPIN carries an
    :class:`~spinor_os.evidence_tiers.EvidenceTier` that is computed
    from the accumulated attribution claims, never set by hand.
5.  **Provenance is cryptographic.**  Each snapshot links to its
    predecessor via a SHA-256 digest chain, providing tamper-evident
    audit without an external blockchain.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from spinor_os.config import (
    AttributionMethod,
    Direction,
    MaturityStage,
    MissionClass,
    OSDefaults,
    get_logger,
)
from spinor_os.models import (
    AttributionClaim,
    Employee,
    Event,
    Experiment,
    GoldenNode,
    Hypothesis,
    HypothesisCard,
    Mission,
    Strategy,
    new_id,
    utc_now,
)

LOG = get_logger("spinor_os.spin")


# ---------------------------------------------------------------------------
# Enums specific to the SPIN schema
# ---------------------------------------------------------------------------


class SPINState(str, Enum):
    """The 19-state lifecycle of a SPIN.

    These are finer-grained than :class:`~spinor_os.config.LoopStage`
    because they encode the *organizational* progression, not just the
    experiment-internal loop.  States DRAFT through REPLICATED correspond
    to the forward journey; GOLDEN_NODE_CANDIDATE through RESEARCH
    correspond to the reverse journey.
    """

    DRAFT = "draft"
    PRIOR_ART_CHECKED = "prior_art_checked"
    NOVELTY_QUALIFIED = "novelty_qualified"
    ELIGIBLE = "eligible"
    ASSIGNED = "assigned"
    HUMAN_MODIFIED = "human_modified"
    PREREGISTERED = "preregistered"
    EXECUTING = "executing"
    OBSERVED = "observed"
    ATTRIBUTED = "attributed"
    REPLICATION_PENDING = "replication_pending"
    REPLICATED = "replicated"
    GOLDEN_NODE_CANDIDATE = "golden_node_candidate"
    SYSTEMIZATION_PENDING = "systemization_pending"
    AUTOMATED = "automated"
    CHANNEL_CANDIDATE = "channel_candidate"
    REVERSE_TEST_REQUIRED = "reverse_test_required"
    ADVERSARIAL_EXECUTION = "adversarial_execution"
    # Terminal outcomes after adversarial execution
    REVALIDATED = "revalidated"
    NARROWED = "narrowed"
    ROLLED_BACK = "rolled_back"
    RETIRED = "retired"
    # Renewal — feeds back to research
    RESEARCH = "research"


class ContributionRole(str, Enum):
    """Role of a contributor in the SPIN lineage."""

    HYPOTHESIS_AUTHOR = "hypothesis_author"
    MISSION_EXECUTOR = "mission_executor"
    HUMAN_MODIFIER = "human_modifier"
    REPLICATION_EXECUTOR = "replication_executor"
    ADVERSARIAL_TESTER = "adversarial_tester"
    SYSTEM_BUILDER = "system_builder"
    AUTOMATION_ARCHITECT = "automation_architect"
    CHANNEL_FOUNDER = "channel_founder"
    MODEL_ASSIST = "model_assist"
    REVIEWER = "reviewer"


class AutomationStatus(str, Enum):
    """Where the SPIN sits on the human→automation frontier."""

    HUMAN_ONLY = "human_only"
    HUMAN_WITH_MODEL_ASSIST = "human_with_model_assist"
    SUPERVISED_AUTOMATION = "supervised_automation"
    FULLY_AUTOMATED = "fully_automated"
    ELIMINATED = "eliminated"


# ---------------------------------------------------------------------------
# Contribution ledger — preserves human inventorship evidence
# ---------------------------------------------------------------------------


class ContributionEntry(BaseModel):
    """A single contribution record in the SPIN's lineage.

    This is the atomic unit of the contribution ledger.  It records who
    did what, when, and whether a model was involved.  Entries are
    append-only and content-addressed.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    entry_id: str = Field(default_factory=lambda: new_id("CTR"))
    contributor_id: str
    contributor_role: ContributionRole
    description: str
    timestamp: datetime = Field(default_factory=utc_now)
    model_assisted: bool = False
    model_id: Optional[str] = None
    model_prompt_version: Optional[str] = None
    modification_delta: dict[str, Any] = Field(default_factory=dict)

    @field_validator("contributor_id", "description")
    @classmethod
    def _not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("contributor_id and description must be non-empty")
        return v


# ---------------------------------------------------------------------------
# Human modification delta — structured, not free-text
# ---------------------------------------------------------------------------


class HumanModification(BaseModel):
    """A structured record of what a human changed in the hypothesis.

    This is critical for inventorship preservation.  Instead of a
    free-text "notes" field, the modification is captured as a set of
    variable-level deltas.  This allows downstream patent analysis to
    identify exactly which natural person changed which variable.
    """

    model_config = ConfigDict(extra="forbid")

    modification_id: str = Field(default_factory=lambda: new_id("MOD"))
    modifier_id: str
    modified_at: datetime = Field(default_factory=utc_now)
    changed_variables: dict[str, dict[str, Any]] = Field(default_factory=dict)
    rationale: str
    parent_hypothesis_id: str
    derivative_hypothesis_id: str
    model_assisted: bool = False
    model_contribution: Optional[str] = None

    @field_validator("modifier_id", "rationale", "parent_hypothesis_id", "derivative_hypothesis_id")
    @classmethod
    def _not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("modification fields must be non-empty")
        return v

    def variables_changed(self) -> list[str]:
        """Return the names of variables that were changed."""
        return list(self.changed_variables.keys())


# ---------------------------------------------------------------------------
# Prior-art state — what was known before this SPIN
# ---------------------------------------------------------------------------


class PriorArtState(BaseModel):
    """The state of prior-art knowledge at the time of SPIN creation.

    Captures whether the hypothesis has been tested in-market, in
    adjacent industries, and what the responsible component might be.
    """

    model_config = ConfigDict(extra="forbid")

    checked_at: datetime = Field(default_factory=utc_now)
    tested_in_market: bool = False
    tested_in_adjacent_industries: bool = False
    adjacent_support_summary: str = ""
    source_domains: list[str] = Field(default_factory=list)
    responsible_component: Optional[str] = None
    required_conditions: list[str] = Field(default_factory=list)
    risks_and_confounders: list[str] = Field(default_factory=list)
    genuinely_unknown: list[str] = Field(default_factory=list)
    novelty_delta: str = ""
    checked_by: str = "system"


# ---------------------------------------------------------------------------
# Reverse-test specification — compulsory adversarial pass
# ---------------------------------------------------------------------------


class ReverseTestSpec(BaseModel):
    """Specification for the compulsory reverse falsification pass.

    A reverse test is automatically scheduled when a SPIN is promoted
    to AUTOMATED or CHANNEL_CANDIDATE.  The test must be completed
    within ``deadline`` or the SPIN is automatically rolled back.
    """

    model_config = ConfigDict(extra="forbid")

    test_id: str = Field(default_factory=lambda: new_id("REV"))
    scheduled_at: datetime = Field(default_factory=utc_now)
    deadline: datetime
    tester_id: Optional[str] = None
    test_mission_class: MissionClass = MissionClass.SABOTEUR
    failure_conditions: list[str] = Field(default_factory=list, min_length=1)
    success_conditions: list[str] = Field(default_factory=list, min_length=1)
    status: str = "scheduled"  # scheduled | executing | passed | failed | expired
    result: Optional[bool] = None
    evidence: dict[str, Any] = Field(default_factory=dict)
    completed_at: Optional[datetime] = None

    @field_validator("failure_conditions", "success_conditions")
    @classmethod
    def _nonempty(cls, v: list[str]) -> list[str]:
        if not any(c.strip() for c in v):
            raise ValueError("at least one condition is required")
        return v

    def is_expired(self, now: datetime | None = None) -> bool:
        if now is None:
            now = utc_now()
        return self.status == "scheduled" and now > self.deadline

    def complete(self, passed: bool, evidence: dict[str, Any] | None = None) -> None:
        self.result = passed
        self.status = "passed" if passed else "failed"
        self.completed_at = utc_now()
        if evidence:
            self.evidence.update(evidence)


# ---------------------------------------------------------------------------
# SPIN snapshot — one immutable point in the SPIN's lifecycle
# ---------------------------------------------------------------------------


class SPINSnapshot(BaseModel):
    """An immutable snapshot of a SPIN at a point in time.

    Snapshots form a content-addressed chain: each snapshot's
    ``previous_digest`` links to its predecessor, providing
    tamper-evident provenance without an external blockchain.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    snapshot_id: str = Field(default_factory=lambda: new_id("SNP"))
    spin_id: str
    state: SPINState
    timestamp: datetime = Field(default_factory=utc_now)
    actor_id: str
    actor_role: str
    reason: str
    previous_digest: str = ""
    content_digest: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)

    def compute_digest(self, previous_digest: str = "") -> str:
        """Compute the SHA-256 content digest of this snapshot."""
        data = self.model_dump(exclude={"content_digest"}, mode="json")
        data["previous_digest"] = previous_digest or self.previous_digest
        canonical = json.dumps(data, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def with_digest(self, previous_digest: str = "") -> SPINSnapshot:
        """Return a new snapshot with the content digest computed."""
        digest = self.compute_digest(previous_digest)
        return self.model_copy(update={
            "content_digest": digest,
            "previous_digest": previous_digest or self.previous_digest,
        })


# ---------------------------------------------------------------------------
# The SPIN — the central causal unit
# ---------------------------------------------------------------------------


class SPIN(BaseModel):
    """The canonical causal unit of SPINOR OS.

    A SPIN binds together every artifact produced during the
    organizational progression of one causal claim — from initial
    research through deployment, adversarial reverse testing, and
    renewal.

    The SPIN is versioned through a chain of immutable
    :class:`SPINSnapshot` objects.  Each state transition appends a
    new snapshot with a content digest linking to its predecessor.

    Attributes
    ----------
    spin_id : str
        Unique identifier for this SPIN.
    hypothesis_id : str
        The hypothesis this SPIN tracks.
    state : SPINState
        Current lifecycle state.
    prior_art : PriorArtState
        State of prior-art knowledge at creation.
    contributions : list[ContributionEntry]
        Append-only contribution ledger.
    modifications : list[HumanModification]
        Structured human modification deltas.
    experiment_ids : list[str]
        Experiments conducted under this SPIN.
    mission_ids : list[str]
        Missions allocated under this SPIN.
    claim_ids : list[str]
        Attribution claims produced by this SPIN.
    replication_count : int
        Number of successful replications.
    automation_status : AutomationStatus
        Where on the human→automation frontier.
    reverse_test : Optional[ReverseTestSpec]
        Compulsory reverse falsification test.
    snapshots : list[SPINSnapshot]
        Content-addressed snapshot chain.
    """

    model_config = ConfigDict(extra="forbid")

    spin_id: str = Field(default_factory=lambda: new_id("SPIN"))
    hypothesis_id: str
    employee_owner: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    state: SPINState = SPINState.DRAFT

    # Prior art
    prior_art: PriorArtState = Field(default_factory=PriorArtState)

    # Contribution ledger
    contributions: list[ContributionEntry] = Field(default_factory=list)

    # Human modifications
    modifications: list[HumanModification] = Field(default_factory=list)

    # Linked artifacts
    experiment_ids: list[str] = Field(default_factory=list)
    mission_ids: list[str] = Field(default_factory=list)
    claim_ids: list[str] = Field(default_factory=list)
    strategy_id: Optional[str] = None
    golden_node_id: Optional[str] = None

    # Replication
    replication_count: int = Field(default=0, ge=0)
    required_replications: int = Field(default=OSDefaults.MIN_REPLICATIONS, ge=1)

    # Automation
    automation_status: AutomationStatus = AutomationStatus.HUMAN_ONLY
    automation_layer_id: Optional[str] = None

    # Reverse test
    reverse_test: Optional[ReverseTestSpec] = None

    # Snapshot chain
    snapshots: list[SPINSnapshot] = Field(default_factory=list)

    # Evidence tier (computed, not set by hand)
    evidence_tier: str = "observed"

    # Tags
    tags: list[str] = Field(default_factory=list)

    @field_validator("hypothesis_id", "employee_owner")
    @classmethod
    def _not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("hypothesis_id and employee_owner must be non-empty")
        return v

    @model_validator(mode="after")
    def _init_snapshot_chain(self) -> SPIN:
        """Ensure the SPIN has at least one snapshot (the creation snapshot)."""
        if not self.snapshots:
            snap = SPINSnapshot(
                spin_id=self.spin_id,
                state=self.state,
                actor_id=self.employee_owner,
                actor_role="hypothesis_author",
                reason="SPIN created",
            )
            self.snapshots = [snap.with_digest("")]
        return self

    # ------------------------------------------------------------------
    # Snapshot management
    # ------------------------------------------------------------------

    @property
    def latest_digest(self) -> str:
        """Return the content digest of the most recent snapshot."""
        if not self.snapshots:
            return ""
        return self.snapshots[-1].content_digest

    def _append_snapshot(
        self,
        state: SPINState,
        actor_id: str,
        actor_role: str,
        reason: str,
        metadata: dict[str, Any] | None = None,
    ) -> SPINSnapshot:
        """Append a new snapshot to the chain and update state."""
        prev_digest = self.latest_digest
        snap = SPINSnapshot(
            spin_id=self.spin_id,
            state=state,
            actor_id=actor_id,
            actor_role=actor_role,
            reason=reason,
            metadata=metadata or {},
        )
        snap = snap.with_digest(prev_digest)
        self.snapshots.append(snap)
        self.state = state
        self.updated_at = utc_now()
        LOG.info(
            "SPIN %s transition: %s -> %s (%s)",
            self.spin_id,
            prev_digest[:8] if prev_digest else "init",
            snap.content_digest[:8],
            state.value,
        )
        return snap

    # ------------------------------------------------------------------
    # Contribution ledger
    # ------------------------------------------------------------------

    def add_contribution(
        self,
        contributor_id: str,
        contributor_role: ContributionRole,
        description: str,
        model_assisted: bool = False,
        model_id: str | None = None,
        model_prompt_version: str | None = None,
        modification_delta: dict[str, Any] | None = None,
    ) -> ContributionEntry:
        """Append a contribution to the ledger."""
        entry = ContributionEntry(
            contributor_id=contributor_id,
            contributor_role=contributor_role,
            description=description,
            model_assisted=model_assisted,
            model_id=model_id,
            model_prompt_version=model_prompt_version,
            modification_delta=modification_delta or {},
        )
        self.contributions.append(entry)
        return entry

    def get_contributors(self) -> list[str]:
        """Return unique contributor IDs."""
        return sorted({c.contributor_id for c in self.contributions})

    def get_modifications_by(self, employee_id: str) -> list[HumanModification]:
        """Return all human modifications made by a specific employee."""
        return [m for m in self.modifications if m.modifier_id == employee_id]

    # ------------------------------------------------------------------
    # Human modification
    # ------------------------------------------------------------------

    def record_modification(
        self,
        modifier_id: str,
        changed_variables: dict[str, dict[str, Any]],
        rationale: str,
        parent_hypothesis_id: str,
        derivative_hypothesis_id: str,
        model_assisted: bool = False,
        model_contribution: str | None = None,
    ) -> HumanModification:
        """Record a structured human modification to the hypothesis."""
        mod = HumanModification(
            modifier_id=modifier_id,
            changed_variables=changed_variables,
            rationale=rationale,
            parent_hypothesis_id=parent_hypothesis_id,
            derivative_hypothesis_id=derivative_hypothesis_id,
            model_assisted=model_assisted,
            model_contribution=model_contribution,
        )
        self.modifications.append(mod)
        self.add_contribution(
            contributor_id=modifier_id,
            contributor_role=ContributionRole.HUMAN_MODIFIER,
            description=f"Modified variables: {', '.join(mod.variables_changed())}. Rationale: {rationale}",
            model_assisted=model_assisted,
            modification_delta=changed_variables,
        )
        return mod

    # ------------------------------------------------------------------
    # Provenance verification
    # ------------------------------------------------------------------

    def verify_chain(self) -> bool:
        """Verify the integrity of the snapshot chain.

        Returns ``True`` if every snapshot's content digest matches
        a recomputed digest, and every ``previous_digest`` matches the
        preceding snapshot's ``content_digest``.
        """
        prev = ""
        for snap in self.snapshots:
            expected = snap.compute_digest(prev)
            if snap.content_digest != expected:
                LOG.error(
                    "chain break in SPIN %s at snapshot %s: expected %s, got %s",
                    self.spin_id,
                    snap.snapshot_id,
                    expected[:12],
                    snap.content_digest[:12],
                )
                return False
            prev = snap.content_digest
        return True

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")

    def summary(self) -> dict[str, Any]:
        """Return a compact summary suitable for dashboards."""
        return {
            "spin_id": self.spin_id,
            "hypothesis_id": self.hypothesis_id,
            "state": self.state.value,
            "evidence_tier": self.evidence_tier,
            "replication_count": self.replication_count,
            "automation_status": self.automation_status.value,
            "contributor_count": len(self.get_contributors()),
            "modification_count": len(self.modifications),
            "has_reverse_test": self.reverse_test is not None,
            "snapshot_count": len(self.snapshots),
            "chain_intact": self.verify_chain(),
        }
