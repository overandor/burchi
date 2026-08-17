/**
 * Composite Scoring Engine — proprietary derived signals from real public data.
 *
 * Three composite scores that nobody else computes because the combination
 * logic, weighting, and historical accumulation are specific to this system:
 *
 * 1. HCP Risk-Adjusted Value Score (RAVS)
 *    Combines: NPI registry data (validity, specialty) + OpenFDA adverse
 *    event density for prescribed drugs + DataPipe historical TRx trajectory.
 *    Produces: 0-100 score indicating how much this HCP's prescribing patterns
 *    align with therapeutic goals vs. safety risk exposure.
 *
 * 2. Territory Momentum Index (TMI)
 *    Combines: DataPipe period-over-period KPI deltas (TRx, NRx, market share)
 *    + ClinicalTrials.gov trial density in the territory's state + adverse
 *    event trend direction. Produces: -100 to +100 momentum signal.
 *
 * 3. Safety Signal Density (SSD)
 *    Combines: OpenFDA FAERS adverse event counts per drug + RxNorm
 *    therapeutic class cross-referencing + DataPipe prescribing volume
 *    for each drug. Produces: events-per-1000-prescriptions normalized
 *    safety signal that accounts for exposure.
 *
 * Data provenance: every score records its input sources, weights, and
 * computation timestamp so the derivation is fully auditable.
 */

import { getDb, DEFAULT_ORG_ID } from "@/lib/datapipe-store";
import { randomUUID } from "crypto";

export { DEFAULT_ORG_ID };

// ─── Types ─────────────────────────────────────────────────────────────

export interface CompositeScore {
  id: string;
  org_id: string;
  entity_id: string;
  score_type: "ravs" | "tmi" | "ssd";
  score_value: number;
  score_label: string;
  components: ScoreComponent[];
  input_sources: string[];
  computed_at: string;
  period: string | null;
}

export interface ScoreComponent {
  name: string;
  value: number;
  weight: number;
  contribution: number; // value * weight
  source: string;
  description: string;
}

// ─── OpenFDA Adverse Event Fetcher ─────────────────────────────────────

interface AdverseEventSummary {
  drug_name: string;
  total_reports: number;
  serious_reports: number;
  top_reactions: { reaction: string; count: number }[];
  fetched_at: string;
}

const adverseEventCache = new Map<string, AdverseEventSummary>();

