"""
Execution Marketplace — nodes advertise resources, scheduler routes computation.

Nodes shouldn't merely seed files. They should advertise:
  - free RAM
  - GPU
  - CPU
  - cached models
  - cached inference
  - bandwidth
  - locality

The scheduler decides where continuation happens based on:
  - resource match (does the node have what's needed?)
  - capability match (is the node authorized?)
  - locality (is the data already there?)
  - cost (what's the cheapest node that can do it?)
  - reliability (historical success rate)
  - latency (how fast can it start?)
"""

from __future__ import annotations
import hashlib
import json
import time
from dataclasses import dataclass, field, asdict
from typing import Optional, Any
from enum import Enum

from .execution_graph_v2 import GraphNode, NodeKind, ExecutionGraphV2
from .capability_graph import CapabilityGraph, CapabilityLevel
from .inference_rollups import InferenceRollup, ModelIndependentState
from .computation_market import ComputationBid, BidStatus


@dataclass
class NodeResources:
    """What a node is advertising to the market."""
    peer_id: str
    cpu_cores: int = 0
    cpu_load: float = 0.0          # 0.0-1.0, current utilization
    ram_total_mb: int = 0
    ram_available_mb: int = 0
    gpu_count: int = 0
    gpu_vram_mb: int = 0
    gpu_available: bool = False
    bandwidth_mbps: float = 0.0
    cached_models: list[str] = field(default_factory=list)  # model IDs loaded in memory
    cached_inferences: list[str] = field(default_factory=list)  # rollup hashes cached
    cached_chunks: list[str] = field(default_factory=list)  # execution object hashes
    locality_tags: list[str] = field(default_factory=list)  # "us-east", "eu-west", etc.
    reliability_score: float = 1.0  # 0.0-1.0, historical success rate
    avg_latency_ms: float = 0.0
    cost_per_hour: float = 0.0      # asking price for compute
    last_heartbeat: float = field(default_factory=time.time)

    def can_execute(self, requirements: "ExecutionRequirements") -> bool:
        """Check if this node can satisfy execution requirements."""
        if requirements.min_ram_mb and self.ram_available_mb < requirements.min_ram_mb:
            return False
        if requirements.min_cpu_cores and self.cpu_cores < requirements.min_cpu_cores:
            return False
        if requirements.requires_gpu and not self.gpu_available:
            return False
        if requirements.min_gpu_vram_mb and self.gpu_vram_mb < requirements.min_gpu_vram_mb:
            return False
        if requirements.required_model and requirements.required_model not in self.cached_models:
            return False
        if requirements.required_locality and requirements.required_locality not in self.locality_tags:
            return False
        if self.cpu_load > requirements.max_cpu_load:
            return False
        return True

    def score(self, requirements: "ExecutionRequirements") -> float:
        """Score this node for a given requirement (higher = better match)."""
        if not self.can_execute(requirements):
            return 0.0

        score = 0.0

        # Resource availability (more spare = better)
        if requirements.min_ram_mb:
            score += (self.ram_available_mb / max(1, requirements.min_ram_mb)) * 10
        if self.gpu_available and requirements.requires_gpu:
            score += 20

        # Cached model (no cold start)
        if requirements.required_model and requirements.required_model in self.cached_models:
            score += 30  # huge bonus for avoiding cold start

        # Cached inference rollup (can continue immediately)
        if requirements.required_rollup and requirements.required_rollup in self.cached_inferences:
            score += 50  # massive bonus for having the reasoning state

        # Cached chunks (data locality)
        if requirements.required_chunks:
            cached = len(set(requirements.required_chunks) & set(self.cached_chunks))
            score += cached * 5

        # Reliability
        score *= self.reliability_score

        # Cost penalty (cheaper = better)
        if self.cost_per_hour > 0:
            score /= (1 + self.cost_per_hour * 0.1)

        # Latency penalty
        score /= (1 + self.avg_latency_ms / 1000)

        # Load penalty
        score *= (1 - self.cpu_load * 0.5)

        return score

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ExecutionRequirements:
    """What a computation needs from a node."""
    min_ram_mb: int = 0
    min_cpu_cores: int = 0
    requires_gpu: bool = False
    min_gpu_vram_mb: int = 0
    required_model: Optional[str] = None
    required_rollup: Optional[str] = None        # inference rollup hash
    required_chunks: list[str] = field(default_factory=list)  # execution object hashes
    required_capabilities: list[str] = field(default_factory=list)  # capability levels
    required_locality: Optional[str] = None
    max_cpu_load: float = 0.9
    max_cost_per_hour: float = float("inf")
    deadline: Optional[float] = None  # unix timestamp

    def to_dict(self) -> dict:
        return asdict(self)


