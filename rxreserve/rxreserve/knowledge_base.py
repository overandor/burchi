"""KnowledgeBase — persistent storage for observations, replications, and skills.

The KnowledgeBase stores everything the system learns across runs:
- Beauty observations (what it saw)
- Replication results (what it produced)
- Compiled skills (what it learned)

It uses a simple JSON-based persistent store so data survives
across runs and grows with every execution.

The database is the system's memory. Without it, each run starts
from scratch. With it, the system accumulates knowledge and
the compiled skills get richer over time.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from rxreserve.beauty_observer import BeautyObservation
from rxreserve.replication_engine import ReplicationResult
from rxreserve.skill_compiler import CompiledSkill


class KnowledgeBase:
    """Persistent knowledge base for the beauty discovery system.

    Stores observations, replications, and compiled skills
    in a JSON file that grows with every run.
    """

    def __init__(self, db_path: str = "beauty_knowledge.json") -> None:
        self.db_path = db_path
        self._data: dict[str, Any] = {
            "observations": [],
            "replications": [],
            "skills": [],
            "metadata": {
                "created": time.time(),
                "last_updated": time.time(),
                "total_runs": 0,
            },
        }
        self._load()

    def _load(self) -> None:
        """Load from disk if exists."""
        if os.path.exists(self.db_path):
            try:
                with open(self.db_path, "r") as f:
                    self._data = json.load(f)
            except Exception:
                pass  # Start fresh if corrupted

    def _save(self) -> None:
        """Save to disk."""
        self._data["metadata"]["last_updated"] = time.time()
        try:
            with open(self.db_path, "w") as f:
                json.dump(self._data, f, indent=2, default=str)
        except Exception:
            pass

    def add_observation(self, obs: BeautyObservation) -> None:
        """Store a beauty observation."""
        entry = {
            "url": obs.url,
            "beauty_score": obs.beauty_score,
            "composition_score": obs.composition_score,
            "typography_score": obs.typography_score,
            "color_score": obs.color_score,
            "motion_score": obs.motion_score,
            "depth_score": obs.depth_score,
            "rhythm_score": obs.rhythm_score,
            "originality_score": obs.originality_score,
            "performance_score": obs.performance_score,
            "accessibility_score": obs.accessibility_score,
            "composition_pattern": obs.composition_pattern,
            "typography_decisions": obs.typography_decisions,
            "color_relationship": obs.color_relationship,
            "motion_character": obs.motion_character,
            "depth_treatment": obs.depth_treatment,
            "spatial_rhythm": obs.spatial_rhythm,
            "unusual_decisions": obs.unusual_decisions,
            "dom_element_count": obs.dom_element_count,
            "font_families": obs.font_families,
            "color_palette": obs.color_palette,
            "layout_type": obs.layout_type,
            "has_grid": obs.has_grid,
            "has_flexbox": obs.has_flexbox,
            "has_animations": obs.has_animations,
            "has_gradient_text": obs.has_gradient_text,
            "has_glassmorphism": obs.has_glassmorphism,
            "has_sticky_nav": obs.has_sticky_nav,
            "fcp_ms": obs.fcp_ms,
            "lcp_ms": obs.lcp_ms,
            "cls": obs.cls,
            "timestamp": time.time(),
        }
        self._data["observations"].append(entry)
        self._save()

    def add_replication(self, result: ReplicationResult) -> None:
        """Store a replication result."""
        entry = {
            "source_url": result.source_url,
            "original_beauty_score": result.original_beauty_score,
            "replicated_quality": result.replicated_quality,
            "improvement_over_original": result.improvement_over_original,
            "generations": result.generations,
            "techniques_used": result.techniques_used,
            "mutations_applied": result.mutations_applied,
            "success": result.success,
            "failure_reasons": result.failure_reasons[:5],  # Keep first 5
            "source_code_length": len(result.source_code),
            "timestamp": time.time(),
        }
        self._data["replications"].append(entry)
        self._save()

    def add_skill(self, skill: CompiledSkill) -> None:
        """Store a compiled skill."""
        entry = {
            "skill_id": skill.skill_id,
            "version": skill.version,
            "title": skill.title,
            "observations_count": skill.observations_count,
            "replications_count": skill.replications_count,
            "avg_beauty_score": skill.avg_beauty_score,
            "avg_replication_quality": skill.avg_replication_quality,
            "techniques": skill.techniques,
            "anti_patterns": skill.anti_patterns,
            "markdown_length": len(skill.markdown),
            "timestamp": time.time(),
        }
        self._data["skills"].append(entry)
        self._save()

    def increment_run(self) -> None:
        self._data["metadata"]["total_runs"] += 1
        self._save()

    def get_observations(self) -> list[dict]:
        return self._data.get("observations", [])

    def get_replications(self) -> list[dict]:
        return self._data.get("replications", [])

    def get_skills(self) -> list[dict]:
        return self._data.get("skills", [])

    def get_visited_urls(self) -> set[str]:
        return {o["url"] for o in self.get_observations()}

    def summary(self) -> dict:
        return {
            "total_observations": len(self.get_observations()),
            "total_replications": len(self.get_replications()),
            "total_skills": len(self.get_skills()),
            "total_runs": self._data["metadata"].get("total_runs", 0),
            "avg_beauty_score": (
                sum(o["beauty_score"] for o in self.get_observations()) /
                max(len(self.get_observations()), 1)
            ),
            "avg_replication_quality": (
                sum(r["replicated_quality"] for r in self.get_replications()) /
                max(len(self.get_replications()), 1)
            ),
        }
