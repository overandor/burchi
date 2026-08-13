"""LLM KPI Genesis Service — live crawling + LLM-generated KPIs.

This service runs 24/6 alongside the KPI Evolution Engine. Instead of
random genetic mutations, it uses an LLM (Ollama) to:

1. CRAWL: Continuously poll real data sources (FDA, ClinicalTrials, PubMed, NPI)
2. ANALYZE: Feed raw events to the LLM and ask "what measurable dimensions
   exist in this data that we haven't discovered yet?"
3. GENESIS: The LLM generates semantically meaningful KPI definitions —
   with human-readable names, descriptions, formulas, and rationale
4. GRANULATE: Break down each discovered dimension into finer sub-dimensions
   ("dimensions of freedom" — the measurable axes in the data)
5. SCORE: Each LLM-generated KPI is measured against real data and scored
6. EVOLVE: Low-performing LLM KPIs are fed back to the LLM with their
   measurements, asking "how would you refine this KPI?"

The LLM discovers dimensions a human would never think of:
- "Rate of serious adverse events in pediatric patients on Biktarvy in Japan"
- "Ratio of competitor trial enrollment to Gilead trial enrollment by phase"
- "Velocity of new PubMed publications per journal per 30-day window"

Each KPI is a "dimension of freedom" — an axis along which the pharma
business can be measured. The LLM granulates these dimensions, finding
finer and finer measurable axes from the same raw data.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.parse
import urllib.request
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────
# LLM client (uses existing Ollama infrastructure)
# ─────────────────────────────────────────────────────────────────────

OLLAMA_URL = os.environ.get("OLLAMA_URL", "https://prism-ollama.fly.dev")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "phi3:mini")
REQUEST_TIMEOUT = 60


def _call_ollama(messages: list[dict], temperature: float = 0.7) -> Optional[str]:
    """Call Ollama chat API."""
    import requests
    try:
        resp = requests.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "messages": messages,
                "stream": False,
                "options": {"temperature": temperature},
            },
            headers={"Content-Type": "application/json"},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()["message"]["content"]
    except Exception as e:
        logger.error(f"Ollama call failed: {e}")
        return None


def _extract_json(text: str) -> Optional[dict | list]:
    """Extract JSON from LLM response."""
    import re
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r'\[[\s\S]*\]', text)
        if not match:
            match = re.search(r'\{[\s\S]*\}', text)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    return None


# ─────────────────────────────────────────────────────────────────────
# LLM-Generated KPI
# ─────────────────────────────────────────────────────────────────────

@dataclass
class LLMKPI:
    """A KPI discovered and defined by the LLM."""
    kpi_id: str = field(default_factory=lambda: f"llm-kpi-{uuid4().hex[:8]}")
    name: str = ""
    description: str = ""
    rationale: str = ""           # why the LLM thinks this matters
    unit: str = ""
    # Formula (LLM-generated, human-readable)
    source: str = ""              # which data source
    aggregation: str = ""         # count, rate, ratio, avg, sum, unique_count, velocity
    filter_field: str = ""        # field to filter on
    filter_value: str = ""        # value to match
    group_by: str = ""            # field to group by
    time_window: str = "30d"      # 1d, 7d, 30d, 90d
    target_direction: str = "maximize"  # maximize or minimize
    # Dimension of freedom
    dimension: str = ""           # e.g. "safety", "competitive", "publication", "access"
    sub_dimension: str = ""       # e.g. "pediatric_safety", "competitor_velocity"
    granularity: int = 0          # how deep in the dimension tree (0=root, 1=sub, 2=sub-sub)
    # Evolution
    generation: int = 0
    parent_id: str = ""           # parent KPI if refined
    refinement_history: list[str] = field(default_factory=list)
    # Measurement
    current_value: float = 0.0
    previous_value: float = 0.0
    measurement_count: int = 0
    fitness: float = 0.0
    # Status
    alive: bool = True
    killed_reason: str = ""
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    killed_at: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


# ─────────────────────────────────────────────────────────────────────
# LLM KPI Genesis Service
# ─────────────────────────────────────────────────────────────────────

class LLMKPIGenesisService:
    """Live crawling + LLM KPI generation service.

    Runs 24/6:
    1. Continuously crawls real data sources
    2. Feeds raw events to LLM
    3. LLM discovers new measurable dimensions ("dimensions of freedom")
    4. LLM granulates each dimension into finer sub-dimensions
    5. Each KPI is measured against real data
    6. Low-performing KPIs are refined by the LLM
    7. High-performing KPIs are replicated with LLM-suggested variations
    """

    # Available data sources and their fields
    SOURCES = {
        "fda_adverse_events": {
            "fields": ["drug_name", "safety_report_id", "reactions", "seriousness",
                       "country", "report_date", "patient_sex", "patient_age"],
            "description": "FDA adverse event reports from FAERS",
        },
        "fda_drug_recalls": {
            "fields": ["recall_number", "product_description", "reason_for_recall",
                       "recalling_firm", "status", "recall_initiation_date", "classification"],
            "description": "FDA drug enforcement actions (recalls)",
        },
        "fda_drug_labels": {
            "fields": ["drug_name", "generic_name", "manufacturer", "indications",
                       "warnings", "contraindications", "label_id"],
            "description": "FDA drug labeling information",
        },
        "clinicaltrials_gov": {
            "fields": ["nct_id", "title", "phase", "status", "sponsor",
                       "conditions", "interventions", "enrollment", "start_date",
                       "completion_date", "query_drug", "is_competitor"],
            "description": "Clinical trial registrations from ClinicalTrials.gov",
        },
        "pubmed": {
            "fields": ["pmid", "title", "authors", "journal", "publication_date",
                       "doi", "query"],
            "description": "Published biomedical literature from PubMed",
        },
        "npi_registry": {
            "fields": ["npi", "name", "specialty", "taxonomy_code", "state",
                       "city", "address", "credential"],
            "description": "Healthcare provider registrations from NPI Registry",
        },
    }

    # Known dimensions of freedom (the LLM can discover more)
    KNOWN_DIMENSIONS = [
        "safety", "competitive", "publication", "access", "regulatory",
        "market_dynamics", "provider_supply", "trial_velocity",
    ]

    def __init__(self, population_limit: int = 100,
                 genesis_interval_hours: float = 1.0):
        self.population: dict[str, LLMKPI] = {}
        self.population_limit = population_limit
        self.genesis_interval = genesis_interval_hours * 3600

        self.generation: int = 0
        self.total_generated: int = 0
        self.total_refined: int = 0
        self.total_killed: int = 0
        self.last_genesis: str = ""
        self.last_error: str = ""
        self._running = False
        self._event_buffer: list[dict] = []
        self.genesis_history: list[dict] = []

        # Dimensions discovered by the LLM
        self.discovered_dimensions: dict[str, list[str]] = {
            dim: [] for dim in self.KNOWN_DIMENSIONS
        }

    def feed_events(self, events: list[dict]) -> None:
        """Feed recent stream events for KPI measurement."""
        self._event_buffer = events[-500:]

    # ─── LLM Prompts ───

    def _build_genesis_prompt(self, events: list[dict]) -> list[dict]:
        """Build the LLM prompt for discovering new KPIs from real data."""
        # Sample events from each source
        by_source: dict[str, list[dict]] = {}
        for e in events:
            src = e.get("source", "")
            by_source.setdefault(src, []).append(e)

        source_summary = []
        for src, src_events in by_source.items():
            if src not in self.SOURCES:
                continue
            fields = self.SOURCES[src]["fields"]
            desc = self.SOURCES[src]["description"]
            sample = src_events[0].get("data", {}) if src_events else {}
            sample_str = json.dumps({k: str(v)[:80] for k, v in sample.items()}, indent=2)
            source_summary.append(f"Source: {src}\n  Description: {desc}\n  Fields: {fields}\n  Sample event:\n{sample_str}\n")

        # Existing KPI names (so LLM doesn't duplicate)
        existing_names = [k.name for k in self.population.values() if k.alive][:30]

        # Existing dimensions
        existing_dims = []
        for dim, subs in self.discovered_dimensions.items():
            existing_dims.append(f"{dim}: {subs}" if subs else dim)

        prompt = f"""You are a pharma business intelligence expert analyzing real streaming data.

