import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rxreserve.pricing import (
    Scenario,
    ScenarioSet,
    PricingResult,
    FrontierPricing,
    ScenarioPricer,
    ExperimentValuation,
    value_experiment,
)


# ─── Scenario ───

def test_scenario_to_dict():
    s = Scenario(name="high_adoption", probability=0.3, value=2_000_000.0, description="fast uptake")
    d = s.to_dict()
    assert d["name"] == "high_adoption"
    assert d["probability"] == 0.3
    assert d["value"] == 2_000_000.0
    assert d["description"] == "fast uptake"


# ─── ScenarioSet ───

def test_scenario_set_to_dict():
    ss = ScenarioSet(
        technical=[Scenario("t1", 0.6, 1.0)],
        regulatory=[Scenario("r1", 0.8, 1.0)],
    )
    d = ss.to_dict()
    assert len(d["technical"]) == 1
    assert d["technical"][0]["name"] == "t1"
    assert d["adoption"] == []
    assert d["evidence"] == []
    assert d["economic"] == []


# ─── PricingResult ───

def test_pricing_result_to_dict_rounding():
    pr = PricingResult(p5=1234.567, p50=5000.0, mean=4999.99, std=100.001, n_scenarios=42)
    d = pr.to_dict()
    assert d["p5"] == 1234.57
    assert d["p50"] == 5000.0
    assert d["mean"] == 4999.99
    assert d["n_scenarios"] == 42
    # samples not included in dict
    assert "samples" not in d


# ─── ScenarioPricer ───

def test_scenario_pricer_single_dimension():
    pricer = ScenarioPricer()
    ss = ScenarioSet(
        technical=[Scenario("success", 0.5, 1_000_000.0), Scenario("fail", 0.5, 0.0)],
    )
    result = pricer.price_scenarios(ss)
    assert result.n_scenarios == 2
    # values are 1_000_000 and 0.0; mean is the average
    assert result.mean == 500_000.0
    # numpy percentile interpolates between the two samples
    assert result.p5 == 50_000.0
    assert result.p95 == 950_000.0


def test_scenario_pricer_multi_dimension_combinations():
    pricer = ScenarioPricer()
    ss = ScenarioSet(
        technical=[Scenario("t_ok", 0.6, 1.0), Scenario("t_fail", 0.4, 0.0)],
        economic=[Scenario("e_high", 0.5, 2_000_000.0), Scenario("e_low", 0.5, 1_000_000.0)],
    )
    result = pricer.price_scenarios(ss)
    # 2 x 2 = 4 combinations
    assert result.n_scenarios == 4
    # values: 1*2M=2M, 1*1M=1M, 0*2M=0, 0*1M=0
    assert result.mean == 750_000.0


def test_scenario_pricer_empty_dimensions_pass_through():
    pricer = ScenarioPricer()
    ss = ScenarioSet()  # all empty -> treated as single pass scenario value=1.0
    result = pricer.price_scenarios(ss)
    assert result.n_scenarios == 1
    assert result.mean == 1.0
    assert result.p5 == 1.0


# ─── FrontierPricing ───

def test_frontier_pricing_to_dict_formats():
    fp = FrontierPricing(
        implementation_cost_low=10_000.0,
        implementation_cost_high=50_000.0,
        annual_value_low=100_000.0,
        annual_value_high=500_000.0,
        probability_weighted_value_low=20_000.0,
        probability_weighted_value_high=200_000.0,
        downside_low=5_000.0,
        downside_high=15_000.0,
        information_value=8_000.0,
        decision="FUND LIMITED PILOT",
    )
    d = fp.to_dict()
    assert "$10,000–$50,000" in d["implementation_cost"]
    assert "$100,000–$500,000" in d["annual_value_if_valid"]
    assert d["information_value"] == "$8,000"
    assert d["decision"] == "FUND LIMITED PILOT"


def test_scenario_pricer_price_frontier_fund_full():
    pricer = ScenarioPricer()
    ss = ScenarioSet(
        technical=[Scenario("ok", 0.9, 1.0)],
        economic=[Scenario("high", 0.8, 5_000_000.0)],
    )
    fp = pricer.price_frontier(
        ss,
        implementation_cost_range=(10_000.0, 50_000.0),
        annual_value_range=(4_000_000.0, 6_000_000.0),
        downside_range=(1_000.0, 5_000.0),
    )
    # p5*val_mid and p95*val_mid should exceed impl cost high * 2 -> FUND FULL
    assert fp.decision == "FUND FULL"
    d = fp.to_dict()
    assert "FUND FULL" in d["decision"]


def test_scenario_pricer_price_frontier_reject():
    pricer = ScenarioPricer()
    ss = ScenarioSet(
        technical=[Scenario("fail", 1.0, 0.0)],
    )
    fp = pricer.price_frontier(
        ss,
        implementation_cost_range=(100_000.0, 500_000.0),
        annual_value_range=(1_000.0, 2_000.0),
        downside_range=(0.0, 0.0),
    )
    assert fp.decision == "REJECT"


# ─── value_experiment / ExperimentValuation ───

def test_value_experiment_fundable():
    ev = value_experiment(
        cost=50_000.0,
        success_upside=1_000_000.0,
        probability_success=0.2,
        planned_rollout_cost=500_000.0,
        prob_invalidates_rollout=0.5,
    )
    # expected_success = 0.2 * 1M = 200k; evsi = 0.5 * 500k = 250k
    # experiment_value = 200k + 250k - 50k = 400k
    assert ev.expected_success_value == 200_000.0
    assert ev.evsi == 250_000.0
    assert ev.experiment_value == 400_000.0
    assert ev.is_fundable is True


def test_value_experiment_not_fundable():
    ev = value_experiment(
        cost=500_000.0,
        success_upside=100_000.0,
        probability_success=0.1,
    )
    # 0.1*100k = 10k; evsi=0; value = 10k - 500k = -490k
    assert ev.experiment_value == -490_000.0
    assert ev.is_fundable is False


def test_value_experiment_failure_value():
    ev = value_experiment(
        cost=50_000.0,
        success_upside=1_000_000.0,
        probability_success=0.2,
        planned_rollout_cost=500_000.0,
        prob_invalidates_rollout=0.5,
    )
    # (1 - 0.2) * 250k - 50k = 200k - 50k = 150k
    assert ev.failure_value == 150_000.0
    d = ev.to_dict()
    assert d["is_fundable"] is True
    assert d["evsi"] == 250_000.0
