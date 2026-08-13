"""Taste Oracle — recognizes what makes a design exceptional.

The Oracle never writes frontend code. It is responsible for recognizing
latent value:

    What creates the futuristic impression?
    Is it typography, spatial depth, motion, lighting, compositing,
    density, timing, or information architecture?
    Which visual relationships are essential?
    Which details can be simplified without destroying the identity?
    What is genuinely novel versus merely fashionable?
    Where does the implementation visibly diverge from the benchmark?

It receives the benchmark, current browser render, previous renders and
interaction recordings—but not the implementation model's reasoning.

Its output is a structured Perceptual Target, not vague criticism.

The Oracle must not be the Builder. The Builder otherwise grades its own
approximation generously and locks into the wrong path.
"""

from __future__ import annotations

from typing import Any, Optional
from dataclasses import dataclass, field

from rxreserve.design_genome import (
    DesignObservation, DesignGene, GeneType, PerceptualTarget,
    RenderResult, QualityScore, RendererType, RENDERER_CLASSIFICATION,
)


class PerceptualDecomposer:
    """Decompose a design observation into its latent visual principles.

    The system should learn transformations and principles, not memorize
    downloadable implementations.

    NOT: "Copy this homepage's hero section"
    YES:  "Editorial composition; asymmetric 7:5 grid; oversized serif
          identity layer; product demonstration interrupts the reading
          axis; navigation progressively disclosed"
    """

    @staticmethod
    def decompose(observation: DesignObservation) -> list[DesignGene]:
        """Extract design genes from an observation."""
        genes: list[DesignGene] = []

        # Composition gene
        if observation.layout_geometry:
            genes.append(DesignGene(
                gene_type=GeneType.COMPOSITION,
                source_observation_id=observation.observation_id,
                description=f"Layout geometry: {observation.layout_geometry}",
                principle=PerceptualDecomposer._extract_composition_principle(observation),
                preserve_attributes=["depth", "rhythm", "tension", "density"],
                transform_attributes=["geometry", "color", "content", "assets"],
                novelty_score=observation.novelty_score,
                quality_score=observation.performance_score,
            ))

        # Typography gene
        if observation.typography_ratios:
            genes.append(DesignGene(
                gene_type=GeneType.TYPOGRAPHY,
                source_observation_id=observation.observation_id,
                description=f"Typography ratios: {observation.typography_ratios}",
                principle=PerceptualDecomposer._extract_typography_principle(observation),
                preserve_attributes=["scale_relationship", "contrast_hierarchy"],
                transform_attributes=["typeface", "weight", "color"],
                novelty_score=observation.novelty_score,
            ))

        # Spacing rhythm gene
        if observation.spacing_rhythm:
            genes.append(DesignGene(
                gene_type=GeneType.SPACING_RHYTHM,
                source_observation_id=observation.observation_id,
                description=f"Spacing rhythm: {observation.spacing_rhythm[:10]}",
                principle=PerceptualDecomposer._extract_spacing_principle(observation),
                preserve_attributes=["rhythm_ratio", "breathing_space"],
                transform_attributes=["absolute_values", "unit_system"],
                novelty_score=observation.novelty_score,
            ))

        # Color relationship gene
        if observation.color_relationships:
            genes.append(DesignGene(
                gene_type=GeneType.COLOR_RELATIONSHIP,
                source_observation_id=observation.observation_id,
                description=f"Color relationships: {observation.color_relationships}",
                principle=PerceptualDecomposer._extract_color_principle(observation),
                preserve_attributes=["contrast_ratio", "harmony_type"],
                transform_attributes=["hue", "saturation", "palette"],
                novelty_score=observation.novelty_score,
            ))

        # Motion character gene
        if observation.motion_transitions:
            genes.append(DesignGene(
                gene_type=GeneType.MOTION_CHARACTER,
                source_observation_id=observation.observation_id,
                description=f"Motion transitions: {len(observation.motion_transitions)} recorded",
                principle=PerceptualDecomposer._extract_motion_principle(observation),
                preserve_attributes=["timing_curve", "physics_character", "continuity"],
                transform_attributes=["duration", "trigger", "target_element"],
                novelty_score=observation.novelty_score,
            ))

        # Depth gene
        if observation.density_info_hierarchy:
            genes.append(DesignGene(
                gene_type=GeneType.DEPTH,
                source_observation_id=observation.observation_id,
                description=f"Depth via hierarchy: {observation.density_info_hierarchy}",
                principle=PerceptualDecomposer._extract_depth_principle(observation),
                preserve_attributes=["layer_count", "parallax_relationship", "occlusion_order"],
                transform_attributes=["specific_layers", "blur_amounts", "shadow_system"],
                novelty_score=observation.novelty_score,
            ))

        # Navigation pattern gene
        if observation.navigation_model:
            genes.append(DesignGene(
                gene_type=GeneType.NAVIGATION_PATTERN,
                source_observation_id=observation.observation_id,
                description=f"Navigation model: {observation.navigation_model}",
                principle=PerceptualDecomposer._extract_navigation_principle(observation),
                preserve_attributes=["disclosure_progression", "wayfinding_clarity"],
                transform_attributes=["visual_form", "position", "trigger"],
                novelty_score=observation.novelty_score,
            ))

        # Information density gene
        if observation.density_info_hierarchy:
            genes.append(DesignGene(
                gene_type=GeneType.INFORMATION_DENSITY,
                source_observation_id=observation.observation_id,
                description=f"Information density: {observation.density_info_hierarchy}",
                principle=PerceptualDecomposer._extract_density_principle(observation),
                preserve_attributes=["density_ratio", "scan_pattern"],
                transform_attributes=["content_volume", "layout_grid"],
                novelty_score=observation.novelty_score,
            ))

        # Brand identity gene
        if observation.brand_personality:
            genes.append(DesignGene(
                gene_type=GeneType.BRAND_IDENTITY,
                source_observation_id=observation.observation_id,
                description=f"Brand personality: {observation.brand_personality}",
                principle=observation.brand_personality,
                preserve_attributes=["emotional_register", "formality_level"],
                transform_attributes=["specific_imagery", "color_choices"],
                novelty_score=observation.novelty_score,
            ))

        # Focal hierarchy gene from unusual decisions
        if observation.unusual_design_decisions:
            genes.append(DesignGene(
                gene_type=GeneType.FOCAL_HIERARCHY,
                source_observation_id=observation.observation_id,
                description=f"Unusual decisions: {observation.unusual_design_decisions[:3]}",
                principle=PerceptualDecomposer._extract_focal_principle(observation),
                preserve_attributes=["focal_priority", "attention_path"],
                transform_attributes=["specific_elements", "visual_treatment"],
                novelty_score=observation.novelty_score,
            ))

        return genes

    @staticmethod
    def _extract_composition_principle(obs: DesignObservation) -> str:
        geo = obs.layout_geometry
        if not geo:
            return "Unknown composition"
        aspect = geo.get("aspect_ratio", 0)
        if aspect and aspect > 1.2:
            return f"Asymmetric layout with {aspect:.1f} ratio; primary axis dominates"
        return "Balanced composition with structured grid"

    @staticmethod
    def _extract_typography_principle(obs: DesignObservation) -> str:
        ratios = obs.typography_ratios
        if not ratios:
            return "Standard typography hierarchy"
        max_ratio = max(ratios.values()) if ratios else 1.0
        if max_ratio > 2.5:
            return f"Oversized typographic identity layer; {max_ratio:.1f}x scale ratio creates dominant voice"
        return "Moderate typographic hierarchy with clear scale steps"

    @staticmethod
    def _extract_spacing_principle(obs: DesignObservation) -> str:
        rhythm = obs.spacing_rhythm
        if not rhythm:
            return "Uniform spacing"
        if len(rhythm) >= 3:
            ratios = [rhythm[i+1] / rhythm[i] for i in range(len(rhythm)-1) if rhythm[i] > 0]
            if ratios:
                avg_ratio = sum(ratios) / len(ratios)
                if 1.5 < avg_ratio < 1.7:
                    return f"Golden-ratio-based spacing rhythm ({avg_ratio:.2f}x progression)"
                return f"Geometric spacing rhythm with {avg_ratio:.2f}x progression"
        return "Arithmetic spacing rhythm"

    @staticmethod
    def _extract_color_principle(obs: DesignObservation) -> str:
        colors = obs.color_relationships
        if not colors:
            return "Standard color palette"
        scheme = colors.get("scheme", "")
        if scheme:
            return f"{scheme} color relationship with deliberate contrast hierarchy"
        return "Custom color relationship with structured contrast"

    @staticmethod
    def _extract_motion_principle(obs: DesignObservation) -> str:
        motions = obs.motion_transitions
        if not motions:
            return "Static or minimal motion"
        has_physics = any(m.get("physics_based") for m in motions if isinstance(m, dict))
        if has_physics:
            return "Physics-based inertial motion; continuous movement, not CSS easing"
        return "Curved transition motion with deliberate timing"

    @staticmethod
    def _extract_depth_principle(obs: DesignObservation) -> str:
        hierarchy = obs.density_info_hierarchy
        if not hierarchy:
            return "Flat or minimal depth"
        layers = hierarchy.get("layers", 1)
        if layers >= 4:
            return f"Deep perceptual layering ({layers} layers) with differential parallax and occlusion"
        return f"Moderate depth ({layers} layers) with subtle separation"

    @staticmethod
    def _extract_navigation_principle(obs: DesignObservation) -> str:
        model = obs.navigation_model
        if not model:
            return "Standard navigation"
        if "progressive" in model.lower():
            return "Progressively disclosed navigation; reveals depth contextually"
        if "spatial" in model.lower():
            return "Spatial navigation model; position conveys hierarchy"
        return f"{model} navigation pattern"

    @staticmethod
    def _extract_density_principle(obs: DesignObservation) -> str:
        hierarchy = obs.density_info_hierarchy
        if not hierarchy:
            return "Standard information density"
        density = hierarchy.get("density_score", 0.5)
        if density > 0.7:
            return "High information density with structured scan paths"
        if density < 0.3:
            return "Low density, editorial breathing space; whitespace as primary element"
        return "Moderate information density with clear visual grouping"

    @staticmethod
    def _extract_focal_principle(obs: DesignObservation) -> str:
        decisions = obs.unusual_design_decisions
        if not decisions:
            return "Conventional focal hierarchy"
        return f"Unusual focal decisions: {'; '.join(decisions[:3])}"


