"""Real-time streaming data sources for pharma intelligence.

Like Binance WebSocket pushes market trades in real-time, this module
streams live healthcare/pharma events as they happen:

  1. FDA Adverse Events (FAERS)     — new safety reports as they're filed
  2. FDA Drug Recalls               — enforcement actions as they happen
  3. FDA Drug Labels                — new/updated prescribing info
  4. ClinicalTrials.gov             — new trial registrations, status changes
  5. PubMed                         — new publications as indexed
  6. NIH Reporter                   — new research grants
  7. NPI Registry                   — new/updated provider registrations

Each source polls its real API on an interval and emits events through
an async queue. WebSocket clients receive a live push of every new event.
The stream also auto-feeds the proprietary systems (trust signals from
adverse events, CI signals from competitor publications, defrag fragments
from new labels, etc.).
"""

from __future__ import annotations

import asyncio
import json
import urllib.request
import urllib.parse
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Callable, Optional
from uuid import uuid4


# ─────────────────────────────────────────────────────────────────────
# Event model
# ─────────────────────────────────────────────────────────────────────

@dataclass
class StreamEvent:
    """A single real-time event from a streaming source."""
    event_id: str = field(default_factory=lambda: str(uuid4()))
    source: str = ""              # "fda_adverse_events", "pubmed", etc.
    event_type: str = ""          # "new_adverse_event", "new_publication", etc.
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    data: dict[str, Any] = field(default_factory=dict)
    # Which proprietary systems should ingest this
    targets: list[str] = field(default_factory=list)  # ["trust", "ci", "defrag", ...]

    def to_json(self) -> str:
        return json.dumps(asdict(self), default=str)


# ─────────────────────────────────────────────────────────────────────
# Base streaming source — polls a real API, emits new items
# ─────────────────────────────────────────────────────────────────────

class StreamingSource:
    """Base class for a polling-based streaming source.

    Most pharma APIs don't offer WebSocket push (unlike Binance), so we
    poll on an interval and emit only NEW items that weren't seen before.
    This gives the same real-time feel — clients get pushed new events
    the moment they appear in the source API.

    Compliance: all sources must be free, public, no API key required.
    No scraped data, no paid/licensed data, no auth-gated endpoints.
    """

    def __init__(self, name: str, interval_seconds: float = 60.0,
                 api_url: str = "", license_required: str = "",
                 auth_required: bool = False):
        self.name = name
        self.interval = interval_seconds
        self.api_url = api_url
        self.license_required = license_required  # empty = free
        self.auth_required = auth_required
        self._seen_ids: set[str] = set()
        self._running = False
        self._queue: asyncio.Queue[StreamEvent] = asyncio.Queue()
        self.event_count = 0
        self.last_poll: str = ""
        self.last_error: str = ""

    async def poll(self) -> list[dict[str, Any]]:
        """Override: fetch latest items from the real API. Return list of raw items."""
        raise NotImplementedError

    def make_event(self, raw: dict[str, Any]) -> StreamEvent:
        """Override: convert a raw API item into a StreamEvent."""
        raise NotImplementedError

    def item_id(self, raw: dict[str, Any]) -> str:
        """Override: extract a unique ID from a raw item for dedup."""
        raise NotImplementedError

    async def run(self) -> None:
        """Main loop: poll → dedup → emit new events."""
        self._running = True
        while self._running:
            try:
                items = await self.poll()
                self.last_poll = datetime.now(timezone.utc).isoformat()
                for item in items:
                    item_id = self.item_id(item)
                    if item_id in self._seen_ids:
                        continue
                    self._seen_ids.add(item_id)
                    event = self.make_event(item)
                    await self._queue.put(event)
                    self.event_count += 1
            except Exception as e:
                self.last_error = str(e)
            await asyncio.sleep(self.interval)

    def stop(self) -> None:
        self._running = False

    async def events(self) -> AsyncIterator[StreamEvent]:
        """Yield events as they arrive."""
        while self._running or not self._queue.empty():
            try:
                event = await asyncio.wait_for(self._queue.get(), timeout=1.0)
                yield event
            except asyncio.TimeoutError:
                if not self._running:
                    break

    def status(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "running": self._running,
            "interval_seconds": self.interval,
            "events_emitted": self.event_count,
            "seen_items": len(self._seen_ids),
            "last_poll": self.last_poll,
            "last_error": self.last_error,
            "queue_size": self._queue.qsize(),
            "api_url": self.api_url,
            "free": not self.license_required,
            "license_required": self.license_required,
            "auth_required": self.auth_required,
            "api_key_required": False,
            "compliantly_sourced": not self.license_required and not self.auth_required,
        }


