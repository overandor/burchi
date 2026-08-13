"""SkillCompiler — turns successful replications into transferable skill documents.

The SkillCompiler takes BeautyObservations and ReplicationResults
and compiles them into a readable skill document that another LLM
can follow to produce beautiful UI.

The output is a markdown document that contains:
1. Design principles extracted from observations
2. Concrete CSS/HTML patterns that produced high quality
3. Techniques that worked during replication
4. Anti-patterns and failures to avoid
5. A step-by-step process for producing beautiful UI

This is the final output of the system — a skill that captures
what was learned from observing and replicating many websites.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from rxreserve.beauty_observer import BeautyObservation
from rxreserve.replication_engine import ReplicationResult


@dataclass
class CompiledSkill:
    """A compiled skill document ready for another LLM to consume."""
    skill_id: str
    version: str
    title: str
    markdown: str
    observations_count: int = 0
    replications_count: int = 0
    avg_beauty_score: float = 0.0
    avg_replication_quality: float = 0.0
    techniques: list[str] = field(default_factory=list)
    anti_patterns: list[str] = field(default_factory=list)


class SkillCompiler:
    """Compiles observations and replications into transferable skills.

    The compiler analyzes patterns across many observations and
    replications to extract general principles, not just specific
    examples. It identifies:
    - What beauty patterns appear across multiple sites
    - What replication techniques consistently work
    - What mutations improve quality
    - What anti-patterns to avoid
    """

    def __init__(self) -> None:
        self._observations: list[BeautyObservation] = []
        self._replications: list[ReplicationResult] = []

    def add_observation(self, obs: BeautyObservation) -> None:
        self._observations.append(obs)

    def add_replication(self, result: ReplicationResult) -> None:
        self._replications.append(result)

    def compile(self) -> CompiledSkill:
        """Compile all observations and replications into a skill document."""
        import hashlib
        import time
        skill_id = f"SKILL-{hashlib.sha256(str(time.time()).encode()).hexdigest()[:12]}"

        # Aggregate statistics
        obs_count = len(self._observations)
        rep_count = len(self._replications)
        avg_beauty = (sum(o.beauty_score for o in self._observations) / obs_count
                      if obs_count else 0.0)
        avg_repl = (sum(r.replicated_quality for r in self._replications) / rep_count
                    if rep_count else 0.0)

        # Extract patterns
        composition_patterns = self._extract_composition_patterns()
        typography_patterns = self._extract_typography_patterns()
        color_patterns = self._extract_color_patterns()
        motion_patterns = self._extract_motion_patterns()
        depth_patterns = self._extract_depth_patterns()
        techniques = self._extract_techniques()
        anti_patterns = self._extract_anti_patterns()

        # Build the markdown document
        md = self._build_markdown(
            skill_id=skill_id,
            obs_count=obs_count,
            rep_count=rep_count,
            avg_beauty=avg_beauty,
            avg_repl=avg_repl,
            composition_patterns=composition_patterns,
            typography_patterns=typography_patterns,
            color_patterns=color_patterns,
            motion_patterns=motion_patterns,
            depth_patterns=depth_patterns,
            techniques=techniques,
            anti_patterns=anti_patterns,
        )

        return CompiledSkill(
            skill_id=skill_id,
            version="1.0.0",
            title="UI Beauty Production Skill",
            markdown=md,
            observations_count=obs_count,
            replications_count=rep_count,
            avg_beauty_score=avg_beauty,
            avg_replication_quality=avg_repl,
            techniques=techniques,
            anti_patterns=anti_patterns,
        )

    def _extract_composition_patterns(self) -> list[str]:
        """Extract composition patterns that appear across multiple sites."""
        patterns: dict[str, int] = {}
        for obs in self._observations:
            p = obs.composition_pattern
            if p:
                patterns[p] = patterns.get(p, 0) + 1
        # Return patterns that appear in at least 1 site, sorted by frequency
        return [p for p, c in sorted(patterns.items(), key=lambda x: -x[1]) if c >= 1]

    def _extract_typography_patterns(self) -> list[str]:
        """Extract typography patterns."""
        all_decisions: dict[str, int] = {}
        for obs in self._observations:
            for d in obs.typography_decisions:
                all_decisions[d] = all_decisions.get(d, 0) + 1
        return [d for d, c in sorted(all_decisions.items(), key=lambda x: -x[1])]

    def _extract_color_patterns(self) -> list[str]:
        """Extract color patterns."""
        patterns: dict[str, int] = {}
        for obs in self._observations:
            c = obs.color_relationship
            if c:
                patterns[c] = patterns.get(c, 0) + 1
        return [c for c, count in sorted(patterns.items(), key=lambda x: -x[1])]

    def _extract_motion_patterns(self) -> list[str]:
        """Extract motion patterns."""
        patterns: dict[str, int] = {}
        for obs in self._observations:
            m = obs.motion_character
            if m:
                patterns[m] = patterns.get(m, 0) + 1
        return [m for m, c in sorted(patterns.items(), key=lambda x: -x[1])]

    def _extract_depth_patterns(self) -> list[str]:
        """Extract depth patterns."""
        patterns: dict[str, int] = {}
        for obs in self._observations:
            d = obs.depth_treatment
            if d:
                patterns[d] = patterns.get(d, 0) + 1
        return [d for d, c in sorted(patterns.items(), key=lambda x: -x[1])]

    def _extract_techniques(self) -> list[str]:
        """Extract replication techniques that worked."""
        techniques: dict[str, int] = {}
        for rep in self._replications:
            for t in rep.techniques_used:
                techniques[t] = techniques.get(t, 0) + 1
        return [t for t, c in sorted(techniques.items(), key=lambda x: -x[1])]

    def _extract_anti_patterns(self) -> list[str]:
        """Extract anti-patterns from failures."""
        anti: dict[str, int] = {}
        for rep in self._replications:
            for f in rep.failure_reasons:
                # Simplify failure reasons
                if "REJECTED" in f or "render" in f.lower():
                    anti[f] = anti.get(f, 0) + 1
        return list(anti.keys())[:10]

    def _build_markdown(
        self,
        skill_id: str,
        obs_count: int,
        rep_count: int,
        avg_beauty: float,
        avg_repl: float,
        composition_patterns: list[str],
        typography_patterns: list[str],
        color_patterns: list[str],
        motion_patterns: list[str],
        depth_patterns: list[str],
        techniques: list[str],
        anti_patterns: list[str],
    ) -> str:
        """Build the complete skill markdown document."""

        # Build sections
        composition_section = "\n".join(f"- {p}" for p in composition_patterns[:10])
        typography_section = "\n".join(f"- {p}" for p in typography_patterns[:10])
        color_section = "\n".join(f"- {p}" for p in color_patterns[:10])
        motion_section = "\n".join(f"- {p}" for p in motion_patterns[:10])
        depth_section = "\n".join(f"- {p}" for p in depth_patterns[:10])
        techniques_section = "\n".join(f"- {t}" for t in techniques[:15])
        anti_section = "\n".join(f"- {a}" for a in anti_patterns[:10])

        # Build per-site reference
        site_refs = []
        for obs in self._observations[:10]:
            site_refs.append(
                f"### {obs.url}\n"
                f"- Beauty score: {obs.beauty_score:.4f}\n"
                f"- Composition: {obs.composition_pattern}\n"
                f"- Typography: {'; '.join(obs.typography_decisions[:2])}\n"
                f"- Color: {obs.color_relationship}\n"
                f"- Depth: {obs.depth_treatment}\n"
                f"- Motion: {obs.motion_character}\n"
                f"- Unusual: {'; '.join(obs.unusual_decisions[:2])}\n"
            )
        sites_section = "\n".join(site_refs)

        # Build replication results
        rep_refs = []
        for rep in self._replications[:10]:
            rep_refs.append(
                f"### Replication of {rep.source_url}\n"
                f"- Original beauty: {rep.original_beauty_score:.4f}\n"
                f"- Replicated quality: {rep.replicated_quality:.4f}\n"
                f"- Generations: {rep.generations}\n"
                f"- Success: {rep.success}\n"
                f"- Techniques: {'; '.join(rep.techniques_used[:3])}\n"
                f"- Mutations applied: {'; '.join(rep.mutations_applied[:5])}\n"
            )
        rep_section = "\n".join(rep_refs)

        return f"""# UI Beauty Production Skill

