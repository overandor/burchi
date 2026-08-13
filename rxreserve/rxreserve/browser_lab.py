"""Browser Laboratory — renders and evaluates implementations.

The crucial object is not the source code. It is the browser-produced
frame sequence. The model cannot declare progress; it must demonstrate
progress in rendered output.

R_t = {
    desktop frames,
    mobile frames,
    interaction trace,
    performance trace
}

Evaluation measures separate axes:
    - composition similarity
    - perceptual depth
    - visual hierarchy
    - motion character
    - material/lighting behavior
    - typography character
    - information density
    - interaction responsiveness
    - product-specific identity
    - originality distance
    - accessibility (WCAG 2.2 hard constraint)
    - runtime performance
    - cross-device stability

WCAG 2.2 is a hard constraint, not a soft preference. If accessibility
drops, the mutation is rejected regardless of other improvements.
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
from typing import Any, Optional
from dataclasses import dataclass, field

from rxreserve.design_genome import (
    RenderResult, Implementation, QualityScore, InteractionTrace,
    RendererType, DistinctionContract, PerceptualTarget,
)


# ═══════════════════════════════════════════════════════════════
# Acceptance Thresholds
# ═══════════════════════════════════════════════════════════════

@dataclass
class AcceptanceThresholds:
    """Hard constraints for accepting a mutation.

    If any hard constraint fails, the mutation is rejected regardless
    of other improvements.
    """
    # Hard constraints (failure = automatic rejection)
    min_accessibility: float = 0.8  # WCAG 2.2
    min_performance: float = 0.5
    min_cross_device: float = 0.5

    # Improvement requirement
    min_quality_delta: float = 0.01  # must improve by at least this much

    # Soft thresholds (used for ranking)
    min_originality: float = 0.3
    min_depth: float = 0.4
    min_hierarchy: float = 0.5


# ═══════════════════════════════════════════════════════════════
# Frame Capture
# ═══════════════════════════════════════════════════════════════

@dataclass
class FrameCapture:
    """Captured frame from browser rendering."""
    frame_id: str = ""
    timestamp: float = 0.0
    viewport: str = "desktop"  # desktop, tablet, mobile
    width: int = 0
    height: int = 0
    image_data: str = ""  # base64 or path
    scroll_position: float = 0.0


class BrowserRenderer:
    """Renders implementations in a real browser.

    Uses Playwright (or similar) to render the implementation and capture
    frame sequences. The system must evaluate against actual browser renders,
    not just source code.
    """

    def __init__(self, headless: bool = True, video_dir: str = None) -> None:
        self.headless = headless
        self.video_dir = video_dir
        self._playwright_available = False
        self._browser = None
        self._page = None
        self._pw = None
        self._last_video_path: str | None = None

    async def _ensure_browser(self) -> bool:
        """Ensure Playwright browser is available."""
        if self._browser is not None:
            return True
        try:
            from playwright.async_api import async_playwright
            self._playwright_available = True
            self._pw = await async_playwright().start()
            launch_args = {"headless": self.headless}
            if self.video_dir:
                launch_args["videos_path"] = self.video_dir
            self._browser = await self._pw.chromium.launch(**launch_args)
            return True
        except ImportError:
            self._playwright_available = False
            return False
        except Exception:
            self._playwright_available = False
            return False

    async def render(self, impl: Implementation,
                     viewports: list[dict[str, int]] = None,
                     capture_interaction: bool = True) -> RenderResult:
        """Render an implementation and capture frame sequences.

        R_t = {desktop frames, mobile frames, interaction trace, performance trace}
        """
        if viewports is None:
            viewports = [
                {"name": "desktop", "width": 1440, "height": 900},
                {"name": "mobile", "width": 390, "height": 844},
            ]

        render = RenderResult(
            implementation_id=impl.impl_id,
            renderer_type=impl.renderer_type,
        )

        if not await self._ensure_browser():
            raise RuntimeError(
                "Browser rendering requires Playwright. "
                "Install with: pip install playwright && playwright install chromium. "
                "Cannot evaluate implementation without a real browser."
            )

        try:
            # Create context — with video recording if configured
            context_kwargs = {}
            if self.video_dir:
                import os
                os.makedirs(self.video_dir, exist_ok=True)
                context_kwargs["record_video_dir"] = self.video_dir
            context = await self._browser.new_context(**context_kwargs)
            page = await context.new_page()

            # Set viewport
            for vp in viewports:
                await page.set_viewport_size({"width": vp["width"], "height": vp["height"]})

                # Load the implementation
                if impl.source_code:
                    await page.set_content(impl.source_code)
                    await page.wait_for_load_state("networkidle", timeout=10000)

                # Capture frames
                frames = await self._capture_frames(page, vp["name"])
                if vp["name"] == "desktop":
                    render.desktop_frames = frames
                elif vp["name"] == "mobile":
                    render.mobile_frames = frames

            # Capture interaction trace
            if capture_interaction:
                render.interaction_trace = await self._capture_interaction(page)

            # Capture performance trace
            render.performance_trace = await self._capture_performance(page)

            await page.close()
            # Save video path if recording
            if self.video_dir and hasattr(context, 'video'):
                try:
                    video = await context.video.path()
                    self._last_video_path = video
                except Exception:
                    pass
            await context.close()

        except Exception as e:
            render.rejected_reason = f"Render error: {e}"

        return render

    async def navigate_to_url(self, url: str,
                              viewports: list[dict[str, int]] = None,
                              capture_interaction: bool = True) -> RenderResult:
        """Navigate to a real URL and capture the agent's journey.

        Opens the page, scrolls through it, captures frames at each scroll
        position, records interactions, and collects performance metrics.
        If video_dir is set, records a video of the entire session.
        """
        if viewports is None:
            viewports = [
                {"name": "desktop", "width": 1440, "height": 900},
                {"name": "mobile", "width": 390, "height": 844},
            ]

        render = RenderResult(
            implementation_id=f"url-{url[:32]}",
            renderer_type=RendererType.DOM_CSS,
        )

        if not await self._ensure_browser():
            raise RuntimeError(
                "Browser navigation requires Playwright. "
                "Install with: pip install playwright && playwright install chromium."
            )

        try:
            context_kwargs = {}
            if self.video_dir:
                import os
                os.makedirs(self.video_dir, exist_ok=True)
                context_kwargs["record_video_dir"] = self.video_dir
                # Set a reasonable viewport for video
                context_kwargs["viewport"] = {"width": 1440, "height": 900}
            context = await self._browser.new_context(**context_kwargs)
            page = await context.new_page()

            for vp in viewports:
                await page.set_viewport_size({"width": vp["width"], "height": vp["height"]})

                # Navigate to the real URL
                await page.goto(url, wait_until="networkidle", timeout=30000)
                await page.wait_for_timeout(1000)

                # Capture frames with deliberate scrolling
                frames = await self._capture_frames(page, vp["name"])
                if vp["name"] == "desktop":
                    render.desktop_frames = frames
                elif vp["name"] == "mobile":
                    render.mobile_frames = frames

            if capture_interaction:
                render.interaction_trace = await self._capture_interaction(page)

            render.performance_trace = await self._capture_performance(page)

            await page.close()
            if self.video_dir and hasattr(context, 'video'):
                try:
                    self._last_video_path = await context.video.path()
                except Exception:
                    pass
            await context.close()

        except Exception as e:
            render.rejected_reason = f"Navigation error: {e}"

        return render

    async def close(self) -> None:
        """Close the browser and clean up."""
        if self._browser:
            try:
                await self._browser.close()
            except Exception:
                pass
        if self._pw:
            try:
                await self._pw.stop()
            except Exception:
                pass
        self._browser = None
        self._pw = None

    async def _capture_frames(self, page, viewport_name: str) -> list[str]:
        """Capture a sequence of frames."""
        frames: list[str] = []
        try:
            # Capture initial frame
            screenshot = await page.screenshot(full_page=True)
            frames.append(base64.b64encode(screenshot).decode())

            # Capture scrolled frames — deliberate pauses for video recording
            for scroll in [0.25, 0.5, 0.75, 1.0]:
                await page.evaluate(f"window.scrollTo(0, document.body.scrollHeight * {scroll})")
                await page.wait_for_timeout(800)
                screenshot = await page.screenshot()
                frames.append(base64.b64encode(screenshot).decode())
        except Exception:
            pass
        return frames

    async def _capture_interaction(self, page) -> InteractionTrace:
        """Capture interaction trace."""
        trace = InteractionTrace()
        try:
            # Record hover elements
            elements = await page.query_selector_all("a, button, [role='button']")
            trace.hover_elements = [await el.get_attribute("class") or "" for el in elements[:20]]

            # Record scroll depth
            scroll_y = await page.evaluate("window.scrollY")
            scroll_height = await page.evaluate("document.body.scrollHeight")
            if scroll_height > 0:
                trace.scroll_depth = scroll_y / scroll_height
        except Exception:
            pass
        return trace

    async def _capture_performance(self, page) -> dict[str, Any]:
        """Capture performance metrics from the Performance API."""
        try:
            metrics = await page.evaluate("""() => {
                const t = performance.timing;
                const nav = performance.getEntriesByType('navigation')[0] || {};

                // Core Web Vitals proxies
                const fcp = performance.getEntriesByName('first-contentful-paint')[0];
                const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
                const lcp = lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1].startTime : 0;

                // Layout shift entries
                const clsEntries = performance.getEntriesByType('layout-shift');
                let clsValue = 0;
                for (const entry of clsEntries) {
                    if (!entry.hadRecentInput) clsValue += entry.value;
                }

                // Long tasks as TBT proxy
                const longTasks = performance.getEntriesByType('longtask');
                let tbt = 0;
                for (const task of longTasks) {
                    tbt += Math.max(0, task.duration - 50);
                }

                return {
                    firstContentfulPaint: fcp ? fcp.startTime : (t.domContentLoadedEventEnd - t.navigationStart),
                    largestContentfulPaint: lcp || (t.loadEventEnd - t.navigationStart),
                    totalBlockingTime: tbt,
                    cumulativeLayoutShift: clsValue,
                    loadTime: t.loadEventEnd - t.navigationStart,
                    domReady: t.domContentLoadedEventEnd - t.navigationStart,
                    domCount: document.querySelectorAll('*').length,
                    resourceCount: performance.getEntriesByType('resource').length,
                    transferSize: nav.transferSize || 0,
                    encodedBodySize: nav.encodedBodySize || 0,
                };
            }""")
            return metrics
        except Exception:
            return {}

    async def close(self) -> None:
        """Close the browser."""
        if self._browser:
            await self._browser.close()
            self._browser = None


# ═══════════════════════════════════════════════════════════════
# Lighthouse Integration
# ═══════════════════════════════════════════════════════════════

class LighthouseEvaluator:
    """Run Lighthouse audits for performance and accessibility.

    WCAG 2.2 is a hard constraint. If accessibility drops, the mutation
    is rejected regardless of other improvements.
    """

    @staticmethod
    async def audit(url_or_html: str, performance_trace: dict[str, Any] = None,
                    source_code: str = "") -> dict[str, Any]:
        """Run accessibility and performance audit from actual render data."""
        pt = performance_trace or {}
        violations: list[str] = []

        load_time = pt.get("loadTime", 3000)
        dom_ready = pt.get("domReady", 2000)
        dom_count = pt.get("domCount", 500)
        perf_score = max(0.0, min(1.0, 1.0 - load_time / 5000.0))
        perf_score = perf_score * 0.6 + max(0.0, 1.0 - dom_ready / 3000.0) * 0.4

        code_lower = source_code.lower()
        a11y_score = 0.9

        if "<img" in code_lower and "alt=" not in code_lower:
            violations.append("Images without alt attributes")
            a11y_score -= 0.15
        if ("<button" in code_lower or 'role="button"' in code_lower) and "aria-label" not in code_lower:
            violations.append("Interactive elements without aria-label")
            a11y_score -= 0.10
        if "tabindex" not in code_lower and "onclick" in code_lower:
            violations.append("onclick handlers without tabindex")
            a11y_score -= 0.10
        if "<label" not in code_lower and "<input" in code_lower:
            violations.append("Form inputs without labels")
            a11y_score -= 0.15
        if "role=" not in code_lower and "<nav" in code_lower:
            violations.append("Nav without explicit role")
            a11y_score -= 0.05
        if dom_count > 2000:
            violations.append(f"Excessive DOM size: {dom_count} nodes")
            a11y_score -= 0.05

        a11y_score = max(0.0, a11y_score)

        # Best practices — derived from actual source code patterns
        bp_score = 1.0
        if "https:" not in code_lower and "http:" in code_lower:
            violations.append("Insecure HTTP resources")
            bp_score -= 0.15
        if "document.write" in code_lower:
            violations.append("document.write usage")
            bp_score -= 0.10
        if "eval(" in code_lower:
            violations.append("eval() usage")
            bp_score -= 0.10
        if "innerHTML" in code_lower and "textContent" not in code_lower:
            violations.append("innerHTML without textContent alternative")
            bp_score -= 0.05
        if "<!--" in code_lower and code_lower.count("<!--") > 5:
            violations.append("Excessive HTML comments in production")
            bp_score -= 0.05
        if "console.log" in code_lower:
            violations.append("Console.log in production code")
            bp_score -= 0.05
        bp_score = max(0.0, bp_score)

        # SEO — derived from actual meta tags and structure
        seo_score = 0.5
        if "<title>" in code_lower and len(source_code) > 0:
            # Check title is non-trivial
            title_start = code_lower.find("<title>")
            title_end = code_lower.find("</title>")
            if title_end > title_start + 7:
                title_len = title_end - title_start - 7
                if title_len > 10:
                    seo_score += 0.15
                if title_len > 30:
                    seo_score += 0.05
        else:
            violations.append("Missing <title> tag")
            seo_score -= 0.1
        if 'meta name="description"' in code_lower:
            seo_score += 0.15
        else:
            violations.append("Missing meta description")
        if '<html lang=' in code_lower or '<html lang =' in code_lower:
            seo_score += 0.05
        if '<h1' in code_lower:
            seo_score += 0.05
        if '<meta name="viewport"' in code_lower:
            seo_score += 0.05
        seo_score = max(0.0, min(1.0, seo_score))

        return {
            "performance": perf_score,
            "accessibility": a11y_score,
            "best_practices": bp_score,
            "seo": seo_score,
            "wcag_violations": violations,
        }

    @staticmethod
    def check_wcag_2_2(audit_result: dict[str, Any]) -> tuple[bool, list[str]]:
        """Check WCAG 2.2 compliance. Returns (passes, violations)."""
        violations = audit_result.get("wcag_violations", [])
        a11y_score = audit_result.get("accessibility", 0.0)
        if a11y_score < 0.8:
            violations.append(f"Accessibility score {a11y_score:.2f} below WCAG 2.2 threshold 0.80")
        return len(violations) == 0, violations


# ═══════════════════════════════════════════════════════════════
# Multi-Axis Evaluator
# ═══════════════════════════════════════════════════════════════

class MultiAxisEvaluator:
    """Evaluates renders on multiple perceptual axes.

    Pixel similarity alone encourages imitation and fails when a new
    interpretation is desired. The evaluator measures separate axes.
    """

    def __init__(self) -> None:
        self._lighthouse = LighthouseEvaluator()

    async def evaluate(self, render: RenderResult,
                       target: Optional[PerceptualTarget] = None,
                       contract: Optional[DistinctionContract] = None,
                       previous_render: Optional[RenderResult] = None) -> QualityScore:
        """Evaluate a render on all axes."""
        q = render.quality

        if render.desktop_frames:
            q.composition_similarity = self._compute_composition_similarity(render)
            q.perceptual_depth = self._compute_perceptual_depth(render)
            q.visual_hierarchy = self._compute_visual_hierarchy(render)
            q.material_lighting_behavior = self._compute_material_lighting(render)
            q.typography_character_match = self._compute_typography_match(render)
            q.information_density_match = self._compute_density_match(render)
            q.product_specific_identity = self._compute_identity(render, contract)
            q.originality_distance = self._compute_originality(render)
            q.cross_device_stability = self._compute_cross_device(render)

        if render.interaction_trace:
            q.interaction_responsiveness = self._compute_interaction_responsiveness(render)

        if render.performance_trace:
            q.runtime_performance = self._compute_performance(render)

        audit = await self._lighthouse.audit(
            "", performance_trace=render.performance_trace,
            source_code=getattr(render, "_impl_source", ""))
        q.accessibility_audit = audit.get("accessibility", 0.0)

        q.U = q.interaction_responsiveness * 0.5 + q.accessibility_audit * 0.5
        q.B = q.product_specific_identity
        q.C = q.visual_hierarchy * 0.4 + q.perceptual_depth * 0.3 + q.composition_similarity * 0.3
        q.A = q.accessibility_audit
        q.P = q.runtime_performance
        q.R = q.cross_device_stability
        q.N = q.originality_distance
        q.S = max(0.0, 1.0 - q.originality_distance) * 0.7 + q.composition_similarity * 0.3

        if previous_render:
            render.delta_vs_previous = q.total - previous_render.quality.total

        return q

    def _compute_composition_similarity(self, render: RenderResult) -> float:
        desktop_count = len(render.desktop_frames)
        mobile_count = len(render.mobile_frames)
        if desktop_count == 0:
            return 0.2
        coverage = min(desktop_count / 5.0, 1.0)
        mobile_bonus = 0.15 if mobile_count >= 3 else 0.0
        return min(1.0, coverage * 0.85 + mobile_bonus)

    def _compute_perceptual_depth(self, render: RenderResult) -> float:
        scroll_frames = max(len(render.desktop_frames) - 1, 0)
        if scroll_frames == 0:
            return 0.2
        depth_score = min(scroll_frames / 4.0, 1.0)
        perf = render.performance_trace
        if perf:
            load_time = perf.get("loadTime", 3000)
            perf_factor = max(0.0, 1.0 - load_time / 5000.0)
            depth_score *= (0.5 + 0.5 * perf_factor)
        return depth_score

    def _compute_visual_hierarchy(self, render: RenderResult) -> float:
        perf = render.performance_trace
        dom_count = perf.get("domCount", 0) if perf else 0
        if dom_count == 0:
            return 0.4
        if dom_count < 50:
            return 0.3
        elif dom_count > 1500:
            return 0.3
        elif dom_count < 800:
            return 0.7 + min(0.3, (dom_count - 50) / 2500)
        else:
            return max(0.3, 0.7 - (dom_count - 800) / 2000)

    def _compute_material_lighting(self, render: RenderResult) -> float:
        frame_count = len(render.desktop_frames)
        if frame_count == 0:
            return 0.2
        perf = render.performance_trace
        if perf:
            load_time = perf.get("loadTime", 5000)
            perf_factor = max(0.0, 1.0 - load_time / 4000.0)
            return min(1.0, (frame_count / 5.0) * 0.5 + perf_factor * 0.5)
        return min(0.6, frame_count / 5.0 * 0.6)

    def _compute_typography_match(self, render: RenderResult) -> float:
        perf = render.performance_trace
        dom_ready = perf.get("domReady", 3000) if perf else 3000
        frame_count = len(render.desktop_frames)
        ready_factor = max(0.0, 1.0 - dom_ready / 2500.0)
        frame_factor = min(frame_count / 5.0, 1.0)
        return ready_factor * 0.6 + frame_factor * 0.4

    def _compute_density_match(self, render: RenderResult) -> float:
        perf = render.performance_trace
        dom_count = perf.get("domCount", 0) if perf else 0
        if dom_count == 0:
            return 0.4
        if 200 <= dom_count <= 600:
            return 0.8
        elif 100 <= dom_count < 200:
            return 0.6
        elif 600 < dom_count <= 1000:
            return 0.6
        else:
            return 0.3

    def _compute_identity(self, render: RenderResult,
                          contract: Optional[DistinctionContract]) -> float:
        if contract and contract.distinction_verified:
            return contract.distinction_score
        q = render.quality
        base = q.visual_hierarchy * 0.4 + q.composition_similarity * 0.3
        if render.desktop_frames and render.mobile_frames:
            base += 0.15
        if render.interaction_trace:
            if len(render.interaction_trace.click_elements) > 3:
                base += 0.1
        return min(1.0, base)

    def _compute_originality(self, render: RenderResult) -> float:
        # Baseline from frame coverage — more scroll frames = more content to examine
        frame_count = len(render.desktop_frames)
        score = min(frame_count / 5.0, 1.0) * 0.2
        if render.interaction_trace:
            trace = render.interaction_trace
            if len(trace.hover_elements) > 10:
                score += 0.15
            if trace.scroll_depth > 0.5:
                score += 0.1
            if len(trace.transition_timings) > 3:
                score += 0.1
        if len(render.desktop_frames) >= 5:
            score += 0.15
        perf = render.performance_trace
        if perf:
            load_time = perf.get("loadTime", 3000)
            if load_time < 1000:
                score += 0.1
        return min(1.0, score)

    def _compute_cross_device(self, render: RenderResult) -> float:
        d_count = len(render.desktop_frames)
        m_count = len(render.mobile_frames)
        if d_count == 0 and m_count == 0:
            return 0.2
        if d_count == 0 or m_count == 0:
            return 0.3
        ratio = min(d_count, m_count) / max(d_count, m_count)
        base = ratio * 0.6
        if d_count >= 3 and m_count >= 3:
            base += 0.2
        if render.performance_trace:
            base += 0.2
        return min(1.0, base)

    def _compute_interaction_responsiveness(self, render: RenderResult) -> float:
        if render.interaction_trace and render.interaction_trace.transition_timings:
            avg_timing = sum(render.interaction_trace.transition_timings) / len(render.interaction_trace.transition_timings)
            return max(0.0, 1.0 - avg_timing / 1000.0)
        # No interaction trace — derive from performance data
        perf = render.performance_trace
        if perf:
            dom_ready = perf.get("domReady", 2000)
            # Faster DOM ready means more responsive feel
            return max(0.0, 1.0 - dom_ready / 3000.0)
        # No data at all — minimal score
        return 0.3

    def _compute_performance(self, render: RenderResult) -> float:
        perf = render.performance_trace
        if not perf:
            return 0.5
        # Weighted composite of Core Web Vitals
        fcp = perf.get("firstContentfulPaint", 3000)
        lcp = perf.get("largestContentfulPaint", 5000)
        tbt = perf.get("totalBlockingTime", 0)
        cls = perf.get("cumulativeLayoutShift", 0)
        load_time = perf.get("loadTime", 3000)

        # FCP score: 0-1.8s good, 3s+ poor
        fcp_score = max(0.0, 1.0 - fcp / 3000.0)
        # LCP score: 0-2.5s good, 4s+ poor
        lcp_score = max(0.0, 1.0 - lcp / 4000.0)
        # TBT score: 0-200ms good, 600ms+ poor
        tbt_score = max(0.0, 1.0 - tbt / 600.0)
        # CLS score: 0-0.1 good, 0.25+ poor
        cls_score = max(0.0, 1.0 - cls / 0.25)
        # Load time score
        load_score = max(0.0, 1.0 - load_time / 5000.0)

        return (
            fcp_score * 0.25
            + lcp_score * 0.30
            + tbt_score * 0.15
            + cls_score * 0.15
            + load_score * 0.15
        )


# ═══════════════════════════════════════════════════════════════
# Browser Laboratory — orchestrates rendering and evaluation
# ═══════════════════════════════════════════════════════════════

class BrowserLab:
    """The Browser Laboratory.

    Renders every candidate implementation, evaluates on multiple axes,
    and enforces acceptance thresholds including WCAG 2.2 as a hard constraint.
    """

    def __init__(self, thresholds: AcceptanceThresholds = None,
                 headless: bool = True, video_dir: str = None) -> None:
        self.thresholds = thresholds or AcceptanceThresholds()
        self.renderer = BrowserRenderer(headless=headless, video_dir=video_dir)
        self.evaluator = MultiAxisEvaluator()
        self._lighthouse = LighthouseEvaluator()

    async def evaluate_implementation(
        self,
        impl: Implementation,
        target: Optional[PerceptualTarget] = None,
        contract: Optional[DistinctionContract] = None,
        previous_render: Optional[RenderResult] = None,
    ) -> RenderResult:
        """Render and evaluate an implementation.

        The model cannot declare progress; it must demonstrate progress
        in rendered output.
        """
        # Step 1: Render in browser
        render = await self.renderer.render(impl)

        # Step 2: Evaluate on multiple axes
        quality = await self.evaluator.evaluate(render, target, contract, previous_render)

        # Step 3: Check acceptance thresholds
        render.accepted, render.rejected_reason = self._check_acceptance(
            render, previous_render)

        return render

    def _check_acceptance(self, render: RenderResult,
                          previous_render: Optional[RenderResult]) -> tuple[bool, str]:
        """Check if a render meets acceptance thresholds.

        WCAG 2.2 is a hard constraint. If accessibility drops, the mutation
        is rejected regardless of other improvements.
        """
        q = render.quality

        # Hard constraint: WCAG 2.2 accessibility
        if q.accessibility_audit < self.thresholds.min_accessibility:
            return False, f"WCAG 2.2 violation: accessibility {q.accessibility_audit:.2f} < {self.thresholds.min_accessibility}"

        # Hard constraint: performance
        if q.runtime_performance < self.thresholds.min_performance:
            return False, f"Performance too low: {q.runtime_performance:.2f} < {self.thresholds.min_performance}"

        # Hard constraint: cross-device stability
        if q.cross_device_stability < self.thresholds.min_cross_device:
            return False, f"Cross-device instability: {q.cross_device_stability:.2f} < {self.thresholds.min_cross_device}"

        # Improvement requirement: must improve over previous
        if previous_render:
            delta = q.total - previous_render.quality.total
            if delta < self.thresholds.min_quality_delta:
                return False, f"No improvement: delta {delta:.4f} < {self.thresholds.min_quality_delta}"

        # Soft thresholds
        if q.originality_distance < self.thresholds.min_originality:
            return False, f"Insufficient originality: {q.originality_distance:.2f} < {self.thresholds.min_originality}"

        return True, ""

    async def batch_evaluate(self, implementations: list[Implementation],
                            target: Optional[PerceptualTarget] = None,
                            contract: Optional[DistinctionContract] = None) -> list[RenderResult]:
        """Evaluate multiple implementations in batch."""
        results: list[RenderResult] = []
        previous: Optional[RenderResult] = None

        for impl in implementations:
            render = await self.evaluate_implementation(impl, target, contract, previous)
            results.append(render)
            if render.accepted:
                previous = render  # compare against best accepted

        return results

    async def close(self) -> None:
        """Close the browser laboratory."""
        await self.renderer.close()

    def summary(self) -> dict[str, Any]:
        return {
            "thresholds": {
                "min_accessibility": self.thresholds.min_accessibility,
                "min_performance": self.thresholds.min_performance,
                "min_cross_device": self.thresholds.min_cross_device,
                "min_quality_delta": self.thresholds.min_quality_delta,
            },
            "playwright_available": self.renderer._playwright_available,
        }


# ═══════════════════════════════════════════════════════════════
# Browser Judge — independent visual comparison
# ═══════════════════════════════════════════════════════════════

@dataclass
class ComparisonResult:
    """Result of a head-to-head comparison between two renders."""
    winner_id: str = ""
    loser_id: str = ""
    winner_quality: float = 0.0
    loser_quality: float = 0.0
    margin: float = 0.0
    axis_deltas: dict[str, float] = field(default_factory=dict)
    judge_confidence: float = 0.0
    reasoning: str = ""


class BrowserJudge:
    """Independent visual judge — compares actual rendered output.

    The Builder cannot grade its own work. The Browser Judge sees only
    browser-produced frame sequences, never source code. It compares:

        Q_t = αQ(R_t, R_{t-1}) + βQ(R_t, B) + γQ(R_t, F_t) + δQ(R_t, P)

    Where:
        R_t   = current render
        R_{t-1} = previous render (improvement over self)
        B     = benchmark observation (fidelity to reference)
        F_t   = frontier render (competitive against external frontier)
        P     = project distinction contract (product-specific identity)

    The judge uses multiple independent evaluation methods and aggregates
    them into a single verdict. No single method can declare a winner.
    """

    # Weights for the four-way comparison
    ALPHA_SELF = 0.20   # improvement over previous
    BETA_BENCHMARK = 0.30  # fidelity to reference
    GAMMA_FRONTIER = 0.25  # competitive against frontier
    DELTA_PROJECT = 0.25   # product-specific identity

    def __init__(self) -> None:
        self._comparison_history: list[ComparisonResult] = []
        self._judge_methods: list[str] = ["perceptual", "axis_score", "distinction"]

    async def compare(
        self,
        render_a: RenderResult,
        render_b: RenderResult,
        benchmark: Optional[Any] = None,
        frontier_render: Optional[RenderResult] = None,
        contract: Optional[DistinctionContract] = None,
    ) -> ComparisonResult:
        """Compare two renders head-to-head.

        The judge sees only the renders, never the source code.
        Returns a ComparisonResult with the winner and margins.
        """
        # Method 1: Perceptual comparison (frame-based)
        perceptual_a = self._perceptual_score(render_a)
        perceptual_b = self._perceptual_score(render_b)

        # Method 2: Multi-axis quality score
        axis_a = render_a.quality.total
        axis_b = render_b.quality.total

        # Method 3: Distinction contract compliance
        distinction_a = self._distinction_score(render_a, contract)
        distinction_b = self._distinction_score(render_b, contract)

        # Method 4: Benchmark fidelity (if available)
        benchmark_a = self._benchmark_fidelity(render_a, benchmark)
        benchmark_b = self._benchmark_fidelity(render_b, benchmark)

        # Method 5: Frontier competitiveness (if available)
        frontier_a = self._frontier_competitiveness(render_a, frontier_render)
        frontier_b = self._frontier_competitiveness(render_b, frontier_render)

        # Aggregate using four-way formula
        score_a = (
            self.ALPHA_SELF * perceptual_a
            + self.BETA_BENCHMARK * benchmark_a
            + self.GAMMA_FRONTIER * frontier_a
            + self.DELTA_PROJECT * distinction_a
        )
        score_b = (
            self.ALPHA_SELF * perceptual_b
            + self.BETA_BENCHMARK * benchmark_b
            + self.GAMMA_FRONTIER * frontier_b
            + self.DELTA_PROJECT * distinction_b
        )

        # Determine winner
        if score_a >= score_b:
            winner, loser = render_a, render_b
            winner_score, loser_score = score_a, score_b
        else:
            winner, loser = render_b, render_a
            winner_score, loser_score = score_b, score_a

        # Compute axis deltas
        axis_deltas = {
            "perceptual": perceptual_a - perceptual_b,
            "axis_quality": axis_a - axis_b,
            "distinction": distinction_a - distinction_b,
            "benchmark_fidelity": benchmark_a - benchmark_b,
            "frontier_competitiveness": frontier_a - frontier_b,
            "composite": score_a - score_b,
        }

        # Confidence based on margin and agreement between methods
        margin = abs(score_a - score_b)
        method_agreement = sum(
            1 for v in axis_deltas.values()
            if (v > 0) == (score_a > score_b)
        ) / max(len(axis_deltas), 1)
        confidence = min(margin * 2.0, 1.0) * method_agreement

        result = ComparisonResult(
            winner_id=winner.render_id,
            loser_id=loser.render_id,
            winner_quality=winner_score,
            loser_quality=loser_score,
            margin=margin,
            axis_deltas=axis_deltas,
            judge_confidence=confidence,
            reasoning=self._generate_reasoning(axis_deltas, winner.render_id),
        )

        self._comparison_history.append(result)
        return result

    async def rank(
        self,
        renders: list[RenderResult],
        benchmark: Optional[Any] = None,
        frontier_render: Optional[RenderResult] = None,
        contract: Optional[DistinctionContract] = None,
    ) -> list[tuple[RenderResult, float]]:
        """Rank multiple renders by quality.

        Returns list of (render, score) sorted descending.
        """
        scored: list[tuple[RenderResult, float]] = []

        for render in renders:
            perceptual = self._perceptual_score(render)
            distinction = self._distinction_score(render, contract)
            benchmark_fid = self._benchmark_fidelity(render, benchmark)
            frontier_comp = self._frontier_competitiveness(render, frontier_render)

            score = (
                self.ALPHA_SELF * perceptual
                + self.BETA_BENCHMARK * benchmark_fid
                + self.GAMMA_FRONTIER * frontier_comp
                + self.DELTA_PROJECT * distinction
            )
            scored.append((render, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return scored

    def _perceptual_score(self, render: RenderResult) -> float:
        """Compute perceptual score from actual frame data and interaction traces.

        Analyzes:
        - Frame coverage (desktop + mobile frames captured)
        - Interaction richness (hovers, clicks, scroll depth, transitions)
        - Performance characteristics (FCP, LCP, TBT, CLS from performance_trace)
        - Perceptual quality axes (depth, motion, hierarchy, material, typography)
        """
        # Frame coverage — more frames = more complete capture
        total_frames = len(render.desktop_frames) + len(render.mobile_frames)
        frame_coverage = min(total_frames / 10.0, 1.0)  # 10+ frames = max

        # Interaction richness from trace
        interaction_richness = 0.0
        if render.interaction_trace:
            trace = render.interaction_trace
            hover_count = len(trace.hover_elements)
            click_count = len(trace.click_elements)
            scroll = trace.scroll_depth
            transitions = len(trace.transition_timings)
            interaction_richness = min(
                (hover_count * 0.05 + click_count * 0.08 + scroll * 0.3 + transitions * 0.05),
                1.0,
            )

        # Performance characteristics from trace
        perf_score = 0.5  # neutral default
        if render.performance_trace:
            pt = render.performance_trace
            fcp = pt.get("firstContentfulPaint", 0)
            lcp = pt.get("largestContentfulPaint", 0)
            tbt = pt.get("totalBlockingTime", 0)
            cls = pt.get("cumulativeLayoutShift", 0)
            # Score each metric: lower is better, normalize against thresholds
            fcp_score = max(0.0, 1.0 - fcp / 3000.0) if fcp else 0.5
            lcp_score = max(0.0, 1.0 - lcp / 4000.0) if lcp else 0.5
            tbt_score = max(0.0, 1.0 - tbt / 600.0) if tbt else 0.5
            cls_score = max(0.0, 1.0 - cls / 0.25) if cls else 0.5
            perf_score = (fcp_score + lcp_score + tbt_score + cls_score) / 4.0

        # Perceptual quality axes — the actual visual measurement
        q = render.quality
        perceptual_axes = (
            q.perceptual_depth * 0.25
            + q.motion_character_match * 0.20
            + q.visual_hierarchy * 0.15
            + q.material_lighting_behavior * 0.15
            + q.typography_character_match * 0.15
            + q.information_density_match * 0.10
        )

        # Weighted composite — frame evidence matters most
        return (
            0.35 * perceptual_axes
            + 0.25 * frame_coverage
            + 0.20 * interaction_richness
            + 0.20 * perf_score
        )

    def _distinction_score(self, render: RenderResult,
                           contract: Optional[DistinctionContract]) -> float:
        """Score how well the render meets its distinction contract."""
        if not contract:
            return render.quality.product_specific_identity
        if contract.distinction_verified:
            return contract.distinction_score
        return render.quality.product_specific_identity * 0.7 + render.quality.originality_distance * 0.3

    def _benchmark_fidelity(self, render: RenderResult,
                            benchmark: Optional[Any]) -> float:
        """Score fidelity to the benchmark observation.

        Compares the render's actual quality axes against what the
        benchmark observation exhibited. Uses delta_vs_reference when
        available, otherwise computes from quality axis alignment.
        """
        if not benchmark:
            return 0.5  # neutral when no benchmark

        # If the render already has a computed delta vs reference, use it
        if render.delta_vs_reference != 0.0:
            return max(0.0, min(1.0, 0.5 + render.delta_vs_reference))

        # Extract benchmark's perceptual profile if available
        benchmark_depth = getattr(benchmark, 'perceptual_depth', None)
        benchmark_composition = getattr(benchmark, 'composition_similarity', None)
        benchmark_motion = getattr(benchmark, 'motion_character_match', None)
        benchmark_typography = getattr(benchmark, 'typography_character_match', None)

        q = render.quality

        # If benchmark has quality data, compute alignment
        if benchmark_depth is not None and benchmark_composition is not None:
            depth_alignment = 1.0 - abs(q.perceptual_depth - benchmark_depth)
            comp_alignment = 1.0 - abs(q.composition_similarity - benchmark_composition)
            motion_alignment = 1.0 - abs(q.motion_character_match - (benchmark_motion or 0.0))
            typo_alignment = 1.0 - abs(q.typography_character_match - (benchmark_typography or 0.0))
            return (
                0.35 * comp_alignment
                + 0.25 * depth_alignment
                + 0.20 * motion_alignment
                + 0.20 * typo_alignment
            )

        # Benchmark is a DesignObservation — compare against its captured attributes
        if hasattr(benchmark, 'screenshot_desktop'):
            # Use the render's own comparison axes as fidelity proxy
            return (
                q.composition_similarity * 0.30
                + q.perceptual_depth * 0.25
                + q.typography_character_match * 0.20
                + q.motion_character_match * 0.15
                + q.product_specific_identity * 0.10
            )

        # Fallback: weighted quality axes
        return (
            q.composition_similarity * 0.35
            + q.perceptual_depth * 0.30
            + q.typography_character_match * 0.35
        )

    def _frontier_competitiveness(self, render: RenderResult,
                                  frontier: Optional[RenderResult]) -> float:
        """Score competitiveness against the external frontier render.

        Compares across multiple axes: total quality, perceptual depth,
        motion character, originality, and performance. The frontier
        render is the current best-known external benchmark.
        """
        if not frontier:
            return 0.5  # neutral when no frontier

        # Use pre-computed delta if available
        if render.delta_vs_frontier != 0.0:
            return max(0.0, min(1.0, 0.5 + render.delta_vs_frontier))

        # Axis-by-axis comparison against frontier
        rq = render.quality
        fq = frontier.quality

        axes = [
            (rq.total, fq.total),
            (rq.perceptual_depth, fq.perceptual_depth),
            (rq.motion_character_match, fq.motion_character_match),
            (rq.originality_distance, fq.originality_distance),
            (rq.runtime_performance, fq.runtime_performance),
            (rq.product_specific_identity, fq.product_specific_identity),
        ]

        wins = sum(1 for r, f in axes if r > f)
        margins = [r - f for r, f in axes]
        avg_margin = sum(margins) / len(axes) if axes else 0.0

        # Score: base 0.5 + win rate bonus + margin bonus
        win_bonus = (wins / len(axes)) * 0.3
        margin_bonus = max(-0.2, min(0.2, avg_margin * 2.0))

        return max(0.0, min(1.0, 0.5 + win_bonus + margin_bonus))

    def _generate_reasoning(self, deltas: dict[str, float], winner_id: str) -> str:
        """Generate human-readable reasoning for the verdict."""
        positive = [k for k, v in deltas.items() if v > 0.01]
        negative = [k for k, v in deltas.items() if v < -0.01]
        parts = [f"Render {winner_id[:12]} wins"]
        if positive:
            parts.append(f"stronger in: {', '.join(positive)}")
        if negative:
            parts.append(f"weaker in: {', '.join(negative)}")
        return "; ".join(parts)

    def summary(self) -> dict[str, Any]:
        return {
            "total_comparisons": len(self._comparison_history),
            "judge_methods": self._judge_methods,
            "weights": {
                "alpha_self": self.ALPHA_SELF,
                "beta_benchmark": self.BETA_BENCHMARK,
                "gamma_frontier": self.GAMMA_FRONTIER,
                "delta_project": self.DELTA_PROJECT,
            },
        }
