"""Tests for BeautyObserver, DiscoveryEngine, ReplicationEngine.

Tests the beauty observation pipeline:
- BeautyObserver: renders sites, scores beauty on multiple axes, identifies what makes them beautiful
- DiscoveryEngine: crawls directory pages, extracts links, filters junk, rate limits
- ReplicationEngine: generates HTML/CSS from beauty findings, evolves through mutation
"""

import asyncio
import sys
import os

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rxreserve.beauty_observer import BeautyObserver, BeautyObservation
from rxreserve.discovery_engine import DiscoveryEngine
from rxreserve.replication_engine import ReplicationEngine, ReplicationResult
from rxreserve.browser_lab import RenderResult
from rxreserve.design_genome import RendererType, SourceCategory
from rxreserve.builder import MutationType


# ═══════════════════════════════════════════════════════════════
# BeautyObservation dataclass tests
# ═══════════════════════════════════════════════════════════════

class TestBeautyObservation:
    def test_defaults(self):
        obs = BeautyObservation(url="https://example.com")
        assert obs.url == "https://example.com"
        assert obs.beauty_score == 0.0
        assert obs.composition_score == 0.0
        assert obs.typography_decisions == []
        assert obs.unusual_decisions == []
        assert obs.font_families == []
        assert obs.color_palette == []

    def test_is_beautiful_above_threshold(self):
        obs = BeautyObservation(url="https://example.com", beauty_score=0.8)
        assert obs.is_beautiful(threshold=0.6) is True

    def test_is_beautiful_below_threshold(self):
        obs = BeautyObservation(url="https://example.com", beauty_score=0.3)
        assert obs.is_beautiful(threshold=0.6) is False

    def test_is_beautiful_at_threshold(self):
        obs = BeautyObservation(url="https://example.com", beauty_score=0.6)
        assert obs.is_beautiful(threshold=0.6) is True

    def test_is_beautiful_custom_threshold(self):
        obs = BeautyObservation(url="https://example.com", beauty_score=0.7)
        assert obs.is_beautiful(threshold=0.75) is False


# ═══════════════════════════════════════════════════════════════
# BeautyObserver tests
# ═══════════════════════════════════════════════════════════════

class TestBeautyObserver:
    def test_init(self):
        observer = BeautyObserver(headless=True)
        assert observer.renderer is not None
        assert observer.renderer.headless is True

    def test_init_with_video_dir(self):
        observer = BeautyObserver(headless=False, video_dir="/tmp/videos")
        assert observer.renderer.headless is False
        assert observer.renderer.video_dir == "/tmp/videos"

    def test_analyze_render_extracts_performance_data(self):
        observer = BeautyObserver()
        render = RenderResult(
            implementation_id="test",
            renderer_type=RendererType.DOM_CSS,
            performance_trace={
                "firstContentfulPaint": 800,
                "largestContentfulPaint": 1800,
                "cumulativeLayoutShift": 0.05,
                "domCount": 150,
            },
            desktop_frames=["frame1"],
        )
        obs = observer._analyze_render("https://example.com", render)
        assert obs.fcp_ms == 800
        assert obs.lcp_ms == 1800
        assert obs.cls == 0.05
        assert obs.dom_element_count == 150
        assert obs.performance_score > 0.0

    def test_analyze_render_computes_beauty_score(self):
        observer = BeautyObserver()
        render = RenderResult(
            implementation_id="test",
            renderer_type=RendererType.DOM_CSS,
            desktop_frames=["frame1", "frame2"],
            performance_trace={
                "firstContentfulPaint": 500,
                "largestContentfulPaint": 1200,
                "cumulativeLayoutShift": 0.02,
                "domCount": 100,
            },
        )
        obs = observer._analyze_render("https://example.com", render)
        # Beauty score should be computed from the axis scores
        assert obs.beauty_score >= 0.0
        assert obs.composition_score >= 0.0
        assert obs.typography_score >= 0.0
        assert obs.color_score >= 0.0

    def test_analyze_render_identifies_qualitative_findings(self):
        observer = BeautyObserver()
        render = RenderResult(
            implementation_id="test",
            renderer_type=RendererType.DOM_CSS,
            desktop_frames=["frame1"],
            performance_trace={
                "firstContentfulPaint": 500,
                "largestContentfulPaint": 1200,
                "cumulativeLayoutShift": 0.02,
                "domCount": 100,
            },
        )
        obs = observer._analyze_render("https://example.com", render)
        # Should identify composition pattern, typography, color, etc.
        assert isinstance(obs.composition_pattern, str)
        assert isinstance(obs.typography_decisions, list)
        assert isinstance(obs.unusual_decisions, list)

    def test_analyze_render_with_no_performance_data(self):
        observer = BeautyObserver()
        render = RenderResult(
            implementation_id="test",
            renderer_type=RendererType.DOM_CSS,
        )
        obs = observer._analyze_render("https://example.com", render)
        assert obs.fcp_ms == 0.0
        assert obs.lcp_ms == 0.0
        assert obs.performance_score >= 0.0


