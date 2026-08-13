import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rxreserve.models import (
    FrontierState,
    SettlementState,
    RightsOwner,
    ConfidentialityLevel,
    PriorArtState,
    VALID_TRANSITIONS,
    SETTLEMENT_TRANSITIONS,
    PharmaFrontier,
    EvidenceEnvelope,
    ContributionEnvelope,
    RightsEnvelope,
    SettlementEnvelope,
    ReactivationPredicate,
    PredicateType,
    evaluate_predicate_group,
)


# ─── FrontierState ───

def test_frontier_state_values():
    assert FrontierState.SIGNAL.value == "SIGNAL"
    assert FrontierState.REUSABLE_ASSET.value == "REUSABLE_ASSET"
    assert FrontierState.DORMANT_OPTION.value == "DORMANT_OPTION"


def test_frontier_state_transition_from_signal():
    assert FrontierState.FRONTIER_IDENTIFIED in VALID_TRANSITIONS[FrontierState.SIGNAL]
    # SIGNAL can only go to FRONTIER_IDENTIFIED
    assert len(VALID_TRANSITIONS[FrontierState.SIGNAL]) == 1


def test_frontier_state_terminal_reusable_asset():
    assert VALID_TRANSITIONS[FrontierState.REUSABLE_ASSET] == []


def test_frontier_state_reactivated_branches():
    targets = VALID_TRANSITIONS[FrontierState.REACTIVATED]
    assert FrontierState.CANONICALIZED in targets
    assert FrontierState.EXPERIMENT_CONTRACTED in targets
    assert FrontierState.PILOT_RUNNING in targets


# ─── SettlementState ───

def test_settlement_state_progression():
    assert SETTLEMENT_TRANSITIONS[SettlementState.NO_RIGHT] == [SettlementState.PROPOSED_RIGHT]
    assert SETTLEMENT_TRANSITIONS[SettlementState.PROPOSED_RIGHT] == [SettlementState.SIGNED_CONDITIONAL_RIGHT]
    assert SETTLEMENT_TRANSITIONS[SettlementState.PAID] == []


# ─── RightsOwner / ConfidentialityLevel / PriorArtState ───

def test_rights_owner_values():
    assert RightsOwner.EMPLOYEE.value == "employee"
    assert RightsOwner.EMPLOYER.value == "employer"
    assert RightsOwner.JOINT.value == "joint"
    assert RightsOwner.ASSIGNED.value == "assigned"
    assert RightsOwner.UNRESOLVED.value == "unresolved"


def test_confidentiality_levels():
    assert ConfidentialityLevel.PUBLIC.value == "public"
    assert ConfidentialityLevel.PRIVILEGED.value == "privileged"
    assert ConfidentialityLevel.TRADE_SECRET_CANDIDATE.value == "trade_secret_candidate"


def test_prior_art_states():
    assert PriorArtState.NEW.value == "new"
    assert PriorArtState.ALREADY_PATENTED.value == "already_patented"
    assert PriorArtState.COMMODITIZED.value == "commoditized"
    assert PriorArtState.OVERLAPPING.value == "overlapping"
    assert PriorArtState.ALREADY_ATTEMPTED.value == "already_attempted"


# ─── evaluate_predicate_group ───

def test_evaluate_predicate_group_all_true():
    group = {
        "all": [
            {"metric": "cost", "operator": "<=", "value": 100},
            {"metric": "accuracy", "operator": ">=", "value": 0.9},
        ]
    }
    metrics = {"cost": 50, "accuracy": 0.95}
    assert evaluate_predicate_group(group, metrics, []) is True


def test_evaluate_predicate_group_all_false_when_one_fails():
    group = {
        "all": [
            {"metric": "cost", "operator": "<=", "value": 100},
            {"metric": "accuracy", "operator": ">=", "value": 0.9},
        ]
    }
    metrics = {"cost": 50, "accuracy": 0.8}
    assert evaluate_predicate_group(group, metrics, []) is False


def test_evaluate_predicate_group_any_true():
    group = {
        "any": [
            {"metric": "cost", "operator": "<", "value": 10},
            {"event": "fda_approval"},
        ]
    }
    assert evaluate_predicate_group(group, {"cost": 500}, ["fda_approval"]) is True


def test_evaluate_predicate_group_any_false():
    group = {
        "any": [
            {"metric": "cost", "operator": "<", "value": 10},
            {"event": "fda_approval"},
        ]
    }
    assert evaluate_predicate_group(group, {"cost": 500}, []) is False


def test_evaluate_predicate_group_nested():
    group = {
        "all": [
            {"metric": "accuracy", "operator": ">=", "value": 0.9},
            {"any": [
                {"event": "dataset_ready"},
                {"metric": "cost", "operator": "<", "value": 1000},
            ]},
        ]
    }
    metrics = {"accuracy": 0.95, "cost": 2000}
    # nested any: event present -> True; all -> True
    assert evaluate_predicate_group(group, metrics, ["dataset_ready"]) is True
    # nested any: neither -> False; all -> False
    assert evaluate_predicate_group(group, metrics, []) is False


def test_evaluate_predicate_group_event_leaf():
    group = {"all": [{"event": "patent_expired"}]}
    assert evaluate_predicate_group(group, {}, ["patent_expired"]) is True
    assert evaluate_predicate_group(group, {}, []) is False


# ─── ReactivationPredicate ───

def test_reactivation_predicate_metric_ge():
    pred = ReactivationPredicate(
        predicate_type=PredicateType.COST,
        metric="unit_cost",
        operator=">=",
        value=50.0,
    )
    assert pred.evaluate({"unit_cost": 75.0}, []) is True
    assert pred.evaluate({"unit_cost": 30.0}, []) is False


def test_reactivation_predicate_event():
    pred = ReactivationPredicate(
        predicate_type=PredicateType.REGULATORY,
        event="fda_approval",
    )
    assert pred.evaluate({}, ["fda_approval"]) is True
    assert pred.evaluate({}, []) is False


def test_reactivation_predicate_to_dict():
    pred = ReactivationPredicate(
        predicate_type=PredicateType.PATENT,
        metric="claims",
        operator=">",
        value=3.0,
    )
    d = pred.to_dict()
    assert d["predicate_type"] == "PatentPredicate"
    assert d["metric"] == "claims"
    assert d["operator"] == ">"
    assert d["value"] == 3.0


# ─── PharmaFrontier ───

def test_pharma_frontier_defaults():
    f = PharmaFrontier()
    assert f.state == FrontierState.SIGNAL
    assert f.version == 1
    assert f.prior_art_state == PriorArtState.NEW
    assert f.rights_envelope.rights_owner == RightsOwner.UNRESOLVED
    assert f.settlement_envelope.settlement_state == SettlementState.NO_RIGHT


def test_pharma_frontier_fingerprint_stable():
    f = PharmaFrontier(problem="X", economic_consequence="Y")
    fp1 = f.fingerprint()
    fp2 = f.fingerprint()
    assert fp1 == fp2
    assert len(fp1) == 32


def test_pharma_frontier_to_dict_contains_envelopes():
    f = PharmaFrontier(problem="gap A")
    d = f.to_dict()
    assert d["state"] == "SIGNAL"
    assert "evidence_envelope" in d
    assert "contribution_envelope" in d
    assert "rights_envelope" in d
    assert "settlement_envelope" in d
    assert d["prior_art_state"] == "new"
    assert "fingerprint" in d
