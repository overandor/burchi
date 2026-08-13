"""Tests for the Innovation Ancestry Graph.

Tests the architectural contracts enforced in ancestry.py:
- AncestryNode / AncestryEdge data structures and to_dict
- InnovationAncestry add_employee / add_gap / add_intervention
- Edge creation and graph traversal
- compute_monster_metric (M_i = V_i + Σ α_j * V_ij^derivative)
- ancestry_chain backwards traversal
- summary counts
"""

import sys
import os

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rxreserve.ancestry import (
    AncestryNode,
    AncestryEdge,
    InnovationAncestry,
)


# ─── AncestryNode ───

def test_ancestry_node_to_dict():
    node = AncestryNode(
        node_id="emp:001",
        node_type="employee",
        label="Alice",
        value=0.0,
        metadata={"team": "oncology"},
    )
    d = node.to_dict()
    assert d["node_id"] == "emp:001"
    assert d["node_type"] == "employee"
    assert d["label"] == "Alice"
    assert d["value"] == 0.0
    assert d["metadata"] == {"team": "oncology"}


def test_ancestry_node_defaults():
    node = AncestryNode()
    assert node.node_id == ""
    assert node.node_type == ""
    assert node.value == 0.0
    assert node.metadata == {}


# ─── AncestryEdge ───

def test_ancestry_edge_to_dict():
    edge = AncestryEdge(
        source="emp:001",
        target="gap:G1",
        edge_type="discovered",
        weight=1.0,
        alpha=0.8,
    )
    d = edge.to_dict()
    assert d["source"] == "emp:001"
    assert d["target"] == "gap:G1"
    assert d["edge_type"] == "discovered"
    assert d["weight"] == 1.0
    assert d["alpha"] == 0.8


# ─── InnovationAncestry: add_employee / add_gap / add_intervention ───

def test_add_employee_creates_node():
    g = InnovationAncestry()
    g.add_employee("emp-001", name="Alice")
    assert "emp:emp-001" in g.graph
    data = g.graph.nodes["emp:emp-001"]
    assert data["node_type"] == "employee"
    assert data["label"] == "Alice"
    assert data["value"] == 0.0


def test_add_gap_creates_node():
    g = InnovationAncestry()
    g.add_gap("G1", description="Renal dosing gap")
    assert "gap:G1" in g.graph
    data = g.graph.nodes["gap:G1"]
    assert data["node_type"] == "gap"
    assert data["label"] == "Renal dosing gap"


def test_add_intervention_creates_node():
    g = InnovationAncestry()
    g.add_intervention("INT-1", description="New dosing protocol")
    assert "intv:INT-1" in g.graph
    data = g.graph.nodes["intv:INT-1"]
    assert data["node_type"] == "intervention"
    assert data["label"] == "New dosing protocol"


def test_add_experiment_and_value():
    g = InnovationAncestry()
    g.add_experiment("EXP-1", hypothesis="Protocol reduces errors")
    g.add_value("V1", amount=500_000.0, description="Cost savings")
    assert "exp:EXP-1" in g.graph
    assert g.graph.nodes["exp:EXP-1"]["node_type"] == "experiment"
    assert g.graph.nodes["val:V1"]["value"] == 500_000.0


# ─── Edges and monster metric ───

def test_full_chain_monster_metric():
    g = InnovationAncestry()
    g.add_employee("emp-001", name="Alice")
    g.add_gap("G1", description="Gap")
    g.add_intervention("INT-1", description="Intervention")
    g.add_experiment("EXP-1", hypothesis="Hypothesis")
    g.add_value("V1", amount=500_000.0, description="Direct value")
    g.add_derivative("D1", amount=2_000_000.0, description="Derivative value")

    g.employee_discovered_gap("emp-001", "G1")
    g.gap_addressed_by_intervention("G1", "INT-1")
    g.intervention_tested_by_experiment("INT-1", "EXP-1")
    g.experiment_generated_value("EXP-1", "V1", alpha=1.0)
    g.value_derived_from("D1", "V1", alpha=0.3)

    result = g.compute_monster_metric("emp-001")
    # Direct value: 500_000 * alpha(1.0) = 500_000
    assert result["direct_value"] == 500_000.0
    # Derivative: 0.3 * 1.0 * 2_000_000 = 600_000
    assert result["derivative_value"] == 600_000.0
    assert result["derivative_count"] == 1
    # M_i = 500_000 + 600_000 = 1_100_000
    assert result["M_i"] == 1_100_000.0


def test_compute_monster_metric_unknown_employee():
    g = InnovationAncestry()
    result = g.compute_monster_metric("nobody")
    assert result["M_i"] == 0.0
    assert result["direct_value"] == 0.0
    assert result["derivative_count"] == 0


# ─── ancestry_chain ───

def test_ancestry_chain_traces_back_to_employee():
    g = InnovationAncestry()
    g.add_employee("emp-001", name="Alice")
    g.add_experiment("EXP-1", hypothesis="H")
    g.add_value("V1", amount=100_000.0, description="Value")
    g.employee_participated_in_experiment("emp-001", "EXP-1", alpha=0.5)
    g.experiment_generated_value("EXP-1", "V1", alpha=1.0)

    chain = g.ancestry_chain("V1", node_type="value")
    # Should include the value node, the experiment, and the employee
    node_ids = {entry["node"] for entry in chain}
    assert "val:V1" in node_ids
    assert "exp:EXP-1" in node_ids
    assert "emp:emp-001" in node_ids


def test_ancestry_chain_unknown_returns_empty():
    g = InnovationAncestry()
    assert g.ancestry_chain("nope", node_type="value") == []


# ─── summary ───

def test_summary_counts_nodes_and_edges():
    g = InnovationAncestry()
    g.add_employee("emp-001", name="Alice")
    g.add_gap("G1", description="Gap")
    g.add_intervention("INT-1", description="Int")
    g.employee_discovered_gap("emp-001", "G1")
    g.gap_addressed_by_intervention("G1", "INT-1")
    s = g.summary()
    assert s["total_nodes"] == 3
    assert s["total_edges"] == 2
    assert s["node_types"]["employee"] == 1
    assert s["node_types"]["gap"] == 1
    assert s["node_types"]["intervention"] == 1
