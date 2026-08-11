/**
 * Approved Content Recommender
 *
 * Selects regulatory-approved promotional content for HCPs based on their
 * current information gap, previous exposure, role/specialty, territory
 * conditions, available time, channel, approved indication, response
 * history, and observed downstream outcomes.
 *
 * All recommended content references an item from the approved (MLR-reviewed)
 * content library. No off-label or expired material is ever surfaced.
 */

import {
  ContentRecommendation,
  TerritoryAccount,
  HCPFunnelState,
  BarrierType,
} from "@/types";
import { kvLoad, kvSave, DEFAULT_ORG_ID } from "@/lib/db";

// ─── Types ──────────────────────────────────────────────────────────

export interface ApprovedContentAsset {
  id: string;
  name: string;
  type: string;
  indication: string;
  expiryDate: string;
  slides: { number: number; title: string; topic: string }[];
}

export interface ContentResponseRecord {
  contentId: string;
  hcpResponse: string;
  responseRate: number;
  engagementImproved: boolean;
  recordedAt: string;
}

interface BarrierContentMapping {
  barrier: BarrierType;
  topicKeywords: string[];
  infoGap: string;
}

// ─── Approved Content Library ───────────────────────────────────────
//
// Expiry dates are computed relative to the current date so that the sample
// library remains valid regardless of when it is loaded. Each asset declares
// the number of months from now until its MLR approval expires.

interface ContentAssetSeed {
  id: string;
  name: string;
  type: string;
  indication: string;
  expiryMonths: number;
  slides: { number: number; title: string; topic: string }[];
}

