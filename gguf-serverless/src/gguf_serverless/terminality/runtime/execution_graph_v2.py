"""
Execution Graph — everything causally connected.

Not command history. Not logs. An execution graph.

Every process. Every file. Every inference. Every tool.
Every dependency. Every mutation. Everything connected.

  process:nginx → file:/etc/nginx.conf → inference:optimize_config
       ↓                                      ↓
  process:nginx:reload              file:/etc/nginx.conf.optimized
       ↓                                      ↓
  verified_fact:nginx_running       causal_link:config_improved

The graph is the single source of truth. The Terminality Index
makes it searchable. The runtime traverses it to find causal
frontiers. The marketplace uses it to price computation.
"""

from __future__ import annotations
import hashlib
import json
import time
from dataclasses import dataclass, field, asdict
from typing import Optional, Any
from enum import Enum

from .execution_object import (
    ExecutionObject, ExecutionState, CausalLink,
    Objective, Provenance, ExecutionStatus,
)


class NodeKind(Enum):
    """Every kind of thing that can be in the execution graph."""
    PROCESS = "process"           # a running or historical process
    FILE = "file"                 # a file mutation
    INFERENCE = "inference"       # an LLM inference call
    TOOL = "tool"                 # a tool invocation
    COMMAND = "command"           # a shell command
    DEPENDENCY = "dependency"     # an external dependency
    MUTATION = "mutation"         # a state change
    VERIFIED_FACT = "verified_fact"  # a proven true statement
    FAILED_ATTEMPT = "failed_attempt"  # a proven false path
    CHECKPOINT = "checkpoint"     # a saved reasoning state
    CAPABILITY = "capability"     # an authority grant
    OBJECTIVE = "objective"       # a goal
    ARTIFACT = "artifact"         # a produced output (binary, doc, etc.)


@dataclass
class GraphNode:
    """A node in the execution graph.

    Every node is content-addressed. Every node has causal links.
    The graph connects everything: processes, files, inferences, tools.
    """
    kind: NodeKind
    identity: str              # unique identifier within this kind
    hash: str                  # content-addressed identity
    data: dict[str, Any] = field(default_factory=dict)  # kind-specific payload
    causal_parents: list[str] = field(default_factory=list)  # hashes of parent nodes
    causal_children: list[str] = field(default_factory=list)
    timestamp: float = field(default_factory=time.time)
    provenance: Optional[dict] = None  # who/what created this node
    verified: bool = False     # has this node been verified by the deterministic layer
    tags: list[str] = field(default_factory=list)  # searchable tags

    @classmethod
    def create(cls, kind: NodeKind, identity: str,
               data: Optional[dict] = None,
               parents: Optional[list[str]] = None,
               provenance: Optional[dict] = None,
               tags: Optional[list[str]] = None) -> "GraphNode":
        payload = {
            "kind": kind.value,
            "identity": identity,
            "data": data or {},
            "parents": parents or [],
            "timestamp": time.time(),
        }
        h = hashlib.sha256(
            json.dumps(payload, sort_keys=True, default=str).encode()
        ).hexdigest()
        return cls(
            kind=kind, identity=identity, hash=h,
            data=data or {}, causal_parents=parents or [],
            provenance=provenance, tags=tags or [],
        )

    def to_dict(self) -> dict:
        d = asdict(self)
        d["kind"] = self.kind.value
        return d


@dataclass
class GraphEdge:
    """A causal edge between graph nodes.

    Edges explain WHY, not just WHAT.
    "process:nginx was started because file:nginx.conf was modified"
    "inference:optimize was called because process:nginx was slow"
    """
    source: str        # parent hash
    target: str        # child hash
    cause: str         # human-readable causal explanation
    evidence: str      # hash of evidence supporting this causal claim
    timestamp: float = field(default_factory=time.time)