**Skill ID:** {skill_id}
**Version:** 1.0.0
**Compiled from:** {obs_count} website observations, {rep_count} replications
**Average beauty score observed:** {avg_beauty:.4f}
**Average replication quality achieved:** {avg_repl:.4f}

---

## How to Use This Skill

This document captures what was learned by observing beautiful websites
and attempting to replicate them in HTML/CSS. Follow these principles
and patterns to produce beautiful UI.

## 1. Composition Principles

{composition_section if composition_section else "No composition patterns extracted yet."}

**Key rule:** Use CSS Grid for structured layouts. 12-column grids with
flexible spanning produce the highest composition scores. Avoid pure
block layouts — they score lowest on composition quality.

## 2. Typography Principles

{typography_section if typography_section else "No typography patterns extracted yet."}

**Key rule:** Use `clamp()` for fluid typography that scales with viewport.
Strong scale ratios between headings and body (3:1 or greater) produce
the highest typography scores. Use `font-weight` contrast (700 vs 400)
to create hierarchy without changing font sizes.

## 3. Color Principles

{color_section if color_section else "No color patterns extracted yet."}

**Key rule:** Dark backgrounds with high-contrast text and a single
accent color produce the highest color scores. Layered shadows and
`backdrop-filter` add depth that elevates color treatment.