AVAILABLE DATA SOURCES:
{chr(10).join(source_summary)}

EXISTING KPIs (don't duplicate):
{json.dumps(existing_names, indent=2)}

EXISTING DIMENSIONS DISCOVERED:
{json.dumps(existing_dims, indent=2)}

TASK: Discover 5 NEW measurable dimensions ("dimensions of freedom") in this data that don't exist yet.
Think about:
- Cross-source combinations (e.g. adverse events per clinical trial enrollment)
- Temporal patterns (velocity, acceleration, seasonality)
- Geographic distributions
- Demographic breakdowns (age, sex, specialty)
- Competitive ratios (our trials vs competitor trials)
- Safety signal strength (serious vs non-serious, by country, by drug)
- Publication velocity by journal or author
- Provider supply chain dynamics (new HCPs by state by specialty)

For each KPI, provide:
- name: concise human-readable name (max 60 chars)
- description: what it measures (1-2 sentences)
- rationale: why it matters for pharma decision-making
- source: which data source (must be one of: {list(self.SOURCES.keys())})
- aggregation: count, rate, ratio, avg, sum, unique_count, or velocity
- filter_field: field to filter on (must be a real field from the source)
- filter_value: value to filter for (can be empty for no filter)
- group_by: field to group results by (can be empty)
- time_window: 1d, 7d, 30d, or 90d
- target_direction: maximize or minimize
- unit: measurement unit (e.g. "events/week", "ratio", "%")
- dimension: which dimension of freedom this belongs to
- sub_dimension: finer sub-dimension (e.g. "pediatric_safety" under "safety")

Return a JSON array of 5 KPI objects. Be creative but precise — every field must be a real field from the source.

```json
[
  {{
    "name": "...",
    "description": "...",
    "rationale": "...",
    "source": "...",
    "aggregation": "...",
    "filter_field": "...",
    "filter_value": "...",
    "group_by": "...",
    "time_window": "...",
    "target_direction": "...",
    "unit": "...",
    "dimension": "...",
    "sub_dimension": "..."
  }}
]
```"""

        return [
            {"role": "system", "content": "You are a pharma BI expert that discovers measurable KPIs from real data. Always return valid JSON."},
            {"role": "user", "content": prompt},
        ]

    def _build_refinement_prompt(self, kpi: LLMKPI, measurement: float) -> list[dict]:
        """Build the LLM prompt to refine a low-performing KPI."""
        prompt = f"""You are refining a KPI that is underperforming.

CURRENT KPI:
- Name: {kpi.name}
- Description: {kpi.description}
- Source: {kpi.source}
- Aggregation: {kpi.aggregation}
- Filter: {kpi.filter_field}={kpi.filter_value}
- Group by: {kpi.group_by}
- Time window: {kpi.time_window}
- Current value: {measurement}
- Measurements taken: {kpi.measurement_count}
- Fitness score: {kpi.fitness:.3f}

The KPI has low fitness because it may have:
- No data matching the filter (data_availability too low)
- No variation in values (predictive_power too low)
- Not actionable enough
- Too similar to other KPIs

TASK: Refine this KPI to improve its fitness. Change the filter, aggregation,
group_by, or time_window to make it more measurable and actionable.
Keep the same source and dimension.

Return a JSON object with the refined KPI:
```json
{{
  "name": "...",
  "description": "...",
  "rationale": "why this refinement should perform better",
  "aggregation": "...",
  "filter_field": "...",
  "filter_value": "...",
  "group_by": "...",
  "time_window": "...",
  "target_direction": "...",
  "unit": "...",
  "sub_dimension": "..."
}}
```"""

        return [
            {"role": "system", "content": "You refine underperforming pharma KPIs. Always return valid JSON."},
            {"role": "user", "content": prompt},
        ]

    def _build_granulation_prompt(self, dimension: str, existing_subs: list[str]) -> list[dict]:
        """Build the LLM prompt to granulate a dimension into sub-dimensions."""
        prompt = f"""You are granulating a dimension of freedom for pharma KPIs.

DIMENSION: {dimension}
EXISTING SUB-DIMENSIONS: {json.dumps(existing_subs)}

TASK: Break this dimension into 5 finer sub-dimensions that could be measured
from available data sources (FDA adverse events, clinical trials, PubMed, NPI registry).

Think about:
- Demographic slices (age, sex, geography)
- Temporal slices (velocity, seasonality, trend)
- Severity slices (serious vs non-serious, Phase 1 vs Phase 3)
- Competitive slices (our vs competitor, by sponsor)
- Cross-source combinations

Return a JSON array of sub-dimension names:
```json
["sub_dim_1", "sub_dim_2", "sub_dim_3", "sub_dim_4", "sub_dim_5"]
```"""

        return [
            {"role": "system", "content": "You granulate pharma dimensions into measurable sub-dimensions. Always return valid JSON."},
            {"role": "user", "content": prompt},
        ]

    # ─── LLM Genesis ───

    def llm_genesis(self) -> list[LLMKPI]:
        """Use the LLM to discover new KPIs from real streaming data."""
        if not self._event_buffer:
            return []

        messages = self._build_genesis_prompt(self._event_buffer)
        response = _call_ollama(messages, temperature=0.7)
        if not response:
            self.last_error = "LLM call failed for genesis"
            return []

        kpi_defs = _extract_json(response)
        if not kpi_defs or not isinstance(kpi_defs, list):
            self.last_error = f"LLM returned invalid JSON: {response[:100]}"
            return []

        new_kpis = []
        for kpi_def in kpi_defs:
            if not isinstance(kpi_def, dict):
                continue
            # Validate source
            source = kpi_def.get("source", "")
            if source not in self.SOURCES:
                continue
            # Validate fields
            available_fields = self.SOURCES[source]["fields"]
            filter_field = kpi_def.get("filter_field", "")
            group_by = kpi_def.get("group_by", "")
            if filter_field and filter_field not in available_fields:
                filter_field = ""
            if group_by and group_by not in available_fields:
                group_by = ""

            kpi = LLMKPI(
                name=kpi_def.get("name", "")[:60],
                description=kpi_def.get("description", ""),
                rationale=kpi_def.get("rationale", ""),
                unit=kpi_def.get("unit", ""),
                source=source,
                aggregation=kpi_def.get("aggregation", "count"),
                filter_field=filter_field,
                filter_value=kpi_def.get("filter_value", ""),
                group_by=group_by,
                time_window=kpi_def.get("time_window", "30d"),
                target_direction=kpi_def.get("target_direction", "maximize"),
                dimension=kpi_def.get("dimension", "unknown"),
                sub_dimension=kpi_def.get("sub_dimension", ""),
                granularity=1 if kpi_def.get("sub_dimension") else 0,
                generation=self.generation,
            )

            # Track discovered dimensions
            dim = kpi.dimension
            if dim not in self.discovered_dimensions:
                self.discovered_dimensions[dim] = []
            if kpi.sub_dimension and kpi.sub_dimension not in self.discovered_dimensions[dim]:
                self.discovered_dimensions[dim].append(kpi.sub_dimension)

            self.population[kpi.kpi_id] = kpi
            self.total_generated += 1
            new_kpis.append(kpi)

        self.last_genesis = datetime.now(timezone.utc).isoformat()
        self.genesis_history.append({
            "generation": self.generation,
            "generated": len(new_kpis),
            "timestamp": self.last_genesis,
        })
        return new_kpis

    # ─── LLM Refinement ───

    def llm_refine(self, kpi_id: str) -> Optional[LLMKPI]:
        """Use the LLM to refine a low-performing KPI."""
        kpi = self.population.get(kpi_id)
        if not kpi or not kpi.alive:
            return None

        messages = self._build_refinement_prompt(kpi, kpi.current_value)
        response = _call_ollama(messages, temperature=0.5)
        if not response:
            return None

        refined = _extract_json(response)
        if not refined or not isinstance(refined, dict):
            return None

        # Create refined child KPI
        available_fields = self.SOURCES.get(kpi.source, {}).get("fields", [])
        filter_field = refined.get("filter_field", kpi.filter_field)
        group_by = refined.get("group_by", kpi.group_by)
        if filter_field and filter_field not in available_fields:
            filter_field = kpi.filter_field
        if group_by and group_by not in available_fields:
            group_by = kpi.group_by

        child = LLMKPI(
            name=refined.get("name", kpi.name)[:60],
            description=refined.get("description", kpi.description),
            rationale=refined.get("rationale", ""),
            unit=refined.get("unit", kpi.unit),
            source=kpi.source,
            aggregation=refined.get("aggregation", kpi.aggregation),
            filter_field=filter_field,
            filter_value=refined.get("filter_value", kpi.filter_value),
            group_by=group_by,
            time_window=refined.get("time_window", kpi.time_window),
            target_direction=refined.get("target_direction", kpi.target_direction),
            dimension=kpi.dimension,
            sub_dimension=refined.get("sub_dimension", kpi.sub_dimension),
            granularity=kpi.granularity + 1,
            generation=self.generation,
            parent_id=kpi.kpi_id,
            refinement_history=kpi.refinement_history + [f"Refined at gen {self.generation}: {refined.get('rationale', '')[:100]}"],
        )
        self.population[child.kpi_id] = child
        self.total_refined += 1
        return child

    # ─── LLM Dimension Granulation ───

    def llm_granulate(self, dimension: str) -> list[str]:
        """Use the LLM to break a dimension into finer sub-dimensions."""
        existing = self.discovered_dimensions.get(dimension, [])
        messages = self._build_granulation_prompt(dimension, existing)
        response = _call_ollama(messages, temperature=0.6)
        if not response:
            return []

        subs = _extract_json(response)
        if not subs or not isinstance(subs, list):
            return []

        new_subs = []
        for sub in subs:
            if isinstance(sub, str) and sub not in self.discovered_dimensions.get(dimension, []):
                self.discovered_dimensions.setdefault(dimension, []).append(sub)
                new_subs.append(sub)
        return new_subs

    # ─── Measurement & Fitness ───

    def _measure_kpi(self, kpi: LLMKPI) -> float:
        """Measure a KPI's current value from the event buffer."""
        source_events = [e for e in self._event_buffer if e.get("source") == kpi.source]
        if not source_events:
            return 0.0

        if kpi.filter_field and kpi.filter_value:
            filtered = []
            for e in source_events:
                data = e.get("data", {})
                val = data.get(kpi.filter_field, "")
                if isinstance(val, list):
                    if kpi.filter_value in [str(v) for v in val]:
                        filtered.append(e)
                elif str(val).lower() == kpi.filter_value.lower():
                    filtered.append(e)
        else:
            filtered = source_events

        agg = kpi.aggregation.lower()
        if agg == "count":
            return float(len(filtered))
        elif agg == "rate":
            return float(len(filtered)) / max(len(source_events), 1)
        elif agg == "unique_count":
            values = set()
            for e in filtered:
                data = e.get("data", {})
                if kpi.group_by in data:
                    val = data[kpi.group_by]
                    if isinstance(val, list):
                        values.update(str(v) for v in val)
                    else:
                        values.add(str(val))
            return float(len(values))
        elif agg == "sum":
            total = 0.0
            for e in filtered:
                data = e.get("data", {})
                val = data.get(kpi.group_by, 0)
                if isinstance(val, (int, float)):
                    total += val
            return total
        elif agg == "avg":
            vals = [e.get("data", {}).get(kpi.group_by, 0) for e in filtered]
            nums = [v for v in vals if isinstance(v, (int, float))]
            return sum(nums) / max(len(nums), 1) if nums else 0.0
        elif agg == "ratio":
            return float(len(filtered)) / max(len(source_events), 1)
        elif agg == "velocity":
            # Rate of change
            if kpi.measurement_count > 1:
                return kpi.current_value - kpi.previous_value
            return float(len(filtered))
        return 0.0

    def _score_fitness(self, kpi: LLMKPI) -> None:
        """Score KPI fitness."""
        source_events = [e for e in self._event_buffer if e.get("source") == kpi.source]
        data_availability = min(len(source_events) / 10.0, 1.0)

        if kpi.measurement_count > 1:
            variation = abs(kpi.current_value - kpi.previous_value)
            predictive_power = min(variation / max(abs(kpi.current_value), 1.0), 1.0)
        else:
            predictive_power = 0.1

        if kpi.target_direction == "minimize":
            actionability = min(1.0, kpi.current_value / 10.0) if kpi.current_value > 0 else 0.5
        else:
            actionability = min(1.0, kpi.current_value / 10.0)

        # Novelty: different sub-dimension from others
        similar = sum(1 for k in self.population.values()
                      if k.alive and k.sub_dimension == kpi.sub_dimension
                      and k.kpi_id != kpi.kpi_id)
        novelty = max(0.0, 1.0 - similar / 5.0)

        if kpi.measurement_count > 2:
            stability = 1.0 - min(predictive_power, 0.5)
        else:
            stability = 0.3

        kpi.fitness = (
            predictive_power * 0.30 +
            data_availability * 0.25 +
            actionability * 0.20 +
            novelty * 0.15 +
            stability * 0.10
        )

    # ─── Evolution Cycle ───

    def run_cycle(self) -> dict:
        """Run one LLM-driven evolution cycle."""
        self.generation += 1
        alive = [k for k in self.population.values() if k.alive]

        # 1. Measure all alive KPIs
        for kpi in alive:
            kpi.previous_value = kpi.current_value
            kpi.current_value = self._measure_kpi(kpi)
            kpi.measurement_count += 1

        # 2. Score fitness
        for kpi in alive:
            self._score_fitness(kpi)

        # 3. Kill weakest 20%
        alive.sort(key=lambda k: k.fitness, reverse=True)
        kill_count = max(1, int(len(alive) * 0.2)) if len(alive) > 5 else 0
        killed = []
        for kpi in alive[-kill_count:]:
            kpi.alive = False
            kpi.killed_at = datetime.now(timezone.utc).isoformat()
            kpi.killed_reason = f"Low fitness ({kpi.fitness:.3f})"
            self.total_killed += 1
            killed.append(kpi.name)

        # 4. Refine bottom 30% of survivors via LLM
        survivors = [k for k in alive if k.alive]
        refine_count = min(3, int(len(survivors) * 0.3))
        refined = []
        for kpi in survivors[-refine_count:] if refine_count > 0 else []:
            child = self.llm_refine(kpi.kpi_id)
            if child:
                refined.append(child.name)

        # 5. LLM Genesis — discover new KPIs
        new_kpis = self.llm_genesis()

        # 6. Enforce population limit
        alive_now = [k for k in self.population.values() if k.alive]
        if len(alive_now) > self.population_limit:
            alive_now.sort(key=lambda k: k.fitness)
            for kpi in alive_now[:len(alive_now) - self.population_limit]:
                kpi.alive = False
                kpi.killed_at = datetime.now(timezone.utc).isoformat()
                kpi.killed_reason = "Population limit"
                self.total_killed += 1

        result = {
            "generation": self.generation,
            "alive": len([k for k in self.population.values() if k.alive]),
            "killed": len(killed),
            "refined": len(refined),
            "generated": len(new_kpis),
            "total_generated": self.total_generated,
            "total_refined": self.total_refined,
            "total_killed": self.total_killed,
            "dimensions_discovered": len(self.discovered_dimensions),
            "sub_dimensions": sum(len(v) for v in self.discovered_dimensions.values()),
            "last_error": self.last_error,
            "cycled_at": datetime.now(timezone.utc).isoformat(),
        }
        return result

    # ─── 24/6 Auto-run ───

    REST_DAY = 6  # Sunday

    def _is_rest_day(self) -> bool:
        return datetime.now(timezone.utc).weekday() == self.REST_DAY

    async def run(self) -> None:
        """Run 24/6 — LLM genesis every hour, 6 days a week."""
        self._running = True
        while self._running:
            if self._is_rest_day():
                await asyncio.sleep(600)
                continue
            try:
                self.run_cycle()
            except Exception as e:
                self.last_error = str(e)
            await asyncio.sleep(self.genesis_interval)

    def stop(self) -> None:
        self._running = False

    # ─── Queries ───

    def status(self) -> dict:
        alive = [k for k in self.population.values() if k.alive]
        return {
            "generation": self.generation,
            "alive": len(alive),
            "total": len(self.population),
            "limit": self.population_limit,
            "total_generated": self.total_generated,
            "total_refined": self.total_refined,
            "total_killed": self.total_killed,
            "dimensions_discovered": len(self.discovered_dimensions),
            "sub_dimensions": sum(len(v) for v in self.discovered_dimensions.values()),
            "dimension_tree": self.discovered_dimensions,
            "running": self._running,
            "schedule": "24/6",
            "is_rest_day": self._is_rest_day(),
            "last_genesis": self.last_genesis,
            "last_error": self.last_error,
            "event_buffer": len(self._event_buffer),
            "genesis_count": len(self.genesis_history),
        }

    def alive_kpis(self, sort_by: str = "fitness", limit: int = 50) -> list[dict]:
        alive = [k for k in self.population.values() if k.alive]
        if sort_by == "fitness":
            alive.sort(key=lambda k: k.fitness, reverse=True)
        elif sort_by == "generation":
            alive.sort(key=lambda k: k.generation, reverse=True)
        elif sort_by == "dimension":
            alive.sort(key=lambda k: (k.dimension, k.sub_dimension))
        return [k.to_dict() for k in alive[:limit]]

    def dimensions(self) -> dict:
        """Get the full dimension tree discovered by the LLM."""
        return self.discovered_dimensions

    def kpis_by_dimension(self, dimension: str) -> list[dict]:
        """Get all alive KPIs in a specific dimension."""
        return [k.to_dict() for k in self.population.values()
                if k.alive and k.dimension == dimension]
