"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

/* ──────────────────────────────────────────────────────────────────
 * Advantage Foundry — Living Dashboard
 * A command center that breathes: strategies appear, evolve, and
 * produce outcomes in real time. The LLM panel is wired and ready.
 * ────────────────────────────────────────────────────────────────── */

interface StrategyEntry {
  id: string;
  name: string;
  description: string;
  domain: string;
  strategyClass: "proven" | "personalized" | "experimental";
  evidenceLevel: string;
  evidenceCount: number;
  components: { id: string; name: string; description: string; category: string }[];
}

interface AssignmentEntry {
  id: string;
  strategyId: string;
  employeeId: string;
  employeeRole: string;
  strategyClass: string;
  assignmentReason: string;
  assignedAt: string;
  active: boolean;
  trialNumber: number;
  confidenceAtAssignment: number;
}

interface ActivityEvent {
  id: string;
  timestamp: string;
  type: "assignment" | "outcome" | "evolution" | "attribution" | "discovery" | "reward";
  title: string;
  detail: string;
  actor: string;
  strategyName?: string;
  reward?: string;
}

interface LLMResult {
  role: string;
  content: string;
  timestamp: string;
  provider?: string;
}

const strategyClassMeta: Record<string, { label: string; color: string; glow: string; icon: string }> = {
  experimental: { label: "Experimental", color: "var(--strat-experimental)", glow: "strat-glow-experimental", icon: "◈" },
  personalized: { label: "Personalized", color: "var(--strat-personalized)", glow: "strat-glow-personalized", icon: "◉" },
  proven: { label: "Proven", color: "var(--strat-proven)", glow: "strat-glow-proven", icon: "✦" },
};

const evidenceMeta: Record<string, { label: string; pct: number; color: string }> = {
  unresolved: { label: "Unresolved", pct: 15, color: "var(--evidence-unresolved)" },
  observed_association: { label: "Observed", pct: 35, color: "var(--evidence-observed)" },
  probable_contribution: { label: "Probable", pct: 60, color: "var(--evidence-probable)" },
  experimentally_supported: { label: "Supported", pct: 85, color: "var(--evidence-experimental)" },
};

const llmPresets = [
  { label: "Analyze strategies", prompt: "Analyze the current strategy portfolio. Which strategies are most likely to evolve next, and what components would you recombine? Focus on territory planning and stakeholder engagement domains." },
  { label: "Suggest experiment", prompt: "Suggest a new experimental strategy hypothesis for pharmaceutical field marketing. Describe the components, expected outcomes, and what evidence would be needed to move it from spore to observation stage." },
  { label: "Attribution insight", prompt: "Given that Territory Cluster Routing has 47 trials with 91% success rate and Stakeholder Influence Matrix has 38 trials with 85% success rate, which strategy should receive more exploration budget and why?" },
  { label: "Reward formula", prompt: "Design a horizontal reward distribution formula for a strategy marketplace where contributors include the LLM that detected the pattern, the human who executed it, and the algorithm that assigned it. How should legacy credit compound?" },
];

const activityIcon: Record<string, string> = {
  assignment: "→",
  outcome: "✓",
  evolution: "🧬",
  attribution: "%",
  discovery: "◈",
  reward: "★",
};

const activityColor: Record<string, string> = {
  assignment: "var(--strat-personalized)",
  outcome: "var(--strat-proven)",
  evolution: "var(--accent)",
  attribution: "var(--primary)",
  discovery: "var(--strat-experimental)",
  reward: "var(--strat-proven)",
};

