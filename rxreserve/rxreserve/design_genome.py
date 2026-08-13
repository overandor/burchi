"""Design Genome Runtime — Core Data Models.

The system is not a dataset. It is a self-renewing capability organism:

    Discover → recognize latent value → attempt implementation →
    render → compare → mutate → retain demonstrated improvement

Three independent agents:
    Scout  — continuously discovers changing design frontiers.
    Oracle — recognizes what makes a design exceptional.
    Builder— attempts to reproduce the underlying capability in working code.

Four isolated memories:
    Observation memory      — everything the crawler found (no claim of usefulness)
    Latent-value memory     — what the Oracle believes is valuable and why
    Attempt memory          — everything the Builder tried, including failures
    Verified-capability memory — only techniques that produced measurable improvement
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from uuid import uuid4


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(prefix: str = "") -> str:
    return f"{prefix}{uuid4().hex[:12]}"


# ═══════════════════════════════════════════════════════════════
# Renderer Architecture Classification
# ═══════════════════════════════════════════════════════════════

class RendererType(str, Enum):
    DOM_CSS = "dom_css"
    SVG = "svg"
    CANVAS_2D = "canvas_2d"
    WEBGL = "webgl"
    WEBGPU = "webgpu"
    SHADER = "shader"
    THREE_JS = "three_js"
    VIDEO_SEQUENCE = "video_sequence"
    HYBRID_GPU_DOM = "hybrid_gpu_dom"
    CANVAS_SVG_HYBRID = "canvas_svg_hybrid"


# Map visual requirements to likely renderer architectures
RENDERER_CLASSIFICATION: dict[str, RendererType] = {
    "conventional_application_controls": RendererType.DOM_CSS,
    "exact_vector_instrumentation": RendererType.SVG,
    "thousands_of_animated_objects": RendererType.WEBGL,
    "volumetric_light_and_distortion": RendererType.SHADER,
    "cinematic_fixed_sequence": RendererType.VIDEO_SEQUENCE,
    "interactive_3d_environment": RendererType.THREE_JS,
    "accessible_controls_over_visual_world": RendererType.HYBRID_GPU_DOM,
    "dense_live_data_visualization": RendererType.CANVAS_SVG_HYBRID,
}


# ═══════════════════════════════════════════════════════════════
# Source Registry — provenance and compliance
# ═══════════════════════════════════════════════════════════════

class SourceCategory(str, Enum):
    EMERGING_INTERFACES = "emerging_interfaces"
    AWARD_WINNING = "award_winning"
    EXPERIMENTAL_ART_GAMES = "experimental_art_games"
    SCIENTIFIC_INSTRUMENTS = "scientific_instruments"
    AUTOMOTIVE_INTERFACES = "automotive_interfaces"
    CINEMA_TITLE_SYSTEMS = "cinema_title_systems"
    AEROSPACE_MILITARY_VIZ = "aerospace_military_viz"
    MEDICAL_IMAGING = "medical_imaging"
    INDUSTRIAL_CONTROL = "industrial_control"
    ARCHITECTURE_PRODUCTS = "architecture_products"
    HISTORICAL_INTERFACES = "historical_interfaces"
    REJECTED_BY_MAINSTREAM = "rejected_by_mainstream"


class LicenseState(str, Enum):
    OPEN = "open"
    PERMITTED = "permitted"
    RESTRICTED = "restricted"
    UNKNOWN = "unknown"
    REFERENCE_ONLY = "reference_only"


class AssetClassification(str, Enum):
    REFERENCE_ONLY = "reference_only"
    USABLE_ASSET = "usable_asset"


@dataclass
class SourceEntry:
    """A single discovered design source with full provenance."""
    source_id: str = field(default_factory=lambda: _uid("SRC-"))
    url: str = ""
    creator: str = ""
    date_discovered: str = field(default_factory=_now)
    date_published: str = ""
    category: SourceCategory = SourceCategory.EMERGING_INTERFACES
    license_state: LicenseState = LicenseState.UNKNOWN
    asset_classification: AssetClassification = AssetClassification.REFERENCE_ONLY
    robots_allowed: bool = True
    access_policy_checked: bool = False
    rate_limit_respected: bool = True
    attribution: str = ""
    provenance_chain: list[str] = field(default_factory=list)
    source_hash: str = ""
    is_duplicate: bool = False
    personal_info_removed: bool = False
    expired: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "url": self.url,
            "creator": self.creator,
            "date_discovered": self.date_discovered,
            "date_published": self.date_published,
            "category": self.category.value,
            "license_state": self.license_state.value,
            "asset_classification": self.asset_classification.value,
            "robots_allowed": self.robots_allowed,
            "access_policy_checked": self.access_policy_checked,
            "rate_limit_respected": self.rate_limit_respected,
            "attribution": self.attribution,
            "provenance_chain": self.provenance_chain,
            "source_hash": self.source_hash,
            "is_duplicate": self.is_duplicate,
            "personal_info_removed": self.personal_info_removed,
            "expired": self.expired,
            "metadata": self.metadata,
        }


# ═══════════════════════════════════════════════════════════════
# Design Observation — what the Scout captures
# ═══════════════════════════════════════════════════════════════

@dataclass
class InteractionTrace:
    """Recorded interaction sequence from a captured page."""
    trace_id: str = field(default_factory=lambda: _uid("TRC-"))
    actions: list[dict[str, Any]] = field(default_factory=list)
    scroll_depth: float = 0.0
    hover_elements: list[str] = field(default_factory=list)
    click_elements: list[str] = field(default_factory=list)
    transition_timings: list[float] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "trace_id": self.trace_id,
            "actions": self.actions,
            "scroll_depth": self.scroll_depth,
            "hover_elements": self.hover_elements,
            "click_elements": self.click_elements,
            "transition_timings": self.transition_timings,
        }


@dataclass
class DesignObservation:
    """A captured design surface with full decomposition metadata.

    This lives in Observation Memory. No claim that it is useful.
    """
    observation_id: str = field(default_factory=lambda: _uid("OBS-"))
    source_id: str = ""
    url: str = ""
    capture_date: str = field(default_factory=_now)

    # Captured artifacts
    screenshot_desktop: str = ""  # path or base64
    screenshot_tablet: str = ""
    screenshot_mobile: str = ""
    interaction_trace: Optional[InteractionTrace] = None

    # Structural decomposition
    page_hierarchy: dict[str, Any] = field(default_factory=dict)
    interaction_graph: dict[str, Any] = field(default_factory=dict)
    layout_geometry: dict[str, float] = field(default_factory=dict)
    typography_ratios: dict[str, float] = field(default_factory=dict)
    spacing_rhythm: list[float] = field(default_factory=list)
    color_relationships: dict[str, Any] = field(default_factory=dict)
    density_info_hierarchy: dict[str, Any] = field(default_factory=dict)
    navigation_model: str = ""
    motion_transitions: list[dict[str, Any]] = field(default_factory=list)
    component_topology: dict[str, Any] = field(default_factory=dict)

    # Semantic metadata
    brand_personality: str = ""
    unusual_design_decisions: list[str] = field(default_factory=list)
    usability_problems: list[str] = field(default_factory=list)

    # Quality signals
    performance_score: float = 0.0
    accessibility_score: float = 0.0
    commercial_effectiveness: Optional[float] = None

    # Visual embedding for similarity search
    visual_embedding: list[float] = field(default_factory=list)

    # Trend tracking
    trend_velocity: float = 0.0
    novelty_score: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "observation_id": self.observation_id,
            "source_id": self.source_id,
            "url": self.url,
            "capture_date": self.capture_date,
            "screenshot_desktop": self.screenshot_desktop[:100] if self.screenshot_desktop else "",
            "screenshot_tablet": self.screenshot_tablet[:100] if self.screenshot_tablet else "",
            "screenshot_mobile": self.screenshot_mobile[:100] if self.screenshot_mobile else "",
            "interaction_trace": self.interaction_trace.to_dict() if self.interaction_trace else None,
            "page_hierarchy": self.page_hierarchy,
            "interaction_graph": self.interaction_graph,
            "layout_geometry": self.layout_geometry,
            "typography_ratios": self.typography_ratios,
            "spacing_rhythm": self.spacing_rhythm,
            "color_relationships": self.color_relationships,
            "density_info_hierarchy": self.density_info_hierarchy,
            "navigation_model": self.navigation_model,
            "motion_transitions": self.motion_transitions,
            "component_topology": self.component_topology,
            "brand_personality": self.brand_personality,
            "unusual_design_decisions": self.unusual_design_decisions,
            "usability_problems": self.usability_problems,
            "performance_score": self.performance_score,
            "accessibility_score": self.accessibility_score,
            "commercial_effectiveness": self.commercial_effectiveness,
            "trend_velocity": self.trend_velocity,
            "novelty_score": self.novelty_score,
        }


# ═══════════════════════════════════════════════════════════════
# Design Gene — extracted reusable principle (not a copy)
# ═══════════════════════════════════════════════════════════════

class GeneType(str, Enum):
    COMPOSITION = "composition"
    TYPOGRAPHY = "typography"
    SPACING_RHYTHM = "spacing_rhythm"
    COLOR_RELATIONSHIP = "color_relationship"
    DEPTH = "depth"
    MOTION_CHARACTER = "motion_character"
    MATERIAL_LIGHTING = "material_lighting"
    INFORMATION_DENSITY = "information_density"
    NAVIGATION_PATTERN = "navigation_pattern"
    INTERACTION_PRIMITIVE = "interaction_primitive"
    FOCAL_HIERARCHY = "focal_hierarchy"
    BRAND_IDENTITY = "brand_identity"


@dataclass
class DesignGene:
    """A reusable design principle extracted from observation.

    NOT a copy. A transformation rule.

    Example:
        NOT: "Copy this homepage's hero section"
        YES:  "Editorial composition; asymmetric 7:5 grid;
              oversized serif identity layer; product demonstration
              interrupts the reading axis; navigation progressively disclosed"
    """
    gene_id: str = field(default_factory=lambda: _uid("GENE-"))
    gene_type: GeneType = GeneType.COMPOSITION
    description: str = ""
    source_observation_id: str = ""

    # The principle, not the expression
    principle: str = ""
    preserve_attributes: list[str] = field(default_factory=list)
    transform_attributes: list[str] = field(default_factory=list)

    # Transferability
    product_categories: list[str] = field(default_factory=list)
    audience_types: list[str] = field(default_factory=list)
    mood_tags: list[str] = field(default_factory=list)
    interaction_purposes: list[str] = field(default_factory=list)

    # Quality and novelty
    novelty_score: float = 0.0
    quality_score: float = 0.0
    saturation_score: float = 0.0  # how over-represented this pattern is
    trend_velocity: float = 0.0

    # Validation
    transfer_attempts: int = 0
    successful_transfers: int = 0
    confidence: float = 0.0

    # Lifecycle
    created_at: str = field(default_factory=_now)
    retired: bool = False
    retired_reason: str = ""

    @property
    def transfer_rate(self) -> float:
        if self.transfer_attempts == 0:
            return 0.0
        return self.successful_transfers / self.transfer_attempts

    def to_dict(self) -> dict[str, Any]:
        return {
            "gene_id": self.gene_id,
            "gene_type": self.gene_type.value,
            "description": self.description,
            "source_observation_id": self.source_observation_id,
            "principle": self.principle,
            "preserve_attributes": self.preserve_attributes,
            "transform_attributes": self.transform_attributes,
            "product_categories": self.product_categories,
            "audience_types": self.audience_types,
            "mood_tags": self.mood_tags,
            "interaction_purposes": self.interaction_purposes,
            "novelty_score": self.novelty_score,
            "quality_score": self.quality_score,
            "saturation_score": self.saturation_score,
            "trend_velocity": self.trend_velocity,
            "transfer_attempts": self.transfer_attempts,
            "successful_transfers": self.successful_transfers,
            "transfer_rate": self.transfer_rate,
            "confidence": self.confidence,
            "created_at": self.created_at,
            "retired": self.retired,
            "retired_reason": self.retired_reason,
        }


# ═══════════════════════════════════════════════════════════════
# Perceptual Target — what the Oracle produces for the Builder
# ═══════════════════════════════════════════════════════════════

@dataclass
class PerceptualTarget:
    """Structured diagnosis from the Taste Oracle.

    The Oracle never writes frontend code. It recognizes latent value
    and returns a structured target, not vague criticism.
    """
    target_id: str = field(default_factory=lambda: _uid("TGT-"))
    benchmark_observation_id: str = ""
    current_render_id: str = ""
    previous_render_id: str = ""

    # Visual identity description
    visual_identity: str = ""
    primary_composition: str = ""

    # Perceptual qualities to preserve
    depth_layers: int = 0
    foreground_background_separation: float = 0.0
    motion_character: str = ""
    typography_character: str = ""
    information_density_target: float = 0.0
    lighting_description: str = ""
    material_behavior: str = ""

    # Recommended renderer
    recommended_renderer: RendererType = RendererType.DOM_CSS
    renderer_rationale: str = ""

    # Error map — what's wrong with current implementation
    errors: list[dict[str, Any]] = field(default_factory=list)

    # Similarity scores (0-1, higher = closer to benchmark)
    spatial_similarity: float = 0.0
    identity_preservation: float = 0.0

    # Next highest-value correction
    next_correction: str = ""
    next_correction_rationale: str = ""

    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "target_id": self.target_id,
            "benchmark_observation_id": self.benchmark_observation_id,
            "current_render_id": self.current_render_id,
            "previous_render_id": self.previous_render_id,
            "visual_identity": self.visual_identity,
            "primary_composition": self.primary_composition,
            "depth_layers": self.depth_layers,
            "foreground_background_separation": self.foreground_background_separation,
            "motion_character": self.motion_character,
            "typography_character": self.typography_character,
            "information_density_target": self.information_density_target,
            "lighting_description": self.lighting_description,
            "material_behavior": self.material_behavior,
            "recommended_renderer": self.recommended_renderer.value,
            "renderer_rationale": self.renderer_rationale,
            "errors": self.errors,
            "spatial_similarity": self.spatial_similarity,
            "identity_preservation": self.identity_preservation,
            "next_correction": self.next_correction,
            "next_correction_rationale": self.next_correction_rationale,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# Distinction Contract — per-project uniqueness requirements
# ═══════════════════════════════════════════════════════════════

@dataclass
class DistinctionContract:
    """Enforced before implementation. If the product name can be replaced
    and the interface still makes equal sense, the design fails.

    Eight mandatory elements:
        1. Three emotions the interface must create
        2. One recognizable spatial signature
        3. One project-specific interaction primitive
        4. One forbidden visual cliché
        5. One typography doctrine
        6. One motion doctrine
        7. One information-density rule
        8. One feature that could not sensibly belong to another product
    """
    contract_id: str = field(default_factory=lambda: _uid("DST-"))
    project_name: str = ""
    project_brief: str = ""

    # 1. Three emotions
    required_emotions: list[str] = field(default_factory=list)

    # 2. Spatial signature
    spatial_signature: str = ""

    # 3. Interaction primitive
    interaction_primitive: str = ""

    # 4. Forbidden cliché
    forbidden_cliche: str = ""

    # 5. Typography doctrine
    typography_doctrine: str = ""

    # 6. Motion doctrine
    motion_doctrine: str = ""

    # 7. Information density rule
    density_rule: str = ""

    # 8. Unique feature
    unique_feature: str = ""

    # Evaluation
    distinction_verified: bool = False
    distinction_score: float = 0.0

    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "contract_id": self.contract_id,
            "project_name": self.project_name,
            "project_brief": self.project_brief,
            "required_emotions": self.required_emotions,
            "spatial_signature": self.spatial_signature,
            "interaction_primitive": self.interaction_primitive,
            "forbidden_cliche": self.forbidden_cliche,
            "typography_doctrine": self.typography_doctrine,
            "motion_doctrine": self.motion_doctrine,
            "density_rule": self.density_rule,
            "unique_feature": self.unique_feature,
            "distinction_verified": self.distinction_verified,
            "distinction_score": self.distinction_score,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# Quality Score — multi-axis evaluation
# ═══════════════════════════════════════════════════════════════

@dataclass
class QualityScore:
    """Multi-axis quality evaluation of a rendered implementation.

    Q = 0.22*U + 0.18*B + 0.16*C + 0.14*A + 0.12*P + 0.10*R + 0.08*N - 0.25*S

    The similarity penalty (S) is essential. Without it, the system
    merely produces more polished copying.
    """
    # Usability — task usability
    U: float = 0.0
    # Brand specificity
    B: float = 0.0
    # Compositional quality
    C: float = 0.0
    # Accessibility
    A: float = 0.0
    # Performance
    P: float = 0.0
    # Responsive integrity
    R: float = 0.0
    # Controlled novelty
    N: float = 0.0
    # Similarity to sources, templates and earlier generations (PENALTY)
    S: float = 0.0

    # Detailed axis scores (0-1)
    composition_similarity: float = 0.0
    perceptual_depth: float = 0.0
    visual_hierarchy: float = 0.0
    motion_character_match: float = 0.0
    material_lighting_behavior: float = 0.0
    typography_character_match: float = 0.0
    information_density_match: float = 0.0
    interaction_responsiveness: float = 0.0
    product_specific_identity: float = 0.0
    originality_distance: float = 0.0
    accessibility_audit: float = 0.0
    runtime_performance: float = 0.0
    cross_device_stability: float = 0.0

    # Weights
    W_U = 0.22
    W_B = 0.18
    W_C = 0.16
    W_A = 0.14
    W_P = 0.12
    W_R = 0.10
    W_N = 0.08
    W_S = 0.25

    @property
    def total(self) -> float:
        return (
            self.W_U * self.U
            + self.W_B * self.B
            + self.W_C * self.C
            + self.W_A * self.A
            + self.W_P * self.P
            + self.W_R * self.R
            + self.W_N * self.N
            - self.W_S * self.S
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "U": self.U, "B": self.B, "C": self.C, "A": self.A,
            "P": self.P, "R": self.R, "N": self.N, "S": self.S,
            "total": self.total,
            "composition_similarity": self.composition_similarity,
            "perceptual_depth": self.perceptual_depth,
            "visual_hierarchy": self.visual_hierarchy,
            "motion_character_match": self.motion_character_match,
            "material_lighting_behavior": self.material_lighting_behavior,
            "typography_character_match": self.typography_character_match,
            "information_density_match": self.information_density_match,
            "interaction_responsiveness": self.interaction_responsiveness,
            "product_specific_identity": self.product_specific_identity,
            "originality_distance": self.originality_distance,
            "accessibility_audit": self.accessibility_audit,
            "runtime_performance": self.runtime_performance,
            "cross_device_stability": self.cross_device_stability,
        }


# ═══════════════════════════════════════════════════════════════
# Render Result — browser-produced frame sequence
# ═══════════════════════════════════════════════════════════════

@dataclass
class RenderResult:
    """R_t = {desktop frames, mobile frames, interaction trace, performance trace}

    The crucial object is not the source code. It is the browser-produced
    frame sequence. The model cannot declare progress; it must demonstrate
    progress in rendered output.
    """
    render_id: str = field(default_factory=lambda: _uid("RND-"))
    implementation_id: str = ""
    iteration: int = 0

    # Captured frames
    desktop_frames: list[str] = field(default_factory=list)
    mobile_frames: list[str] = field(default_factory=list)
    interaction_trace: Optional[InteractionTrace] = None
    performance_trace: dict[str, Any] = field(default_factory=dict)

    # Renderer used
    renderer_type: RendererType = RendererType.DOM_CSS

    # Quality evaluation
    quality: QualityScore = field(default_factory=QualityScore)

    # Comparison
    delta_vs_previous: float = 0.0
    delta_vs_reference: float = 0.0
    delta_vs_frontier: float = 0.0

    # Acceptance
    accepted: bool = False
    rejected_reason: str = ""

    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "render_id": self.render_id,
            "implementation_id": self.implementation_id,
            "iteration": self.iteration,
            "desktop_frame_count": len(self.desktop_frames),
            "mobile_frame_count": len(self.mobile_frames),
            "renderer_type": self.renderer_type.value,
            "quality": self.quality.to_dict(),
            "delta_vs_previous": self.delta_vs_previous,
            "delta_vs_reference": self.delta_vs_reference,
            "delta_vs_frontier": self.delta_vs_frontier,
            "accepted": self.accepted,
            "rejected_reason": self.rejected_reason,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# Implementation — a candidate in the genetic population
# ═══════════════════════════════════════════════════════════════

class ImplementationStatus(str, Enum):
    PROPOSED = "proposed"
    RENDERED = "rendered"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    MUTATED = "mutated"
    RECOMBINED = "recombined"


@dataclass
class Implementation:
    """A single implementation candidate in the evolutionary population.

    P_t = {I_1, I_2, ..., I_n}

    The system generates materially different renderer architectures,
    renders every candidate, selects the strongest, mutates independently,
    rejects regressions, recombines compatible winners, preserves lineage.
    """
    impl_id: str = field(default_factory=lambda: _uid("IMP-"))
    project_id: str = ""
    distinction_contract_id: str = ""

    # The actual code
    source_code: str = ""
    renderer_type: RendererType = RendererType.DOM_CSS

    # Architecture search
    architecture_hypothesis: str = ""
    is_prototype: bool = False

    # Genetic lineage
    parent_id: str = ""
    generation: int = 0
    mutation_type: str = ""  # composition, motion, lighting, interaction
    mutation_description: str = ""

    # Status
    status: ImplementationStatus = ImplementationStatus.PROPOSED

    # Best render
    best_render_id: str = ""
    best_quality: float = 0.0

    # Lineage
    render_history: list[str] = field(default_factory=list)

    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "impl_id": self.impl_id,
            "project_id": self.project_id,
            "distinction_contract_id": self.distinction_contract_id,
            "renderer_type": self.renderer_type.value,
            "architecture_hypothesis": self.architecture_hypothesis,
            "is_prototype": self.is_prototype,
            "parent_id": self.parent_id,
            "generation": self.generation,
            "mutation_type": self.mutation_type,
            "mutation_description": self.mutation_description,
            "status": self.status.value,
            "best_render_id": self.best_render_id,
            "best_quality": self.best_quality,
            "render_history": self.render_history,
            "source_code_length": len(self.source_code),
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# Capability — verified, transferable design skill
# ═══════════════════════════════════════════════════════════════

class CapabilityStatus(str, Enum):
    OBSERVED = "observed"
    HYPOTHESIZED = "hypothesized"
    IMPLEMENTED = "implemented"
    VERIFIED = "verified"
    PRODUCTION = "production"
    SATURATED = "saturated"
    RETIRED = "retired"


@dataclass
class Capability:
    """A learned, verified design skill. The screenshot was merely the
    stimulus that caused its acquisition.

    A Builder experiment cannot promote itself into verified memory.
    Promotion requires independent evaluation.

    The retained object is not prose. It is a reproducible record:
        trigger conditions, perceptual objective, renderer architecture,
        working implementation, parameter boundaries, failed alternatives,
        desktop/mobile renders, interaction recording, performance profile,
        comparison scores, transfer-test results, confidence, expiration weight.
    """
    capability_id: str = field(default_factory=lambda: _uid("CAP-"))
    name: str = ""
    recognition: str = ""  # what the Oracle recognized
    execution: str = ""    # how the Builder implemented it
    validation: str = ""   # how it was verified

    # Trigger conditions — when to use this capability
    trigger_conditions: str = ""
    perceptual_objective: str = ""

    # Renderer architecture
    renderer_architecture: str = ""
    working_implementation_id: str = ""  # impl_id of verified implementation

    # Parameter boundaries
    parameter_ranges: dict[str, Any] = field(default_factory=dict)

    # Failed alternatives — what looked plausible in code but failed visually
    failed_alternatives: list[dict[str, Any]] = field(default_factory=list)

    # Verified evidence
    verified_renders: list[str] = field(default_factory=list)  # render_ids
    interaction_recording_id: str = ""
    performance_profile: dict[str, Any] = field(default_factory=dict)

    # Comparison scores
    comparison_scores: dict[str, float] = field(default_factory=dict)

    # Transfer evidence
    transfer_products: list[str] = field(default_factory=list)
    transfer_success_count: int = 0
    transfer_test_results: list[dict[str, Any]] = field(default_factory=list)

    # Confidence (0-1)
    confidence: float = 0.0

    # Skill weight — dynamic retrieval weight with saturation penalty
    # W_c = (quality × transferability × novelty × reliability) / saturation
    quality_factor: float = 0.0
    transferability_factor: float = 0.0
    novelty_factor: float = 0.0
    reliability_factor: float = 0.0
    saturation_factor: float = 1.0  # starts at 1 (no penalty), grows as overused

    # Expiration — older techniques can return when contextually unusual
    expiration_weight: float = 1.0
    last_used: str = ""
    times_retrieved: int = 0

    # Provenance
    source_observation_id: str = ""
    source_gene_ids: list[str] = field(default_factory=list)
    verified_impl_id: str = ""

    status: CapabilityStatus = CapabilityStatus.OBSERVED

    # Probes passed
    depth_reproduced: bool = False
    motion_reproduced: bool = False
    mobile_preserved: bool = False
    accessibility_maintained: bool = False
    performance_budget_met: bool = False
    transfers_to_other_products: bool = False
    survives_human_comparison: bool = False

    created_at: str = field(default_factory=_now)
    verified_at: str = ""

    @property
    def is_verified(self) -> bool:
        return self.status in (CapabilityStatus.VERIFIED, CapabilityStatus.PRODUCTION)

    @property
    def is_active(self) -> bool:
        return self.status not in (CapabilityStatus.SATURATED, CapabilityStatus.RETIRED)

    @property
    def probe_pass_rate(self) -> float:
        probes = [
            self.depth_reproduced, self.motion_reproduced,
            self.mobile_preserved, self.accessibility_maintained,
            self.performance_budget_met, self.transfers_to_other_products,
            self.survives_human_comparison,
        ]
        return sum(1 for p in probes if p) / len(probes)

    @property
    def skill_weight(self) -> float:
        """W_c = (quality × transferability × novelty × reliability) / saturation"""
        denom = max(self.saturation_factor, 0.01)
        return (self.quality_factor * self.transferability_factor
                * self.novelty_factor * self.reliability_factor) / denom

    def to_dict(self) -> dict[str, Any]:
        return {
            "capability_id": self.capability_id,
            "name": self.name,
            "recognition": self.recognition,
            "execution": self.execution,
            "validation": self.validation,
            "trigger_conditions": self.trigger_conditions,
            "perceptual_objective": self.perceptual_objective,
            "renderer_architecture": self.renderer_architecture,
            "working_implementation_id": self.working_implementation_id,
            "parameter_ranges": self.parameter_ranges,
            "failed_alternatives": self.failed_alternatives,
            "verified_renders": self.verified_renders,
            "interaction_recording_id": self.interaction_recording_id,
            "performance_profile": self.performance_profile,
            "comparison_scores": self.comparison_scores,
            "transfer_products": self.transfer_products,
            "transfer_success_count": self.transfer_success_count,
            "transfer_test_results": self.transfer_test_results,
            "confidence": self.confidence,
            "quality_factor": self.quality_factor,
            "transferability_factor": self.transferability_factor,
            "novelty_factor": self.novelty_factor,
            "reliability_factor": self.reliability_factor,
            "saturation_factor": self.saturation_factor,
            "expiration_weight": self.expiration_weight,
            "last_used": self.last_used,
            "times_retrieved": self.times_retrieved,
            "skill_weight": self.skill_weight,
            "source_observation_id": self.source_observation_id,
            "source_gene_ids": self.source_gene_ids,
            "verified_impl_id": self.verified_impl_id,
            "status": self.status.value,
            "depth_reproduced": self.depth_reproduced,
            "motion_reproduced": self.motion_reproduced,
            "mobile_preserved": self.mobile_preserved,
            "accessibility_maintained": self.accessibility_maintained,
            "performance_budget_met": self.performance_budget_met,
            "transfers_to_other_products": self.transfers_to_other_products,
            "survives_human_comparison": self.survives_human_comparison,
            "probe_pass_rate": self.probe_pass_rate,
            "is_active": self.is_active,
            "created_at": self.created_at,
            "verified_at": self.verified_at,
        }


# ═══════════════════════════════════════════════════════════════
# Failure Record — what looked plausible but failed visually
# ═══════════════════════════════════════════════════════════════

@dataclass
class FailureRecord:
    """A documented failure. The failure population is critical — it
    teaches the system what does NOT work, preventing repeated dead ends.

    Failures are not discarded. They are retained as negative knowledge
    with the same structural rigor as verified capabilities.
    """
    failure_id: str = field(default_factory=lambda: _uid("FAIL-"))
    capability_id: str = ""  # capability this failure relates to
    impl_id: str = ""        # implementation that failed

    # What was attempted
    attempted_approach: str = ""
    renderer_type: str = ""
    mutation_axis: str = ""

    # Why it failed
    failure_mode: str = ""  # e.g. "depth_lost", "motion_janky", "identity_generic"
    failure_description: str = ""

    # Evidence
    render_id: str = ""
    quality_score: float = 0.0
    quality_breakdown: dict[str, float] = field(default_factory=dict)

    # What was learned
    lesson: str = ""
    avoid_pattern: str = ""

    # Context
    generation: int = 0
    parent_impl_id: str = ""

    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "failure_id": self.failure_id,
            "capability_id": self.capability_id,
            "impl_id": self.impl_id,
            "attempted_approach": self.attempted_approach,
            "renderer_type": self.renderer_type,
            "mutation_axis": self.mutation_axis,
            "failure_mode": self.failure_mode,
            "failure_description": self.failure_description,
            "render_id": self.render_id,
            "quality_score": self.quality_score,
            "quality_breakdown": self.quality_breakdown,
            "lesson": self.lesson,
            "avoid_pattern": self.avoid_pattern,
            "generation": self.generation,
            "parent_impl_id": self.parent_impl_id,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# Transfer Test — capability must survive a different product context
# ═══════════════════════════════════════════════════════════════

@dataclass
class TransferTest:
    """A transfer test verifies that a capability works in a different
    product context, not just the one it was acquired in.

    The winning technique must be tested on a completely different product
    before being promoted to the capability population.
    """
    test_id: str = field(default_factory=lambda: _uid("TFR-"))
    capability_id: str = ""

    # Target context — must be different from acquisition context
    target_product_category: str = ""
    target_audience: str = ""
    target_mood: str = ""

    # Implementation in new context
    transfer_impl_id: str = ""
    transfer_render_id: str = ""

    # Results
    quality_in_new_context: float = 0.0
    identity_preserved: bool = False
    depth_preserved: bool = False
    motion_preserved: bool = False
    accessibility_maintained: bool = False

    # Verdict
    passed: bool = False
    failure_reason: str = ""

    created_at: str = field(default_factory=_now)

    @property
    def transfer_score(self) -> float:
        """0-1 score for how well the capability transferred."""
        checks = [
            self.identity_preserved, self.depth_preserved,
            self.motion_preserved, self.accessibility_maintained,
        ]
        base = sum(1 for c in checks if c) / len(checks)
        return base * self.quality_in_new_context

    def to_dict(self) -> dict[str, Any]:
        return {
            "test_id": self.test_id,
            "capability_id": self.capability_id,
            "target_product_category": self.target_product_category,
            "target_audience": self.target_audience,
            "target_mood": self.target_mood,
            "transfer_impl_id": self.transfer_impl_id,
            "transfer_render_id": self.transfer_render_id,
            "quality_in_new_context": self.quality_in_new_context,
            "identity_preserved": self.identity_preserved,
            "depth_preserved": self.depth_preserved,
            "motion_preserved": self.motion_preserved,
            "accessibility_maintained": self.accessibility_maintained,
            "passed": self.passed,
            "failure_reason": self.failure_reason,
            "transfer_score": self.transfer_score,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# Corpus Manifest — versioned release of the design genome
# ═══════════════════════════════════════════════════════════════

@dataclass
class CorpusManifest:
    """Each corpus release gets a manifest. Makes skill acquisition
    measurable, reversible and auditable.
    """
    manifest_id: str = field(default_factory=lambda: _uid("MAN-"))
    corpus_version: str = ""
    release_date: str = field(default_factory=_now)

    # Source tracking
    source_hashes: list[str] = field(default_factory=list)
    license_states: dict[str, str] = field(default_factory=dict)

    # Pattern tracking
    added_patterns: list[str] = field(default_factory=list)
    retired_patterns: list[str] = field(default_factory=list)

    # Trend analysis
    trend_velocity: float = 0.0
    oversaturated_patterns: list[str] = field(default_factory=list)

    # Evaluation
    evaluation_model: str = ""
    quality_thresholds: dict[str, float] = field(default_factory=dict)

    # Generated design results
    generated_design_results: list[dict[str, Any]] = field(default_factory=list)

    # Statistics
    total_observations: int = 0
    total_genes: int = 0
    total_capabilities: int = 0
    total_verified_capabilities: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "manifest_id": self.manifest_id,
            "corpus_version": self.corpus_version,
            "release_date": self.release_date,
            "source_hashes": self.source_hashes,
            "license_states": self.license_states,
            "added_patterns": self.added_patterns,
            "retired_patterns": self.retired_patterns,
            "trend_velocity": self.trend_velocity,
            "oversaturated_patterns": self.oversaturated_patterns,
            "evaluation_model": self.evaluation_model,
            "quality_thresholds": self.quality_thresholds,
            "generated_design_results": self.generated_design_results,
            "total_observations": self.total_observations,
            "total_genes": self.total_genes,
            "total_capabilities": self.total_capabilities,
            "total_verified_capabilities": self.total_verified_capabilities,
        }


# ═══════════════════════════════════════════════════════════════
# Project Archetype — project-specific retrieval context
# ═══════════════════════════════════════════════════════════════

@dataclass
class ProjectArchetype:
    """Project-specific context for design gene retrieval and synthesis."""
    archetype_id: str = field(default_factory=lambda: _uid("ARCH-"))
    project_name: str = ""
    product_category: str = ""
    audience: str = ""
    mood: str = ""
    interaction_purpose: str = ""

    # Retrieved genes for this project
    active_gene_ids: list[str] = field(default_factory=list)

    # Active distinction contract
    distinction_contract_id: str = ""

    # Best implementation
    best_impl_id: str = ""
    best_quality_score: float = 0.0

    # Experience hypotheses (5 competing concepts)
    experience_hypotheses: list[dict[str, Any]] = field(default_factory=list)

    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "archetype_id": self.archetype_id,
            "project_name": self.project_name,
            "product_category": self.product_category,
            "audience": self.audience,
            "mood": self.mood,
            "interaction_purpose": self.interaction_purpose,
            "active_gene_ids": self.active_gene_ids,
            "distinction_contract_id": self.distinction_contract_id,
            "best_impl_id": self.best_impl_id,
            "best_quality_score": self.best_quality_score,
            "experience_hypotheses": self.experience_hypotheses,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# Anti-Pattern Memory — exhausted conventions to avoid
# ═══════════════════════════════════════════════════════════════

@dataclass
class AntiPattern:
    """A fashionable but ineffective convention that should be avoided."""
    antipattern_id: str = field(default_factory=lambda: _uid("ANTI-"))
    name: str = ""
    description: str = ""
    why_ineffective: str = ""
    first_observed: str = field(default_factory=_now)
    saturation_score: float = 0.0
    evidence: list[str] = field(default_factory=list)
    retired: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "antipattern_id": self.antipattern_id,
            "name": self.name,
            "description": self.description,
            "why_ineffective": self.why_ineffective,
            "first_observed": self.first_observed,
            "saturation_score": self.saturation_score,
            "evidence": self.evidence,
            "retired": self.retired,
        }


# ═══════════════════════════════════════════════════════════════
# Human Preference & Outcome Ledger
# ═══════════════════════════════════════════════════════════════

@dataclass
class PreferenceEntry:
    """A single human preference or outcome observation.

    The real moat is the accumulated relationship between:
        project context × design decision × user behavior × measured outcome
    """
    entry_id: str = field(default_factory=lambda: _uid("PREF-"))
    project_id: str = ""
    design_decision: str = ""
    user_behavior: str = ""
    measured_outcome: str = ""
    outcome_metric: str = ""
    outcome_value: float = 0.0
    human_preference_score: float = 0.0
    context_tags: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "entry_id": self.entry_id,
            "project_id": self.project_id,
            "design_decision": self.design_decision,
            "user_behavior": self.user_behavior,
            "measured_outcome": self.measured_outcome,
            "outcome_metric": self.outcome_metric,
            "outcome_value": self.outcome_value,
            "human_preference_score": self.human_preference_score,
            "context_tags": self.context_tags,
            "created_at": self.created_at,
        }


# ═══════════════════════════════════════════════════════════════
# Genome State — overall runtime state
# ═══════════════════════════════════════════════════════════════

@dataclass
class GenomeState:
    """Snapshot of the Design Genome Runtime state."""
    runtime_id: str = field(default_factory=lambda: _uid("GNM-"))
    current_corpus_version: str = ""
    last_acquisition_run: str = ""
    last_corpus_release: str = ""

    # Memory counts
    observation_count: int = 0
    latent_value_count: int = 0
    attempt_count: int = 0
    verified_capability_count: int = 0
    failure_count: int = 0
    transfer_test_count: int = 0

    # Population counts (four populations)
    frontier_population_count: int = 0
    candidate_population_count: int = 0
    capability_population_count: int = 0
    failure_population_count: int = 0

    # Quality tracking
    average_quality: float = 0.0
    quality_trend: float = 0.0

    # Saturation tracking
    oversaturated_patterns: list[str] = field(default_factory=list)
    retired_pattern_count: int = 0
    saturated_capability_count: int = 0

    # Active projects
    active_project_count: int = 0

    # Acquisition loop stats
    total_acquisition_cycles: int = 0
    total_experiments: int = 0
    total_accepted_mutations: int = 0
    total_rejected_mutations: int = 0
    total_tournaments: int = 0
    total_transfer_tests: int = 0
    total_transfer_passes: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "runtime_id": self.runtime_id,
            "current_corpus_version": self.current_corpus_version,
            "last_acquisition_run": self.last_acquisition_run,
            "last_corpus_release": self.last_corpus_release,
            "observation_count": self.observation_count,
            "latent_value_count": self.latent_value_count,
            "attempt_count": self.attempt_count,
            "verified_capability_count": self.verified_capability_count,
            "failure_count": self.failure_count,
            "transfer_test_count": self.transfer_test_count,
            "frontier_population_count": self.frontier_population_count,
            "candidate_population_count": self.candidate_population_count,
            "capability_population_count": self.capability_population_count,
            "failure_population_count": self.failure_population_count,
            "average_quality": self.average_quality,
            "quality_trend": self.quality_trend,
            "oversaturated_patterns": self.oversaturated_patterns,
            "retired_pattern_count": self.retired_pattern_count,
            "saturated_capability_count": self.saturated_capability_count,
            "active_project_count": self.active_project_count,
            "total_acquisition_cycles": self.total_acquisition_cycles,
            "total_experiments": self.total_experiments,
            "total_accepted_mutations": self.total_accepted_mutations,
            "total_rejected_mutations": self.total_rejected_mutations,
            "total_tournaments": self.total_tournaments,
            "total_transfer_tests": self.total_transfer_tests,
            "total_transfer_passes": self.total_transfer_passes,
        }
