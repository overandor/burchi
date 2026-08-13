"""Tests for KnowledgeBase and SkillCompiler.

KnowledgeBase: persistent JSON storage for observations, replications, skills.
SkillCompiler: compiles observations + replications into transferable skill docs.
"""

import json
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rxreserve.knowledge_base import KnowledgeBase
from rxreserve.beauty_observer import BeautyObservation
from rxreserve.replication_engine import ReplicationResult
from rxreserve.skill_compiler import CompiledSkill, SkillCompiler


# ═══════════════════════════════════════════════════════════════
# KnowledgeBase tests
# ═══════════════════════════════════════════════════════════════

class TestKnowledgeBase:
    def test_init_creates_empty_db(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_kb.json")
            kb = KnowledgeBase(db_path=db_path)
            assert kb.get_observations() == []
            assert kb.get_replications() == []
            assert kb.get_skills() == []

    def test_add_observation(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_kb.json")
            kb = KnowledgeBase(db_path=db_path)
            obs = BeautyObservation(
                url="https://example.com",
                beauty_score=0.85,
                composition_score=0.8,
                composition_pattern="grid",
            )
            kb.add_observation(obs)
            observations = kb.get_observations()
            assert len(observations) == 1
            assert observations[0]["url"] == "https://example.com"
            assert observations[0]["beauty_score"] == 0.85

    def test_add_replication(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_kb.json")
            kb = KnowledgeBase(db_path=db_path)
            result = ReplicationResult(
                source_url="https://example.com",
                original_beauty_score=0.8,
                replicated_quality=0.7,
                success=True,
                source_code="<html></html>",
            )
            kb.add_replication(result)
            replications = kb.get_replications()
            assert len(replications) == 1
            assert replications[0]["source_url"] == "https://example.com"
            assert replications[0]["success"] is True

    def test_add_skill(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_kb.json")
            kb = KnowledgeBase(db_path=db_path)
            skill = CompiledSkill(
                skill_id="SKILL-1",
                version="1.0",
                title="Glassmorphism Grid",
                markdown="# Glassmorphism Grid\n\nA beautiful pattern.",
            )
            kb.add_skill(skill)
            skills = kb.get_skills()
            assert len(skills) == 1
            assert skills[0]["skill_id"] == "SKILL-1"

    def test_persistence_across_runs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_kb.json")
            kb1 = KnowledgeBase(db_path=db_path)
            obs = BeautyObservation(url="https://example.com", beauty_score=0.9)
            kb1.add_observation(obs)

            # Create a new instance pointing to the same file
            kb2 = KnowledgeBase(db_path=db_path)
            assert len(kb2.get_observations()) == 1
            assert kb2.get_observations()[0]["url"] == "https://example.com"

    def test_increment_run(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_kb.json")
            kb = KnowledgeBase(db_path=db_path)
            assert kb.summary()["total_runs"] == 0
            kb.increment_run()
            assert kb.summary()["total_runs"] == 1
            kb.increment_run()
            assert kb.summary()["total_runs"] == 2

    def test_get_visited_urls(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_kb.json")
            kb = KnowledgeBase(db_path=db_path)
            kb.add_observation(BeautyObservation(url="https://a.com"))
            kb.add_observation(BeautyObservation(url="https://b.com"))
            kb.add_observation(BeautyObservation(url="https://a.com"))
            urls = kb.get_visited_urls()
            assert urls == {"https://a.com", "https://b.com"}

    def test_summary(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_kb.json")
            kb = KnowledgeBase(db_path=db_path)
            kb.add_observation(BeautyObservation(url="https://a.com", beauty_score=0.8))
            kb.add_observation(BeautyObservation(url="https://b.com", beauty_score=0.6))
            kb.add_replication(ReplicationResult(
                source_url="https://a.com",
                original_beauty_score=0.8,
                replicated_quality=0.7,
            ))
            summary = kb.summary()
            assert summary["total_observations"] == 2
            assert summary["total_replications"] == 1
            assert summary["avg_beauty_score"] == 0.7  # (0.8 + 0.6) / 2
            assert summary["avg_replication_quality"] == 0.7

    def test_summary_empty(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_kb.json")
            kb = KnowledgeBase(db_path=db_path)
            summary = kb.summary()
            assert summary["total_observations"] == 0
            assert summary["avg_beauty_score"] == 0.0  # no division by zero

    def test_corrupted_db_starts_fresh(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_kb.json")
            with open(db_path, "w") as f:
                f.write("not valid json{{{")
            kb = KnowledgeBase(db_path=db_path)
            assert kb.get_observations() == []  # starts fresh


# ═══════════════════════════════════════════════════════════════
# SkillCompiler tests
# ═══════════════════════════════════════════════════════════════

class TestCompiledSkill:
    def test_defaults(self):
        skill = CompiledSkill(
            skill_id="SKILL-1", version="1.0",
            title="Test", markdown="# Test",
        )
        assert skill.skill_id == "SKILL-1"
        assert skill.title == "Test"
        assert skill.markdown == "# Test"
        assert skill.techniques == []
        assert skill.anti_patterns == []


class TestSkillCompiler:
    def test_init(self):
        compiler = SkillCompiler()
        assert compiler is not None

    def test_compile_from_empty_data(self):
        compiler = SkillCompiler()
        skill = compiler.compile()
        assert skill is not None
        assert skill.skill_id != ""

    def test_compile_from_observations(self):
        compiler = SkillCompiler()
        obs = BeautyObservation(
            url="https://example.com",
            beauty_score=0.85,
            composition_pattern="asymmetric grid",
            typography_decisions=["variable font weight", "large heading scale"],
            color_relationship="complementary with gradient accent",
            unusual_decisions=["scroll-driven animation", "clip-path on hero"],
        )
        compiler.add_observation(obs)
        skill = compiler.compile()
        assert skill.title != ""
        assert len(skill.markdown) > 50

    def test_compile_from_replications(self):
        compiler = SkillCompiler()
        result = ReplicationResult(
            source_url="https://example.com",
            original_beauty_score=0.8,
            replicated_quality=0.75,
            success=True,
            techniques_used=["grid layout", "backdrop-filter blur"],
            mutations_applied=["composition", "lighting"],
        )
        compiler.add_replication(result)
        skill = compiler.compile()
        assert len(skill.markdown) > 20

    def test_compile_includes_techniques(self):
        compiler = SkillCompiler()
        obs = BeautyObservation(
            url="https://example.com",
            beauty_score=0.9,
            composition_pattern="grid",
        )
        result = ReplicationResult(
            source_url="https://example.com",
            original_beauty_score=0.9,
            replicated_quality=0.85,
            success=True,
            techniques_used=["CSS grid", "backdrop-filter", "spring animations"],
        )
        compiler.add_observation(obs)
        compiler.add_replication(result)
        skill = compiler.compile()
        for technique in ["CSS grid", "backdrop-filter"]:
            assert technique.lower() in skill.markdown.lower()

    def test_compile_generates_unique_ids(self):
        compiler = SkillCompiler()
        obs = BeautyObservation(url="https://example.com", beauty_score=0.8)
        compiler.add_observation(obs)
        skill1 = compiler.compile()
        compiler2 = SkillCompiler()
        compiler2.add_observation(obs)
        skill2 = compiler2.compile()
        assert skill1.skill_id != skill2.skill_id
