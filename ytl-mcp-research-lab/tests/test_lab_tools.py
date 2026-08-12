"""Tests for YTL-MCP lab tools."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from ytl_lab.config import Settings
from ytl_lab.tools import LabTools


@pytest.fixture
def lab(tmp_path: Path):
    settings = Settings(
        data_dir=tmp_path,
        db_path=tmp_path / "ytl_lab.db",
        receipt_ledger_path=tmp_path / "receipts" / "ledger.jsonl",
        log_level="INFO",
    )
    return LabTools(settings)


def test_ingest_video(lab: LabTools):
    result = lab.ingest_video("HF-0003", "Create a YouTube transcript scoring experiment", "https://youtu.be/dQw4w9WgXcQ")
    assert "experiment_id" in result
    assert result["task_id"] == "HF-0003"
    assert result["receipt"]["step"] == "ingest_video"
    exp = lab.db.get_experiment(result["experiment_id"])
    assert exp is not None
    assert exp["intent"].startswith("Create a YouTube")


def test_score_transcript(lab: LabTools):
    result = lab.ingest_video("HF-0003", "Test experiment", "https://youtu.be/dQw4w9WgXcQ")
    exp_id = result["experiment_id"]
    score_result = lab.score_transcript(exp_id)
    assert 0 <= score_result["score"] <= 1
    assert score_result["receipt"]["step"] == "score_transcript"
    exp = lab.db.get_experiment(exp_id)
    assert exp["transcript_score"] == score_result["score"]


def test_policy_check_approves_clean_experiment(lab: LabTools):
    result = lab.ingest_video("HF-0003", "Clean research experiment", "https://youtu.be/dQw4w9WgXcQ")
    exp_id = result["experiment_id"]
    lab.score_transcript(exp_id)
    lab.generate_script(exp_id)
    lab.generate_metadata(exp_id)
    lab.generate_shotlist(exp_id)
    policy = lab.policy_check(exp_id)
    assert policy["policy_status"] == "approved"


def test_policy_check_rejects_suspicious_intent(lab: LabTools):
    result = lab.ingest_video("HF-0003", "spam fake engagement", "https://youtu.be/dQw4w9WgXcQ")
    exp_id = result["experiment_id"]
    lab.score_transcript(exp_id)
    policy = lab.policy_check(exp_id)
    assert policy["policy_status"] == "rejected"
    assert "suspicious_intent" in policy["violations"]


def test_prepare_upload_package_requires_approval(lab: LabTools):
    result = lab.ingest_video("HF-0003", "Test", "https://youtu.be/dQw4w9WgXcQ")
    exp_id = result["experiment_id"]
    with pytest.raises(ValueError, match="not approved"):
        lab.prepare_upload_package(exp_id)


def test_prepare_upload_package_success(lab: LabTools):
    result = lab.ingest_video("HF-0003", "Clean research", "https://youtu.be/dQw4w9WgXcQ")
    exp_id = result["experiment_id"]
    lab.score_transcript(exp_id)
    lab.generate_script(exp_id)
    lab.generate_metadata(exp_id)
    lab.generate_shotlist(exp_id)
    lab.policy_check(exp_id)
    package = lab.prepare_upload_package(exp_id)
    assert package["package"]["privacy_status"] == "private"
    assert "metadata" in package["package"]
    assert "script" in package["package"]


def test_status(lab: LabTools):
    status = lab.status()
    assert "summary" in status
    assert "db_path" in status
    assert "receipt_ledger_path" in status
