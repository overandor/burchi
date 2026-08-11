"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Crown,
  Users,
  TrendingUp,
  TrendingDown,
  Minus,
  MapPin,
  Building,
  Star,
  Activity,
  MessageSquare,
  Filter,
  ArrowUpDown,
  ArrowRight,
  Sparkles,
  Mail,
  Phone,
  Video,
  User,
  AlertTriangle,
  Target,
  Network,
} from "lucide-react";
import { RadarChart } from "@/components/RadarChart";
import { useCountUp, useScrollReveal } from "@/components/useAnimations";
import { useVoicePage } from "@/components/VoiceContext";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import {
  buildKOLLeaderboard,
  getTopRisers,
  getKOLAdvocates,
  getAtRiskSkeptics,
  sentimentEmoji,
  sentimentColor,
  tierRank,
  type KOLLeaderboardEntry,
  type KOLProfile,
} from "@/lib/kol/real";

/* ── helpers ── */
function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

function daysSince(date: string): number {
  const now = new Date();
  const d = new Date(date);
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)));
}

function channelIcon(channel: KOLProfile["recommendedChannel"]) {
  return {
    in_person: User,
    remote: Video,
    email: Mail,
    phone: Phone,
  }[channel];
}

function momentumIcon(momentum: KOLLeaderboardEntry["momentum"]) {
  return {
    rising: TrendingUp,
    stable: Minus,
    falling: TrendingDown,
  }[momentum];
}

function momentumColor(momentum: KOLLeaderboardEntry["momentum"]): string {
  return {
    rising: "text-emerald-400",
    stable: "text-muted-foreground",
    falling: "text-red-400",
  }[momentum];
}

function tierBadge(tier: KOLProfile["tier"]) {
  const config = {
    global: { label: "Global", cls: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
    national: { label: "National", cls: "border-violet-500/30 bg-violet-500/10 text-violet-300" },
    regional: { label: "Regional", cls: "border-primary/30 bg-primary/10 text-primary" },
    local: { label: "Local", cls: "border-muted-foreground/30 bg-muted/10 text-muted-foreground" },
  };
  return config[tier];
}

function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const { ref, visible } = useScrollReveal();
  return (
    <div ref={ref} className={`scroll-reveal ${visible ? "visible" : ""} ${className}`}>
      {children}
    </div>
  );
}

