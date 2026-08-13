from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

import networkx as nx

from rxreserve.hcp import HCPOpportunityObject, HCPInteraction, HCPJourneyState, HCPChannel


# ─── Physician Conversion Graph ───
# Instead of scoring physicians independently, build a graph of:
# HCP ↔ HCP relationships
# HCP ↔ institution
# HCP ↔ educator/KOL
# rep ↔ HCP
# MSL ↔ HCP
# account ↔ treatment pathway
# question ↔ approved evidence
# objection ↔ successful resolution
# engagement ↔ subsequent behavior


class ConversionGraph:
    """The unit of optimization is not 'who should the rep call?'

    It is: 'What sequence of compliant interactions has the greatest probability
    of resolving this HCP's information barrier?'
    """

    def __init__(self):
        self.graph = nx.DiGraph()

    def add_hcp(self, hcp: HCPOpportunityObject) -> None:
        self.graph.add_node(
            f"hcp:{hcp.hcp_id}",
            type="hcp",
            name=hcp.name,
            specialty=hcp.specialty,
            institution=hcp.institution,
            journey_state=hcp.journey_state.value,
            engagement_score=hcp.engagement_score,
            conversion_probability=hcp.conversion_probability,
            addressable_value=hcp.addressable_value,
            kol=hcp.kol_status,
            educator=hcp.educator_status,
        )

    def add_employee(self, employee_id: str, role: str = "rep", name: str = "") -> None:
        self.graph.add_node(f"emp:{employee_id}", type=role, name=name)

    def add_institution(self, institution_id: str, name: str = "") -> None:
        self.graph.add_node(f"inst:{institution_id}", type="institution", name=name)

    def add_evidence(self, evidence_id: str, topic: str = "", approved: bool = True) -> None:
        self.graph.add_node(
            f"evid:{evidence_id}",
            type="evidence",
            topic=topic,
            approved=approved,
        )

    def add_objection(self, objection_id: str, text: str = "") -> None:
        self.graph.add_node(f"obj:{objection_id}", type="objection", text=text)

    def add_treatment_pathway(self, pathway_id: str, name: str = "") -> None:
        self.graph.add_node(f"path:{pathway_id}", type="pathway", name=name)

    def add_question(self, question_id: str, text: str = "") -> None:
        self.graph.add_node(f"q:{question_id}", type="question", text=text)

    # ─── Edges ───

    def link_hcp_hcp(self, hcp1: str, hcp2: str, relationship: str = "colleague") -> None:
        self.graph.add_edge(f"hcp:{hcp1}", f"hcp:{hcp2}", relationship=relationship)

    def link_hcp_institution(self, hcp_id: str, institution_id: str) -> None:
        self.graph.add_edge(f"hcp:{hcp_id}", f"inst:{institution_id}", relationship="member")

    def link_rep_hcp(self, employee_id: str, hcp_id: str, strength: float = 0.5) -> None:
        self.graph.add_edge(f"emp:{employee_id}", f"hcp:{hcp_id}", relationship="covers", strength=strength)

    def link_msl_hcp(self, employee_id: str, hcp_id: str, strength: float = 0.5) -> None:
        self.graph.add_edge(f"emp:{employee_id}", f"hcp:{hcp_id}", relationship="scientific_engagement", strength=strength)

    def link_hcp_question(self, hcp_id: str, question_id: str) -> None:
        self.graph.add_edge(f"hcp:{hcp_id}", f"q:{question_id}", relationship="asked")

    def link_question_evidence(self, question_id: str, evidence_id: str) -> None:
        self.graph.add_edge(f"q:{question_id}", f"evid:{evidence_id}", relationship="answered_by")

    def link_hcp_objection(self, hcp_id: str, objection_id: str) -> None:
        self.graph.add_edge(f"hcp:{hcp_id}", f"obj:{objection_id}", relationship="raised")

    def link_objection_evidence(self, objection_id: str, evidence_id: str, success: bool = True) -> None:
        self.graph.add_edge(f"obj:{objection_id}", f"evid:{evidence_id}", relationship="resolved_by", success=success)

    def link_hcp_pathway(self, hcp_id: str, pathway_id: str) -> None:
        self.graph.add_edge(f"hcp:{hcp_id}", f"path:{pathway_id}", relationship="treats_via")

    def link_interaction(self, interaction: HCPInteraction) -> None:
        """Record an interaction as an edge with metadata."""
        self.graph.add_edge(
            f"emp:{interaction.employee_id}",
            f"hcp:{interaction.hcp_id}",
            relationship="interacted",
            channel=interaction.channel.value,
            topic=interaction.topic,
            question=interaction.question_raised,
            objection=interaction.objection_raised,
            evidence=interaction.evidence_delivered,
            outcome=interaction.outcome,
            timestamp=interaction.timestamp,
        )

    # ─── Queries ───

    def hcps_with_barrier(self, barrier_text: str) -> list[str]:
        """Find all HCPs with a matching objection/barrier."""
        results = []
        for node, data in self.graph.nodes(data=True):
            if data.get("type") == "hcp":
                # Check objections
                for _, target, edge_data in self.graph.edges(node, data=True):
                    if edge_data.get("relationship") == "raised":
                        obj_node = self.graph.nodes[target]
                        if barrier_text.lower() in (obj_node.get("text", "")).lower():
                            results.append(node.replace("hcp:", ""))
        return results

    def evidence_for_question(self, question_text: str) -> list[dict[str, Any]]:
        """Find approved evidence that answers a question."""
        results = []
        for node, data in self.graph.nodes(data=True):
            if data.get("type") == "question" and question_text.lower() in data.get("text", "").lower():
                for _, target, edge_data in self.graph.edges(node, data=True):
                    if edge_data.get("relationship") == "answered_by":
                        ev = self.graph.nodes[target]
                        results.append({
                            "evidence_id": target.replace("evid:", ""),
                            "topic": ev.get("topic", ""),
                            "approved": ev.get("approved", True),
                        })
        return results

    def resolution_for_objection(self, objection_text: str) -> list[dict[str, Any]]:
        """Find successful evidence that resolved a similar objection."""
        results = []
        for node, data in self.graph.nodes(data=True):
            if data.get("type") == "objection" and objection_text.lower() in data.get("text", "").lower():
                for _, target, edge_data in self.graph.edges(node, data=True):
                    if edge_data.get("relationship") == "resolved_by" and edge_data.get("success"):
                        ev = self.graph.nodes[target]
                        results.append({
                            "evidence_id": target.replace("evid:", ""),
                            "topic": ev.get("topic", ""),
                        })
        return results

    def hcp_network(self, hcp_id: str, depth: int = 2) -> list[dict[str, Any]]:
        """Get HCP's professional network up to N hops."""
        source = f"hcp:{hcp_id}"
        if source not in self.graph:
            return []
        neighbors = set()
        frontier = {source}
        for _ in range(depth):
            next_frontier = set()
            for node in frontier:
                for neighbor in self.graph.neighbors(node):
                    if neighbor not in neighbors and neighbor != source:
                        next_frontier.add(neighbor)
            neighbors |= next_frontier
            frontier = next_frontier
        return [
            {"node": n, **self.graph.nodes[n]}
            for n in neighbors
        ]

    def best_engagement_sequence(self, hcp_id: str) -> dict[str, Any]:
        """Recommend the best compliant interaction sequence for an HCP.

        Right HCP × Right evidence × Right messenger × Right moment × Right channel
        """
        source = f"hcp:{hcp_id}"
        if source not in self.graph:
            return {"recommendation": "HCP not in graph", "sequence": []}

        hcp_data = self.graph.nodes[source]
        journey = hcp_data.get("journey_state", "unknown")

        # Find open questions
        open_questions = []
        for _, target, edge_data in self.graph.edges(source, data=True):
            if edge_data.get("relationship") == "asked":
                q_data = self.graph.nodes[target]
                open_questions.append({"question": q_data.get("text", ""), "node": target})

        # Find unresolved objections
        unresolved_objections = []
        for _, target, edge_data in self.graph.edges(source, data=True):
            if edge_data.get("relationship") == "raised":
                obj_data = self.graph.nodes[target]
                has_resolution = any(
                    self.graph.edges[target, t].get("success", False)
                    for _, t, _ in self.graph.edges(target, data=True)
                    if self.graph.edges[target, t].get("relationship") == "resolved_by"
                )
                if not has_resolution:
                    unresolved_objections.append({"objection": obj_data.get("text", ""), "node": target})

        # Find successful resolutions from similar objections (from other HCPs)
        recommended_evidence = []
        for obj in unresolved_objections:
            resolutions = self.resolution_for_objection(obj["objection"])
            recommended_evidence.extend(resolutions)

        # Find best messenger (rep or MSL with strongest relationship)
        best_messenger = None
        best_strength = 0.0
        for source_edge, _, edge_data in self.graph.in_edges(source, data=True):
            if edge_data.get("relationship") in ("covers", "scientific_engagement"):
                strength = edge_data.get("strength", 0.5)
                if strength > best_strength:
                    best_strength = strength
                    best_messenger = source_edge.replace("emp:", "")

        # Build sequence
        sequence = []
        if journey == "unknown" or journey == "identified":
            sequence.append({"step": 1, "action": "Initial outreach", "channel": "in_person"})
        if open_questions:
            sequence.append({"step": 2, "action": "Address open questions with approved evidence", "evidence": recommended_evidence[:3]})
        if unresolved_objections:
            sequence.append({"step": 3, "action": "Resolve objections with successful resolution patterns", "evidence": recommended_evidence[:3]})
        if journey in ("evidence_delivered", "appropriate_clinical_consideration"):
            sequence.append({"step": 4, "action": "Follow up on clinical consideration", "channel": "medical_affairs"})

        return {
            "hcp_id": hcp_id,
            "journey_state": journey,
            "open_questions": open_questions,
            "unresolved_objections": unresolved_objections,
            "recommended_evidence": recommended_evidence[:5],
            "best_messenger": best_messenger,
            "messenger_strength": round(best_strength, 2),
            "sequence": sequence,
        }

    def summary(self) -> dict[str, Any]:
        hcp_count = sum(1 for _, d in self.graph.nodes(data=True) if d.get("type") == "hcp")
        emp_count = sum(1 for _, d in self.graph.nodes(data=True) if d.get("type") in ("rep", "msl"))
        evidence_count = sum(1 for _, d in self.graph.nodes(data=True) if d.get("type") == "evidence")
        objection_count = sum(1 for _, d in self.graph.nodes(data=True) if d.get("type") == "objection")
        question_count = sum(1 for _, d in self.graph.nodes(data=True) if d.get("type") == "question")

        return {
            "total_nodes": self.graph.number_of_nodes(),
            "total_edges": self.graph.number_of_edges(),
            "hcps": hcp_count,
            "employees": emp_count,
            "evidence_items": evidence_count,
            "objections": objection_count,
            "questions": question_count,
        }
