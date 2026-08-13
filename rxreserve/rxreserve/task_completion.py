"""Task Completion as the supremacy metric over delivery.

The industry measures email success as:
  sent → opened → clicked → converted

This is a delivery pipeline. It measures whether the email arrived,
not whether it accomplished anything.

LAIDER measures email success as:

  task_defined → task_attempted → task_engaged → task_completed → task_verified

A "task" is not "send an email." A task is:
  - Resolve an HCP's objection
  - Answer an HCP's clinical question with approved evidence
  - Advance an HCP from one journey state to the next
  - Deliver the right approved asset to the right HCP at the right time

Task completion is supremacy over delivery because:
  - A delivered email that doesn't resolve the barrier is waste
  - An opened email that delivers wrong evidence is risk
  - A clicked email that doesn't advance the journey is noise
  - A completed task — even via a non-email channel — is value

The metric hierarchy:
  Level 0 (Delivery):     sent, opened, clicked
  Level 1 (Engagement):   replied, interacted, downloaded
  Level 2 (Task Completion): barrier_resolved, question_answered, journey_advanced  ← SUPREMACY
  Level 3 (Value Creation): pattern_validated, derivative_created, capability_magnified

Most pharma email agents optimize Level 0 and report Level 1.
LAIDER optimizes Level 2 and compounds into Level 3.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from rxreserve.hcp import (
    HCPOpportunityObject,
    HCPInteraction,
    HCPJourneyState,
    HCPChannel,
    HCP_TRANSITIONS,
)
from rxreserve.franchise import FranchiseKnowledgeGraph, EvidencePath


# ─── Task Types ───

class TaskType(enum.Enum):
    BARRIER_RESOLUTION = "barrier_resolution"
    QUESTION_ANSWERED = "question_answered"
    EVIDENCE_DELIVERY = "evidence_delivery"
    JOURNEY_ADVANCEMENT = "journey_advancement"
    OBJECTION_OVERCOME = "objection_overcome"
    APPOINTMENT_SCHEDULED = "appointment_scheduled"
    SAMPLE_REQUEST_FULFILLED = "sample_request_fulfilled"
    EDUCATIONAL_CONTENT_DELIVERED = "educational_content_delivered"


class TaskStatus(enum.Enum):
    """The task lifecycle — not the email lifecycle."""
    DEFINED = "defined"            # task identified but not yet attempted
    ATTEMPTED = "attempted"        # email sent / interaction initiated
    ENGAGED = "engaged"            # HCP responded or interacted meaningfully
    COMPLETED = "completed"        # task objective achieved (barrier resolved, question answered)
    VERIFIED = "verified"          # completion independently confirmed (journey advanced, outcome observed)
    FAILED = "failed"              # task objective not achieved
    EXPIRED = "expired"            # task window passed without completion


class MetricLevel(enum.Enum):
    """The hierarchy of metrics. Level 2 is supremacy."""
    DELIVERY = 0       # sent, opened, clicked
    ENGAGEMENT = 1     # replied, interacted, downloaded
    TASK_COMPLETION = 2  # barrier_resolved, question_answered, journey_advanced
    VALUE_CREATION = 3   # pattern_validated, derivative_created, capability_magnified


# ─── Email Task ───

@dataclass
class EmailTask:
    """A task that an email (or sequence of emails) is meant to complete.

    This is NOT 'send an email.' This is 'resolve this HCP's barrier using
    approved evidence via email as the channel.'

    The email is the vehicle. The task is the objective.
    """
    task_id: str = field(default_factory=lambda: str(uuid4()))
    hcp_id: str = ""
    employee_id: str = ""

    # What task are we completing?
    task_type: TaskType = TaskType.BARRIER_RESOLUTION
    status: TaskStatus = TaskStatus.DEFINED

    # The objective — what does "completed" mean?
    objective: str = ""               # e.g. "Resolve HCP's concern about renal safety with TDF"
    completion_criteria: str = ""     # e.g. "HCP acknowledges renal data and expresses willingness to consider Biktarvy"
    verification_method: str = ""     # e.g. "HCP journey advances to appropriate_clinical_consideration"

    # The barrier / question / objection being addressed
    barrier: str = ""
    question: str = ""
    objection: str = ""

    # The approved evidence path that should resolve it
    evidence_path: Optional[dict[str, Any]] = None  # EvidencePath.to_dict()
    approved_assets: list[str] = field(default_factory=list)

    # The intended journey transition
    from_journey_state: str = ""
    to_journey_state: str = ""

    # Channel sequence (email may be one step in a multi-channel sequence)
    channel_sequence: list[dict[str, str]] = field(default_factory=list)
    # e.g. [{"channel": "email", "role": "rep", "asset": "AS-BIK-002"},
    #       {"channel": "in_person", "role": "msl", "asset": "AS-BIK-001"}]

    # Delivery metrics (Level 0 — weak signals)
    emails_sent: int = 0
    emails_opened: int = 0
    links_clicked: int = 0

    # Engagement metrics (Level 1 — medium signals)
    replies_received: int = 0
    interactions_triggered: int = 0  # downstream interactions caused by email

    # Task completion metrics (Level 2 — SUPREMACY)
    barrier_resolved: bool = False
    question_answered: bool = False
    journey_advanced: bool = False
    completion_timestamp: Optional[str] = None

    # Value creation metrics (Level 3 — compounding)
    pattern_canonicalized: bool = False     # became an EngagementOpportunity
    derivative_created: bool = False        # pattern adopted elsewhere
    capability_magnified: bool = False      # became enterprise capability

    # Audit
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_updated: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    interaction_ids: list[str] = field(default_factory=list)  # interactions linked to this task

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "hcp_id": self.hcp_id,
            "employee_id": self.employee_id,
            "task_type": self.task_type.value,
            "status": self.status.value,
            "objective": self.objective,
            "completion_criteria": self.completion_criteria,
            "verification_method": self.verification_method,
            "barrier": self.barrier,
            "question": self.question,
            "objection": self.objection,
            "evidence_path": self.evidence_path,
            "approved_assets": self.approved_assets,
            "from_journey_state": self.from_journey_state,
            "to_journey_state": self.to_journey_state,
            "channel_sequence": self.channel_sequence,
            "emails_sent": self.emails_sent,
            "emails_opened": self.emails_opened,
            "links_clicked": self.links_clicked,
            "replies_received": self.replies_received,
            "interactions_triggered": self.interactions_triggered,
            "barrier_resolved": self.barrier_resolved,
            "question_answered": self.question_answered,
            "journey_advanced": self.journey_advanced,
            "completion_timestamp": self.completion_timestamp,
            "pattern_canonicalized": self.pattern_canonicalized,
            "derivative_created": self.derivative_created,
            "capability_magnified": self.capability_magnified,
            "created_at": self.created_at.isoformat(),
            "last_updated": self.last_updated.isoformat(),
            "interaction_ids": self.interaction_ids,
        }


# ─── Task Completion Score ───

@dataclass
class TaskCompletionScore:
    """The supremacy score for a set of tasks.

    Replaces open-rate / click-rate with task-completion-rate as the primary metric.
    """
    total_tasks: int = 0
    completed: int = 0
    verified: int = 0
    failed: int = 0
    expired: int = 0
    pending: int = 0

    # Rates
    completion_rate: float = 0.0       # completed / total — THE SUPREMACY METRIC
    verification_rate: float = 0.0     # verified / total — independent confirmation
    failure_rate: float = 0.0

    # Delivery metrics for comparison (to show how misleading they are)
    total_emails_sent: int = 0
    total_emails_opened: int = 0
    open_rate: float = 0.0
    click_rate: float = 0.0

    # The gap: how many emails were "successful" by delivery metrics but failed at task completion
    delivery_illusion_gap: float = 0.0  # open_rate - completion_rate

    # Value creation
    patterns_canonicalized: int = 0
    derivatives_created: int = 0
    capabilities_magnified: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_tasks": self.total_tasks,
            "completed": self.completed,
            "verified": self.verified,
            "failed": self.failed,
            "expired": self.expired,
            "pending": self.pending,
            "completion_rate": round(self.completion_rate, 4),
            "verification_rate": round(self.verification_rate, 4),
            "failure_rate": round(self.failure_rate, 4),
            "total_emails_sent": self.total_emails_sent,
            "total_emails_opened": self.total_emails_opened,
            "open_rate": round(self.open_rate, 4),
            "click_rate": round(self.click_rate, 4),
            "delivery_illusion_gap": round(self.delivery_illusion_gap, 4),
            "patterns_canonicalized": self.patterns_canonicalized,
            "derivatives_created": self.derivatives_created,
            "capabilities_magnified": self.capabilities_magnified,
        }


# ─── Task Completion Engine ───

class TaskCompletionEngine:
    """Manages email tasks and measures completion over delivery.

    The engine:
    1. Defines tasks from HCP barriers, questions, and journey gaps
    2. Routes tasks through the Franchise Knowledge Graph to find approved evidence paths
    3. Tracks delivery metrics (Level 0) but optimizes for task completion (Level 2)
    4. Verifies completion via HCP journey state transitions
    5. Surfaces the delivery illusion gap (open_rate - completion_rate)
    6. Escalates completed tasks into value creation (Level 3)
    """

    def __init__(self, franchise_kg: FranchiseKnowledgeGraph):
        self.franchise_kg = franchise_kg
        self.tasks: dict[str, EmailTask] = {}

    def define_task(
        self,
        hcp: HCPOpportunityObject,
        employee_id: str,
        task_type: TaskType = TaskType.BARRIER_RESOLUTION,
        barrier: str = "",
        question: str = "",
        objection: str = "",
        channel: str = "email",
        role: str = "rep",
    ) -> EmailTask:
        """Define a task from an HCP's current state.

        The task is not 'send an email.' The task is 'resolve this barrier / answer
        this question / advance this journey.' Email is one possible vehicle.
        """
        task = EmailTask(
            hcp_id=hcp.hcp_id,
            employee_id=employee_id,
            task_type=task_type,
            barrier=barrier or (hcp.barriers[0] if hcp.barriers else ""),
            question=question or (hcp.questions[0] if hcp.questions else ""),
            objection=objection,
            from_journey_state=hcp.journey_state.value,
        )

        # Determine objective and completion criteria based on task type
        if task_type == TaskType.BARRIER_RESOLUTION:
            task.objective = f"Resolve barrier: {task.barrier}"
            task.completion_criteria = "HCP acknowledges evidence and shows willingness to consider appropriate therapy"
            task.verification_method = "HCP journey advances to appropriate_clinical_consideration"
            task.to_journey_state = HCPJourneyState.APPROPRIATE_CLINICAL_CONSIDERATION.value

        elif task_type == TaskType.QUESTION_ANSWERED:
            task.objective = f"Answer HCP question: {task.question}"
            task.completion_criteria = "HCP receives approved evidence that directly addresses their question"
            task.verification_method = "HCP acknowledges answer or requests follow-up"
            task.to_journey_state = HCPJourneyState.EDUCATED.value

        elif task_type == TaskType.OBJECTION_OVERCOME:
            task.objective = f"Overcome objection: {task.objection}"
            task.completion_criteria = "HCP withdraws or modifies objection after receiving approved evidence"
            task.verification_method = "Objection removed from HCP barrier list or journey advances"
            task.to_journey_state = HCPJourneyState.EVIDENCE_DELIVERED.value

        elif task_type == TaskType.JOURNEY_ADVANCEMENT:
            # Find the next valid journey state
            valid_next = HCP_TRANSITIONS.get(hcp.journey_state, [])
            if valid_next:
                target = valid_next[0]
                task.objective = f"Advance HCP from {hcp.journey_state.value} to {target.value}"
                task.completion_criteria = f"HCP transitions to {target.value}"
                task.verification_method = "Journey state transition recorded with receipt"
                task.to_journey_state = target.value
            else:
                task.objective = "Maintain engagement"
                task.completion_criteria = "HCP remains engaged"
                task.verification_method = "No disengagement"

        elif task_type == TaskType.EVIDENCE_DELIVERY:
            task.objective = f"Deliver approved evidence for: {task.barrier or task.question}"
            task.completion_criteria = "Approved evidence delivered via permitted channel by authorized role"
            task.verification_method = "Interaction recorded with evidence_id and approved_asset_id"
            task.to_journey_state = HCPJourneyState.EVIDENCE_DELIVERED.value

        # Route through franchise knowledge graph to find the approved evidence path
        query = task.barrier or task.question or task.objection
        if query:
            path = self.franchise_kg.find_evidence_path(query, channel=channel, role=role)
            if path:
                task.evidence_path = path.to_dict()
                task.approved_assets = [a["asset_id"] for a in path.assets]
                # Build the channel sequence from the evidence path
                task.channel_sequence = [{
                    "channel": channel,
                    "role": role,
                    "asset": a["asset_id"],
                    "evidence": e["evidence_id"],
                } for a in path.assets for e in path.evidence if e["evidence_id"] in a.get("evidence_refs", [])]

        self.tasks[task.task_id] = task
        return task

    def record_delivery(self, task_id: str, opened: bool = False, clicked: bool = False) -> None:
        """Record Level 0 delivery metrics. These are weak signals."""
        task = self.tasks.get(task_id)
        if not task:
            return
        task.emails_sent += 1
        if opened:
            task.emails_opened += 1
        if clicked:
            task.links_clicked += 1
        if task.status == TaskStatus.DEFINED:
            task.status = TaskStatus.ATTEMPTED
        task.last_updated = datetime.now(timezone.utc)

    def record_engagement(self, task_id: str, replied: bool = False, interaction: Optional[HCPInteraction] = None) -> None:
        """Record Level 1 engagement metrics. Medium signals."""
        task = self.tasks.get(task_id)
        if not task:
            return
        if replied:
            task.replies_received += 1
        if interaction:
            task.interactions_triggered += 1
            task.interaction_ids.append(interaction.interaction_id)
        if task.status in (TaskStatus.DEFINED, TaskStatus.ATTEMPTED):
            task.status = TaskStatus.ENGAGED
        task.last_updated = datetime.now(timezone.utc)

    def mark_completed(self, task_id: str, barrier_resolved: bool = False,
                       question_answered: bool = False) -> None:
        """Mark a task as completed (Level 2 — SUPREMACY).

        This is the moment the email (or interaction sequence) actually achieved
        its objective — not when it was sent or opened.
        """
        task = self.tasks.get(task_id)
        if not task:
            return
        task.barrier_resolved = barrier_resolved
        task.question_answered = question_answered
        task.status = TaskStatus.COMPLETED
        task.completion_timestamp = datetime.now(timezone.utc).isoformat()
        task.last_updated = datetime.now(timezone.utc)

    def verify_completion(self, task_id: str, hcp: HCPOpportunityObject) -> bool:
        """Verify task completion via independent signal — HCP journey advancement.

        This is Level 2 verification. The task is only 'verified' when the HCP's
        journey state actually advanced to the target state. This is independent
        of whether the email was opened or clicked.
        """
        task = self.tasks.get(task_id)
        if not task:
            return False
        if task.status != TaskStatus.COMPLETED:
            return False

        if task.to_journey_state and hcp.journey_state.value == task.to_journey_state:
            task.journey_advanced = True
            task.status = TaskStatus.VERIFIED
            task.last_updated = datetime.now(timezone.utc)
            return True
        return False

    def mark_failed(self, task_id: str, reason: str = "") -> None:
        task = self.tasks.get(task_id)
        if not task:
            return
        task.status = TaskStatus.FAILED
        task.last_updated = datetime.now(timezone.utc)

    def mark_expired(self, task_id: str) -> None:
        task = self.tasks.get(task_id)
        if not task:
            return
        if task.status in (TaskStatus.DEFINED, TaskStatus.ATTEMPTED, TaskStatus.ENGAGED):
            task.status = TaskStatus.EXPIRED
            task.last_updated = datetime.now(timezone.utc)

    def canonicalize_pattern(self, task_id: str) -> None:
        """Escalate a completed task to Level 3 — value creation.

        The task's barrier → evidence → resolution pattern becomes an
        EngagementOpportunity that other employees can replicate.
        """
        task = self.tasks.get(task_id)
        if not task:
            return
        task.pattern_canonicalized = True
        task.last_updated = datetime.now(timezone.utc)

    def mark_derivative(self, task_id: str) -> None:
        task = self.tasks.get(task_id)
        if not task:
            return
        task.derivative_created = True
        task.last_updated = datetime.now(timezone.utc)

    def mark_capability(self, task_id: str) -> None:
        task = self.tasks.get(task_id)
        if not task:
            return
        task.capability_magnified = True
        task.last_updated = datetime.now(timezone.utc)

    # ─── Scoring ───

    def score(self, employee_id: Optional[str] = None, hcp_id: Optional[str] = None) -> TaskCompletionScore:
        """Compute the supremacy score.

        If employee_id is given, scores all tasks for that employee.
        If hcp_id is given, scores all tasks for that HCP.
        Otherwise scores all tasks.
        """
        tasks = list(self.tasks.values())
        if employee_id:
            tasks = [t for t in tasks if t.employee_id == employee_id]
        if hcp_id:
            tasks = [t for t in tasks if t.hcp_id == hcp_id]

        total = len(tasks)
        if total == 0:
            return TaskCompletionScore()

        completed = sum(1 for t in tasks if t.status in (TaskStatus.COMPLETED, TaskStatus.VERIFIED))
        verified = sum(1 for t in tasks if t.status == TaskStatus.VERIFIED)
        failed = sum(1 for t in tasks if t.status == TaskStatus.FAILED)
        expired = sum(1 for t in tasks if t.status == TaskStatus.EXPIRED)
        pending = total - completed - failed - expired

        total_sent = sum(t.emails_sent for t in tasks)
        total_opened = sum(t.emails_opened for t in tasks)
        total_clicked = sum(t.links_clicked for t in tasks)

        completion_rate = completed / total
        verification_rate = verified / total
        failure_rate = (failed + expired) / total
        open_rate = total_opened / max(1, total_sent)
        click_rate = total_clicked / max(1, total_sent)

        # The delivery illusion gap: how many emails looked successful but didn't complete tasks
        delivery_illusion_gap = open_rate - completion_rate

        patterns = sum(1 for t in tasks if t.pattern_canonicalized)
        derivatives = sum(1 for t in tasks if t.derivative_created)
        capabilities = sum(1 for t in tasks if t.capability_magnified)

        return TaskCompletionScore(
            total_tasks=total,
            completed=completed,
            verified=verified,
            failed=failed,
            expired=expired,
            pending=pending,
            completion_rate=completion_rate,
            verification_rate=verification_rate,
            failure_rate=failure_rate,
            total_emails_sent=total_sent,
            total_emails_opened=total_opened,
            open_rate=open_rate,
            click_rate=click_rate,
            delivery_illusion_gap=delivery_illusion_gap,
            patterns_canonicalized=patterns,
            derivatives_created=derivatives,
            capabilities_magnified=capabilities,
        )

    def supremacy_report(self, employee_id: Optional[str] = None) -> dict[str, Any]:
        """Generate a report that makes the case: task completion > delivery.

        Shows the gap between what delivery metrics claim and what actually happened.
        """
        s = self.score(employee_id=employee_id)

        return {
            "metric_hierarchy": {
                "level_0_delivery": {
                    "emails_sent": s.total_emails_sent,
                    "emails_opened": s.total_emails_opened,
                    "open_rate": round(s.open_rate, 4),
                    "click_rate": round(s.click_rate, 4),
                    "verdict": "weak signal — measures arrival, not outcome",
                },
                "level_1_engagement": {
                    "replies": sum(t.replies_received for t in self.tasks.values()
                                   if not employee_id or t.employee_id == employee_id),
                    "interactions_triggered": sum(t.interactions_triggered for t in self.tasks.values()
                                                   if not employee_id or t.employee_id == employee_id),
                    "verdict": "medium signal — measures activity, not resolution",
                },
                "level_2_task_completion": {
                    "total_tasks": s.total_tasks,
                    "completed": s.completed,
                    "verified": s.verified,
                    "completion_rate": round(s.completion_rate, 4),
                    "verification_rate": round(s.verification_rate, 4),
                    "verdict": "SUPREMACY — measures whether the objective was achieved",
                },
                "level_3_value_creation": {
                    "patterns_canonicalized": s.patterns_canonicalized,
                    "derivatives_created": s.derivatives_created,
                    "capabilities_magnified": s.capabilities_magnified,
                    "verdict": "compounding — measures organizational learning from completed tasks",
                },
            },
            "delivery_illusion_gap": {
                "open_rate": round(s.open_rate, 4),
                "completion_rate": round(s.completion_rate, 4),
                "gap": round(s.delivery_illusion_gap, 4),
                "interpretation": (
                    f"Delivery metrics suggest {s.open_rate:.0%} success. "
                    f"Task completion shows {s.completion_rate:.0%} success. "
                    f"{s.delivery_illusion_gap:.0%} of 'successful' emails did not complete their task."
                    if s.delivery_illusion_gap > 0
                    else "Delivery metrics and task completion are aligned."
                ),
            },
            "score": s.to_dict(),
        }

    def get_tasks_for_hcp(self, hcp_id: str) -> list[EmailTask]:
        return [t for t in self.tasks.values() if t.hcp_id == hcp_id]

    def get_tasks_for_employee(self, employee_id: str) -> list[EmailTask]:
        return [t for t in self.tasks.values() if t.employee_id == employee_id]

    def get_pending_tasks(self, employee_id: Optional[str] = None) -> list[EmailTask]:
        tasks = list(self.tasks.values())
        if employee_id:
            tasks = [t for t in tasks if t.employee_id == employee_id]
        return [t for t in tasks if t.status in (TaskStatus.DEFINED, TaskStatus.ATTEMPTED, TaskStatus.ENGAGED)]

    def get_verified_tasks(self, employee_id: Optional[str] = None) -> list[EmailTask]:
        tasks = list(self.tasks.values())
        if employee_id:
            tasks = [t for t in tasks if t.employee_id == employee_id]
        return [t for t in tasks if t.status == TaskStatus.VERIFIED]
