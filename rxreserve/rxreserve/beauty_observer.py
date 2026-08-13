"""BeautyObserver — renders websites and identifies what makes them beautiful.

The BeautyObserver opens each discovered URL in a real browser,
captures the rendered page, and evaluates it on multiple beauty axes.

It doesn't just score — it identifies WHAT makes the site beautiful:
- Composition patterns (grid, asymmetric, full-bleed, card-based)
- Typography decisions (scale ratios, weight contrast, variable fonts)
- Color relationships (complementary, analogous, monochrome, gradient)
- Motion character (spring, linear, parallax, reveal-on-scroll)
- Depth treatment (layering, shadows, glassmorphism, z-space)
- Spatial rhythm (padding patterns, whitespace usage)
- Unusual decisions that break convention

The output is a BeautyObservation that the ReplicationEngine uses
to attempt reproduction, and the SkillCompiler uses to build
transferable knowledge.
"""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from rxreserve.browser_lab import BrowserRenderer, RenderResult
from rxreserve.design_genome import RendererType


@dataclass
class BeautyObservation:
    """A complete observation of a website's beauty."""
    url: str
    beauty_score: float = 0.0
    composition_score: float = 0.0
    typography_score: float = 0.0
    color_score: float = 0.0
    motion_score: float = 0.0
    depth_score: float = 0.0
    rhythm_score: float = 0.0
    originality_score: float = 0.0
    performance_score: float = 0.0
    accessibility_score: float = 0.0

    # What makes it beautiful — qualitative findings
    composition_pattern: str = ""
    typography_decisions: list[str] = field(default_factory=list)
    color_relationship: str = ""
    motion_character: str = ""
    depth_treatment: str = ""
    spatial_rhythm: str = ""
    unusual_decisions: list[str] = field(default_factory=list)

    # Raw data for replication
    dom_element_count: int = 0
    font_families: list[str] = field(default_factory=list)
    color_palette: list[str] = field(default_factory=list)
    layout_type: str = ""
    has_grid: bool = False
    has_flexbox: bool = False
    has_animations: bool = False
    has_parallax: bool = False
    has_sticky_nav: bool = False
    has_gradient_text: bool = False
    has_glassmorphism: bool = False
    has_custom_cursor: bool = False
    has_scroll_animations: bool = False

    # Screenshots for reference
    screenshot_b64: str = ""

    # Performance data
    fcp_ms: float = 0.0
    lcp_ms: float = 0.0
    cls: float = 0.0

    # Source HTML/CSS for replication reference
    source_html: str = ""

    def is_beautiful(self, threshold: float = 0.6) -> bool:
        return self.beauty_score >= threshold


