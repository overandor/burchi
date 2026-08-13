"""Tests for the GapSWAT Underwriting Protocol.

Tests the architectural contracts enforced in gapswat.py:
- GapAssessment: gap_score = impact × frequency × unmetness, is_material threshold
- StrategicAdvantage: advantage_score = mean of nonzero scores
- AttributionAssessment: employee_attribution_strength
- TransformType enum values
- TransformAssessment: to_dict
- GapSWATReport: underwriting_score, passes_gate, to_dict
"""

import sys
import os

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rxreserve.gapswat import (
    GapAssessment,
    StrategicAdvantage,
    AttributionAssessment,
    TransformType,
    TransformAssessment,
    GapSWATReport,
    GapSWATUnderwriter,
)
from rxreserve.models import PharmaFrontier


# ─── GapAssessment: gap_score ───

def test_gap_score_product():
    gap = GapAssessment(impact=0.8, frequency=0.5, unmetness=0.9)
    assert gap.gap_score == pytest.approx(0.36)


def test_gap_score_zero_when_any_factor_zero():
    gap = GapAssessment(impact=0.8, frequency=0.0, unmetness=0.9)
    assert gap.gap_score == 0.0


# ─── GapAssessment: is_material ───

def test_is_material_true_above_threshold():
    gap = GapAssessment(impact=0.8, frequency=0.5, unmetness=0.9)
    # 0.36 >= 0.15
    assert gap.is_material is True


def test_is_material_false_below_threshold():
    gap = GapAssessment(impact=0.2, frequency=0.2, unmetness=0.2)
    # 0.008 < 0.15
    assert gap.is_material is False


def test_is_material_at_exact_threshold():
    gap = GapAssessment(impact=0.5, frequency=0.5, unmetness=0.6)
    # 0.15 exactly
    assert gap.gap_score == pytest.approx(0.15)
    assert gap.is_material is True


def test_gap_assessment_to_dict():
    gap = GapAssessment(impact=0.8, frequency=0.5, unmetness=0.9)
    d = gap.to_dict()
    assert d["impact"] == 0.8
    assert d["frequency"] == 0.5
    assert d["unmetness"] == 0.9
    assert d["gap_score"] == pytest.approx(0.36, abs=0.0001)
    assert d["is_material"] is True


# ─── StrategicAdvantage: advantage_score ───

def test_advantage_score_mean_of_nonzero():
    adv = StrategicAdvantage(
        proprietary_data=0.8,
        domain_expertise=0.6,
        existing_infrastructure=0.0,
        regulatory_position=0.0,
        distribution=0.0,
        relationships=0.0,
        manufacturing_assets=0.0,
    )
    # mean of [0.8, 0.6] = 0.7
    assert adv.advantage_score == pytest.approx(0.7)


def test_advantage_score_all_zero():
    adv = StrategicAdvantage()
    assert adv.advantage_score == 0.0


def test_advantage_score_all_nonzero():
    adv = StrategicAdvantage(
        proprietary_data=0.5,
        domain_expertise=0.5,
        existing_infrastructure=0.5,
        regulatory_position=0.5,
        distribution=0.5,
        relationships=0.5,
        manufacturing_assets=0.5,
    )
    assert adv.advantage_score == pytest.approx(0.5)


def test_strategic_advantage_to_dict():
    adv = StrategicAdvantage(proprietary_data=0.8, domain_expertise=0.6)
    d = adv.to_dict()
    assert d["proprietary_data"] == 0.8
    assert d["domain_expertise"] == 0.6
    assert d["advantage_score"] == pytest.approx(0.7, abs=0.0001)


# ─── AttributionAssessment ───

def test_attribution_strength_full():
    attr = AttributionAssessment(
        employee_observed="emp-001",
        employee_originated="emp-001",
        existed_independently="none",
        would_happen_anyway="no",
    )
    # 0.3 + 0.4 + 0.15 + 0.15 = 1.0
    assert attr.employee_attribution_strength == pytest.approx(1.0)


def test_attribution_strength_partial():
    attr = AttributionAssessment(
        employee_observed="emp-001",
        employee_originated="none",
        existed_independently="yes",
        would_happen_anyway="yes",
    )
    # only observed: 0.3
    assert attr.employee_attribution_strength == pytest.approx(0.3)


def test_attribution_strength_empty():
    attr = AttributionAssessment()
    # no observation, no origination, existed_independently empty → +0.15, would_happen_anyway empty → +0.15
    assert attr.employee_attribution_strength == pytest.approx(0.3)


def test_attribution_to_dict():
    attr = AttributionAssessment(
        employee_observed="emp-001",
        employee_originated="emp-001",
        existed_independently="none",
        would_happen_anyway="no",
    )
    d = attr.to_dict()
    assert d["employee_observed"] == "emp-001"
    assert d["employee_originated"] == "emp-001"
    assert d["employee_attribution_strength"] == pytest.approx(1.0, abs=0.0001)


