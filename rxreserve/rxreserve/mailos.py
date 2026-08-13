"""RxMailOS — Pharmaceutical Communication Execution Layer.

The missing layer above Veeva's email/case/CRM products.

Veeva already covers:
  - Approved Email → compliant outbound HCP communication
  - Service Center → inbound email and case handling
  - MedInquiry → medical information case extraction
  - Vault CRM → commercial/customer record

What's missing is everything that happens BEFORE the employee knows which
Veeva workflow the communication belongs to, and everything that falls
BETWEEN multiple workflows.

RxMailOS provides:

  Email → Meaning → Obligation → Enterprise Action → Outcome → Evidence

Core primitives:
  1. MailObject — raw email ingested from any source
  2. DecomposedObject — 1 email → N regulated/business objects
  3. Obligation — compiled from objects: policy, clock, owner, evidence, action
  4. Commitment — extracted promise with deadline and status
  5. HCPIntent — extracted intent from HCP replies
  6. NegativeAction — what must NOT be done
  7. EngagementDiagnosis — "why did this HCP go silent?"
  8. ResponseDebt — enterprise-wide unresolved obligations
  9. CommunicationGraph — email-derived relationship graph
  10. ContentDemand — aggregated HCP content requests
  11. MailEvent — typed event on the enterprise email event bus
  12. VerificationReceipt — verified closure of an obligation
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4


# ─── Object Types (what an email can decompose into) ───

class ObjectType(enum.Enum):
    POTENTIAL_SAFETY_SIGNAL = "potential_safety_signal"
    MEDICAL_INFORMATION_REQUEST = "medical_information_request"
    ACCESS_BARRIER = "access_barrier"
    COMMERCIAL_FOLLOWUP = "commercial_followup"
    CONTENT_REQUEST = "content_request"
    SCHEDULING_INTENT = "scheduling_intent"
    HCP_RELATIONSHIP_SIGNAL = "hcp_relationship_signal"
    COMMITMENT = "commitment"
    COMPLIANCE_REVIEW_REQUIRED = "compliance_review_required"
    QUALITY_SIGNAL = "quality_signal"
    CONTENT_GAP = "content_gap"
    REFERRAL_PATHWAY = "referral_pathway"
    FORMULARY_CONCERN = "formulary_concern"
    SPEAKER_PROGRAM_REQUEST = "speaker_program_request"
    PATIENT_SUPPORT_REQUEST = "patient_support_request"
    INTERNAL_COORDINATION = "internal_coordination"


class ObjectPriority(enum.Enum):
    CRITICAL = "critical"       # safety signals, compliance
    HIGH = "high"               # medical inquiries, access barriers
    MEDIUM = "medium"           # content requests, scheduling
    LOW = "low"                 # relationship signals, coordination


class SystemOfRecord(enum.Enum):
    """Where the obligation gets routed — which Veeva domain owns it."""
    CRM = "crm"                         # Vault CRM
    MEDICAL = "medical"                 # MedInquiry / Medical Affairs
    SAFETY = "safety"                   # Safety / Pharmacovigilance
    QUALITY = "quality"                 # Quality system
    MARKET_ACCESS = "market_access"     # Market access team
    LEGAL = "legal"                     # Legal / compliance
    COMMERCIAL = "commercial"           # Commercial team
    CLINICAL = "clinical"               # Clinical operations
    COMPLIANCE = "compliance"           # Compliance
    SPEAKER_PROGRAMS = "speaker_programs"
    PATIENT_SUPPORT = "patient_support"


# ─── Obligation Status ───

class ObligationStatus(enum.Enum):
    DEFINED = "defined"           # obligation compiled but not yet assigned
    ASSIGNED = "assigned"         # owner identified
    IN_PROGRESS = "in_progress"   # action initiated
    EXECUTED = "executed"         # action completed
    VERIFIED = "verified"         # closure independently confirmed
    OVERDUE = "overdue"           # deadline passed without closure
    ESCALATED = "escalated"       # escalated per policy
    CLOSED = "closed"             # final state


class CommitmentStatus(enum.Enum):
    PROMISED = "promised"
    ASSIGNED = "assigned"
    EXECUTED = "executed"
    VERIFIED = "verified"
    OVERDUE = "overdue"
    BROKEN = "broken"


# ─── HCP Intent Types ───

class HCPIntentType(enum.Enum):
    WANTS_EVIDENCE = "wants_evidence"
    SKEPTICAL = "skeptical"
    ACCESS_PROBLEM = "access_problem"
    SCHEDULING_SIGNAL = "scheduling_signal"
    REFERRAL_PATHWAY_PROBLEM = "referral_pathway_problem"
    FORMULARY_CONCERN = "formulary_concern"
    ADVERSE_EXPERIENCE = "adverse_experience"
    TREATMENT_QUESTION = "treatment_question"
    CONTENT_FATIGUE = "content_fatigue"
    HIGH_ENGAGEMENT = "high_engagement"
    DISENGAGING = "disengaging"


# ─── Negative Action Types ───

class NegativeActionType(enum.Enum):
    DO_NOT_EMAIL = "do_not_email"
    DO_NOT_PROMOTE = "do_not_promote"
    WAIT = "wait"
    ROUTE_TO_MEDICAL = "route_to_medical"
    ROUTE_TO_SAFETY = "route_to_safety"
    ROUTE_TO_ACCESS = "route_to_access"
    ANSWER_EXISTING_QUESTION_FIRST = "answer_existing_question_first"
    REQUIRE_APPROVAL = "require_approval"
    ESCALATE = "escalate"
    DO_NOT_SEND_CAMPAIGN = "do_not_send_campaign"


# ─── Mail Event Types (Enterprise Email Event Bus) ───

class MailEventType(enum.Enum):
    MAIL_INGESTED = "mail_ingested"
    HCP_INTENT_DETECTED = "hcp_intent_detected"
    MEDICAL_REQUEST_DETECTED = "medical_request_detected"
    POTENTIAL_SAFETY_SIGNAL = "potential_safety_signal"
    QUALITY_SIGNAL = "quality_signal"
    ACCESS_BARRIER = "access_barrier"
    FOLLOWUP_COMMITMENT = "followup_commitment"
    CONTENT_REQUEST = "content_request"
    SCHEDULING_INTENT = "scheduling_intent"
    RELATIONSHIP_CHANGE = "relationship_change"
    CONTENT_GAP = "content_gap"
    COMPLIANCE_REVIEW_REQUIRED = "compliance_review_required"
    OBLIGATION_OVERDUE = "obligation_overdue"
    OBLIGATION_VERIFIED = "obligation_verified"
    COMMITMENT_BROKEN = "commitment_broken"
    HCP_DISENGAGING = "hcp_disengaging"


# ─── Core Data Structures ───

@dataclass
class MailObject:
    """A raw email ingested from any source (Outlook, shared mailbox, vendor inbox)."""
    mail_id: str = field(default_factory=lambda: str(uuid4()))
    from_address: str = ""
    from_name: str = ""
    from_type: str = ""  # hcp, rep, msl, internal, vendor, patient, hco
    to_addresses: list[str] = field(default_factory=list)
    cc_addresses: list[str] = field(default_factory=list)
    subject: str = ""
    body: str = ""
    timestamp: str = ""
    mailbox: str = ""  # which inbox this came from
    thread_id: str = ""  # email thread/conversation ID
    in_reply_to: str = ""  # mail_id of previous message in thread

    # CRM matching
    matched_hcp_id: str = ""
    matched_employee_id: str = ""
    matched_account_id: str = ""

    # Processing state
    decomposed: bool = False
    decomposed_object_ids: list[str] = field(default_factory=list)

    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "mail_id": self.mail_id,
            "from_address": self.from_address,
            "from_name": self.from_name,
            "from_type": self.from_type,
            "to_addresses": self.to_addresses,
            "cc_addresses": self.cc_addresses,
            "subject": self.subject,
            "body": self.body,
            "timestamp": self.timestamp,
            "mailbox": self.mailbox,
            "thread_id": self.thread_id,
            "in_reply_to": self.in_reply_to,
            "matched_hcp_id": self.matched_hcp_id,
            "matched_employee_id": self.matched_employee_id,
            "matched_account_id": self.matched_account_id,
            "decomposed": self.decomposed,
            "decomposed_object_ids": self.decomposed_object_ids,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class DecomposedObject:
    """One email can contain N regulated/business objects.

    This is the core primitive: 1 email → N objects.
    Each object has its own type, priority, routing, and obligation.
    """
    object_id: str = field(default_factory=lambda: str(uuid4()))
    mail_id: str = ""  # parent email
    object_type: ObjectType = ObjectType.COMMERCIAL_FOLLOWUP
    priority: ObjectPriority = ObjectPriority.MEDIUM

    # Extracted content
    summary: str = ""
    detail: str = ""
    extracted_text: str = ""  # the specific text span that triggered this object

    # Routing
    target_system: SystemOfRecord = SystemOfRecord.CRM
    target_owner: str = ""  # employee or team
    routing_confidence: float = 0.0

    # Linked entities
    hcp_id: str = ""
    employee_id: str = ""
    account_id: str = ""

    # Clinical context
    product: str = ""
    topic: str = ""
    clinical_topic: str = ""

    # Whether this generated an obligation
    obligation_id: str = ""

    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "object_id": self.object_id,
            "mail_id": self.mail_id,
            "object_type": self.object_type.value,
            "priority": self.priority.value,
            "summary": self.summary,
            "detail": self.detail,
            "extracted_text": self.extracted_text,
            "target_system": self.target_system.value,
            "target_owner": self.target_owner,
            "routing_confidence": round(self.routing_confidence, 4),
            "hcp_id": self.hcp_id,
            "employee_id": self.employee_id,
            "account_id": self.account_id,
            "product": self.product,
            "topic": self.topic,
            "clinical_topic": self.clinical_topic,
            "obligation_id": self.obligation_id,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class Obligation:
    """An obligation compiled from a decomposed object.

    message → obligation → policy → clock → owner → required evidence → system action

    This is the strongest feature: not classifying the email, but compiling it
    into an executable obligation with a deadline, required evidence, and
    a system-of-record action.
    """
    obligation_id: str = field(default_factory=lambda: str(uuid4()))
    object_id: str = ""  # source decomposed object
    mail_id: str = ""  # source email

    # What
    obligation_type: str = ""  # e.g. "safety_report", "medical_response", "access_resolution"
    description: str = ""
    required_action: str = ""

    # Policy
    policy_reference: str = ""  # e.g. "AE reporting within 24h per FDA"
    regulatory_context: str = ""  # e.g. "21 CFR 314.80"

    # Clock
    deadline: str = ""  # ISO datetime
    deadline_hours: float = 0.0  # hours from creation to deadline
    is_regulatory_deadline: bool = False

    # Owner
    assigned_owner: str = ""
    assigned_team: str = ""
    target_system: SystemOfRecord = SystemOfRecord.CRM

    # Evidence
    required_evidence: str = ""  # what must be produced to close
    evidence_artifact: str = ""  # the actual artifact produced

    # Status
    status: ObligationStatus = ObligationStatus.DEFINED
    status_history: list[dict[str, str]] = field(default_factory=list)

    # Escalation
    escalation_policy: str = ""
    escalated_to: str = ""

    # Verification
    verification_method: str = ""
    verified_by: str = ""
    verified_at: str = ""

    # Linkage
    hcp_id: str = ""
    employee_id: str = ""

    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    closed_at: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "obligation_id": self.obligation_id,
            "object_id": self.object_id,
            "mail_id": self.mail_id,
            "obligation_type": self.obligation_type,
            "description": self.description,
            "required_action": self.required_action,
            "policy_reference": self.policy_reference,
            "regulatory_context": self.regulatory_context,
            "deadline": self.deadline,
            "deadline_hours": self.deadline_hours,
            "is_regulatory_deadline": self.is_regulatory_deadline,
            "assigned_owner": self.assigned_owner,
            "assigned_team": self.assigned_team,
            "target_system": self.target_system.value,
            "required_evidence": self.required_evidence,
            "evidence_artifact": self.evidence_artifact,
            "status": self.status.value,
            "status_history": self.status_history,
            "escalation_policy": self.escalation_policy,
            "escalated_to": self.escalated_to,
            "verification_method": self.verification_method,
            "verified_by": self.verified_by,
            "verified_at": self.verified_at,
            "hcp_id": self.hcp_id,
            "employee_id": self.employee_id,
            "created_at": self.created_at.isoformat(),
            "closed_at": self.closed_at,
        }


@dataclass
class Commitment:
    """A promise extracted from email communication.

    The inbox becomes a commitment ledger.
    """
    commitment_id: str = field(default_factory=lambda: str(uuid4()))
    mail_id: str = ""

    promisor: str = ""  # who made the promise
    promisor_type: str = ""  # employee, hcp, vendor
    recipient: str = ""  # who received the promise
    recipient_type: str = ""  # hcp, employee, internal

    requested_action: str = ""
    deadline: str = ""
    regulatory_context: str = ""

    # System owner
    system_owner: SystemOfRecord = SystemOfRecord.CRM
    linked_obligation_id: str = ""

    status: CommitmentStatus = CommitmentStatus.PROMISED
    evidence: str = ""  # proof of execution
    verified_at: str = ""

    hcp_id: str = ""
    employee_id: str = ""

    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "commitment_id": self.commitment_id,
            "mail_id": self.mail_id,
            "promisor": self.promisor,
            "promisor_type": self.promisor_type,
            "recipient": self.recipient,
            "recipient_type": self.recipient_type,
            "requested_action": self.requested_action,
            "deadline": self.deadline,
            "regulatory_context": self.regulatory_context,
            "system_owner": self.system_owner.value,
            "linked_obligation_id": self.linked_obligation_id,
            "status": self.status.value,
            "evidence": self.evidence,
            "verified_at": self.verified_at,
            "hcp_id": self.hcp_id,
            "employee_id": self.employee_id,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class HCPIntent:
    """Intent extracted from an HCP's email reply.

    The economic intelligence is inside the reply, not the send.
    """
    intent_id: str = field(default_factory=lambda: str(uuid4()))
    mail_id: str = ""
    hcp_id: str = ""

    intent_type: HCPIntentType = HCPIntentType.TREATMENT_QUESTION
    confidence: float = 0.0
    summary: str = ""
    detail: str = ""
    extracted_text: str = ""

    # What this means for the HCP relationship state
    relationship_impact: str = ""  # e.g. "positive", "negative", "neutral"
    next_best_action: str = ""
    negative_action: str = ""  # what NOT to do

    # Linked objects
    linked_obligation_ids: list[str] = field(default_factory=list)
    linked_commitment_ids: list[str] = field(default_factory=list)

    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "intent_id": self.intent_id,
            "mail_id": self.mail_id,
            "hcp_id": self.hcp_id,
            "intent_type": self.intent_type.value,
            "confidence": round(self.confidence, 4),
            "summary": self.summary,
            "detail": self.detail,
            "extracted_text": self.extracted_text,
            "relationship_impact": self.relationship_impact,
            "next_best_action": self.next_best_action,
            "negative_action": self.negative_action,
            "linked_obligation_ids": self.linked_obligation_ids,
            "linked_commitment_ids": self.linked_commitment_ids,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class NegativeAction:
    """What must the rep NOT do next?

    Reduces both noise and compliance risk.
    """
    action_id: str = field(default_factory=lambda: str(uuid4()))
    hcp_id: str = ""
    employee_id: str = ""

    action_type: NegativeActionType = NegativeActionType.DO_NOT_EMAIL
    reason: str = ""
    duration: str = ""  # e.g. "until question answered", "30 days", "permanent"
    expires_at: str = ""

    # Evidence
    source_intent_id: str = ""
    source_obligation_id: str = ""

    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "action_id": self.action_id,
            "hcp_id": self.hcp_id,
            "employee_id": self.employee_id,
            "action_type": self.action_type.value,
            "reason": self.reason,
            "duration": self.duration,
            "expires_at": self.expires_at,
            "source_intent_id": self.source_intent_id,
            "source_obligation_id": self.source_obligation_id,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class EngagementDiagnosis:
    """Why did this HCP go silent?

    Not email analytics. Relationship-state inference.
    """
    diagnosis_id: str = field(default_factory=lambda: str(uuid4()))
    hcp_id: str = ""

    last_meaningful_reply: str = ""  # timestamp
    days_since_reply: int = 0

    # Friction factors
    friction_factors: list[str] = field(default_factory=list)
    # e.g. ["4 consecutive promotional sends", "no novel evidence delivered",
    #        "requested access question unresolved", "previous response took 8 days"]

    # Campaign history
    consecutive_promotional_sends: int = 0
    novel_evidence_delivered: bool = False
    unresolved_questions: int = 0
    avg_response_time_days: float = 0.0

    # Diagnosis
    diagnosis: str = ""
    recommended_intervention: str = ""
    recommended_negative_actions: list[str] = field(default_factory=list)

    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "diagnosis_id": self.diagnosis_id,
            "hcp_id": self.hcp_id,
            "last_meaningful_reply": self.last_meaningful_reply,
            "days_since_reply": self.days_since_reply,
            "friction_factors": self.friction_factors,
            "consecutive_promotional_sends": self.consecutive_promotional_sends,
            "novel_evidence_delivered": self.novel_evidence_delivered,
            "unresolved_questions": self.unresolved_questions,
            "avg_response_time_days": round(self.avg_response_time_days, 1),
            "diagnosis": self.diagnosis,
            "recommended_intervention": self.recommended_intervention,
            "recommended_negative_actions": self.recommended_negative_actions,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class ResponseDebt:
    """Enterprise-wide graph of unanswered obligations.

    Priority = RegulatoryRisk × TimeSensitivity × RelationshipValue × BusinessImpact
    """
    total_obligations: int = 0
    unresolved: int = 0
    overdue: int = 0
    escalated: int = 0
    verified: int = 0
    closed: int = 0

    # By type
    by_type: dict[str, int] = field(default_factory=dict)
    by_system: dict[str, int] = field(default_factory=dict)

    # Top priority debts
    top_debts: list[dict[str, Any]] = field(default_factory=list)

    # Aggregate priority score
    total_priority_score: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_obligations": self.total_obligations,
            "unresolved": self.unresolved,
            "overdue": self.overdue,
            "escalated": self.escalated,
            "verified": self.verified,
            "closed": self.closed,
            "by_type": self.by_type,
            "by_system": self.by_system,
            "top_debts": self.top_debts,
            "total_priority_score": round(self.total_priority_score, 2),
        }


@dataclass
class ContentDemand:
    """Aggregated HCP content requests — what HCPs actually want.

    Feeds Medical Affairs, Commercial, Market Access, Content strategy,
    Field training, Evidence-generation strategy.
    """
    demand_id: str = field(default_factory=lambda: str(uuid4()))

    topic: str = ""
    clinical_topic: str = ""
    product: str = ""

    # Volume
    request_count: int = 0
    unique_hcps: int = 0

    # Trend
    trend_direction: str = ""  # "up", "down", "stable"
    trend_percentage: float = 0.0

    # Content gap
    has_approved_content: bool = True
    content_gap: bool = False
    requested_artifact_type: str = ""  # e.g. "head_to_head_evidence", "real_world_data"

    # Source signals
    source_mail_ids: list[str] = field(default_factory=list)
    source_intents: list[str] = field(default_factory=list)

    # Routing
    routed_to: str = ""  # which team should act on this
    routing_rationale: str = ""

    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "demand_id": self.demand_id,
            "topic": self.topic,
            "clinical_topic": self.clinical_topic,
            "product": self.product,
            "request_count": self.request_count,
            "unique_hcps": self.unique_hcps,
            "trend_direction": self.trend_direction,
            "trend_percentage": round(self.trend_percentage, 2),
            "has_approved_content": self.has_approved_content,
            "content_gap": self.content_gap,
            "requested_artifact_type": self.requested_artifact_type,
            "source_mail_ids": self.source_mail_ids,
            "source_intents": self.source_intents,
            "routed_to": self.routed_to,
            "routing_rationale": self.routing_rationale,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class MailEvent:
    """A typed event on the enterprise email event bus.

    Systems subscribe to the events they own.
    """
    event_id: str = field(default_factory=lambda: str(uuid4()))
    event_type: MailEventType = MailEventType.MAIL_INGESTED
    mail_id: str = ""
    timestamp: str = ""

    # Payload
    payload: dict[str, Any] = field(default_factory=dict)

    # Routing
    target_systems: list[str] = field(default_factory=list)
    processed_by: list[str] = field(default_factory=list)

    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "event_type": self.event_type.value,
            "mail_id": self.mail_id,
            "timestamp": self.timestamp,
            "payload": self.payload,
            "target_systems": self.target_systems,
            "processed_by": self.processed_by,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class VerificationReceipt:
    """Verified closure of an obligation.

    Evidence that the obligation was actually fulfilled, not just marked as done.
    """
    receipt_id: str = field(default_factory=lambda: str(uuid4()))
    obligation_id: str = ""

    # What was verified
    verification_method: str = ""
    evidence_artifact: str = ""  # what was produced
    evidence_link: str = ""  # where it's stored

    # Who verified
    verified_by: str = ""
    verified_at: str = ""

    # Independent confirmation
    independent_signal: str = ""  # e.g. "HCP journey advanced", "CRM activity logged"
    independent_signal_source: str = ""

    is_verified: bool = False

    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "receipt_id": self.receipt_id,
            "obligation_id": self.obligation_id,
            "verification_method": self.verification_method,
            "evidence_artifact": self.evidence_artifact,
            "evidence_link": self.evidence_link,
            "verified_by": self.verified_by,
            "verified_at": self.verified_at,
            "independent_signal": self.independent_signal,
            "independent_signal_source": self.independent_signal_source,
            "is_verified": self.is_verified,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class InvisibleWorkChain:
    """Attribution chain for invisible work discovered in email.

    rep identifies access problem → emails internal team → gets stakeholders aligned
    → access issue resolved → HCP relationship improves → prescribing environment changes

    CRM may record the final activity without representing who caused the chain.
    """
    chain_id: str = field(default_factory=lambda: str(uuid4()))
    originating_employee: str = ""

    # The chain
    signal: str = ""  # what was detected
    signal_mail_id: str = ""
    intervention: str = ""  # what the employee did
    coalition: list[str] = field(default_factory=list)  # who was involved
    resolution: str = ""
    commercial_outcome: str = ""

    # Attribution
    attribution_chain: list[dict[str, str]] = field(default_factory=list)
    # [{employee, role, action, mail_id, timestamp}]

    # Links to LAIDER
    linked_ancestry_node: str = ""
    linked_opportunity_id: str = ""

    hcp_id: str = ""
    value: float = 0.0

    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "chain_id": self.chain_id,
            "originating_employee": self.originating_employee,
            "signal": self.signal,
            "signal_mail_id": self.signal_mail_id,
            "intervention": self.intervention,
            "coalition": self.coalition,
            "resolution": self.resolution,
            "commercial_outcome": self.commercial_outcome,
            "attribution_chain": self.attribution_chain,
            "linked_ancestry_node": self.linked_ancestry_node,
            "linked_opportunity_id": self.linked_opportunity_id,
            "hcp_id": self.hcp_id,
            "value": self.value,
            "created_at": self.created_at.isoformat(),
        }
