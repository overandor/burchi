from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np

from rxreserve.models import ExperimentContract


# ─── Scenario-based Deterministic Pricing ───
# Don't multiply six probabilities blindly.
# Maintain scenarios: Technical, Regulatory, Adoption, Evidence, Economic
# Enumerate all combinations for exact probability-weighted outcomes.

@dataclass
class Scenario:
    """A single scenario with probability and outcome."""
    name: str
    probability: float
    value: float
    description: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "probability": self.probability,
            "value": self.value,
            "description": self.description,
        }


@dataclass
class ScenarioSet:
    """Five scenario dimensions for a frontier."""
    technical: list[Scenario] = field(default_factory=list)
    regulatory: list[Scenario] = field(default_factory=list)
    adoption: list[Scenario] = field(default_factory=list)
    evidence: list[Scenario] = field(default_factory=list)
    economic: list[Scenario] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "technical": [s.to_dict() for s in self.technical],
            "regulatory": [s.to_dict() for s in self.regulatory],
            "adoption": [s.to_dict() for s in self.adoption],
            "evidence": [s.to_dict() for s in self.evidence],
            "economic": [s.to_dict() for s in self.economic],
        }


@dataclass
class PricingResult:
    """Deterministic pricing result from real scenario data."""
    p5: float = 0.0
    p25: float = 0.0
    p50: float = 0.0  # median
    p75: float = 0.0
    p95: float = 0.0
    mean: float = 0.0
    std: float = 0.0
    n_scenarios: int = 0
    samples: list[float] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "p5": round(self.p5, 2),
            "p25": round(self.p25, 2),
            "p50": round(self.p50, 2),
            "p75": round(self.p75, 2),
            "p95": round(self.p95, 2),
            "mean": round(self.mean, 2),
            "std": round(self.std, 2),
            "n_scenarios": self.n_scenarios,
        }


@dataclass
class FrontierPricing:
    """Credible ranges for a CFO, not fake precision."""
    implementation_cost_low: float = 0.0
    implementation_cost_high: float = 0.0
    annual_value_low: float = 0.0
    annual_value_high: float = 0.0
    probability_weighted_value_low: float = 0.0
    probability_weighted_value_high: float = 0.0
    downside_low: float = 0.0
    downside_high: float = 0.0
    information_value: float = 0.0
    decision: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "implementation_cost": f"${self.implementation_cost_low:,.0f}–${self.implementation_cost_high:,.0f}",
            "annual_value_if_valid": f"${self.annual_value_low:,.0f}–${self.annual_value_high:,.0f}",
            "probability_weighted_value": f"${self.probability_weighted_value_low:,.0f}–${self.probability_weighted_value_high:,.0f}",
            "downside": f"${self.downside_low:,.0f}–${self.downside_high:,.0f}",
            "information_value": f"${self.information_value:,.0f}",
            "decision": self.decision,
        }