# ─────────────────────────────────────────────────────────────────────
# Real streaming sources
# ─────────────────────────────────────────────────────────────────────

def _fetch_json(url: str, timeout: int = 15) -> dict:
    """Fetch JSON from a real API (runs in thread executor)."""
    req = urllib.request.Request(url, headers={"User-Agent": "RxReserve/1.0"})
    resp = urllib.request.urlopen(req, timeout=timeout)
    return json.loads(resp.read().decode("utf-8", errors="ignore"))


class FDAAdverseEventStream(StreamingSource):
    """Stream new adverse events from FDA FAERS (openfda drug/event.json).

    20+ million records. We poll for the latest reports matching Gilead drugs
    and emit each new one as it appears. Each event feeds:
      - Trust Trajectory (negative signal for prescribing HCPs)
      - CI Agent (safety signal vs competitors)
    """

    GILEAD_DRUGS = [
        "Biktarvy", "Descovy", "Truvada", "Genvoya",
        "Trodelvy", "Yescarta", "Tecartus", "Veklury",
        "Harvoni", "Epclusa", "Vosevi", "Vemlidy",
    ]

    def __init__(self, interval: float = 300.0):
        super().__init__("fda_adverse_events", interval,
                         api_url="https://api.fda.gov/drug/event.json",
                         license_required="", auth_required=False)
        self._drug_index = 0

    async def poll(self) -> list[dict[str, Any]]:
        drug = self.GILEAD_DRUGS[self._drug_index % len(self.GILEAD_DRUGS)]
        self._drug_index += 1
        url = (
            f"https://api.fda.gov/drug/event.json?"
            f'search=patient.drug.openfda.brand_name:"{urllib.parse.quote(drug)}"'
            f"&limit=10&sort=receivedate:desc"
        )
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _fetch_json, url)
        results = data.get("results", [])
        for r in results:
            r["_drug_name"] = drug
        return results

    def item_id(self, raw: dict) -> str:
        return raw.get("safetyreportid", str(uuid4()))

    def make_event(self, raw: dict) -> StreamEvent:
        drug = raw.get("_drug_name", "unknown")
        reactions = []
        patient = raw.get("patient", {})
        for rxn in patient.get("reaction", []):
            reactions.append(rxn.get("reactionmeddrapt", ""))
        seriousness = raw.get("serious", "")
        country = raw.get("occurcountry", "")
        report_date = raw.get("receivedate", "")
        patient_sex = patient.get("patientsex", "")
        patient_age = patient.get("patientonsetage", 0)

        return StreamEvent(
            source="fda_adverse_events",
            event_type="new_adverse_event",
            data={
                "drug_name": drug,
                "safety_report_id": raw.get("safetyreportid", ""),
                "reactions": reactions,
                "seriousness": "serious" if seriousness == "1" else "non-serious",
                "country": country,
                "report_date": report_date,
                "patient_sex": patient_sex,
                "patient_age": patient_age,
            },
            targets=["trust", "ci", "measurement"],
        )


class FDADrugRecallStream(StreamingSource):
    """Stream drug enforcement actions (recalls) from FDA.

    Each recall feeds:
      - CI Agent (competitor recall = opportunity)
      - Trust Trajectory (our recall = negative signal)
      - Governance (compliance alert)
    """

    def __init__(self, interval: float = 600.0):
        super().__init__("fda_drug_recalls", interval,
                         api_url="https://api.fda.gov/drug/enforcement.json",
                         license_required="", auth_required=False)

    async def poll(self) -> list[dict[str, Any]]:
        url = (
            "https://api.fda.gov/drug/enforcement.json?"
            "limit=10&sort=recall_initiation_date:desc"
        )
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _fetch_json, url)
        return data.get("results", [])

    def item_id(self, raw: dict) -> str:
        return raw.get("recall_number", str(uuid4()))

    def make_event(self, raw: dict) -> StreamEvent:
        return StreamEvent(
            source="fda_drug_recalls",
            event_type="new_drug_recall",
            data={
                "recall_number": raw.get("recall_number", ""),
                "product_description": raw.get("product_description", ""),
                "reason_for_recall": raw.get("reason_for_recall", ""),
                "recalling_firm": raw.get("recalling_firm", ""),
                "status": raw.get("status", ""),
                "recall_initiation_date": raw.get("recall_initiation_date", ""),
                "classification": raw.get("classification", ""),
            },
            targets=["ci", "governance", "trust"],
        )


