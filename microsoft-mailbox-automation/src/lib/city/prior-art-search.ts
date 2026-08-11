import { nanoid } from "nanoid";
import {
  PriorArtSearch,
  SearchBoundary,
  PriorArtSource,
  PriorArtFinding,
  DifferentiatingClaim,
} from "@/types";
import { hashObject } from "./merkle";
import { recordMaterialEvent } from "./identity";
import {
  loadCityPriorArtSearches,
  saveCityPriorArtSearches,
} from "@/lib/config";

const now = () => new Date().toISOString();

/** The mandatory disclaimer attached to every prior-art search. */
export const NOVELTY_DISCLAIMER =
  "This search does not constitute a novelty or patentability determination. " +
  "It documents that a defined search was conducted within stated boundaries, " +
  "what was found or not found within that scope, and the specific differentiating " +
  "claims identified. Absolute novelty determinations belong to qualified patent " +
  "counsel and, ultimately, the relevant patent authorities or courts.";

/** Default search boundaries if none are provided. */
export const DEFAULT_SEARCH_BOUNDARIES: SearchBoundary = {
  domainsSearched: [
    "github.com",
    "patents.google.com",
    "scholar.google.com",
    "producthunt.com",
    "crunchbase.com",
  ],
  dateRange: { start: "2000-01-01", end: new Date().toISOString().slice(0, 10) },
  searchQueries: [],
  categoriesSearched: [],
  exclusions: [],
  languages: ["en"],
  patentJurisdictions: ["US", "EP", "WO"],
};

/** Conduct a structured prior-art search with documented boundaries. */
export function conductPriorArtSearch(input: {
  appId: string;
  claim: string;
  searchBoundaries: SearchBoundary;
  sources: Omit<PriorArtSource, "id" | "accessedAt">[];
  findings: Omit<PriorArtFinding, "id">[];
  differentiatingClaims: {
    claim: string;
    differentiationBasis: string;
    evidence: string;
    patentCounselReviewed?: boolean;
    counselAssessment?: string | null;
  }[];
  summary: string;
  searchConfidence: number;
}): PriorArtSearch {
  const sources: PriorArtSource[] = input.sources.map((s) => ({
    ...s,
    id: `src_${nanoid(8)}`,
    accessedAt: now(),
  }));

  const findings: PriorArtFinding[] = input.findings.map((f) => ({
    ...f,
    id: `find_${nanoid(8)}`,
  }));

  const differentiatingClaims: DifferentiatingClaim[] = input.differentiatingClaims.map((c) => ({
    ...c,
    id: `dc_${nanoid(8)}`,
    patentCounselReviewed: c.patentCounselReviewed ?? false,
    counselAssessment: c.counselAssessment ?? null,
  }));

  const materialPriorArtFound = findings.some(
    (f) => f.blocksDifferentiation && f.withinScope
  );

  const search: PriorArtSearch = {
    id: `pas_${nanoid(10)}`,
    appId: input.appId,
    claim: input.claim,
    searchBoundaries: input.searchBoundaries,
    sources,
    findings,
    differentiatingClaims,
    materialPriorArtFound,
    summary: input.summary,
    searchConfidence: Math.max(0, Math.min(1, input.searchConfidence)),
    noveltyDisclaimer: NOVELTY_DISCLAIMER,
    patentCounselReviewRecommended: materialPriorArtFound || differentiatingClaims.length > 3,
    searchedAt: now(),
    contentHash: "",
  };

  // Compute content hash over the full search record.
  const { contentHash, ...rest } = search;
  search.contentHash = hashObject(rest);

  const all = loadCityPriorArtSearches();
  all.push(search);
  saveCityPriorArtSearches(all);

  recordMaterialEvent(input.appId, "prior_art_review", {
    searchId: search.id,
    claim: search.claim,
    sourcesCount: sources.length,
    findingsCount: findings.length,
    materialPriorArtFound,
    differentiatingClaimsCount: differentiatingClaims.length,
    searchConfidence: search.searchConfidence,
    boundaries: search.searchBoundaries,
  }, "system", `Prior-art search conducted: ${sources.length} sources, ${findings.length} findings`);

  return search;
}

