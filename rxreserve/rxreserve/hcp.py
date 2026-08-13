from __future__ import annotations

import enum
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4


# ─── HCP Journey State Machine ───
# unknown → identified → qualified → engaged → educated →
# objection_discovered → evidence_delivered → appropriate_clinical_consideration →
# continued_engagement

class HCPJourneyState(enum.Enum):
    UNKNOWN = "unknown"
    IDENTIFIED = "identified"
    QUALIFIED = "qualified"
    ENGAGED = "engaged"
    EDUCATED = "educated"
    OBJECTION_DISCOVERED = "objection_discovered"
    EVIDENCE_DELIVERED = "evidence_delivered"
    APPROPRIATE_CLINICAL_CONSIDERATION = "appropriate_clinical_consideration"
    CONTINUED_ENGAGEMENT = "continued_engagement"
    DISENGAGED = "disengaged"


HCP_TRANSITIONS: dict[HCPJourneyState, list[HCPJourneyState]] = {
    HCPJourneyState.UNKNOWN: [HCPJourneyState.IDENTIFIED],
    HCPJourneyState.IDENTIFIED: [HCPJourneyState.QUALIFIED, HCPJourneyState.UNKNOWN],
    HCPJourneyState.QUALIFIED: [HCPJourneyState.ENGAGED, HCPJourneyState.IDENTIFIED],
    HCPJourneyState.ENGAGED: [HCPJourneyState.EDUCATED, HCPJourneyState.OBJECTION_DISCOVERED, HCPJourneyState.QUALIFIED],
    HCPJourneyState.EDUCATED: [HCPJourneyState.OBJECTION_DISCOVERED, HCPJourneyState.APPROPRIATE_CLINICAL_CONSIDERATION, HCPJourneyState.ENGAGED],
    HCPJourneyState.OBJECTION_DISCOVERED: [HCPJourneyState.EVIDENCE_DELIVERED, HCPJourneyState.EDUCATED],
    HCPJourneyState.EVIDENCE_DELIVERED: [HCPJourneyState.APPROPRIATE_CLINICAL_CONSIDERATION, HCPJourneyState.OBJECTION_DISCOVERED],
    HCPJourneyState.APPROPRIATE_CLINICAL_CONSIDERATION: [HCPJourneyState.CONTINUED_ENGAGEMENT, HCPJourneyState.EVIDENCE_DELIVERED],
    HCPJourneyState.CONTINUED_ENGAGEMENT: [HCPJourneyState.ENGAGED, HCPJourneyState.DISENGAGED],
    HCPJourneyState.DISENGAGED: [HCPJourneyState.IDENTIFIED, HCPJourneyState.QUALIFIED],
}


class HCPChannel(enum.Enum):
    IN_PERSON = "in_person"
    VIRTUAL_VISIT = "virtual_visit"
    PHONE = "phone"
    EMAIL = "email"
    PORTAL = "portal"
    CONFERENCE = "conference"
    MEDICAL_AFFAIRS = "medical_affairs"
    DIGITAL = "digital"


@dataclass
class HCPInteraction:
    """A single compliant interaction with an HCP."""
    interaction_id: str = field(default_factory=lambda: str(uuid4()))
    hcp_id: str = ""
    employee_id: str = ""
    channel: HCPChannel = HCPChannel.IN_PERSON
    timestamp: str = ""
    topic: str = ""
    question_raised: str = ""
    objection_raised: str = ""
    evidence_delivered: str = ""
    approved_asset_used: str = ""
    outcome: str = ""
    next_action: str = ""
    is_compliant: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "interaction_id": self.interaction_id,
            "hcp_id": self.hcp_id,
            "employee_id": self.employee_id,
            "channel": self.channel.value,
            "timestamp": self.timestamp,
            "topic": self.topic,
            "question_raised": self.question_raised,
            "objection_raised": self.objection_raised,
            "evidence_delivered": self.evidence_delivered,
            "approved_asset_used": self.approved_asset_used,
            "outcome": self.outcome,
            "next_action": self.next_action,
            "is_compliant": self.is_compliant,
        }