class LatentValueRecognizer:
    """Determines what has transferable value.

    If a design is beautiful but its latent value cannot transfer,
    it remains a reference observation rather than becoming an acquired skill.
    """

    @staticmethod
    def evaluate(observation: DesignObservation, genes: list[DesignGene]) -> dict[str, Any]:
        """Evaluate the latent value of an observation and its genes."""
        # Novelty: is this genuinely new or merely fashionable?
        novelty = observation.novelty_score

        # Quality signals
        perf = observation.performance_score
        a11y = observation.accessibility_score

        # Transferability: can the principle transfer to a different product category?
        transferable_genes = [g for g in genes if g.novelty_score > 0.3]

        # Unusual decisions indicate potential latent value
        unusual_count = len(observation.unusual_design_decisions)

        # Usability problems reduce value
        usability_penalty = len(observation.usability_problems) * 0.1

        # Overall latent value score
        latent_value = (
            0.35 * novelty
            + 0.20 * min(perf, 1.0)
            + 0.15 * min(a11y, 1.0)
            + 0.15 * min(unusual_count / 5, 1.0)
            + 0.15 * (len(transferable_genes) / max(len(genes), 1))
            - usability_penalty
        )
        latent_value = max(0.0, min(1.0, latent_value))

        return {
            "latent_value_score": latent_value,
            "novelty": novelty,
            "transferable_gene_count": len(transferable_genes),
            "total_gene_count": len(genes),
            "is_reference_only": latent_value < 0.4,
            "is_acquisition_candidate": latent_value >= 0.4,
            "usability_penalty": usability_penalty,
        }


