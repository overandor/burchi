"""Prior-art research: web + patent search for each business process.

For every extracted business process, this module runs:
  1. A general web search (via the Vercel MCP search_vercel_documentation
     is NOT used here — we call a pluggable search backend directly).
  2. A patent / academic search (Google Patents + Google Scholar URLs are
     constructed and fetched; results are summarized).

Results are structured into a PriorArtReport that the recommendation engine
uses to determine novelty. The search backend is pluggable: by default it
uses a DuckDuckGo HTML endpoint (no API key required); if a SerpAPI or
Brave Search API key is set, it uses that for higher-quality results.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from dataclasses import dataclass, field, asdict
from typing import Optional
from urllib.parse import quote_plus

try:
    import aiohttp
except ImportError:
    aiohttp = None  # type: ignore

from pipeline.disassembly import BusinessProcess


@dataclass
class PriorArtHit:
    title: str
    url: str
    snippet: str
    source: str  # "web", "patent", "academic"
    relevance: str = "unknown"  # "direct" | "adjacent" | "tangential"

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class PriorArtReport:
    process_id: str
    process_name: str
    query: str
    web_hits: list[PriorArtHit] = field(default_factory=list)
    patent_hits: list[PriorArtHit] = field(default_factory=list)
    academic_hits: list[PriorArtHit] = field(default_factory=list)
    summary: str = ""
    novelty_assessment: str = "unknown"  # "novel" | "partially novel" | "known"
    existing_products: list[str] = field(default_factory=list)
    existing_patents: list[str] = field(default_factory=list)
    researched_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["web_hits"] = [h.to_dict() for h in self.web_hits]
        d["patent_hits"] = [h.to_dict() for h in self.patent_hits]
        d["academic_hits"] = [h.to_dict() for h in self.academic_hits]
        return d


def _build_queries(bp: BusinessProcess) -> dict[str, str]:
    """Construct search queries for web, patent, and academic sources."""
    name_clean = re.sub(r"\s+", " ", bp.name).strip()
    kw = " ".join(bp.keywords[:5])
    base = f"{name_clean} {kw}".strip()
    return {
        "web": f"{base} software tool product",
        "patent": f"{base} method system",
        "academic": f"{base} paper",
    }


async def _ddg_search(query: str, max_results: int = 5) -> list[PriorArtHit]:
    """Search DuckDuckGo HTML endpoint (no API key required).

    Falls back to generating search-URL hits if the endpoint is unreachable,
    so the prior-art report always contains actionable links.
    """
    if aiohttp is None:
        return _fallback_search_hits(query, "web", max_results)
    # Try the lite endpoint first (more reliable, less likely to be blocked).
    for endpoint in ("https://lite.duckduckgo.com/lite/", "https://html.duckduckgo.com/html/"):
        url = f"{endpoint}?q={quote_plus(query)}"
        headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ChatSync/1.0"}
        hits = []
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as sess:
                async with sess.get(url, headers=headers) as resp:
                    if resp.status != 200:
                        continue
                    html = await resp.text()
            # Parse result links and snippets from DDG HTML.
            # Results are in <a class="result-link" href="..."> (lite) or
            # <a class="result__a" href="..."> (html).
            results = re.findall(
                r'<a[^>]+class="result[^"]*a?"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?'
                r'(?:<td[^>]*class="result[^"]*snippet"[^>]*>(.*?)</td>|'
                r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>)',
                html, re.DOTALL,
            )
            for raw_url, title, snip1, snip2 in results[:max_results]:
                # DDG wraps URLs in a redirect; extract the actual URL.
                m = re.search(r"uddg=([^&]+)", raw_url)
                from urllib.parse import unquote
                actual_url = unquote(m.group(1)) if m else raw_url
                title_clean = re.sub(r"<[^>]+>", "", title).strip()
                snippet_clean = re.sub(r"<[^>]+>", "", snip1 or snip2).strip()
                if title_clean:
                    hits.append(PriorArtHit(
                        title=title_clean[:200],
                        url=actual_url[:500],
                        snippet=snippet_clean[:300],
                        source="web",
                    ))
            if hits:
                return hits
        except (aiohttp.ClientError, asyncio.TimeoutError, Exception):
            continue
    # Fallback: generate search URL hits so the report is still useful.
    return _fallback_search_hits(query, "web", max_results)


def _fallback_search_hits(query: str, source: str, max_results: int) -> list[PriorArtHit]:
    """Generate search-URL hits when live scraping fails.

    These are not parsed results but direct links to search pages, which
    still let a human reviewer click through to verify prior art.
    """
    q = quote_plus(query)
    if source == "patent":
        return [PriorArtHit(
            title=f"Google Patents search: {query}",
            url=f"https://patents.google.com/?q={q}",
            snippet="Click to view patent search results (live scrape unavailable).",
            source="patent",
            relevance="unknown",
        )]
    elif source == "academic":
        return [PriorArtHit(
            title=f"Google Scholar search: {query}",
            url=f"https://scholar.google.com/scholar?q={q}",
            snippet="Click to view academic search results (live scrape unavailable).",
            source="academic",
            relevance="unknown",
        )]
    else:
        return [
            PriorArtHit(
                title=f"Google search: {query}",
                url=f"https://www.google.com/search?q={q}",
                snippet="Click to view web search results (live scrape unavailable).",
                source="web",
                relevance="unknown",
            ),
            PriorArtHit(
                title=f"Bing search: {query}",
                url=f"https://www.bing.com/search?q={q}",
                snippet="Click to view web search results (live scrape unavailable).",
                source="web",
                relevance="unknown",
            ),
        ]


async def _brave_search(query: str, api_key: str, max_results: int = 5) -> list[PriorArtHit]:
    """Search via Brave Search API."""
    if aiohttp is None or not api_key:
        return []
    url = "https://api.search.brave.com/res/v1/web/search"
    headers = {"X-Subscription-Token": api_key, "Accept": "application/json"}
    params = {"q": query, "count": max_results}
    hits = []
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as sess:
            async with sess.get(url, headers=headers, params=params) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()
        for r in data.get("web", {}).get("results", [])[:max_results]:
            hits.append(PriorArtHit(
                title=r.get("title", "")[:200],
                url=r.get("url", "")[:500],
                snippet=r.get("description", "")[:300],
                source="web",
            ))
    except (aiohttp.ClientError, asyncio.TimeoutError, json.JSONDecodeError):
        pass
    return hits


async def _patent_search(query: str, max_results: int = 5) -> list[PriorArtHit]:
    """Search Google Patents via the public HTML endpoint."""
    if aiohttp is None:
        return _fallback_search_hits(query, "patent", max_results)
    url = f"https://patents.google.com/?q={quote_plus(query)}&num={max_results}"
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ChatSync/1.0"}
    hits = []
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as sess:
            async with sess.get(url, headers=headers) as resp:
                if resp.status != 200:
                    return _fallback_search_hits(query, "patent", max_results)
                html = await resp.text()
        # Google Patents results have <a class="result-title" href="/patent/..."> and snippets.
        results = re.findall(
            r'<a[^>]+href="(/patent/[^"]+)"[^>]*>(.*?)</a>.*?<span class="abstract"[^>]*>(.*?)</span>',
            html, re.DOTALL,
        )
        for path, title, snippet in results[:max_results]:
            title_clean = re.sub(r"<[^>]+>", "", title).strip()
            snippet_clean = re.sub(r"<[^>]+>", "", snippet).strip()
            if title_clean:
                hits.append(PriorArtHit(
                    title=title_clean[:200],
                    url=f"https://patents.google.com{path}",
                    snippet=snippet_clean[:300],
                    source="patent",
                ))
    except (aiohttp.ClientError, asyncio.TimeoutError):
        pass
    if not hits:
        return _fallback_search_hits(query, "patent", max_results)
    return hits


async def _academic_search(query: str, max_results: int = 5) -> list[PriorArtHit]:
    """Search Google Scholar via the public HTML endpoint."""
    if aiohttp is None:
        return _fallback_search_hits(query, "academic", max_results)
    url = f"https://scholar.google.com/scholar?q={quote_plus(query)}&num={max_results}"
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ChatSync/1.0"}
    hits = []
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as sess:
            async with sess.get(url, headers=headers) as resp:
                if resp.status != 200:
                    return _fallback_search_hits(query, "academic", max_results)
                html = await resp.text()
        results = re.findall(
            r'<h3[^>]*><a[^>]+href="([^"]+)"[^>]*>(.*?)</a></h3>.*?<div class="gs_rs">(.*?)</div>',
            html, re.DOTALL,
        )
        for url_str, title, snippet in results[:max_results]:
            title_clean = re.sub(r"<[^>]+>", "", title).strip()
            snippet_clean = re.sub(r"<[^>]+>", "", snippet).strip()
            if title_clean:
                hits.append(PriorArtHit(
                    title=title_clean[:200],
                    url=url_str[:500],
                    snippet=snippet_clean[:300],
                    source="academic",
                ))
    except (aiohttp.ClientError, asyncio.TimeoutError):
        pass
    if not hits:
        return _fallback_search_hits(query, "academic", max_results)
    return hits


def _assess_novelty(report: PriorArtReport) -> None:
    """Heuristically assess novelty from the collected hits."""
    all_hits = report.web_hits + report.patent_hits + report.academic_hits
    # Distinguish real parsed hits from fallback search-link hits.
    real_hits = [h for h in all_hits if "live scrape unavailable" not in h.snippet]
    fallback_hits = [h for h in all_hits if "live scrape unavailable" in h.snippet]
    total_real = len(real_hits)
    total_fallback = len(fallback_hits)

    # Collect existing product names from real web hit titles only.
    report.existing_products = [h.title for h in real_hits if h.source == "web"][:5]
    report.existing_patents = [h.title for h in real_hits if h.source == "patent"][:5]

    if total_real == 0 and total_fallback == 0:
        report.novelty_assessment = "novel"
        report.summary = "No prior art found. The concept appears unaddressed by existing products, patents, or academic work."
    elif total_real == 0 and total_fallback > 0:
        report.novelty_assessment = "partially novel"
        report.summary = (
            f"Live search was unavailable ({total_fallback} fallback search links generated). "
            f"Manual verification required — novelty cannot be confirmed automatically."
        )
    elif total_real <= 2:
        report.novelty_assessment = "novel"
        report.summary = f"Only {total_real} tangential hits found. The specific combination appears novel."
    elif total_real <= 5:
        report.novelty_assessment = "partially novel"
        report.summary = f"{total_real} related hits found. The core concept exists in adjacent form but the specific framing may be novel."
    else:
        report.novelty_assessment = "known"
        report.summary = f"{total_real} hits found across web, patent, and academic sources. The concept is well-addressed by existing work."


async def research_prior_art(bp: BusinessProcess) -> PriorArtReport:
    """Run full prior-art research for a single business process."""
    queries = _build_queries(bp)
    brave_key = os.environ.get("BRAVE_SEARCH_API_KEY", "")

    # Run all searches in parallel.
    web_task = _brave_search(queries["web"], brave_key) if brave_key else _ddg_search(queries["web"])
    patent_task = _patent_search(queries["patent"])
    academic_task = _academic_search(queries["academic"])

    web_hits, patent_hits, academic_hits = await asyncio.gather(
        web_task, patent_task, academic_task, return_exceptions=True
    )
    # Handle exceptions from gather.
    if isinstance(web_hits, Exception):
        web_hits = []
    if isinstance(patent_hits, Exception):
        patent_hits = []
    if isinstance(academic_hits, Exception):
        academic_hits = []

    report = PriorArtReport(
        process_id=bp.id,
        process_name=bp.name,
        query=queries["web"],
        web_hits=web_hits,
        patent_hits=patent_hits,
        academic_hits=academic_hits,
    )
    _assess_novelty(report)
    return report


async def research_all(processes: list[BusinessProcess], concurrency: int = 4) -> list[PriorArtReport]:
    """Research prior art for a list of processes with bounded concurrency."""
    sem = asyncio.Semaphore(concurrency)

    async def _bounded(bp: BusinessProcess) -> PriorArtReport:
        async with sem:
            return await research_prior_art(bp)

    return await asyncio.gather(*[_bounded(bp) for bp in processes])
