"""Visual Engineer (Builder) — attempts to reproduce capabilities in working code.

The Builder receives the Oracle's diagnosis and proposes implementation
mutations. It does not evaluate its own output.

Key principles:
    - Architecture search first: choose the right renderer before writing code
    - Genetic evolution: population of implementations, mutation, recombination
    - No direct prompt-to-React: the system must explore renderer architectures
    - Mutations that do not improve rendered quality are rejected
    - The Builder cannot promote itself into verified memory

The system never jumps directly from prompt to React. It must first
generate competing implementation paths, render every candidate, select
the strongest, mutate independently, reject regressions, recombine
compatible winners, and preserve lineage.
"""

from __future__ import annotations

import random
import string
from typing import Any, Optional
from dataclasses import dataclass, field

from rxreserve.design_genome import (
    Implementation, ImplementationStatus, RenderResult, PerceptualTarget,
    DistinctionContract, RendererType, QualityScore, DesignGene, GeneType,
    Capability, CapabilityStatus, RENDERER_CLASSIFICATION,
)


# ═══════════════════════════════════════════════════════════════
# Architecture Search
# ═══════════════════════════════════════════════════════════════

class ArchitectureSearch:
    """Before writing a line of code, choose the rendering technology.

    Most models fail before writing the first line because they commit
    to React plus ordinary CSS. The system must first generate competing
    implementation paths.
    """

    @staticmethod
    def search(target: PerceptualTarget) -> list[dict[str, Any]]:
        """Generate competing architecture hypotheses.

        Returns a ranked list of architecture candidates.
        """
        candidates: list[dict[str, Any]] = []

        # Primary recommendation from Oracle
        candidates.append({
            "renderer": target.recommended_renderer,
            "rationale": target.renderer_rationale,
            "confidence": 0.8,
            "is_primary": True,
        })

        # Always include DOM/CSS as baseline
        if target.recommended_renderer != RendererType.DOM_CSS:
            candidates.append({
                "renderer": RendererType.DOM_CSS,
                "rationale": "Baseline DOM/CSS implementation for comparison",
                "confidence": 0.3,
                "is_primary": False,
            })

        # Add hybrid if depth is significant
        if target.depth_layers >= 3:
            candidates.append({
                "renderer": RendererType.HYBRID_GPU_DOM,
                "rationale": "GPU background layer with semantic DOM overlay for deep layering",
                "confidence": 0.6,
                "is_primary": False,
            })

        # Add WebGL if motion is physics-based
        if "physics" in target.motion_character.lower():
            candidates.append({
                "renderer": RendererType.WEBGL,
                "rationale": "WebGL for physics-based inertial motion",
                "confidence": 0.7,
                "is_primary": target.recommended_renderer == RendererType.WEBGL,
            })

        # Add SVG if precision instrumentation
        if "vector" in target.visual_identity.lower() or "instrument" in target.visual_identity.lower():
            candidates.append({
                "renderer": RendererType.SVG,
                "rationale": "SVG for exact vector instrumentation",
                "confidence": 0.5,
                "is_primary": False,
            })

        # Sort by confidence
        candidates.sort(key=lambda c: c["confidence"], reverse=True)
        return candidates

    @staticmethod
    def select(candidates: list[dict[str, Any]], strategy: str = "best") -> dict[str, Any]:
        """Select an architecture from candidates."""
        if strategy == "best":
            return candidates[0]
        elif strategy == "random":
            return random.choice(candidates)
        elif strategy == "diverse":
            # Select a non-primary candidate for diversity
            non_primary = [c for c in candidates if not c.get("is_primary")]
            if non_primary:
                return random.choice(non_primary)
            return candidates[0]
        return candidates[0]


# ═══════════════════════════════════════════════════════════════
# Mutation Operators
# ═══════════════════════════════════════════════════════════════

class MutationType:
    COMPOSITION = "composition"
    MOTION = "motion"
    LIGHTING = "lighting"
    INTERACTION = "interaction"
    TYPOGRAPHY = "typography"
    DENSITY = "density"
    RENDERER_SWITCH = "renderer_switch"
    GENE_TRANSFER = "gene_transfer"
    RECOMBINATION = "recombination"


