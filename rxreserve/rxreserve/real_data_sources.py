"""Real public data sources for enriching the proprietary systems.

These are the actual data sources Gilead's ecosystem uses that are publicly
accessible with no API key:

  1. OpenFDA (api.fda.gov) — drug labels, adverse event reports (FAERS)
  2. ClinicalTrials.gov v2 API — Gilead-sponsored clinical trials
  3. NPPES NPI Registry (npiregistry.cms.hhs.gov) — real healthcare providers
  4. PubMed E-utilities (eutils.ncbi.nlm.nih.gov) — published clinical evidence
  5. RxNorm/RxClass (rxnav.nlm.nih.gov) — drug therapeutic classifications

Usage:
    from rxreserve.real_data_sources import RealDataSources
    rds = RealDataSources()
    labels = rds.fetch_drug_labels("Biktarvy")
    trials = rds.fetch_clinical_trials(sponsor="Gilead", condition="HIV")
    hcps = rds.fetch_real_hcps(specialty="Infectious Disease", state="CA")
    evidence = rds.fetch_pubmed_evidence("Biktarvy efficacy")
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

import httpx

logger = logging.getLogger(__name__)

# Gilead's actual drug portfolio (publicly known)
GILEAD_DRUGS = [
    "Biktarvy", "Descovy", "Truvada", "Genvoya", "Complera",
    "Stribild", "Vemlidy", "Harvoni", "Epclusa", "Vosevi",
    "Trodelvy", "Yescarta", "Tecartus", "Veklury",
]

GILEAD_THERAPEUTIC_AREAS = {
    "HIV": ["Biktarvy", "Descovy", "Truvada", "Genvoya", "Complera", "Stribild"],
    "PrEP": ["Descovy", "Truvada"],
    "HCV": ["Harvoni", "Epclusa", "Vosevi"],
    "HBV": ["Vemlidy"],
    "Oncology": ["Trodelvy", "Yescarta", "Tecartus"],
    "COVID-19": ["Veklury"],
}

OPENFDA_BASE = "https://api.fda.gov"
CTGOV_BASE = "https://clinicaltrials.gov/api/v2"
NPI_BASE = "https://npiregistry.cms.hhs.gov/api/"
PUBMED_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
RXNORM_BASE = "https://rxnav.nlm.nih.gov/REST"


@dataclass
class DrugLabel:
    """Real FDA drug label data from OpenFDA."""
    drug_name: str = ""
    generic_name: str = ""
    manufacturer: str = ""
    route: str = ""
    indications: str = ""
    warnings: str = ""
    adverse_reactions: str = ""
    contraindications: str = ""
    dosage: str = ""
    label_id: str = ""


@dataclass
class AdverseEventReport:
    """Real adverse event report from OpenFDA FAERS."""
    drug_name: str = ""
    reaction: str = ""
    seriousness: str = ""
    patient_age: float = 0.0
    patient_sex: str = ""
    report_date: str = ""
    country: str = ""
    safety_report_id: str = ""


@dataclass
class ClinicalTrial:
    """Real clinical trial from ClinicalTrials.gov."""
    nct_id: str = ""
    title: str = ""
    phase: str = ""
    status: str = ""
    sponsor: str = ""
    conditions: list[str] = field(default_factory=list)
    interventions: list[str] = field(default_factory=list)
    enrollment: int = 0
    start_date: str = ""
    completion_date: str = ""
    primary_outcome: str = ""
    locations: list[dict] = field(default_factory=list)
    study_type: str = ""


@dataclass
class RealHCP:
    """Real healthcare provider from NPPES NPI Registry."""
    npi: str = ""
    name: str = ""
    specialty: str = ""
    state: str = ""
    city: str = ""
    address: str = ""
    credential: str = ""
    taxonomy_code: str = ""


@dataclass
class PubMedEvidence:
    """Real published evidence from PubMed."""
    pmid: str = ""
    title: str = ""
    authors: list[str] = field(default_factory=list)
    journal: str = ""
    publication_date: str = ""
    abstract: str = ""
    doi: str = ""


class RealDataSources:
    """Unified interface to real public data sources.

    All methods hit live public APIs. No mock data. No API keys required.
    """

    def __init__(self, timeout: float = 30.0):
        self.client = httpx.Client(timeout=timeout)
        self._rate_limit_delay = 0.3  # courtesy delay between calls

    def close(self):
        self.client.close()

    # ─── OpenFDA ───

    def fetch_drug_labels(self, drug_name: str, limit: int = 3) -> list[DrugLabel]:
        """Fetch real FDA drug labels from OpenFDA."""
        url = f"{OPENFDA_BASE}/drug/label.json"
        params = {
            "search": f'openfda.brand_name:"{drug_name}"',
            "limit": limit,
        }
        try:
            r = self.client.get(url, params=params)
            r.raise_for_status()
            results = r.json().get("results", [])
            labels = []
            for res in results:
                openfda = res.get("openfda", {})
                labels.append(DrugLabel(
                    drug_name=drug_name,
                    generic_name=(openfda.get("generic_name", [""])[0] if openfda.get("generic_name") else ""),
                    manufacturer=(openfda.get("manufacturer_name", [""])[0] if openfda.get("manufacturer_name") else ""),
                    route=(openfda.get("route", [""])[0] if openfda.get("route") else ""),
                    indications=(res.get("indications_and_usage", [""])[0][:1000] if res.get("indications_and_usage") else ""),
                    warnings=(res.get("warnings_and_cautions", [""])[0][:500] if res.get("warnings_and_cautions") else ""),
                    adverse_reactions=(res.get("adverse_reactions", [""])[0][:500] if res.get("adverse_reactions") else ""),
                    contraindications=(res.get("contraindications", [""])[0][:500] if res.get("contraindications") else ""),
                    dosage=(res.get("dosage_and_administration", [""])[0][:500] if res.get("dosage_and_administration") else ""),
                    label_id=res.get("id", ""),
                ))
            return labels
        except Exception as e:
            logger.error(f"OpenFDA labels {drug_name}: {e}")
            return []

    def fetch_adverse_events(self, drug_name: str, limit: int = 25) -> list[AdverseEventReport]:
        """Fetch real adverse event reports from OpenFDA FAERS."""
        url = f"{OPENFDA_BASE}/drug/event.json"
        params = {
            "search": f'patient.drug.openfda.brand_name:"{drug_name}"',
            "limit": limit,
        }
        try:
            r = self.client.get(url, params=params)
            r.raise_for_status()
            results = r.json().get("results", [])
            events = []
            for res in results:
                patient = res.get("patient", {})
                reactions = patient.get("reaction", [])
                drug_entries = patient.get("drug", [])

                # Get primary reaction
                reaction_term = reactions[0].get("reactionmeddrapt", "") if reactions else ""

                # Seriousness
                serious = res.get("serious", "0")
                seriousness = "serious" if serious == "1" else "non-serious"

                # Patient info
                age = 0.0
                age_group = patient.get("patientagegroup", "")
                if age_group:
                    try:
                        age = float(age_group)
                    except (ValueError, TypeError):
                        pass

                sex_code = patient.get("patientsex", "")
                sex = "M" if sex_code == "1" else "F" if sex_code == "2" else ""

                events.append(AdverseEventReport(
                    drug_name=drug_name,
                    reaction=reaction_term,
                    seriousness=seriousness,
                    patient_age=age,
                    patient_sex=sex,
                    report_date=res.get("receiptdate", ""),
                    country=res.get("occurcountry", ""),
                    safety_report_id=res.get("safetyreportid", ""),
                ))
            return events
        except Exception as e:
            logger.error(f"OpenFDA events {drug_name}: {e}")
            return []

    # ─── ClinicalTrials.gov ───

    def fetch_clinical_trials(self, sponsor: str = "Gilead",
                              condition: str = "",
                              limit: int = 20) -> list[ClinicalTrial]:
        """Fetch real clinical trials from ClinicalTrials.gov v2 API."""
        url = f"{CTGOV_BASE}/studies"
        params = {
            "query.spons": sponsor,
            "pageSize": min(limit, 100),
            "format": "json",
        }
        if condition:
            params["query.cond"] = condition
        try:
            r = self.client.get(url, params=params)
            r.raise_for_status()
            studies = r.json().get("studies", [])
            trials = []
            for study in studies:
                proto = study.get("protocolSection", {})
                ident = proto.get("identificationModule", {})
                status_mod = proto.get("statusModule", {})
                design = proto.get("designModule", {})
                conditions = proto.get("conditionsModule", {})
                arms = proto.get("armsInterventionsModule", {})
                outcomes = proto.get("outcomesModule", {})
                locations_mod = proto.get("contactsLocationsModule", {})

                interventions = arms.get("interventions", [])
                intervention_names = [i.get("name", "") for i in interventions]

                primary_outcomes = outcomes.get("primaryOutcomes", [])
                primary_measure = primary_outcomes[0].get("measure", "") if primary_outcomes else ""

                locations = locations_mod.get("locations", [])
                loc_list = [{"city": l.get("city", ""), "state": l.get("state", ""),
                            "country": l.get("country", "")} for l in locations[:5]]

                trials.append(ClinicalTrial(
                    nct_id=ident.get("nctId", ""),
                    title=ident.get("briefTitle", ""),
                    phase=", ".join(design.get("phases", ["NA"])),
                    status=status_mod.get("overallStatus", ""),
                    sponsor=ident.get("leadSponsor", {}).get("name", sponsor),
                    conditions=conditions.get("conditions", []),
                    interventions=intervention_names,
                    enrollment=design.get("enrollmentInfo", {}).get("count", 0),
                    start_date=status_mod.get("startDateStruct", {}).get("date", ""),
                    completion_date=status_mod.get("completionDateStruct", {}).get("date", ""),
                    primary_outcome=primary_measure,
                    locations=loc_list,
                    study_type=design.get("studyType", ""),
                ))
            return trials
        except Exception as e:
            logger.error(f"ClinicalTrials.gov: {e}")
            return []

    # ─── NPPES NPI Registry ───

    def fetch_real_hcps(self, specialty: str, state: str, limit: int = 10) -> list[RealHCP]:
        """Fetch real healthcare providers from NPPES NPI Registry."""
        params = {
            "version": "2.1",
            "taxonomy_description": specialty,
            "state": state,
            "enumeration_type": "NPI-1",
            "limit": min(limit, 200),
            "skip": 0,
        }
        try:
            r = self.client.get(NPI_BASE, params=params)
            r.raise_for_status()
            results = r.json().get("results", [])
            hcps = []
            for record in results:
                basic = record.get("basic", {})
                addresses = record.get("addresses", [])
                taxonomies = record.get("taxonomies", [])

                first = basic.get("first_name", "")
                last = basic.get("last_name", "")
                if not last:
                    continue

                practice_addr = next((a for a in addresses if a.get("address_purpose") == "LOCATION"),
                                    addresses[0] if addresses else {})
                primary_tax = next((t for t in taxonomies if t.get("primary")),
                                  taxonomies[0] if taxonomies else {})

                hcps.append(RealHCP(
                    npi=record.get("number", ""),
                    name=f"Dr. {first} {last}",
                    specialty=primary_tax.get("desc", "Internal Medicine"),
                    state=practice_addr.get("state", ""),
                    city=practice_addr.get("city", ""),
                    address=f"{practice_addr.get('address_1', '')}, {practice_addr.get('city', '')}, {practice_addr.get('state', '')} {practice_addr.get('postal_code', '')}",
                    credential=basic.get("credential", "MD"),
                    taxonomy_code=primary_tax.get("code", ""),
                ))
            return hcps
        except Exception as e:
            logger.error(f"NPI Registry: {e}")
            return []

    # ─── PubMed E-utilities ───

    def fetch_pubmed_evidence(self, query: str, max_results: int = 5) -> list[PubMedEvidence]:
        """Fetch real published evidence from PubMed.

        Two-step: esearch to get PMIDs, then efetch/esummary to get details.
        """
        # Step 1: Search PubMed
        search_url = f"{PUBMED_BASE}/esearch.fcgi"
        search_params = {
            "db": "pubmed",
            "term": query,
            "retmax": max_results,
            "retmode": "json",
            "sort": "relevance",
        }
        try:
            r = self.client.get(search_url, params=search_params)
            r.raise_for_status()
            pmids = r.json().get("esearchresult", {}).get("idlist", [])
            if not pmids:
                return []

            time.sleep(self._rate_limit_delay)

            # Step 2: Fetch summaries
            summary_url = f"{PUBMED_BASE}/esummary.fcgi"
            summary_params = {
                "db": "pubmed",
                "id": ",".join(pmids),
                "retmode": "json",
            }
            r2 = self.client.get(summary_url, params=summary_params)
            r2.raise_for_status()
            result_data = r2.json().get("result", {})

            evidence = []
            for pmid in pmids:
                article = result_data.get(pmid, {})
                if not article:
                    continue
                authors = [a.get("name", "") for a in article.get("authors", [])[:5]]
                evidence.append(PubMedEvidence(
                    pmid=pmid,
                    title=article.get("title", ""),
                    authors=authors,
                    journal=article.get("fulljournalname", article.get("source", "")),
                    publication_date=article.get("pubdate", ""),
                    abstract="",  # abstract requires efetch, heavier call
                    doi=article.get("elocationid", ""),
                ))
            return evidence
        except Exception as e:
            logger.error(f"PubMed: {e}")
            return []

    def fetch_pubmed_abstract(self, pmid: str) -> str:
        """Fetch full abstract for a single PubMed article."""
        url = f"{PUBMED_BASE}/efetch.fcgi"
        params = {
            "db": "pubmed",
            "id": pmid,
            "rettype": "abstract",
            "retmode": "text",
        }
        try:
            r = self.client.get(url, params=params)
            r.raise_for_status()
            return r.text[:3000]
        except Exception as e:
            logger.error(f"PubMed abstract {pmid}: {e}")
            return ""

    # ─── RxNorm/RxClass ───

    def fetch_drug_classes(self, drug_name: str) -> list[dict]:
        """Fetch therapeutic classifications for a drug from RxClass."""
        url = f"{RXNORM_BASE}/rxclass/class/byDrugName.json"
        params = {"drugName": drug_name, "relaSource": "MEDRT"}
        try:
            r = self.client.get(url, params=params)
            r.raise_for_status()
            info_list = r.json().get("rxclassDrugInfoList", {}).get("rxclassDrugInfo", [])
            return [
                {
                    "class_name": item.get("rxclassMinConceptItem", {}).get("className", ""),
                    "class_type": item.get("rxclassMinConceptItem", {}).get("classType", ""),
                    "rela": item.get("rela", ""),
                }
                for item in info_list
            ]
        except Exception as e:
            logger.error(f"RxClass {drug_name}: {e}")
            return []

    # ─── Batch enrichment for proprietary systems ───

    def enrich_defragmentation_engine(self, engine, drug_names: list[str] = None) -> dict:
        """Feed real FDA labels + adverse events into the DefragmentationEngine.

        This populates the knowledge graph with real drug safety data,
        indications, and adverse event patterns — no mock.
        """
        from rxreserve.proprietary import DefragmentationEngine, FragmentType
        drug_names = drug_names or GILEAD_DRUGS[:5]
        stats = {"labels": 0, "adverse_events": 0, "fragments": 0}

        for drug in drug_names:
            # Labels
            labels = self.fetch_drug_labels(drug, limit=1)
            for label in labels:
                content = f"DRUG: {label.drug_name} ({label.generic_name})\n"
                content += f"INDICATIONS: {label.indications[:500]}\n"
                content += f"WARNINGS: {label.warnings[:300]}\n"
                content += f"ADVERSE_REACTIONS: {label.adverse_reactions[:300]}\n"
                content += f"CONTRAINDICATIONS: {label.contraindications[:300]}\n"
                content += f"DOSAGE: {label.dosage[:200]}\n"
                engine.ingest_fragment(
                    FragmentType.DOCUMENT,
                    f"openfda:label:{label.label_id}",
                    content,
                )
                stats["labels"] += 1
                stats["fragments"] += 1

            time.sleep(self._rate_limit_delay)

            # Adverse events
            events = self.fetch_adverse_events(drug, limit=10)
            for ev in events:
                content = f"ADVERSE EVENT: {ev.drug_name}\n"
                content += f"REACTION: {ev.reaction}\n"
                content += f"SERIOUSNESS: {ev.seriousness}\n"
                content += f"PATIENT: age={ev.patient_age}, sex={ev.patient_sex}\n"
                content += f"COUNTRY: {ev.country}\n"
                content += f"REPORT_ID: {ev.safety_report_id}\n"
                engine.ingest_fragment(
                    FragmentType.DOCUMENT,
                    f"openfda:faers:{ev.safety_report_id}",
                    content,
                )
                stats["adverse_events"] += 1
                stats["fragments"] += 1

            time.sleep(self._rate_limit_delay)

        # Process all fragments
        engine.process_all()
        return stats

    def enrich_msl_router(self, router, drug_names: list[str] = None) -> dict:
        """Feed real clinical trial evidence into the MSLRouter.

        When an MSL needs to respond to a medical question, they can pull
        real clinical trial data from ClinicalTrials.gov.
        """
        drug_names = drug_names or ["Biktarvy", "Descovy", "Trodelvy"]
        stats = {"trials": 0, "evidence_items": 0}

        for drug in drug_names:
            trials = self.fetch_clinical_trials(
                sponsor="Gilead",
                condition=drug if drug in ["HIV", "PrEP"] else "",
                limit=5,
            )
            for trial in trials:
                # Store as available evidence for MSL responses
                if not hasattr(router, 'evidence_store'):
                    router.evidence_store = {}
                key = drug.lower()
                router.evidence_store.setdefault(key, []).append({
                    "nct_id": trial.nct_id,
                    "title": trial.title,
                    "phase": trial.phase,
                    "status": trial.status,
                    "primary_outcome": trial.primary_outcome,
                    "enrollment": trial.enrollment,
                    "source": "ClinicalTrials.gov",
                })
                stats["trials"] += 1
                stats["evidence_items"] += 1

            time.sleep(self._rate_limit_delay)

        return stats

    def enrich_trust_trajectory(self, trust_model, hcp_id: str,
                                drug_name: str = "Biktarvy") -> dict:
        """Feed real adverse event data into the HCPTrustTrajectory model.

        If there are recent serious adverse events for a drug an HCP is
        asking about, that's a real trust signal (not mock).
        """
        events = self.fetch_adverse_events(drug_name, limit=10)
        serious_count = sum(1 for e in events if e.seriousness == "serious")

        stats = {"total_events": len(events), "serious": serious_count, "signals_added": 0}

        # Add real AE signals
        for ev in events:
            if ev.seriousness == "serious":
                trust_model.add_signal(
                    hcp_id=hcp_id,
                    signal_type="adverse_experience",
                    source="openfda_faers",
                    description=f"Real FAERS report: {ev.reaction} ({ev.safety_report_id})",
                )
                stats["signals_added"] += 1

        return stats

    def fetch_real_hcps_batch(self, specialties: list[str] = None,
                              states: list[str] = None,
                              per_state: int = 5) -> list[RealHCP]:
        """Fetch real HCPs across multiple specialties and states."""
        specialties = specialties or ["Infectious Disease", "Internal Medicine"]
        states = states or ["CA", "NY", "TX"]
        all_hcps = []

        for specialty in specialties:
            for state in states:
                hcps = self.fetch_real_hcps(specialty, state, limit=per_state)
                all_hcps.extend(hcps)
                time.sleep(self._rate_limit_delay)

        return all_hcps

    def summary(self) -> dict:
        """Return available data sources and their status."""
        return {
            "sources": {
                "openfda": {"base": OPENFDA_BASE, "data": "drug labels + adverse events"},
                "clinicaltrials_gov": {"base": CTGOV_BASE, "data": "Gilead clinical trials"},
                "npi_registry": {"base": NPI_BASE, "data": "real healthcare providers"},
                "pubmed": {"base": PUBMED_BASE, "data": "published clinical evidence"},
                "rxnorm": {"base": RXNORM_BASE, "data": "drug classifications"},
            },
            "gilead_drugs": GILEAD_DRUGS,
            "therapeutic_areas": GILEAD_THERAPEUTIC_AREAS,
            "no_api_key_required": True,
            "all_real_data": True,
        }
