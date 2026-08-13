from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


# ─── Franchise Knowledge Graph ───
# For a specific franchise (Biktarvy / Descovy), maintain a controlled
# Franchise Knowledge Graph containing only rights-cleared and approved material.
#
# Every physician question gets mapped to:
# clinical topic → approved evidence → appropriate asset → authorized channel →
# appropriate company role → follow-up → outcome
#
# The agent doesn't invent a sales argument.
# It finds the best permitted evidence path.


@dataclass
class ApprovedEvidence:
    """Rights-cleared, medical-legal-regulatory approved evidence."""
    evidence_id: str = ""
    franchise: str = ""  # e.g., "Biktarvy", "Descovy"
    clinical_topic: str = ""
    indication: str = ""
    evidence_type: str = ""  # pivotal_trial, sub_study, real_world, guideline, meta_analysis
    source: str = ""
    approval_id: str = ""  # MLR approval reference
    approved_date: str = ""
    expiry_date: str = ""
    approved_channels: list[str] = field(default_factory=list)
    approved_roles: list[str] = field(default_factory=list)  # rep, msl, medical_affairs
    approved_claims: list[str] = field(default_factory=list)
    prohibited_claims: list[str] = field(default_factory=list)
    related_assets: list[str] = field(default_factory=list)
    is_active: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "evidence_id": self.evidence_id,
            "franchise": self.franchise,
            "clinical_topic": self.clinical_topic,
            "indication": self.indication,
            "evidence_type": self.evidence_type,
            "source": self.source,
            "approval_id": self.approval_id,
            "approved_date": self.approved_date,
            "expiry_date": self.expiry_date,
            "approved_channels": self.approved_channels,
            "approved_roles": self.approved_roles,
            "approved_claims": self.approved_claims,
            "prohibited_claims": self.prohibited_claims,
            "related_assets": self.related_assets,
            "is_active": self.is_active,
        }


@dataclass
class ApprovedAsset:
    """A specific approved material (slide, brochure, digital, etc.)."""
    asset_id: str = ""
    name: str = ""
    asset_type: str = ""  # detail_aid, brochure, digital, video, reprint
    franchise: str = ""
    evidence_refs: list[str] = field(default_factory=list)
    approved_channels: list[str] = field(default_factory=list)
    approved_roles: list[str] = field(default_factory=list)
    approval_id: str = ""
    is_active: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "asset_id": self.asset_id,
            "name": self.name,
            "asset_type": self.asset_type,
            "franchise": self.franchise,
            "evidence_refs": self.evidence_refs,
            "approved_channels": self.approved_channels,
            "approved_roles": self.approved_roles,
            "approval_id": self.approval_id,
            "is_active": self.is_active,
        }


@dataclass
class EvidencePath:
    """The best permitted evidence path for a physician question.

    clinical topic → approved evidence → appropriate asset →
    authorized channel → appropriate company role → follow-up → outcome
    """
    clinical_topic: str = ""
    evidence: list[ApprovedEvidence] = field(default_factory=list)
    assets: list[ApprovedAsset] = field(default_factory=list)
    channel: str = ""
    role: str = ""
    follow_up: str = ""
    expected_outcome: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "clinical_topic": self.clinical_topic,
            "evidence": [e.to_dict() for e in self.evidence],
            "assets": [a.to_dict() for a in self.assets],
            "channel": self.channel,
            "role": self.role,
            "follow_up": self.follow_up,
            "expected_outcome": self.expected_outcome,
        }