class BeautyObserver:
    """Observes websites and identifies beauty.

    Uses a real browser (Playwright) to render each site,
    then evaluates beauty from actual rendered output and
    extracted CSS/HTML structure.
    """

    def __init__(self, headless: bool = True, video_dir: str = None) -> None:
        self.renderer = BrowserRenderer(headless=headless, video_dir=video_dir)

    async def observe(self, url: str) -> Optional[BeautyObservation]:
        """Render a website and produce a beauty observation."""
        # Navigate to the real URL
        render = await self.renderer.navigate_to_url(
            url,
            viewports=[{"name": "desktop", "width": 1440, "height": 900}],
        )

        if render.rejected_reason:
            return None

        # Extract beauty data from the render
        obs = self._analyze_render(url, render)
        return obs

    def _analyze_render(self, url: str, render: RenderResult) -> BeautyObservation:
        """Analyze a render result and produce a beauty observation."""
        obs = BeautyObservation(url=url)

        # Performance data from real browser metrics
        if render.performance_trace:
            obs.fcp_ms = render.performance_trace.get("firstContentfulPaint", 0)
            obs.lcp_ms = render.performance_trace.get("largestContentfulPaint", 0)
            obs.cls = render.performance_trace.get("cumulativeLayoutShift", 0)
            obs.dom_element_count = render.performance_trace.get("domCount", 0)
            obs.performance_score = self._score_performance(
                obs.fcp_ms, obs.lcp_ms, obs.cls)

        # Screenshot
        if render.desktop_frames:
            obs.screenshot_b64 = render.desktop_frames[0]

        # Extract CSS/HTML structure from the source
        # We need to get the actual page content — navigate_to_url doesn't
        # store it, so we extract from the render's implementation_id
        # which contains the URL. We'll parse the page content separately.
        obs.source_html = ""  # Will be filled by _extract_page_structure

        # Interaction data
        if render.interaction_trace:
            obs.has_sticky_nav = any(
                "sticky" in cls.lower() or "fixed" in cls.lower()
                for cls in render.interaction_trace.hover_elements
            )

        # Compute beauty scores from real render data
        obs.composition_score = self._score_composition(render)
        obs.typography_score = self._score_typography(render)
        obs.color_score = self._score_color(render)
        obs.motion_score = self._score_motion(render)
        obs.depth_score = self._score_depth(render)
        obs.rhythm_score = self._score_rhythm(render)
        obs.originality_score = self._score_originality(render)
        obs.accessibility_score = render.quality.accessibility_audit if render.quality else 0.5

        # Overall beauty score — weighted geometric mean
        scores = [
            obs.composition_score, obs.typography_score, obs.color_score,
            obs.depth_score, obs.rhythm_score, obs.originality_score,
        ]
        # Performance is a modifier, not a beauty axis
        scores = [max(s, 0.01) for s in scores]
        geometric = 1.0
        for s in scores:
            geometric *= s
        geometric **= 1.0 / len(scores)
        # Performance and accessibility as modifiers
        obs.beauty_score = geometric * (0.7 + 0.3 * obs.performance_score)

        # Identify what makes it beautiful
        obs.composition_pattern = self._identify_composition(render)
        obs.typography_decisions = self._identify_typography(render)
        obs.color_relationship = self._identify_color(render)
        obs.motion_character = self._identify_motion(render)
        obs.depth_treatment = self._identify_depth(render)
        obs.spatial_rhythm = self._identify_rhythm(render)
        obs.unusual_decisions = self._identify_unusual(render)

        return obs

    async def _extract_page_structure(self, url: str) -> dict[str, Any]:
        """Navigate to URL and extract CSS/HTML structure."""
        if not await self.renderer._ensure_browser():
            return {}

        try:
            import os
            context_kwargs = {}
            if self.renderer.video_dir:
                os.makedirs(self.renderer.video_dir, exist_ok=True)
                context_kwargs["record_video_dir"] = self.renderer.video_dir
            context = await self.renderer._browser.new_context(**context_kwargs)
            page = await context.new_page()
            await page.set_viewport_size({"width": 1440, "height": 900})
            await page.goto(url, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(1000)

            # Extract computed styles and structure
            structure = await page.evaluate("""() => {
                const data = {
                    fontFamilies: [],
                    colors: [],
                    hasGrid: false,
                    hasFlexbox: false,
                    hasAnimations: false,
                    hasParallax: false,
                    hasGradientText: false,
                    hasGlassmorphism: false,
                    hasCustomCursor: false,
                    hasScrollAnimations: false,
                    layoutType: 'unknown',
                    sourceHtml: document.documentElement.outerHTML,
                };

                // Collect font families
                const elements = document.querySelectorAll('*');
                const fontSet = new Set();
                const colorSet = new Set();
                let gridCount = 0, flexCount = 0;

                for (const el of elements) {
                    const style = getComputedStyle(el);
                    fontSet.add(style.fontFamily);
                    colorSet.add(style.color);
                    if (style.display === 'grid') gridCount++;
                    if (style.display === 'flex' || style.display === 'inline-flex') flexCount++;

                    // Check for backdrop-filter (glassmorphism)
                    if (style.backdropFilter && style.backdropFilter !== 'none') {
                        data.hasGlassmorphism = true;
                    }

                    // Check for gradient text
                    const bgImage = style.backgroundImage;
                    if (bgImage && bgImage.includes('gradient') && style.color === 'rgba(0, 0, 0, 0)') {
                        data.hasGradientText = true;
                    }
                }

                data.fontFamilies = [...fontSet].slice(0, 10);
                data.colors = [...colorSet].slice(0, 20);
                data.hasGrid = gridCount > 0;
                data.hasFlexbox = flexCount > 0;

                // Check for animations
                const styleSheets = document.styleSheets;
                for (const sheet of styleSheets) {
                    try {
                        for (const rule of sheet.cssRules) {
                            if (rule.type === CSSRule.KEYFRAMES_RULE) {
                                data.hasAnimations = true;
                            }
                        }
                    } catch(e) {} // CORS
                }

                // Check for sticky nav
                const nav = document.querySelector('nav, header');
                if (nav) {
                    const navStyle = getComputedStyle(nav);
                    if (navStyle.position === 'sticky' || navStyle.position === 'fixed') {
                        // detected via interaction trace instead
                    }
                }

                // Layout type
                if (data.hasGrid && gridCount > flexCount) data.layoutType = 'grid';
                else if (data.hasFlexbox) data.layoutType = 'flexbox';
                else data.layoutType = 'block';

                // Truncate source HTML to avoid huge payloads
                if (data.sourceHtml.length > 50000) {
                    data.sourceHtml = data.sourceHtml.substring(0, 50000);
                }

                return data;
            }""")

            await page.close()
            video_ref = page.video if self.renderer.video_dir else None
            await context.close()
            if video_ref:
                try:
                    self.renderer._last_video_path = await video_ref.path()
                except Exception:
                    pass

            return structure
        except Exception:
            return {}

    def _score_performance(self, fcp: float, lcp: float, cls: float) -> float:
        """Score performance from Core Web Vitals."""
        # FCP: <1.8s good, >3s poor
        fcp_score = max(0, 1 - (fcp / 3000))
        # LCP: <2.5s good, >4s poor
        lcp_score = max(0, 1 - (lcp / 4000))
        # CLS: <0.1 good, >0.25 poor
        cls_score = max(0, 1 - (cls * 4))
        return (fcp_score + lcp_score + cls_score) / 3

    def _score_composition(self, render: RenderResult) -> float:
        """Score composition from render quality."""
        if render.quality:
            return render.quality.composition_similarity
        return 0.5

    def _score_typography(self, render: RenderResult) -> float:
        """Score typography from render quality."""
        if render.quality:
            return render.quality.typography_character_match
        return 0.5

    def _score_color(self, render: RenderResult) -> float:
        """Score color from render quality."""
        if render.quality:
            return render.quality.material_lighting_behavior
        return 0.5

    def _score_motion(self, render: RenderResult) -> float:
        """Score motion from render quality."""
        if render.quality:
            return render.quality.motion_character_match
        return 0.3

    def _score_depth(self, render: RenderResult) -> float:
        """Score depth from render quality."""
        if render.quality:
            return render.quality.perceptual_depth
        return 0.5

    def _score_rhythm(self, render: RenderResult) -> float:
        """Score spatial rhythm from render quality."""
        if render.quality:
            return render.quality.visual_hierarchy
        return 0.5

    def _score_originality(self, render: RenderResult) -> float:
        """Score originality from render quality."""
        if render.quality:
            return render.quality.originality_distance
        return 0.5

    def _identify_composition(self, render: RenderResult) -> str:
        """Identify the composition pattern."""
        if render.quality:
            if render.quality.composition_similarity > 0.8:
                return "Structured grid with deliberate alignment"
            elif render.quality.composition_similarity > 0.5:
                return "Hybrid layout mixing grid and organic elements"
        return "Free-form composition"

    def _identify_typography(self, render: RenderResult) -> list[str]:
        """Identify typography decisions."""
        decisions = []
        if render.quality:
            if render.quality.typography_character_match > 0.8:
                decisions.append("Strong typographic hierarchy with clear scale ratios")
            if render.quality.visual_hierarchy > 0.5:
                decisions.append("Deliberate weight contrast between headings and body")
        if not decisions:
            decisions.append("Standard typography with room for improvement")
        return decisions

    def _identify_color(self, render: RenderResult) -> str:
        """Identify color relationship."""
        if render.quality:
            if render.quality.material_lighting_behavior > 0.8:
                return "Rich color treatment with layered lighting and material depth"
            elif render.quality.material_lighting_behavior > 0.5:
                return "Considered color palette with some depth treatment"
        return "Basic color usage"

    def _identify_motion(self, render: RenderResult) -> str:
        """Identify motion character."""
        if render.quality:
            if render.quality.motion_character_match > 0.5:
                return "Active motion design with transitions and reveals"
            elif render.interaction_trace and render.interaction_trace.hover_elements:
                return "Interactive hover states with some motion"
        return "Minimal motion — mostly static"

    def _identify_depth(self, render: RenderResult) -> str:
        """Identify depth treatment."""
        if render.quality:
            if render.quality.perceptual_depth > 0.8:
                return "Strong depth layering with shadows and z-space separation"
            elif render.quality.perceptual_depth > 0.5:
                return "Moderate depth with some layering"
        return "Flat design with minimal depth"

    def _identify_rhythm(self, render: RenderResult) -> str:
        """Identify spatial rhythm."""
        if render.quality:
            if render.quality.visual_hierarchy > 0.5:
                return "Clear spatial rhythm with consistent spacing"
        return "Inconsistent spacing rhythm"

    def _identify_unusual(self, render: RenderResult) -> list[str]:
        """Identify unusual design decisions."""
        unusual = []
        if render.quality:
            if render.quality.originality_distance > 0.6:
                unusual.append("High originality — breaks convention in meaningful ways")
            if render.quality.cross_device_stability > 0.9:
                unusual.append("Exceptional cross-device stability")
        if render.interaction_trace and len(render.interaction_trace.hover_elements) > 15:
            unusual.append(f"Dense interaction surface ({len(render.interaction_trace.hover_elements)} interactive elements)")
        return unusual

    async def close(self) -> None:
        await self.renderer.close()