async function fetchAdverseEvents(drugName: string): Promise<AdverseEventSummary | null> {
  const cacheKey = drugName.toLowerCase();
  if (adverseEventCache.has(cacheKey)) {
    return adverseEventCache.get(cacheKey)!;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(
      `https://api.fda.gov/drug/event.json?search=patient.drug.openfda.brand_name:"${encodeURIComponent(drugName)}"&limit=20`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const results = data?.results || [];

    const reactionCounts: Record<string, number> = {};
    let seriousCount = 0;

    for (const event of results) {
      if (event.serious === "1" || event.serious === 1) seriousCount++;
      const reactions = event.patient?.reaction || [];
      for (const r of reactions) {
        const term = r.reactionmeddrapt || "";
        if (term) reactionCounts[term] = (reactionCounts[term] || 0) + 1;
      }
    }

    const topReactions = Object.entries(reactionCounts)
      .map(([reaction, count]) => ({ reaction, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const summary: AdverseEventSummary = {
      drug_name: drugName,
      total_reports: results.length,
      serious_reports: seriousCount,
      top_reactions: topReactions,
      fetched_at: new Date().toISOString(),
    };

    adverseEventCache.set(cacheKey, summary);
    return summary;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ─── ClinicalTrials.gov Fetcher ────────────────────────────────────────

interface TrialSummary {
  total_trials: number;
  recruiting: number;
  completed: number;
  phase_3_plus: number;
  fetched_at: string;
}

const trialCache = new Map<string, TrialSummary>();

async function fetchTrialDensity(condition: string, state?: string): Promise<TrialSummary | null> {
  const cacheKey = `${condition.toLowerCase()}:${state || "all"}`;
  if (trialCache.has(cacheKey)) {
    return trialCache.get(cacheKey)!;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    let url = `https://clinicaltrials.gov/api/v2/studies?query.cond=${encodeURIComponent(condition)}&query.spons=Gilead&pageSize=50&format=json`;
    if (state) url += `&query.locn=${state}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const studies = data?.studies || [];

    let recruiting = 0;
    let completed = 0;
    let phase3Plus = 0;

    for (const study of studies) {
      const status = study.protocolSection?.statusModule?.overallStatus || "";
      const phases = study.protocolSection?.designModule?.phases || [];
      if (status === "RECRUITING") recruiting++;
      if (status === "COMPLETED") completed++;
      if (phases.some((p: string) => p.includes("PHASE3") || p.includes("PHASE4"))) phase3Plus++;
    }

    const summary: TrialSummary = {
      total_trials: studies.length,
      recruiting,
      completed,
      phase_3_plus: phase3Plus,
      fetched_at: new Date().toISOString(),
    };

    trialCache.set(cacheKey, summary);
    return summary;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ─── RxNorm Therapeutic Class Fetcher ──────────────────────────────────

interface RxNormSummary {
  drug_name: string;
  therapeutic_classes: string[];
  may_treat: string[];
  fetched_at: string;
}

const rxnormCache = new Map<string, RxNormSummary>();

async function fetchRxNormClasses(drugName: string): Promise<RxNormSummary | null> {
  const cacheKey = drugName.toLowerCase();
  if (rxnormCache.has(cacheKey)) {
    return rxnormCache.get(cacheKey)!;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(
      `https://rxnav.nlm.nih.gov/REST/rxclass/class/byDrugName.json?drugName=${encodeURIComponent(drugName)}&relaSource=MEDRT`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const infoList = data?.rxclassDrugInfoList?.rxclassDrugInfo || [];

    const therapeuticClasses: string[] = [];
    const mayTreat: string[] = [];

    for (const item of infoList) {
      const concept = item.rxclassMinConceptItem || {};
      if (concept.classType === "EPC") therapeuticClasses.push(concept.className || "");
      if (item.rela === "may_treat") mayTreat.push(concept.className || "");
    }

    const summary: RxNormSummary = {
      drug_name: drugName,
      therapeutic_classes: [...new Set(therapeuticClasses)],
      may_treat: [...new Set(mayTreat)],
      fetched_at: new Date().toISOString(),
    };

    rxnormCache.set(cacheKey, summary);
    return summary;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ─── DataPipe Historical Data Access ───────────────────────────────────

interface EntityKPIHistory {
  entity_id: string;
  attribute_key: string;
  periods: { period: string; value: number }[];
  latest: number | null;
  previous: number | null;
  trend: "up" | "down" | "flat" | "insufficient";
  pct_change: number;
}

function getEntityKPIHistory(orgId: string, entityId: string, attributeKey: string): EntityKPIHistory | null {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT period, value_numeric
       FROM dp_value_history
       WHERE org_id = ? AND entity_id = ? AND attribute_key = ? AND value_numeric IS NOT NULL
       ORDER BY period DESC LIMIT 12`,
    )
    .all(orgId, entityId, attributeKey) as { period: string; value_numeric: number }[];

  if (rows.length === 0) return null;

  const periods = rows.map((r) => ({ period: r.period, value: r.value_numeric }));
  const latest = rows[0]?.value_numeric ?? null;
  const previous = rows[1]?.value_numeric ?? null;

  let trend: EntityKPIHistory["trend"] = "insufficient";
  let pctChange = 0;

  if (latest !== null && previous !== null && previous !== 0) {
    pctChange = ((latest - previous) / Math.abs(previous)) * 100;
    if (Math.abs(pctChange) < 5) trend = "flat";
    else if (pctChange > 0) trend = "up";
    else trend = "down";
  }

  return {
    entity_id: entityId,
    attribute_key: attributeKey,
    periods,
    latest,
    previous,
    trend,
    pct_change: pctChange,
  };
}

function getEntityAttributeValue(orgId: string, entityId: string, key: string): string | number | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT value, value_numeric FROM dp_values WHERE org_id = ? AND entity_id = ? AND attribute_key = ?`,
    )
    .get(orgId, entityId, key) as { value: string; value_numeric: number } | undefined;

  if (!row) return null;
  return row.value_numeric ?? row.value;
}

function getAllHcpEntities(orgId: string): { id: string; canonical_name: string; identity_key: string }[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, canonical_name, identity_key FROM dp_entities
       WHERE org_id = ? AND entity_type = 'hcp' AND status = 'active'`,
    )
    .all(orgId) as { id: string; canonical_name: string; identity_key: string }[];
}

function getAllProductEntities(orgId: string): { id: string; canonical_name: string }[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, canonical_name FROM dp_entities
       WHERE org_id = ? AND entity_type = 'product' AND status = 'active'`,
    )
    .all(orgId) as { id: string; canonical_name: string }[];
}

// ─── Score 1: HCP Risk-Adjusted Value Score (RAVS) ────────────────────

/**
 * Combines:
 * - NPI validity + specialty match (from NPPES enrichment, already in dp_values)
 * - TRx trajectory (from DataPipe historical KPIs)
 * - Adverse event density for drugs this HCP prescribes (from OpenFDA)
 * - Call activity vs goal (from DataPipe)
 *
 * Score: 0-100, higher = more aligned with therapeutic goals + lower safety risk
 */
function computeRAVS(
  orgId: string,
  entityId: string,
  entityName: string,
  adverseEventsByDrug: Map<string, AdverseEventSummary>,
): CompositeScore | null {
  const components: ScoreComponent[] = [];
  const inputSources: string[] = ["NPPES NPI Registry", "OpenFDA FAERS", "DataPipe Historical KPIs"];

  // 1. NPI validity (0-15 points)
  const npiValid = getEntityAttributeValue(orgId, entityId, "npi_valid");
  const npiStatus = getEntityAttributeValue(orgId, entityId, "npi_status");
  const npiScore = npiValid === "true" && npiStatus === "active" ? 15 : npiValid === "true" ? 10 : 0;
  components.push({
    name: "NPI Validity",
    value: npiScore,
    weight: 0.15,
    contribution: npiScore * 0.15,
    source: "NPPES NPI Registry",
    description: npiValid === "true" ? `NPI active: ${npiStatus}` : "NPI not validated",
  });

  // 2. Specialty alignment (0-15 points)
  const specialty = String(getEntityAttributeValue(orgId, entityId, "primary_taxonomy") || getEntityAttributeValue(orgId, entityId, "specialty") || "");
  const isInfectiousDisease = /infectious|hiv|id/i.test(specialty);
  const isInternalMedicine = /internal/i.test(specialty);
  const specialtyScore = isInfectiousDisease ? 15 : isInternalMedicine ? 10 : 5;
  components.push({
    name: "Specialty Alignment",
    value: specialtyScore,
    weight: 0.15,
    contribution: specialtyScore * 0.15,
    source: "NPPES NPI Registry",
    description: `Specialty: ${specialty || "unknown"}`,
  });

  // 3. TRx trajectory (0-25 points)
  const trxHistory = getEntityKPIHistory(orgId, entityId, "trx_biktarvy") ||
    getEntityKPIHistory(orgId, entityId, "trx_total") ||
    getEntityKPIHistory(orgId, entityId, "trx_descovy");
  let trxScore = 10; // neutral default
  if (trxHistory) {
    if (trxHistory.trend === "up") trxScore = 25;
    else if (trxHistory.trend === "flat") trxScore = 15;
    else if (trxHistory.trend === "down") trxScore = 5;
  }
  components.push({
    name: "TRx Trajectory",
    value: trxScore,
    weight: 0.25,
    contribution: trxScore * 0.25,
    source: "DataPipe Historical KPIs",
    description: trxHistory
      ? `Trend: ${trxHistory.trend} (${trxHistory.pct_change.toFixed(1)}% period-over-period)`
      : "Insufficient historical data",
  });

  // 4. Safety signal exposure (0-25 points, inverted — lower adverse events = higher score)
  const drugName = getEntityAttributeValue(orgId, entityId, "primary_drug") as string;
  let safetyScore = 15; // neutral default
  if (drugName) {
    const adverseEvents = adverseEventsByDrug.get(drugName.toLowerCase());
    if (adverseEvents) {
      const seriousRatio = adverseEvents.total_reports > 0
        ? adverseEvents.serious_reports / adverseEvents.total_reports
        : 0;
      // Lower serious ratio = higher score
      safetyScore = Math.round((1 - seriousRatio) * 25);
    }
  } else {
    // Aggregate safety across all known drugs
    let totalReports = 0;
    let totalSerious = 0;
    for (const [, summary] of adverseEventsByDrug) {
      totalReports += summary.total_reports;
      totalSerious += summary.serious_reports;
    }
    if (totalReports > 0) {
      const seriousRatio = totalSerious / totalReports;
      safetyScore = Math.round((1 - seriousRatio) * 25);
    }
  }
  components.push({
    name: "Safety Signal Exposure",
    value: safetyScore,
    weight: 0.25,
    contribution: safetyScore * 0.25,
    source: "OpenFDA FAERS",
    description: drugName
      ? `Adverse event analysis for ${drugName}`
      : `Aggregate adverse event analysis across ${adverseEventsByDrug.size} drugs`,
  });

  // 5. Call activity vs goal (0-20 points)
  const callActivity = getEntityAttributeValue(orgId, entityId, "call_activity") as number;
  const callGoal = getEntityAttributeValue(orgId, entityId, "call_goal") as number;
  let callScore = 10;
  if (callActivity !== null && callGoal !== null && Number(callGoal) > 0) {
    const ratio = Number(callActivity) / Number(callGoal);
    callScore = Math.min(20, Math.round(ratio * 20));
  }
  components.push({
    name: "Call Activity vs Goal",
    value: callScore,
    weight: 0.20,
    contribution: callScore * 0.20,
    source: "DataPipe Ingested KPIs",
    description: callActivity !== null && callGoal !== null
      ? `${callActivity}/${callGoal} calls (${((Number(callActivity) / Number(callGoal)) * 100).toFixed(0)}%)`
      : "No call data available",
  });

  const totalScore = Math.round(components.reduce((sum, c) => sum + c.contribution, 0));

  return {
    id: randomUUID(),
    org_id: orgId,
    entity_id: entityId,
    score_type: "ravs",
    score_value: totalScore,
    score_label: totalScore >= 70 ? "High Value" : totalScore >= 40 ? "Medium Value" : "Low Value",
    components,
    input_sources: inputSources,
    computed_at: new Date().toISOString(),
    period: null,
  };
}

// ─── Score 2: Territory Momentum Index (TMI) ──────────────────────────

/**
 * Combines:
 * - DataPipe period-over-period KPI deltas (TRx, NRx, market_share)
 * - ClinicalTrials.gov trial density in the territory's state
 * - Adverse event trend direction for drugs prescribed in the territory
 *
 * Score: -100 to +100, positive = growing momentum, negative = declining
 */
function computeTMI(
  orgId: string,
  entityId: string,
  state: string,
  condition: string,
  trialSummaries: Map<string, TrialSummary>,
  adverseEventsByDrug: Map<string, AdverseEventSummary>,
): CompositeScore | null {
  const components: ScoreComponent[] = [];
  const inputSources: string[] = ["DataPipe Historical KPIs", "ClinicalTrials.gov", "OpenFDA FAERS"];

  // 1. TRx momentum (weight: 0.35)
  const trxHistory = getEntityKPIHistory(orgId, entityId, "trx_total") ||
    getEntityKPIHistory(orgId, entityId, "trx_biktarvy");
  let trxMomentum = 0;
  if (trxHistory && trxHistory.latest !== null && trxHistory.previous !== null) {
    trxMomentum = Math.max(-100, Math.min(100, trxHistory.pct_change * 2));
  }
  components.push({
    name: "TRx Momentum",
    value: trxMomentum,
    weight: 0.35,
    contribution: trxMomentum * 0.35,
    source: "DataPipe Historical KPIs",
    description: trxHistory
      ? `${trxHistory.pct_change.toFixed(1)}% period-over-period`
      : "Insufficient historical data",
  });

  // 2. Market share momentum (weight: 0.25)
  const msHistory = getEntityKPIHistory(orgId, entityId, "market_share");
  let msMomentum = 0;
  if (msHistory && msHistory.latest !== null && msHistory.previous !== null) {
    msMomentum = Math.max(-100, Math.min(100, msHistory.pct_change * 1.5));
  }
  components.push({
    name: "Market Share Momentum",
    value: msMomentum,
    weight: 0.25,
    contribution: msMomentum * 0.25,
    source: "DataPipe Historical KPIs",
    description: msHistory
      ? `${msHistory.pct_change.toFixed(1)}% period-over-period`
      : "No market share data",
  });

  // 3. Clinical trial density (weight: 0.25)
  const trialKey = `${condition.toLowerCase()}:${state.toLowerCase()}`;
  const trials = trialSummaries.get(trialKey);
  let trialScore = 0;
  if (trials) {
    // More recruiting trials = positive momentum signal
    trialScore = (trials.recruiting * 10) + (trials.phase_3_plus * 5);
    trialScore = Math.max(-50, Math.min(100, trialScore));
  }
  components.push({
    name: "Clinical Trial Density",
    value: trialScore,
    weight: 0.25,
    contribution: trialScore * 0.25,
    source: "ClinicalTrials.gov",
    description: trials
      ? `${trials.total_trials} trials (${trials.recruiting} recruiting, ${trials.phase_3_plus} phase 3+)`
      : "No trial data fetched",
  });

  // 4. Safety signal trend (weight: 0.15, inverted)
  let totalAdverseReports = 0;
  let totalSeriousReports = 0;
  for (const [, summary] of adverseEventsByDrug) {
    totalAdverseReports += summary.total_reports;
    totalSeriousReports += summary.serious_reports;
  }
  const seriousRatio = totalAdverseReports > 0 ? totalSeriousReports / totalAdverseReports : 0.5;
  const safetyMomentum = Math.round((0.5 - seriousRatio) * 100);
  components.push({
    name: "Safety Signal Trend",
    value: safetyMomentum,
    weight: 0.15,
    contribution: safetyMomentum * 0.15,
    source: "OpenFDA FAERS",
    description: `${totalSeriousReports} serious / ${totalAdverseReports} total reports across drugs`,
  });

  const totalScore = Math.round(components.reduce((sum, c) => sum + c.contribution, 0));

  return {
    id: randomUUID(),
    org_id: orgId,
    entity_id: entityId,
    score_type: "tmi",
    score_value: totalScore,
    score_label: totalScore >= 30 ? "Accelerating" : totalScore >= 0 ? "Stable" : totalScore >= -30 ? "Slowing" : "Declining",
    components,
    input_sources: inputSources,
    computed_at: new Date().toISOString(),
    period: null,
  };
}

// ─── Score 3: Safety Signal Density (SSD) ─────────────────────────────

/**
 * Combines:
 * - OpenFDA FAERS adverse event counts per drug
 * - RxNorm therapeutic class cross-referencing (class-wide signal vs drug-specific)
 * - DataPipe prescribing volume for normalization (events per 1000 TRx)
 *
 * Score: 0-100, higher = denser safety signal (more adverse events per exposure unit)
 */
async function computeSSD(
  orgId: string,
  productEntityId: string,
  productName: string,
  trxVolume: number | null,
): Promise<CompositeScore | null> {
  const components: ScoreComponent[] = [];
  const inputSources: string[] = ["OpenFDA FAERS", "RxNorm/RxClass", "DataPipe KPIs"];

  // 1. Raw adverse event count (0-40 points)
  const adverseEvents = await fetchAdverseEvents(productName);
  let rawEventScore = 0;
  if (adverseEvents) {
    // Normalize: 0 reports = 0, 50+ reports = 40
    rawEventScore = Math.min(40, Math.round((adverseEvents.total_reports / 50) * 40));
  }
  components.push({
    name: "Raw Adverse Event Volume",
    value: rawEventScore,
    weight: 0.40,
    contribution: rawEventScore * 0.40,
    source: "OpenFDA FAERS",
    description: adverseEvents
      ? `${adverseEvents.total_reports} reports (${adverseEvents.serious_reports} serious)`
      : "No adverse event data",
  });

  // 2. Serious event ratio (0-30 points)
  let seriousScore = 0;
  if (adverseEvents && adverseEvents.total_reports > 0) {
    const ratio = adverseEvents.serious_reports / adverseEvents.total_reports;
    seriousScore = Math.round(ratio * 30);
  }
  components.push({
    name: "Serious Event Ratio",
    value: seriousScore,
    weight: 0.30,
    contribution: seriousScore * 0.30,
    source: "OpenFDA FAERS",
    description: adverseEvents && adverseEvents.total_reports > 0
      ? `${((adverseEvents.serious_reports / adverseEvents.total_reports) * 100).toFixed(1)}% serious`
      : "No data",
  });

  // 3. Therapeutic class cross-reference (0-15 points)
  const rxnorm = await fetchRxNormClasses(productName);
  let classScore = 0;
  if (rxnorm && rxnorm.therapeutic_classes.length > 0) {
    // More therapeutic classes = broader exposure = higher class-wide signal potential
    classScore = Math.min(15, rxnorm.therapeutic_classes.length * 3);
  }
  components.push({
    name: "Therapeutic Class Breadth",
    value: classScore,
    weight: 0.15,
    contribution: classScore * 0.15,
    source: "RxNorm/RxClass",
    description: rxnorm
      ? `${rxnorm.therapeutic_classes.length} classes: ${rxnorm.therapeutic_classes.slice(0, 3).join(", ")}`
      : "No RxNorm data",
  });

  // 4. Exposure-normalized signal (0-15 points)
  let exposureScore = 0;
  if (adverseEvents && trxVolume !== null && trxVolume > 0) {
    // Events per 1000 TRx — higher = denser signal relative to exposure
    const eventsPerK = (adverseEvents.total_reports / trxVolume) * 1000;
    exposureScore = Math.min(15, Math.round(eventsPerK * 3));
  }
  components.push({
    name: "Exposure-Normalized Signal",
    value: exposureScore,
    weight: 0.15,
    contribution: exposureScore * 0.15,
    source: "DataPipe KPIs + OpenFDA",
    description: adverseEvents && trxVolume !== null && trxVolume > 0
      ? `${((adverseEvents.total_reports / trxVolume) * 1000).toFixed(2)} events per 1000 TRx`
      : "No TRx volume for normalization",
  });

  const totalScore = Math.round(components.reduce((sum, c) => sum + c.contribution, 0));

  return {
    id: randomUUID(),
    org_id: orgId,
    entity_id: productEntityId,
    score_type: "ssd",
    score_value: totalScore,
    score_label: totalScore >= 60 ? "High Signal" : totalScore >= 30 ? "Moderate Signal" : "Low Signal",
    components,
    input_sources: inputSources,
    computed_at: new Date().toISOString(),
    period: null,
  };
}

// ─── Score Persistence ─────────────────────────────────────────────────

function ensureScoreTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS dp_composite_scores (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      entity_id     TEXT NOT NULL,
      score_type    TEXT NOT NULL,
      score_value   REAL NOT NULL,
      score_label   TEXT NOT NULL,
      components    TEXT NOT NULL DEFAULT '[]',
      input_sources TEXT NOT NULL DEFAULT '[]',
      period        TEXT,
      computed_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_dp_score_org ON dp_composite_scores(org_id);
    CREATE INDEX IF NOT EXISTS idx_dp_score_type ON dp_composite_scores(org_id, score_type);
    CREATE INDEX IF NOT EXISTS idx_dp_score_entity ON dp_composite_scores(org_id, entity_id);
    CREATE INDEX IF NOT EXISTS idx_dp_score_value ON dp_composite_scores(org_id, score_type, score_value DESC);
  `);
}

function persistScore(score: CompositeScore): void {
  const db = getDb();
  // Delete previous score of same type for same entity (keep only latest)
  db.prepare(
    `DELETE FROM dp_composite_scores WHERE org_id = ? AND entity_id = ? AND score_type = ?`,
  ).run(score.org_id, score.entity_id, score.score_type);

  db.prepare(
    `INSERT INTO dp_composite_scores (id, org_id, entity_id, score_type, score_value, score_label, components, input_sources, period, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    score.id,
    score.org_id,
    score.entity_id,
    score.score_type,
    score.score_value,
    score.score_label,
    JSON.stringify(score.components),
    JSON.stringify(score.input_sources),
    score.period,
    score.computed_at,
  );
}

// ─── Public API ────────────────────────────────────────────────────────

export interface ScoreComputationResult {
  ravs_computed: number;
  tmi_computed: number;
  ssd_computed: number;
  errors: string[];
  duration_ms: number;
}

/**
 * Compute all composite scores for an org.
 * Fetches real data from OpenFDA, ClinicalTrials.gov, and RxNorm,
 * combines with DataPipe historical KPIs, and persists results.
 */
export async function computeAllScores(orgId: string = DEFAULT_ORG_ID): Promise<ScoreComputationResult> {
  const startTime = Date.now();
  ensureScoreTable();

  const errors: string[] = [];
  let ravsCount = 0;
  let tmiCount = 0;
  let ssdCount = 0;

  // ─── Fetch adverse events for all known Gilead drugs ───
  const gileadDrugs = ["Biktarvy", "Descovy", "Truvada", "Genvoya", "Complera", "Stribild", "Vemlidy", "Harvoni", "Epclusa", "Vosevi", "Trodelvy", "Yescarta", "Tecartus", "Veklury"];
  const adverseEventsByDrug = new Map<string, AdverseEventSummary>();

  for (const drug of gileadDrugs) {
    const summary = await fetchAdverseEvents(drug);
    if (summary) adverseEventsByDrug.set(drug.toLowerCase(), summary);
  }

  // ─── Fetch trial density for key conditions in key states ───
  const conditions = ["HIV", "PrEP", "Hepatitis C"];
  const states = ["CA", "NY", "TX", "FL", "IL"];
  const trialSummaries = new Map<string, TrialSummary>();

  for (const cond of conditions) {
    for (const state of states) {
      const summary = await fetchTrialDensity(cond, state);
      if (summary) trialSummaries.set(`${cond.toLowerCase()}:${state.toLowerCase()}`, summary);
    }
  }

  // ─── Compute RAVS for each HCP ───
  const hcps = getAllHcpEntities(orgId);
  for (const hcp of hcps) {
    try {
      const score = computeRAVS(orgId, hcp.id, hcp.canonical_name, adverseEventsByDrug);
      if (score) {
        persistScore(score);
        ravsCount++;
      }
    } catch (e: any) {
      errors.push(`RAVS for ${hcp.canonical_name}: ${e.message}`);
    }
  }

  // ─── Compute TMI for each territory ───
  const db = getDb();
  const territories = db
    .prepare(
      `SELECT id, canonical_name FROM dp_entities WHERE org_id = ? AND entity_type = 'territory' AND status = 'active'`,
    )
    .all(orgId) as { id: string; canonical_name: string }[];

  for (const territory of territories) {
    try {
      // Extract state from territory name or identity key
      const stateMatch = territory.canonical_name.match(/[A-Z]{2}$/);
      const state = stateMatch ? stateMatch[0] : "CA";
      const condition = "HIV"; // default condition for Gilead territories
      const score = computeTMI(orgId, territory.id, state, condition, trialSummaries, adverseEventsByDrug);
      if (score) {
        persistScore(score);
        tmiCount++;
      }
    } catch (e: any) {
      errors.push(`TMI for ${territory.canonical_name}: ${e.message}`);
    }
  }

  // ─── Compute SSD for each product ───
  const products = getAllProductEntities(orgId);
  for (const product of products) {
    try {
      const trxVolume = getEntityAttributeValue(orgId, product.id, "trx_total") as number;
      const score = await computeSSD(orgId, product.id, product.canonical_name, trxVolume);
      if (score) {
        persistScore(score);
        ssdCount++;
      }
    } catch (e: any) {
      errors.push(`SSD for ${product.canonical_name}: ${e.message}`);
    }
  }

  // If no product entities exist, compute SSD for known Gilead drugs directly
  if (products.length === 0) {
    for (const drug of gileadDrugs.slice(0, 5)) {
      try {
        // Create a synthetic entity ID for standalone drug scores
        const syntheticId = `drug_${drug.toLowerCase()}`;
        const score = await computeSSD(orgId, syntheticId, drug, null);
        if (score) {
          persistScore(score);
          ssdCount++;
        }
      } catch (e: any) {
        errors.push(`SSD for ${drug}: ${e.message}`);
      }
    }
  }

  return {
    ravs_computed: ravsCount,
    tmi_computed: tmiCount,
    ssd_computed: ssdCount,
    errors,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Retrieve computed scores, optionally filtered by type.
 */
export function getScores(
  orgId: string = DEFAULT_ORG_ID,
  options: { scoreType?: string; limit?: number; offset?: number } = {},
): { scores: (CompositeScore & { entity_name: string; entity_type: string })[]; total: number } {
  ensureScoreTable();
  const db = getDb();
  const limit = options.limit || 50;
  const offset = options.offset || 0;

  let whereClause = "WHERE s.org_id = ?";
  const params: any[] = [orgId];
  if (options.scoreType) {
    whereClause += " AND s.score_type = ?";
    params.push(options.scoreType);
  }

  const total = (db.prepare(`SELECT count(*) as c FROM dp_composite_scores s ${whereClause}`).get(...params) as { c: number }).c;

  const rows = db
    .prepare(
      `SELECT s.*, e.canonical_name as entity_name, e.entity_type
       FROM dp_composite_scores s
       LEFT JOIN dp_entities e ON e.id = s.entity_id
       ${whereClause}
       ORDER BY s.score_type, s.score_value DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as any[];

  const scores = rows.map((r) => ({
    id: r.id,
    org_id: r.org_id,
    entity_id: r.entity_id,
    entity_name: r.entity_name || r.entity_id,
    entity_type: r.entity_type || "unknown",
    score_type: r.score_type,
    score_value: r.score_value,
    score_label: r.score_label,
    components: JSON.parse(r.components || "[]"),
    input_sources: JSON.parse(r.input_sources || "[]"),
    period: r.period,
    computed_at: r.computed_at,
  }));

  return { scores, total };
}

/**
 * Get score summary stats for dashboard.
 */
export function getScoreSummary(orgId: string = DEFAULT_ORG_ID): {
  total_scores: number;
  by_type: Record<string, { count: number; avg: number; min: number; max: number }>;
  top_ravs: CompositeScore[];
  top_tmi: CompositeScore[];
  top_ssd: CompositeScore[];
} {
  ensureScoreTable();
  const db = getDb();

  const totalScores = (db.prepare(`SELECT count(*) as c FROM dp_composite_scores WHERE org_id = ?`).get(orgId) as { c: number }).c;

  const typeRows = db
    .prepare(
      `SELECT score_type, count(*) as count, avg(score_value) as avg, min(score_value) as min, max(score_value) as max
       FROM dp_composite_scores WHERE org_id = ? GROUP BY score_type`,
    )
    .all(orgId) as any[];

  const byType: Record<string, { count: number; avg: number; min: number; max: number }> = {};
  for (const r of typeRows) {
    byType[r.score_type] = {
      count: r.count,
      avg: Math.round(r.avg * 10) / 10,
      min: r.min,
      max: r.max,
    };
  }

  const topByType = (type: string) =>
    db
      .prepare(
        `SELECT s.*, e.canonical_name as entity_name, e.entity_type
         FROM dp_composite_scores s
         LEFT JOIN dp_entities e ON e.id = s.entity_id
         WHERE s.org_id = ? AND s.score_type = ?
         ORDER BY s.score_value DESC LIMIT 5`,
      )
      .all(orgId, type)
      .map((r: any) => ({
        id: r.id,
        org_id: r.org_id,
        entity_id: r.entity_id,
        entity_name: r.entity_name || r.entity_id,
        entity_type: r.entity_type || "unknown",
        score_type: r.score_type,
        score_value: r.score_value,
        score_label: r.score_label,
        components: JSON.parse(r.components || "[]"),
        input_sources: JSON.parse(r.input_sources || "[]"),
        period: r.period,
        computed_at: r.computed_at,
      })) as CompositeScore[];

  return {
    total_scores: totalScores,
    by_type: byType,
    top_ravs: topByType("ravs"),
    top_tmi: topByType("tmi"),
    top_ssd: topByType("ssd"),
  };
}