# ─── TransformType ───

def test_transform_type_values():
    assert TransformType.SITE_TO_ENTERPRISE.value == "site → enterprise"
    assert TransformType.WORKFLOW_TO_PLATFORM.value == "workflow → platform"
    assert TransformType.SINGLE_INDICATION_TO_CAPABILITY.value == "single indication → reusable capability"
    assert TransformType.SINGLE_DATASET_TO_PORTFOLIO.value == "single dataset → portfolio asset"
    assert TransformType.WORKAROUND_TO_STANDARD.value == "workaround → organizational standard"
    assert TransformType.NONE.value == "none"


# ─── TransformAssessment ───

def test_transform_assessment_to_dict():
    t = TransformAssessment(
        transform_type=TransformType.WORKFLOW_TO_PLATFORM,
        magnification_factor=3.5,
        description="Turned manual workflow into platform",
    )
    d = t.to_dict()
    assert d["transform_type"] == "workflow → platform"
    assert d["magnification_factor"] == 3.5
    assert d["description"] == "Turned manual workflow into platform"


def test_transform_assessment_defaults():
    t = TransformAssessment()
    assert t.transform_type == TransformType.NONE
    assert t.magnification_factor == 1.0
    assert t.description == ""


# ─── GapSWATReport ───

def test_report_underwriting_score_zero_when_gap_not_material():
    report = GapSWATReport(
        gap=GapAssessment(impact=0.1, frequency=0.1, unmetness=0.1),  # 0.001 < 0.15
        strategic_advantage=StrategicAdvantage(proprietary_data=0.9),
        attribution=AttributionAssessment(
            employee_observed="e1", employee_originated="e1",
            existed_independently="none", would_happen_anyway="no",
        ),
        transform=TransformAssessment(magnification_factor=5.0),
    )
    assert report.underwriting_score == 0.0
    assert report.passes_gate is False


def test_report_underwriting_score_nonzero_when_material():
    report = GapSWATReport(
        gap=GapAssessment(impact=0.8, frequency=0.8, unmetness=0.8),  # 0.512
        strategic_advantage=StrategicAdvantage(proprietary_data=0.9, domain_expertise=0.9),
        attribution=AttributionAssessment(
            employee_observed="e1", employee_originated="e1",
            existed_independently="none", would_happen_anyway="no",
        ),
        transform=TransformAssessment(magnification_factor=5.0),
    )
    # gap is material, so score is nonzero
    assert report.underwriting_score > 0.0
    assert report.passes_gate is True


def test_report_passes_gate_requires_both():
    # material gap but low advantage
    report = GapSWATReport(
        gap=GapAssessment(impact=0.8, frequency=0.8, unmetness=0.8),
        strategic_advantage=StrategicAdvantage(proprietary_data=0.1),  # mean 0.1 < 0.2
    )
    assert report.passes_gate is False


def test_report_to_dict():
    report = GapSWATReport(
        gap=GapAssessment(impact=0.8, frequency=0.5, unmetness=0.9),
        strategic_advantage=StrategicAdvantage(proprietary_data=0.8, domain_expertise=0.6),
        attribution=AttributionAssessment(employee_observed="e1", employee_originated="e1"),
        transform=TransformAssessment(transform_type=TransformType.WORKFLOW_TO_PLATFORM, magnification_factor=3.0),
        war_game=[{"prosecutor": "A", "verdict": "survives"}],
    )
    d = report.to_dict()
    assert "gap" in d
    assert "strategic_advantage" in d
    assert "war_game" in d
    assert "attribution" in d
    assert "transform" in d
    assert d["war_game"] == [{"prosecutor": "A", "verdict": "survives"}]
    assert d["transform"]["transform_type"] == "workflow → platform"
    assert "underwriting_score" in d
    assert "passes_gate" in d


# ─── GapSWATUnderwriter ───

def test_underwriter_creates_report_from_frontier():
    underwriter = GapSWATUnderwriter()
    frontier = PharmaFrontier(problem="Renal dosing gap")
    report = underwriter.underwrite(
        frontier,
        gap=GapAssessment(impact=0.8, frequency=0.8, unmetness=0.8),
        advantage=StrategicAdvantage(proprietary_data=0.9, domain_expertise=0.9),
        attribution=AttributionAssessment(employee_observed="e1", employee_originated="e1"),
        transform=TransformAssessment(magnification_factor=4.0),
        war_game_results=[{"prosecutor": "X", "verdict": "survives"}],
    )
    assert isinstance(report, GapSWATReport)
    assert report.gap.is_material is True
    assert report.passes_gate is True
    assert report.war_game == [{"prosecutor": "X", "verdict": "survives"}]


def test_underwriter_defaults_when_no_assessments():
    underwriter = GapSWATUnderwriter()
    frontier = PharmaFrontier()
    report = underwriter.underwrite(frontier)
    assert report.gap.gap_score == 0.0
    assert report.passes_gate is False
    assert report.war_game == []
