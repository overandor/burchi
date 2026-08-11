/**
 * Outreach Ledger — tracks compliant email probes, HCP responses,
 * and pharma sample pickups. Feeds outcomes back into the leaderboard
 * scoring system so outreach activity advances the rep's node score.
 *
 * Compliance boundaries:
 *   - Probes offer VALUE (research papers, market updates) — not promotion.
 *   - No product claims, no off-label references, no inducement.
 *   - Opt-out tracking on every HCP.
 *   - Sample pickups require HCP consent + license verification.
 *   - All activity is audit-logged.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";

const OUTREACH_PATH = process.env.OUTREACH_DB_PATH || join(tmpdir(), "outreach-ledger.json");

export type ProbeType = "research_paper" | "market_update" | "clinical_trial_update" | "formulary_update";
export type ProbeStatus = "drafted" | "sent" | "opened" | "responded" | "opted_out" | "bounced";
export type SampleStatus = "requested" | "scheduled" | "picked_up" | "delivered" | "declined" | "expired";

export interface OutreachProbe {
  id: string;
  employeeId: string;
  accountId: string;
  accountName: string;
  hcpName: string;
  hcpEmail: string;
  probeType: ProbeType;
  subject: string;
  body: string;
  status: ProbeStatus;
  sentAt: string | null;
  openedAt: string | null;
  respondedAt: string | null;
  responseSummary: string | null;
  optedOut: boolean;
  complianceChecked: boolean;
  complianceNotes: string;
  createdAt: string;
}

export interface SamplePickup {
  id: string;
  employeeId: string;
  accountId: string;
  accountName: string;
  hcpName: string;
  hcpEmail: string;
  sampleType: string;
  quantity: number;
  status: SampleStatus;
  scheduledDate: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  hcpConsent: boolean;
  licenseVerified: boolean;
  licenseNumber: string | null;
  notes: string;
  createdAt: string;
}

interface OutreachDB {
  probes: Record<string, OutreachProbe>;
  samples: Record<string, SamplePickup>;
}

let _cache: OutreachDB | null = null;

function loadDB(): OutreachDB {
  if (_cache) return _cache;
  try {
    if (existsSync(OUTREACH_PATH)) {
      _cache = JSON.parse(readFileSync(OUTREACH_PATH, "utf-8"));
    } else {
      _cache = { probes: {}, samples: {} };
      saveDB();
    }
  } catch {
    _cache = { probes: {}, samples: {} };
  }
  return _cache!;
}

function saveDB(): void {
  try {
    const dir = dirname(OUTREACH_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(OUTREACH_PATH, JSON.stringify(_cache, null, 2));
  } catch {
    // Ephemeral filesystem — cache still works for request duration
  }
}

function genId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
}

// ─── Probe CRUD ────────────────────────────────────────────────────

export function createProbe(input: Omit<OutreachProbe, "id" | "createdAt" | "status" | "sentAt" | "openedAt" | "respondedAt" | "responseSummary" | "optedOut">): OutreachProbe {
  const db = loadDB();
  const probe: OutreachProbe = {
    ...input,
    id: genId("probe"),
    status: "drafted",
    sentAt: null,
    openedAt: null,
    respondedAt: null,
    responseSummary: null,
    optedOut: false,
    createdAt: new Date().toISOString(),
  };
  db.probes[probe.id] = probe;
  saveDB();
  return probe;
}

export function updateProbe(id: string, updates: Partial<OutreachProbe>): OutreachProbe | null {
  const db = loadDB();
  const probe = db.probes[id];
  if (!probe) return null;
  Object.assign(probe, updates);
  saveDB();
  return probe;
}

export function markProbeSent(id: string): OutreachProbe | null {
  return updateProbe(id, { status: "sent", sentAt: new Date().toISOString() });
}

export function markProbeResponded(id: string, responseSummary: string): OutreachProbe | null {
  return updateProbe(id, {
    status: "responded",
    respondedAt: new Date().toISOString(),
    responseSummary,
  });
}

export function markProbeOptedOut(id: string): OutreachProbe | null {
  return updateProbe(id, { optedOut: true, status: "opted_out" });
}

export function loadProbes(employeeId?: string): OutreachProbe[] {
  const db = loadDB();
  const all = Object.values(db.probes);
  return employeeId ? all.filter((p) => p.employeeId === employeeId) : all;
}

export function loadProbe(id: string): OutreachProbe | null {
  return loadDB().probes[id] || null;
}

// ─── Sample CRUD ───────────────────────────────────────────────────

export function createSamplePickup(input: Omit<SamplePickup, "id" | "createdAt" | "status" | "scheduledDate" | "pickedUpAt" | "deliveredAt">): SamplePickup {
  const db = loadDB();
  const sample: SamplePickup = {
    ...input,
    id: genId("sample"),
    status: "requested",
    scheduledDate: null,
    pickedUpAt: null,
    deliveredAt: null,
    createdAt: new Date().toISOString(),
  };
  db.samples[sample.id] = sample;
  saveDB();
  return sample;
}

export function updateSample(id: string, updates: Partial<SamplePickup>): SamplePickup | null {
  const db = loadDB();
  const sample = db.samples[id];
  if (!sample) return null;
  Object.assign(sample, updates);
  saveDB();
  return sample;
}

export function scheduleSample(id: string, scheduledDate: string): SamplePickup | null {
  return updateSample(id, { status: "scheduled", scheduledDate });
}

export function markSamplePickedUp(id: string): SamplePickup | null {
  return updateSample(id, { status: "picked_up", pickedUpAt: new Date().toISOString() });
}

export function markSampleDelivered(id: string): SamplePickup | null {
  return updateSample(id, { status: "delivered", deliveredAt: new Date().toISOString() });
}

export function loadSamples(employeeId?: string): SamplePickup[] {
  const db = loadDB();
  const all = Object.values(db.samples);
  return employeeId ? all.filter((s) => s.employeeId === employeeId) : all;
}

// ─── Compliance ────────────────────────────────────────────────────

/**
 * Compliance check for an email probe.
 * Returns { passed, issues } — the probe should only be sent if passed.
 */
