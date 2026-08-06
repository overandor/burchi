"""
Terminality Runtime — Operating system for computational continuity.

The core abstraction is not a terminal, a session, or a log.
It is an ExecutionObject: content-addressed computational state.

  Git content-addresses source code.
  IPFS content-addresses files.
  Docker content-addresses environments.
  Terminality content-addresses execution.

An ExecutionObject is the complete computational identity of work in progress.
It can be forked, merged, verified, exchanged, replayed, compressed, and resumed
— exactly like a Git commit, but for live computation.

Architecture:

  ┌─────────────────────────────────────────────────────────┐
  │                  Execution Object                        │
  │  (content-addressed computational state)                │
  ├─────────────────────────────────────────────────────────┤
  │  identity    │  hash of (state + causal parents)         │
  │  state       │  structured computational state           │
  │  causal      │  minimal chain explaining why state exists│
  │  frontier    │  what must be true to continue            │
  │  objectives  │  what this computation is trying to achieve│
  │  provenance  │  who/what produced this state             │
  ├─────────────────────────────────────────────────────────┤
  │              Four Execution Layers                       │
  ├──────────┬────────────┬────────────┬────────────────────┤
  │ Layer 1  │  Layer 2   │  Layer 3   │    Layer 4         │
  │Objective │  Causal    │  Routing   │  Deterministic     │
  │          │  Retrieval │  & Schedul │  Execution         │
  │          │            │            │                    │
  │understand│ retrieves  │ learns     │ executes, verifies,│
  │ goals    │ minimum    │ routing    │ persists state      │
  │          │ causal     │ scheduling │                     │
  │          │ evidence   │ allocation │                     │
  ├──────────┴────────────┴────────────┴────────────────────┤
  │              Renderers (projections)                     │
  ├──────────┬──────────┬──────────┬────────────────────────┤
  │ Terminal │  Web UI  │  Agent   │  Any LLM               │
  │ (PTY)    │  (HTTP)  │  (API)   │  (replaceable engine)  │
  └──────────┴──────────┴──────────┴────────────────────────┘
  │              Distribution Layer                          │
  │  peers seed unfinished computation, not files            │
  │  computation market: verify → continue → reward          │
  └─────────────────────────────────────────────────────────┘

Key distinction from the previous design:
  - Before: record execution (infrastructure)
  - Now:    BE execution (the runtime IS the product)

Models are replaceable compute engines. The runtime owns continuity.
"""

from .execution_object import (
    ExecutionObject, ExecutionState, CausalLink, Objective,
    Provenance, ExecutionGraph, ExecutionContext, ExecutionStatus,
)
from .causal_frontier import CausalFrontier, CausalReconstructor
from .runtime_layers import (
    ObjectiveLayer, CausalRetrievalLayer, RoutingLayer, DeterministicLayer,
    RuntimeStack,
)
from .computation_market import ComputationMarket, ComputationBid, ComputationSeed
from .renderers import TerminalRenderer, JSONRenderer, AgentRenderer
from .execution_graph_v2 import GraphNode, NodeKind, GraphEdge, ExecutionGraphV2
from .inference_rollups import (
    InferenceRollup, ReasoningStep, ModelIndependentState,
    RollupStatus, InferenceRollupManager,
)
from .capability_graph import Capability, CapabilityLevel, CapabilityGraph
from .execution_marketplace import (
    NodeResources, ExecutionRequirements, ExecutionScheduler,
)
from .terminality_index import TerminalityIndex, SearchResult
from .inference_mesh import (
    InferencePeer, InferenceCapabilities, InferenceMesh,
    SeededReasoning, PeerStatus,
)
from .universal_frame import (
    UniversalInferenceFrame, FrameGraph, FrameType, Provider,
    ToolCall, EnvironmentSnapshot, VerificationReceipt,
)
from .terminal_state import (
    TerminalState, TerminalStateGraph, ProcessState,
    FilesystemDelta, GitState, capture_current_state,
)
from .ledgers import (
    LedgerSystem, Ledger, LedgerEntry, LedgerType,
)
from .kernels import (
    TerminalityRuntime, TerminalKernel, InferenceKernel,
    MemoryKernel, StorageKernel, RollupKernel,
    VerificationKernel, EvolutionKernel, KernelResult, KernelStatus,
)
from .persistence import Persistence
from .llm_client import LLMClient, LLMResponse

__all__ = [
    # Core primitive
    "ExecutionObject", "ExecutionState", "CausalLink", "Objective",
    "Provenance", "ExecutionGraph", "ExecutionContext", "ExecutionStatus",
    # Causal frontier
    "CausalFrontier", "CausalReconstructor",
    # Runtime layers
    "ObjectiveLayer", "CausalRetrievalLayer", "RoutingLayer",
    "DeterministicLayer", "RuntimeStack",
    # Distribution
    "ComputationMarket", "ComputationBid", "ComputationSeed",
    # Renderers
    "TerminalRenderer", "JSONRenderer", "AgentRenderer",
    # Execution graph v2
    "GraphNode", "NodeKind", "GraphEdge", "ExecutionGraphV2",
    # Inference rollups
    "InferenceRollup", "ReasoningStep", "ModelIndependentState",
    "RollupStatus", "InferenceRollupManager",
    # Capability graph
    "Capability", "CapabilityLevel", "CapabilityGraph",
    # Execution marketplace
    "NodeResources", "ExecutionRequirements", "ExecutionScheduler",
    # Terminality index
    "TerminalityIndex", "SearchResult",
    # Inference mesh
    "InferencePeer", "InferenceCapabilities", "InferenceMesh",
    "SeededReasoning", "PeerStatus",
    # Universal inference frame
    "UniversalInferenceFrame", "FrameGraph", "FrameType", "Provider",
    "ToolCall", "EnvironmentSnapshot", "VerificationReceipt",
    # Terminal state
    "TerminalState", "TerminalStateGraph", "ProcessState",
    "FilesystemDelta", "GitState", "capture_current_state",
    # Ledgers
    "LedgerSystem", "Ledger", "LedgerEntry", "LedgerType",
    # Kernels
    "TerminalityRuntime", "TerminalKernel", "InferenceKernel",
    "MemoryKernel", "StorageKernel", "RollupKernel",
    "VerificationKernel", "EvolutionKernel", "KernelResult", "KernelStatus",
    # Persistence + LLM
    "Persistence", "LLMClient", "LLMResponse",
]
