"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import type { HypothesisAnatomy, PriorArtRecord, HypothesisAssignment } from "@/types";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { useVoiceCommand } from "@/components/useVoiceCommand";
import { useVoicePage } from "@/components/VoiceContext";
import { PageHeader, PageSection, EmptyState } from "@/components/page-shell";
import { useStreamingText } from "@/components/useAnimations";
import {
  AlertTriangle,
  Beaker,
  Check,
  FlaskConical,
  GitBranch,
  Loader2,
  Search,
  ShieldAlert,
  Sprout,
  Target,
  X,
} from "lucide-react";

export default function TodayPage() {
  return (
    <Suspense fallback={<TodaySkeleton />}>
      <TodayPageInner />
    </Suspense>
  );
}

function TodaySkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 pt-4">
      <div className="skeleton h-8 w-56 rounded-lg" />
      <div className="skeleton h-64 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="skeleton h-40 rounded-2xl" />
        <div className="skeleton h-40 rounded-2xl" />
      </div>
    </div>
  );
}

function TodayPageInner() {
  const searchParams = useSearchParams();
  const { user, loading: userLoading } = useCurrentUser();
  const queryEmployeeId = searchParams?.get("employeeId");
  const employeeId = queryEmployeeId || user?.id || "gilead-rep-001";

  const [assignments, setAssignments] = useState<HypothesisAssignment[]>([]);
  const [hypotheses, setHypotheses] = useState<Map<string, HypothesisAnatomy>>(new Map());
  const [priorArt, setPriorArt] = useState<Map<string, PriorArtRecord>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  // LLM states
  const [llmResearch, setLlmResearch] = useState<any>(null);
  const [researching, setResearching] = useState(false);
  const [llmConfounders, setLlmConfounders] = useState<string[] | null>(null);
  const [confounding, setConfounding] = useState(false);
  const [llmChallenge, setLlmChallenge] = useState<string | null>(null);
  const [challenging, setChallenging] = useState(false);
  const [llmDerivatives, setLlmDerivatives] = useState<any[] | null>(null);
  const [deriving, setDeriving] = useState(false);

  const llmResearchRef = useRef(llmResearch);
  const llmConfoundersRef = useRef(llmConfounders);
  const llmChallengeRef = useRef(llmChallenge);
  const llmDerivativesRef = useRef(llmDerivatives);
  useEffect(() => { llmResearchRef.current = llmResearch; }, [llmResearch]);
  useEffect(() => { llmConfoundersRef.current = llmConfounders; }, [llmConfounders]);
  useEffect(() => { llmChallengeRef.current = llmChallenge; }, [llmChallenge]);
  useEffect(() => { llmDerivativesRef.current = llmDerivatives; }, [llmDerivatives]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let aRes = await fetch(`/api/golden/assignments?employeeId=${employeeId}&active=true`);
      let aData = await aRes.json();

      if (!aData.assignments?.length) {
        const allocateRes = await fetch("/api/golden/allocate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId }),
        });
        if (allocateRes.ok) {
          aRes = await fetch(`/api/golden/assignments?employeeId=${employeeId}&active=true`);
          aData = await aRes.json();
        }
      }

      const [hRes, paRes] = await Promise.all([
        fetch("/api/golden/hypotheses"),
        fetch("/api/golden/prior-art"),
      ]);
      const hData = await hRes.json();
      const paData = await paRes.json();
      setAssignments(aData.assignments || []);
      setHypotheses(new Map((hData.hypotheses || []).map((h: HypothesisAnatomy) => [h.id, h])));
      setPriorArt(new Map((paData.priorArt || []).map((p: PriorArtRecord) => [p.id, p])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  const current =
    assignments.find((a) => a.state === "assigned" && hypotheses.has(a.hypothesisId)) ||
    assignments.find((a) => hypotheses.has(a.hypothesisId)) ||
    assignments[0];
  const hypothesis = current ? hypotheses.get(current.hypothesisId) : undefined;
  const pa = hypothesis ? priorArt.get(hypothesis.priorArtId) : undefined;

  const { displayed: streamedResearch } = useStreamingText(
    llmResearch?.llmUsed ? llmResearch.record?.adjacentSupportSummary || "" : "", 12
  );
  const { displayed: streamedChallenge } = useStreamingText(llmChallenge || "", 10);

  async function patchAssignment(action: "accept" | "reject" | "modify", extra?: Record<string, unknown>) {
    if (!current) return;
    setActing(true);
    try {
      const res = await fetch("/api/golden/assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, assignmentId: current.id, ...extra }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActing(false);
    }
  }

  async function runLLMResearch() {
    if (!hypothesis) return;
    setResearching(true);
    setLlmResearch(null);
    try {
      const res = await fetch("/api/golden/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "research", claim: hypothesis.claim }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLlmResearch(await res.json());
    } catch (e) {
      setLlmResearch({ llmUsed: false, llmError: e instanceof Error ? e.message : "Research failed" });
    } finally {
      setResearching(false);
    }
  }

  async function runLLMConfounders() {
    if (!hypothesis) return;
    setConfounding(true);
    setLlmConfounders(null);
    try {
      const res = await fetch("/api/llm/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are a confounder detection engine for pharma field execution. Given a hypothesis, list 3-5 alternative explanations that could confound the result. Return ONLY a JSON array of strings." },
            { role: "user", content: `Hypothesis: "${hypothesis.claim}"\nIntervention: ${hypothesis.intervention}\nControl: ${hypothesis.control}` },
          ],
          temperature: 0.4,
          max_tokens: 2048,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || "";
      try {
        const parsed = JSON.parse(content);
        setLlmConfounders(Array.isArray(parsed) ? parsed : []);
      } catch {
        const lines = content.split("\n").filter((l: string) => l.trim().startsWith("•") || l.trim().startsWith("-"));
        setLlmConfounders(lines.map((l: string) => l.replace(/^[•\-]\s*/, "").trim()).slice(0, 5));
      }
    } catch {
      setLlmConfounders([]);
    } finally {
      setConfounding(false);
    }
  }

  async function runLLMChallenge() {
    if (!hypothesis) return;
    setChallenging(true);
    setLlmChallenge(null);
    try {
      const res = await fetch("/api/llm/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are an adversarial reviewer for a pharma innovation hypothesis. Argue AGAINST this hypothesis. Identify the strongest weakness, the most likely failure mode, and the condition under which it would be falsified. Be concise (3-4 sentences)." },
            { role: "user", content: `Hypothesis: "${hypothesis.claim}"\nPrimary uncertainty: ${hypothesis.primaryUncertainty}\nCompliance boundary: ${hypothesis.complianceBoundary}` },
          ],
          temperature: 0.5,
          max_tokens: 2048,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLlmChallenge(data.choices?.[0]?.message?.content || "No response.");
    } catch {
      setLlmChallenge("Challenge unavailable.");
    } finally {
      setChallenging(false);
    }
  }

  async function runLLMDerivatives() {
    if (!hypothesis) return;
    setDeriving(true);
    setLlmDerivatives(null);
    try {
      const res = await fetch("/api/golden/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "derivatives", hypothesisId: hypothesis.id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLlmDerivatives(data.derivatives || []);
    } catch {
      setLlmDerivatives([]);
    } finally {
      setDeriving(false);
    }
  }

  async function plantSeed() {
    setActing(true);
    try {
      const res = await fetch("/api/golden/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Allocation failed");
    } finally {
      setActing(false);
    }
  }

  useVoiceCommand({
    run_research: runLLMResearch,
    run_confounders: runLLMConfounders,
    run_challenge: runLLMChallenge,
    run_derivatives: runLLMDerivatives,
    accept: () => patchAssignment("accept"),
    reject: () => patchAssignment("reject"),
    allocate: plantSeed,
  });

  useVoicePage({
    pageId: "today",
    title: "Today's Hypothesis",
    summary: current && hypothesis
      ? `Today's hypothesis: ${hypothesis.claim}. State: ${current.state}.`
      : "No active hypothesis. Say plant daily seed to begin.",
    actions: [
      { name: "run_research", label: "run research", available: !!current && !researching, handler: async () => { await runLLMResearch(); return { success: !llmResearchRef.current?.llmError, speech: llmResearchRef.current?.llmError ? `Research failed: ${llmResearchRef.current.llmError}` : "Research complete." }; } },
      { name: "run_confounders", label: "attack with confounders", available: !!current && !confounding, handler: async () => { await runLLMConfounders(); const n = llmConfoundersRef.current?.length || 0; return { success: true, speech: `Found ${n} potential confounder${n === 1 ? "" : "s"}.` }; } },
      { name: "run_challenge", label: "challenge the hypothesis", available: !!current && !challenging, handler: async () => { await runLLMChallenge(); const ok = !!llmChallengeRef.current && llmChallengeRef.current !== "Challenge unavailable."; return { success: ok, speech: ok ? "Adversarial challenge complete." : "Challenge unavailable." }; } },
      { name: "run_derivatives", label: "generate derivatives", available: !!current && !deriving, handler: async () => { await runLLMDerivatives(); const n = llmDerivativesRef.current?.length || 0; return { success: true, speech: `Generated ${n} derivative hypotheses.` }; } },
      { name: "accept", label: "accept mission", available: !!current && current.state === "assigned", handler: async () => { await patchAssignment("accept"); return { success: true, speech: "Mission accepted." }; } },
      { name: "reject", label: "reject mission", available: !!current && current.state === "assigned", handler: async () => { await patchAssignment("reject"); return { success: true, speech: "Mission rejected." }; } },
      { name: "allocate", label: "plant daily seed", available: !loading, handler: async () => { await plantSeed(); return { success: true, speech: "Daily Seed planted." }; } },
      { name: "status", label: "what is my mission", available: true, handler: async () => ({ success: true, speech: current && hypothesis ? `Your mission is ${hypothesis.claim}.` : "No active mission." }) },
    ],
  });

  if (userLoading || loading) return <TodaySkeleton />;
  if (error) {
    return (
      <div className="mx-auto max-w-5xl pt-4">
        <PageHeader title="Today's Hypothesis" icon={FlaskConical}>
          <button onClick={load} className="btn btn-primary">Retry</button>
        </PageHeader>
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-sm text-red-200">{error}</div>
      </div>
    );
  }

  if (!current || !hypothesis) {
    return (
      <div className="mx-auto max-w-5xl pt-4">
        <PageHeader title="Today's Hypothesis" icon={FlaskConical} />
        <EmptyState
          icon={Sprout}
          title="No active mission"
          message="Your hypothesis queue is empty. Plant a Daily Seed to get an assignable mission based on your role and territory."
          action={
            <button onClick={plantSeed} disabled={acting} className="btn btn-primary">
              {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Sprout className="mr-1.5 h-4 w-4" /> Plant Daily Seed</>}
            </button>
          }
        />
      </div>
    );
  }

  const confidencePct = pa ? Math.round(pa.researchConfidence * 100) : 0;
  const llmBusy = researching || confounding || challenging || deriving;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pt-4">
      <PageHeader
        title="Today's Hypothesis"
        icon={FlaskConical}
        subtitle={`Trial ${current.trialNumber} · ${current.kind} · ${current.state}`}
      >
        <div className="flex flex-wrap gap-2">
          <button onClick={runLLMResearch} disabled={researching} className="btn btn-ghost btn-sm">
            <Search className="mr-1.5 h-3.5 w-3.5" />
            Research
          </button>
          <button onClick={plantSeed} disabled={acting} className="btn btn-primary btn-sm">
            <Sprout className="mr-1.5 h-3.5 w-3.5" />
            New seed
          </button>
        </div>
      </PageHeader>

      {/* Mission Hero */}
      <PageSection className="overflow-hidden">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex-1">
            <div className="mb-3 flex flex-wrap gap-2">
              <span className="badge border-primary/30 bg-primary/10 text-primary tag-pulse"><Target className="mr-1 h-3 w-3" /> Mission</span>
              <span className="badge border-accent/30 bg-accent/10 text-accent">{current.kind}</span>
              <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">{current.state}</span>
            </div>
            <h2 className="text-2xl font-bold leading-snug tracking-tight text-foreground sm:text-3xl">{hypothesis.claim}</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground"><span className="font-medium text-foreground/80">Why this reached you: </span>{current.allocationReason}</p>
            {pa && (
              <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="badge border-spinor-blue/30 bg-spinor-blue/10 text-spinor-blue">{pa.status.replace(/_/g, " ")}</span>
                <span>{pa.evidenceState}</span>
                <span className="hidden sm:inline">·</span>
                <span className="hidden sm:inline">{pa.sourceDomains.slice(0, 3).join(", ")}</span>
              </div>
            )}
          </div>

          {pa && (
            <div className="w-full shrink-0 lg:w-64">
              <div className="rounded-2xl border border-border/50 bg-muted/20 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Prior-art confidence</span>
                  <span className="font-bold text-foreground">{confidencePct}%</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent" style={{ width: `${confidencePct}%` }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </PageSection>

      {/* LLM Actions */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PageSection title="Prior-art research" icon={Search}>
          <p className="text-sm text-muted-foreground">
            Evaluate the claim against adjacent categories and prior art to find unknowns.
          </p>
          <div className="mt-4">
            {llmResearch ? (
              <div className="space-y-3 text-sm">
                {llmResearch.llmUsed ? (
                  <>
                    <p className="text-foreground/90 leading-relaxed">{streamedResearch}</p>
                    {llmResearch.record?.sourceDomains && (
                      <div className="flex flex-wrap gap-1.5">
                        {llmResearch.record.sourceDomains.map((d: string) => (
                          <span key={d} className="badge border-accent/20 bg-accent/10 text-accent">{d}</span>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-red-300">LLM unavailable{llmResearch.llmError ? `: ${llmResearch.llmError}` : ""}.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Run research to see cross-category prior-art findings.</p>
            )}
          </div>
          <div className="mt-4">
            <button onClick={runLLMResearch} disabled={researching} className="btn btn-ghost btn-sm">
              {researching ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />}
              {researching ? "Researching…" : "Run research"}
            </button>
          </div>
        </PageSection>

        <PageSection title="Confounder attack" icon={AlertTriangle}>
          <p className="text-sm text-muted-foreground">
            Surface alternative explanations that could confound the hypothesized result.
          </p>
          <div className="mt-4">
            {llmConfounders ? (
              <ul className="space-y-2">
                {llmConfounders.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-red-400" />
                    {c}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No confounders yet.</p>
            )}
          </div>
          <div className="mt-4">
            <button onClick={runLLMConfounders} disabled={confounding} className="btn btn-ghost btn-sm">
              {confounding ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />}
              {confounding ? "Attacking…" : "Attack"}
            </button>
          </div>
        </PageSection>

        <PageSection title="Adversarial challenge" icon={ShieldAlert}>
          <p className="text-sm text-muted-foreground">
            Argue against the hypothesis and identify its weakest point.
          </p>
          <div className="mt-4">
            {llmChallenge ? (
              <p className="text-sm leading-relaxed text-foreground/90">{streamedChallenge}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No challenge yet.</p>
            )}
          </div>
          <div className="mt-4">
            <button onClick={runLLMChallenge} disabled={challenging} className="btn btn-ghost btn-sm">
              {challenging ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />}
              {challenging ? "Challenging…" : "Challenge"}
            </button>
          </div>
        </PageSection>

        <PageSection title="Derivative suggestions" icon={GitBranch}>
          <p className="text-sm text-muted-foreground">
            Generate controlled variations with different modifiable dimensions.
          </p>
          <div className="mt-4 space-y-2">
            {llmDerivatives && llmDerivatives.length > 0 ? llmDerivatives.map((d, i) => (
              <div key={i} className="rounded-xl border border-border/50 bg-muted/10 p-3">
                <p className="text-sm text-foreground/90">{d.claim}</p>
                <p className="mt-1 text-xs text-muted-foreground">Dimension: {d.modifiedDimension?.replace(/_/g, " ")}</p>
              </div>
            )) : <p className="text-sm text-muted-foreground">No derivatives yet.</p>}
          </div>
          <div className="mt-4">
            <button onClick={runLLMDerivatives} disabled={deriving} className="btn btn-ghost btn-sm">
              {deriving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <GitBranch className="mr-1.5 h-3.5 w-3.5" />}
              {deriving ? "Generating…" : "Generate"}
            </button>
          </div>
        </PageSection>
      </div>

      {/* Experiment design */}
      <PageSection title="Experiment design" icon={Beaker}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border/50 bg-muted/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Intervention</p>
            <p className="mt-1 text-sm text-foreground/90">{hypothesis.intervention}</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-muted/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Control</p>
            <p className="mt-1 text-sm text-foreground/90">{hypothesis.control}</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-muted/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Primary outcome</p>
            <p className="mt-1 text-sm text-foreground/90">{hypothesis.primaryOutcome}</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-muted/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Primary uncertainty</p>
            <p className="mt-1 text-sm text-foreground/90">{hypothesis.primaryUncertainty}</p>
          </div>
        </div>
      </PageSection>

      {/* Innovation window */}
      <PageSection title="Innovation window" icon={Target}>
        <div className="flex flex-wrap gap-2">
          {(hypothesis.modifiableDimensions || []).map((d) => (
            <span key={d} className="badge border-accent/30 bg-accent/10 text-accent tag-pulse">{d.replace(/_/g, " ")}</span>
          ))}
        </div>
      </PageSection>

      {/* Compliance */}
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-red-400" />
          <div>
            <p className="text-sm font-semibold text-red-300">Compliance boundary</p>
            <p className="mt-1 text-sm text-foreground/80">{hypothesis.complianceBoundary}</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button onClick={() => patchAssignment("accept")} disabled={acting} className="btn btn-primary disabled:opacity-50">
          {acting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
          {acting ? "Working…" : "Accept mission"}
        </button>
        <button onClick={() => patchAssignment("reject")} disabled={acting} className="btn btn-outline disabled:opacity-50">
          <X className="mr-1.5 h-4 w-4" />
          Reject
        </button>
        <a href="/foundry" className="btn btn-ghost">View organism →</a>
        <a href="/experiment" className="btn btn-ghost">Design experiment →</a>
      </div>
    </div>
  );
}