class ExecutionScheduler:
    """Scheduler that routes computation to the best node.

    The scheduler is the brain of the marketplace:
    1. Collects resource advertisements from nodes
    2. Receives execution requests with requirements
    3. Matches requests to nodes based on score
    4. Handles failures and re-routes
    5. Learns which nodes are reliable for which tasks
    """

    def __init__(self, capability_graph: Optional[CapabilityGraph] = None):
        self.nodes: dict[str, NodeResources] = {}  # peer_id → resources
        self.capabilities = capability_graph or CapabilityGraph()
        self.assignments: list[dict] = []  # history of assignments
        self.node_performance: dict[str, dict] = {}  # peer_id → performance stats

    def register_node(self, resources: NodeResources):
        """Register or update a node's resource advertisement."""
        self.nodes[resources.peer_id] = resources
        if resources.peer_id not in self.node_performance:
            self.node_performance[resources.peer_id] = {
                "tasks_assigned": 0,
                "tasks_completed": 0,
                "tasks_failed": 0,
                "avg_completion_time_s": 0.0,
                "total_reward_earned": 0.0,
            }

    def unregister_node(self, peer_id: str):
        """Remove a node from the market."""
        self.nodes.pop(peer_id, None)

    def schedule(self, requirements: ExecutionRequirements,
                 exclude: Optional[list[str]] = None) -> Optional[NodeResources]:
        """Find the best node for a computation.

        Returns the best-scoring node that:
        1. Has the required resources
        2. Has the required capabilities
        3. Has the best score (resource match + locality + cost + reliability)
        """
        exclude = exclude or []
        candidates = []

        for peer_id, resources in self.nodes.items():
            if peer_id in exclude:
                continue

            # Check resources
            if not resources.can_execute(requirements):
                continue

            # Check capabilities
            for cap_level in requirements.required_capabilities:
                if not self.capabilities.can(peer_id, CapabilityLevel(cap_level)):
                    continue

            # Score the candidate
            score = resources.score(requirements)
            if score > 0:
                candidates.append((score, resources))

        if not candidates:
            return None

        # Sort by score (highest first)
        candidates.sort(key=lambda x: x[0], reverse=True)
        best = candidates[0][1]

        # Record assignment
        self.assignments.append({
            "peer_id": best.peer_id,
            "score": candidates[0][0],
            "requirements": requirements.to_dict(),
            "timestamp": time.time(),
        })
        self.node_performance[best.peer_id]["tasks_assigned"] += 1

        return best

    def report_completion(self, peer_id: str, success: bool,
                          completion_time_s: float = 0,
                          reward: float = 0):
        """Report task completion — updates node performance stats."""
        stats = self.node_performance.get(peer_id, {})
        if success:
            stats["tasks_completed"] = stats.get("tasks_completed", 0) + 1
        else:
            stats["tasks_failed"] = stats.get("tasks_failed", 0) + 1

        total = stats.get("tasks_completed", 0) + stats.get("tasks_failed", 0)
        if total > 0:
            old_avg = stats.get("avg_completion_time_s", 0)
            stats["avg_completion_time_s"] = (
                (old_avg * (total - 1) + completion_time_s) / total
            )

        stats["total_reward_earned"] = stats.get("total_reward_earned", 0) + reward

        # Update reliability score
        if total > 0:
            self.nodes[peer_id].reliability_score = (
                stats["tasks_completed"] / total
            )

        self.node_performance[peer_id] = stats

    def get_market_state(self) -> dict:
        """Get the current state of the market."""
        return {
            "active_nodes": len(self.nodes),
            "total_assignments": len(self.assignments),
            "nodes": [
                {
                    "peer_id": r.peer_id,
                    "cpu": f"{r.cpu_cores}c ({r.cpu_load*100:.0f}% load)",
                    "ram": f"{r.ram_available_mb}/{r.ram_total_mb}MB",
                    "gpu": f"{r.gpu_count}x {r.gpu_vram_mb}MB" if r.gpu_count else "none",
                    "models": len(r.cached_models),
                    "cached_inferences": len(r.cached_inferences),
                    "reliability": f"{r.reliability_score*100:.0f}%",
                    "cost": f"${r.cost_per_hour:.2f}/hr",
                    "locality": r.locality_tags,
                }
                for r in self.nodes.values()
            ],
            "performance": self.node_performance,
        }

    def find_cheapest(self, requirements: ExecutionRequirements) -> Optional[NodeResources]:
        """Find the cheapest node that can execute."""
        candidates = []
        for r in self.nodes.values():
            if r.can_execute(requirements) and r.cost_per_hour <= requirements.max_cost_per_hour:
                candidates.append(r)
        if not candidates:
            return None
        return min(candidates, key=lambda r: r.cost_per_hour)

    def find_fastest(self, requirements: ExecutionRequirements) -> Optional[NodeResources]:
        """Find the node with lowest latency that can execute."""
        candidates = [r for r in self.nodes.values() if r.can_execute(requirements)]
        if not candidates:
            return None
        return min(candidates, key=lambda r: r.avg_latency_ms)

    def find_most_local(self, requirements: ExecutionRequirements,
                        data_hashes: list[str]) -> Optional[NodeResources]:
        """Find the node that already has the most of the required data."""
        best = None
        best_overlap = 0
        for r in self.nodes.values():
            if not r.can_execute(requirements):
                continue
            overlap = len(set(data_hashes) & set(r.cached_chunks))
            if overlap > best_overlap:
                best_overlap = overlap
                best = r
        return best
