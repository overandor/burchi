"""
Terminality Index — unified searchable graph.

Eventually there is no distinction between:
  - filesystem
  - process tree
  - inference tree
  - execution tree

Everything becomes one searchable graph.

Instead of searching command history, users ask:
  "Show me every successful deployment derived from this branch."
  "Which reasoning chain produced this binary?"
  "Resume the computation immediately before the failing dependency update."

The index makes the execution graph searchable by:
  - kind (process, file, inference, tool, etc.)
  - identity (name, path, model ID)
  - tags (user-defined labels)
  - causal chain (ancestors, descendants)
  - verified status
  - time range
  - natural language query (via LLM)
"""

from __future__ import annotations
import hashlib
import json
import time
import re
from dataclasses import dataclass, field, asdict
from typing import Optional, Any
from enum import Enum

from .execution_graph_v2 import GraphNode, NodeKind, ExecutionGraphV2
from .inference_rollups import InferenceRollup, InferenceRollupManager
from .capability_graph import CapabilityGraph


@dataclass
class SearchResult:
    """A single search result from the Terminality Index."""
    node: GraphNode
    score: float                # relevance score
    causal_depth: int           # how deep in the causal chain
    matched_on: list[str]       # what fields matched the query
    summary: str                # human-readable summary


class TerminalityIndex:
    """Unified searchable index over the execution graph.

    This is the query layer that makes the execution graph useful.
    Without it, the graph is just data. With it, users and agents
    can ask questions about computation history and state.

    The index supports:
    1. Structured queries (by kind, tag, identity, time)
    2. Causal queries (trace causes, effects, provenance)
    3. Natural language queries (via LLM, model-agnostic)
    4. Composite queries ("successful deployments from this branch")
    """

    def __init__(self, graph: ExecutionGraphV2,
                 rollup_manager: Optional[InferenceRollupManager] = None,
                 capability_graph: Optional[CapabilityGraph] = None):
        self.graph = graph
        self.rollups = rollup_manager or InferenceRollupManager()
        self.capabilities = capability_graph or CapabilityGraph()
        self._text_index: dict[str, list[str]] = {}  # word → [node_hashes]
        self._rebuild_index()

    def _rebuild_index(self):
        """Rebuild the full-text index from the graph."""
        self._text_index = {}
        for node in self.graph.nodes.values():
            words = self._extract_words(node)
            for word in words:
                if word not in self._text_index:
                    self._text_index[word] = []
                if node.hash not in self._text_index[word]:
                    self._text_index[word].append(node.hash)

    def _extract_words(self, node: GraphNode) -> list[str]:
        """Extract searchable words from a node."""
        text = f"{node.identity} {node.kind.value} {' '.join(node.tags)}"
        if node.data:
            text += f" {json.dumps(node.data, default=str)}"
        # Tokenize
        words = re.findall(r'[a-zA-Z0-9_./-]+', text.lower())
        return words

    def search(self, query: str,
               kind: Optional[NodeKind] = None,
               verified: Optional[bool] = None,
               limit: int = 20) -> list[SearchResult]:
        """Search the execution graph.

        Args:
            query: search string (matches identity, tags, data)
            kind: filter by node kind
            verified: filter by verification status
            limit: max results
        """
        query_words = re.findall(r'[a-zA-Z0-9_./-]+', query.lower())

        # Score nodes by word matches
        scores: dict[str, float] = {}
        for word in query_words:
            matching = self._text_index.get(word, [])
            for h in matching:
                scores[h] = scores.get(h, 0) + 1.0

        # Also match substrings in identity
        for node in self.graph.nodes.values():
            if query.lower() in node.identity.lower():
                scores[node.hash] = scores.get(node.hash, 0) + 2.0
            for tag in node.tags:
                if query.lower() in tag.lower():
                    scores[node.hash] = scores.get(node.hash, 0) + 1.5

        # Build results
        results = []
        for h, score in sorted(scores.items(), key=lambda x: -x[1]):
            node = self.graph.nodes[h]
            if kind and node.kind != kind:
                continue
            if verified is not None and node.verified != verified:
                continue

            causal_chain = self.graph.trace_causes(h)
            results.append(SearchResult(
                node=node,
                score=score,
                causal_depth=len(causal_chain),
                matched_on=[w for w in query_words
                           if w in self._extract_words(node)],
                summary=self._summarize(node),
            ))
            if len(results) >= limit:
                break

        return results

    def _summarize(self, node: GraphNode) -> str:
        """Generate a human-readable summary of a node."""
        parts = [f"[{node.kind.value}] {node.identity}"]
        if node.verified:
            parts.append("✓")
        if node.tags:
            parts.append(f"({', '.join(node.tags[:3])})")
        if node.causal_parents:
            parts.append(f"← {len(node.causal_parents)} parents")
        if node.causal_children:
            parts.append(f"→ {len(node.causal_children)} children")
        return " ".join(parts)

    def query_causal(self, hash: str, direction: str = "up",
                     depth: int = -1) -> list[SearchResult]:
        """Query causal chain — trace causes (up) or effects (down)."""
        if direction == "up":
            chain = self.graph.trace_causes(hash, depth)
        else:
            chain = self.graph.trace_effects(hash, depth)

        return [
            SearchResult(
                node=node,
                score=1.0 / (i + 1),  # closer = higher score
                causal_depth=i,
                matched_on=["causal"],
                summary=self._summarize(node),
            )
            for i, node in enumerate(chain)
        ]

    def query_successful_derived(self, branch_hash: str) -> list[SearchResult]:
        """Find all successful artifacts derived from a branch.

        'Show me every successful deployment derived from this branch.'
        """
        artifacts = self.graph.find_successful_derived(branch_hash)
        return [
            SearchResult(
                node=a,
                score=1.0,
                causal_depth=len(self.graph.trace_causes(a.hash)),
                matched_on=["successful", "derived"],
                summary=self._summarize(a),
            )
            for a in artifacts
        ]

    def query_provenance(self, artifact_hash: str) -> list[SearchResult]:
        """Find the full causal chain that produced an artifact.

        'Which reasoning chain produced this binary?'
        """
        chain = self.graph.find_provenance(artifact_hash)
        return [
            SearchResult(
                node=node,
                score=1.0 / (i + 1),
                causal_depth=i,
                matched_on=["provenance"],
                summary=self._summarize(node),
            )
            for i, node in enumerate(chain)
        ]

    def query_resume_before_failure(self, failure_hash: str) -> Optional[SearchResult]:
        """Find the last checkpoint before a failure.

        'Resume the computation immediately before the failing dependency update.'
        """
        checkpoint = self.graph.find_last_checkpoint(failure_hash)
        if checkpoint:
            return SearchResult(
                node=checkpoint,
                score=1.0,
                causal_depth=len(self.graph.trace_causes(checkpoint.hash)),
                matched_on=["checkpoint", "before_failure"],
                summary=f"Resume point: {self._summarize(checkpoint)}",
            )
        return None

    def query_by_kind(self, kind: NodeKind,
                      verified: Optional[bool] = None,
                      limit: int = 50) -> list[SearchResult]:
        """Query all nodes of a specific kind."""
        nodes = self.graph.query(kind=kind, verified=verified)
        return [
            SearchResult(
                node=n,
                score=1.0,
                causal_depth=len(self.graph.trace_causes(n.hash)),
                matched_on=[kind.value],
                summary=self._summarize(n),
            )
            for n in nodes[:limit]
        ]

    def query_natural_language(self, question: str) -> list[SearchResult]:
        """Natural language query — extract keywords and search.

        This is a simple keyword extraction approach.
        A full implementation would use an LLM to parse the question
        into structured queries and execute them.
        """
        # Extract keywords from common question patterns
        patterns = [
            (r"(?:show me|find|list).*(?:successful|completed).*(?:deployment|build|artifact)", "successful_artifacts"),
            (r"(?:which|what).*(?:reasoning|inference).*(?:produced|created|generated)", "provenance"),
            (r"(?:resume|continue).*(?:before|prior to).*(?:fail|error|crash)", "resume_before_failure"),
            (r"(?:what caused|why did).*(.{5,50})", "causal_trace"),
        ]

        for pattern, query_type in patterns:
            match = re.match(pattern, question, re.IGNORECASE)
            if match:
                if query_type == "successful_artifacts":
                    # Find all verified artifacts
                    return self.query_by_kind(NodeKind.ARTIFACT, verified=True)
                elif query_type == "provenance":
                    # Search for artifacts and trace their provenance
                    keyword = match.group(1) if match.groups() else ""
                    artifacts = self.search(keyword, kind=NodeKind.ARTIFACT)
                    results = []
                    for a in artifacts:
                        results.extend(self.query_provenance(a.node.hash))
                    return results
                elif query_type == "resume_before_failure":
                    # Find failed nodes and get their last checkpoint
                    failures = self.query_by_kind(NodeKind.FAILED_ATTEMPT)
                    results = []
                    for f in failures:
                        cp = self.query_resume_before_failure(f.node.hash)
                        if cp:
                            results.append(cp)
                    return results
                elif query_type == "causal_trace":
                    keyword = match.group(1).strip()
                    nodes = self.search(keyword)
                    results = []
                    for n in nodes:
                        results.extend(self.query_causal(n.node.hash, "up"))
                    return results

        # Fallback: keyword search
        return self.search(question)

    def stats(self) -> dict:
        return {
            "graph": self.graph.stats(),
            "indexed_words": len(self._text_index),
            "rollups": self.rollups.stats() if self.rollups else {},
            "capabilities": self.capabilities.stats() if self.capabilities else {},
        }