# ═══════════════════════════════════════════════════════════════
# DiscoveryEngine tests
# ═══════════════════════════════════════════════════════════════

class TestDiscoveryEngine:
    def test_init(self):
        engine = DiscoveryEngine()
        assert engine.queue_size() == 0
        assert engine.crawled_count() == 0
        assert engine.visited_count() == 0

    def test_directory_seeds_cover_multiple_categories(self):
        categories = {seed["category"] for seed in DiscoveryEngine.DIRECTORY_SEEDS}
        assert SourceCategory.AWARD_WINNING in categories
        assert SourceCategory.EMERGING_INTERFACES in categories

    def test_directory_seeds_have_valid_urls(self):
        for seed in DiscoveryEngine.DIRECTORY_SEEDS:
            assert seed["url"].startswith("https://")
            assert seed["category"] in SourceCategory

    def test_should_skip_url_social_media(self):
        engine = DiscoveryEngine()
        assert engine._should_skip_url("https://facebook.com/page") is True
        assert engine._should_skip_url("https://twitter.com/user") is True
        assert engine._should_skip_url("https://instagram.com/post") is True

    def test_should_skip_url_cdn(self):
        engine = DiscoveryEngine()
        assert engine._should_skip_url("https://cdnjs.cloudflare.com/lib.js") is True
        assert engine._should_skip_url("https://fonts.googleapis.com/css") is True

    def test_should_skip_url_file_downloads(self):
        engine = DiscoveryEngine()
        assert engine._should_skip_url("https://example.com/image.png") is True
        assert engine._should_skip_url("https://example.com/doc.pdf") is True
        assert engine._should_skip_url("https://example.com/style.css") is True

    def test_should_not_skip_valid_site(self):
        engine = DiscoveryEngine()
        assert engine._should_skip_url("https://beautiful-site.com/portfolio") is False
        assert engine._should_skip_url("https://agency.com/work") is False

    def test_should_skip_invalid_scheme(self):
        engine = DiscoveryEngine()
        assert engine._should_skip_url("javascript:void(0)") is True
        assert engine._should_skip_url("mailto:test@test.com") is True

    def test_extract_links_from_html(self):
        engine = DiscoveryEngine()
        html = """
        <html>
        <body>
            <a href="https://beautiful-site.com">Beautiful Site</a>
            <a href="https://another-site.com/work">Another</a>
            <a href="https://facebook.com">Skip me</a>
            <a href="/about">About</a>
            <a href="https://awwwards.com/sites">Self ref</a>
        </body>
        </html>
        """
        links = engine._extract_links(html, "https://awwwards.com/sites")
        # Should extract external links, skip social media and self-references
        assert "https://beautiful-site.com" in links
        assert "https://another-site.com/work" in links
        assert "https://facebook.com" not in links
        # /about should be resolved to awwwards.com/about — which is self-ref, skipped
        assert "https://awwwards.com/about" not in links

    def test_extract_links_deduplicates(self):
        engine = DiscoveryEngine()
        html = """
        <a href="https://site.com">A</a>
        <a href="https://site.com">B</a>
        <a href="https://site.com">C</a>
        """
        links = engine._extract_links(html, "https://directory.com")
        assert links.count("https://site.com") == 1

    def test_rate_limit_enforces_interval(self):
        engine = DiscoveryEngine()
        # First call should be instant
        import time
        start = time.time()
        engine._rate_limit("example.com", min_interval=0.1)
        elapsed_first = time.time() - start
        # Second call immediately after should wait
        start2 = time.time()
        engine._rate_limit("example.com", min_interval=0.1)
        elapsed_second = time.time() - start2
        assert elapsed_second >= 0.05  # should have waited

    def test_summary(self):
        engine = DiscoveryEngine()
        summary = engine.summary()
        assert isinstance(summary, dict)
        assert "queue_size" in summary or "queue" in summary or len(summary) > 0