const CONTENT_ASSET_SEEDS: ContentAssetSeed[] = [
  {
    id: "GILD-HIV-CLIN-001",
    name: "Biktarvy Clinical Efficacy Deck",
    type: "slide_deck",
    indication: "HIV-1 treatment",
    expiryMonths: 18,
    slides: [
      { number: 1, title: "Mechanism of Action", topic: "pharmacology" },
      { number: 3, title: "Pivotal Trial Design", topic: "clinical_evidence" },
      { number: 5, title: "Virologic Suppression at Week 48", topic: "efficacy" },
      { number: 7, title: "Patient Identification Criteria", topic: "patient_eligibility" },
      { number: 9, title: "Safety Profile Summary", topic: "safety" },
      { number: 11, title: "Adherence and Persistence Data", topic: "persistence" },
    ],
  },
  {
    id: "GILD-HIV-ACC-002",
    name: "HIV Access and Reimbursement Guide",
    type: "one_pager",
    indication: "HIV-1 treatment",
    expiryMonths: 12,
    slides: [
      { number: 1, title: "Formulary Coverage by Plan", topic: "formulary" },
      { number: 2, title: "Prior Authorization Workflow", topic: "reimbursement" },
      { number: 3, title: "Copay Assistance Program", topic: "reimbursement" },
    ],
  },
  {
    id: "GILD-HCV-CLIN-003",
    name: "Epclusa Pan-Genotypic Evidence Deck",
    type: "slide_deck",
    indication: "Chronic HCV (genotypes 1-6)",
    expiryMonths: 16,
    slides: [
      { number: 1, title: "Pan-Genotypic Rationale", topic: "scientific_understanding" },
      { number: 4, title: "SVR12 Across Genotypes", topic: "efficacy" },
      { number: 6, title: "Diagnosis and Staging Workflow", topic: "diagnosis_testing" },
      { number: 8, title: "Treatment-Naive vs Experienced", topic: "patient_eligibility" },
      { number: 10, title: "Renal Impairment Considerations", topic: "safety" },
    ],
  },
  {
    id: "GILD-HCV-DX-004",
    name: "HCV Screening and Referral Pathway",
    type: "infographic",
    indication: "Chronic HCV screening",
    expiryMonths: 20,
    slides: [
      { number: 1, title: "Risk-Based Screening Criteria", topic: "patient_eligibility" },
      { number: 2, title: "Referral to Specialist Pathway", topic: "referral_pathway" },
      { number: 3, title: "Linkage to Care Timeline", topic: "office_workflow" },
    ],
  },
  {
    id: "GILD-HBV-CLIN-005",
    name: "Vemlidy Chronic HBV Data Summary",
    type: "slide_deck",
    indication: "Chronic hepatitis B",
    expiryMonths: 14,
    slides: [
      { number: 1, title: "HBV Treatment Landscape", topic: "awareness" },
      { number: 3, title: "Bone and Renal Safety Comparison", topic: "safety" },
      { number: 5, title: "Identifying Treatment Candidates", topic: "patient_eligibility" },
      { number: 7, title: "Long-Term Monitoring Protocol", topic: "persistence" },
    ],
  },
  {
    id: "GILD-ONC-CLIN-006",
    name: "Trodelvy Metastatic Breast Cancer Deck",
    type: "slide_deck",
    indication: "HR+/HER2- metastatic breast cancer",
    expiryMonths: 10,
    slides: [
      { number: 1, title: "Mechanism: Antibody-Drug Conjugate", topic: "scientific_understanding" },
      { number: 4, title: "TROP-2 Expression and Patient Selection", topic: "patient_eligibility" },
      { number: 6, title: "PFS and OS Results", topic: "efficacy" },
      { number: 8, title: "Adverse Event Management", topic: "safety" },
      { number: 10, title: "Treatment Initiation Workflow", topic: "treatment_initiation" },
    ],
  },
  {
    id: "GILD-ONC-CLIN-007",
    name: "Yescarta CAR-T Cell Therapy Overview",
    type: "slide_deck",
    indication: "Large B-cell lymphoma",
    expiryMonths: 18,
    slides: [
      { number: 1, title: "CAR-T Mechanism and Process", topic: "scientific_understanding" },
      { number: 3, title: "Eligibility and Referral Criteria", topic: "referral_pathway" },
      { number: 5, title: "Efficacy in Relapsed/Refractory Setting", topic: "efficacy" },
      { number: 7, title: "CRS and Neurotoxicity Management", topic: "safety" },
      { number: 9, title: "Treatment Center Setup", topic: "access" },
    ],
  },
  {
    id: "GILD-HIV-PERS-008",
    name: "HIV Persistence and Adherence Toolkit",
    type: "leave_behind",
    indication: "HIV-1 treatment",
    expiryMonths: 22,
    slides: [
      { number: 1, title: "Adherence Barriers and Solutions", topic: "persistence" },
      { number: 2, title: "Long-Acting Therapy Discussion", topic: "treatment_initiation" },
      { number: 3, title: "Patient Counseling Tips", topic: "office_workflow" },
    ],
  },
  {
    id: "GILD-HCV-ACC-009",
    name: "HCV Reimbursement and PA Support",
    type: "one_pager",
    indication: "Chronic HCV treatment",
    expiryMonths: 15,
    slides: [
      { number: 1, title: "Medicare and Commercial Coverage", topic: "formulary" },
      { number: 2, title: "PA Criteria and Documentation", topic: "reimbursement" },
      { number: 3, title: "Patient Support Program Enrollment", topic: "access" },
    ],
  },
  {
    id: "GILD-ONC-ACC-010",
    name: "Oncology Access and Site-of-Care Guide",
    type: "one_pager",
    indication: "Solid tumor and hematology oncology",
    expiryMonths: 11,
    slides: [
      { number: 1, title: "Buy-and-Bill vs Specialty Pharmacy", topic: "access" },
      { number: 2, title: "Prior Authorization Checklist", topic: "reimbursement" },
      { number: 3, title: "Site-of-Care Optimization", topic: "office_workflow" },
    ],
  },
];

function computeExpiryDate(monthsFromNow: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setMonth(d.getMonth() + monthsFromNow);
  return d.toISOString().slice(0, 10);
}

const APPROVED_CONTENT_LIBRARY: ApprovedContentAsset[] = CONTENT_ASSET_SEEDS.map((seed) => ({
  id: seed.id,
  name: seed.name,
  type: seed.type,
  indication: seed.indication,
  expiryDate: computeExpiryDate(seed.expiryMonths),
  slides: seed.slides.map((s) => ({ ...s })),
}));

// ─── Barrier → Content Topic Mapping ────────────────────────────────

