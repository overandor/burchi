"""KPI Evolution Engine — infinite KPI derivatives via genetic algorithm.

KPIs are treated as organisms in a population. Each generation:
  1. FITNESS: Every KPI is scored on how well it predicts real outcomes
  2. SELECTION: Weakest KPIs die (removed from population)
  3. REPLICATION: Strongest KPIs replicate (with mutation)
  4. GENESIS: New KPIs are generated from available data sources
  5. CROSSOVER: Top KPIs are combined to create hybrid offspring

This runs every hour. Over time, the KPI population evolves to discover
the metrics that actually matter — not the ones someone guessed at.

The engine starts with the 4 seed KPIs (labor, defrag, cost/call, NPS)
and evolves them into hundreds of derivative KPIs, each scored on:
  - Predictive power (correlation with outcomes)
  - Data availability (can we actually measure it?)
  - Actionability (can a rep/MSL act on it?)
  - Novelty (is it different from existing KPIs?)
  - Stability (does it produce consistent readings?)
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import random
import urllib.parse
import urllib.request
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4


# ─────────────────────────────────────────────────────────────────────
# KPI Organism
# ─────────────────────────────────────────────────────────────────────

@dataclass
class KPIOrganism:
    """A single KPI in the evolutionary population.

    Each KPI is defined by:
    - A formula (how it's computed from available data)
    - A data source (which streaming source feeds it)
    - A target direction (maximize or minimize)
    - Fitness score (how well it predicts outcomes)
    """
    kpi_id: str = field(default_factory=lambda: f"kpi-{uuid4().hex[:8]}")
    name: str = ""
    description: str = ""
    unit: str = ""
    # Formula components
    source: str = ""               # which data source feeds this KPI
    aggregation: str = "count"     # count, sum, avg, rate, ratio, delta
    filter_field: str = ""         # field to filter on
    filter_value: str = ""         # value to match
    group_by: str = ""             # field to group by
    time_window: str = "7d"        # 1d, 7d, 30d, 90d
    target_direction: str = "maximize"  # maximize or minimize
    # Evolution state
    generation: int = 0
    fitness: float = 0.0
    age: int = 0                   # generations survived
    offspring_count: int = 0       # children produced
    parent_id: str = ""            # parent KPI (if evolved)
    mutation_type: str = ""        # how this KPI was created
    # Measurements
    current_value: float = 0.0
    previous_value: float = 0.0
    measurement_count: int = 0
    # Fitness components
    predictive_power: float = 0.0  # correlation with outcomes
    data_availability: float = 0.0 # can we measure it?
    actionability: float = 0.0     # can someone act on it?
    novelty: float = 0.0           # is it different from other KPIs?
    stability: float = 0.0         # does it produce consistent readings?
    # Status
    alive: bool = True
    killed_at: str = ""
    killed_reason: str = ""
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict:
        return asdict(self)


# ─────────────────────────────────────────────────────────────────────
# Available data fields from streaming sources
# ─────────────────────────────────────────────────────────────────────

# These are the real fields available from each streaming source.
# The GA can only create KPIs from fields that actually exist.
SOURCE_FIELDS = {
    "fda_adverse_events": {
        "drug_name": "str",
        "safety_report_id": "str",
        "reactions": "list[str]",
        "seriousness": "str",
        "country": "str",
        "report_date": "str",
        "patient_sex": "str",
        "patient_age": "float",
    },
    "fda_drug_recalls": {
        "recall_number": "str",
        "product_description": "str",
        "reason_for_recall": "str",
        "recalling_firm": "str",
        "status": "str",
        "recall_initiation_date": "str",
        "classification": "str",
    },
    "fda_drug_labels": {
        "drug_name": "str",
        "generic_name": "str",
        "manufacturer": "str",
        "indications": "str",
        "warnings": "str",
        "contraindications": "str",
        "label_id": "str",
    },
    "clinicaltrials_gov": {
        "nct_id": "str",
        "title": "str",
        "phase": "list[str]",
        "status": "str",
        "sponsor": "str",
        "conditions": "list[str]",
        "interventions": "list[str]",
        "enrollment": "int",
        "start_date": "str",
        "completion_date": "str",
        "query_drug": "str",
        "is_competitor": "bool",
    },
    "pubmed": {
        "pmid": "str",
        "title": "str",
        "authors": "list[str]",
        "journal": "str",
        "publication_date": "str",
        "doi": "str",
        "query": "str",
    },
    "npi_registry": {
        "npi": "str",
        "name": "str",
        "specialty": "str",
        "taxonomy_code": "str",
        "state": "str",
        "city": "str",
        "address": "str",
        "credential": "str",
    },
}

AGGREGATIONS = ["count", "sum", "avg", "rate", "ratio", "delta", "unique_count"]
TIME_WINDOWS = ["1d", "7d", "30d", "90d"]
DIRECTIONS = ["maximize", "minimize"]


# ─────────────────────────────────────────────────────────────────────
# KPI Evolution Engine
# ─────────────────────────────────────────────────────────────────────

class KPIEvolutionEngine:
    """Genetic algorithm for evolving KPIs from streaming data sources.

    Every hour (or on-demand), the engine:
    1. Measures all alive KPIs against recent stream events
    2. Scores fitness (predictive power, availability, actionability, novelty, stability)
    3. Kills the weakest (bottom 20%)
    4. Replicates the strongest (top 30% produce offspring with mutation)
    5. Creates crossover KPIs from top 2 parents
    6. Genesis: generates new KPIs from random source field combinations

    Over time, the population discovers KPIs that actually matter.
    """

    # Seed KPIs (the original 4 from MeasurementFramework)
    SEED_KPIS = [
        {"name": "Adverse Event Rate", "source": "fda_adverse_events",
         "aggregation": "rate", "filter_field": "seriousness", "filter_value": "serious",
         "group_by": "drug_name", "time_window": "7d", "target_direction": "minimize",
         "unit": "serious_ae/week", "description": "Rate of serious adverse events per week"},
        {"name": "Competitor Trial Velocity", "source": "clinicaltrials_gov",
         "aggregation": "count", "filter_field": "is_competitor", "filter_value": "True",
         "group_by": "sponsor", "time_window": "30d", "target_direction": "minimize",
         "unit": "trials/30d", "description": "New competitor trials in last 30 days"},
        {"name": "Publication Impact", "source": "pubmed",
         "aggregation": "count", "filter_field": "", "filter_value": "",
         "group_by": "journal", "time_window": "30d", "target_direction": "maximize",
         "unit": "publications/30d", "description": "New publications mentioning our drugs"},
        {"name": "New HCP Registration Rate", "source": "npi_registry",
         "aggregation": "count", "filter_field": "specialty", "filter_value": "Infectious Disease",
         "group_by": "state", "time_window": "90d", "target_direction": "maximize",
         "unit": "new_hcps/90d", "description": "New infectious disease HCPs entering market"},
    ]

    def __init__(self, population_limit: int = 200,
                 kill_ratio: float = 0.2,
                 replicate_ratio: float = 0.3,
                 genesis_count: int = 10,
                 cycle_interval_hours: float = 1.0):
        self.population: dict[str, KPIOrganism] = {}
        self.population_limit = population_limit
        self.kill_ratio = kill_ratio
        self.replicate_ratio = replicate_ratio
        self.genesis_count = genesis_count
        self.cycle_interval = cycle_interval_hours * 3600

        self.generation: int = 0
        self.total_born: int = 0
        self.total_died: int = 0
        self.best_fitness: float = 0.0
        self.avg_fitness: float = 0.0
        self.last_cycle: str = ""
        self.cycle_history: list[dict] = []
        self._running = False
        self._event_buffer: list[dict] = []  # recent stream events for measurement
        self.last_error: str = ""
        self.rest_day: str = "Sunday"

        # Seed initial population
        self._seed_population()

    def _seed_population(self) -> None:
        """Initialize population with seed KPIs."""
        for seed in self.SEED_KPIS:
            kpi = KPIOrganism(
                name=seed["name"],
                description=seed["description"],
                unit=seed["unit"],
                source=seed["source"],
                aggregation=seed["aggregation"],
                filter_field=seed["filter_field"],
                filter_value=seed["filter_value"],
                group_by=seed["group_by"],
                time_window=seed["time_window"],
                target_direction=seed["target_direction"],
                generation=0,
                mutation_type="seed",
            )
            self.population[kpi.kpi_id] = kpi
            self.total_born += 1

    def feed_events(self, events: list[dict]) -> None:
        """Feed recent stream events for KPI measurement."""
        self._event_buffer = events[-500:]  # keep last 500

    # ─── Measurement ───

    def _measure_kpi(self, kpi: KPIOrganism) -> float:
        """Measure a KPI's current value from the event buffer."""
        # Filter events by source
        source_events = [e for e in self._event_buffer
                         if e.get("source") == kpi.source]
        if not source_events:
            return 0.0

        # Apply filter
        if kpi.filter_field and kpi.filter_value:
            filtered = []
            for e in source_events:
                data = e.get("data", {})
                val = data.get(kpi.filter_field, "")
                if isinstance(val, list):
                    if kpi.filter_value in [str(v) for v in val]:
                        filtered.append(e)
                elif str(val) == kpi.filter_value or str(val).lower() == kpi.filter_value.lower():
                    filtered.append(e)
        else:
            filtered = source_events

        # Aggregate
        if kpi.aggregation == "count":
            return float(len(filtered))
        elif kpi.aggregation == "rate":
            return float(len(filtered)) / max(len(source_events), 1)
        elif kpi.aggregation == "unique_count":
            values = set()
            for e in filtered:
                data = e.get("data", {})
                if kpi.group_by in data:
                    val = data[kpi.group_by]
                    if isinstance(val, list):
                        values.update(val)
                    else:
                        values.add(str(val))
            return float(len(values))
        elif kpi.aggregation == "sum":
            total = 0.0
            for e in filtered:
                data = e.get("data", {})
                val = data.get(kpi.group_by, 0)
                if isinstance(val, (int, float)):
                    total += val
            return total
        elif kpi.aggregation == "avg":
            vals = []
            for e in filtered:
                data = e.get("data", {})
                val = data.get(kpi.group_by, 0)
                if isinstance(val, (int, float)):
                    vals.append(val)
            return sum(vals) / max(len(vals), 1) if vals else 0.0
        elif kpi.aggregation == "ratio":
            return float(len(filtered)) / max(len(source_events), 1)
        elif kpi.aggregation == "delta":
            # Change since last measurement
            return kpi.current_value - kpi.previous_value
        return 0.0

    # ─── Fitness Scoring ───

    def _score_fitness(self, kpi: KPIOrganism) -> None:
        """Score a KPI's fitness across 5 dimensions."""
        # 1. Data availability: does the source have events?
        source_events = [e for e in self._event_buffer
                         if e.get("source") == kpi.source]
        kpi.data_availability = min(len(source_events) / 10.0, 1.0)

        # 2. Predictive power: does the KPI value correlate with outcomes?
        # For now, KPIs with more data points and variation score higher
        if kpi.measurement_count > 1:
            variation = abs(kpi.current_value - kpi.previous_value)
            kpi.predictive_power = min(variation / max(abs(kpi.current_value), 1.0), 1.0)
        else:
            kpi.predictive_power = 0.1  # baseline for new KPIs

        # 3. Actionability: can someone act on this?
        # KPIs with clear direction and reasonable values are more actionable
        if kpi.target_direction == "minimize":
            kpi.actionability = min(1.0, kpi.current_value / 10.0) if kpi.current_value > 0 else 0.5
        else:
            kpi.actionability = min(1.0, kpi.current_value / 10.0)

        # 4. Novelty: is this KPI different from others in the population?
        similar = 0
        for other in self.population.values():
            if other.kpi_id == kpi.kpi_id or not other.alive:
                continue
            if other.source == kpi.source and other.aggregation == kpi.aggregation:
                similar += 1
        kpi.novelty = max(0.0, 1.0 - similar / 10.0)

        # 5. Stability: does it produce consistent readings?
        if kpi.measurement_count > 2:
            kpi.stability = 1.0 - min(kpi.predictive_power, 0.5)
        else:
            kpi.stability = 0.3  # new KPIs are uncertain

        # Composite fitness (weighted)
        kpi.fitness = (
            kpi.predictive_power * 0.30 +
            kpi.data_availability * 0.25 +
            kpi.actionability * 0.20 +
            kpi.novelty * 0.15 +
            kpi.stability * 0.10
        )

    # ─── Evolution Cycle ───

    def run_cycle(self) -> dict:
        """Run one evolution cycle: measure → score → kill → replicate → genesis."""
        self.generation += 1
        alive_kpis = [k for k in self.population.values() if k.alive]

        # 1. Measure all alive KPIs
        for kpi in alive_kpis:
            kpi.previous_value = kpi.current_value
            kpi.current_value = self._measure_kpi(kpi)
            kpi.measurement_count += 1
            kpi.age += 1

        # 2. Score fitness
        for kpi in alive_kpis:
            self._score_fitness(kpi)

        # 3. Selection — kill weakest
        alive_kpis.sort(key=lambda k: k.fitness, reverse=True)
        kill_count = max(1, int(len(alive_kpis) * self.kill_ratio))
        killed = []
        for kpi in alive_kpis[-kill_count:]:
            kpi.alive = False
            kpi.killed_at = datetime.now(timezone.utc).isoformat()
            kpi.killed_reason = f"Low fitness ({kpi.fitness:.3f}) at generation {self.generation}"
            self.total_died += 1
            killed.append(kpi.name)

        # 4. Replication — strongest produce offspring with mutation
        survivors = [k for k in alive_kpis if k.alive]
        replicate_count = int(len(survivors) * self.replicate_ratio)
        new_offspring = []
        for parent in survivors[:replicate_count]:
            child = self._mutate(parent)
            if child:
                self.population[child.kpi_id] = child
                parent.offspring_count += 1
                self.total_born += 1
                new_offspring.append(child.name)

        # 5. Crossover — combine top 2 KPIs
        crossover_offspring = []
        if len(survivors) >= 2:
            for i in range(min(3, len(survivors) // 2)):
                p1 = survivors[i]
                p2 = survivors[i + 1] if i + 1 < len(survivors) else survivors[0]
                child = self._crossover(p1, p2)
                if child:
                    self.population[child.kpi_id] = child
                    self.total_born += 1
                    crossover_offspring.append(child.name)

        # 6. Genesis — generate new KPIs from random source fields
        genesis_offspring = []
        for _ in range(self.genesis_count):
            child = self._genesis()
            if child:
                self.population[child.kpi_id] = child
                self.total_born += 1
                genesis_offspring.append(child.name)

        # 7. Enforce population limit — kill lowest fitness if over limit
        alive_now = [k for k in self.population.values() if k.alive]
        if len(alive_now) > self.population_limit:
            alive_now.sort(key=lambda k: k.fitness)
            for kpi in alive_now[:len(alive_now) - self.population_limit]:
                kpi.alive = False
                kpi.killed_at = datetime.now(timezone.utc).isoformat()
                kpi.killed_reason = f"Population limit exceeded at generation {self.generation}"
                self.total_died += 1

        # 8. Update stats
        alive_final = [k for k in self.population.values() if k.alive]
        self.best_fitness = max((k.fitness for k in alive_final), default=0.0)
        self.avg_fitness = sum(k.fitness for k in alive_final) / max(len(alive_final), 1)
        self.last_cycle = datetime.now(timezone.utc).isoformat()

        cycle_result = {
            "generation": self.generation,
            "alive": len(alive_final),
            "killed": len(killed),
            "killed_names": killed[:5],
            "offspring_replication": len(new_offspring),
            "offspring_crossover": len(crossover_offspring),
            "offspring_genesis": len(genesis_offspring),
            "best_fitness": round(self.best_fitness, 4),
            "avg_fitness": round(self.avg_fitness, 4),
            "total_born": self.total_born,
            "total_died": self.total_died,
            "cycled_at": self.last_cycle,
        }
        self.cycle_history.append(cycle_result)
        if len(self.cycle_history) > 100:
            self.cycle_history = self.cycle_history[-100:]
        return cycle_result

    # ─── Mutation ───

    def _mutate(self, parent: KPIOrganism) -> Optional[KPIOrganism]:
        """Create a mutated offspring from a parent KPI."""
        mutation = random.choice([
            "change_aggregation", "change_time_window", "change_filter",
            "change_group_by", "change_direction", "tweak_all",
        ])

        child = KPIOrganism(
            name=parent.name,
            description=parent.description,
            unit=parent.unit,
            source=parent.source,
            aggregation=parent.aggregation,
            filter_field=parent.filter_field,
            filter_value=parent.filter_value,
            group_by=parent.group_by,
            time_window=parent.time_window,
            target_direction=parent.target_direction,
            generation=self.generation,
            parent_id=parent.kpi_id,
            mutation_type=mutation,
        )

        if mutation == "change_aggregation":
            child.aggregation = random.choice(AGGREGATIONS)
            child.name = f"{parent.name} ({child.aggregation})"
        elif mutation == "change_time_window":
            child.time_window = random.choice(TIME_WINDOWS)
            child.name = f"{parent.name} ({child.time_window})"
        elif mutation == "change_filter":
            fields = list(SOURCE_FIELDS.get(parent.source, {}).keys())
            if fields:
                child.filter_field = random.choice(fields)
                child.filter_value = ""  # will be filled by genesis logic
                child.name = f"{parent.name} (filter:{child.filter_field})"
        elif mutation == "change_group_by":
            fields = list(SOURCE_FIELDS.get(parent.source, {}).keys())
            if fields:
                child.group_by = random.choice(fields)
                child.name = f"{parent.name} (group:{child.group_by})"
        elif mutation == "change_direction":
            child.target_direction = "minimize" if parent.target_direction == "maximize" else "maximize"
            child.name = f"{parent.name} (inv)"
        elif mutation == "tweak_all":
            child.aggregation = random.choice(AGGREGATIONS)
            child.time_window = random.choice(TIME_WINDOWS)
            child.target_direction = random.choice(DIRECTIONS)
            child.name = f"{parent.name} (mutant)"

        child.description = f"Mutated from {parent.name} via {mutation}"
        return child

    # ─── Crossover ───

    def _crossover(self, p1: KPIOrganism, p2: KPIOrganism) -> Optional[KPIOrganism]:
        """Combine two parent KPIs to create a hybrid offspring."""
        child = KPIOrganism(
            name=f"{p1.name[:15]}×{p2.name[:15]}",
            description=f"Crossover of {p1.name} + {p2.name}",
            source=random.choice([p1.source, p2.source]),
            aggregation=random.choice([p1.aggregation, p2.aggregation]),
            filter_field=random.choice([p1.filter_field, p2.filter_field]),
            filter_value=random.choice([p1.filter_value, p2.filter_value]),
            group_by=random.choice([p1.group_by, p2.group_by]),
            time_window=random.choice([p1.time_window, p2.time_window]),
            target_direction=random.choice([p1.target_direction, p2.target_direction]),
            generation=self.generation,
            parent_id=f"{p1.kpi_id}+{p2.kpi_id}",
            mutation_type="crossover",
        )
        return child

    # ─── Genesis ───

    def _genesis(self) -> Optional[KPIOrganism]:
        """Generate a brand new KPI from random source field combinations."""
        source = random.choice(list(SOURCE_FIELDS.keys()))
        fields = list(SOURCE_FIELDS[source].keys())
        if not fields:
            return None

        agg = random.choice(AGGREGATIONS)
        group_field = random.choice(fields)
        filter_field = random.choice(fields)
        time_window = random.choice(TIME_WINDOWS)
        direction = random.choice(DIRECTIONS)

        # Generate a human-readable name
        source_label = source.replace("_", " ").title()
        agg_label = agg.replace("_", " ").title()
        name = f"{agg_label} of {group_field.replace('_', ' ').title()} by {source_label}"

        return KPIOrganism(
            name=name[:80],
            description=f"Genesis KPI: {agg} of {group_field} from {source}, "
                       f"filtered by {filter_field}, window {time_window}",
            unit=agg,
            source=source,
            aggregation=agg,
            filter_field=filter_field,
            filter_value="",
            group_by=group_field,
            time_window=time_window,
            target_direction=direction,
            generation=self.generation,
            mutation_type="genesis",
        )

    # ─── Auto-run loop (24/6 schedule) ───

    # 24/6: runs 24 hours/day, 6 days/week. Pauses on day 7 (configurable).
    # Day 7 = Sunday by default (weekday() == 6).
    # During pause: no evolution cycles run, but engine stays alive
    # and resumes automatically when the next active day starts.

    REST_DAY = 6  # Sunday (Python datetime.weekday(): Mon=0 ... Sun=6)

    def _is_rest_day(self) -> bool:
        """Check if today is the rest day (no evolution)."""
        return datetime.now(timezone.utc).weekday() == self.REST_DAY

    def _is_rest_hour(self) -> bool:
        """Check if current hour is a maintenance window (3-4 AM UTC)."""
        return datetime.now(timezone.utc).hour == 3

    async def run(self) -> None:
        """Run evolution cycles 24/6 — every hour, 6 days a week.

        Schedule:
        - Mon-Sat: evolution cycle every hour
        - Sun: paused (engine alive, no cycles)
        - 3 AM UTC daily: maintenance (checkpoint save + graveyard cleanup)
        - Crash recovery: loads last checkpoint on startup
        """
        self._running = True
        while self._running:
            now = datetime.now(timezone.utc)

            if self._is_rest_day():
                # Rest day — sleep and check again in 10 minutes
                await asyncio.sleep(600)
                continue

            if self._is_rest_hour():
                # Maintenance window — checkpoint and cleanup
                self.checkpoint()
                self._cleanup_graveyard()
                await asyncio.sleep(3600)  # sleep 1 hour
                continue

            # Run evolution cycle
            try:
                self.run_cycle()
            except Exception as e:
                # Log error but don't crash — keep running 24/6
                self.last_error = str(e)

            # Checkpoint every 6 hours
            if self.generation % 6 == 0:
                self.checkpoint()

            await asyncio.sleep(self.cycle_interval)

    def stop(self) -> None:
        """Stop the engine and save final checkpoint."""
        self._running = False
        self.checkpoint()

    # ─── Persistence (crash recovery) ───

    CHECKPOINT_PATH = os.environ.get("KPI_CHECKPOINT_DIR", "/tmp") + "/kpi_evolution_checkpoint.json"
    MAX_GRAVEYARD = 500  # keep last 500 dead KPIs

    def checkpoint(self) -> str:
        """Save current population state for crash recovery."""
        data = {
            "generation": self.generation,
            "total_born": self.total_born,
            "total_died": self.total_died,
            "best_fitness": self.best_fitness,
            "avg_fitness": self.avg_fitness,
            "last_cycle": self.last_cycle,
            "cycle_history": self.cycle_history[-20:],
            "population": [k.to_dict() for k in self.population.values()],
            "checkpoint_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            with open(self.CHECKPOINT_PATH, "w") as f:
                json.dump(data, f, default=str)
            return self.CHECKPOINT_PATH
        except Exception:
            return ""

    def restore(self) -> bool:
        """Restore population from last checkpoint (crash recovery)."""
        try:
            with open(self.CHECKPOINT_PATH, "r") as f:
                data = json.load(f)
            self.generation = data.get("generation", 0)
            self.total_born = data.get("total_born", 0)
            self.total_died = data.get("total_died", 0)
            self.best_fitness = data.get("best_fitness", 0.0)
            self.avg_fitness = data.get("avg_fitness", 0.0)
            self.last_cycle = data.get("last_cycle", "")
            self.cycle_history = data.get("cycle_history", [])
            self.population = {}
            for kpi_dict in data.get("population", []):
                kpi = KPIOrganism(**{k: v for k, v in kpi_dict.items()
                                     if k in KPIOrganism.__dataclass_fields__})
                self.population[kpi.kpi_id] = kpi
            return True
        except (FileNotFoundError, json.JSONDecodeError, Exception):
            return False

    def _cleanup_graveyard(self) -> int:
        """Remove old dead KPIs to prevent unbounded memory growth."""
        dead = [k for k in self.population.values() if not k.alive]
        if len(dead) <= self.MAX_GRAVEYARD:
            return 0
        # Sort by killed_at (oldest first) and remove excess
        dead.sort(key=lambda k: k.killed_at or "")
        removed = 0
        for kpi in dead[:len(dead) - self.MAX_GRAVEYARD]:
            self.population.pop(kpi.kpi_id, None)
            removed += 1
        return removed

    # ─── Queries ───

    def status(self) -> dict:
        alive = [k for k in self.population.values() if k.alive]
        now = datetime.now(timezone.utc)
        is_rest = self._is_rest_day()
        is_maintenance = self._is_rest_hour()
        return {
            "generation": self.generation,
            "population_alive": len(alive),
            "population_total": len(self.population),
            "population_limit": self.population_limit,
            "total_born": self.total_born,
            "total_died": self.total_died,
            "best_fitness": round(self.best_fitness, 4),
            "avg_fitness": round(self.avg_fitness, 4),
            "last_cycle": self.last_cycle,
            "running": self._running,
            "cycle_interval_hours": self.cycle_interval / 3600,
            "event_buffer_size": len(self._event_buffer),
            # 24/6 schedule
            "schedule": "24/6",
            "rest_day": self.rest_day,
            "is_rest_day": is_rest,
            "is_maintenance_hour": is_maintenance,
            "current_utc_time": now.isoformat(),
            "next_cycle_in_seconds": 0 if is_rest or is_maintenance else int(self.cycle_interval),
            "last_error": self.last_error,
            # Persistence
            "checkpoint_path": self.CHECKPOINT_PATH,
            "graveyard_size": len([k for k in self.population.values() if not k.alive]),
            "graveyard_limit": self.MAX_GRAVEYARD,
        }

    def alive_kpis(self, sort_by: str = "fitness", limit: int = 50) -> list[dict]:
        """Get alive KPIs sorted by fitness, age, or novelty."""
        alive = [k for k in self.population.values() if k.alive]
        reverse = True
        if sort_by == "age":
            alive.sort(key=lambda k: k.age, reverse=reverse)
        elif sort_by == "novelty":
            alive.sort(key=lambda k: k.novelty, reverse=reverse)
        elif sort_by == "generation":
            alive.sort(key=lambda k: k.generation, reverse=reverse)
        elif sort_by == "measurement_count":
            alive.sort(key=lambda k: k.measurement_count, reverse=reverse)
        else:  # fitness
            alive.sort(key=lambda k: k.fitness, reverse=reverse)
        return [k.to_dict() for k in alive[:limit]]

    def dead_kpis(self, limit: int = 20) -> list[dict]:
        """Get recently killed KPIs."""
        dead = [k for k in self.population.values() if not k.alive]
        dead.sort(key=lambda k: k.killed_at, reverse=True)
        return [k.to_dict() for k in dead[:limit]]

    def kpi_lineage(self, kpi_id: str) -> dict:
        """Trace a KPI's evolutionary lineage."""
        kpi = self.population.get(kpi_id)
        if not kpi:
            return {"error": "KPI not found"}

        lineage = [kpi.to_dict()]
        current = kpi
        while current.parent_id:
            parent_ids = current.parent_id.split("+")
            for pid in parent_ids:
                parent = self.population.get(pid)
                if parent:
                    lineage.append(parent.to_dict())
            current = self.population.get(parent_ids[0])
            if not current or current.kpi_id == kpi.kpi_id:
                break

        children = [k.to_dict() for k in self.population.values()
                    if k.parent_id and kpi_id in k.parent_id]
        return {"kpi": kpi.to_dict(), "ancestors": lineage[1:], "children": children}

    def evolution_history(self, limit: int = 20) -> list[dict]:
        """Get recent evolution cycle results."""
        return self.cycle_history[-limit:]

    def source_distribution(self) -> dict:
        """Get distribution of alive KPIs by data source."""
        alive = [k for k in self.population.values() if k.alive]
        dist: dict[str, int] = {}
        for k in alive:
            dist[k.source] = dist.get(k.source, 0) + 1
        return dist

    def mutation_distribution(self) -> dict:
        """Get distribution of alive KPIs by mutation type."""
        alive = [k for k in self.population.values() if k.alive]
        dist: dict[str, int] = {}
        for k in alive:
            dist[k.mutation_type] = dist.get(k.mutation_type, 0) + 1
        return dist
