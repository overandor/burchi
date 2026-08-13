"""Pharma data sources that require crawling (not API calls).

These are public-record datasets mandated by law to be publicly accessible,
but served as HTML pages, searchable databases, or downloadable files —
not as clean APIs. The crawler fetches and structures them.

Sources targeted:
  1. CMS Open Payments — manufacturer payments to physicians (Sunshine Act)
     URL: openpaymentsdata.cms.gov
     Public by federal law (Affordable Care Act §6002)

  2. FDA Orange Book — approved drug products with therapeutic equivalence
     URL: accessdata.fda.gov/scripts/cder/ob
     Public by federal law

  3. FDA Purple Book — biological products and biosimilars
     URL: purplebooksearch.fda.gov
     Public by federal law

  4. NIH RePORTER — federally funded research grants
     URL: reporter.nih.gov
     Public by federal law

  5. 340B Drug Pricing Program — covered entities and drug utilization
     URL: 340bopais.hrsa.gov
     Public by federal law

  6. State Medicaid Drug Utilization — state-level prescribing data
     URL: medicaid.gov/medicaid/prescription-drugs
     Public by federal law

  7. FDA Drug Shortages database
     URL: accessdata.fda.gov/scripts/drugshortages
     Public by federal law

  8. DEA Diversion Control — controlled substance registrants (public registry)
     URL: deadiversion.usdoj.gov
     Public record

All of these are government-mandated public data. No authentication required.
No terms of service prohibiting scraping. This is the permissionless layer.

Extension points:
  - Add Playwright JS-rendered page support for databases that require
    form submission (FDA Orange Book search, CMS Open Payments search)
  - Add PDF parsing for FDA labeling supplements posted as PDFs
  - Add incremental crawl (only fetch records updated since last crawl)
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterator, Optional
from urllib.parse import urljoin, urlparse, quote_plus

import httpx

logger = logging.getLogger(__name__)


@dataclass
class CrawledRecord:
    """A single structured record extracted from a crawled page."""
    source: str = ""
    record_type: str = ""  # payment, drug_approval, shortage, grant, etc.
    raw_html: str = ""
    extracted_fields: dict[str, Any] = field(default_factory=dict)
    source_url: str = ""
    crawled_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    record_id: str = ""


class PharmaCrawler:
    """Crawler for public-record pharma data sources.

    Uses httpx for static pages, falls back to Playwright for JS-rendered
    databases. Respects crawl delays. No authentication bypass. No PII
    harvesting from health systems. Only government-mandated public data.
    """

    def __init__(self, timeout: float = 30.0, crawl_delay: float = 1.0):
        self.client = httpx.Client(
            timeout=timeout,
            headers={"User-Agent": "RxReserve-PharmaCrawler/1.0 (public data research)"},
            follow_redirects=True,
        )
        self.crawl_delay = crawl_delay
        self._pw_available: Optional[bool] = None

    def close(self):
        self.client.close()

    def _try_playwright(self) -> bool:
        if self._pw_available is None:
            try:
                import playwright  # noqa: F401
                self._pw_available = True
            except Exception:
                self._pw_available = False
        return self._pw_available

    def _fetch_static(self, url: str, params: dict = None) -> str:
        """Fetch a static HTML page."""
        try:
            r = self.client.get(url, params=params)
            r.raise_for_status()
            return r.text
        except Exception as e:
            logger.error(f"Fetch {url}: {e}")
            return ""

    def _fetch_js(self, url: str, wait_selector: str = "") -> str:
        """Fetch a JS-rendered page using Playwright."""
        if not self._try_playwright():
            return self._fetch_static(url)

        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page()
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
                if wait_selector:
                    try:
                        page.wait_for_selector(wait_selector, timeout=10000)
                    except Exception:
                        pass
                html = page.content()
                browser.close()
                return html
        except Exception as e:
            logger.error(f"Playwright fetch {url}: {e}")
            return self._fetch_static(url)

    # ═══════════════════════════════════════════════════════════════════
    # 1. CMS Open Payments — manufacturer-to-physician payments
    # ═══════════════════════════════════════════════════════════════════

    def crawl_open_payments(self, physician_npi: str = "",
                            year: str = "2023",
                            limit: int = 50) -> list[CrawledRecord]:
        """Crawl CMS Open Payments data.

        The Sunshine Act (ACA §6002) mandates that all payments from
        drug/device manufacturers to physicians/teaching hospitals be
        publicly reported. This is the single most valuable public dataset
        for understanding pharma-HCP financial relationships.

        Data is available as:
          - Searchable web database (openpaymentsdata.cms.gov)
          - Bulk downloadable CSV files
          - API (but with severe rate limits and incomplete coverage)

        We crawl the search interface for targeted queries.
        """
        records = []

        # CMS Open Payments search URL
        base = "https://openpaymentsdata.cms.gov"
        search_url = f"{base}/search"

        # Try the API first (it's public, just rate-limited)
        api_url = f"{base}/api/1/metastore/schemas/dataset/items"
        try:
            r = self.client.get(api_url, params={"limit": 5}, timeout=15)
            if r.status_code == 200:
                datasets = r.json()
                if isinstance(datasets, list):
                    for ds in datasets[:5]:
                        records.append(CrawledRecord(
                            source="cms_open_payments",
                            record_type="dataset_metadata",
                            extracted_fields={
                                "dataset_id": ds.get("identifier", ""),
                                "title": ds.get("title", ""),
                                "description": (ds.get("description", "") or "")[:500],
                                "keyword": ds.get("keyword", []),
                            },
                            source_url=f"{base}/dataset/{ds.get('identifier', '')}",
                        ))
        except Exception as e:
            logger.warning(f"Open Payments API: {e}")

        # If we have an NPI, search for that physician's payments
        if physician_npi:
            time.sleep(self.crawl_delay)
            # The search page is JS-rendered
            html = self._fetch_js(
                f"{base}/search?npi={physician_npi}&year={year}",
                wait_selector="[data-testid='search-results']"
            )
            if html:
                # Parse payment records from the search results
                records.extend(self._parse_open_payments_html(html, physician_npi))

        return records[:limit]

    def _parse_open_payments_html(self, html: str, npi: str) -> list[CrawledRecord]:
        """Parse Open Payments search results from HTML."""
        records = []
        # Look for payment record patterns in the HTML
        # The CMS site renders records as structured data
        payment_patterns = re.findall(
            r'(?:amount|payment)["\']?\s*[:=]\s*["\']?\$?([\d,]+\.?\d*)',
            html, re.I
        )
        physician_patterns = re.findall(
            r'(?:physician|recipient)["\']?\s*[:=]\s*["\']?([^"\',}]+)',
            html, re.I
        )

        for i, amount in enumerate(payment_patterns[:20]):
            physician = physician_patterns[i] if i < len(physician_patterns) else ""
            records.append(CrawledRecord(
                source="cms_open_payments",
                record_type="payment",
                record_id=f"op_{npi}_{i}",
                extracted_fields={
                    "npi": npi,
                    "amount": float(amount.replace(",", "")),
                    "physician_name": physician.strip(),
                    "year": "2023",
                },
                raw_html=html[:500] if i == 0 else "",
            ))
        return records

    # ═══════════════════════════════════════════════════════════════════
    # 2. FDA Orange Book — approved drug products
    # ═══════════════════════════════════════════════════════════════════

    def crawl_orange_book(self, drug_name: str = "",
                          active_ingredient: str = "",
                          limit: int = 20) -> list[CrawledRecord]:
        """Crawl FDA Orange Book for approved drug products.

        The Orange Book contains:
          - Approved prescription drugs with therapeutic equivalence evaluations
          - Patent expiration dates
          - Exclusivity expiration dates
          - ANDA approvals (generics)

        This data is public by federal law (Hatch-Waxman Act).

        The Orange Book web interface requires POST + session cookies, so we
        use the OpenFDA NDC endpoint (same underlying data, public API) as
        the primary source, and fall back to the Orange Book search page.
        """
        records = []

        # Primary: OpenFDA NDC API (same approval data, public)
        search_term = drug_name or active_ingredient
        if search_term:
            try:
                url = f"https://api.fda.gov/drug/ndc.json"
                params = {
                    "search": f'brand_name:"{search_term}"',
                    "limit": min(limit, 100),
                }
                r = self.client.get(url, params=params, timeout=15)
                if r.status_code == 200:
                    results = r.json().get("results", [])
                    for res in results:
                        openfda = res.get("openfda", {})
                        records.append(CrawledRecord(
                            source="fda_orange_book",
                            record_type="drug_approval",
                            record_id=f"ndc_{res.get('product_ndc', '')}",
                            extracted_fields={
                                "brand_name": (openfda.get("brand_name", [""])[0] if openfda.get("brand_name") else ""),
                                "generic_name": (openfda.get("generic_name", [""])[0] if openfda.get("generic_name") else ""),
                                "manufacturer": (openfda.get("manufacturer_name", [""])[0] if openfda.get("manufacturer_name") else ""),
                                "route": (openfda.get("route", [""])[0] if openfda.get("route") else ""),
                                "product_ndc": res.get("product_ndc", ""),
                                "product_type": res.get("product_type_name", ""),
                                "marketing_category": res.get("marketing_category", ""),
                                "dosage_form": res.get("dosage_form_name", ""),
                                "start_marketing_date": res.get("start_marketing_date", ""),
                                "application_number": (openfda.get("application_number", [""])[0] if openfda.get("application_number") else ""),
                            },
                            source_url=f"https://www.accessdata.fda.gov/scripts/cder/ob/search_product.cfm?drugname={search_term}",
                        ))
                        if len(records) >= limit:
                            break
            except Exception as e:
                logger.error(f"OpenFDA NDC: {e}")

        # Fallback: try the Orange Book search page directly
        if not records and search_term:
            time.sleep(self.crawl_delay)
            try:
                url = f"https://www.accessdata.fda.gov/scripts/cder/ob/search_product.cfm"
                html = self._fetch_static(url, params={"drugname": search_term})
                if html:
                    records = self._parse_orange_book_html(html, search_term)
            except Exception as e:
                logger.warning(f"Orange Book page: {e}")

        return records[:limit]

    def _parse_orange_book_html(self, html: str, drug: str) -> list[CrawledRecord]:
        """Parse Orange Book search results from HTML."""
        records = []
        # Look for table rows with drug approval data
        rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.S)
        for row in rows[1:20]:  # skip header
            cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
            if len(cells) >= 5:
                clean_cells = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]
                records.append(CrawledRecord(
                    source="fda_orange_book",
                    record_type="drug_approval",
                    extracted_fields={
                        "active_ingredient": clean_cells[0] if len(clean_cells) > 0 else "",
                        "form": clean_cells[1] if len(clean_cells) > 1 else "",
                        "strength": clean_cells[2] if len(clean_cells) > 2 else "",
                        "applicant": clean_cells[3] if len(clean_cells) > 3 else "",
                        "approval_date": clean_cells[4] if len(clean_cells) > 4 else "",
                    },
                ))
        return records

    # ═══════════════════════════════════════════════════════════════════
    # 3. NIH RePORTER — federally funded research grants
    # ═══════════════════════════════════════════════════════════════════

    def crawl_nih_reporter(self, query: str = "HIV PrEP",
                           limit: int = 20) -> list[CrawledRecord]:
        """Crawl NIH RePORTER for federally funded research grants.

        NIH RePORTER has a public API but it's often easier to crawl the
        search results page for complex queries. The API has a 50 req/min
        rate limit and complex query syntax.

        We use the API when possible, fall back to crawling.
        """
        records = []
        api_url = "https://api.reporter.nih.gov/v2/projects/search"

        try:
            payload = {
                "criteria": {
                    "text": query,
                    "fiscal_years": [2023, 2024],
                },
                "offset": 0,
                "limit": min(limit, 100),
                "sort_field": "project_start_date",
                "sort_order": "desc",
            }
            r = self.client.post(api_url, json=payload, timeout=30)
            r.raise_for_status()
            data = r.json()
            results = data.get("results", [])

            for proj in results:
                # NIH RePORTER v2 returns flat fields, not nested under "project"
                pi_names = [p.get("full_name", "") for p in proj.get("principal_investigators", [])]
                if not pi_names and proj.get("contact_pi_name"):
                    pi_names = [proj["contact_pi_name"]]
                agency_obj = proj.get("agency_ic_admin", {})
                agency = agency_obj.get("name", "") if isinstance(agency_obj, dict) else str(agency_obj)
                org_obj = proj.get("organization", {})
                org = org_obj.get("org_name", "") if isinstance(org_obj, dict) else str(org_obj)
                title = proj.get("project_title", "")
                abstract = proj.get("abstract_text", "")[:500]
                funding = proj.get("award_amount", 0)
                start = proj.get("project_start_date", "")
                end = proj.get("project_end_date", "")
                appl_id = proj.get("appl_id", "")

                records.append(CrawledRecord(
                    source="nih_reporter",
                    record_type="research_grant",
                    record_id=str(appl_id),
                    extracted_fields={
                        "project_num": proj.get("project_num", ""),
                        "title": title,
                        "pi_names": pi_names,
                        "agency": agency,
                        "organization": org,
                        "award_amount": funding,
                        "start_date": start,
                        "end_date": end,
                        "abstract": abstract,
                        "fiscal_year": proj.get("fiscal_year", ""),
                    },
                    source_url=f"https://reporter.nih.gov/project-details/{appl_id}",
                ))
        except Exception as e:
            logger.error(f"NIH RePORTER: {e}")
            # Fall back to crawling the search page
            time.sleep(self.crawl_delay)
            html = self._fetch_js(
                f"https://reporter.nih.gov/search/{quote_plus(query)}/projects",
                wait_selector=".search-results"
            )
            if html:
                records = self._parse_reporter_html(html, query)

        return records[:limit]

    def _parse_reporter_html(self, html: str, query: str) -> list[CrawledRecord]:
        """Parse NIH RePORTER search results from HTML."""
        records = []
        # Extract project titles and IDs from the search results
        titles = re.findall(r'<h[23][^>]*>(.*?)</h[23]>', html, re.S)
        for title in titles[:20]:
            clean = re.sub(r'<[^>]+>', '', title).strip()
            if clean and len(clean) > 10:
                records.append(CrawledRecord(
                    source="nih_reporter",
                    record_type="research_grant",
                    extracted_fields={"title": clean, "query": query},
                ))
        return records

    # ═══════════════════════════════════════════════════════════════════
    # 4. FDA Drug Shortages
    # ═══════════════════════════════════════════════════════════════════

    def crawl_drug_shortages(self, limit: int = 50) -> list[CrawledRecord]:
        """Crawl FDA Drug Shortages database.

        Drug shortages are public health emergencies. FDA maintains a
        public database of current and resolved shortages. This data
        directly impacts:
          - Access problems (Trust Trajectory signal)
          - Market access routing (MSL Router)
          - Territory prioritization (Territory-as-Code)
        """
        records = []
        url = "https://www.accessdata.fda.gov/scripts/drugshortages/default.cfm"

        try:
            html = self._fetch_static(url)
            if not html:
                html = self._fetch_js(url)

            if html:
                # Parse shortage records
                # FDA lists shortages in a table format
                rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.S)
                for row in rows[1:limit]:
                    cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
                    if len(cells) >= 3:
                        clean = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]
                        records.append(CrawledRecord(
                            source="fda_drug_shortages",
                            record_type="drug_shortage",
                            extracted_fields={
                                "drug_name": clean[0] if len(clean) > 0 else "",
                                "status": clean[1] if len(clean) > 1 else "",
                                "reason": clean[2] if len(clean) > 2 else "",
                                "date": clean[3] if len(clean) > 3 else "",
                            },
                            source_url=url,
                        ))
        except Exception as e:
            logger.error(f"Drug shortages crawl: {e}")

        return records[:limit]

    # ═══════════════════════════════════════════════════════════════════
    # 5. State Medicaid Drug Utilization
    # ═══════════════════════════════════════════════════════════════════

    def crawl_medicaid_drug_utilization(self, state: str = "CA",
                                        year: str = "2023",
                                        limit: int = 50) -> list[CrawledRecord]:
        """Crawl state Medicaid drug utilization data.

        Medicaid drug utilization data shows:
          - Number of prescriptions by drug
          - Total spending by drug
          - Number of utilizers
          - State-level prescribing patterns

        This is public by federal law (Medicaid Drug Rebate Program).
        Available as downloadable CSV/Excel files from Medicaid.gov.
        """
        records = []
        base = "https://www.medicaid.gov"

        # Medicaid drug utilization data is published as downloadable files
        # The state drug utilization data page links to quarterly files
        url = f"{base}/medicaid/prescription-drugs/state-drug-utilization-data/index.html"

        try:
            html = self._fetch_static(url)
            if html:
                # Find download links for state-specific data
                links = re.findall(r'href=["\']([^"\']*drug.util[^"\']*)["\']', html, re.I)
                for link in links[:limit]:
                    abs_url = urljoin(url, link)
                    if state.lower() in abs_url.lower() or year in abs_url:
                        records.append(CrawledRecord(
                            source="medicaid_drug_utilization",
                            record_type="data_file_link",
                            extracted_fields={
                                "state": state,
                                "year": year,
                                "file_url": abs_url,
                            },
                            source_url=abs_url,
                        ))
        except Exception as e:
            logger.error(f"Medicaid drug utilization: {e}")

        return records[:limit]

    # ═══════════════════════════════════════════════════════════════════
    # 6. 340B Drug Pricing Program
    # ═══════════════════════════════════════════════════════════════════

    def crawl_340b_covered_entities(self, state: str = "",
                                    limit: int = 50) -> list[CrawledRecord]:
        """Crawl 340B covered entities database.

        The 340B program requires drug manufacturers to provide discounted
        drugs to safety-net providers. The covered entities database shows
        which hospitals/clinics participate — directly relevant to access
        routing and territory planning.
        """
        records = []
        base = "https://340bopais.hrsa.gov"

        try:
            # The 340B database is a searchable web interface
            search_url = f"{base}/coveredentitysearch"
            params = {}
            if state:
                params["state"] = state

            html = self._fetch_js(search_url, wait_selector=".results-table")
            if html:
                rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.S)
                for row in rows[1:limit]:
                    cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
                    if len(cells) >= 3:
                        clean = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]
                        records.append(CrawledRecord(
                            source="340b_covered_entities",
                            record_type="covered_entity",
                            extracted_fields={
                                "entity_name": clean[0] if len(clean) > 0 else "",
                                "city": clean[1] if len(clean) > 1 else "",
                                "state": clean[2] if len(clean) > 2 else "",
                                "entity_type": clean[3] if len(clean) > 3 else "",
                            },
                            source_url=search_url,
                        ))
        except Exception as e:
            logger.error(f"340B crawl: {e}")

        return records[:limit]

    # ═══════════════════════════════════════════════════════════════════
    # Enrichment: feed crawled data into proprietary systems
    # ═══════════════════════════════════════════════════════════════════

    def enrich_trust_with_payments(self, trust_model, hcp_npi: str,
                                   hcp_id: str) -> dict:
        """Enrich HCP Trust Trajectory with real Open Payments data.

        If an HCP is receiving significant payments from a manufacturer,
        that's a trust signal — they have a financial relationship.
        If payments suddenly stopped, that's a different signal.
        """
        payments = self.crawl_open_payments(physician_npi=hcp_npi, limit=20)
        stats = {"payments_found": 0, "total_amount": 0.0, "signals_added": 0}

        for record in payments:
            if record.record_type != "payment":
                continue
            amount = record.extracted_fields.get("amount", 0)
            stats["payments_found"] += 1
            stats["total_amount"] += amount

            # Payment is a trust signal — financial relationship
            trust_model.add_signal(
                hcp_id=hcp_id,
                signal_type="positive_interaction",
                source="cms_open_payments",
                description=f"Manufacturer payment: ${amount:,.2f}",
            )
            stats["signals_added"] += 1

        return stats

    def enrich_defrag_with_shortages(self, engine) -> dict:
        """Enrich Defragmentation Engine with real drug shortage data."""
        from rxreserve.proprietary import FragmentType
        shortages = self.crawl_drug_shortages(limit=30)
        stats = {"shortages_crawled": 0, "fragments_added": 0}

        for record in shortages:
            fields = record.extracted_fields
            content = f"DRUG SHORTAGE: {fields.get('drug_name', '')}\n"
            content += f"STATUS: {fields.get('status', '')}\n"
            content += f"REASON: {fields.get('reason', '')}\n"
            content += f"DATE: {fields.get('date', '')}\n"

            engine.ingest_fragment(
                FragmentType.DOCUMENT,
                f"fda:shortage:{record.record_id}",
                content,
            )
            stats["shortages_crawled"] += 1
            stats["fragments_added"] += 1

        engine.process_all()
        return stats

    def enrich_territory_with_340b(self, tac, territory_id: str,
                                   state: str, rep_id: str) -> dict:
        """Enrich Territory-as-Code with 340B covered entities.

        340B entities are safety-net providers — they should be prioritized
        in territory planning because they serve underserved populations.
        """
        entities = self.crawl_340b_covered_entities(state=state, limit=50)
        stats = {"entities_found": 0, "added_to_territory": 0}

        # Get current territory
        current = tac.get_active(territory_id)
        current_hcps = current.hcp_assignments if current else []
        existing_ids = {h["hcp_id"] for h in current_hcps}

        new_assignments = list(current_hcps)
        for entity in entities:
            if entity.record_type != "covered_entity":
                continue
            entity_name = entity.extracted_fields.get("entity_name", "")
            entity_id = f"340B_{entity.record_id}"

            if entity_id not in existing_ids:
                new_assignments.append({
                    "hcp_id": entity_id,
                    "priority": "high",  # 340B entities are high priority
                    "target_visits": 2,
                    "is_340b": True,
                    "entity_name": entity_name,
                })
                stats["added_to_territory"] += 1
            stats["entities_found"] += 1

        if stats["added_to_territory"] > 0:
            tac.define_territory(
                territory_id, rep_id, new_assignments,
                commit_message=f"Added {stats['added_to_territory']} 340B entities from {state}",
            )

        return stats

    # ═══════════════════════════════════════════════════════════════════
    # Full crawl pipeline
    # ═══════════════════════════════════════════════════════════════════

    def crawl_all(self, drug_name: str = "Biktarvy",
                  hcp_npi: str = "",
                  state: str = "CA") -> dict:
        """Run the full crawl pipeline across all sources."""
        results = {}

        logger.info("Crawling CMS Open Payments...")
        results["open_payments"] = len(self.crawl_open_payments(
            physician_npi=hcp_npi, limit=10))
        time.sleep(self.crawl_delay)

        logger.info("Crawling FDA Orange Book...")
        results["orange_book"] = len(self.crawl_orange_book(
            drug_name=drug_name, limit=10))
        time.sleep(self.crawl_delay)

        logger.info("Crawling NIH RePORTER...")
        results["nih_reporter"] = len(self.crawl_nih_reporter(
            query=drug_name, limit=10))
        time.sleep(self.crawl_delay)

        logger.info("Crawling FDA Drug Shortages...")
        results["drug_shortages"] = len(self.crawl_drug_shortages(limit=20))
        time.sleep(self.crawl_delay)

        logger.info("Crawling Medicaid Drug Utilization...")
        results["medicaid"] = len(self.crawl_medicaid_drug_utilization(
            state=state, limit=10))
        time.sleep(self.crawl_delay)

        logger.info("Crawling 340B Covered Entities...")
        results["340b"] = len(self.crawl_340b_covered_entities(
            state=state, limit=20))

        return results

    def sources_summary(self) -> dict:
        """Return all crawlable public pharma data sources."""
        return {
            "sources": {
                "cms_open_payments": {
                    "url": "https://openpaymentsdata.cms.gov",
                    "mandate": "Affordable Care Act §6002 (Sunshine Act)",
                    "data": "manufacturer payments to physicians",
                    "auth_required": False,
                    "js_rendered": True,
                },
                "fda_orange_book": {
                    "url": "https://www.accessdata.fda.gov/scripts/cder/ob",
                    "mandate": "Hatch-Waxman Act",
                    "data": "approved drug products, patent/expclusivity dates",
                    "auth_required": False,
                    "js_rendered": False,
                },
                "nih_reporter": {
                    "url": "https://reporter.nih.gov",
                    "mandate": "NIH Reform Act",
                    "data": "federally funded research grants",
                    "auth_required": False,
                    "js_rendered": True,
                },
                "fda_drug_shortages": {
                    "url": "https://www.accessdata.fda.gov/scripts/drugshortages",
                    "mandate": "FDA Safety and Innovation Act",
                    "data": "current and resolved drug shortages",
                    "auth_required": False,
                    "js_rendered": False,
                },
                "medicaid_drug_utilization": {
                    "url": "https://www.medicaid.gov/medicaid/prescription-drugs",
                    "mandate": "Medicaid Drug Rebate Program",
                    "data": "state-level prescribing patterns and spending",
                    "auth_required": False,
                    "js_rendered": False,
                },
                "340b_covered_entities": {
                    "url": "https://340bopais.hrsa.gov",
                    "mandate": "Veterans Health Care Act §340B",
                    "data": "safety-net providers participating in 340B",
                    "auth_required": False,
                    "js_rendered": True,
                },
            },
            "legal_basis": "All sources are federal-mandated public data. "
                          "HiQ v. LinkedIn (9th Cir.) established that "
                          "scraping public web data is not a CFAA violation.",
            "no_auth_bypass": True,
            "no_pii_harvesting": True,
        }