const BARRIER_CONTENT_MAP: BarrierContentMapping[] = [
  {
    barrier: "awareness",
    topicKeywords: ["awareness", "pharmacology"],
    infoGap: "Disease awareness and product mechanism",
  },
  {
    barrier: "scientific_understanding",
    topicKeywords: ["scientific_understanding", "clinical_evidence", "efficacy"],
    infoGap: "Clinical evidence and scientific rationale",
  },
  {
    barrier: "patient_eligibility",
    topicKeywords: ["patient_eligibility", "patient_identification"],
    infoGap: "Patient identification and eligibility criteria",
  },
  {
    barrier: "diagnosis_testing",
    topicKeywords: ["diagnosis_testing", "patient_eligibility"],
    infoGap: "Diagnostic and testing workflow",
  },
  {
    barrier: "referral_pathway",
    topicKeywords: ["referral_pathway", "office_workflow"],
    infoGap: "Referral pathway and linkage to care",
  },
  {
    barrier: "formulary",
    topicKeywords: ["formulary", "reimbursement"],
    infoGap: "Formulary coverage and access status",
  },
  {
    barrier: "reimbursement",
    topicKeywords: ["reimbursement", "formulary"],
    infoGap: "Reimbursement and prior authorization support",
  },
  {
    barrier: "office_workflow",
    topicKeywords: ["office_workflow", "persistence"],
    infoGap: "Office workflow integration and counseling",
  },
  {
    barrier: "treatment_initiation",
    topicKeywords: ["treatment_initiation", "efficacy"],
    infoGap: "Treatment initiation protocol and expectations",
  },
  {
    barrier: "persistence",
    topicKeywords: ["persistence", "office_workflow"],
    infoGap: "Adherence and long-term persistence support",
  },
  {
    barrier: "access",
    topicKeywords: ["access", "formulary", "reimbursement"],
    infoGap: "Product access and site-of-care logistics",
  },
];

// ─── Funnel State → Information Gap Description ─────────────────────

const FUNNEL_INFO_GAP: Record<HCPFunnelState, string> = {
  eligible: "Disease awareness and basic product introduction",
  relevant_population: "Patient population relevance and identification",
  info_gap: "Core clinical evidence and mechanism of action",
  access_opportunity: "Formulary, reimbursement, and access pathway",
  engagement_attempted: "Reinforcing clinical differentiation and safety",
  meaningful_interaction: "Deepening evidence on specific patient scenarios",
  content_consumed: "Addressing remaining barriers with targeted content",
  barrier_identified: "Directly addressing the documented barrier",
  barrier_addressed: "Confirming resolution and advancing to next step",
  treatment_consideration: "Treatment initiation and patient selection detail",
  patient_initiation: "Onboarding workflow and persistence support",
  persistence: "Adherence monitoring and long-term persistence tools",
};

// ─── Historical Response Tracking (durable store) ───────────────────

const CONTENT_RESPONSE_HISTORY_KEY = "content_response_history";

const DEFAULT_RESPONSE_HISTORY: ContentResponseRecord[] = [
  {
    contentId: "GILD-HIV-CLIN-001",
    hcpResponse: "engaged",
    responseRate: 0.75,
    engagementImproved: true,
    recordedAt: "2025-01-15T10:00:00Z",
  },
  {
    contentId: "GILD-HIV-CLIN-001",
    hcpResponse: "neutral",
    responseRate: 0.4,
    engagementImproved: false,
    recordedAt: "2025-02-20T14:30:00Z",
  },
  {
    contentId: "GILD-HCV-CLIN-003",
    hcpResponse: "engaged",
    responseRate: 0.75,
    engagementImproved: true,
    recordedAt: "2025-01-28T09:15:00Z",
  },
  {
    contentId: "GILD-ONC-CLIN-006",
    hcpResponse: "engaged",
    responseRate: 0.75,
    engagementImproved: true,
    recordedAt: "2025-03-05T11:45:00Z",
  },
];

function getResponseHistory(orgId: string = DEFAULT_ORG_ID): ContentResponseRecord[] {
  const records = kvLoad<ContentResponseRecord>(orgId, CONTENT_RESPONSE_HISTORY_KEY);
  if (records.length === 0) {
    kvSave(orgId, CONTENT_RESPONSE_HISTORY_KEY, DEFAULT_RESPONSE_HISTORY);
    return [...DEFAULT_RESPONSE_HISTORY];
  }
  return records;
}