/** Get a prior-art search by ID. */
export function getPriorArtSearchById(id: string): PriorArtSearch | undefined {
  return loadCityPriorArtSearches().find((s) => s.id === id);
}

/** Get the prior-art search for an app. */
export function getPriorArtSearchForApp(appId: string): PriorArtSearch | undefined {
  return loadCityPriorArtSearches().find((s) => s.appId === appId);
}

/** List all prior-art searches. */
export function listPriorArtSearches(): PriorArtSearch[] {
  return loadCityPriorArtSearches();
}

/** Update a differentiating claim with patent counsel review. */
export function updateCounselReview(
  searchId: string,
  claimId: string,
  assessment: string
): PriorArtSearch | undefined {
  const all = loadCityPriorArtSearches();
  const idx = all.findIndex((s) => s.id === searchId);
  if (idx < 0) return undefined;

  const claimIdx = all[idx].differentiatingClaims.findIndex((c) => c.id === claimId);
  if (claimIdx < 0) return undefined;

  all[idx].differentiatingClaims[claimIdx].patentCounselReviewed = true;
  all[idx].differentiatingClaims[claimIdx].counselAssessment = assessment;

  // Recompute content hash.
  const { contentHash, ...rest } = all[idx];
  all[idx].contentHash = hashObject(rest);
  saveCityPriorArtSearches(all);

  return all[idx];
}

/** Validate that a prior-art search meets minimum documentation standards. */
export function validateSearchCompleteness(search: PriorArtSearch): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (search.sources.length === 0) {
    issues.push("No sources consulted");
  }
  if (search.searchBoundaries.domainsSearched.length === 0) {
    issues.push("No search domains documented");
  }
  if (search.searchBoundaries.searchQueries.length === 0) {
    issues.push("No search queries documented");
  }
  if (search.differentiatingClaims.length === 0) {
    issues.push("No differentiating claims identified");
  }
  if (search.searchConfidence < 0.3) {
    issues.push("Search confidence below minimum threshold (0.3)");
  }
  if (!search.noveltyDisclaimer || search.noveltyDisclaimer.length === 0) {
    issues.push("Missing novelty disclaimer");
  }

  return { valid: issues.length === 0, issues };
}

/** Compute the prior-art corpus across all apps — the reusable
 *  knowledge base of what has been searched and found. */
export function getPriorArtCorpus(): {
  totalSearches: number;
  totalSources: number;
  totalFindings: number;
  totalDifferentiatingClaims: number;
  searchesByCategory: Record<string, number>;
  overlappingClaims: { claim: string; appIds: string[] }[];
} {
  const searches = loadCityPriorArtSearches();
  const totalSearches = searches.length;
  const totalSources = searches.reduce((sum, s) => sum + s.sources.length, 0);
  const totalFindings = searches.reduce((sum, s) => sum + s.findings.length, 0);
  const totalDifferentiatingClaims = searches.reduce(
    (sum, s) => sum + s.differentiatingClaims.length, 0
  );

  const searchesByCategory: Record<string, number> = {};
  for (const s of searches) {
    for (const cat of s.searchBoundaries.categoriesSearched) {
      searchesByCategory[cat] = (searchesByCategory[cat] || 0) + 1;
    }
  }

  // Find overlapping differentiating claims across apps.
  const claimMap = new Map<string, string[]>();
  for (const s of searches) {
    for (const dc of s.differentiatingClaims) {
      const key = dc.claim.toLowerCase().slice(0, 100);
      if (!claimMap.has(key)) claimMap.set(key, []);
      claimMap.get(key)!.push(s.appId);
    }
  }
  const overlappingClaims = Array.from(claimMap.entries())
    .filter(([, appIds]) => new Set(appIds).size > 1)
    .map(([claim, appIds]) => ({ claim, appIds: Array.from(new Set(appIds)) }));

  return {
    totalSearches,
    totalSources,
    totalFindings,
    totalDifferentiatingClaims,
    searchesByCategory,
    overlappingClaims,
  };
}