class FDADrugLabelStream(StreamingSource):
    """Stream new/updated drug labels from FDA.

    Each label update feeds:
      - Defrag Engine (ingest as knowledge fragment)
      - MSL Router (new evidence for medical questions)
    """

    GILEAD_DRUGS = [
        "Biktarvy", "Descovy", "Truvada", "Genvoya",
        "Trodelvy", "Yescarta", "Tecartus", "Veklury",
    ]

    def __init__(self, interval: float = 900.0):
        super().__init__("fda_drug_labels", interval,
                         api_url="https://api.fda.gov/drug/label.json",
                         license_required="", auth_required=False)
        self._drug_index = 0

    async def poll(self) -> list[dict[str, Any]]:
        drug = self.GILEAD_DRUGS[self._drug_index % len(self.GILEAD_DRUGS)]
        self._drug_index += 1
        url = (
            f"https://api.fda.gov/drug/label.json?"
            f'search=openfda.brand_name:"{urllib.parse.quote(drug)}"&limit=5'
        )
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _fetch_json, url)
        results = data.get("results", [])
        for r in results:
            r["_drug_name"] = drug
        return results

    def item_id(self, raw: dict) -> str:
        return raw.get("id", str(uuid4()))

    def make_event(self, raw: dict) -> StreamEvent:
        drug = raw.get("_drug_name", "unknown")
        openfda = raw.get("openfda", {})
        return StreamEvent(
            source="fda_drug_labels",
            event_type="new_drug_label",
            data={
                "drug_name": drug,
                "generic_name": ", ".join(openfda.get("generic_name", [])),
                "manufacturer": ", ".join(openfda.get("manufacturer_name", [])),
                "indications": raw.get("indications_and_usage", [""])[0][:500],
                "warnings": raw.get("warnings_and_cautions", [""])[0][:500],
                "contraindications": raw.get("contraindications", [""])[0][:500],
                "label_id": raw.get("id", ""),
            },
            targets=["defrag", "msl_router"],
        )


class ClinicalTrialsStream(StreamingSource):
    """Stream new/updated clinical trials from ClinicalTrials.gov.

    Each trial feeds:
      - CI Agent (competitor trial = threat signal)
      - MSL Router (new evidence)
      - Launch Analyzer (strategy input)
    """

    GILEAD_DRUGS = [
        "Biktarvy", "Descovy", "Trodelvy", "Yescarta",
        "Tecartus", "Veklury", "Vemlidy",
    ]
    COMPETITORS = ["cabotegravir", "dolutegravir", "doravirine", "lenacapavir"]

    def __init__(self, interval: float = 600.0):
        super().__init__("clinicaltrials_gov", interval,
                         api_url="https://clinicaltrials.gov/api/v2/studies",
                         license_required="", auth_required=False)
        self._query_index = 0

    async def poll(self) -> list[dict[str, Any]]:
        queries = self.GILEAD_DRUGS + self.COMPETITORS
        query = queries[self._query_index % len(queries)]
        self._query_index += 1
        url = (
            f"https://clinicaltrials.gov/api/v2/studies?"
            f"query.term={urllib.parse.quote(query)}&pageSize=5&format=json"
        )
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _fetch_json, url)
        studies = data.get("studies", [])
        for s in studies:
            s["_query_drug"] = query
        return studies

    def item_id(self, raw: dict) -> str:
        return raw.get("protocolSection", {}).get("identificationModule", {}).get("nctId", str(uuid4()))

    def make_event(self, raw: dict) -> StreamEvent:
        proto = raw.get("protocolSection", {})
        ident = proto.get("identificationModule", {})
        status_mod = proto.get("statusModule", {})
        sponsor = proto.get("sponsorCollaboratorsModule", {})
        design = proto.get("designModule", {})
        conditions = proto.get("conditionsModule", {}).get("conditions", [])
        interventions = proto.get("armsInterventionsModule", {}).get("interventions", [])

        query_drug = raw.get("_query_drug", "")
        is_competitor = query_drug in self.COMPETITORS

        return StreamEvent(
            source="clinicaltrials_gov",
            event_type="competitor_trial" if is_competitor else "gilead_trial",
            data={
                "nct_id": ident.get("nctId", ""),
                "title": ident.get("briefTitle", ""),
                "phase": design.get("phases", []),
                "status": status_mod.get("overallStatus", ""),
                "sponsor": sponsor.get("leadSponsor", {}).get("name", ""),
                "conditions": conditions,
                "interventions": [i.get("name", "") for i in interventions],
                "enrollment": design.get("enrollmentInfo", {}).get("count", 0),
                "start_date": status_mod.get("startDateStruct", {}).get("date", ""),
                "completion_date": status_mod.get("completionDateStruct", {}).get("date", ""),
                "query_drug": query_drug,
                "is_competitor": is_competitor,
            },
            targets=["ci", "msl_router", "analyzer"],
        )