export function complianceCheckProbe(subject: string, body: string): {
  passed: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  const lower = (subject + " " + body).toLowerCase();

  // No product claims
  const productClaimPatterns = [
    /\b(effective|safe|efficacy|proven|clinically proven|superior|better than)\b/i,
    /\b(indicated for|treats|cures|prevents|reduces risk)\b/i,
    /\b(off-label|unapproved use|investigational use)\b/i,
  ];
  for (const pattern of productClaimPatterns) {
    if (pattern.test(lower)) {
      issues.push("Potential product claim detected — probes must offer value, not promotion");
    }
  }

  // No inducement
  const inducementPatterns = [
    /\b(gift|free sample|complimentary|incentive|reward|kickback|bribe)\b/i,
    /\b(\$|dollar|payment|compensation|honorarium)\b/i,
  ];
  for (const pattern of inducementPatterns) {
    if (pattern.test(lower)) {
      issues.push("Potential inducement detected — no financial or material incentives");
    }
  }

  // Must include opt-out
  if (!lower.includes("unsubscribe") && !lower.includes("opt-out") && !lower.includes("opt out")) {
    issues.push("Missing opt-out mechanism — required for compliant outreach");
  }

  // Must be educational/research value
  const valueKeywords = ["research", "study", "clinical trial", "data", "analysis", "update", "review", "publication", "findings", "market"];
  const hasValue = valueKeywords.some((kw) => lower.includes(kw));
  if (!hasValue) {
    issues.push("No clear educational/research value detected — probes must offer genuine information value");
  }

  return { passed: issues.length === 0, issues };
}

/**
 * Compliance check for a sample pickup.
 * Requires HCP consent + license verification.
 */
export function complianceCheckSample(hcpConsent: boolean, licenseVerified: boolean, licenseNumber: string | null): {
  passed: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  if (!hcpConsent) issues.push("HCP consent required before sample delivery");
  if (!licenseVerified) issues.push("HCP license must be verified");
  if (!licenseNumber) issues.push("License number is required for audit trail");
  return { passed: issues.length === 0, issues };
}

// ─── Leaderboard integration ───────────────────────────────────────

/**
 * Compute outreach metrics for an employee — feeds into the leaderboard.
 * Each responded probe = information gained.
 * Each delivered sample = causal lift contribution.
 * Each opt-out = compliance-positive (respecting preferences).
 */
export function computeOutreachMetrics(employeeId: string): {
  probesSent: number;
  probesResponded: number;
  probesOpened: number;
  optOuts: number;
  samplesDelivered: number;
  samplesScheduled: number;
  responseRate: number;
  informationGained: number;
  causalLiftContribution: number;
} {
  const probes = loadProbes(employeeId);
  const samples = loadSamples(employeeId);

  const probesSent = probes.filter((p) => p.status === "sent" || p.status === "opened" || p.status === "responded").length;
  const probesResponded = probes.filter((p) => p.status === "responded").length;
  const probesOpened = probes.filter((p) => p.status === "opened" || p.status === "responded").length;
  const optOuts = probes.filter((p) => p.optedOut).length;
  const samplesDelivered = samples.filter((s) => s.status === "delivered").length;
  const samplesScheduled = samples.filter((s) => s.status === "scheduled" || s.status === "picked_up" || s.status === "delivered").length;

  const responseRate = probesSent > 0 ? probesResponded / probesSent : 0;

  // Leaderboard contributions
  // Each response = 0.3 information gained (learning about HCP preferences)
  // Each delivered sample = 0.2 causal lift (relationship + access)
  // Opt-outs handled = 0.1 compliance-positive
  const informationGained = probesResponded * 0.3 + probesOpened * 0.1;
  const causalLiftContribution = samplesDelivered * 0.2 + optOuts * 0.05;

  return {
    probesSent,
    probesResponded,
    probesOpened,
    optOuts,
    samplesDelivered,
    samplesScheduled,
    responseRate: Math.round(responseRate * 100) / 100,
    informationGained: Math.round(informationGained * 100) / 100,
    causalLiftContribution: Math.round(causalLiftContribution * 100) / 100,
  };
}
