"use client";
import { useState, useEffect, useCallback } from "react";
import { RadarChart } from "@/components/RadarChart";
import { useCountUp, useStreamingText, useScrollReveal } from "@/components/useAnimations";
import { useVoiceCommand } from "@/components/useVoiceCommand";
import { useVoicePage } from "@/components/VoiceContext";

interface Ranking {
  employeeId: string;
  rank: number;
  score: number;
  breakdown: {
    causalLift: number;
    informationGained: number;
    mutationValue: number;
    replicationQuality: number;
    reusableSystemValue: number;
    complianceRisk: number;
    contamination: number;
    executionCost: number;
  };
  roles: string[];
}

const ROLE_BADGES: Record<string, { icon: string; color: string }> = {
  Originator: { icon: "◈", color: "#a78bfa" },
  Mutator: { icon: "🧬", color: "#38bdf8" },
  Executor: { icon: "⚡", color: "#34d399" },
  Validator: { icon: "✓", color: "#fbbf24" },
  Replicator: { icon: "⟳", color: "#fb923c" },
  Automator: { icon: "⚙", color: "#f59e0b" },
  "Channel Architect": { icon: "🏛", color: "#f87171" },
  Participant: { icon: "·", color: "#94a3b8" },
  Tester: { icon: "⚗", color: "#38bdf8" },
  Modifier: { icon: "🧬", color: "#a78bfa" },
  Builder: { icon: "🔧", color: "#f59e0b" },
  "Strategy Architect": { icon: "🏛", color: "#f87171" },
  "Golden Node Founder": { icon: "✦", color: "#fbbf24" },
};

const SCORE_TERMS = [
  { key: "causalLift", label: "Causal lift", sign: "+", desc: "Measured effect above counterfactual" },
  { key: "informationGained", label: "Information gained", sign: "+", desc: "Reduction in uncertainty about the hypothesis" },
  { key: "mutationValue", label: "Mutation value", sign: "+", desc: "Useful derivative created from parent" },
  { key: "replicationQuality", label: "Replication quality", sign: "+", desc: "Independent reproduction across contexts" },
  { key: "reusableSystemValue", label: "Reusable system value", sign: "+", desc: "Method became infrastructure or transferable system" },
  { key: "complianceRisk", label: "Compliance risk", sign: "−", desc: "Policy or safety boundary violations" },
  { key: "contamination", label: "Contamination", sign: "−", desc: "Experiment integrity compromised" },
  { key: "executionCost", label: "Execution cost", sign: "−", desc: "Effort and resources consumed" },
];

/** Animated count-up score display. */
function ScoreCountUp({ target, className }: { target: number; className?: string }) {
  const value = useCountUp(target, 1200);
  return <span className={className}>{value}</span>;
}

/** Circular SVG progress ring showing a score as a percentage of max. */
function ProgressRing({ value, max, size = 44, stroke = 4 }: { value: number; max: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const offset = circumference * (1 - pct);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--muted) / 0.3)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="hsl(43 90% 60%)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)" }}
      />
      <text x={size / 2} y={size / 2} dominantBaseline="middle" textAnchor="middle" className="fill-current text-[9px] font-bold text-amber-300">
        {Math.round(pct * 100)}
      </text>
    </svg>
  );
}

/** Scroll-reveal wrapper section. */
function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const { ref, visible } = useScrollReveal();
  return (
    <div ref={ref} className={`scroll-reveal ${visible ? "visible" : ""} ${className || ""}`}>
      {children}
    </div>
  );
}

