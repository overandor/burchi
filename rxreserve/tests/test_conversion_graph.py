"""Tests for the Physician Conversion Graph.

Tests the architectural contracts enforced in conversion_graph.py:
- ConversionGraph add_hcp / add_employee / add_institution / add_evidence / add_objection
- Node creation with correct prefixed IDs and attributes
- Edge linking and query methods (hcps_with_barrier, evidence_for_question,
  resolution_for_objection, hcp_network, best_engagement_sequence)
- summary counts
"""

import sys
import os

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rxreserve.conversion_graph import ConversionGraph
from rxreserve.hcp import (
    HCPOpportunityObject,
    HCPJourneyState,
    HCPChannel,
    HCPInteraction,
)


# ─── add_hcp ───

def test_add_hcp_creates_node_with_attributes():
    g = ConversionGraph()
    hcp = HCPOpportunityObject(
        hcp_id="HCP-001",
        name="Dr. Smith",
        specialty="Infectious Disease",
        institution="General Hospital",
        journey_state=HCPJourneyState.IDENTIFIED,
        engagement_score=0.5,
        conversion_probability=0.3,
        addressable_value=100_000.0,
        kol_status=True,
        educator_status=False,
    )
    g.add_hcp(hcp)
    assert "hcp:HCP-001" in g.graph
    data = g.graph.nodes["hcp:HCP-001"]
    assert data["type"] == "hcp"
    assert data["name"] == "Dr. Smith"
    assert data["specialty"] == "Infectious Disease"
    assert data["journey_state"] == "identified"
    assert data["engagement_score"] == 0.5
    assert data["conversion_probability"] == 0.3
    assert data["addressable_value"] == 100_000.0
    assert data["kol"] is True
    assert data["educator"] is False


# ─── add_employee ───

def test_add_employee_creates_node():
    g = ConversionGraph()
    g.add_employee("emp-001", role="rep", name="Alice")
    assert "emp:emp-001" in g.graph
    data = g.graph.nodes["emp:emp-001"]
    assert data["type"] == "rep"
    assert data["name"] == "Alice"


def test_add_employee_msl_role():
    g = ConversionGraph()
    g.add_employee("emp-002", role="msl", name="Bob")
    assert g.graph.nodes["emp:emp-002"]["type"] == "msl"


# ─── add_institution ───

def test_add_institution_creates_node():
    g = ConversionGraph()
    g.add_institution("INST-1", name="Mayo Clinic")
    assert "inst:INST-1" in g.graph
    data = g.graph.nodes["inst:INST-1"]
    assert data["type"] == "institution"
    assert data["name"] == "Mayo Clinic"


# ─── add_evidence ───

def test_add_evidence_creates_node():
    g = ConversionGraph()
    g.add_evidence("EV-001", topic="efficacy", approved=True)
    assert "evid:EV-001" in g.graph
    data = g.graph.nodes["evid:EV-001"]
    assert data["type"] == "evidence"
    assert data["topic"] == "efficacy"
    assert data["approved"] is True


def test_add_evidence_unapproved():
    g = ConversionGraph()
    g.add_evidence("EV-002", topic="safety", approved=False)
    assert g.graph.nodes["evid:EV-002"]["approved"] is False


# ─── add_objection ───

def test_add_objection_creates_node():
    g = ConversionGraph()
    g.add_objection("OBJ-1", text="Too expensive")
    assert "obj:OBJ-1" in g.graph
    data = g.graph.nodes["obj:OBJ-1"]
    assert data["type"] == "objection"
    assert data["text"] == "Too expensive"


# ─── Queries: hcps_with_barrier ───

def test_hcps_with_barrier_finds_matching_objection():
    g = ConversionGraph()
    g.add_hcp(HCPOpportunityObject(hcp_id="HCP-1", name="Dr. A"))
    g.add_hcp(HCPOpportunityObject(hcp_id="HCP-2", name="Dr. B"))
    g.add_objection("OBJ-1", text="Renal safety concern")
    g.add_objection("OBJ-2", text="Cost too high")
    g.link_hcp_objection("HCP-1", "OBJ-1")
    g.link_hcp_objection("HCP-2", "OBJ-2")
    results = g.hcps_with_barrier("renal")
    assert "HCP-1" in results
    assert "HCP-2" not in results


