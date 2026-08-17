/**
 * Enrichment worker for the DataPipe living dataset.
 *
 * Runs pending enrichment tasks from dp_enrichment_queue:
 * - npi_lookup: Validates NPI against NPPES registry, pulls practice address,
 *   primary taxonomy (specialty), license status
 * - address_normalize: Standardizes address format for dedup
 * - specialty_normalize: Maps raw specialty codes to canonical names
 *
 * Each enrichment result is applied back to the entity as new attribute values.
 */

import { getPendingEnrichment, completeEnrichment, getEntity, DEFAULT_ORG_ID } from "@/lib/datapipe-store";

// ─── NPI Lookup via NPPES Registry API ─────────────────────────────────

interface NpiResult {
  npi_valid: string;
  npi_status: string; // active | inactive | suspended | revoked
  primary_taxonomy: string;
  practice_address: string;
  practice_city: string;
  practice_state: string;
  practice_zip: string;
  phone: string;
  enumeration_date: string;
}

async function lookupNpi(npi: string): Promise<NpiResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(
      `https://npiregistry.cms.hhs.gov/api/?version=2.1&number=${npi}&limit=1`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const record = data?.results?.[0];
    if (!record) return null;

    const taxonomy = record.taxonomies?.find((t: any) => t.primary === true) || record.taxonomies?.[0];
    const address = record.addresses?.find((a: any) => a.address_purpose === "LOCATION") || record.addresses?.[0];

    return {
      npi_valid: "true",
      npi_status: record.enumeration_date && !record.deactivation_date ? "active" : "inactive",
      primary_taxonomy: taxonomy?.desc || taxonomy?.code || "",
      practice_address: address?.address_1 || "",
      practice_city: address?.city || "",
      practice_state: address?.state || "",
      practice_zip: address?.postal_code || "",
      phone: address?.telephone_number || "",
      enumeration_date: record.enumeration_date || "",
    };
  } catch (e) {
    clearTimeout(timeout);
    return null;
  }
}

// ─── Address Normalization ─────────────────────────────────────────────

const STREET_SUFFIXES: Record<string, string> = {
  "street": "St", "st": "St", "avenue": "Ave", "ave": "Ave", "av": "Ave",
  "boulevard": "Blvd", "blvd": "Blvd", "road": "Rd", "rd": "Rd",
  "drive": "Dr", "dr": "Dr", "lane": "Ln", "ln": "Ln",
  "court": "Ct", "ct": "Ct", "place": "Pl", "pl": "Pl",
  "parkway": "Pkwy", "pkwy": "Pkwy", "highway": "Hwy", "hwy": "Hwy",
  "terrace": "Ter", "ter": "Ter", "circle": "Cir", "cir": "Cir",
  "square": "Sq", "sq": "Sq", "suite": "Ste", "ste": "Ste",
  "apartment": "Apt", "apt": "Apt", "floor": "Fl", "fl": "Fl",
};

function normalizeAddress(address: string): string {
  if (!address) return "";
  let normalized = address.trim().replace(/\s+/g, " ");

  // Standardize street suffixes
  for (const [full, abbr] of Object.entries(STREET_SUFFIXES)) {
    const regex = new RegExp(`\\b${full.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    normalized = normalized.replace(regex, abbr);
  }

  // Standardize directional abbreviations
  normalized = normalized.replace(/\bNorth\b/gi, "N").replace(/\bSouth\b/gi, "S")
    .replace(/\bEast\b/gi, "E").replace(/\bWest\b/gi, "W")
    .replace(/\bNE\b/gi, "NE").replace(/\bNW\b/gi, "NW")
    .replace(/\bSE\b/gi, "SE").replace(/\bSW\b/gi, "SW");

  // Title case
  normalized = normalized.replace(/\b\w/g, (c) => c.toUpperCase());

  return normalized;
}

// ─── Specialty Normalization ───────────────────────────────────────────

const SPECIALTY_MAP: Record<string, string> = {
  "inf-dis": "Infectious Disease",
  "inf_dis": "Infectious Disease",
  "infectious": "Infectious Disease",
  "id": "Infectious Disease",
  "im": "Internal Medicine",
  "internal": "Internal Medicine",
  "internal_med": "Internal Medicine",
  "fm": "Family Medicine",
  "family": "Family Medicine",
  "family_med": "Family Medicine",
  "gp": "General Practice",
  "general": "General Practice",
  "general_practice": "General Practice",
  "ped": "Pediatrics",
  "peds": "Pediatrics",
  "pediatrics": "Pediatrics",
  "card": "Cardiology",
  "cardiology": "Cardiology",
  "endo": "Endocrinology",
  "endocrinology": "Endocrinology",
  "psych": "Psychiatry",
  "psychiatry": "Psychiatry",
  "neuro": "Neurology",
  "neurology": "Neurology",
  "derm": "Dermatology",
  "dermatology": "Dermatology",
  "onco": "Oncology",
  "oncology": "Oncology",
  "hiv": "HIV/AIDS Care",
  "hiv/aids": "HIV/AIDS Care",
};

function normalizeSpecialty(raw: string): string {
  if (!raw) return "";
  const lower = raw.trim().toLowerCase();
  // Direct match
  if (SPECIALTY_MAP[lower]) return SPECIALTY_MAP[lower];
  // Partial match
  for (const [key, value] of Object.entries(SPECIALTY_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return value;
  }
  // Title case fallback
  return raw.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Enrichment Runner ─────────────────────────────────────────────────

export async function runEnrichmentBatch(orgId: string = DEFAULT_ORG_ID, batchSize: number = 5): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const pending = getPendingEnrichment(orgId, batchSize);
  let succeeded = 0;
  let failed = 0;

  for (const task of pending) {
    try {
      const entity = getEntity(orgId, task.entity_id);
      if (!entity) {
        failed++;
        continue;
      }

      let results: Record<string, any> = {};

      if (task.enrichment_type === "npi_lookup") {
        const npi = entity.values.npi || entity.values.NPI;
        if (npi && String(npi).length === 10) {
          const npiResult = await lookupNpi(String(npi));
          if (npiResult) {
            results = npiResult;
          } else {
            results = { npi_valid: "false", npi_status: "not_found" };
          }
        } else {
          results = { npi_valid: "false", npi_status: "no_npi" };
        }
      } else if (task.enrichment_type === "address_normalize") {
        const address = entity.values.address || entity.values.Address || entity.values.street;
        if (address) {
          results = { address_normalized: normalizeAddress(String(address)) };
        }
      } else if (task.enrichment_type === "specialty_normalize") {
        const specialty = entity.values.specialty || entity.values.Specialty;
        if (specialty) {
          results = { specialty_normalized: normalizeSpecialty(String(specialty)) };
        }
      }

      completeEnrichment(task.id, results);
      succeeded++;
    } catch (e) {
      failed++;
    }
  }

  return { processed: pending.length, succeeded, failed };
}

/**
 * Auto-queue enrichment tasks for entities that have NPI but haven't been enriched yet.
 */
export function autoQueueEnrichment(orgId: string = DEFAULT_ORG_ID): number {
  // This would query for entities with npi values but no npi_valid attribute
  // and queue npi_lookup tasks. For now, it's a stub that could be expanded.
  return 0;
}
