import { NextRequest, NextResponse } from "next/server";
import { listClientContinuityByOrg, DEFAULT_ORG_ID } from "@/lib/db";
import type { KOLProfile } from "@/lib/kol/real";

export const dynamic = "force-dynamic";

/**
 * GET /api/kol/profiles?orgId=...
 *
 * Returns KOL intelligence derived from real client_continuity records
 * instead of the legacy hardcoded seed data.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("orgId") || DEFAULT_ORG_ID;
    const rows = listClientContinuityByOrg(orgId);
    const profiles = rows.map(mapClientContinuityToKOL);
    return NextResponse.json({ profiles, count: profiles.length });
  } catch (e: any) {
    console.error("[api/kol/profiles] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function mapClientContinuityToKOL(row: any): KOLProfile {
  const communicationHistory: any[] = safeJson(row.communication_history);
  const activeCommitments: string[] = safeJson(row.active_commitments);
  const escalationBoundaries: string[] = safeJson(row.escalation_boundaries);

  const authorityLevel = (row.authority_level || "").toLowerCase();
  const relationship = (row.relationship || "").toLowerCase();

  const tier: KOLProfile["tier"] =
    authorityLevel === "high" ? "national" :
    authorityLevel === "medium" ? "regional" : "local";

  const sentiment: KOLProfile["sentiment"] =
    relationship.includes("advocate") || relationship.includes("champion") ? "advocate" :
    relationship.includes("skeptic") || relationship.includes("critic") ? "skeptic" : "neutral";

  const influenceScore = authorityLevel === "high" ? 80 : authorityLevel === "medium" ? 50 : authorityLevel === "low" ? 25 : 10;
  const relationshipStrength = sentiment === "advocate" ? 80 : sentiment === "skeptic" ? 35 : 55;

  const networkReach = Math.min(communicationHistory.length * 5, 100) || 1;
  const contentResonance = Math.min(activeCommitments.length * 20, 100);
  const evidenceSources = communicationHistory.length + activeCommitments.length;

  const inbound = communicationHistory.filter((h) => h?.direction === "inbound").length;
  const outbound = communicationHistory.filter((h) => h?.direction === "outbound").length;
  const total = inbound + outbound || 1;
  const engagementTrend = Math.max(-1, Math.min(1, (inbound - outbound) / total));

  const lastInteraction = row.last_interaction_at || row.updated_at || row.created_at || new Date().toISOString();

  const preferred = (row.preferred_speaker || "email").toLowerCase();
  const recommendedChannel: KOLProfile["recommendedChannel"] =
    ["in_person", "remote", "email", "phone"].includes(preferred) ? (preferred as any) : "email";

  const name = row.person_name || row.person_id || "Unknown";
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s: string) => s[0]?.toUpperCase())
    .join("");

  return {
    id: row.id,
    name,
    initials: initials || "?",
    specialty: "Unknown",
    institution: "Unknown",
    territory: "Unknown",
    tier,
    sentiment,
    influenceScore,
    networkReach,
    publications: 0,
    trials: 0,
    evidenceSources,
    lastInteraction,
    engagementTrend,
    relationshipStrength,
    contentResonance,
    prescribingChange: 0,
    barrierFocus: escalationBoundaries,
    contentAffinities: activeCommitments,
    nextBestAction: `Engage via ${recommendedChannel} — ${relationship || "neutral"} relationship, ${authorityLevel || "low"} authority.`,
    recommendedChannel,
    approvedContentIds: [],
    connectedKOLs: [],
  };
}

function safeJson<T>(value: any): T {
  if (!value || value === "[]" || value === "{}") return [] as any;
  try {
    return JSON.parse(value);
  } catch {
    return [] as any;
  }
}
