/* ──────────────────────────────────────────────────────────────────
 * Advantage Foundry — KOL intelligence helpers backed by real data.
 * No hardcoded mock profiles. Use these with data from /api/kol/profiles.
 * ────────────────────────────────────────────────────────────────── */

export type KOLTier = "global" | "national" | "regional" | "local";
export type KOLSentiment = "advocate" | "neutral" | "skeptic" | "unknown";

export interface KOLProfile {
  id: string;
  name: string;
  initials: string;
  specialty: string;
  subSpecialty?: string;
  institution: string;
  territory: string;
  tier: KOLTier;
  sentiment: KOLSentiment;
  influenceScore: number; // 0-100
  networkReach: number; // estimated HCPs in sphere
  publications: number;
  trials: number;
  evidenceSources: number;
  lastInteraction: string; // ISO date
  engagementTrend: number; // -1 to 1
  relationshipStrength: number; // 0-100
  contentResonance: number; // 0-100
  prescribingChange: number; // -25 to +25%
  barrierFocus: string[];
  contentAffinities: string[];
  nextBestAction: string;
  recommendedChannel: "in_person" | "remote" | "email" | "phone";
  approvedContentIds: string[];
  connectedKOLs: string[]; // ids
}

export interface KOLLeaderboardEntry {
  rank: number;
  profile: KOLProfile;
  leaderScore: number;
  dimensions: {
    influence: number;
    reach: number;
    evidence: number;
    resonance: number;
    relationship: number;
    engagement: number;
  };
  momentum: "rising" | "stable" | "falling";
}

export function computeKOLScore(k: KOLProfile, weights = {
  influence: 0.25,
  reach: 0.15,
  evidence: 0.15,
  resonance: 0.15,
  relationship: 0.15,
  engagement: 0.15,
}): number {
  const influence = k.influenceScore;
  const reach = Math.min(k.networkReach / 100, 100);
  const evidence = Math.min(k.evidenceSources / 20, 100) * 100;
  const resonance = k.contentResonance;
  const relationship = k.relationshipStrength;
  const engagement = (k.engagementTrend + 1) * 50;

  return (
    influence * weights.influence +
    reach * weights.reach +
    evidence * weights.evidence +
    resonance * weights.resonance +
    relationship * weights.relationship +
    engagement * weights.engagement
  );
}

export function tierRank(tier: KOLTier): number {
  return { global: 4, national: 3, regional: 2, local: 1 }[tier] ?? 0;
}

export function sentimentEmoji(sentiment: KOLSentiment): string {
  return {
    advocate: "▲",
    neutral: "●",
    skeptic: "▼",
    unknown: "?",
  }[sentiment];
}

export function sentimentColor(sentiment: KOLSentiment): string {
  return {
    advocate: "hsl(var(--spinor-green))",
    neutral: "hsl(var(--spinor-gold))",
    skeptic: "hsl(var(--spinor-red))",
    unknown: "hsl(var(--spinor-gray))",
  }[sentiment];
}

export function buildKOLLeaderboard(profiles: KOLProfile[]): KOLLeaderboardEntry[] {
  const entries = profiles.map((p) => {
    const dimensions = {
      influence: p.influenceScore,
      reach: Math.min(p.networkReach / 5, 100),
      evidence: Math.min(p.evidenceSources / 0.3, 100),
      resonance: p.contentResonance,
      relationship: p.relationshipStrength,
      engagement: (p.engagementTrend + 1) * 50,
    };
    const leaderScore = computeKOLScore(p);
    const momentum: KOLLeaderboardEntry["momentum"] =
      p.engagementTrend > 0.3 ? "rising" : p.engagementTrend < -0.2 ? "falling" : "stable";
    return { rank: 0, profile: p, leaderScore, dimensions, momentum };
  });

  entries.sort((a, b) => b.leaderScore - a.leaderScore);
  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries;
}

export function getTopRisers(leaderboard: KOLLeaderboardEntry[], count = 3): KOLLeaderboardEntry[] {
  return leaderboard.filter((e) => e.momentum === "rising").slice(0, count);
}

export function getKOLAdvocates(profiles: KOLProfile[]): KOLProfile[] {
  return profiles.filter((k) => k.sentiment === "advocate");
}

export function getAtRiskSkeptics(profiles: KOLProfile[]): KOLProfile[] {
  return profiles.filter((k) => k.sentiment === "skeptic");
}