class FranchiseKnowledgeGraph:
    """Controlled knowledge graph for a specific franchise.

    Contains only rights-cleared and MLR-approved material.
    The approved evidence corpus becomes the oracle, while the agent
    optimizes navigation, sequencing, timing, and coordination.
    """

    def __init__(self, franchise: str = ""):
        self.franchise = franchise
        self.evidence: dict[str, ApprovedEvidence] = {}
        self.assets: dict[str, ApprovedAsset] = {}
        # topic → evidence_ids
        self.topic_index: dict[str, list[str]] = {}
        # question pattern → topic
        self.question_routing: dict[str, str] = {}

    def add_evidence(self, ev: ApprovedEvidence) -> None:
        self.evidence[ev.evidence_id] = ev
        topic = ev.clinical_topic.lower()
        if topic not in self.topic_index:
            self.topic_index[topic] = []
        self.topic_index[topic].append(ev.evidence_id)

    def add_asset(self, asset: ApprovedAsset) -> None:
        self.assets[asset.asset_id] = asset

    def route_question(self, question: str) -> str:
        """Route a physician question to a clinical topic."""
        q_lower = question.lower()
        for pattern, topic in self.question_routing.items():
            if pattern.lower() in q_lower:
                return topic
        # Try topic keywords
        for topic in self.topic_index:
            if topic in q_lower:
                return topic
        return ""

    def find_evidence_path(self, question: str, channel: str = "", role: str = "") -> EvidencePath:
        """Find the best permitted evidence path for a physician question.

        The agent doesn't invent a sales argument.
        It finds the best permitted evidence path.
        """
        topic = self.route_question(question)
        if not topic:
            return EvidencePath(clinical_topic="UNRESOLVED — no approved evidence for this question")

        evidence_ids = self.topic_index.get(topic, [])
        relevant_evidence = [
            self.evidence[eid] for eid in evidence_ids
            if self.evidence[eid].is_active
            and (not channel or channel in self.evidence[eid].approved_channels)
            and (not role or role in self.evidence[eid].approved_roles)
        ]

        # Find assets linked to this evidence
        relevant_assets = []
        for ev in relevant_evidence:
            for asset_id in ev.related_assets:
                if asset_id in self.assets and self.assets[asset_id].is_active:
                    relevant_assets.append(self.assets[asset_id])

        # Determine best channel and role
        if relevant_evidence:
            ev = relevant_evidence[0]
            best_channel = channel if channel in ev.approved_channels else (ev.approved_channels[0] if ev.approved_channels else "")
            best_role = role if role in ev.approved_roles else (ev.approved_roles[0] if ev.approved_roles else "")
        else:
            best_channel = channel
            best_role = role

        return EvidencePath(
            clinical_topic=topic,
            evidence=relevant_evidence,
            assets=relevant_assets,
            channel=best_channel,
            role=best_role,
            follow_up="Schedule follow-up within 2 weeks to assess clinical consideration",
            expected_outcome="appropriate_clinical_consideration",
        )

    def all_topics(self) -> list[str]:
        return list(self.topic_index.keys())

    def summary(self) -> dict[str, Any]:
        active_ev = sum(1 for e in self.evidence.values() if e.is_active)
        active_assets = sum(1 for a in self.assets.values() if a.is_active)
        return {
            "franchise": self.franchise,
            "evidence_items": len(self.evidence),
            "active_evidence": active_ev,
            "assets": len(self.assets),
            "active_assets": active_assets,
            "topics": len(self.topic_index),
        }


# ─── Default Biktarvy / Descovy seed data ───