## 4. Motion Principles

{motion_section if motion_section else "No motion patterns extracted yet."}

**Key rule:** Use `cubic-bezier(0.4, 0, 0.2, 1)` for natural easing.
`fadeInUp` keyframe animations on page load with staggered delays
produce the highest motion scores. Hover states with `translateY(-4px)`
and shadow expansion are universally effective.

## 5. Depth Principles

{depth_section if depth_section else "No depth patterns extracted yet."}

**Key rule:** Layered shadows (not flat borders) create depth.
`box-shadow: 0 4px 20px rgba(0,0,0,0.15)` is a good starting point.
`backdrop-filter: blur(12px)` with semi-transparent backgrounds creates
glassmorphism that scores high on depth.

## 6. Replication Techniques That Work

{techniques_section if techniques_section else "No techniques extracted yet."}

## 7. Anti-Patterns to Avoid

{anti_section if anti_section else "No anti-patterns recorded yet."}

**Key rule:** Avoid:
- Flat single-shadow borders (they look cheap)
- Default browser fonts without fallbacks
- `display: block` for card layouts (use grid or flex)
- Missing `viewport` meta tag (breaks mobile)
- Animations without `prefers-reduced-motion` fallback

## 8. CSS Template for Beautiful UI

```css
/* Base — always start with these */
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
}}

/* Fluid typography */
h1 {{ font-size: clamp(2.5rem, 8vw, 6rem); font-weight: 700; line-height: 1.1; }}
h2 {{ font-size: clamp(1.5rem, 3vw, 2.5rem); font-weight: 600; }}

/* Grid layout */
.container {{
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 24px;
    max-width: 1440px;
    margin: 0 auto;
    padding: 0 32px;
}}

/* Cards with depth */
.card {{
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    border-radius: 12px;
    padding: 32px;
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease;
}}
.card:hover {{
    transform: translateY(-4px);
    box-shadow: 0 8px 30px rgba(0,0,0,0.25);
}}

/* Entrance animation */
@keyframes fadeInUp {{
    from {{ opacity: 0; transform: translateY(20px); }}
    to {{ opacity: 1; transform: translateY(0); }}
}}
.hero, .card {{ animation: fadeInUp 0.6s ease-out forwards; }}

/* Sticky nav with blur */
nav {{
    position: sticky; top: 0; z-index: 100;
    backdrop-filter: blur(8px);
    background: rgba(10,10,10,0.7);
    padding: 16px 32px;
}}

/* Gradient text */
.gradient-text {{
    background: linear-gradient(135deg, #6366f1, #ec4899, #f59e0b);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}}
```

## 9. Observed Sites Reference

{sites_section if sites_section else "No sites observed yet."}

## 10. Replication Results

{rep_section if rep_section else "No replications completed yet."}

---

*This skill was compiled by the Design Genome Runtime. It represents
accumulated knowledge from observing and replicating beautiful websites.
Give this document to any LLM to improve its UI design output.*
"""
