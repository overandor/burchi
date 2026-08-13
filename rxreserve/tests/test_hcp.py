import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rxreserve.hcp import (
    HCPJourneyState,
    HCPChannel,
    HCPInteraction,
    HCPOpportunityObject,
    EngagementOpportunity,
    HCP_TRANSITIONS,
)


# ─── HCPJourneyState ───

def test_hcp_journey_state_values():
    assert HCPJourneyState.UNKNOWN.value == "unknown"
    assert HCPJourneyState.IDENTIFIED.value == "identified"
    assert HCPJourneyState.CONTINUED_ENGAGEMENT.value == "continued_engagement"
    assert HCPJourneyState.DISENGAGED.value == "disengaged"


def test_hcp_transitions_unknown_to_identified():
    assert HCP_TRANSITIONS[HCPJourneyState.UNKNOWN] == [HCPJourneyState.IDENTIFIED]


def test_hcp_transitions_engaged_branches():
    targets = HCP_TRANSITIONS[HCPJourneyState.ENGAGED]
    assert HCPJourneyState.EDUCATED in targets
    assert HCPJourneyState.OBJECTION_DISCOVERED in targets
    assert HCPJourneyState.QUALIFIED in targets


def test_hcp_transitions_disengaged_can_requalify():
    targets = HCP_TRANSITIONS[HCPJourneyState.DISENGAGED]
    assert HCPJourneyState.IDENTIFIED in targets
    assert HCPJourneyState.QUALIFIED in targets


# ─── HCPChannel ───

def test_hcp_channel_values():
    assert HCPChannel.IN_PERSON.value == "in_person"
    assert HCPChannel.VIRTUAL_VISIT.value == "virtual_visit"
    assert HCPChannel.MEDICAL_AFFAIRS.value == "medical_affairs"
    assert HCPChannel.DIGITAL.value == "digital"


# ─── HCPInteraction ───

def test_hcp_interaction_defaults_and_to_dict():
    inter = HCPInteraction(
        hcp_id="hcp-1",
        employee_id="emp-1",
        channel=HCPChannel.VIRTUAL_VISIT,
        topic="on-label use",
        outcome="interested",
    )
    assert inter.is_compliant is True
    assert inter.channel == HCPChannel.VIRTUAL_VISIT
    d = inter.to_dict()
    assert d["hcp_id"] == "hcp-1"
    assert d["channel"] == "virtual_visit"
    assert d["is_compliant"] is True
    assert d["topic"] == "on-label use"


def test_hcp_interaction_non_compliant():
    inter = HCPInteraction(hcp_id="hcp-2", is_compliant=False, objection_raised="safety")
    d = inter.to_dict()
    assert d["is_compliant"] is False
    assert d["objection_raised"] == "safety"


# ─── HCPOpportunityObject ───

def test_hcp_opportunity_object_defaults():
    obj = HCPOpportunityObject(name="Dr. Smith", specialty="Cardiology")
    assert obj.journey_state == HCPJourneyState.UNKNOWN
    assert obj.preferred_channel == HCPChannel.IN_PERSON
    assert obj.kol_status is False
    assert obj.engagement_score == 0.0


def test_hcp_opportunity_object_to_dict():
    obj = HCPOpportunityObject(
        name="Dr. Jones",
        specialty="Oncology",
        institution="Mayo",
        npi="1234567890",
        journey_state=HCPJourneyState.ENGAGED,
        preferred_channel=HCPChannel.PORTAL,
        engagement_score=0.723456,
        conversion_probability=0.5,
        kol_status=True,
    )
    d = obj.to_dict()
    assert d["name"] == "Dr. Jones"
    assert d["journey_state"] == "engaged"
    assert d["preferred_channel"] == "portal"
    assert d["kol_status"] is True
    # engagement_score rounded to 4 decimals
    assert d["engagement_score"] == 0.7235
    assert d["conversion_probability"] == 0.5


def test_hcp_opportunity_object_therapeutic_areas():
    obj = HCPOpportunityObject(
        therapeutic_areas=["Oncology", "Immunology"],
        needs=["efficacy data", "safety profile"],
        barriers=["time constraints"],
    )
    d = obj.to_dict()
    assert d["therapeutic_areas"] == ["Oncology", "Immunology"]
    assert d["needs"] == ["efficacy data", "safety profile"]
    assert d["barriers"] == ["time constraints"]


# ─── EngagementOpportunity ───

def test_engagement_opportunity_defaults():
    opp = EngagementOpportunity(originating_employee="emp-9", barrier="no time")
    assert opp.experiment_status == "proposed"
    assert opp.attribution_retained is True
    assert opp.initial_cohort_size == 0


def test_engagement_opportunity_to_dict():
    opp = EngagementOpportunity(
        originating_employee="emp-9",
        frontier_id="frontier-123",
        barrier="HCP lacks efficacy data",
        intervention="deliver phase 3 results",
        approved_assets=["asset-a", "asset-b"],
        initial_cohort_size=10,
        initial_success_rate=0.6,
        addressable_hcps=500,
        estimated_value=1_200_000.0,
        experiment_status="validated",
        participants=["emp-9", "emp-3"],
    )
    d = opp.to_dict()
    assert d["originating_employee"] == "emp-9"
    assert d["frontier_id"] == "frontier-123"
    assert d["approved_assets"] == ["asset-a", "asset-b"]
    assert d["initial_success_rate"] == 0.6
    assert d["experiment_status"] == "validated"
    assert d["participants"] == ["emp-9", "emp-3"]
    assert d["attribution_retained"] is True