// ─── Helpers ────────────────────────────────────────────────────────

function isExpired(asset: ApprovedContentAsset, now: Date = new Date()): boolean {
  const expiry = new Date(asset.expiryDate);
  return expiry.getTime() < now.getTime();
}

function indicationMatches(account: TerritoryAccount, asset: ApprovedContentAsset): boolean {
  const spec = account.specialty.toLowerCase();
  const indication = asset.indication.toLowerCase();

  // Specialty → indication family mapping
  if (spec.includes("hiv") || spec.includes("infect")) {
    return indication.includes("hiv");
  }
  if (spec.includes("hepat") || spec.includes("liver") || spec.includes("gastro")) {
    return indication.includes("hcv") || indication.includes("hbv") || indication.includes("hepat");
  }
  if (spec.includes("oncol") || spec.includes("hemat") || spec.includes("cancer")) {
    return indication.includes("breast") || indication.includes("lymphoma") || indication.includes("tumor") || indication.includes("oncology") || indication.includes("hematology");
  }
  if (spec.includes("primary") || spec.includes("internal") || spec.includes("family")) {
    // Primary care: broad eligibility — allow all but prefer screening content
    return true;
  }
  // Default: allow if no clear specialty signal (broad-relevance assets)
  return true;
}

function channelFits(account: TerritoryAccount, asset: ApprovedContentAsset): boolean {
  const channel = account.channelPreference ?? "in_person";
  if (channel === "email" || channel === "phone") {
    // Remote channels: prefer concise formats
    return asset.type === "one_pager" || asset.type === "infographic" || asset.type === "leave_behind";
  }
  // In-person or remote video: full decks are acceptable
  return true;
}

function timeFits(account: TerritoryAccount, asset: ApprovedContentAsset): boolean {
  const timeMin = account.recommendedAction?.estimatedTimeMin ?? 15;
  // Short time windows: prefer fewer-slide assets
  if (timeMin <= 10) {
    return asset.slides.length <= 4;
  }
  if (timeMin <= 20) {
    return asset.slides.length <= 6;
  }
  return true;
}

function findSlideForBarrier(
  asset: ApprovedContentAsset,
  barrier: BarrierType,
): { number: number; title: string; topic: string } | null {
  const mapping = BARRIER_CONTENT_MAP.find((m) => m.barrier === barrier);
  if (!mapping) {
    return null;
  }
  for (const slide of asset.slides) {
    if (mapping.topicKeywords.some((kw) => slide.topic.includes(kw) || slide.title.toLowerCase().includes(kw))) {
      return slide;
    }
  }
  return null;
}

function computeHistoricalResponseRate(
  contentId: string,
  orgId: string = DEFAULT_ORG_ID,
): number | undefined {
  const records = getResponseHistory(orgId).filter((r) => r.contentId === contentId);
  if (records.length === 0) {
    return undefined;
  }
  const total = records.reduce((sum, r) => sum + r.responseRate, 0);
  return Math.round((total / records.length) * 100) / 100;
}

function buildReason(
  account: TerritoryAccount,
  asset: ApprovedContentAsset,
  slide: { number: number; title: string; topic: string } | null,
): string {
  const barrierLabel = account.barrierDetail ?? account.barrier.replace(/_/g, " ");
  const slideRef = slide
    ? `slide ${slide.number} ("${slide.title}") from approved asset ${asset.name}`
    : `approved asset ${asset.name}`;
  const historicalNote =
    computeHistoricalResponseRate(asset.id) !== undefined
      ? `, and this content has historically improved follow-up engagement among similar accounts`
      : "";
  return `Use ${slideRef} because this account's documented barrier is ${barrierLabel}${historicalNote}.`;
}

