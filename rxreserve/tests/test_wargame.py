import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rxreserve.models import (
    PharmaFrontier,
    EvidenceEnvelope,
    ContributionEnvelope,
    RightsEnvelope,
    PriorArtState,
    RightsOwner,
)
from rxreserve.wargame import (
    ProsecutionResult,
    BaseProsecutor,
    ScientificProsecutor,
    RegulatoryProsecutor,
    PatientSafetyProsecutor,
    IPProsecutor,
    FinanceProsecutor,
    AdoptionProsecutor,
    DataProsecutor,
    AISubstitutionProsecutor,
    WarGame,
)


# ─── ProsecutionResult ───

def test_prosecution_result_to_dict():
    r = ProsecutionResult(
        prosecutor="Test",
        verdict="conditional",
        severity=0.45678,
        reasoning="because",
        conditions=["c1", "c2"],
    )
    d = r.to_dict()
    assert d["prosecutor"] == "Test"
    assert d["verdict"] == "conditional"
    assert d["severity"] == 0.4568  # rounded to 4
    assert d["conditions"] == ["c1", "c2"]


# ─── BaseProsecutor ───

def test_base_prosecutor_not_implemented():
    bp = BaseProsecutor()
    try:
        bp.prosecute(PharmaFrontier())
        assert False, "should have raised NotImplementedError"
    except NotImplementedError:
        pass


# ─── ScientificProsecutor ───

def test_scientific_prosecutor_fail_no_evidence():
    f = PharmaFrontier()  # no source_evidence, no unknowns, no human_verification
    r = ScientificProsecutor().prosecute(f)
    assert r.prosecutor == "Scientific Prosecutor"
    assert r.verdict == "fail"
    assert r.severity >= 0.7


def test_scientific_prosecutor_pass_full():
    f = PharmaFrontier(
        source_evidence=[{"s": 1}, {"s": 2}],
        unknowns=["u1"],
    )
    f.evidence_envelope.human_verification = True
    r = ScientificProsecutor().prosecute(f)
    assert r.verdict == "pass"
    assert r.severity == 0.0


def test_scientific_prosecutor_conditional_single_source():
    f = PharmaFrontier(
        source_evidence=[{"s": 1}],
        unknowns=["u1"],
    )
    f.evidence_envelope.human_verification = True
    r = ScientificProsecutor().prosecute(f)
    assert r.verdict == "conditional"
    assert r.severity == 0.3


# ─── RegulatoryProsecutor ───

def test_regulatory_prosecutor_fail_no_domain():
    f = PharmaFrontier()  # no regulatory_domain
    r = RegulatoryProsecutor().prosecute(f)
    assert r.verdict == "fail"
    assert r.severity == 0.6


def test_regulatory_prosecutor_pass_gcp():
    f = PharmaFrontier(regulatory_domain="GCP")
    r = RegulatoryProsecutor().prosecute(f)
    assert r.verdict == "pass"
    assert any("GCP" in c for c in r.conditions)


def test_regulatory_prosecutor_disclosure_risk():
    f = PharmaFrontier(regulatory_domain="GCP")
    f.rights_envelope.external_disclosure_allowed = True
    f.rights_envelope.patent_review_required = False
    r = RegulatoryProsecutor().prosecute(f)
    assert r.severity == 0.5
    assert r.verdict == "conditional"


# ─── PatientSafetyProsecutor ───

def test_patient_safety_no_consequence():
    f = PharmaFrontier()
    r = PatientSafetyProsecutor().prosecute(f)
    # no quality_patient_consequence (0.4) + no current_workaround (max 0.4) -> 0.4
    assert r.severity == 0.4
    assert r.verdict == "conditional"


def test_patient_safety_risk_identified():
    f = PharmaFrontier(
        quality_patient_consequence="increased risk of adverse events",
        current_workaround="manual monitoring",
    )
    r = PatientSafetyProsecutor().prosecute(f)
    assert r.severity == 0.3
    assert r.verdict == "conditional"
    assert any("risk" in c.lower() for c in r.conditions)


def test_patient_safety_pass():
    f = PharmaFrontier(
        quality_patient_consequence="improved outcomes",
        current_workaround="existing therapy",
    )
    r = PatientSafetyProsecutor().prosecute(f)
    assert r.verdict == "pass"
    assert r.severity == 0.0


# ─── IPProsecutor ───

def test_ip_prosecutor_already_patented():
    f = PharmaFrontier(prior_art_state=PriorArtState.ALREADY_PATENTED)
    r = IPProsecutor().prosecute(f)
    assert r.severity == 0.8
    assert r.verdict == "fail"


def test_ip_prosecutor_no_human_originators():
    f = PharmaFrontier(prior_art_state=PriorArtState.NEW)
    r = IPProsecutor().prosecute(f)
    # no human originators -> 0.7
    assert r.severity == 0.7
    assert r.verdict == "fail"


