"""Recommendation engine: produce a unique revenue-producing automation.

For each business process + prior-art report, this module synthesizes a
recommendation for a revenue-producing automation that is positioned as a
new category of software. The recommendation includes:

  - A product name and one-line positioning
  - The new category it defines (and why no existing product occupies it)
  - A concrete revenue model (pricing, GTM, customer)
  - An MVP scope (what to build first)
  - A novelty claim grounded in the prior-art report
  - A risk / patent-counsel flag where appropriate

When an LLM endpoint is configured, the synthesis uses it; otherwise a
deterministic template-based synthesizer runs from the structured inputs.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field, asdict
from typing import Optional

from pipeline.disassembly import BusinessProcess
from pipeline.prior_art import PriorArtReport


@dataclass
class RevenueModel:
    pricing: str  # e.g. "$29/mo per seat, $0.01 per API call"
    gtm: str  # go-to-market motion
    customer: str  # ideal customer profile
    arr_year1: str  # rough ARR target for year 1
    unit_economics: str  # margin / cost structure

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Recommendation:
    id: str
    product_name: str
    tagline: str
    new_category: str
    category_rationale: str
    problem: str
    solution: str
    mvp_scope: list[str]
    revenue_model: RevenueModel
    novelty_claim: str
    differentiation: str
    source_processes: list[str]  # process ids
    source_conversations: list[str]  # conversation ids
    prior_art_summary: str
    novelty_assessment: str
    patent_counsel_flag: str
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["revenue_model"] = self.revenue_model.to_dict()
        return d


def _slug_name(bp: BusinessProcess) -> str:
    """Derive a product-ish name from the process."""
    words = [w for w in bp.name.split() if len(w) > 2 and w.lower() not in {"the", "and", "for"}]
    if not words:
        words = bp.keywords[:2]
    # CamelCase the first 2-3 words.
    return "".join(w.capitalize() for w in words[:3])


def _deterministic_synthesize(processes: list[BusinessProcess], reports: list[PriorArtReport]) -> Recommendation:
    """Build a recommendation without an LLM, from structured inputs."""
    bp = processes[0]
    report = reports[0] if reports else None

    product_name = _slug_name(bp)
    # Merge keywords across processes for the category.
    all_kw = set()
    for p in processes:
        all_kw.update(p.keywords[:5])
    category_kw = sorted(all_kw)[:4]

    if report:
        novelty = report.novelty_assessment
        prior_summary = report.summary
        existing = report.existing_products[:3]
    else:
        novelty = "unknown"
        prior_summary = "Prior art research not run."
        existing = []

    new_category = f"{bp.category} → {'/'.join(category_kw)}".strip(" →")

    if existing:
        differentiation = (
            f"Existing solutions ({', '.join(existing)}) address adjacent problems. "
            f"This product occupies the specific gap: {bp.description[:160]}"
        )
    else:
        differentiation = (
            f"No existing product directly addresses this. The specific gap: {bp.description[:160]}"
        )

    if novelty == "novel":
        novelty_claim = (
            f"Prior-art search found no direct product, patent, or academic work covering this "
            f"specific combination. The {new_category} framing appears unoccupied."
        )
        patent_flag = (
            "Novelty appears strong. Flag for patent counsel: file an invention disclosure "
            "before public release to preserve IP rights."
        )
    elif novelty == "partially novel":
        novelty_claim = (
            f"Prior-art search found adjacent work but the specific {new_category} combination "
            f"and revenue framing appears novel."
        )
        patent_flag = (
            "Partial novelty. Flag for patent counsel: review adjacent patents before release; "
            "consider a narrow utility claim on the specific workflow."
        )
    else:
        novelty_claim = (
            f"Prior-art search found existing work in this space. Differentiation must come from "
            f"execution, pricing, or a narrow workflow improvement."
        )
        patent_flag = "Concept is well-known. No patent counsel flag; compete on execution."

    revenue = RevenueModel(
        pricing="$29/mo per seat (solo) / $99/mo (team) + $0.02 per automation run overage",
        gtm=f"Build in public from the originating chat logs; launch on {bp.category} communities and Product Hunt.",
        customer=f"Developers and small teams who repeatedly encounter: {bp.description[:120]}",
        arr_year1="$50K–$150K (100–500 paid seats via direct + community)",
        unit_economics="Gross margin >85% (SaaS with minimal compute); CAC < $30 via organic + community.",
    )

    mvp = [
        f"CLI or API that ingests the input described in: {bp.name}",
        f"Core automation: {bp.description[:100]}",
        "Output as structured JSON + receipt with provenance",
        "Single-tenant deploy (Docker) + hosted free tier",
        "Stripe billing integration for the paid tier",
    ]

    return Recommendation(
        id=f"rec_{bp.id}",
        product_name=product_name,
        tagline=f"{new_category} as a callable, revenue-bearing product.",
        new_category=new_category,
        category_rationale=(
            f"No existing software category directly covers: {bp.description[:200]}. "
            f"This product defines the category by combining {', '.join(category_kw)} into a "
            f"single revenue-producing automation."
        ),
        problem=bp.description,
        solution=(
            f"An automated system that performs: {bp.description[:160]} "
            f"and exposes the result as an API + CLI with per-run billing."
        ),
        mvp_scope=mvp,
        revenue_model=revenue,
        novelty_claim=novelty_claim,
        differentiation=differentiation,
        source_processes=[p.id for p in processes],
        source_conversations=list({p.conversation_id for p in processes}),
        prior_art_summary=prior_summary,
        novelty_assessment=novelty,
        patent_counsel_flag=patent_flag,
    )


async def _llm_synthesize(
    processes: list[BusinessProcess], reports: list[PriorArtReport],
    endpoint: str, api_key: str, model: str,
) -> Optional[Recommendation]:
    """Use an LLM to synthesize a richer recommendation."""
    if not api_key or not endpoint:
        return None

    bp_summaries = [
        {"name": p.name, "description": p.description, "category": p.category, "keywords": p.keywords}
        for p in processes[:5]
    ]
    report_summaries = [
        {"novelty": r.novelty_assessment, "summary": r.summary,
         "existing_products": r.existing_products[:3], "existing_patents": r.existing_patents[:3]}
        for r in reports[:5]
    ]

    prompt = (
        "You are a product strategist. Given extracted business processes and prior-art research, "
        "synthesize ONE recommendation for a revenue-producing automation that defines a NEW category "
        "of software. Return JSON with keys: product_name, tagline, new_category, category_rationale, "
        "problem, solution, mvp_scope (list of strings), revenue_model (object with pricing, gtm, "
        "customer, arr_year1, unit_economics), novelty_claim, differentiation, patent_counsel_flag.\n\n"
        f"Business processes:\n{json.dumps(bp_summaries, indent=2)}\n\n"
        f"Prior art:\n{json.dumps(report_summaries, indent=2)}\n\nJSON:"
    )
    payload = {"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.4}
    try:
        import aiohttp
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=45)) as sess:
            async with sess.post(f"{endpoint.rstrip('/')}/chat/completions", json=payload, headers=headers) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
                content = data["choices"][0]["message"]["content"]
                start, end = content.find("{"), content.rfind("}") + 1
                if start == -1 or end == 0:
                    return None
                parsed = json.loads(content[start:end])
    except Exception:
        return None

    rm = parsed.get("revenue_model", {})
    bp = processes[0]
    return Recommendation(
        id=f"rec_{bp.id}",
        product_name=str(parsed.get("product_name", _slug_name(bp)))[:120],
        tagline=str(parsed.get("tagline", ""))[:200],
        new_category=str(parsed.get("new_category", bp.category))[:120],
        category_rationale=str(parsed.get("category_rationale", ""))[:600],
        problem=str(parsed.get("problem", bp.description))[:500],
        solution=str(parsed.get("solution", ""))[:600],
        mvp_scope=[str(s) for s in parsed.get("mvp_scope", [])][:10],
        revenue_model=RevenueModel(
            pricing=str(rm.get("pricing", ""))[:200],
            gtm=str(rm.get("gtm", ""))[:300],
            customer=str(rm.get("customer", ""))[:300],
            arr_year1=str(rm.get("arr_year1", ""))[:100],
            unit_economics=str(rm.get("unit_economics", ""))[:200],
        ),
        novelty_claim=str(parsed.get("novelty_claim", ""))[:600],
        differentiation=str(parsed.get("differentiation", ""))[:600],
        source_processes=[p.id for p in processes],
        source_conversations=list({p.conversation_id for p in processes}),
        prior_art_summary="; ".join(r.summary for r in reports[:3]) if reports else "",
        novelty_assessment=reports[0].novelty_assessment if reports else "unknown",
        patent_counsel_flag=str(parsed.get("patent_counsel_flag", ""))[:400],
    )


async def recommend(
    processes: list[BusinessProcess],
    reports: list[PriorArtReport],
    use_llm: bool = True,
) -> Recommendation:
    """Produce a single recommendation from processes + prior-art reports."""
    if not processes:
        raise ValueError("Cannot recommend without at least one business process.")

    endpoint = os.environ.get("OPENAI_BASE_URL", os.environ.get("LLM_ENDPOINT", "https://api.openai.com/v1"))
    api_key = os.environ.get("OPENAI_API_KEY", os.environ.get("LLM_API_KEY", ""))
    model = os.environ.get("LLM_MODEL", "gpt-4o-mini")

    if use_llm:
        llm_rec = await _llm_synthesize(processes, reports, endpoint, api_key, model)
        if llm_rec:
            return llm_rec
    return _deterministic_synthesize(processes, reports)