# ─── Queries: evidence_for_question ───

def test_evidence_for_question():
    g = ConversionGraph()
    g.add_question("Q-1", text="How effective is Biktarvy?")
    g.add_evidence("EV-001", topic="efficacy", approved=True)
    g.link_question_evidence("Q-1", "EV-001")
    results = g.evidence_for_question("effective")
    assert len(results) == 1
    assert results[0]["evidence_id"] == "EV-001"
    assert results[0]["topic"] == "efficacy"
    assert results[0]["approved"] is True


# ─── Queries: resolution_for_objection ───

def test_resolution_for_objection():
    g = ConversionGraph()
    g.add_objection("OBJ-1", text="Renal safety concern")
    g.add_evidence("EV-001", topic="renal_safety", approved=True)
    g.link_objection_evidence("OBJ-1", "EV-001", success=True)
    results = g.resolution_for_objection("renal")
    assert len(results) == 1
    assert results[0]["evidence_id"] == "EV-001"
    assert results[0]["topic"] == "renal_safety"


def test_resolution_for_objection_filters_failed():
    g = ConversionGraph()
    g.add_objection("OBJ-1", text="Cost concern")
    g.add_evidence("EV-001", topic="cost", approved=True)
    g.link_objection_evidence("OBJ-1", "EV-001", success=False)
    results = g.resolution_for_objection("cost")
    assert results == []


# ─── hcp_network ───

def test_hcp_network_returns_neighbors():
    g = ConversionGraph()
    g.add_hcp(HCPOpportunityObject(hcp_id="HCP-1", name="Dr. A"))
    g.add_hcp(HCPOpportunityObject(hcp_id="HCP-2", name="Dr. B"))
    g.add_hcp(HCPOpportunityObject(hcp_id="HCP-3", name="Dr. C"))
    g.link_hcp_hcp("HCP-1", "HCP-2", relationship="colleague")
    g.link_hcp_hcp("HCP-2", "HCP-3", relationship="colleague")
    network = g.hcp_network("HCP-1", depth=2)
    node_ids = {n["node"] for n in network}
    assert "hcp:HCP-2" in node_ids
    assert "hcp:HCP-3" in node_ids
    assert "hcp:HCP-1" not in node_ids  # source excluded


def test_hcp_network_unknown_hcp_returns_empty():
    g = ConversionGraph()
    assert g.hcp_network("nope") == []


# ─── best_engagement_sequence ───

def test_best_engagement_sequence_identified_journey():
    g = ConversionGraph()
    g.add_hcp(HCPOpportunityObject(
        hcp_id="HCP-1",
        name="Dr. A",
        journey_state=HCPJourneyState.IDENTIFIED,
    ))
    g.add_employee("emp-001", role="rep", name="Alice")
    g.link_rep_hcp("emp-001", "HCP-1", strength=0.8)
    result = g.best_engagement_sequence("HCP-1")
    assert result["hcp_id"] == "HCP-1"
    assert result["journey_state"] == "identified"
    assert result["best_messenger"] == "emp-001"
    assert result["messenger_strength"] == 0.8
    # Identified journey → initial outreach step
    actions = [s["action"] for s in result["sequence"]]
    assert any("Initial outreach" in a for a in actions)


def test_best_engagement_sequence_unknown_hcp():
    g = ConversionGraph()
    result = g.best_engagement_sequence("nope")
    assert result["recommendation"] == "HCP not in graph"
    assert result["sequence"] == []


# ─── summary ───

def test_summary_counts():
    g = ConversionGraph()
    g.add_hcp(HCPOpportunityObject(hcp_id="HCP-1", name="Dr. A"))
    g.add_employee("emp-001", role="rep", name="Alice")
    g.add_institution("INST-1", name="Hospital")
    g.add_evidence("EV-001", topic="efficacy")
    g.add_objection("OBJ-1", text="cost")
    g.add_question("Q-1", text="efficacy?")
    s = g.summary()
    assert s["hcps"] == 1
    assert s["employees"] == 1
    assert s["evidence_items"] == 1
    assert s["objections"] == 1
    assert s["questions"] == 1
    assert s["total_nodes"] == 6
