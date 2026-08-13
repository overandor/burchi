from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional
from uuid import uuid4

import networkx as nx


# ─── Innovation Ancestry Graph ───
# The deepest graph isn't merely: Idea → Outcome
# It's: Employee → Gap → Intervention → Experiment → Value → Derivatives → Reuse → Enterprise Capability
#
# The monster metric:
# M_i = V_i + Σ_j α_j * V_ij^derivative
#
# The employee gets recognized not only for the original $500K improvement,
# but for creating the primitive from which three other teams eventually
# generated another $8M.
#
# RxReserve remembers where enterprise progress came from.


@dataclass
class AncestryNode:
    """A node in the innovation ancestry graph."""
    node_id: str = ""
    node_type: str = ""  # employee, gap, intervention, experiment, value, derivative, capability
    label: str = ""
    value: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "node_id": self.node_id,
            "node_type": self.node_type,
            "label": self.label,
            "value": self.value,
            "metadata": self.metadata,
        }


@dataclass
class AncestryEdge:
    """An edge in the innovation ancestry graph."""
    source: str = ""
    target: str = ""
    edge_type: str = ""  # discovered, originated, validated, generated, derived_from, magnified_into
    weight: float = 1.0
    alpha: float = 1.0  # attribution coefficient for derivative value

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "target": self.target,
            "edge_type": self.edge_type,
            "weight": self.weight,
            "alpha": self.alpha,
        }