function riskLevelFor(account: TerritoryAccount, asset: ApprovedContentAsset): "low" | "moderate" | "high" {
  // Higher risk when content has never been shown before and account is early in funnel
  if (account.funnelState === "eligible" || account.funnelState === "relevant_population") {
    if (account.lastContentShown === undefined) {
      return "moderate";
    }
  }
  // Access/reimbursement content carries moderate risk if formulary not confirmed
  if (account.barrier === "formulary" || account.barrier === "reimbursement" || account.barrier === "access") {
    return "moderate";
  }
  return "low";
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Return the full approved content library (sample data for Gilead products
 * across HIV, HCV, HBV, and oncology). Each item includes slide-level detail.
 */
export function getApprovedContentLibrary(): ApprovedContentAsset[] {
  // Return a deep copy so callers cannot mutate the source library.
  return APPROVED_CONTENT_LIBRARY.map((asset) => ({
    ...asset,
    slides: asset.slides.map((s) => ({ ...s })),
  }));
}

/**
 * Select 1-3 approved content recommendations for a given territory account.
 *
 * Selection considers:
 *  - HCP's current information gap (funnel state)
 *  - Documented barrier type
 *  - Previous content exposure (lastContentShown)
 *  - Role / specialty alignment with approved indication
 *  - Territory conditions (operational friction, geographic zone)
 *  - Available time (estimatedTimeMin)
 *  - Channel preference
 *  - Approved indication match
 *  - Historical response rate
 *  - Observed downstream outcomes (engagementImproved in response history)
 */
export function recommendContent(
  account: TerritoryAccount,
  orgId: string = DEFAULT_ORG_ID,
): ContentRecommendation[] {
  const library = getApprovedContentLibrary().filter((asset) => !isExpired(asset));

  // Score every eligible asset.
  const scored = library
    .filter((asset) => indicationMatches(account, asset))
    .filter((asset) => channelFits(account, asset))
    .filter((asset) => timeFits(account, asset))
    .map((asset) => {
      let score = 0;

      // Barrier alignment: does any slide address the barrier?
      const slide = findSlideForBarrier(asset, account.barrier);
      if (slide) {
        score += 40;
      }

      // Funnel-state alignment: does the asset's indication match the info gap?
      const infoGap = FUNNEL_INFO_GAP[account.funnelState] ?? "";
      if (asset.slides.some((s) => infoGap.toLowerCase().includes(s.topic.replace(/_/g, " ")))) {
        score += 20;
      }

      // Avoid re-serving the exact asset last shown.
      if (account.lastContentShown && account.lastContentShown === asset.id) {
        score -= 25;
      }

      const history = getResponseHistory(orgId);

      // Historical response rate boost.
      const records = history.filter((r) => r.contentId === asset.id);
      const histRate =
        records.length === 0
          ? undefined
          : Math.round(
              (records.reduce((sum, r) => sum + r.responseRate, 0) / records.length) * 100,
            ) / 100;
      if (histRate !== undefined) {
        score += Math.round(histRate * 30);
      }

      // Observed downstream outcomes: assets with engagementImproved history.
      const improvedCount = records.filter((r) => r.engagementImproved).length;
      score += improvedCount * 10;

      // Operational friction penalty: high-friction accounts favor concise assets.
      if (account.operationalFriction > 0.6 && asset.slides.length > 6) {
        score -= 10;
      }

      // Unmet info need boost: accounts with high N_i get evidence-heavy assets.
      if (account.unmetInfoNeed > 0.6 && asset.type === "slide_deck") {
        score += 8;
      }

      // Expected responsiveness: highly responsive HCPs can absorb full decks.
      if (account.expectedResponsiveness > 0.7 && asset.type === "slide_deck") {
        score += 5;
      }

      return { asset, score, slide };
    })
    .sort((a, b) => b.score - a.score);

  // Take top 1-3 (at least 1 if any eligible).
  const topCount = Math.min(3, Math.max(1, scored.length));
  const selected = scored.slice(0, topCount);

  const channel = account.channelPreference ?? "in_person";

  return selected.map(({ asset, slide }) => {
    const histRate = computeHistoricalResponseRate(asset.id);
    return {
      contentId: asset.id,
      contentName: asset.name,
      slideReference: slide ? `Slide ${slide.number}: ${slide.title}` : undefined,
      reasonForSelection: buildReason(account, asset, slide),
      hcpInfoGap: FUNNEL_INFO_GAP[account.funnelState] ?? "General product information",
      historicalResponseRate: histRate,
      approvedForIndication: asset.indication,
      channel,
      riskLevel: riskLevelFor(account, asset),
    };
  });
}

/**
 * Find the single best content piece for a specific barrier type from the
 * provided content library. Returns null when no asset addresses the barrier.
 */
export function matchContentToBarrier(
  barrier: BarrierType,
  contentLibrary: ApprovedContentAsset[],
  orgId: string = DEFAULT_ORG_ID,
): ContentRecommendation | null {
  if (barrier === "none") {
    return null;
  }

  const mapping = BARRIER_CONTENT_MAP.find((m) => m.barrier === barrier);
  if (!mapping) {
    return null;
  }

  let bestAsset: ApprovedContentAsset | null = null;
  let bestSlide: { number: number; title: string; topic: string } | null = null;
  let bestScore = -1;

  for (const asset of contentLibrary) {
    if (isExpired(asset)) {
      continue;
    }
    const slide = findSlideForBarrier(asset, barrier);
    if (!slide) {
      continue;
    }
    // Prefer assets whose slides match the most topic keywords.
    const matchCount = asset.slides.filter((s) =>
      mapping.topicKeywords.some((kw) => s.topic.includes(kw)),
    ).length;
    const records = getResponseHistory(orgId).filter((r) => r.contentId === asset.id);
    const histRate =
      records.length === 0
        ? undefined
        : Math.round(
            (records.reduce((sum, r) => sum + r.responseRate, 0) / records.length) * 100,
          ) / 100;
    const score = matchCount * 10 + (histRate ?? 0) * 20;
    if (score > bestScore) {
      bestScore = score;
      bestAsset = asset;
      bestSlide = slide;
    }
  }

  if (!bestAsset || !bestSlide) {
    return null;
  }

  const histRate = computeHistoricalResponseRate(bestAsset.id, orgId);
  return {
    contentId: bestAsset.id,
    contentName: bestAsset.name,
    slideReference: `Slide ${bestSlide.number}: ${bestSlide.title}`,
    reasonForSelection: `Use slide ${bestSlide.number} ("${bestSlide.title}") from approved asset ${bestAsset.name} because the target barrier is ${barrier.replace(/_/g, " ")}, and this slide directly addresses ${mapping.infoGap.toLowerCase()}.`,
    hcpInfoGap: mapping.infoGap,
    historicalResponseRate: histRate,
    approvedForIndication: bestAsset.indication,
    channel: "in_person",
    riskLevel: "low",
  };
}

/**
 * Track historical response to a content piece. Persists to the durable KV
 * store and recomputes aggregate metrics. Response rates are derived from the
 * qualitative response category, not from random sampling.
 */
export function trackContentResponse(
  contentId: string,
  hcpResponse: string,
  orgId: string = DEFAULT_ORG_ID,
): { responseRate: number; engagementImproved: boolean } {
  if (!contentId || contentId.trim().length === 0) {
    throw new Error("contentId is required");
  }
  if (!hcpResponse || hcpResponse.trim().length === 0) {
    throw new Error("hcpResponse is required");
  }

  const normalized = hcpResponse.trim().toLowerCase();
  const engaged = ["engaged", "positive", "interested", "requested_more", "follow_up"].some(
    (k) => normalized.includes(k),
  );

  // Derive a deterministic response rate from the qualitative response.
  let rate: number;
  if (engaged) {
    rate = 0.75;
  } else if (normalized.includes("neutral") || normalized.includes("no_change")) {
    rate = 0.4;
  } else {
    rate = 0.2;
  }
  rate = Math.round(rate * 100) / 100;

  const record: ContentResponseRecord = {
    contentId,
    hcpResponse: normalized,
    responseRate: rate,
    engagementImproved: engaged,
    recordedAt: new Date().toISOString(),
  };
  const history = getResponseHistory(orgId);
  const updated = [...history, record];
  kvSave(orgId, CONTENT_RESPONSE_HISTORY_KEY, updated);

  // Recompute aggregate for this contentId.
  const records = updated.filter((r) => r.contentId === contentId);
  const aggregateRate =
    Math.round((records.reduce((s, r) => s + r.responseRate, 0) / records.length) * 100) / 100;
  const engagementImproved = records.some((r) => r.engagementImproved);

  return { responseRate: aggregateRate, engagementImproved };
}