class PubMedStream(StreamingSource):
    """Stream new publications from PubMed.

    Each publication feeds:
      - CI Agent (competitor publication = KOL signal)
      - MSL Router (new evidence)
      - Defrag Engine (knowledge fragment)
    """

    QUERIES = [
        "Biktarvy", "tenofovir alafenamide",
        "bictegravir", "cabotegravir",
        "lenacapavir HIV", "Trodelvy breast cancer",
    ]

    def __init__(self, interval: float = 600.0):
        super().__init__("pubmed", interval,
                         api_url="https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
                         license_required="", auth_required=False)
        self._query_index = 0

    async def poll(self) -> list[dict[str, Any]]:
        query = self.QUERIES[self._query_index % len(self.QUERIES)]
        self._query_index += 1

        # Step 1: eSearch to get PMIDs
        search_url = (
            f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?"
            f"db=pubmed&term={urllib.parse.quote(query)}&retmax=5&retmode=json&sort=date"
        )
        loop = asyncio.get_event_loop()
        search_data = await loop.run_in_executor(None, _fetch_json, search_url)
        pmids = search_data.get("esearchresult", {}).get("idlist", [])

        if not pmids:
            return []

        # Step 2: eSummary to get publication details
        summary_url = (
            f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?"
            f"db=pubmed&id={','.join(pmids)}&retmode=json"
        )
        summary_data = await loop.run_in_executor(None, _fetch_json, summary_url)
        results = []
        for pmid in pmids:
            info = summary_data.get("result", {}).get(pmid, {})
            if info:
                info["_query"] = query
                results.append(info)
        return results

    def item_id(self, raw: dict) -> str:
        return raw.get("uid", str(uuid4()))

    def make_event(self, raw: dict) -> StreamEvent:
        authors = [a.get("name", "") for a in raw.get("authors", [])[:5]]
        return StreamEvent(
            source="pubmed",
            event_type="new_publication",
            data={
                "pmid": raw.get("uid", ""),
                "title": raw.get("title", ""),
                "authors": authors,
                "journal": raw.get("fulljournalname", raw.get("source", "")),
                "publication_date": raw.get("pubdate", ""),
                "doi": raw.get("elocationid", ""),
                "query": raw.get("_query", ""),
            },
            targets=["ci", "msl_router", "defrag"],
        )


class NPIRegistryStream(StreamingSource):
    """Stream new/updated HCP registrations from NPI Registry.

    Each new HCP feeds:
      - Engagement Graph (new node)
      - Trust Trajectory (new trajectory initialized)
      - Access Engine (new access check)
      - CI Agent (new KOL to monitor)
    """

    SPECIALTIES = [
        "Infectious Disease", "Internal Medicine",
        "Hematology/Oncology", "Medical Oncology",
    ]

    def __init__(self, interval: float = 1800.0):
        super().__init__("npi_registry", interval,
                         api_url="https://npiregistry.cms.hhs.gov/api/",
                         license_required="", auth_required=False)
        self._spec_index = 0

    async def poll(self) -> list[dict[str, Any]]:
        specialty = self.SPECIALTIES[self._spec_index % len(self.SPECIALTIES)]
        self._spec_index += 1
        # NPI registry taxonomy code for infectious disease
        taxonomy_map = {
            "Infectious Disease": "207RI0200X",
            "Internal Medicine": "207R00000X",
            "Hematology/Oncology": "207RH0003X",
            "Medical Oncology": "207RX0202X",
        }
        code = taxonomy_map.get(specialty, "207R00000X")
        url = (
            f"https://npiregistry.cms.hhs.gov/api/?"
            f"taxonomy_code={code}&limit=5&version=2.1"
        )
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _fetch_json, url)
        results = data.get("results", [])
        for r in results:
            r["_specialty"] = specialty
        return results

    def item_id(self, raw: dict) -> str:
        return raw.get("number", str(uuid4()))

    def make_event(self, raw: dict) -> StreamEvent:
        addresses = raw.get("addresses", [])
        primary = addresses[0] if addresses else {}
        taxonomies = raw.get("taxonomies", [])
        primary_taxonomy = taxonomies[0] if taxonomies else {}

        return StreamEvent(
            source="npi_registry",
            event_type="new_hcp",
            data={
                "npi": raw.get("number", ""),
                "name": f"Dr. {raw.get('basic', {}).get('first_name', '')} {raw.get('basic', {}).get('last_name', '')}",
                "specialty": raw.get("_specialty", ""),
                "taxonomy_code": primary_taxonomy.get("code", ""),
                "state": primary.get("state", ""),
                "city": primary.get("city", ""),
                "address": f"{primary.get('address_1', '')}, {primary.get('city', '')}, {primary.get('state', '')} {primary.get('postal_code', '')}",
                "credential": raw.get("basic", {}).get("credential", ""),
            },
            targets=["engagement_graph", "trust", "access", "ci"],
        )