/* ── mini network graph for selected KOL ── */
function KOLNetwork({ selected, leaderboard }: { selected: KOLProfile; leaderboard: KOLLeaderboardEntry[] }) {
  const nodes = useMemo(() => {
    const related = leaderboard
      .map((e) => e.profile)
      .filter((p) => p.id === selected.id || selected.connectedKOLs.includes(p.id))
      .slice(0, 6);

    const cx = 160;
    const cy = 100;
    const r = 70;
    return related.map((p, i) => {
      const angle = (i / Math.max(1, related.length)) * Math.PI * 2 - Math.PI / 2;
      const isCenter = p.id === selected.id;
      return {
        id: p.id,
        name: p.initials,
        x: isCenter ? cx : cx + Math.cos(angle) * r,
        y: isCenter ? cy : cy + Math.sin(angle) * r,
        r: isCenter ? 22 : 12,
        color: isCenter ? "hsl(var(--primary))" : sentimentColor(p.sentiment),
        isCenter,
      };
    });
  }, [selected]);

  return (
    <div className="relative">
      <svg viewBox="0 0 320 200" className="w-full">
        {nodes.map((n) =>
          n.isCenter
            ? null
            : (
              <line
                key={`line-${n.id}`}
                x1={nodes.find((x) => x.isCenter)?.x || 160}
                y1={nodes.find((x) => x.isCenter)?.y || 100}
                x2={n.x}
                y2={n.y}
                stroke="hsl(var(--border))"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            )
        )}
        {nodes.map((n) => (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r={n.r} fill={n.color} opacity={0.25} />
            <circle cx={n.x} cy={n.y} r={n.r - 4} fill={n.color} />
            <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="middle" className="fill-current text-[10px] font-bold" style={{ fill: "white" }}>
              {n.name}
            </text>
          </g>
        ))}
      </svg>
      <p className="absolute bottom-2 left-0 right-0 text-center text-[10px] text-muted-foreground">
        KOL influence neighborhood — {selected.connectedKOLs.length} direct connection{selected.connectedKOLs.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

/* ── page ── */
export default function LeadersPage() {
  const [territory, setTerritory] = useState<string>("all");
  const [specialty, setSpecialty] = useState<string>("all");
  const [tier, setTier] = useState<string>("all");
  const [sentiment, setSentiment] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"score" | "reach" | "resonance" | "relationship">("score");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { user, loading: userLoading } = useCurrentUser();
  const [profiles, setProfiles] = useState<KOLProfile[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [engagementRec, setEngagementRec] = useState<string | null>(null);
  const [generatingRec, setGeneratingRec] = useState(false);

  useEffect(() => {
    if (!user?.orgId) return;
    setDataLoading(true);
    setDataError(null);
    fetch(`/api/kol/profiles?orgId=${user.orgId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      })
      .then((data) => setProfiles(data.profiles || []))
      .catch((e) => setDataError(e.message))
      .finally(() => setDataLoading(false));
  }, [user?.orgId]);

  const leaderboard = useMemo(() => buildKOLLeaderboard(profiles), [profiles]);
  const territories = useMemo(() => Array.from(new Set(leaderboard.map((e) => e.profile.territory))), [leaderboard]);
  const specialties = useMemo(() => Array.from(new Set(leaderboard.map((e) => e.profile.specialty))), [leaderboard]);

  const filtered = useMemo(() => {
    const list = leaderboard.filter((e) => {
      const p = e.profile;
      if (territory !== "all" && p.territory !== territory) return false;
      if (specialty !== "all" && p.specialty !== specialty) return false;
      if (tier !== "all" && p.tier !== tier) return false;
      if (sentiment !== "all" && p.sentiment !== sentiment) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.specialty.toLowerCase().includes(q) ||
          p.institution.toLowerCase().includes(q) ||
          p.territory.toLowerCase().includes(q)
        );
      }
      return true;
    });

    const sortFns: Record<typeof sortBy, (a: KOLLeaderboardEntry, b: KOLLeaderboardEntry) => number> = {
      score: (a, b) => b.leaderScore - a.leaderScore,
      reach: (a, b) => b.profile.networkReach - a.profile.networkReach,
      resonance: (a, b) => b.profile.contentResonance - a.profile.contentResonance,
      relationship: (a, b) => b.profile.relationshipStrength - a.profile.relationshipStrength,
    };

    return list.sort(sortFns[sortBy]);
  }, [territory, specialty, tier, sentiment, sortBy, search, leaderboard]);

  const selected = useMemo(
    () => leaderboard.find((e) => e.profile.id === selectedId)?.profile || (filtered[0]?.profile ?? null),
    [selectedId, filtered, leaderboard]
  );

  const topScore = Math.round(leaderboard[0]?.leaderScore ?? 0);
  const avgScore = Math.round(leaderboard.reduce((s, e) => s + e.leaderScore, 0) / leaderboard.length);
  const totalReach = leaderboard.reduce((s, e) => s + e.profile.networkReach, 0);
  const totalKOLs = leaderboard.length;
  const advocateProfiles = useMemo(() => getKOLAdvocates(profiles), [profiles]);
  const atRiskSkepticProfiles = useMemo(() => getAtRiskSkeptics(profiles), [profiles]);
  const topRiserEntries = useMemo(() => getTopRisers(leaderboard, 3), [leaderboard]);
  const advocateCount = advocateProfiles.length;
  const skepticCount = atRiskSkepticProfiles.length;

  useVoicePage({
    pageId: "leaders",
    title: "KOL Leaders",
    summary: `Viewing ${totalKOLs} KOL leaders. ${filtered.length} match current filters. Top score: ${topScore}.`,
    actions: [],
  });

  const animatedTopScore = useCountUp(topScore, 1200);
  const animatedAvgScore = useCountUp(avgScore, 1200);
  const animatedReach = useCountUp(totalReach, 1200);

  useEffect(() => {
    if (!selectedId && filtered[0]) {
      setSelectedId(filtered[0].profile.id);
    }
  }, [selectedId, filtered]);

  const selectedEntry = leaderboard.find((e) => e.profile.id === selected?.id);

  async function generateEngagementRecommendation() {
    if (!selected || generatingRec) return;
    setGeneratingRec(true);
    setEngagementRec(null);
    try {
      const connectedNames = (selected.connectedKOLs || [])
        .map((id) => leaderboard.find((e) => e.profile.id === id)?.profile.name)
        .filter(Boolean)
        .slice(0, 5)
        .join(", ");

      const res = await fetch("/api/llm/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: "You are a KOL engagement strategist for a pharma field execution team. Given a KOL's profile, generate a personalized engagement recommendation that includes: (1) A specific outreach strategy tailored to their sentiment, tier, and barriers. (2) Content suggestions based on their affinities. (3) Timing and channel recommendation with rationale. (4) Risk mitigation if they are a skeptic. (5) Network leverage opportunities via their connected KOLs. Be specific, actionable, and concise.",
            },
            {
              role: "user",
              content: `KOL Profile:
Name: ${selected.name}
Specialty: ${selected.specialty}${selected.subSpecialty ? ` (${selected.subSpecialty})` : ""}
Institution: ${selected.institution}
Territory: ${selected.territory}
Tier: ${selected.tier}
Sentiment: ${selected.sentiment}
Influence Score: ${selected.influenceScore}/100
Network Reach: ${selected.networkReach} HCPs
Publications: ${selected.publications}, Trials: ${selected.trials}
Relationship Strength: ${selected.relationshipStrength}%
Content Resonance: ${selected.contentResonance}%
Engagement Trend: ${selected.engagementTrend > 0 ? "+" : ""}${(selected.engagementTrend * 100).toFixed(0)}%
Prescribing Change: ${selected.prescribingChange > 0 ? "+" : ""}${selected.prescribingChange}%
Barriers: ${selected.barrierFocus.join(", ") || "none"}
Content Affinities: ${selected.contentAffinities.join(", ") || "none"}
Last Interaction: ${selected.lastInteraction}
Recommended Channel: ${selected.recommendedChannel}
Connected KOLs: ${connectedNames || "none"}
Current Next Best Action: ${selected.nextBestAction}`,
            },
          ],
          temperature: 0.4,
          max_tokens: 1024,
        }),
      });
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning || "";
      setEngagementRec(content || "No recommendation generated.");
    } catch (e: any) {
      setEngagementRec(`Error: ${e.message}`);
    } finally {
      setGeneratingRec(false);
    }
  }

  if (userLoading || dataLoading) {
    return <div className="mx-auto max-w-6xl px-6 py-20 text-center text-muted-foreground">Loading KOL intelligence…</div>;
  }
  if (dataError) {
    return <div className="mx-auto max-w-6xl px-6 py-20 text-center text-destructive">Error loading KOL data: {dataError}</div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <Crown className="h-3 w-3" />
            KOL Intelligence
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Leaders & <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">KOL Tech</span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground text-pretty">
            KOLs are interaction contexts, not targets. Each leader represents a set of conditions
            under which specific outreach techniques succeed or fail. The leaderboard ranks
            where the highest-information next experiment lives.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="llm-badge llm-badge-live">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_hsl(160_84%_39%)]" />
            Intelligence live
          </span>
          <span className="badge border-amber-500/30 bg-amber-500/10 text-amber-300">
            <Crown className="mr-1 h-3 w-3" />
            {totalKOLs} KOLs
          </span>
        </div>
      </div>

      <div className="section-divider mt-6" />

      {/* Top stats */}
      <Reveal className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <div className="glass-card p-4 card-hover">
          <p className="done-section-label">Top KOL score</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{animatedTopScore}</p>
        </div>
        <div className="glass-card p-4 card-hover">
          <p className="done-section-label">Avg score</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{animatedAvgScore}</p>
        </div>
        <div className="glass-card p-4 card-hover">
          <p className="done-section-label">Network reach</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{formatNumber(animatedReach)}</p>
        </div>
        <div className="glass-card p-4 card-hover">
          <p className="done-section-label">Advocates</p>
          <p className="mt-1 text-2xl font-bold text-emerald-400">{advocateCount}</p>
        </div>
        <div className="glass-card p-4 card-hover">
          <p className="done-section-label">Skeptics at risk</p>
          <p className="mt-1 text-2xl font-bold text-red-400">{skepticCount}</p>
        </div>
        <div className="glass-card p-4 card-hover">
          <p className="done-section-label">Content resonance</p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {Math.round(leaderboard.reduce((s, e) => s + e.profile.contentResonance, 0) / totalKOLs)}%
          </p>
        </div>
      </Reveal>

      {/* Filters */}
      <Reveal className="mt-4 glass-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select className="input h-9 w-40 py-1 text-xs" value={territory} onChange={(e) => setTerritory(e.target.value)}>
            <option value="all">All territories</option>
            {territories.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="input h-9 w-40 py-1 text-xs" value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
            <option value="all">All specialties</option>
            {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input h-9 w-32 py-1 text-xs" value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="all">All tiers</option>
            <option value="global">Global</option>
            <option value="national">National</option>
            <option value="regional">Regional</option>
            <option value="local">Local</option>
          </select>
          <select className="input h-9 w-36 py-1 text-xs" value={sentiment} onChange={(e) => setSentiment(e.target.value)}>
            <option value="all">All sentiments</option>
            <option value="advocate">Advocate</option>
            <option value="neutral">Neutral</option>
            <option value="skeptic">Skeptic</option>
          </select>
          <select className="input h-9 w-40 py-1 text-xs" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
            <option value="score">Sort by score</option>
            <option value="reach">Sort by reach</option>
            <option value="resonance">Sort by resonance</option>
            <option value="relationship">Sort by relationship</option>
          </select>
          <input
            className="input h-9 min-w-[12rem] flex-1 py-1 text-xs"
            placeholder="Search KOL, institution, specialty..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            className="btn btn-ghost text-xs"
            onClick={() => { setTerritory("all"); setSpecialty("all"); setTier("all"); setSentiment("all"); setSortBy("score"); setSearch(""); }}
          >
            Reset
          </button>
        </div>
      </Reveal>

      {/* Main bento layout */}
      <Reveal className="bento-grid mt-4">
        {/* Leaderboard */}
        <div className="bento-item bento-span-3 min-h-[480px]">
          <div className="mb-4 flex items-center justify-between">
            <p className="done-section-label flex items-center gap-2">
              <Crown className="h-3.5 w-3.5 text-amber-400" />
              KOL leaderboard
            </p>
            <span className="text-xs text-muted-foreground">{filtered.length} match{filtered.length !== 1 ? "es" : ""}</span>
          </div>

          <div className="space-y-3">
            {filtered.map((entry) => {
              const p = entry.profile;
              const isSelected = selected?.id === p.id;
              const Momentum = momentumIcon(entry.momentum);
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`leaderboard-row cursor-pointer ${isSelected ? "border-primary/30 bg-primary/5" : ""}`}
                >
                  <div className="flex w-8 items-center justify-center">
                    {entry.rank <= 3 ? (
                      <span className={`text-lg font-bold ${entry.rank === 1 ? "text-amber-400" : entry.rank === 2 ? "text-slate-300" : "text-amber-700"}`}>
                        #{entry.rank}
                      </span>
                    ) : (
                      <span className="text-sm font-bold text-muted-foreground">#{entry.rank}</span>
                    )}
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-sm font-bold text-primary">
                    {p.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-foreground">{p.name}</p>
                      <span className={`badge px-1.5 py-0 text-[10px] ${tierBadge(p.tier).cls}`}>{tierBadge(p.tier).label}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1"><Building className="h-3 w-3" /> {p.institution}</span>
                      <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {p.territory}</span>
                      <span className="flex items-center gap-1" style={{ color: sentimentColor(p.sentiment) }}>
                        {sentimentEmoji(p.sentiment)} {p.sentiment}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="hidden text-right sm:block">
                      <p className="text-lg font-bold text-foreground">{Math.round(entry.leaderScore)}</p>
                      <p className="text-[10px] text-muted-foreground">leader score</p>
                    </div>
                    <Momentum className={`h-4 w-4 ${momentumColor(entry.momentum)}`} />
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="py-12 text-center">
                <p className="text-muted-foreground">No KOLs match the current filters.</p>
              </div>
            )}
          </div>
        </div>

        {/* KOL Tech detail */}
        <div className="bento-item bento-span-3 min-h-[480px]">
          {selected && selectedEntry ? (
            <>
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <p className="done-section-label flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    KOL intelligence card
                  </p>
                  <h2 className="mt-1 text-2xl font-bold text-foreground">{selected.name}</h2>
                  <p className="text-sm text-muted-foreground">{selected.specialty}{selected.subSpecialty ? ` · ${selected.subSpecialty}` : ""}</p>
                </div>
                <div className={`badge ${tierBadge(selected.tier).cls}`}>
                  {tierBadge(selected.tier).label} KOL
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="stat-card p-3 text-center">
                  <p className="done-section-label">Influence</p>
                  <p className="mt-1 text-xl font-bold text-foreground">{selected.influenceScore}</p>
                </div>
                <div className="stat-card p-3 text-center">
                  <p className="done-section-label">Reach</p>
                  <p className="mt-1 text-xl font-bold text-foreground">{formatNumber(selected.networkReach)}</p>
                </div>
                <div className="stat-card p-3 text-center">
                  <p className="done-section-label">Resonance</p>
                  <p className="mt-1 text-xl font-bold text-foreground">{selected.contentResonance}%</p>
                </div>
                <div className="stat-card p-3 text-center">
                  <p className="done-section-label">Relationship</p>
                  <p className="mt-1 text-xl font-bold text-foreground">{selected.relationshipStrength}%</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* Radar */}
                <div className="glass-card p-4">
                  <p className="done-section-label mb-2">Influence signature</p>
                  <div className="flex justify-center">
                    <RadarChart
                      size={240}
                      color={sentimentColor(selected.sentiment)}
                      data={[
                        { label: "Influence", value: selectedEntry.dimensions.influence, max: 100 },
                        { label: "Reach", value: selectedEntry.dimensions.reach, max: 100 },
                        { label: "Evidence", value: selectedEntry.dimensions.evidence, max: 100 },
                        { label: "Resonance", value: selectedEntry.dimensions.resonance, max: 100 },
                        { label: "Relationship", value: selectedEntry.dimensions.relationship, max: 100 },
                        { label: "Engagement", value: selectedEntry.dimensions.engagement, max: 100 },
                      ]}
                    />
                  </div>
                </div>

                {/* Network + actions */}
                <div className="glass-card p-4">
                  <p className="done-section-label mb-2">Influence neighborhood</p>
                  <KOLNetwork selected={selected} leaderboard={leaderboard} />
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="done-section-label flex items-center gap-2 text-primary">
                      <Target className="h-3.5 w-3.5" />
                      Next best engagement
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-foreground/90">{selected.nextBestAction}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {(() => {
                        const Icon = channelIcon(selected.recommendedChannel);
                        return (
                          <span className="badge border-primary/30 bg-primary/10 text-primary">
                            <Icon className="mr-1 h-3 w-3" />
                            {selected.recommendedChannel.replace("_", "-")}
                          </span>
                        );
                      })()}
                      <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">
                        <Activity className="mr-1 h-3 w-3" />
                        Prescribing change {selected.prescribingChange > 0 ? "+" : ""}{selected.prescribingChange}%
                      </span>
                      <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">
                        <MessageSquare className="mr-1 h-3 w-3" />
                        Last contact {daysSince(selected.lastInteraction)}d ago
                      </span>
                    </div>
                  </div>
                  {/* Trend sparkline */}
                  <div className="shrink-0">
                    <svg width="60" height="32" viewBox="0 0 60 32" className="opacity-80">
                      {(() => {
                        const trend = selected.engagementTrend;
                        const pts: string[] = [];
                        for (let i = 0; i < 8; i++) {
                          const x = (i / 7) * 56 + 2;
                          const noise = Math.sin(i * 1.3 + selected.influenceScore * 0.1) * 6;
                          const y = 16 - (trend * 10) - noise + (i * trend * 1.5);
                          pts.push(`${x},${Math.max(4, Math.min(28, y))}`);
                        }
                        const polyColor = trend > 0.1 ? "#34d399" : trend < -0.1 ? "#f87171" : "#fbbf24";
                        return (
                          <>
                            <polyline points={pts.join(" ")} fill="none" stroke={polyColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            <circle cx={pts[pts.length - 1].split(",")[0]} cy={pts[pts.length - 1].split(",")[1]} r="2" fill={polyColor} />
                          </>
                        );
                      })()}
                    </svg>
                    <p className="text-center text-[8px] text-muted-foreground">8wk trend</p>
                  </div>
                </div>
              </div>

              {/* LLM Engagement Recommendation */}
              <div className="mt-4 rounded-xl border border-primary/20 bg-background/40 p-4">
                <div className="flex items-center justify-between">
                  <p className="done-section-label flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    AI Engagement Strategy
                  </p>
                  <button
                    onClick={generateEngagementRecommendation}
                    disabled={generatingRec}
                    className="btn btn-primary text-[10px] px-2 py-1">
                    {generatingRec ? "Generating…" : "Generate Strategy"}
                  </button>
                </div>
                {generatingRec && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="llm-thinking-dots"><span /><span /><span /></span>
                    Analyzing KOL profile and generating personalized strategy…
                  </div>
                )}
                {engagementRec && (
                  <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="badge border-primary/30 bg-primary/10 text-primary text-[9px]">AI Recommendation</span>
                    </div>
                    <div className="prose prose-invert max-w-none text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
                      {engagementRec}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {selected.barrierFocus.map((b) => (
                  <span key={b} className="badge border-destructive/20 bg-destructive/5 text-destructive">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    {b.replace(/_/g, " ")}
                  </span>
                ))}
                {selected.contentAffinities.map((c) => (
                  <span key={c} className="badge border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                    <Star className="mr-1 h-3 w-3" />
                    {c.trim()}
                  </span>
                ))}
              </div>

              <div className="mt-4 flex gap-3">
                <button className="btn btn-primary text-xs" onClick={() => {}}>
                  Plan engagement <ArrowRight className="ml-1 h-3 w-3" />
                </button>
                <button className="btn btn-outline text-xs" onClick={() => {}}>
                  View evidence trail
                </button>
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Users className="h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-muted-foreground">Select a KOL to view intelligence.</p>
            </div>
          )}
        </div>
      </Reveal>

      {/* Rising + at-risk */}
      <Reveal className="bento-grid mt-4">
        <div className="bento-item bento-span-2">
          <p className="done-section-label flex items-center gap-2 text-emerald-400">
            <TrendingUp className="h-3.5 w-3.5" />
            Rising KOLs
          </p>
          <div className="mt-3 space-y-2">
            {topRiserEntries.map((e) => (
              <div key={e.profile.id} className="flex items-center gap-3 rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-400">
                  {e.profile.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{e.profile.name}</p>
                  <p className="text-[10px] text-muted-foreground">{e.profile.specialty} · +{(e.profile.engagementTrend * 100).toFixed(0)}% momentum</p>
                </div>
                <span className="text-sm font-bold text-emerald-400">{Math.round(e.leaderScore)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bento-item bento-span-2">
          <p className="done-section-label flex items-center gap-2 text-red-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            Skeptics at risk
          </p>
          <div className="mt-3 space-y-2">
            {atRiskSkepticProfiles.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl border border-red-500/10 bg-red-500/5 p-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10 text-xs font-bold text-red-400">
                  {p.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                  <p className="text-[10px] text-muted-foreground">{p.specialty} · relationship {p.relationshipStrength}%</p>
                </div>
                <span className="text-sm font-bold text-red-400">{p.nextBestAction.slice(0, 30)}…</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bento-item bento-span-2">
          <p className="done-section-label flex items-center gap-2 text-violet-300">
            <Network className="h-3.5 w-3.5" />
            Leader tech
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            KOLs are scored on six evidence-based dimensions: influence, reach, evidence, resonance,
            relationship, and engagement trend. The model updates as field interactions are captured.
          </p>
          <div className="mt-3 space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center justify-between"><span>Weighted scoring</span><span className="text-foreground">6 dimensions</span></div>
            <div className="flex items-center justify-between"><span>Tier classification</span><span className="text-foreground">Global → Local</span></div>
            <div className="flex items-center justify-between"><span>Sentiment tracking</span><span className="text-foreground">Advocate / Neutral / Skeptic</span></div>
            <div className="flex items-center justify-between"><span>Next-best-action</span><span className="text-foreground">Channel + content</span></div>
          </div>
        </div>
      </Reveal>

      {/* Network macro view */}
      <Reveal className="bento-grid mt-4">
        <div className="bento-item bento-span-4">
          <p className="done-section-label flex items-center gap-2">
            <ArrowUpDown className="h-3.5 w-3.5" />
            KOL network macro view
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Top KOLs by influence score, sized by network reach and colored by sentiment.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            {leaderboard.slice(0, 10).map((e) => (
              <div key={e.profile.id} className="flex flex-col items-center gap-1">
                <div
                  className="flex items-center justify-center rounded-full border transition-transform hover:scale-110"
                  style={{
                    width: Math.max(28, e.profile.networkReach / 10),
                    height: Math.max(28, e.profile.networkReach / 10),
                    borderColor: `${sentimentColor(e.profile.sentiment)}60`,
                    backgroundColor: `${sentimentColor(e.profile.sentiment)}20`,
                  }}
                >
                  <span className="text-[9px] font-bold" style={{ color: sentimentColor(e.profile.sentiment) }}>
                    {e.profile.initials}
                  </span>
                </div>
                <span className="max-w-[6rem] truncate text-[10px] text-muted-foreground">{e.profile.name}</span>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </div>
  );
}