@dataclass
class HCPOpportunityObject:
    """Every physician becomes a continuously evolving HCP Opportunity Object.

    HCP = (context, needs, interactions, questions, barriers, channel,
           network, evidence, next_action)

    The object is not simply a CRM contact.
    """
    hcp_id: str = field(default_factory=lambda: str(uuid4()))
    name: str = ""
    specialty: str = ""
    institution: str = ""
    territory: str = ""
    npi: str = ""  # National Provider Identifier

    # Journey state
    journey_state: HCPJourneyState = HCPJourneyState.UNKNOWN

    # Context
    context: str = ""
    patient_panel_size: int = 0
    therapeutic_areas: list[str] = field(default_factory=list)

    # Needs
    needs: list[str] = field(default_factory=list)
    barriers: list[str] = field(default_factory=list)
    questions: list[str] = field(default_factory=list)

    # Interactions
    interactions: list[str] = field(default_factory=list)  # interaction_ids
    objection_history: list[dict[str, Any]] = field(default_factory=list)
    evidence_history: list[dict[str, Any]] = field(default_factory=list)

    # Channel preference
    preferred_channel: HCPChannel = HCPChannel.IN_PERSON
    best_time: str = ""

    # Network
    hcp_connections: list[str] = field(default_factory=list)  # other hcp_ids
    kol_status: bool = False
    educator_status: bool = False

    # Evidence
    approved_evidence_delivered: list[str] = field(default_factory=list)

    # Next action
    next_recommended_action: str = ""
    next_action_rationale: str = ""
    next_action_channel: HCPChannel = HCPChannel.IN_PERSON

    # Engagement metrics
    engagement_score: float = 0.0
    conversion_probability: float = 0.0
    addressable_value: float = 0.0

    # Attribution
    assigned_rep: str = ""
    assigned_msl: str = ""

    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_updated: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "hcp_id": self.hcp_id,
            "name": self.name,
            "specialty": self.specialty,
            "institution": self.institution,
            "territory": self.territory,
            "npi": self.npi,
            "journey_state": self.journey_state.value,
            "context": self.context,
            "patient_panel_size": self.patient_panel_size,
            "therapeutic_areas": self.therapeutic_areas,
            "needs": self.needs,
            "barriers": self.barriers,
            "questions": self.questions,
            "interactions": self.interactions,
            "objection_history": self.objection_history,
            "evidence_history": self.evidence_history,
            "preferred_channel": self.preferred_channel.value,
            "best_time": self.best_time,
            "hcp_connections": self.hcp_connections,
            "kol_status": self.kol_status,
            "educator_status": self.educator_status,
            "approved_evidence_delivered": self.approved_evidence_delivered,
            "next_recommended_action": self.next_recommended_action,
            "next_action_rationale": self.next_action_rationale,
            "next_action_channel": self.next_action_channel.value,
            "engagement_score": round(self.engagement_score, 4),
            "conversion_probability": round(self.conversion_probability, 4),
            "addressable_value": self.addressable_value,
            "assigned_rep": self.assigned_rep,
            "assigned_msl": self.assigned_msl,
            "created_at": self.created_at.isoformat(),
            "last_updated": self.last_updated.isoformat(),
        }


# ─── Engagement Opportunity ───
# When an employee discovers a pattern that generalizes to other HCPs

@dataclass
class EngagementOpportunity:
    """An employee discovers an engagement pattern that works.
    LAIDER canonicalizes it so other employees can join, test, sponsor, replicate.
    """
    opportunity_id: str = field(default_factory=lambda: str(uuid4()))
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Discovery
    originating_employee: str = ""
    frontier_id: str = ""  # links to RxReserve PharmaFrontier

    # The pattern
    barrier: str = ""
    intervention: str = ""
    approved_assets: list[str] = field(default_factory=list)
    sequence: str = ""  # the compliant interaction sequence
    initial_cohort_size: int = 0
    initial_success_rate: float = 0.0

    # Scale
    addressable_hcps: int = 0
    addressable_accounts: int = 0
    estimated_value: float = 0.0

    # Experiment
    proposed_experiment: str = ""
    experiment_status: str = "proposed"  # proposed, validated, scaled, rejected
    validation_cohort_size: int = 0
    validation_success_rate: float = 0.0

    # Attribution
    participants: list[str] = field(default_factory=list)
    attribution_retained: bool = True

    # Derivatives
    derivative_opportunities: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "opportunity_id": self.opportunity_id,
            "created_at": self.created_at.isoformat(),
            "originating_employee": self.originating_employee,
            "frontier_id": self.frontier_id,
            "barrier": self.barrier,
            "intervention": self.intervention,
            "approved_assets": self.approved_assets,
            "sequence": self.sequence,
            "initial_cohort_size": self.initial_cohort_size,
            "initial_success_rate": self.initial_success_rate,
            "addressable_hcps": self.addressable_hcps,
            "addressable_accounts": self.addressable_accounts,
            "estimated_value": self.estimated_value,
            "proposed_experiment": self.proposed_experiment,
            "experiment_status": self.experiment_status,
            "validation_cohort_size": self.validation_cohort_size,
            "validation_success_rate": self.validation_success_rate,
            "participants": self.participants,
            "attribution_retained": self.attribution_retained,
            "derivative_opportunities": self.derivative_opportunities,
        }