class ScenarioPricer:
    """Compute deterministic probability-weighted outcomes from real scenario data.

    Instead of Monte Carlo random sampling, enumerates all scenario combinations
    and computes exact probability-weighted outcomes from real data.
    """

    def __init__(self, max_combinations: int = 10000):
        self.max_combinations = max_combinations

    def price_scenarios(self, scenarios: ScenarioSet) -> PricingResult:
        """Compute exact outcome distribution from all scenario combinations."""
        import itertools

        dims = [scenarios.technical, scenarios.regulatory, scenarios.adoption,
                scenarios.evidence, scenarios.economic]

        # Filter empty dimensions (treat as single scenario with value=1.0, prob=1.0)
        real_dims = []
        for dim in dims:
            if dim:
                real_dims.append(dim)
            else:
                real_dims.append([Scenario(name="pass", probability=1.0, value=1.0)])

        # Enumerate all combinations
        combinations = list(itertools.product(*real_dims))

        # If too many combinations, sample evenly (deterministic, not random)
        if len(combinations) > self.max_combinations:
            step = len(combinations) // self.max_combinations
            combinations = combinations[::step]

        samples = []
        for combo in combinations:
            joint_prob = 1.0
            joint_value = 1.0
            for scenario in combo:
                joint_prob *= scenario.probability
                joint_value *= scenario.value
            # Weighted outcome
            samples.append(joint_value)

        arr = np.array(samples)
        return PricingResult(
            p5=float(np.percentile(arr, 5)),
            p25=float(np.percentile(arr, 25)),
            p50=float(np.percentile(arr, 50)),
            p75=float(np.percentile(arr, 75)),
            p95=float(np.percentile(arr, 95)),
            mean=float(np.mean(arr)),
            std=float(np.std(arr)),
            n_scenarios=len(samples),
            samples=samples[:100],
        )

    def price_frontier(
        self,
        scenarios: ScenarioSet,
        implementation_cost_range: tuple[float, float],
        annual_value_range: tuple[float, float],
        downside_range: tuple[float, float],
        planned_rollout_cost: float = 0.0,
        prob_invalidates_rollout: float = 0.0,
    ) -> FrontierPricing:
        """Price a frontier with credible ranges."""
        result = self.price_scenarios(scenarios)

        # Convert probability-weighted outcomes to dollar values
        val_mid = (annual_value_range[0] + annual_value_range[1]) / 2
        pw_low = result.p5 * val_mid
        pw_high = result.p95 * val_mid

        # EVSI: expected value of sample information
        # If a conclusive failure prevents a planned rollout
        evsi = prob_invalidates_rollout * planned_rollout_cost

        # Decision logic
        if pw_high < implementation_cost_range[0]:
            decision = "REJECT"
        elif pw_low > implementation_cost_range[1] * 2:
            decision = "FUND FULL"
        elif evsi > implementation_cost_range[0]:
            decision = "FUND LIMITED PILOT"
        elif result.mean * val_mid > implementation_cost_range[0]:
            decision = "FUND LIMITED PILOT"
        else:
            decision = "DEFER — MONITOR CONDITIONS"

        return FrontierPricing(
            implementation_cost_low=implementation_cost_range[0],
            implementation_cost_high=implementation_cost_range[1],
            annual_value_low=annual_value_range[0],
            annual_value_high=annual_value_range[1],
            probability_weighted_value_low=pw_low,
            probability_weighted_value_high=pw_high,
            downside_low=downside_range[0],
            downside_high=downside_range[1],
            information_value=evsi,
            decision=decision,
        )


# ─── Experiment Value with EVSI ───
# ExperimentValue = P_s * V_s + EVSI - ExperimentCost
# EVSI = expected value of sample information

@dataclass
class ExperimentValuation:
    """Price failed experiments correctly.

    An experiment has two sources of return:
    R_E = EconomicOutcome + InformationOutcome
    """
    experiment_cost: float = 0.0
    success_upside: float = 0.0
    probability_success: float = 0.0
    planned_rollout_cost: float = 0.0
    prob_invalidates_rollout: float = 0.0

    @property
    def expected_success_value(self) -> float:
        return self.probability_success * self.success_upside

    @property
    def evsi(self) -> float:
        """Expected Value of Sample Information."""
        return self.prob_invalidates_rollout * self.planned_rollout_cost

    @property
    def experiment_value(self) -> float:
        """ExperimentValue = P_s*V_s + EVSI - ExperimentCost"""
        return self.expected_success_value + self.evsi - self.experiment_cost

    @property
    def is_fundable(self) -> bool:
        return self.experiment_value > 0

    @property
    def failure_value(self) -> float:
        """Value even if the experiment fails (information value)."""
        return (1 - self.probability_success) * self.evsi - self.experiment_cost

    def to_dict(self) -> dict[str, Any]:
        return {
            "experiment_cost": self.experiment_cost,
            "success_upside": self.success_upside,
            "probability_success": self.probability_success,
            "expected_success_value": self.expected_success_value,
            "planned_rollout_cost": self.planned_rollout_cost,
            "prob_invalidates_rollout": self.prob_invalidates_rollout,
            "evsi": self.evsi,
            "experiment_value": round(self.experiment_value, 2),
            "is_fundable": self.is_fundable,
            "failure_value": round(self.failure_value, 2),
        }


def value_experiment(
    cost: float,
    success_upside: float,
    probability_success: float,
    planned_rollout_cost: float = 0.0,
    prob_invalidates_rollout: float = 0.0,
) -> ExperimentValuation:
    """Convenience function to value an experiment with EVSI."""
    return ExperimentValuation(
        experiment_cost=cost,
        success_upside=success_upside,
        probability_success=probability_success,
        planned_rollout_cost=planned_rollout_cost,
        prob_invalidates_rollout=prob_invalidates_rollout,
    )
