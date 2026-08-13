"""Scout — continuously discovers changing design frontiers.

The Scout does not decide what is good. It discovers what is changing.

Adversarial acquisition streams ensure the corpus doesn't homogenize:
    - emerging interfaces
    - award-winning interfaces
    - experimental art and games
    - scientific instruments
    - automotive interfaces
    - cinema title systems
    - aerospace/military visualization
    - medical imaging
    - industrial control systems
    - architecture and physical products
    - historically important interfaces
    - interfaces rejected by mainstream trends

Popularity discovers attention; it does not determine quality.
"""

from __future__ import annotations

import hashlib
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

from rxreserve.design_genome import (
    SourceEntry, SourceCategory, LicenseState, AssetClassification,
    DesignObservation, InteractionTrace,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ComplianceChecker:
    """Every source must pass compliance before capture."""

    @staticmethod
    def check_robots(url: str, robots_txt_content: str = "") -> bool:
        """Check robots.txt for crawl permission."""
        if not robots_txt_content:
            return True  # permissive if no robots.txt
        parsed = urlparse(url)
        path = parsed.path or "/"
        lines = robots_txt_content.lower().splitlines()
        user_agent_match = False
        for line in lines:
            line = line.strip()
            if line.startswith("user-agent:"):
                ua = line.split(":", 1)[1].strip()
                if ua == "*" or ua == "design-genome":
                    user_agent_match = True
                else:
                    user_agent_match = False
            elif user_agent_match and line.startswith("disallow:"):
                disallow = line.split(":", 1)[1].strip()
                if disallow and path.startswith(disallow):
                    return False
        return True

    @staticmethod
    def check_rate_limit(last_request_time: float, min_interval: float = 1.0) -> bool:
        """Enforce rate limiting between requests."""
        return (time.time() - last_request_time) >= min_interval

    @staticmethod
    def classify_license(content: str, meta_tags: dict[str, str] = None) -> LicenseState:
        """Classify the license state of a source."""
        if meta_tags is None:
            meta_tags = {}
        content_lower = content.lower()

        # Check for explicit open licenses
        open_indicators = ["creative commons", "cc by", "cc0", "public domain",
                          "mit license", "apache license", "open source"]
        for indicator in open_indicators:
            if indicator in content_lower:
                return LicenseState.OPEN

        # Check meta tags
        for key, val in meta_tags.items():
            val_lower = val.lower()
            for indicator in open_indicators:
                if indicator in val_lower:
                    return LicenseState.OPEN

        # Check for restricted content
        restricted_indicators = ["all rights reserved", "©", "copyright",
                                "no reproduction", "proprietary"]
        for indicator in restricted_indicators:
            if indicator in content_lower:
                return LicenseState.REFERENCE_ONLY

        return LicenseState.UNKNOWN

    @staticmethod
    def classify_asset(license_state: LicenseState) -> AssetClassification:
        """Classify whether source is reference-only or usable asset."""
        if license_state in (LicenseState.OPEN, LicenseState.PERMITTED):
            return AssetClassification.USABLE_ASSET
        return AssetClassification.REFERENCE_ONLY

    @staticmethod
    def remove_personal_info(text: str) -> str:
        """Remove personal information from captured content."""
        # Email addresses
        text = re.sub(r'\b[\w.+-]+@[\w-]+\.[\w.-]+\b', '[EMAIL_REMOVED]', text)
        # Phone numbers (basic)
        text = re.sub(r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b', '[PHONE_REMOVED]', text)
        # SSN-like patterns
        text = re.sub(r'\b\d{3}-\d{2}-\d{4}\b', '[SSN_REMOVED]', text)
        return text

    @staticmethod
    def compute_hash(content: str) -> str:
        """Compute content hash for deduplication."""
        return hashlib.sha256(content.encode()).hexdigest()[:32]


class TrendDetector:
    """Detect what is changing in the design frontier."""

    def __init__(self) -> None:
        self._seen_hashes: set[str] = set()
        self._category_velocity: dict[str, list[float]] = {}
        self._pattern_frequency: dict[str, int] = {}

    def is_novel(self, content_hash: str) -> bool:
        """Check if content has been seen before."""
        return content_hash not in self._seen_hashes

    def register(self, content_hash: str, category: SourceCategory,
                 detected_patterns: list[str] = None) -> float:
        """Register a new observation and compute trend velocity."""
        self._seen_hashes.add(content_hash)

        cat_key = category.value
        if cat_key not in self._category_velocity:
            self._category_velocity[cat_key] = []

        # Velocity = rate of new discoveries in this category
        self._category_velocity[cat_key].append(1.0)
        if len(self._category_velocity[cat_key]) > 100:
            self._category_velocity[cat_key] = self._category_velocity[cat_key][-100:]

        velocity = sum(self._category_velocity[cat_key]) / max(
            len(self._category_velocity[cat_key]), 1)

        if detected_patterns:
            for pattern in detected_patterns:
                self._pattern_frequency[pattern] = self._pattern_frequency.get(pattern, 0) + 1

        return velocity

    def get_saturation(self, pattern: str) -> float:
        """How over-represented is a pattern? 0=novel, 1=oversaturated."""
        max_freq = max(self._pattern_frequency.values()) if self._pattern_frequency else 1
        freq = self._pattern_frequency.get(pattern, 0)
        return freq / max_freq if max_freq > 0 else 0.0

    def get_oversaturated_patterns(self, threshold: float = 0.8) -> list[str]:
        """Get patterns that are over-represented."""
        return [p for p, f in self._pattern_frequency.items()
                if self.get_saturation(p) >= threshold]

    def summary(self) -> dict[str, Any]:
        return {
            "total_seen": len(self._seen_hashes),
            "categories_tracked": len(self._category_velocity),
            "patterns_tracked": len(self._pattern_frequency),
            "oversaturated_patterns": self.get_oversaturated_patterns(),
        }


class DeduplicationEngine:
    """Remove near-duplicates and template clones."""

    def __init__(self, similarity_threshold: float = 0.85) -> None:
        self.threshold = similarity_threshold
        self._hashes: dict[str, str] = {}  # hash -> source_id
        self._embeddings: list[tuple[str, list[float]]] = []

    def is_duplicate(self, content_hash: str, visual_embedding: list[float] = None) -> tuple[bool, Optional[str]]:
        """Check if content is a near-duplicate of existing observation."""
        # Exact hash match
        if content_hash in self._hashes:
            return True, self._hashes[content_hash]

        # Visual embedding similarity
        if visual_embedding and len(visual_embedding) > 0:
            for existing_id, existing_emb in self._embeddings:
                sim = self._cosine_similarity(visual_embedding, existing_emb)
                if sim >= self.threshold:
                    return True, existing_id

        return False, None

    def register(self, source_id: str, content_hash: str, visual_embedding: list[float] = None) -> None:
        self._hashes[content_hash] = source_id
        if visual_embedding and len(visual_embedding) > 0:
            self._embeddings.append((source_id, visual_embedding))

    @staticmethod
    def _cosine_similarity(a: list[float], b: list[float]) -> float:
        if len(a) != len(b) or len(a) == 0:
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = sum(x * x for x in a) ** 0.5
        norm_b = sum(y * y for y in b) ** 0.5
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)


class Scout:
    """Scout Agent — continuously discovers changing design frontiers.

    The crawler should not merely acquire what is trending.
    That creates another homogenization engine.

    It maintains opposing acquisition streams to ensure diversity.
    """

    # Adversarial acquisition streams
    ACQUISITION_STREAMS: dict[SourceCategory, list[str]] = {
        SourceCategory.EMERGING_INTERFACES: [
            "https://www.cssdesignawards.com",
            "https://www.awwwards.com",
            "https://www.siteinspire.com",
        ],
        SourceCategory.AWARD_WINNING: [
            "https://www.webbyawards.com",
            "https://www.red-dot.org",
            "https://ifdesign.de",
        ],
        SourceCategory.EXPERIMENTAL_ART_GAMES: [
            "https://www.shadertoy.com",
            "https://www.openprocessing.org",
            "https://itch.io",
        ],
        SourceCategory.SCIENTIFIC_INSTRUMENTS: [
            "https://www.ncbi.nlm.nih.gov",
            "https://observablehq.com",
        ],
        SourceCategory.AUTOMOTIVE_INTERFACES: [
            "https://www.tesla.com",
            "https://www.rivian.com",
        ],
        SourceCategory.CINEMA_TITLE_SYSTEMS: [
            "https://www.artofthetitle.com",
        ],
        SourceCategory.AEROSPACE_MILITARY_VIZ: [
            "https://www.nasa.gov",
            "https://www.lockheedmartin.com",
        ],
        SourceCategory.MEDICAL_IMAGING: [
            "https://www.3dslicer.org",
            "https://www.ohif.org",
        ],
        SourceCategory.INDUSTRIAL_CONTROL: [
            "https://www.siemens.com",
            "https://www.rockwellautomation.com",
        ],
        SourceCategory.ARCHITECTURE_PRODUCTS: [
            "https://www.dezeen.com",
            "https://www.archdaily.com",
        ],
        SourceCategory.HISTORICAL_INTERFACES: [
            "https://www.waybackmachine.com",
            "https://designishistory.com",
        ],
        SourceCategory.REJECTED_BY_MAINSTREAM: [
            "https://www.lurkmore.com",
            "https://www.crapaholic.com",
        ],
    }

    def __init__(self) -> None:
        self.compliance = ComplianceChecker()
        self.trend_detector = TrendDetector()
        self.dedup = DeduplicationEngine()
        self._last_request_time: dict[str, float] = {}
        self._min_interval: float = 2.0  # seconds between requests to same domain

    def discover_sources(self, categories: list[SourceCategory] = None,
                         max_per_category: int = 5) -> list[SourceEntry]:
        """Discover candidate sources from acquisition streams."""
        if categories is None:
            categories = list(SourceCategory)

        sources: list[SourceEntry] = []
        for category in categories:
            seed_urls = self.ACQUISITION_STREAMS.get(category, [])
            for url in seed_urls[:max_per_category]:
                source = SourceEntry(
                    url=url,
                    category=category,
                    license_state=LicenseState.UNKNOWN,
                    access_policy_checked=False,
                )
                sources.append(source)
        return sources

    @staticmethod
    def _check_robots_txt(url: str) -> bool:
        """Check if the URL is allowed by the site's robots.txt.

        Fetches robots.txt from the root of the domain and parses
        the User-agent: * rules. Returns True if crawling is allowed.
        """
        try:
            parsed = urlparse(url)
            if not parsed.netloc:
                return True  # local content, no robots check needed

            robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"

            from urllib.request import urlopen
            from urllib.error import URLError, HTTPError
            req = urlopen(robots_url, timeout=5)
            robots_content = req.read().decode("utf-8", errors="ignore")

            # Parse robots.txt — look for User-agent: * rules
            path = parsed.path or "/"

            in_our_section = False
            disallowed_paths: list[str] = []
            allowed_paths: list[str] = []

            for line in robots_content.splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue

                if ":" not in line:
                    continue

                field, value = line.split(":", 1)
                field = field.strip().lower()
                value = value.strip()

                if field == "user-agent":
                    in_our_section = (value == "*" or value == "")
                    continue

                if not in_our_section:
                    continue

                if field == "disallow":
                    if value:
                        disallowed_paths.append(value)
                elif field == "allow":
                    if value:
                        allowed_paths.append(value)

            # Check if our path is disallowed
            for disallowed in disallowed_paths:
                if path.startswith(disallowed):
                    # Check if a more specific allow rule overrides
                    for allowed in allowed_paths:
                        if path.startswith(allowed) and len(allowed) >= len(disallowed):
                            return True
                    return False

            return True

        except (URLError, HTTPError, ConnectionError, TimeoutError, OSError):
            # If we can't fetch robots.txt, assume allowed (standard behavior)
            return True
        except Exception:
            return True

    async def capture_source(self, source: SourceEntry, html_content: str = "",
                       meta_tags: dict[str, str] = None,
                       visual_embedding: list[float] = None) -> tuple[SourceEntry, Optional[DesignObservation]]:
        """Capture a source with full compliance checks.

        Returns (updated_source, observation_or_none).
        Observation is None if source is rejected.
        """
        if meta_tags is None:
            meta_tags = {}

        # Rate limit check
        domain = urlparse(source.url).netloc
        last_time = self._last_request_time.get(domain, 0)
        if not self.compliance.check_rate_limit(last_time, self._min_interval):
            source.rate_limit_respected = True  # we're waiting
            return source, None
        self._last_request_time[domain] = time.time()

        # Robots check — actually fetch and parse robots.txt
        source.robots_allowed = self._check_robots_txt(source.url)
        if not source.robots_allowed:
            source.access_policy_checked = True
            return source, None

        # License classification
        source.license_state = self.compliance.classify_license(html_content, meta_tags)
        source.asset_classification = self.compliance.classify_asset(source.license_state)
        source.access_policy_checked = True

        # Personal info removal
        cleaned_content = self.compliance.remove_personal_info(html_content)
        source.personal_info_removed = True

        # Hash and dedup
        content_hash = self.compliance.compute_hash(cleaned_content)
        source.source_hash = content_hash

        is_dup, existing_id = self.dedup.is_duplicate(content_hash, visual_embedding)
        if is_dup:
            source.is_duplicate = True
            return source, None

        # Trend detection
        is_novel = self.trend_detector.is_novel(content_hash)
        velocity = self.trend_detector.register(content_hash, source.category)

        # Register in dedup
        self.dedup.register(source.source_id, content_hash, visual_embedding)

        # Create observation with parsed structural data
        structural = self._parse_html_structure(cleaned_content, meta_tags)
        observation = DesignObservation(
            source_id=source.source_id,
            url=source.url,
            capture_date=_now(),
            visual_embedding=visual_embedding or [],
            trend_velocity=velocity,
            novelty_score=1.0 if is_novel else max(0.1, 1.0 - velocity / 20.0),
            layout_geometry=structural["layout_geometry"],
            typography_ratios=structural["typography_ratios"],
            spacing_rhythm=structural["spacing_rhythm"],
            color_relationships=structural["color_relationships"],
            density_info_hierarchy=structural["density_info_hierarchy"],
            navigation_model=structural["navigation_model"],
            motion_transitions=structural["motion_transitions"],
            page_hierarchy=structural["page_hierarchy"],
            component_topology=structural["component_topology"],
            brand_personality=structural["brand_personality"],
            unusual_design_decisions=structural["unusual_design_decisions"],
            performance_score=structural["performance_score"],
            accessibility_score=structural["accessibility_score"],
        )

        # Attribution
        source.attribution = source.creator or domain

        return source, observation

    @staticmethod
    def _parse_html_structure(html: str, meta_tags: dict[str, str] = None) -> dict[str, Any]:
        """Parse HTML/CSS content to extract real structural design data.

        Extracts layout geometry, typography ratios, color relationships,
        spacing rhythm, motion transitions, navigation model, page hierarchy,
        density info, and unusual design decisions from actual source code.
        """
        import re
        meta_tags = meta_tags or {}
        html_lower = html.lower()

        # --- Layout geometry from CSS ---
        layout_geometry: dict[str, float] = {}
        if "display: grid" in html_lower or "display:grid" in html_lower:
            layout_geometry["layout_type"] = 1.0  # grid
            grid_cols = re.search(r'grid-template-columns:\s*([^;]+)', html_lower)
            if grid_cols:
                cols = grid_cols.group(1).strip().split()
                layout_geometry["column_count"] = float(len(cols))
                if len(cols) >= 2:
                    layout_geometry["aspect_ratio"] = 1.0
        elif "display: flex" in html_lower or "display:flex" in html_lower:
            layout_geometry["layout_type"] = 2.0  # flex
            layout_geometry["aspect_ratio"] = 1.0
        else:
            layout_geometry["layout_type"] = 0.0  # flow

        # --- Typography ratios from CSS ---
        typography_ratios: dict[str, float] = {}
        font_sizes = re.findall(r'font-size:\s*([\d.]+)(px|rem|em)', html_lower)
        if font_sizes:
            sizes = [float(s[0]) for s in font_sizes]
            if sizes:
                max_size = max(sizes)
                min_size = min(sizes)
                typography_ratios["max_ratio"] = max_size / min_size if min_size > 0 else 1.0
                typography_ratios["heading_count"] = float(len(sizes))
                typography_ratios["largest_size"] = max_size
        letter_spacing = re.search(r'letter-spacing:\s*([\d.]+)', html_lower)
        if letter_spacing:
            typography_ratios["letter_spacing"] = float(letter_spacing.group(1))

        # --- Color relationships from CSS ---
        color_relationships: dict[str, Any] = {}
        hex_colors = set(re.findall(r'#([0-9a-fA-F]{3,8})\b', html))
        rgb_colors = re.findall(r'rgba?\([^)]+\)', html_lower)
        all_colors = list(hex_colors) + [f"rgb_{i}" for i in range(len(rgb_colors))]
        color_relationships["palette_size"] = len(all_colors)
        if "background" in html_lower and "color" in html_lower:
            color_relationships["has_background_colors"] = True
        if "gradient" in html_lower:
            color_relationships["has_gradients"] = True
            color_relationships["gradient_count"] = html_lower.count("gradient")
        if "rgba(" in html_lower or "hsla(" in html_lower:
            color_relationships["has_transparency"] = True

        # --- Spacing rhythm from CSS ---
        spacing_rhythm: list[float] = []
        paddings = re.findall(r'padding:\s*([\d.]+)', html_lower)
        margins = re.findall(r'margin:\s*([\d.]+)', html_lower)
        gaps = re.findall(r'gap:\s*([\d.]+)', html_lower)
        spacing_rhythm = [float(p) for p in paddings + margins + gaps]
        # Sort to identify rhythm pattern
        spacing_rhythm.sort()

        # --- Motion transitions from CSS ---
        motion_transitions: list[dict[str, Any]] = []
        transitions = re.findall(r'transition:\s*([^;]+)', html_lower)
        for t in transitions:
            motion_transitions.append({"property": t.strip()[:60]})
        animations = re.findall(r'@keyframes\s+(\w+)', html_lower)
        for a in animations:
            motion_transitions.append({"keyframe": a})
        if "cubic-bezier" in html_lower:
            beziers = re.findall(r'cubic-bezier\([^)]+\)', html_lower)
            for b in beziers:
                motion_transitions.append({"easing": b})

        # --- Navigation model from HTML ---
        navigation_model = ""
        if "<nav" in html_lower:
            if "position: sticky" in html_lower or "position:sticky" in html_lower:
                navigation_model = "sticky"
            elif "position: fixed" in html_lower or "position:fixed" in html_lower:
                navigation_model = "fixed"
            else:
                navigation_model = "static"
        elif "role=\"navigation\"" in html_lower or "role='navigation'" in html_lower:
            navigation_model = "aria_nav"

        # --- Page hierarchy from DOM structure ---
        page_hierarchy: dict[str, Any] = {}
        sections = html_lower.count("<section")
        divs = html_lower.count("<div")
        articles = html_lower.count("<article")
        headers = html_lower.count("<h1") + html_lower.count("<h2") + html_lower.count("<h3")
        page_hierarchy = {
            "sections": sections,
            "divs": divs,
            "articles": articles,
            "headings": headers,
            "depth": sections + articles,
        }

        # --- Component topology ---
        component_topology: dict[str, Any] = {}
        buttons = html_lower.count("<button")
        links = html_lower.count("<a ")
        images = html_lower.count("<img")
        inputs = html_lower.count("<input")
        component_topology = {
            "buttons": buttons,
            "links": links,
            "images": images,
            "inputs": inputs,
            "interactive_elements": buttons + links + inputs,
        }

        # --- Density info hierarchy ---
        density_info_hierarchy: dict[str, Any] = {}
        total_elements = divs + sections + articles + buttons + links + images
        density_info_hierarchy = {
            "total_elements": total_elements,
            "element_density": total_elements / max(len(html) / 1000, 1),
            "has_grid_layout": "grid" in html_lower,
            "has_flex_layout": "flex" in html_lower,
        }

        # --- Unusual design decisions from advanced CSS ---
        unusual_decisions: list[str] = []
        if "backdrop-filter" in html_lower:
            unusual_decisions.append("backdrop-filter blur effect")
        if "clip-path" in html_lower:
            unusual_decisions.append("clip-path for non-rectangular shapes")
        if "gradient" in html_lower and "text" in html_lower:
            unusual_decisions.append("gradient text effect")
        if "mix-blend-mode" in html_lower:
            unusual_decisions.append("mix-blend-mode for compositing")
        if "transform: perspective" in html_lower or "perspective(" in html_lower:
            unusual_decisions.append("3D perspective transforms")
        if "scroll-snap" in html_lower:
            unusual_decisions.append("scroll-snap for controlled scrolling")
        if "aspect-ratio:" in html_lower:
            unusual_decisions.append("aspect-ratio for intrinsic sizing")
        if "object-fit:" in html_lower:
            unusual_decisions.append("object-fit for media control")
        if "will-change" in html_lower:
            unusual_decisions.append("will-change for GPU acceleration")
        if "backdrop-filter: blur" in html_lower and "position: sticky" in html_lower:
            unusual_decisions.append("glassmorphism with sticky nav")

        # --- Brand personality from meta tags ---
        brand_personality = meta_tags.get("description", "")
        if not brand_personality:
            desc_match = re.search(r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']+)', html_lower)
            if desc_match:
                brand_personality = desc_match.group(1)

        # --- Performance score from resource hints ---
        perf_score = 0.5
        if "preload" in html_lower:
            perf_score += 0.1
        if "preconnect" in html_lower or "dns-prefetch" in html_lower:
            perf_score += 0.1
        if "<script" in html_lower and "defer" in html_lower:
            perf_score += 0.1
        if "async" in html_lower and "<script" in html_lower:
            perf_score += 0.05
        if "loading=\"lazy\"" in html_lower or "loading='lazy'" in html_lower:
            perf_score += 0.1
        perf_score = min(1.0, perf_score)

        # --- Accessibility score from actual attributes ---
        a11y_score = 0.5
        if 'aria-label' in html_lower:
            a11y_score += 0.15
        if 'role=' in html_lower:
            a11y_score += 0.1
        if 'alt=' in html_lower:
            a11y_score += 0.1
        if '<html lang=' in html_lower or '<html lang =' in html_lower:
            a11y_score += 0.05
        if 'tabindex' in html_lower:
            a11y_score += 0.05
        if 'aria-hidden' in html_lower:
            a11y_score += 0.05
        a11y_score = min(1.0, a11y_score)

        return {
            "layout_geometry": layout_geometry,
            "typography_ratios": typography_ratios,
            "spacing_rhythm": spacing_rhythm,
            "color_relationships": color_relationships,
            "density_info_hierarchy": density_info_hierarchy,
            "navigation_model": navigation_model,
            "motion_transitions": motion_transitions,
            "page_hierarchy": page_hierarchy,
            "component_topology": component_topology,
            "brand_personality": brand_personality,
            "unusual_design_decisions": unusual_decisions,
            "performance_score": perf_score,
            "accessibility_score": a11y_score,
        }

    def get_oversaturated_patterns(self) -> list[str]:
        """Get patterns that are over-represented and should be retired."""
        return self.trend_detector.get_oversaturated_patterns()

    def summary(self) -> dict[str, Any]:
        return {
            "trend_detector": self.trend_detector.summary(),
            "dedup_hashes": len(self.dedup._hashes),
            "acquisition_streams": len(self.ACQUISITION_STREAMS),
            "min_interval": self._min_interval,
        }