# ═══════════════════════════════════════════════════════════════
# ReplicationEngine tests
# ═══════════════════════════════════════════════════════════════

class TestReplicationResult:
    def test_defaults(self):
        result = ReplicationResult(
            source_url="https://example.com",
            original_beauty_score=0.8,
            replicated_quality=0.7,
        )
        assert result.source_url == "https://example.com"
        assert result.original_beauty_score == 0.8
        assert result.replicated_quality == 0.7
        assert result.improvement_over_original == 0.0
        assert result.source_code == ""
        assert result.generations == 0
        assert result.techniques_used == []
        assert result.mutations_applied == []
        assert result.success is False
        assert result.failure_reasons == []
        assert result.best_render is None


class TestReplicationEngine:
    def test_init(self):
        engine = ReplicationEngine(headless=True, max_generations=3)
        assert engine.renderer is not None
        assert engine.max_generations == 3
        assert len(engine.mutation_axes) == 6

    def test_init_with_video_dir(self):
        engine = ReplicationEngine(headless=False, video_dir="/tmp/vids")
        assert engine.renderer.headless is False
        assert engine.renderer.video_dir == "/tmp/vids"

    def test_mutation_axes_include_all_types(self):
        engine = ReplicationEngine()
        assert MutationType.COMPOSITION in engine.mutation_axes
        assert MutationType.MOTION in engine.mutation_axes
        assert MutationType.LIGHTING in engine.mutation_axes
        assert MutationType.INTERACTION in engine.mutation_axes
        assert MutationType.TYPOGRAPHY in engine.mutation_axes
        assert MutationType.DENSITY in engine.mutation_axes

    def test_generate_initial_replication_grid_layout(self):
        engine = ReplicationEngine()
        obs = BeautyObservation(
            url="https://example.com",
            composition_pattern="grid layout",
            color_palette=["#0a0a0a", "#ffffff", "#6366f1"],
            has_sticky_nav=True,
            has_gradient_text=True,
        )
        html = engine._generate_initial_replication(obs)
        assert "<!DOCTYPE html>" in html
        assert "grid" in html.lower()
        assert "position: sticky" in html.lower() or "sticky" in html.lower()

    def test_generate_initial_replication_flex_layout(self):
        engine = ReplicationEngine()
        obs = BeautyObservation(
            url="https://example.com",
            composition_pattern="flexbox centered",
        )
        html = engine._generate_initial_replication(obs)
        assert "<!DOCTYPE html>" in html
        assert "flex" in html.lower()

    def test_generate_initial_replication_with_glassmorphism(self):
        engine = ReplicationEngine()
        obs = BeautyObservation(
            url="https://example.com",
            composition_pattern="grid",
            depth_treatment="glass layering with blur",
        )
        html = engine._generate_initial_replication(obs)
        assert "backdrop-filter" in html.lower() or "blur" in html.lower()

    def test_generate_initial_replication_with_motion(self):
        engine = ReplicationEngine()
        obs = BeautyObservation(
            url="https://example.com",
            composition_pattern="grid",
            motion_character="reveal on scroll with transitions",
        )
        html = engine._generate_initial_replication(obs)
        assert "transition" in html.lower() or "animation" in html.lower()

    def test_generate_initial_replication_uses_observed_colors(self):
        engine = ReplicationEngine()
        obs = BeautyObservation(
            url="https://example.com",
            composition_pattern="grid",
            color_palette=["#1a2b3c", "#4d5e6f", "#7a8b9c"],
        )
        html = engine._generate_initial_replication(obs)
        assert "#1a2b3c" in html or "#1A2B3C" in html

    def test_generate_initial_replication_uses_observed_fonts(self):
        engine = ReplicationEngine()
        obs = BeautyObservation(
            url="https://example.com",
            composition_pattern="grid",
            font_families=["Inter", "system-ui"],
        )
        html = engine._generate_initial_replication(obs)
        assert "Inter" in html

    def test_generate_initial_replication_gradient_text(self):
        engine = ReplicationEngine()
        obs = BeautyObservation(
            url="https://example.com",
            composition_pattern="grid",
            has_gradient_text=True,
        )
        html = engine._generate_initial_replication(obs)
        assert "gradient" in html.lower()
        assert "background-clip" in html.lower() or "text-fill-color" in html.lower()