class TasteOracle:
    """The Taste Oracle — recognizes what makes a design exceptional.

    It examines the reference and implementation renders, then returns
    perceptual errors. It does not write code.
    """

    def __init__(self) -> None:
        self.decomposer = PerceptualDecomposer()
        self.recognizer = LatentValueRecognizer()
        self._taste_memory: list[dict[str, Any]] = []
        self._benchmark_decompositions: dict[str, list[DesignGene]] = {}

    def extract_genes(self, observation: DesignObservation) -> tuple[list[DesignGene], dict[str, Any]]:
        """Extract design genes from an observation and evaluate latent value."""
        genes = self.decomposer.decompose(observation)
        evaluation = self.recognizer.evaluate(observation, genes)

        # Store in taste memory
        self._taste_memory.append({
            "observation_id": observation.observation_id,
            "evaluation": evaluation,
            "gene_count": len(genes),
        })

        # Store benchmark decomposition
        self._benchmark_decompositions[observation.observation_id] = genes

        return genes, evaluation

    def create_perceptual_target(
        self,
        benchmark_observation: DesignObservation,
        current_render: RenderResult,
        previous_render: Optional[RenderResult] = None,
    ) -> PerceptualTarget:
        """Create a structured Perceptual Target for the Builder.

        The Oracle examines the reference and implementation renders,
        then returns perceptual errors — not vague criticism.
        """
        # Get benchmark genes
        benchmark_genes = self._benchmark_decompositions.get(
            benchmark_observation.observation_id, [])
        if not benchmark_genes:
            benchmark_genes, _ = self.extract_genes(benchmark_observation)

        # Classify renderer requirement
        renderer_type, renderer_rationale = self._classify_renderer(benchmark_observation, benchmark_genes)

        # Analyze perceptual qualities
        depth = self._assess_depth(benchmark_observation)
        motion = self._assess_motion(benchmark_observation, benchmark_genes)
        typography = self._assess_typography(benchmark_observation, benchmark_genes)
        density = self._assess_density(benchmark_observation)
        lighting = self._assess_lighting(benchmark_observation, benchmark_genes)
        material = self._assess_material(benchmark_observation, benchmark_genes)

        # Compare current render to benchmark
        errors = self._identify_errors(
            benchmark_observation, current_render, benchmark_genes)

        # Compute similarity scores
        spatial_sim = self._compute_spatial_similarity(benchmark_observation, current_render)
        identity_pres = self._compute_identity_preservation(benchmark_observation, current_render)

        # Determine next highest-value correction
        next_correction, next_rationale = self._prioritize_correction(errors)

        target = PerceptualTarget(
            benchmark_observation_id=benchmark_observation.observation_id,
            current_render_id=current_render.render_id,
            previous_render_id=previous_render.render_id if previous_render else "",
            visual_identity=benchmark_observation.brand_personality or "Unknown",
            primary_composition=self._summarize_composition(benchmark_genes),
            depth_layers=depth["layers"],
            foreground_background_separation=depth["separation"],
            motion_character=motion,
            typography_character=typography,
            information_density_target=density,
            lighting_description=lighting,
            material_behavior=material,
            recommended_renderer=renderer_type,
            renderer_rationale=renderer_rationale,
            errors=errors,
            spatial_similarity=spatial_sim,
            identity_preservation=identity_pres,
            next_correction=next_correction,
            next_correction_rationale=next_rationale,
        )

        return target

    def _classify_renderer(self, obs: DesignObservation, genes: list[DesignGene]) -> tuple[RendererType, str]:
        """Classify which renderer architecture is needed.

        Most models fail before writing the first line because they commit
        to React plus ordinary CSS. The system must first generate competing
        implementation paths.
        """
        # Check for shader/WebGL indicators
        motion_genes = [g for g in genes if g.gene_type == GeneType.MOTION_CHARACTER]
        depth_genes = [g for g in genes if g.gene_type == GeneType.DEPTH]

        has_volumetric = any("volumetric" in g.principle.lower() or "bloom" in g.principle.lower()
                            for g in depth_genes)
        has_physics_motion = any("physics" in g.principle.lower() for g in motion_genes)
        has_many_objects = obs.component_topology and len(obs.component_topology) > 100

        if has_volumetric:
            return RendererType.SHADER, "Volumetric light and distortion requires shader composition"
        if has_physics_motion and has_many_objects:
            return RendererType.WEBGL, "Thousands of animated objects with physics requires WebGL"
        if has_physics_motion:
            return RendererType.WEBGL, "Physics-based motion requires GPU acceleration"
        if depth_genes and any(g.principle.count("layer") >= 3 for g in depth_genes):
            return RendererType.HYBRID_GPU_DOM, "Deep layering requires GPU background with semantic DOM overlay"
        if obs.navigation_model and "spatial" in obs.navigation_model.lower():
            return RendererType.THREE_JS, "Spatial navigation requires 3D environment"
        if obs.component_topology and len(obs.component_topology) > 50:
            return RendererType.CANVAS_SVG_HYBRID, "Dense live data visualization needs canvas/SVG hybrid"

        return RendererType.DOM_CSS, "Conventional application controls suit DOM/CSS"

    def _assess_depth(self, obs: DesignObservation) -> dict[str, Any]:
        """Assess perceptual depth layers."""
        hierarchy = obs.density_info_hierarchy or {}
        layers = hierarchy.get("layers", 2)
        separation = hierarchy.get("separation_score", 0.5)
        return {"layers": layers, "separation": separation}

    def _assess_motion(self, obs: DesignObservation, genes: list[DesignGene]) -> str:
        """Assess motion character."""
        for g in genes:
            if g.gene_type == GeneType.MOTION_CHARACTER:
                return g.principle
        return "Minimal or no motion"

        return "Static"

    def _assess_typography(self, obs: DesignObservation, genes: list[DesignGene]) -> str:
        """Assess typography character."""
        for g in genes:
            if g.gene_type == GeneType.TYPOGRAPHY:
                return g.principle
        return "Conventional typography"

    def _assess_density(self, obs: DesignObservation) -> float:
        """Assess information density target (0-1)."""
        hierarchy = obs.density_info_hierarchy or {}
        return hierarchy.get("density_score", 0.5)

    def _assess_lighting(self, obs: DesignObservation, genes: list[DesignGene]) -> str:
        """Assess lighting behavior."""
        for g in genes:
            if g.gene_type == GeneType.DEPTH:
                if "bloom" in g.principle.lower() or "light" in g.principle.lower():
                    return g.principle
        return "Standard flat lighting"

    def _assess_material(self, obs: DesignObservation, genes: list[DesignGene]) -> str:
        """Assess material behavior."""
        for g in genes:
            if g.gene_type == GeneType.DEPTH:
                if "material" in g.principle.lower() or "parallax" in g.principle.lower():
                    return g.principle
        return "Standard material treatment"

    def _summarize_composition(self, genes: list[DesignGene]) -> str:
        """Summarize the primary composition from genes."""
        for g in genes:
            if g.gene_type == GeneType.COMPOSITION:
                return g.principle
        return "Standard composition"

    def _identify_errors(self, benchmark: DesignObservation,
                         current: RenderResult, genes: list[DesignGene]) -> list[dict[str, Any]]:
        """Identify perceptual errors in current implementation vs benchmark."""
        errors: list[dict[str, Any]] = []

        # Check renderer mismatch
        benchmark_genes = genes
        expected_renderer = self._classify_renderer(benchmark, benchmark_genes)[0]
        if current.renderer_type != expected_renderer:
            errors.append({
                "type": "wrong_rendering_architecture",
                "severity": "critical",
                "description": f"Using {current.renderer_type.value} but should use {expected_renderer.value}",
                "correction": f"Switch to {expected_renderer.value} architecture",
            })

        # Check depth
        depth_info = self._assess_depth(benchmark)
        if current.quality.perceptual_depth < depth_info["separation"]:
            errors.append({
                "type": "insufficient_spatial_depth",
                "severity": "high",
                "description": f"Depth separation {current.quality.perceptual_depth:.2f} below target {depth_info['separation']:.2f}",
                "correction": f"Add {depth_info['layers']} perceptual layers with differential parallax",
            })

        # Check motion
        motion_genes = [g for g in genes if g.gene_type == GeneType.MOTION_CHARACTER]
        if motion_genes and current.quality.motion_character_match < 0.6:
            errors.append({
                "type": "incorrect_motion_physics",
                "severity": "high",
                "description": "Motion character does not match benchmark",
                "correction": motion_genes[0].principle,
            })

        # Check typography
        typo_genes = [g for g in genes if g.gene_type == GeneType.TYPOGRAPHY]
        if typo_genes and current.quality.typography_character_match < 0.6:
            errors.append({
                "type": "stylistically_generic_typography",
                "severity": "medium",
                "description": "Typography too conventional and too large",
                "correction": typo_genes[0].principle,
            })

        # Check information density
        target_density = self._assess_density(benchmark)
        if abs(current.quality.information_density_match - target_density) > 0.2:
            errors.append({
                "type": "wrong_information_density",
                "severity": "medium",
                "description": f"Density {current.quality.information_density_match:.2f} vs target {target_density:.2f}",
                "correction": f"Adjust information density to {target_density:.2f}",
            })

        # Check focal hierarchy
        if current.quality.visual_hierarchy < 0.6:
            errors.append({
                "type": "weak_focal_hierarchy",
                "severity": "medium",
                "description": "Weak focal hierarchy — no clear attention path",
                "correction": "Establish clear focal priority with deliberate attention path",
            })

        # Check component library influence
        if current.quality.originality_distance < 0.3:
            errors.append({
                "type": "excessive_component_library_influence",
                "severity": "high",
                "description": "Output too similar to standard component library patterns",
                "correction": "Replace standard components with project-specific visual primitives",
            })

        # Check identity preservation across responsive
        if current.quality.cross_device_stability < 0.5:
            errors.append({
                "type": "identity_lost_during_responsive",
                "severity": "high",
                "description": "Visual identity lost during responsive adaptation",
                "correction": "Preserve depth, rhythm, and motion character across breakpoints",
            })

        return errors

    def _compute_spatial_similarity(self, benchmark: DesignObservation,
                                    current: RenderResult) -> float:
        """Compute spatial similarity between benchmark and current render.

        Compares the benchmark's structural decomposition (page hierarchy,
        interaction graph) against the current render's quality axes.
        """
        q = current.quality
        # Base spatial similarity from composition and hierarchy
        spatial = q.composition_similarity * 0.4 + q.visual_hierarchy * 0.3

        # If benchmark has page hierarchy data, use its depth as a signal
        if benchmark.page_hierarchy:
            hierarchy_depth = len(benchmark.page_hierarchy)
            # Deeper hierarchies require more structural fidelity
            spatial += min(hierarchy_depth / 10.0, 0.15)

        # If benchmark has interaction graph, check interaction alignment
        if benchmark.interaction_graph:
            interaction_nodes = len(benchmark.interaction_graph.get("nodes", []))
            if interaction_nodes > 0:
                # Alignment between render's interaction responsiveness and
                # benchmark's interaction complexity
                spatial += q.interaction_responsiveness * min(interaction_nodes / 20.0, 0.15)

        return min(spatial, 1.0)

    def _compute_identity_preservation(self, benchmark: DesignObservation,
                                       current: RenderResult) -> float:
        """Compute how well the current render preserves the benchmark's identity."""
        return current.quality.product_specific_identity

    def _prioritize_correction(self, errors: list[dict[str, Any]]) -> tuple[str, str]:
        """Determine the next highest-value correction."""
        if not errors:
            return "", "No corrections needed"

        # Sort by severity
        severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        sorted_errors = sorted(errors, key=lambda e: severity_order.get(e.get("severity", "low"), 4))

        top = sorted_errors[0]
        return top.get("correction", ""), top.get("description", "")

    def evaluate_quality(self, render: RenderResult,
                         benchmark: Optional[DesignObservation] = None,
                         previous_render: Optional[RenderResult] = None,
                         frontier_render: Optional[RenderResult] = None) -> QualityScore:
        """Evaluate the quality of a render on multiple axes.

        Pixel similarity alone encourages imitation and fails when a new
        interpretation is desired. The evaluator measures separate axes.
        """
        q = render.quality

        # Compute composite scores from detailed axes
        q.U = q.interaction_responsiveness * 0.5 + q.accessibility_audit * 0.5
        q.B = q.product_specific_identity
        q.C = q.visual_hierarchy * 0.4 + q.perceptual_depth * 0.3 + q.composition_similarity * 0.3
        q.A = q.accessibility_audit
        q.P = q.runtime_performance
        q.R = q.cross_device_stability
        q.N = q.originality_distance

        # Similarity penalty — penalize resemblance to sources and templates
        q.S = max(0.0, 1.0 - q.originality_distance) * 0.7 + q.composition_similarity * 0.3

        # Compute deltas
        if previous_render:
            render.delta_vs_previous = q.total - previous_render.quality.total
        if benchmark:
            # Compute delta from benchmark's perceptual profile if available
            benchmark_quality = getattr(benchmark, 'quality', None)
            if benchmark_quality and hasattr(benchmark_quality, 'total'):
                render.delta_vs_reference = q.total - benchmark_quality.total
            else:
                # Benchmark is a DesignObservation — compare against its
                # actual captured structural and quality attributes
                obs_perf = getattr(benchmark, 'performance_score', 0.0)
                obs_a11y = getattr(benchmark, 'accessibility_score', 0.0)
                # Structural richness from parsed data
                layout = getattr(benchmark, 'layout_geometry', {})
                typo = getattr(benchmark, 'typography_ratios', {})
                colors = getattr(benchmark, 'color_relationships', {})
                motion = getattr(benchmark, 'motion_transitions', [])
                hierarchy = getattr(benchmark, 'page_hierarchy', {})

                # Compute a benchmark quality proxy from real observation data
                structural_richness = (
                    min(len(layout) / 5, 1.0) * 0.2
                    + min(len(typo) / 4, 1.0) * 0.2
                    + min(len(colors) / 4, 1.0) * 0.15
                    + min(len(motion) / 5, 1.0) * 0.15
                    + min(len(hierarchy) / 5, 1.0) * 0.15
                )
                quality_proxy = (
                    obs_perf * 0.3
                    + obs_a11y * 0.3
                    + structural_richness * 0.4
                )
                render.delta_vs_reference = q.total - quality_proxy
        if frontier_render:
            render.delta_vs_frontier = q.total - frontier_render.quality.total

        return q

    def summary(self) -> dict[str, Any]:
        return {
            "taste_memory_entries": len(self._taste_memory),
            "benchmark_decompositions": len(self._benchmark_decompositions),
        }