export default function ResultsPage() {
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [attributions, setAttributions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Ranking | null>(null);
  const [insight, setInsight] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [lbRes, attRes] = await Promise.all([
        fetch("/api/golden/spinor?action=leaderboard", { cache: "no-store" }),
        fetch("/api/golden/attributions", { cache: "no-store" }),
      ]);
      const lbData = await lbRes.json();
      const attData = await attRes.json();
      setRankings(lbData.rankings || []);
      setAttributions(attData.attributions || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load results");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generateInsight() {
    setInsightLoading(true);
    setInsightError(null);
    setInsight(null);
    try {
      const sortedLocal = [...rankings].sort((a, b) => b.score - a.score);
      const leaderboardSummary = sortedLocal
        .slice(0, 10)
        .map((r, i) => `#${i + 1} ${r.employeeId} — score ${r.score} — roles: ${r.roles.join(", ") || "none"}`)
        .join("\n");
      const topBreakdown = sortedLocal[0]
        ? SCORE_TERMS.map((t) => `${t.label}: ${(sortedLocal[0].breakdown as any)[t.key] || 0}`).join(", ")
        : "N/A";
      const attributionSummary = attributions
        .slice(0, 5)
        .map((a) => `Factor: ${a.responsibleFactor || "Unresolved"} | Confidence: ${((a.confidence || 0) * 100).toFixed(0)}% | Reasoning: ${(a.reasoning || "").slice(0, 100)}`)
        .join("\n");

      const res = await fetch("/api/llm/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "You are a senior strategy analyst for a pharma field execution innovation system called the Discovery Canopy. The canopy ranks SPINs (human × hypothesis × context × execution × model × timing × chance) — not employees — by a Node Score that rewards causal lift, information gained, mutation value, replication quality, and reusable system value, while penalizing compliance risk, contamination, and execution cost. Given leaderboard and causal attribution data, produce a brief, insightful analysis (3-5 sentences) highlighting: who leads and why, the dominant contribution roles, any notable score distribution patterns, and one actionable recommendation for the team. Be concise, specific, and factual. Do not invent data.",
            },
            {
              role: "user",
              content: `Discovery Canopy leaderboard (top ${Math.min(10, sortedLocal.length)} of ${sortedLocal.length}):\n${leaderboardSummary || "No rankings yet."}\n\nTop SPIN breakdown: ${topBreakdown}\n\nCausal attribution ledger (sample):\n${attributionSummary || "No attributions yet."}`,
            },
          ],
          temperature: 0.4,
          max_tokens: 512,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInsight(data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning || "No insight generated.");
    } catch (e) {
      setInsightError(e instanceof Error ? e.message : "Insight generation failed.");
    } finally {
      setInsightLoading(false);
    }
  }

  useVoiceCommand({
    generate_insight: () => generateInsight(),
  });

  useVoicePage({
    pageId: "results",
    title: "Discovery Canopy",
    summary: `Leaderboard loaded with ${rankings.length} ranking${rankings.length !== 1 ? "s" : ""}. ${selected ? `Selected: ${selected.employeeId} at rank ${selected.rank}.` : "Select a rep to see details."}`,
    actions: [
      {
        name: "generate_insight",
        label: "generate insight",
        available: rankings.length > 0 && !insightLoading,
        handler: async () => {
          await generateInsight();
          return { success: true, speech: "Insight generated. Review the analysis below." };
        },
      },
    ],
  });

  // Streaming reveal of the LLM insight text.
  const { displayed: streamedInsight, done: insightDone } = useStreamingText(insight || "", 12);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-8 py-10 animate-fade-in-up">
        <div className="flex items-start justify-between">
          <div>
            <div className="skeleton-text h-9 w-64" />
            <div className="skeleton-text mt-3 h-4 w-96" />
          </div>
          <div className="skeleton-text h-6 w-24 rounded-full" />
        </div>
        <div className="section-divider mt-6" />
        <div className="bento-grid mt-6">
          <div className="bento-item bento-span-2"><div className="skeleton-text h-5 w-40" /><div className="skeleton mt-4 h-56 w-full rounded-xl" /></div>
          <div className="bento-item bento-span-2"><div className="skeleton-text h-5 w-40" /><div className="mt-4 grid grid-cols-2 gap-3">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-16 w-full rounded-xl" />)}</div></div>
        </div>
        <div className="bento-grid mt-4">
          <div className="bento-item bento-span-4"><div className="skeleton-text h-5 w-48" /><div className="mt-4 space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-20 w-full rounded-xl" />)}</div></div>
        </div>
      </div>
    );
  }

  if (error) return <div className="mx-auto max-w-6xl px-8 py-10 page-enter"><div className="glass-card p-6 border-destructive/20"><div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg border border-destructive/20 bg-destructive/10 text-destructive"><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg></div><p className="text-sm text-destructive">{error}</p></div><button className="btn btn-primary mt-4" onClick={load}>Retry</button></div></div>;

  const sorted = [...rankings].sort((a, b) => b.score - a.score);
  const top = sorted[0] || null;
  const maxScore = sorted.length > 0 ? Math.max(...sorted.map((r) => r.score), 1) : 1;

  return (
    <div className="mx-auto max-w-6xl px-8 py-10 page-enter">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">Discovery Canopy</h1>
          <p className="mt-2 text-sm text-muted-foreground text-pretty">Strategy competition — not employee competition. The unit ranked is the SPIN: human × hypothesis × context × execution × model × timing × chance.</p>
        </div>
        <div className="llm-badge llm-badge-live">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {sorted.length} SPINs
        </div>
      </div>

      <div className="section-divider mt-6" />

      {/* Bento command center */}
      <Reveal className="bento-grid mt-6">
        {/* Radar chart — top SPIN breakdown */}
        <div className="bento-item bento-span-2">
          <p className="done-section-label flex items-center gap-2">Top SPIN signature</p>
          {top ? (
            <>
              <p className="mt-1 text-xs text-muted-foreground">{top.employeeId} · multi-dimensional breakdown</p>
              <div className="mt-3 flex justify-center">
                <RadarChart
                  size={260}
                  data={SCORE_TERMS.map((t) => ({ label: t.key.slice(0, 4), value: Math.abs((top.breakdown as any)[t.key] || 0), max: 50 }))}
                />
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No SPINs ranked yet.</p>
          )}
        </div>

        {/* Node Score formula */}
        <div className="bento-item bento-span-2">
          <p className="done-section-label flex items-center gap-2">Node Score formula</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SCORE_TERMS.map((term) => (
              <div key={term.key} className="stat-card flex items-start gap-2 p-3">
                <span className={`text-sm font-bold ${term.sign === "+" ? "text-emerald-400" : "text-red-400"}`}>{term.sign}</span>
                <div>
                  <p className="text-sm font-medium text-foreground">{term.label}</p>
                  <p className="text-xs text-muted-foreground">{term.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground text-pretty">A dramatic result from six cherry-picked accounts receives limited credit. A smaller improvement reproduced across multiple people, territories, and periods may receive much more. Negative results earn credit when they falsify an expensive assumption or reveal a failure boundary.</p>
        </div>
      </Reveal>

      {/* LLM Insight */}
      <Reveal className="bento-grid mt-4">
        <div className="bento-item bento-span-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="done-section-label flex items-center gap-2">Canopy insight</p>
              <p className="mt-1 text-xs text-muted-foreground">LLM-powered analysis of the current leaderboard and attribution ledger.</p>
            </div>
            <button
              className="btn btn-primary"
              onClick={generateInsight}
              disabled={insightLoading || sorted.length === 0}
            >
              {insightLoading ? (
                <span className="flex items-center gap-2">
                  <span className="llm-thinking-dots"><span /><span /><span /></span>
                  Generating…
                </span>
              ) : (
                <span className="flex items-center gap-2"><span>✦</span> Generate insight</span>
              )}
            </button>
          </div>
          {insightError && (
            <p className="mt-3 text-sm text-destructive">{insightError}</p>
          )}
          {insight && (
            <div className="mt-3 rounded-xl border border-border bg-muted/10 p-4 animate-fade-in">
              <p className="text-sm leading-relaxed text-foreground text-pretty">
                {streamedInsight}
                {!insightDone && <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-primary/70 align-middle" />}
              </p>
            </div>
          )}
        </div>
      </Reveal>

      {/* Leaderboard */}
      <Reveal className="bento-grid mt-4">
        <div className="bento-item bento-span-4">
          <p className="done-section-label flex items-center gap-2">Leaderboard</p>
          <div className="mt-4 space-y-3">
            {sorted.length === 0 ? (
              <div className="p-8 text-center"><p className="text-muted-foreground">No discovery contributions yet. Run experiments to populate the canopy.</p></div>
            ) : sorted.map((r, i) => (
              <div
                key={r.employeeId}
                className={`glass-card glass-card-hover p-4 cursor-pointer ${selected?.employeeId === r.employeeId ? "border-primary/40 bg-primary/5" : ""}`}
                onClick={() => setSelected(selected?.employeeId === r.employeeId ? null : r)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="text-lg font-bold text-muted-foreground">#{i + 1}</span>
                    <div>
                      <p className="font-medium text-foreground">{r.employeeId}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.roles.map((role) => {
                          const badge = ROLE_BADGES[role] || { icon: "·", color: "#94a3b8" };
                          return (
                            <span
                              key={role}
                              className="badge"
                              style={{ borderColor: `${badge.color}40`, color: badge.color, backgroundColor: `${badge.color}10` }}
                            >
                              <span className="mr-1">{badge.icon}</span>{role}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <ProgressRing value={r.score} max={maxScore} />
                    <ScoreCountUp target={r.score} className="text-2xl font-bold text-foreground" />
                  </div>
                </div>

                {selected?.employeeId === r.employeeId && (
                  <div className="mt-4 border-t border-border pt-4 animate-fade-in">
                    <p className="done-section-label">Score breakdown</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                      {SCORE_TERMS.map((term) => {
                        const val = (r.breakdown as any)[term.key] || 0;
                        return (
                          <div key={term.key} className="stat-card p-2">
                            <p className="text-[10px] text-muted-foreground">{term.label}</p>
                            <p className={`text-sm font-bold ${term.sign === "+" ? (val > 0 ? "text-emerald-400" : "text-muted-foreground") : (val > 0 ? "text-red-400" : "text-muted-foreground")}`}>{term.sign === "−" && val > 0 ? "−" : ""}{val}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {/* Causal attributions */}
      {attributions.length > 0 && (
        <Reveal className="mt-8">
          <div className="section-divider" />
          <div className="mt-6">
            <p className="done-section-label flex items-center gap-2">Causal attribution ledger</p>
            <div className="mt-3 space-y-2">
              {attributions.map((a) => (
                <div key={a.id} className="glass-card glass-card-hover p-4">
                  <p className="text-sm font-medium text-foreground">{a.responsibleFactor || "Unresolved"} → {a.reasoning?.slice(0, 120) || "Analysis pending"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Confidence: {((a.confidence || 0) * 100).toFixed(0)}% · Counterfactual: {a.counterfactual || "N/A"}</p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      )}
    </div>
  );
}