class ExecutionGraphV2:
    """The unified execution graph — everything connected.

    This replaces the separate histories (terminal, file, inference)
    with a single causal graph. Every action, every file change,
    every inference, every tool call is a node with causal links.

    Queries:
      - "What caused this file to change?" → trace causal parents
      - "What inferences led to this deployment?" → filter by kind=INFERENCE
      - "Show me every failed attempt before the success" → filter verified=False
      - "What processes depend on this file?" → trace causal children
      - "Resume the computation before the failure" → find last checkpoint before FAILED
    """

    def __init__(self):
        self.nodes: dict[str, GraphNode] = {}  # hash → node
        self.edges: list[GraphEdge] = []
        self._by_kind: dict[NodeKind, list[str]] = {}  # kind → [hashes]
        self._by_identity: dict[str, str] = {}  # "kind:identity" → hash
        self._by_tag: dict[str, list[str]] = {}  # tag → [hashes]

    def add_node(self, node: GraphNode) -> str:
        """Add a node to the graph."""
        self.nodes[node.hash] = node

        # Index by kind
        if node.kind not in self._by_kind:
            self._by_kind[node.kind] = []
        self._by_kind[node.kind].append(node.hash)

        # Index by identity
        self._by_identity[f"{node.kind.value}:{node.identity}"] = node.hash

        # Index by tags
        for tag in node.tags:
            if tag not in self._by_tag:
                self._by_tag[tag] = []
            self._by_tag[tag].append(node.hash)

        # Create edges for causal parents
        for parent_hash in node.causal_parents:
            parent = self.nodes.get(parent_hash)
            if parent:
                parent.causal_children.append(node.hash)
                self.edges.append(GraphEdge(
                    source=parent_hash,
                    target=node.hash,
                    cause=node.data.get("cause", "causal_link"),
                    evidence=node.hash,
                ))

        return node.hash

    def add_edge(self, source: str, target: str,
                 cause: str, evidence: str = "") -> GraphEdge:
        """Manually add a causal edge between existing nodes."""
        edge = GraphEdge(
            source=source, target=target,
            cause=cause, evidence=evidence or target,
        )
        self.edges.append(edge)

        source_node = self.nodes.get(source)
        target_node = self.nodes.get(target)
        if source_node and target_node:
            if target not in source_node.causal_children:
                source_node.causal_children.append(target)
            if source not in target_node.causal_parents:
                target_node.causal_parents.append(source)

        return edge

    def get(self, hash: str) -> Optional[GraphNode]:
        return self.nodes.get(hash)

    def get_by_identity(self, kind: NodeKind, identity: str) -> Optional[GraphNode]:
        h = self._by_identity.get(f"{kind.value}:{identity}")
        return self.nodes.get(h) if h else None

    def query(self, kind: Optional[NodeKind] = None,
              tag: Optional[str] = None,
              verified: Optional[bool] = None,
              identity_contains: str = "") -> list[GraphNode]:
        """Query the graph by kind, tag, verification status, or identity."""
        if kind:
            hashes = self._by_kind.get(kind, [])
        elif tag:
            hashes = self._by_tag.get(tag, [])
        else:
            hashes = list(self.nodes.keys())

        results = []
        for h in hashes:
            node = self.nodes[h]
            if verified is not None and node.verified != verified:
                continue
            if identity_contains and identity_contains not in node.identity:
                continue
            results.append(node)
        return results

    def trace_causes(self, hash: str, depth: int = -1) -> list[GraphNode]:
        """Trace causal ancestors — WHY does this node exist?"""
        chain = []
        current = self.nodes.get(hash)
        visited = set()
        d = 0
        while current and current.hash not in visited:
            if depth >= 0 and d >= depth:
                break
            chain.append(current)
            visited.add(current.hash)
            if current.causal_parents:
                current = self.nodes.get(current.causal_parents[0])
            else:
                break
            d += 1
        return chain

    def trace_effects(self, hash: str, depth: int = -1) -> list[GraphNode]:
        """Trace causal descendants — WHAT did this node cause?"""
        chain = []
        current = self.nodes.get(hash)
        visited = set()
        d = 0
        while current and current.hash not in visited:
            if depth >= 0 and d >= depth:
                break
            chain.append(current)
            visited.add(current.hash)
            if current.causal_children:
                current = self.nodes.get(current.causal_children[0])
            else:
                break
            d += 1
        return chain

    def find_last_checkpoint(self, before_hash: str) -> Optional[GraphNode]:
        """Find the last checkpoint before a given node.

        Used for: "Resume the computation immediately before the failing
        dependency update."
        """
        chain = self.trace_causes(before_hash)
        for node in chain:
            if node.kind == NodeKind.CHECKPOINT:
                return node
        return None

    def find_provenance(self, artifact_hash: str) -> list[GraphNode]:
        """Find the full causal chain that produced an artifact.

        Used for: "Which reasoning chain produced this binary?"
        """
        return self.trace_causes(artifact_hash)

    def find_successful_derived(self, branch_hash: str) -> list[GraphNode]:
        """Find all successful executions derived from a branch.

        Used for: "Show me every successful deployment derived from this branch."
        """
        descendants = self.trace_effects(branch_hash)
        return [n for n in descendants
                if n.kind == NodeKind.ARTIFACT and n.verified]

    def verify_subgraph(self, root_hash: str) -> bool:
        """Verify causal integrity of a subgraph."""
        chain = self.trace_causes(root_hash, depth=100)
        for node in chain:
            for parent in node.causal_parents:
                if parent not in self.nodes:
                    return False
        return True

    def stats(self) -> dict:
        kind_counts = {k.value: len(v) for k, v in self._by_kind.items()}
        return {
            "total_nodes": len(self.nodes),
            "total_edges": len(self.edges),
            "by_kind": kind_counts,
            "tags": list(self._by_tag.keys()),
            "verified_nodes": sum(1 for n in self.nodes.values() if n.verified),
        }