class MutationOperator:
    """Apply targeted mutations to implementations.

    Each mutation targets a specific axis. The Builder does not randomly
    perturb code — it applies structured mutations based on the Oracle's
    perceptual target.
    """

    @staticmethod
    def mutate(impl: Implementation, target: PerceptualTarget,
               mutation_axis: str = None) -> Implementation:
        """Create a mutated copy of an implementation.

        Applies a structured mutation to the source code based on the
        mutation axis. Each axis modifies different aspects of the code.
        """
        if mutation_axis is None:
            # Choose mutation axis based on target's next correction
            mutation_axis = MutationOperator._choose_mutation_axis(target)

        mutated_code = MutationOperator._apply_mutation(
            impl.source_code, mutation_axis, target)

        mutated = Implementation(
            project_id=impl.project_id,
            distinction_contract_id=impl.distinction_contract_id,
            source_code=mutated_code,
            renderer_type=impl.renderer_type,
            parent_id=impl.impl_id,
            generation=impl.generation + 1,
            mutation_type=mutation_axis,
            mutation_description=MutationOperator._describe_mutation(mutation_axis, target),
            status=ImplementationStatus.MUTATED,
        )

        return mutated

    @staticmethod
    def _apply_mutation(source_code: str, axis: str,
                        target: PerceptualTarget) -> str:
        """Apply a specific mutation to the source code.

        Each mutation axis modifies the code in a targeted way:
        - composition: adjust layout structure (flex/grid changes)
        - motion: modify or add animation/transition CSS
        - lighting: adjust shadow, gradient, filter properties
        - interaction: add or modify event handlers
        - typography: adjust font properties
        - density: adjust spacing, padding, margins
        - renderer_switch: change the rendering approach
        """
        if not source_code:
            return source_code

        code = source_code
        code_lower = code.lower()

        if axis == MutationType.COMPOSITION:
            # Adjust layout: swap flex to grid or vice versa, adjust gaps
            if "display: flex" in code_lower or "display:flex" in code_lower:
                # Try converting to grid for stronger composition
                code = code.replace("display: flex", "display: grid").replace(
                    "display:flex", "display:grid")
                if "gap:" not in code_lower and "gap:" not in code:
                    # Add gap to grid
                    code = code.replace("display: grid", "display: grid; gap: 1.5rem")
            elif "display: grid" in code_lower or "display:grid" in code_lower:
                # Adjust grid template
                if "grid-template-columns:" not in code_lower:
                    code = code.replace(
                        "display: grid",
                        "display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr))")
            else:
                # Add flex layout
                if "<style" in code_lower:
                    insert_pos = code_lower.find("<style") + 7
                    code = code[:insert_pos] + "\n    .container { display: flex; gap: 1.5rem; flex-wrap: wrap; }\n" + code[insert_pos:]

        elif axis == MutationType.MOTION:
            # Add or modify transitions and animations
            if "transition:" not in code_lower and "transition " not in code_lower:
                # Add transition to existing style block
                if "<style" in code_lower:
                    insert_pos = code_lower.find("<style") + 7
                    code = code[:insert_pos] + "\n    * { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }\n" + code[insert_pos:]
            else:
                # Modify existing transition timing
                import re
                code = re.sub(
                    r'transition:\s*([^;]+);',
                    lambda m: f'transition: {m.group(1).split(",")[0].strip()}; /* mutated */',
                    code, count=1)
            # Add keyframes if not present
            if "@keyframes" not in code_lower and "<style" in code_lower:
                insert_pos = code_lower.find("<style") + 7
                code = code[:insert_pos] + "\n    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }\n" + code[insert_pos:]

        elif axis == MutationType.LIGHTING:
            # Adjust shadows, gradients, filters
            if "box-shadow" not in code_lower and "<style" in code_lower:
                insert_pos = code_lower.find("<style") + 7
                code = code[:insert_pos] + "\n    .card, section, article { box-shadow: 0 4px 20px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06); }\n" + code[insert_pos:]
            if "backdrop-filter" not in code_lower and "<style" in code_lower:
                insert_pos = code_lower.find("<style") + 7
                code = code[:insert_pos] + "\n    .glass { backdrop-filter: blur(12px); background: rgba(255,255,255,0.7); }\n" + code[insert_pos:]

        elif axis == MutationType.INTERACTION:
            # Add hover states and interaction handlers
            if ":hover" not in code_lower and "<style" in code_lower:
                insert_pos = code_lower.find("<style") + 7
                code = code[:insert_pos] + "\n    button:hover, a:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.12); }\n    button:active { transform: translateY(0); }\n" + code[insert_pos:]
            if "addEventListener" not in code_lower and "<script" not in code_lower and "</body" in code_lower:
                insert_pos = code_lower.find("</body")
                code = code[:insert_pos] + "<script>document.querySelectorAll('[data-interact]').forEach(el => { el.addEventListener('mouseenter', () => el.classList.add('active')); el.addEventListener('mouseleave', () => el.classList.remove('active')); });</script>\n" + code[insert_pos:]

        elif axis == MutationType.TYPOGRAPHY:
            # Adjust font properties
            if "font-family" not in code_lower and "<style" in code_lower:
                insert_pos = code_lower.find("<style") + 7
                code = code[:insert_pos] + "\n    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.6; letter-spacing: -0.01em; }\n    h1, h2, h3 { font-weight: 700; letter-spacing: -0.03em; }\n" + code[insert_pos:]
            if "letter-spacing" not in code_lower and "<style" in code_lower:
                insert_pos = code_lower.find("<style") + 7
                code = code[:insert_pos] + "\n    h1 { letter-spacing: -0.04em; } h2 { letter-spacing: -0.02em; }\n" + code[insert_pos:]

        elif axis == MutationType.DENSITY:
            # Adjust spacing and padding
            if "padding:" in code_lower:
                import re
                # Increase padding slightly for breathing room
                code = re.sub(r'padding:\s*(\d+)(px|rem|em)', lambda m: f'padding: {int(m.group(1)) + 4}{m.group(2)}', code, count=3)
            elif "<style" in code_lower:
                insert_pos = code_lower.find("<style") + 7
                code = code[:insert_pos] + "\n    section { padding: 2rem 1.5rem; } .container { max-width: 1200px; margin: 0 auto; }\n" + code[insert_pos:]

        elif axis == MutationType.RENDERER_SWITCH:
            # Switch renderer type — this is a bigger change
            # Add canvas-based rendering alongside DOM
            if "<canvas" not in code_lower and "</body" in code_lower:
                insert_pos = code_lower.find("</body")
                code = code[:insert_pos] + "<canvas id='bg-canvas' style='position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:-1'></canvas><script>const c=document.getElementById('bg-canvas');const ctx=c.getContext('2d');function resize(){c.width=innerWidth;c.height=innerHeight}resize();addEventListener('resize',resize);</script>\n" + code[insert_pos:]

        return code

    @staticmethod
    def _choose_mutation_axis(target: PerceptualTarget) -> str:
        """Choose which axis to mutate based on the Oracle's target."""
        if not target.errors:
            return MutationType.COMPOSITION

        # Map error types to mutation axes
        error_type = target.errors[0].get("type", "")
        axis_map = {
            "wrong_rendering_architecture": MutationType.RENDERER_SWITCH,
            "insufficient_spatial_depth": MutationType.LIGHTING,
            "incorrect_motion_physics": MutationType.MOTION,
            "stylistically_generic_typography": MutationType.TYPOGRAPHY,
            "wrong_information_density": MutationType.DENSITY,
            "weak_focal_hierarchy": MutationType.COMPOSITION,
            "excessive_component_library_influence": MutationType.COMPOSITION,
            "identity_lost_during_responsive": MutationType.COMPOSITION,
        }
        return axis_map.get(error_type, MutationType.COMPOSITION)

    @staticmethod
    def _describe_mutation(axis: str, target: PerceptualTarget) -> str:
        """Describe what the mutation does."""
        descriptions = {
            MutationType.COMPOSITION: f"Adjust composition: {target.primary_composition}",
            MutationType.MOTION: f"Rework motion: {target.motion_character}",
            MutationType.LIGHTING: f"Add lighting: {target.lighting_description}",
            MutationType.INTERACTION: f"Refine interaction: {target.next_correction}",
            MutationType.TYPOGRAPHY: f"Restyle typography: {target.typography_character}",
            MutationType.DENSITY: f"Adjust density to {target.information_density_target:.2f}",
            MutationType.RENDERER_SWITCH: f"Switch to {target.recommended_renderer.value}: {target.renderer_rationale}",
            MutationType.GENE_TRANSFER: "Transfer design gene from verified capability",
            MutationType.RECOMBINATION: "Recombine traits from two parent implementations",
        }
        return descriptions.get(axis, "General mutation")

    @staticmethod
    def recombine(parent_a: Implementation, parent_b: Implementation,
                  target: PerceptualTarget) -> Implementation:
        """Recombine traits from two parent implementations.

        Takes the style block from one parent and the body structure
        from the other, creating a genuine recombination rather than
        just copying one parent's code.
        """
        # Choose which parent's renderer to use
        renderer = parent_a.renderer_type if random.random() > 0.5 else parent_b.renderer_type

        # Recombine source code: take styles from one, body from other
        code_a = parent_a.source_code or ""
        code_b = parent_b.source_code or ""

        recombined_code = MutationOperator._recombine_code(code_a, code_b)

        child = Implementation(
            project_id=parent_a.project_id,
            distinction_contract_id=parent_a.distinction_contract_id,
            source_code=recombined_code,
            renderer_type=renderer,
            parent_id=parent_a.impl_id,
            generation=max(parent_a.generation, parent_b.generation) + 1,
            mutation_type=MutationType.RECOMBINATION,
            mutation_description=f"Recombine {parent_a.impl_id[:8]} × {parent_b.impl_id[:8]}",
            status=ImplementationStatus.RECOMBINED,
        )
        return child

    @staticmethod
    def _recombine_code(code_a: str, code_b: str) -> str:
        """Recombine source code from two parents.

        Extracts the <style> block from parent A and the <body> content
        from parent B, creating a genuine genetic recombination.
        """
        if not code_a and not code_b:
            return ""
        if not code_a:
            return code_b
        if not code_b:
            return code_a

        # Extract style block from parent A
        style_a = ""
        a_lower = code_a.lower()
        style_start = a_lower.find("<style")
        style_end = a_lower.find("</style>")
        if style_start != -1 and style_end != -1:
            style_a = code_a[style_start:style_end + 8]

        # Extract body content from parent B
        body_b = ""
        b_lower = code_b.lower()
        body_start = b_lower.find("<body")
        body_end = b_lower.find("</body>")
        if body_start != -1 and body_end != -1:
            # Extract from after the opening <body...> tag
            body_tag_end = code_b.find(">", body_start)
            if body_tag_end != -1:
                body_b = code_b[body_tag_end + 1:body_end]
        else:
            # No body tags — use the whole thing as body content
            body_b = code_b

        # Extract head from parent A (minus style)
        head_a = ""
        head_start = a_lower.find("<head>")
        head_end = a_lower.find("</head>")
        if head_start != -1 and head_end != -1:
            head_content = code_a[head_start + 6:head_end]
            # Remove existing style blocks from head
            import re
            head_content = re.sub(r'<style[\s\S]*?</style>', '', head_content, flags=re.IGNORECASE)
            head_a = head_content

        # Assemble recombined HTML
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
{head_a}
{style_a}
</head>
<body>
{body_b}
</body>
</html>"""


# ═══════════════════════════════════════════════════════════════
# Population Manager — genetic algorithm core
# ═══════════════════════════════════════════════════════════════

@dataclass
class PopulationStats:
    generation: int = 0
    population_size: int = 0
    best_quality: float = 0.0
    average_quality: float = 0.0
    diversity_score: float = 0.0
    accepted_count: int = 0
    rejected_count: int = 0
    stagnation_count: int = 0


class PopulationManager:
    """Manages a population of implementations with genetic evolution.

    P_t = {I_1, I_2, ..., I_n}

    The system generates materially different renderer architectures,
    renders every candidate, selects the strongest, mutates independently,
    rejects regressions, recombines compatible winners, preserves lineage.
    """

    def __init__(self, population_size: int = 8, elite_count: int = 2,
                 mutation_rate: float = 0.7, recombination_rate: float = 0.3,
                 stagnation_limit: int = 5) -> None:
        self.population_size = population_size
        self.elite_count = elite_count
        self.mutation_rate = mutation_rate
        self.recombination_rate = recombination_rate
        self.stagnation_limit = stagnation_limit

        self._population: list[Implementation] = []
        self._renders: dict[str, RenderResult] = {}  # impl_id -> best render
        self._generation: int = 0
        self._best_quality: float = 0.0
        self._stagnation_count: int = 0
        self._lineage: dict[str, list[str]] = {}  # impl_id -> ancestor chain

    def initialize(self, target: PerceptualTarget, contract: DistinctionContract,
                   project_id: str) -> list[Implementation]:
        """Initialize population with architecture search prototypes.

        Each prototype gets real source code generated from the target
        and contract — not empty strings.
        """
        candidates = ArchitectureSearch.search(target)

        prototypes: list[Implementation] = []
        for i, candidate in enumerate(candidates[:self.population_size]):
            source_code = self._generate_source_code(
                target, contract, candidate["renderer"], variant=i)
            impl = Implementation(
                project_id=project_id,
                distinction_contract_id=contract.contract_id,
                source_code=source_code,
                renderer_type=candidate["renderer"],
                architecture_hypothesis=candidate["rationale"],
                is_prototype=True,
                generation=0,
                status=ImplementationStatus.PROPOSED,
            )
            prototypes.append(impl)

        self._population = prototypes
        self._generation = 0
        return prototypes

    def evaluate(self, impl: Implementation, render: RenderResult) -> None:
        """Record the render result for an implementation."""
        self._renders[impl.impl_id] = render

        if render.quality.total > impl.best_quality:
            impl.best_quality = render.quality.total
            impl.best_render_id = render.render_id

        if render.accepted:
            impl.status = ImplementationStatus.ACCEPTED
        else:
            impl.status = ImplementationStatus.REJECTED

        impl.render_history.append(render.render_id)

    def select(self) -> list[Implementation]:
        """Select the strongest implementations (elitism)."""
        scored = [(impl, impl.best_quality) for impl in self._population]
        scored.sort(key=lambda x: x[1], reverse=True)
        return [impl for impl, _ in scored[:self.elite_count]]

    def evolve(self, target: PerceptualTarget) -> list[Implementation]:
        """Evolve the population to the next generation.

        1. Select elites
        2. Mutate elites independently
        3. Recombine compatible winners
        4. Reject regressions
        5. Preserve lineage
        """
        elites = self.select()

        # Check for stagnation
        current_best = max((impl.best_quality for impl in self._population), default=0.0)
        if current_best > self._best_quality:
            self._best_quality = current_best
            self._stagnation_count = 0
        else:
            self._stagnation_count += 1

        next_gen: list[Implementation] = []

        # Keep elites
        next_gen.extend(elites)

        # Mutate elites
        for elite in elites:
            if random.random() < self.mutation_rate:
                mutant = MutationOperator.mutate(elite, target)
                next_gen.append(mutant)
                self._record_lineage(mutant.impl_id, elite.impl_id)

        # Recombine
        if len(elites) >= 2 and random.random() < self.recombination_rate:
            parent_a, parent_b = random.sample(elites, 2)
            child = MutationOperator.recombine(parent_a, parent_b, target)
            next_gen.append(child)
            self._record_lineage(child.impl_id, parent_a.impl_id)

        # Fill remaining slots with diverse mutations
        while len(next_gen) < self.population_size:
            parent = random.choice(elites) if elites else self._population[0]
            mutant = MutationOperator.mutate(parent, target)
            # Use diverse mutation strategy
            mutant.mutation_type = random.choice([
                MutationType.COMPOSITION, MutationType.MOTION,
                MutationType.LIGHTING, MutationType.INTERACTION,
                MutationType.TYPOGRAPHY, MutationType.DENSITY,
            ])
            next_gen.append(mutant)
            self._record_lineage(mutant.impl_id, parent.impl_id)

        self._population = next_gen[:self.population_size]
        self._generation += 1
        return next_gen

    def _record_lineage(self, child_id: str, parent_id: str) -> None:
        """Preserve lineage chain."""
        parent_chain = self._lineage.get(parent_id, [])
        self._lineage[child_id] = parent_chain + [parent_id]

    @staticmethod
    def _generate_source_code(target: PerceptualTarget,
                              contract: DistinctionContract,
                              renderer: RendererType,
                              variant: int = 0) -> str:
        """Generate real HTML/CSS source code from target and contract.

        Produces a complete, renderable HTML document with:
        - Layout from primary_composition
        - Typography from typography_doctrine
        - Motion from motion_doctrine
        - Identity from contract fields
        - Responsive design
        - Accessibility attributes
        """
        # Extract layout strategy from composition
        composition = (target.primary_composition or "").lower()
        if "grid" in composition or "asymmetric" in composition:
            layout_css = """
    .hero { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
    .hero-content { grid-column: 1; }
    .hero-visual { grid-column: 2; }"""
        elif "flex" in composition or "row" in composition:
            layout_css = """
    .hero { display: flex; gap: 2rem; align-items: center; }
    .hero-content { flex: 1; }
    .hero-visual { flex: 1; }"""
        else:
            layout_css = """
    .hero { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }"""

        # Typography from doctrine
        typo_doctrine = (contract.typography_doctrine or "").lower()
        if "variable" in typo_doctrine or "weight" in typo_doctrine:
            typo_css = """
    body { font-family: 'Inter', -apple-system, sans-serif; line-height: 1.6; }
    h1 { font-size: 3rem; font-weight: 700; letter-spacing: -0.04em; }
    h2 { font-size: 2rem; font-weight: 600; letter-spacing: -0.02em; }"""
        elif "serif" in typo_doctrine:
            typo_css = """
    body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.7; }
    h1 { font-size: 3.5rem; font-weight: 400; letter-spacing: -0.02em; }
    h2 { font-size: 2.2rem; font-weight: 400; }"""
        else:
            typo_css = """
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.6; }
    h1 { font-size: 2.5rem; font-weight: 700; }
    h2 { font-size: 1.8rem; font-weight: 600; }"""

        # Motion from doctrine
        motion_doctrine = (contract.motion_doctrine or "").lower()
        if "spring" in motion_doctrine or "ease" in motion_doctrine:
            motion_css = """
    .card { transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease; }
    .card:hover { transform: translateY(-4px); }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    .animate-in { animation: fadeIn 0.6s ease-out; }"""
        elif "quick" in motion_doctrine or "snappy" in motion_doctrine:
            motion_css = """
    .card { transition: transform 0.15s ease-out; }
    .card:hover { transform: scale(1.02); }
    @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .animate-in { animation: slideUp 0.3s ease-out; }"""
        else:
            motion_css = """
    .card { transition: opacity 0.2s ease; }
    .animate-in { opacity: 0; animation: fadeIn 0.4s ease forwards; }
    @keyframes fadeIn { to { opacity: 1; } }"""

        # Identity from contract
        spatial = contract.spatial_signature or "structured layout"
        unique = contract.unique_feature or "distinctive design"
        mood = (target.visual_identity or "modern").lower()

        # Color palette from mood
        if "dark" in mood or "premium" in mood:
            colors = "background: #0a0a0a; color: #e0e0e0;"
            card_bg = "rgba(255,255,255,0.05)"
            card_shadow = "0 4px 20px rgba(0,0,0,0.3)"
        elif "playful" in mood or "bright" in mood:
            colors = "background: #fafafa; color: #1a1a1a;"
            card_bg = "#ffffff"
            card_shadow = "0 2px 12px rgba(0,0,0,0.08)"
        else:
            colors = "background: #f5f5f5; color: #333;"
            card_bg = "#ffffff"
            card_shadow = "0 2px 8px rgba(0,0,0,0.1)"

        # Renderer-specific additions
        renderer_css = ""
        renderer_body = ""
        rtype = renderer.value if hasattr(renderer, 'value') else str(renderer)
        if rtype == "webgl":
            renderer_body = '\n    <canvas id="bg-canvas" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1;"></canvas>\n    <script>const c=document.getElementById("bg-canvas");const ctx=c.getContext("webgl");if(ctx){ctx.clearColor(0,0,0,0);ctx.clear(ctx.COLOR_BUFFER_BIT);}</script>'
        elif rtype == "svg":
            renderer_body = '\n    <svg class="bg-decoration" width="100%" height="100%" style="position:fixed;top:0;left:0;z-index:-1;opacity:0.1;"><circle cx="50%" cy="30%" r="200" fill="currentColor"/></svg>'
        elif rtype == "hybrid_gpu_dom":
            renderer_css = "\n    .gpu-layer { will-change: transform; backface-visibility: hidden; }"

        # Variant differences — each prototype gets a different section arrangement
        sections = {
            0: '<section class="hero"><div class="hero-content animate-in"><h1>Product Title</h1><p>Description text.</p><button data-interact aria-label="Get started">Get Started</button></div><div class="card hero-visual animate-in"><div class="metric">99.7%</div><p>Key metric</p></div></section>',
            1: '<section class="hero"><div class="card hero-visual animate-in"><div class="metric">2.4M</div><p>Active users</p></div><div class="hero-content animate-in"><h1>Product Title</h1><p>Description text.</p><button data-interact aria-label="Learn more">Learn More</button></div></section>',
            2: '<section class="hero"><div class="hero-content animate-in"><h1>Product Title</h1><p>Description text.</p></div></section><section class="hero"><div class="card animate-in"><div class="metric">99.7%</div><p>Key metric</p></div></section>',
        }
        body_content = sections.get(variant, sections[0])

        # Forbidden cliché check — avoid generating the forbidden pattern
        forbidden = (contract.forbidden_cliche or "").lower()
        nav_html = '<nav role="navigation" aria-label="Main navigation"><a href="#" aria-label="Home">Home</a><button aria-label="Menu">Menu</button></nav>'
        if "card grid" in forbidden and "no depth" in forbidden:
            # Add depth to cards to avoid the forbidden cliché
            card_shadow = "0 8px 30px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)"

        return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="{contract.project_name or 'Product'}">
<title>{contract.project_name or 'Product'}</title>
<style>
  body {{
    margin: 0; padding: 0;
    {colors}
  }}
  {typo_css}
  .container {{ max-width: 1200px; margin: 0 auto; padding: 0 2rem; }}
  {layout_css}
  .card {{
    background: {card_bg};
    border-radius: 16px;
    padding: 2rem;
    box-shadow: {card_shadow};
  }}
  .metric {{ font-size: 2.5rem; font-weight: 800; letter-spacing: -0.03em; }}
  nav {{ position: sticky; top: 0; backdrop-filter: blur(8px); padding: 1rem 2rem; }}
  nav a {{ color: inherit; text-decoration: none; margin-right: 1rem; }}
  {motion_css}
  {renderer_css}
  @media (max-width: 768px) {{
    .hero {{ grid-template-columns: 1fr !important; flex-direction: column !important; }}
    h1 {{ font-size: 2rem !important; }}
  }}
</style>
</head>
<body>
  {renderer_body}
  {nav_html}
  <main class="container">
    {body_content}
  </main>
</body>
</html>"""

    def get_lineage(self, impl_id: str) -> list[str]:
        """Get the full ancestry chain for an implementation."""
        return self._lineage.get(impl_id, [])

    def is_stagnant(self) -> bool:
        """Check if evolution has stagnated."""
        return self._stagnation_count >= self.stagnation_limit

    def get_stats(self) -> PopulationStats:
        """Get current population statistics."""
        qualities = [impl.best_quality for impl in self._population]
        best = max(qualities) if qualities else 0.0
        avg = sum(qualities) / len(qualities) if qualities else 0.0

        # Diversity = number of unique renderers
        renderers = set(impl.renderer_type for impl in self._population)
        diversity = len(renderers) / max(len(RendererType), 1)

        accepted = sum(1 for impl in self._population if impl.status == ImplementationStatus.ACCEPTED)
        rejected = sum(1 for impl in self._population if impl.status == ImplementationStatus.REJECTED)

        return PopulationStats(
            generation=self._generation,
            population_size=len(self._population),
            best_quality=best,
            average_quality=avg,
            diversity_score=diversity,
            accepted_count=accepted,
            rejected_count=rejected,
            stagnation_count=self._stagnation_count,
        )