def seed_biktarvy_descovy() -> FranchiseKnowledgeGraph:
    """Seed the franchise knowledge graph with approved evidence structure."""
    g = FranchiseKnowledgeGraph(franchise="Biktarvy/Descovy")

    # Evidence
    g.add_evidence(ApprovedEvidence(
        evidence_id="EV-BIK-001",
        franchise="Biktarvy",
        clinical_topic="efficacy_nucleotide_naive",
        indication="HIV-1 treatment-naive",
        evidence_type="pivotal_trial",
        source="GS-US-380-1489 (Study 1489)",
        approval_id="MLR-2024-001",
        approved_channels=["in_person", "virtual_visit", "portal"],
        approved_roles=["rep", "msl"],
        approved_claims=["Non-inferior to dolutegravir/abacavir/lamivudine", "High barrier to resistance"],
        prohibited_claims=["Cures HIV", "Superior to all other regimens"],
        related_assets=["AS-BIK-001"],
    ))
    g.add_evidence(ApprovedEvidence(
        evidence_id="EV-BIK-002",
        franchise="Biktarvy",
        clinical_topic="renal_safety",
        indication="HIV-1 treatment",
        evidence_type="sub_study",
        source="GS-US-380-1490 renal sub-study",
        approval_id="MLR-2024-002",
        approved_channels=["in_person", "medical_affairs"],
        approved_roles=["rep", "msl", "medical_affairs"],
        approved_claims=["No significant decline in eGFR", "Appropriate for patients with mild renal impairment"],
        prohibited_claims=["Safe for all renal impairment", "No renal monitoring needed"],
        related_assets=["AS-BIK-001", "AS-BIK-002"],
    ))
    g.add_evidence(ApprovedEvidence(
        evidence_id="EV-DES-001",
        franchise="Descovy",
        clinical_topic="PrEP_efficacy",
        indication="HIV PrEP",
        evidence_type="pivotal_trial",
        source="DISCOVER trial",
        approval_id="MLR-2024-003",
        approved_channels=["in_person", "virtual_visit"],
        approved_roles=["rep", "msl"],
        approved_claims=["Non-inferior to Truvada for PrEP", "Improved bone and renal safety vs TDF"],
        prohibited_claims=["Superior to all PrEP options", "Approved for all populations"],
        related_assets=["AS-DES-001"],
    ))
    g.add_evidence(ApprovedEvidence(
        evidence_id="EV-DES-002",
        franchise="Descovy",
        clinical_topic="PrEP_eligibility",
        indication="HIV PrEP",
        evidence_type="guideline",
        source="CDC PrEP Clinical Practice Guideline",
        approval_id="MLR-2024-004",
        approved_channels=["in_person", "portal", "email"],
        approved_roles=["rep", "msl", "medical_affairs"],
        approved_claims=["Not approved for receptive vaginal sex risk", "Follow CDC screening criteria"],
        prohibited_claims=["Approved for all PrEP populations"],
        related_assets=["AS-DES-001", "AS-DES-002"],
    ))

    # Assets
    g.add_asset(ApprovedAsset(
        asset_id="AS-BIK-001",
        name="Biktarvy Efficacy Detail Aid",
        asset_type="detail_aid",
        franchise="Biktarvy",
        evidence_refs=["EV-BIK-001", "EV-BIK-002"],
        approved_channels=["in_person", "virtual_visit"],
        approved_roles=["rep"],
        approval_id="MLR-2024-001",
    ))
    g.add_asset(ApprovedAsset(
        asset_id="AS-BIK-002",
        name="Biktarvy Renal Safety Brochure",
        asset_type="brochure",
        franchise="Biktarvy",
        evidence_refs=["EV-BIK-002"],
        approved_channels=["in_person", "medical_affairs"],
        approved_roles=["rep", "msl"],
        approval_id="MLR-2024-002",
    ))
    g.add_asset(ApprovedAsset(
        asset_id="AS-DES-001",
        name="Descovy PrEP Detail Aid",
        asset_type="detail_aid",
        franchise="Descovy",
        evidence_refs=["EV-DES-001", "EV-DES-002"],
        approved_channels=["in_person", "virtual_visit"],
        approved_roles=["rep"],
        approval_id="MLR-2024-003",
    ))
    g.add_asset(ApprovedAsset(
        asset_id="AS-DES-002",
        name="Descovy PrEP Eligibility Guide",
        asset_type="digital",
        franchise="Descovy",
        evidence_refs=["EV-DES-002"],
        approved_channels=["in_person", "portal", "email"],
        approved_roles=["rep", "msl", "medical_affairs"],
        approval_id="MLR-2024-004",
    ))

    # Question routing
    g.question_routing = {
        "efficacy": "efficacy_nucleotide_naive",
        "effective": "efficacy_nucleotide_naive",
        "how well does it work": "efficacy_nucleotide_naive",
        "treatment-naive": "efficacy_nucleotide_naive",
        "treatment naive": "efficacy_nucleotide_naive",
        "resistance": "efficacy_nucleotide_naive",
        "barrier to resistance": "efficacy_nucleotide_naive",
        "renal": "renal_safety",
        "kidney": "renal_safety",
        "egfr": "renal_safety",
        "renal safety": "renal_safety",
        "prep": "PrEP_efficacy",
        "prophylaxis": "PrEP_efficacy",
        "prevention": "PrEP_efficacy",
        "prep efficacy": "PrEP_efficacy",
        "eligibility": "PrEP_eligibility",
        "who can take": "PrEP_eligibility",
        "who should take": "PrEP_eligibility",
        "vaginal": "PrEP_eligibility",
        "cisgender women": "PrEP_eligibility",
        "indication": "PrEP_eligibility",
    }

    return g
