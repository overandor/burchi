"""Tests for the Franchise Knowledge Graph.

Tests the architectural contracts enforced in franchise.py:
- ApprovedEvidence / ApprovedAsset / EvidencePath data structures
- FranchiseKnowledgeGraph add_evidence, topic indexing, routing
- seed_biktarvy_descovy default corpus
- to_dict serialization
"""

import sys
import os

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rxreserve.franchise import (
    ApprovedEvidence,
    ApprovedAsset,
    EvidencePath,
    FranchiseKnowledgeGraph,
    seed_biktarvy_descovy,
)


# ─── ApprovedEvidence ───

def test_approved_evidence_defaults():
    ev = ApprovedEvidence()
    assert ev.evidence_id == ""
    assert ev.is_active is True
    assert ev.approved_channels == []
    assert ev.approved_claims == []


def test_approved_evidence_to_dict_roundtrip():
    ev = ApprovedEvidence(
        evidence_id="EV-TEST-001",
        franchise="Biktarvy",
        clinical_topic="efficacy",
        indication="HIV-1",
        evidence_type="pivotal_trial",
        source="Study 1489",
        approval_id="MLR-2024-001",
        approved_channels=["in_person", "virtual_visit"],
        approved_roles=["rep", "msl"],
        approved_claims=["Non-inferior to DTG"],
        prohibited_claims=["Cures HIV"],
        related_assets=["AS-TEST-001"],
    )
    d = ev.to_dict()
    assert d["evidence_id"] == "EV-TEST-001"
    assert d["franchise"] == "Biktarvy"
    assert d["approved_channels"] == ["in_person", "virtual_visit"]
    assert d["approved_roles"] == ["rep", "msl"]
    assert d["approved_claims"] == ["Non-inferior to DTG"]
    assert d["prohibited_claims"] == ["Cures HIV"]
    assert d["related_assets"] == ["AS-TEST-001"]
    assert d["is_active"] is True


# ─── ApprovedAsset ───

def test_approved_asset_to_dict():
    asset = ApprovedAsset(
        asset_id="AS-TEST-001",
        name="Test Detail Aid",
        asset_type="detail_aid",
        franchise="Biktarvy",
        evidence_refs=["EV-TEST-001"],
        approved_channels=["in_person"],
        approved_roles=["rep"],
        approval_id="MLR-2024-001",
    )
    d = asset.to_dict()
    assert d["asset_id"] == "AS-TEST-001"
    assert d["asset_type"] == "detail_aid"
    assert d["evidence_refs"] == ["EV-TEST-001"]
    assert d["is_active"] is True


# ─── FranchiseKnowledgeGraph: add_evidence ───

def test_add_evidence_indexes_by_topic():
    g = FranchiseKnowledgeGraph(franchise="Test")
    ev = ApprovedEvidence(
        evidence_id="EV-1",
        clinical_topic="Renal Safety",
        franchise="Biktarvy",
    )
    g.add_evidence(ev)
    assert "EV-1" in g.evidence
    # topic is lowercased in the index
    assert "renal safety" in g.topic_index
    assert g.topic_index["renal safety"] == ["EV-1"]


def test_add_evidence_multiple_same_topic():
    g = FranchiseKnowledgeGraph(franchise="Test")
    g.add_evidence(ApprovedEvidence(evidence_id="EV-A", clinical_topic="efficacy"))
    g.add_evidence(ApprovedEvidence(evidence_id="EV-B", clinical_topic="efficacy"))
    assert g.topic_index["efficacy"] == ["EV-A", "EV-B"]


# ─── EvidencePath ───

def test_evidence_path_to_dict_serializes_nested_objects():
    ev = ApprovedEvidence(evidence_id="EV-1", clinical_topic="efficacy")
    asset = ApprovedAsset(asset_id="AS-1", name="Aid")
    path = EvidencePath(
        clinical_topic="efficacy",
        evidence=[ev],
        assets=[asset],
        channel="in_person",
        role="rep",
        follow_up="Follow up in 2 weeks",
        expected_outcome="appropriate_clinical_consideration",
    )
    d = path.to_dict()
    assert d["clinical_topic"] == "efficacy"
    assert d["channel"] == "in_person"
    assert d["role"] == "rep"
    assert len(d["evidence"]) == 1
    assert d["evidence"][0]["evidence_id"] == "EV-1"
    assert len(d["assets"]) == 1
    assert d["assets"][0]["asset_id"] == "AS-1"


# ─── seed_biktarvy_descovy ───

def test_seed_biktarvy_descovy_populates_corpus():
    g = seed_biktarvy_descovy()
    assert g.franchise == "Biktarvy/Descovy"
    # 4 evidence items seeded
    assert len(g.evidence) == 4
    assert "EV-BIK-001" in g.evidence
    assert "EV-BIK-002" in g.evidence
    assert "EV-DES-001" in g.evidence
    assert "EV-DES-002" in g.evidence
    # 4 assets seeded
    assert len(g.assets) == 4
    assert "AS-BIK-001" in g.assets
    assert "AS-DES-002" in g.assets
    # question routing populated
    assert len(g.question_routing) > 0
    assert g.question_routing["efficacy"] == "efficacy_nucleotide_naive"


def test_seed_find_evidence_path_for_efficacy_question():
    g = seed_biktarvy_descovy()
    path = g.find_evidence_path("How well does Biktarvy work for treatment-naive patients?")
    assert path.clinical_topic == "efficacy_nucleotide_naive"
    assert len(path.evidence) >= 1
    assert path.evidence[0].evidence_id == "EV-BIK-001"
    # assets linked to the evidence should appear
    asset_ids = {a.asset_id for a in path.assets}
    assert "AS-BIK-001" in asset_ids


def test_seed_find_evidence_path_unresolved_question():
    g = seed_biktarvy_descovy()
    path = g.find_evidence_path("What is the meaning of life?")
    assert "UNRESOLVED" in path.clinical_topic
    assert path.evidence == []


def test_seed_summary_counts():
    g = seed_biktarvy_descovy()
    s = g.summary()
    assert s["franchise"] == "Biktarvy/Descovy"
    assert s["evidence_items"] == 4
    assert s["active_evidence"] == 4
    assert s["assets"] == 4
    assert s["active_assets"] == 4
    assert s["topics"] == 4
