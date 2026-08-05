"""SPINOR — distributed organizational experimentation operating system.

Executable specification for event schema, hypothesis objects, attribution
claims, reinforcement-learning policy definitions, experiment-governance
workflow, and Golden Node promotion rules.
"""

from __future__ import annotations

from spinor_os.config import (
    MaturityStage,
    LoopStage,
    ExperimentStatus,
    AttributionMethod,
    ActionType,
    MissionClass,
    InteractionMode,
    StagnationTransformation,
    CENTRAL_DESIGN_LAW,
    MATURITY_LADDER,
    CANONICAL_LOOP,
    PALINDROMIC_LOOP,
    FORWARD_JOURNEY,
    REVERSE_JOURNEY,
    FORWARD_UPDATE_QUESTIONS,
    REVERSE_UPDATE_QUESTIONS,
    MISSION_CLASS_DESCRIPTIONS,
    get_logger,
)
from spinor_os.models import (
    Employee,
    PredictedEffect,
    HypothesisCard,
    Hypothesis,
    Event,
    AttributionClaim,
    Mission,
    Experiment,
    Strategy,
    GoldenNode,
)
from spinor_os.adaptation import CustomerProfile, EvidenceStream, AdaptationRecommendation
from spinor_os.causal_graph import CausalGraph
from spinor_os.rl import RLState, RLAction, RLReward, RLPolicyEngine
from spinor_os.workflow import ExperimentGovernanceWorkflow, WorkflowContext
from spinor_os.golden_node import GoldenNodeRegistry, PromotionRules, PromotionResult
from spinor_os.engine import ExperimentationOS
from spinor_os.spin import (
    SPIN,
    SPINState,
    SPINSnapshot,
    ContributionEntry,
    ContributionRole,
    HumanModification,
    PriorArtState,
    ReverseTestSpec,
    AutomationStatus,
)
from spinor_os.evidence_tiers import (
    EvidenceTier,
    EvidenceAssessment,
    compute_evidence_tier,
)
from spinor_os.spin_state_machine import (
    SPINStateMachine,
    SPINTransitionError,
    TransitionSpec,
    TransitionContext,
)

__version__ = "0.2.0"

__all__ = [
    "MaturityStage",
    "LoopStage",
    "ExperimentStatus",
    "AttributionMethod",
    "ActionType",
    "MissionClass",
    "InteractionMode",
    "StagnationTransformation",
    "CENTRAL_DESIGN_LAW",
    "MATURITY_LADDER",
    "CANONICAL_LOOP",
    "PALINDROMIC_LOOP",
    "FORWARD_JOURNEY",
    "REVERSE_JOURNEY",
    "FORWARD_UPDATE_QUESTIONS",
    "REVERSE_UPDATE_QUESTIONS",
    "MISSION_CLASS_DESCRIPTIONS",
    "get_logger",
    "Employee",
    "PredictedEffect",
    "HypothesisCard",
    "Hypothesis",
    "Event",
    "AttributionClaim",
    "Mission",
    "Experiment",
    "Strategy",
    "GoldenNode",
    "CustomerProfile",
    "EvidenceStream",
    "AdaptationRecommendation",
    "CausalGraph",
    "RLState",
    "RLAction",
    "RLReward",
    "RLPolicyEngine",
    "ExperimentGovernanceWorkflow",
    "WorkflowContext",
    "GoldenNodeRegistry",
    "PromotionRules",
    "PromotionResult",
    "ExperimentationOS",
    # SPIN schema (v0.2.0)
    "SPIN",
    "SPINState",
    "SPINSnapshot",
    "ContributionEntry",
    "ContributionRole",
    "HumanModification",
    "PriorArtState",
    "ReverseTestSpec",
    "AutomationStatus",
    # Evidence tiers
    "EvidenceTier",
    "EvidenceAssessment",
    "compute_evidence_tier",
    # SPIN state machine
    "SPINStateMachine",
    "SPINTransitionError",
    "TransitionSpec",
    "TransitionContext",
]