def test_ip_prosecutor_pass():
    f = PharmaFrontier(prior_art_state=PriorArtState.NEW)
    f.contribution_envelope.human_originators = ["emp-1"]
    f.rights_envelope.rights_owner = RightsOwner.EMPLOYER
    r = IPProsecutor().prosecute(f)
    assert r.verdict == "pass"
    assert r.severity == 0.0


# ─── FinanceProsecutor ───

def test_finance_prosecutor_no_upside():
    f = PharmaFrontier()  # maximum_upside=0, cost_of_learning=0
    r = FinanceProsecutor().prosecute(f)
    assert r.severity == 0.6
    assert r.verdict == "fail"


def test_finance_prosecutor_pass():
    f = PharmaFrontier(
        cost_of_learning=10_000.0,
        maximum_upside=1_000_000.0,
        economic_consequence="reduces waste",
    )
    r = FinanceProsecutor().prosecute(f)
    assert r.verdict == "pass"
    assert r.severity == 0.0


# ─── AdoptionProsecutor ───

def test_adoption_prosecutor_no_experiments():
    f = PharmaFrontier(current_workaround="existing tool")
    r = AdoptionProsecutor().prosecute(f)
    # no candidate experiments -> 0.4
    assert r.severity == 0.4
    assert r.verdict == "conditional"


def test_adoption_prosecutor_pass():
    f = PharmaFrontier(
        current_workaround="existing tool",
        candidate_experiments=["exp-1"],
    )
    r = AdoptionProsecutor().prosecute(f)
    assert r.verdict == "pass"


# ─── DataProsecutor ───

def test_data_prosecutor_low_confidence():
    f = PharmaFrontier()
    f.evidence_envelope.confidence = 0.2
    r = DataProsecutor().prosecute(f)
    # no source_system (0.4) + low confidence (0.5) -> 0.5
    assert r.severity == 0.5
    assert r.verdict == "conditional"


def test_data_prosecutor_pass():
    f = PharmaFrontier()
    f.evidence_envelope.source_system = "EHR"
    f.evidence_envelope.confidence = 0.9
    f.evidence_envelope.supporting_evidence = [{"item": 1}]
    r = DataProsecutor().prosecute(f)
    assert r.verdict == "pass"


# ─── AISubstitutionProsecutor ───

def test_ai_substitution_fully_ai():
    f = PharmaFrontier(ai_contribution="fully automated")
    r = AISubstitutionProsecutor().prosecute(f)
    assert r.severity == 0.5
    assert r.verdict == "conditional"


def test_ai_substitution_pass():
    f = PharmaFrontier()
    f.contribution_envelope.human_modifications = "refined output"
    f.contribution_envelope.human_selection = "chose candidate B"
    r = AISubstitutionProsecutor().prosecute(f)
    assert r.verdict == "pass"


# ─── WarGame orchestrator ───

def test_wargame_runs_all_prosecutors():
    wg = WarGame()
    assert len(wg.prosecutors) == 8
    f = PharmaFrontier()
    results = wg.run(f)
    assert len(results) == 8
    names = {r.prosecutor for r in results}
    assert "Scientific Prosecutor" in names
    assert "Regulatory Prosecutor" in names


def test_wargame_summary_rejected():
    wg = WarGame()
    f = PharmaFrontier()  # many failures expected
    results = wg.run(f)
    summary = wg.summary(results)
    assert summary["overall_verdict"] == "REJECTED"
    assert summary["fails"] >= 1
    assert "results" in summary
    assert len(summary["results"]) == 8


def test_wargame_summary_cleared():
    wg = WarGame()
    f = PharmaFrontier(
        problem="gap",
        unknowns=["u1"],
        source_evidence=[{"s": 1}, {"s": 2}],
        regulatory_domain="GCP",
        quality_patient_consequence="improved outcomes",
        current_workaround="existing therapy",
        cost_of_learning=10_000.0,
        maximum_upside=1_000_000.0,
        economic_consequence="reduces waste",
        candidate_experiments=["exp-1"],
        ai_contribution="human-guided",
    )
    f.evidence_envelope.human_verification = True
    f.evidence_envelope.source_system = "EHR"
    f.evidence_envelope.confidence = 0.9
    f.evidence_envelope.supporting_evidence = [{"item": 1}]
    f.contribution_envelope.human_originators = ["emp-1"]
    f.contribution_envelope.human_modifications = "refined"
    f.contribution_envelope.human_selection = "chose B"
    f.rights_envelope.rights_owner = RightsOwner.EMPLOYER
    results = wg.run(f)
    summary = wg.summary(results)
    # Should be CLEARED (no fails, no conditionals)
    assert summary["overall_verdict"] == "CLEARED"
    assert summary["fails"] == 0
    assert summary["conditionals"] == 0
