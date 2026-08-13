"""ReplicationEngine — attempts to replicate beautiful designs in HTML/CSS.

Given a BeautyObservation, the ReplicationEngine generates HTML/CSS
that attempts to reproduce the beautiful aspects it identified.

The process is iterative:
1. Generate an initial replication based on the observation's findings
2. Render it in a real browser and evaluate quality
3. Mutate the replication (adjust spacing, typography, color, motion)
4. Re-render and compare to the original observation
5. Keep improvements, discard regressions
6. Repeat until quality matches or exceeds the original, or max iterations

The output is a ReplicationResult containing the best source code
produced, the quality achieved, and the techniques that worked.

This is NOT template matching. The engine generates real HTML/CSS
from the beauty findings, evaluates it in a real browser, and
evolves it through mutation and selection.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Optional

from rxreserve.beauty_observer import BeautyObservation
from rxreserve.browser_lab import BrowserRenderer, RenderResult
from rxreserve.design_genome import Implementation, ImplementationStatus, RendererType
from rxreserve.builder import MutationOperator, MutationType


@dataclass
class ReplicationResult:
    """The result of attempting to replicate a beautiful design."""
    source_url: str
    original_beauty_score: float
    replicated_quality: float
    improvement_over_original: float = 0.0
    source_code: str = ""
    generations: int = 0
    techniques_used: list[str] = field(default_factory=list)
    mutations_applied: list[str] = field(default_factory=list)
    success: bool = False
    failure_reasons: list[str] = field(default_factory=list)
    best_render: Optional[RenderResult] = None


class ReplicationEngine:
    """Replicates beautiful designs through generation and evolution.

    Given a BeautyObservation, generates HTML/CSS that attempts to
    reproduce the beauty, then iteratively improves it through
    mutation and real browser evaluation.
    """

    def __init__(self, headless: bool = True, video_dir: str = None,
                 max_generations: int = 5) -> None:
        self.renderer = BrowserRenderer(headless=headless, video_dir=video_dir)
        self.max_generations = max_generations
        self.mutation_axes = [
            MutationType.COMPOSITION, MutationType.MOTION,
            MutationType.LIGHTING, MutationType.INTERACTION,
            MutationType.TYPOGRAPHY, MutationType.DENSITY,
        ]

    def _generate_initial_replication(self, obs: BeautyObservation) -> str:
        """Generate initial HTML/CSS based on beauty observation findings.

        This is the core creative step — translating qualitative beauty
        findings into actual HTML/CSS code.
        """
        # Extract key findings
        composition = obs.composition_pattern
        typography = obs.typography_decisions
        color = obs.color_relationship
        motion = obs.motion_character
        depth = obs.depth_treatment
        rhythm = obs.spatial_rhythm

        # Determine layout approach
        if "grid" in composition.lower():
            layout_css = """
            .container { display: grid; grid-template-columns: repeat(12, 1fr); gap: 24px; max-width: 1440px; margin: 0 auto; padding: 0 32px; }
            .hero { grid-column: span 12; min-height: 80vh; display: flex; align-items: center; justify-content: center; }
            .card { grid-column: span 4; }
            .feature { grid-column: span 6; }
            .full { grid-column: span 12; }
            """
        elif "hybrid" in composition.lower():
            layout_css = """
            .container { max-width: 1440px; margin: 0 auto; padding: 0 32px; }
            .hero { display: flex; min-height: 80vh; align-items: center; }
            .grid-section { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; }
            .card { padding: 32px; }
            """
        else:
            layout_css = """
            .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
            .hero { min-height: 70vh; display: flex; flex-direction: column; justify-content: center; }
            .card { margin-bottom: 24px; padding: 24px; }
            """

        # Typography
        font_family = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        if obs.font_families:
            # Use the first non-generic font family found
            for ff in obs.font_families:
                if ff and "serif" not in ff.lower() and "monospace" not in ff.lower():
                    font_family = ff
                    break

        heading_scale = "clamp(2rem, 5vw, 4rem)"
        body_size = "1rem"
        line_height = "1.6"

        if any("scale" in t.lower() for t in typography):
            heading_scale = "clamp(2.5rem, 8vw, 6rem)"

        # Color palette
        bg_color = "#0a0a0a"
        text_color = "#ffffff"
        accent_color = "#6366f1"

        if obs.color_palette:
            # Try to use actual colors from the observation
            colors = obs.color_palette[:3]
            if colors:
                bg_color = colors[0]
                text_color = colors[1] if len(colors) > 1 else "#ffffff"
                accent_color = colors[2] if len(colors) > 2 else "#6366f1"

        # Depth treatment
        shadow_css = ""
        if "layer" in depth.lower() or "shadow" in depth.lower():
            shadow_css = """
            .card { box-shadow: 0 4px 20px rgba(0,0,0,0.15); border-radius: 12px; }
            .hero { box-shadow: inset 0 -20px 40px rgba(0,0,0,0.2); }
            """
        if "glass" in depth.lower():
            shadow_css += """
            .card { backdrop-filter: blur(12px); background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); }
            """

        # Motion
        motion_css = ""
        if "transition" in motion.lower() or "reveal" in motion.lower() or "active" in motion.lower():
            motion_css = """
            .card { transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease; }
            .card:hover { transform: translateY(-4px); box-shadow: 0 8px 30px rgba(0,0,0,0.25); }
            @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            .hero, .card, .feature { animation: fadeInUp 0.6s ease-out forwards; }
            .card:nth-child(2) { animation-delay: 0.1s; }
            .card:nth-child(3) { animation-delay: 0.2s; }
            """

        # Gradient text if observed
        gradient_text_css = ""
        if obs.has_gradient_text:
            gradient_text_css = """
            .gradient-text {
                background: linear-gradient(135deg, #6366f1, #ec4899, #f59e0b);
                -webkit-background-clip: text;
                background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            """

        # Sticky nav if observed
        nav_css = "nav { padding: 16px 32px; }"
        if obs.has_sticky_nav:
            nav_css = """
            nav { position: sticky; top: 0; z-index: 100; padding: 16px 32px;
                  backdrop-filter: blur(8px); background: rgba(10,10,10,0.7); }
            """

        # Build the full HTML document
        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Replicated design">
    <title>Replicated Design</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: {font_family};
            font-size: {body_size};
            line-height: {line_height};
            background: {bg_color};
            color: {text_color};
            -webkit-font-smoothing: antialiased;
        }}
        {nav_css}
        nav {{ display: flex; justify-content: space-between; align-items: center; }}
        nav a {{ color: {text_color}; text-decoration: none; margin-left: 24px; opacity: 0.8; }}
        nav a:hover {{ opacity: 1; }}
        {layout_css}
        h1 {{ font-size: {heading_scale}; font-weight: 700; line-height: 1.1; margin-bottom: 24px; }}
        h2 {{ font-size: clamp(1.5rem, 3vw, 2.5rem); font-weight: 600; margin-bottom: 16px; }}
        p {{ font-size: 1.125rem; opacity: 0.8; margin-bottom: 16px; }}
        .accent {{ color: {accent_color}; }}
        {gradient_text_css}
        {shadow_css}
        {motion_css}
        .section {{ padding: 80px 0; }}
        .card h3 {{ font-size: 1.25rem; margin-bottom: 8px; }}
        .card p {{ font-size: 0.95rem; }}
        footer {{ padding: 40px 32px; text-align: center; opacity: 0.5; font-size: 0.875rem; }}
        @media (max-width: 768px) {{
            .container {{ padding: 0 16px; }}
            .card, .feature {{ grid-column: span 12 !important; }}
            nav {{ padding: 12px 16px; }}
        }}
    </style>
</head>
<body>
    <nav>
        <span style="font-weight: 700; font-size: 1.25rem;">Brand</span>
        <div>
            <a href="#">Work</a>
            <a href="#">About</a>
            <a href="#">Contact</a>
        </div>
    </nav>

    <div class="container">
        <section class="hero">
            <div>
                <h1>Beautiful design, <span class="gradient-text">replicated</span></h1>
                <p>Generated from observation of {obs.url}</p>
            </div>
        </section>

        <section class="section">
            <h2>Features</h2>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; margin-top: 32px;">
                <div class="card">
                    <h3>Composition</h3>
                    <p>{composition}</p>
                </div>
                <div class="card">
                    <h3>Typography</h3>
                    <p>{typography[0] if typography else 'Considered hierarchy'}</p>
                </div>
                <div class="card">
                    <h3>Color</h3>
                    <p>{color}</p>
                </div>
            </div>
        </section>

        <section class="section">
            <div class="full">
                <h2>Depth & Motion</h2>
                <p>{depth} · {motion}</p>
            </div>
        </section>
    </div>

    <footer>
        Replicated by Design Genome Runtime · Observed from {obs.url}
    </footer>
</body>
</html>"""

        return html

    async def replicate(self, obs: BeautyObservation) -> ReplicationResult:
        """Attempt to replicate a beautiful design.

        1. Generate initial HTML/CSS from beauty findings
        2. Render in browser and evaluate
        3. Mutate and iterate
        4. Return the best result
        """
        result = ReplicationResult(
            source_url=obs.url,
            original_beauty_score=obs.beauty_score,
            replicated_quality=0.0,
        )

        # Step 1: Generate initial replication
        source_code = self._generate_initial_replication(obs)
        result.techniques_used.append("Initial generation from beauty findings")

        # Create an Implementation for browser evaluation
        impl = Implementation(
            project_id=f"replicate-{obs.url[:20]}",
            distinction_contract_id="",
            source_code=source_code,
            renderer_type=RendererType.DOM_CSS,
            architecture_hypothesis="Replication from beauty observation",
            is_prototype=True,
            generation=0,
            status=ImplementationStatus.PROPOSED,
        )

        # Step 2: Render and evaluate initial attempt
        try:
            render = await self.renderer.render(impl)
        except Exception as e:
            result.failure_reasons.append(f"Initial render failed: {e}")
            return result

        if render.rejected_reason:
            result.failure_reasons.append(f"Initial render rejected: {render.rejected_reason}")
            return result

        best_quality = render.quality.total if render.quality else 0.0
        best_source = source_code
        best_impl = impl
        best_render = render
        result.replicated_quality = best_quality

        quality_history = [best_quality]

        # Step 3: Iterate through mutation generations
        for gen in range(1, self.max_generations + 1):
            # Generate mutations
            candidates: list[tuple[Implementation, str]] = []
            for axis in self.mutation_axes:
                mutant = MutationOperator.mutate(best_impl, None, axis)
                if mutant.source_code != best_source:
                    candidates.append((mutant, str(axis)))

            if not candidates:
                # Force mutations even if no change detected
                for axis in self.mutation_axes:
                    mutant = MutationOperator.mutate(best_impl, None, axis)
                    candidates.append((mutant, str(axis)))

            # Render and evaluate each candidate
            gen_best_quality = best_quality
            gen_best_impl = best_impl
            gen_best_render = best_render
            gen_best_source = best_source
            gen_best_axis = ""

            for mutant, axis_name in candidates:
                try:
                    m_render = await self.renderer.render(mutant)
                    if m_render.rejected_reason:
                        result.failure_reasons.append(
                            f"Gen {gen} {axis_name}: {m_render.rejected_reason}")
                        continue

                    m_quality = m_render.quality.total if m_render.quality else 0.0
                    if m_quality > gen_best_quality:
                        gen_best_quality = m_quality
                        gen_best_impl = mutant
                        gen_best_render = m_render
                        gen_best_source = mutant.source_code
                        gen_best_axis = axis_name
                except Exception as e:
                    result.failure_reasons.append(f"Gen {gen} {axis_name}: {e}")

            # Adopt improvement
            if gen_best_quality > best_quality:
                best_quality = gen_best_quality
                best_impl = gen_best_impl
                best_render = gen_best_render
                best_source = gen_best_source
                result.mutations_applied.append(f"Gen {gen}: {gen_best_axis} (+{gen_best_quality - best_quality:.4f})")
                result.techniques_used.append(f"Mutation {gen_best_axis} improved quality")
            else:
                result.mutations_applied.append(f"Gen {gen}: no improvement")

            quality_history.append(best_quality)
            result.generations = gen

        # Finalize result
        result.source_code = best_source
        result.replicated_quality = best_quality
        result.best_render = best_render
        result.improvement_over_original = best_quality - obs.beauty_score
        result.success = best_quality >= obs.beauty_score * 0.8  # 80% of original beauty

        return result

    async def close(self) -> None:
        await self.renderer.close()