class InnovationAncestry:
    """Tracks innovation ancestry: who created what, what derived from what,
    and how much value flows back to originators.

    M_i = V_i + Σ_j α_j * V_ij^derivative
    """

    def __init__(self):
        self.graph = nx.DiGraph()

    def add_employee(self, employee_id: str, name: str = "") -> None:
        self.graph.add_node(f"emp:{employee_id}", node_type="employee", label=name, value=0.0)

    def add_gap(self, gap_id: str, description: str = "") -> None:
        self.graph.add_node(f"gap:{gap_id}", node_type="gap", label=description, value=0.0)

    def add_intervention(self, intervention_id: str, description: str = "") -> None:
        self.graph.add_node(f"intv:{intervention_id}", node_type="intervention", label=description, value=0.0)

    def add_experiment(self, experiment_id: str, hypothesis: str = "") -> None:
        self.graph.add_node(f"exp:{experiment_id}", node_type="experiment", label=hypothesis, value=0.0)

    def add_value(self, value_id: str, amount: float = 0.0, description: str = "") -> None:
        self.graph.add_node(f"val:{value_id}", node_type="value", label=description, value=amount)

    def add_derivative(self, deriv_id: str, amount: float = 0.0, description: str = "") -> None:
        self.graph.add_node(f"deriv:{deriv_id}", node_type="derivative", label=description, value=amount)

    def add_capability(self, cap_id: str, description: str = "") -> None:
        self.graph.add_node(f"cap:{cap_id}", node_type="capability", label=description, value=0.0)

    # ─── Edges ───

    def employee_discovered_gap(self, employee_id: str, gap_id: str) -> None:
        self.graph.add_edge(f"emp:{employee_id}", f"gap:{gap_id}", edge_type="discovered", alpha=1.0)

    def employee_originated_intervention(self, employee_id: str, intervention_id: str) -> None:
        self.graph.add_edge(f"emp:{employee_id}", f"intv:{intervention_id}", edge_type="originated", alpha=1.0)

    def gap_addressed_by_intervention(self, gap_id: str, intervention_id: str) -> None:
        self.graph.add_edge(f"gap:{gap_id}", f"intv:{intervention_id}", edge_type="addressed_by", alpha=1.0)

    def intervention_tested_by_experiment(self, intervention_id: str, experiment_id: str) -> None:
        self.graph.add_edge(f"intv:{intervention_id}", f"exp:{experiment_id}", edge_type="tested_by", alpha=1.0)

    def experiment_generated_value(self, experiment_id: str, value_id: str, alpha: float = 1.0) -> None:
        self.graph.add_edge(f"exp:{experiment_id}", f"val:{value_id}", edge_type="generated", alpha=alpha)

    def value_derived_from(self, derivative_id: str, original_value_id: str, alpha: float = 0.3) -> None:
        """A derivative innovation that built on an original."""
        self.graph.add_edge(f"val:{original_value_id}", f"deriv:{derivative_id}", edge_type="derived_from", alpha=alpha)

    def derivative_magnified_into_capability(self, derivative_id: str, capability_id: str) -> None:
        self.graph.add_edge(f"deriv:{derivative_id}", f"cap:{capability_id}", edge_type="magnified_into", alpha=1.0)

    def employee_participated_in_experiment(self, employee_id: str, experiment_id: str, alpha: float = 0.5) -> None:
        self.graph.add_edge(f"emp:{employee_id}", f"exp:{experiment_id}", edge_type="participated", alpha=alpha)

    # ─── Monster Metric ───

    def compute_monster_metric(self, employee_id: str) -> dict[str, Any]:
        """M_i = V_i + Σ_j α_j * V_ij^derivative

        The employee gets recognized not only for the original value,
        but for creating the primitive from which other teams generated value.
        """
        emp_node = f"emp:{employee_id}"
        if emp_node not in self.graph:
            return {"employee_id": employee_id, "M_i": 0.0, "direct_value": 0.0, "derivative_value": 0.0, "derivative_count": 0}

        # Traverse the full chain from employee to value nodes
        # employee → (originated/participated/discovered) → intervention/gap/experiment
        # → (tested_by/addressed_by/generated) → experiment/value
        # → (generated) → value
        # Collect all value nodes reachable from this employee's contributions

        def find_values_from(node: str, visited: set, depth: int = 0) -> list[tuple[str, float]]:
            """Recursively find value nodes reachable from a node."""
            if node in visited or depth > 10:
                return []
            visited.add(node)
            results = []
            for _, target, edge_data in self.graph.edges(node, data=True):
                edge_type = edge_data.get("edge_type", "")
                if edge_type == "generated":
                    val = self.graph.nodes[target].get("value", 0.0)
                    results.append((target, val))
                elif edge_type in ("tested_by", "addressed_by", "generated"):
                    results.extend(find_values_from(target, visited, depth + 1))
            return results

        def find_derivatives_from(value_node: str, visited: set, depth: int = 0) -> list[tuple[str, float, float]]:
            """Find derivative nodes reachable from a value node."""
            if value_node in visited or depth > 10:
                return []
            visited.add(value_node)
            results = []
            for _, target, edge_data in self.graph.edges(value_node, data=True):
                if edge_data.get("edge_type") == "derived_from":
                    alpha = edge_data.get("alpha", 0.3)
                    deriv_val = self.graph.nodes[target].get("value", 0.0)
                    results.append((target, deriv_val, alpha))
                    # Recursively find further derivatives
                    results.extend(find_derivatives_from(target, visited, depth + 1))
            return results

        # Direct value: follow employee's originated/participated edges to value nodes
        direct_value = 0.0
        seen_value_nodes: set[str] = set()
        all_value_nodes = []
        for _, target, edge_data in self.graph.edges(emp_node, data=True):
            if edge_data.get("edge_type") in ("originated", "participated", "discovered"):
                emp_alpha = edge_data.get("alpha", 1.0)
                values = find_values_from(target, set())
                for val_node, val_amount in values:
                    if val_node not in seen_value_nodes:
                        seen_value_nodes.add(val_node)
                        direct_value += val_amount * emp_alpha
                        all_value_nodes.append((val_node, val_amount, emp_alpha))

        # Derivative value: from each value node, follow derived_from edges
        derivative_value = 0.0
        derivative_count = 0
        derivatives = []
        seen_deriv_nodes: set[str] = set()
        for val_node, val_amount, emp_alpha in all_value_nodes:
            derivs = find_derivatives_from(val_node, set())
            for deriv_node, deriv_val, alpha in derivs:
                if deriv_node not in seen_deriv_nodes:
                    seen_deriv_nodes.add(deriv_node)
                    combined_alpha = alpha * emp_alpha
                    contribution = combined_alpha * deriv_val
                    derivative_value += contribution
                    derivative_count += 1
                    derivatives.append({
                        "derivative_id": deriv_node.replace("deriv:", ""),
                        "derivative_value": deriv_val,
                        "alpha": round(combined_alpha, 4),
                        "contribution": round(contribution, 2),
                    })

        M_i = direct_value + derivative_value

        return {
            "employee_id": employee_id,
            "M_i": round(M_i, 2),
            "direct_value": round(direct_value, 2),
            "derivative_value": round(derivative_value, 2),
            "derivative_count": derivative_count,
            "derivatives": derivatives,
        }

    def ancestry_chain(self, value_or_capability_id: str, node_type: str = "value") -> list[dict[str, Any]]:
        """Trace back from a value/capability to all originating employees.

        RxReserve remembers where enterprise progress came from.
        """
        prefix = {"value": "val", "derivative": "deriv", "capability": "cap"}.get(node_type, "val")
        target = f"{prefix}:{value_or_capability_id}"
        if target not in self.graph:
            return []

        chain = []
        # Walk backwards through the graph
        visited = set()
        stack = [target]
        while stack:
            node = stack.pop()
            if node in visited:
                continue
            visited.add(node)
            node_data = self.graph.nodes[node]
            chain.append({
                "node": node,
                "type": node_data.get("node_type", ""),
                "label": node_data.get("label", ""),
                "value": node_data.get("value", 0.0),
            })
            for predecessor in self.graph.predecessors(node):
                stack.append(predecessor)

        return chain

    def summary(self) -> dict[str, Any]:
        type_counts = {}
        for _, data in self.graph.nodes(data=True):
            t = data.get("node_type", "unknown")
            type_counts[t] = type_counts.get(t, 0) + 1
        return {
            "total_nodes": self.graph.number_of_nodes(),
            "total_edges": self.graph.number_of_edges(),
            "node_types": type_counts,
        }