# ─────────────────────────────────────────────────────────────────────
# Stream Manager — runs all sources, fans out to WebSocket clients
# ─────────────────────────────────────────────────────────────────────

class StreamManager:
    """Manages all streaming sources and broadcasts events to WebSocket clients.

    Also auto-feeds events into the proprietary systems via a callback.
    This is the pharma equivalent of Binance's WebSocket — clients connect,
    subscribe, and receive a real-time push of every new event from every
    source.
    """

    def __init__(self):
        self.sources: dict[str, StreamingSource] = {}
        self._subscribers: set[asyncio.Queue[StreamEvent]] = set()
        self._tasks: list[asyncio.Task] = []
        self._running = False
        self._ingest_callback: Optional[Callable[[StreamEvent], None]] = None
        self._all_events: list[StreamEvent] = []  # ring buffer
        self._max_buffer = 10000

    def set_ingest_callback(self, callback: Callable[[StreamEvent], None]) -> None:
        """Set a callback to auto-ingest events into proprietary systems."""
        self._ingest_callback = callback

    def add_source(self, source: StreamingSource) -> None:
        self.sources[source.name] = source

    def subscribe(self) -> asyncio.Queue[StreamEvent]:
        """Subscribe to the event stream. Returns a queue to read from."""
        q: asyncio.Queue[StreamEvent] = asyncio.Queue(maxsize=1000)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[StreamEvent]) -> None:
        self._subscribers.discard(q)

    async def start(self) -> None:
        """Start all streaming sources and the broadcast loop."""
        if self._running:
            return
        self._running = True

        # Start each source
        for source in self.sources.values():
            task = asyncio.create_task(source.run())
            self._tasks.append(task)

        # Start broadcast loop
        asyncio.create_task(self._broadcast_loop())

    async def stop(self) -> None:
        """Stop all sources."""
        self._running = False
        for source in self.sources.values():
            source.stop()
        for task in self._tasks:
            task.cancel()
        self._tasks.clear()

    async def _broadcast_loop(self) -> None:
        """Collect events from all sources and fan out to subscribers."""
        while self._running:
            for source in self.sources.values():
                while not source._queue.empty():
                    try:
                        event = source._queue.get_nowait()
                        # Buffer
                        self._all_events.append(event)
                        if len(self._all_events) > self._max_buffer:
                            self._all_events = self._all_events[-self._max_buffer:]

                        # Auto-ingest into proprietary systems
                        if self._ingest_callback:
                            try:
                                self._ingest_callback(event)
                            except Exception:
                                pass  # don't let ingest errors kill the stream

                        # Fan out to subscribers
                        for sub in list(self._subscribers):
                            try:
                                sub.put_nowait(event)
                            except asyncio.QueueFull:
                                pass  # drop if subscriber is slow
                    except asyncio.QueueEmpty:
                        break
            await asyncio.sleep(0.1)

    def status(self) -> dict[str, Any]:
        return {
            "running": self._running,
            "sources": {name: s.status() for name, s in self.sources.items()},
            "subscribers": len(self._subscribers),
            "total_events_buffered": len(self._all_events),
            "sources_count": len(self.sources),
        }

    def recent_events(self, limit: int = 50) -> list[dict]:
        """Get recent events from the buffer."""
        return [asdict(e) for e in self._all_events[-limit:]]

    def events_by_source(self, source_name: str, limit: int = 50) -> list[dict]:
        """Get recent events from a specific source."""
        return [asdict(e) for e in self._all_events if e.source == source_name][-limit:]


# ─────────────────────────────────────────────────────────────────────
# Default stream manager with all real sources
# ─────────────────────────────────────────────────────────────────────

def create_default_stream_manager() -> StreamManager:
    """Create a StreamManager with all real pharma data sources."""
    mgr = StreamManager()
    mgr.add_source(FDAAdverseEventStream(interval=300))
    mgr.add_source(FDADrugRecallStream(interval=600))
    mgr.add_source(FDADrugLabelStream(interval=900))
    mgr.add_source(ClinicalTrialsStream(interval=600))
    mgr.add_source(PubMedStream(interval=600))
    mgr.add_source(NPIRegistryStream(interval=1800))
    return mgr