export default function DashboardPage() {
  const [strategies, setStrategies] = useState<StrategyEntry[]>([]);
  const [assignments, setAssignments] = useState<AssignmentEntry[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [stats, setStats] = useState({ hypotheses: 0, trials: 0, proven: 0, contributors: 0, proposals: 0, attribution: 0 });
  const [loading, setLoading] = useState(true);
  const [llmResults, setLLMResults] = useState<LLMResult[]>([]);
  const [llmInput, setLLMInput] = useState("");
  const [llmSystem, setLLMSystem] = useState("You speak with the Advantage Foundry voice — a field-tested pharma intelligence cadence. Lead with the sharpest insight. Use the language of the work: cadence, formulary lock, share of voice, P&T cycle, pull-through, whitespace. When uncertain, say so explicitly. Never use: delve into, navigate the landscape, leverage synergies, drive impactful results. You analyze strategy portfolios, suggest experiments, compute attribution, and design reward distributions. Be concise, specific, and data-anchored.");
  const [inferencing, setInferencing] = useState(false);
  const [llmError, setLLMError] = useState<string | null>(null);
  const [autoSeed, setAutoSeed] = useState(false);

  // ── Auto-seed demo data on first load ──
  useEffect(() => {
    if (autoSeed) return;
    setAutoSeed(true);
    fetch("/api/demo/seed", { method: "POST" }).then(() => {
      console.log("[dashboard] demo data seeded");
    }).catch(() => {});
  }, [autoSeed]);

  // ── Fetch strategies ──
  const fetchStrategies = useCallback(async () => {
    try {
      const res = await fetch("/api/strategies");
      const data = await res.json();
      if (data.strategies) setStrategies(data.strategies);
    } catch (e) { console.error("[dashboard] strategies fetch error:", e); }
  }, []);

  // ── Fetch assignments for the current user ──
  const fetchAssignments = useCallback(async () => {
    try {
      const meRes = await fetch("/api/auth/me");
      const me = meRes.ok ? await meRes.json() : null;
      const user = me?.user || { id: "gilead-rep-001", role: "field_representative" };
      const res = await fetch("/api/strategies/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: user.id,
          role: user.role,
          territoryType: "geographic",
          workloadLevel: "medium",
        }),
      });
      const data = await res.json();
      if (data.assigned && data.assigned.length > 0) {
        setAssignments(prev => {
          const existing = new Set(prev.map(a => a.id));
          const fresh = data.assigned.filter((a: AssignmentEntry) => !existing.has(a.id));
          return [...fresh, ...prev].slice(0, 20);
        });
      }
    } catch (e) { console.error("[dashboard] assign fetch error:", e); }
  }, []);

  // ── Initial load ──
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await fetchStrategies();
      await fetchAssignments();
      setActivity([]);
      setLoading(false);
    };
    init();
  }, [fetchStrategies, fetchAssignments]);

  // ── Compute stats from real loaded data ──
  useEffect(() => {
    const compute = async () => {
      try {
        const meRes = await fetch("/api/auth/me");
        const me = meRes.ok ? await meRes.json() : null;
        const employeeId = me?.user?.id || "gilead-rep-001";
        const goldenRes = await fetch(`/api/golden/golden-nodes?employeeId=${encodeURIComponent(employeeId)}`);
        const golden = goldenRes.ok ? await goldenRes.json() : { goldenNodes: [] };
        setStats({
          hypotheses: strategies.length,
          trials: assignments.length,
          proven: golden.goldenNodes?.length || 0,
          contributors: new Set(assignments.map(a => a.employeeId)).size,
          proposals: strategies.filter(s => s.evidenceLevel === "experimental").length,
          attribution: assignments.filter(a => a.confidenceAtAssignment > 0).length,
        });
      } catch (e) {
        console.error("[dashboard] stats compute error:", e);
      }
    };
    if (!loading) {
      compute();
    }
  }, [strategies, assignments, loading]);

  // ── Refresh assignments every 30 seconds ──
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAssignments();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchAssignments]);

  // ── LLM Inference ──
  const runInference = async (prompt?: string) => {
    const userPrompt = prompt || llmInput;
    if (!userPrompt.trim()) return;
    setInferencing(true);
    setLLMError(null);
    try {
      const res = await fetch("/api/llm/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://api.llm7.io/v1/chat/completions",
          model: "gpt-oss:20b",
          messages: [
            { role: "system", content: llmSystem },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 1024,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setLLMError(data.error);
      } else if (data.choices?.[0]?.message?.content) {
        const result: LLMResult = {
          role: "assistant",
          content: data.choices[0].message.content,
          timestamp: new Date().toISOString(),
          provider: data._provider || data.model || "llm7",
        };
        setLLMResults(prev => [result, ...prev].slice(0, 6));
        setLLMInput("");
      }
    } catch (e: any) {
      setLLMError(e.message || "Inference failed");
    } finally {
      setInferencing(false);
    }
  };

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
  };

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      {/* ── Ambient spore field ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="spore-dot" style={{
            left: `${(i * 37) % 100}%`,
            top: `${(i * 53) % 100}%`,
            width: `${2 + (i % 3)}px`,
            height: `${2 + (i % 3)}px`,
            background: `hsl(${i % 2 === 0 ? "var(--primary)" : "var(--accent)"} / 0.3)`,
            animationDelay: `${i * 0.5}s`,
            animationDuration: `${8 + (i % 4)}s`,
          }} />
        ))}
      </div>

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center">
              <div className="absolute inset-0 organic-border bg-gradient-to-br from-primary/80 to-accent/60 animate-glow-pulse" />
              <span className="relative text-xs font-bold text-background">AF</span>
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">Advantage Foundry</h1>
              <p className="text-[10px] font-medium text-muted-foreground">Living Dashboard</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1">
              <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-working" />
              <span className="text-xs font-medium text-primary">Live</span>
            </div>
            <Link href="/" className="btn btn-outline !h-8 !px-3 text-xs">Garden</Link>
            <Link href="/api/health" className="btn btn-outline !h-8 !px-3 text-xs">Health</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {/* ── Stats Row ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 mb-6">
          {[
            { label: "Hypotheses", value: stats.hypotheses, color: "var(--strat-experimental)", icon: "◈" },
            { label: "Trials", value: stats.trials, color: "var(--strat-personalized)", icon: "◉" },
            { label: "Proven", value: stats.proven, color: "var(--strat-proven)", icon: "✦" },
            { label: "Contributors", value: stats.contributors, color: "var(--primary)", icon: "★" },
            { label: "Proposals", value: stats.proposals, color: "var(--accent)", icon: "🧬" },
            { label: "Attribution", value: `${stats.attribution}%`, color: "var(--strat-proven)", icon: "%" },
          ].map((stat, i) => (
            <div key={i} className="glass-card p-4 animate-fade-in-up" style={{ animationDelay: `${i * 0.05}s` }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-lg" style={{ color: `hsl(${stat.color})` }}>{stat.icon}</span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</span>
              </div>
              <p className="text-2xl font-bold" style={{ color: `hsl(${stat.color})` }}>{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* ── Left Column: Strategy Leaderboard + Assignments ── */}
          <div className="lg:col-span-2 space-y-6">
            {/* Strategy Leaderboard */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Strategy Leaderboard</h2>
                <span className="text-xs text-muted-foreground">{strategies.length} strategies</span>
              </div>
              <div className="space-y-2">
                {loading ? (
                  <div className="glass-card p-6 text-center text-sm text-muted-foreground">Loading strategies...</div>
                ) : strategies.slice(0, 8).map((s, i) => {
                  const meta = strategyClassMeta[s.strategyClass] || strategyClassMeta.experimental;
                  const evMeta = evidenceMeta[s.evidenceLevel] || evidenceMeta.unresolved;
                  return (
                    <div key={s.id} className="leaderboard-row animate-fade-in-up" style={{ animationDelay: `${i * 0.04}s` }}>
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                        style={{ background: i < 3 ? `hsl(${meta.color} / 0.15)` : "hsl(var(--muted))", color: i < 3 ? `hsl(${meta.color})` : "hsl(var(--muted-foreground))" }}>
                        {i + 1}
                      </div>
                      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${meta.glow}`}
                        style={{ background: `hsl(${meta.color} / 0.12)`, color: `hsl(${meta.color})` }}>
                        <span className="text-sm">{meta.icon}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold">{s.name}</h3>
                        <p className="truncate text-xs text-muted-foreground">{s.components.length} components · {s.domain.replace(/_/g, " ")}</p>
                      </div>
                      <div className="hidden w-24 flex-shrink-0 md:block">
                        <div className="evidence-bar">
                          <div className="evidence-bar-fill" style={{ width: `${evMeta.pct}%`, background: `hsl(${evMeta.color})` }} />
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{evMeta.label}</p>
                      </div>
                      <div className="hidden flex-shrink-0 text-right sm:block">
                        <p className="text-[10px] text-muted-foreground">Evidence</p>
                        <p className="text-xs font-bold">{s.evidenceCount}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Active Assignments */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Active Assignments</h2>
                <span className="text-xs text-muted-foreground">{assignments.length} assigned</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {assignments.length === 0 ? (
                  <div className="glass-card p-4 text-center text-sm text-muted-foreground sm:col-span-2">No active assignments. New assignments appear here automatically.</div>
                ) : assignments.map((a, i) => {
                  const meta = strategyClassMeta[a.strategyClass] || strategyClassMeta.experimental;
                  const strategy = strategies.find(s => s.id === a.strategyId);
                  return (
                    <div key={a.id} className="hypothesis-card p-3 animate-fade-in-up" style={{ animationDelay: `${i * 0.05}s` }}>
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{strategy?.name || a.strategyId}</p>
                          <p className="text-xs text-muted-foreground">{a.employeeId} · {a.employeeRole.replace(/_/g, " ")}</p>
                        </div>
                        <span className={`badge border-transparent text-[10px] ${meta.glow}`}
                          style={{ background: `hsl(${meta.color} / 0.12)`, color: `hsl(${meta.color})` }}>
                          {meta.label}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>Trial #{a.trialNumber}</span>
                        <span>Reason: {a.assignmentReason.replace(/_/g, " ")}</span>
                        <span>{Math.round(a.confidenceAtAssignment * 100)}% conf</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* LLM Intelligence Panel */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">LLM Intelligence</h2>
                <span className="text-xs text-muted-foreground">LLM7 · gpt-oss:20b · free</span>
              </div>
              <div className="glass-card p-4">
                {/* Preset buttons */}
                <div className="mb-3 flex flex-wrap gap-2">
                  {llmPresets.map((preset, i) => (
                    <button
                      key={i}
                      onClick={() => runInference(preset.prompt)}
                      disabled={inferencing}
                      className="rounded-lg border border-border bg-card/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Input */}
                <div className="flex gap-2">
                  <textarea
                    value={llmInput}
                    onChange={(e) => setLLMInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runInference(); } }}
                    placeholder="Ask the Foundry intelligence layer..."
                    rows={2}
                    className="input flex-1 resize-none text-sm"
                    disabled={inferencing}
                  />
                  <button
                    onClick={() => runInference()}
                    disabled={inferencing || !llmInput.trim()}
                    className="btn btn-primary !h-auto px-4 text-sm"
                  >
                    {inferencing ? "..." : "Run"}
                  </button>
                </div>

                {/* System prompt editor */}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">System prompt</summary>
                  <textarea
                    value={llmSystem}
                    onChange={(e) => setLLMSystem(e.target.value)}
                    rows={3}
                    className="input mt-2 resize-none text-xs"
                  />
                </details>

                {/* Error */}
                {llmError && (
                  <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    {llmError}
                  </div>
                )}

                {/* Results */}
                <div className="mt-4 space-y-3">
                  {inferencing && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <div className="h-3 w-3 animate-pulse-working rounded-full bg-primary" />
                      <span>Inferring...</span>
                    </div>
                  )}
                  {llmResults.map((result, i) => (
                    <div key={i} className="rounded-xl border border-border bg-card/50 p-4 animate-fade-in-up">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-primary">AI Analysis</span>
                        <span className="text-[10px] text-muted-foreground">{result.provider} · {timeAgo(result.timestamp)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{result.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* ── Right Column: Live Activity Feed ── */}
          <div className="space-y-6">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Live Activity</h2>
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-working" />
                  <span className="text-xs text-primary">streaming</span>
                </div>
              </div>
              <div className="glass-card p-4 max-h-[700px] overflow-y-auto scrollbar-thin">
                <div className="space-y-2">
                  {activity.map((evt, i) => {
                    const color = activityColor[evt.type];
                    const icon = activityIcon[evt.type];
                    return (
                      <div
                        key={evt.id}
                        className="flex items-start gap-3 rounded-lg border border-transparent p-2 transition-all hover:border-border hover:bg-card/30 animate-fade-in"
                        style={{ animationDelay: i === 0 ? "0s" : undefined }}
                      >
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                          style={{ background: `hsl(${color} / 0.12)`, color: `hsl(${color})` }}>
                          {icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-semibold">{evt.title}</p>
                            <span className="text-[10px] text-muted-foreground">{timeAgo(evt.timestamp)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{evt.detail}</p>
                          {evt.strategyName && (
                            <p className="mt-0.5 text-[10px] font-medium" style={{ color: `hsl(${color})` }}>
                              {evt.strategyName}
                            </p>
                          )}
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span>by {evt.actor}</span>
                            {evt.reward && (
                              <span className="rounded-full bg-primary/5 px-1.5 py-0.5 font-medium text-primary">
                                +{evt.reward}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Quick API Access */}
            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">API Access</h2>
              <div className="space-y-1.5">
                {[
                  { href: "/api/strategies", label: "GET /api/strategies", desc: "List all strategies" },
                  { href: "/api/strategies/marketplace", label: "GET /api/strategies/marketplace", desc: "Strategy marketplace" },
                  { href: "/api/strategies/assign", label: "POST /api/strategies/assign", desc: "Assign strategies" },
                  { href: "/api/strategies/evolve", label: "POST /api/strategies/evolve", desc: "Evolve strategies" },
                  { href: "/api/health", label: "GET /api/health", desc: "System health check" },
                ].map((api, i) => (
                  <a
                    key={i}
                    href={api.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-lg border border-border bg-card/30 px-3 py-2 transition-all hover:border-primary/30 hover:bg-primary/5"
                  >
                    <p className="font-mono text-xs font-medium text-primary">{api.label}</p>
                    <p className="text-[10px] text-muted-foreground">{api.desc}</p>
                  </a>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