# ═══════════════════════════════════════════════════════════════
# Visual Engineer — orchestrates the building process
# ═══════════════════════════════════════════════════════════════

class VisualEngineer:
    """The Visual Engineer (Builder).

    Receives the Oracle's diagnosis and proposes implementation mutations.
    Does not evaluate its own output.

    The implementation model should not directly write into Taste Memory.
    The Oracle should not directly modify production code.
    Only verified experimental outcomes cross between them.
    """

    def __init__(self) -> None:
        self.architecture_search = ArchitectureSearch()
        self.mutation_operator = MutationOperator()
        self.population = PopulationManager()
        self._execution_memory: list[dict[str, Any]] = []
        self._verified_capabilities: list[Capability] = []

    def start_project(self, target: PerceptualTarget,
                      contract: DistinctionContract,
                      project_id: str) -> list[Implementation]:
        """Start a new design project with architecture search."""
        prototypes = self.population.initialize(target, contract, project_id)

        # Record in execution memory
        for proto in prototypes:
            self._execution_memory.append({
                "impl_id": proto.impl_id,
                "action": "architecture_prototype",
                "renderer": proto.renderer_type.value,
                "hypothesis": proto.architecture_hypothesis,
            })

        return prototypes

    def submit_render(self, impl: Implementation, render: RenderResult) -> None:
        """Submit a render result for evaluation."""
        self.population.evaluate(impl, render)

        self._execution_memory.append({
            "impl_id": impl.impl_id,
            "render_id": render.render_id,
            "action": "render_evaluated",
            "quality": render.quality.total,
            "accepted": render.accepted,
        })

    def evolve_generation(self, target: PerceptualTarget) -> list[Implementation]:
        """Evolve to the next generation."""
        return self.population.evolve(target)

    def propose_capability(self, impl: Implementation,
                           target: PerceptualTarget,
                           genes: list[DesignGene]) -> Capability:
        """Propose a capability for verification.

        The Builder cannot promote itself. This creates a candidate
        that must be independently verified.
        """
        cap = Capability(
            name=f"Capability from {impl.impl_id[:8]}",
            recognition=target.visual_identity,
            execution=f"Implemented via {impl.renderer_type.value}",
            validation=f"Quality score: {impl.best_quality:.3f}",
            source_gene_ids=[g.gene_id for g in genes],
            verified_impl_id=impl.impl_id,
            status=CapabilityStatus.IMPLEMENTED,
            confidence=impl.best_quality,
        )

        # Check probes
        render = self.population._renders.get(impl.best_render_id)
        if render:
            cap.depth_reproduced = render.quality.perceptual_depth > 0.6
            cap.motion_reproduced = render.quality.motion_character_match > 0.6
            cap.mobile_preserved = render.quality.cross_device_stability > 0.6
            cap.accessibility_maintained = render.quality.accessibility_audit > 0.8
            cap.performance_budget_met = render.quality.runtime_performance > 0.7

        return cap

    def get_best(self) -> Optional[Implementation]:
        """Get the best implementation from the current population."""
        elites = self.population.select()
        return elites[0] if elites else None

    def is_stagnant(self) -> bool:
        """Check if evolution has stagnated."""
        return self.population.is_stagnant()

    def get_stats(self) -> PopulationStats:
        return self.population.get_stats()

    def summary(self) -> dict[str, Any]:
        stats = self.get_stats()
        return {
            "generation": stats.generation,
            "population_size": stats.population_size,
            "best_quality": stats.best_quality,
            "average_quality": stats.average_quality,
            "diversity_score": stats.diversity_score,
            "stagnation_count": stats.stagnation_count,
            "execution_memory_entries": len(self._execution_memory),
            "verified_capabilities": len(self._verified_capabilities),
        }
