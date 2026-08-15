"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import type { HypothesisAnatomy, PriorArtRecord, HypothesisAssignment, WorkflowIntel, WorkflowExecutionPlan } from "@/types";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { useVoiceCommand } from "@/components/useVoiceCommand";
import { useVoicePage } from "@/components/VoiceContext";
import { PageHeader, PageSection, EmptyState } from "@/components/page-shell";
import { useStreamingText } from "@/components/useAnimations";
import {
  AlertTriangle,
  Beaker,
  Check,
  ChevronRight,
  FlaskConical,
  GitBranch,
  Loader2,
  Lock,
  Search,
  ShieldAlert,
  Sprout,
  Target,
  X,
  Zap,
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────

interface WorkflowStatus {
  stage: "briefing" | "intel" | "execution" | "observation" | "attribution" | "finalized";
  stageIndex: number;
  totalStages: number;
  stageLabel: string;
  nextAction: string;
  canProceed: boolean;
  intelQuality: number;
  evidenceCount: number;
}

interface WorkflowResponse {
  hasActiveWorkflow: boolean;
  assignment?: HypothesisAssignment;
  status?: WorkflowStatus;
  completedCycles: number;
  intelQuality?: number;
  message?: string;
}

// ─── Page ───────────────────────────────────────────────────────────────

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

const STAGES = [
  { key: "briefing", label: "Briefing", icon: Target },
  { key: "intel", label: "Intel", icon: Search },
  { key: "execution", label: "Execution", icon: Zap },
  { key: "observation", label: "Observation", icon: Beaker },
  { key: "attribution", label: "Attribution", icon: GitBranch },
  { key: "finalized", label: "Complete", icon: Check },
];

function TodayPageInner() {
  const searchParams = useSearchParams();
  const { user, loading: userLoading } = useCurrentUser();
  const queryEmployeeId = searchParams?.get("employeeId");
  const employeeId = queryEmployeeId || user?.id || "gilead-rep-001";

  const [workflow, setWorkflow] = useState<WorkflowResponse | null>(null);
  const [hypotheses, setHypotheses] = useState<Map<string, HypothesisAnatomy>>(new Map());
  const [priorArt, setPriorArt] = useState<Map<string, PriorArtRecord>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  // LLM states (now feed into workflow intel)
  const [llmResearch, setLlmResearch] = useState<any>(null);
  const [researching, setResearching] = useState(false);
  const [llmConfounders, setLlmConfounders] = useState<string[] | null>(null);
  const [confounding, setConfounding] = useState(false);
  const [llmChallenge, setLlmChallenge] = useState<string | null>(null);
  const [challenging, setChallenging] = useState(false);

  // Execution plan form state
  const [planForm, setPlanForm] = useState({
    prediction: { metric: "", expectedDirection: "increase" as "increase" | "decrease" | "no_change", expectedMagnitude: "", unit: "" },
    falsificationCriteria: "",
    evaluationDays: 30,
    modificationDimension: "" as string,
    modificationRationale: "",
  });

  // Observation form state
  const [obsForm, setObsForm] = useState({
    successKind: "confirmed" as "confirmed" | "falsified" | "inconclusive" | "partial",
    outcomeDescription: "",
    metricName: "",
    metricValue: "",
    metricUnit: "",
    metricBaseline: "",
    higherIsBetter: true,
    falsified: false,
    falsificationEvidence: "",
    externalFactors: "",
  });

  // Telemetry upload state
  const [telemetry, setTelemetry] = useState<any>(null);
  const [uploadingSheet, setUploadingSheet] = useState(false);
  const [telemetryMetrics, setTelemetryMetrics] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Attribution result
  const [attributionResult, setAttributionResult] = useState<any>(null);
  const [finalizeResult, setFinalizeResult] = useState<any>(null);

  const llmResearchRef = useRef(llmResearch);
  const llmConfoundersRef = useRef(llmConfounders);
  const llmChallengeRef = useRef(llmChallenge);
  useEffect(() => { llmResearchRef.current = llmResearch; }, [llmResearch]);
  useEffect(() => { llmConfoundersRef.current = llmConfounders; }, [llmConfounders]);
  useEffect(() => { llmChallengeRef.current = llmChallenge; }, [llmChallenge]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Load workflow status
      const wfRes = await fetch(`/api/golden/workflow?employeeId=${employeeId}`);
      const wfData: WorkflowResponse = await wfRes.json();

      if (!wfData.hasActiveWorkflow) {
        // Try to allocate
        const allocRes = await fetch("/api/golden/allocate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId }),
        });
        if (allocRes.ok) {
          const retryRes = await fetch(`/api/golden/workflow?employeeId=${employeeId}`);
          const retryData = await retryRes.json();
          setWorkflow(retryData);
        } else {
          setWorkflow(wfData);
        }
      } else {
        setWorkflow(wfData);
      }

      // Load hypotheses and prior art
      const [hRes, paRes] = await Promise.all([
        fetch("/api/golden/hypotheses"),
        fetch("/api/golden/prior-art"),
      ]);
      const hData = await hRes.json();
      const paData = await paRes.json();
      setHypotheses(new Map((hData.hypotheses || []).map((h: HypothesisAnatomy) => [h.id, h])));
      setPriorArt(new Map((paData.priorArt || []).map((p: PriorArtRecord) => [p.id, p])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  const assignment = workflow?.assignment;
  const status = workflow?.status;
  const hypothesis = assignment ? hypotheses.get(assignment.hypothesisId) : undefined;
  const pa = hypothesis ? priorArt.get(hypothesis.priorArtId) : undefined;

  const { displayed: streamedResearch } = useStreamingText(
    llmResearch?.llmUsed ? llmResearch.record?.adjacentSupportSummary || "" : "", 12
  );
  const { displayed: streamedChallenge } = useStreamingText(llmChallenge || "", 10);

  // ─── Workflow actions ─────────────────────────────────────────────

  async function workflowAction(action: string, extra?: Record<string, unknown>) {
    if (!assignment) return;
    setActing(true);
    try {
      const res = await fetch("/api/golden/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, assignmentId: assignment.id, ...extra }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.attribution) setAttributionResult(data.attribution);
      if (data.unlocked !== undefined) setFinalizeResult(data);
      setWorkflow({ ...workflow!, assignment: data.assignment, status: data.status, hasActiveWorkflow: true, completedCycles: workflow?.completedCycles || 0 });
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
      const data = await res.json();
      setLlmResearch(data);
      // Save intel to workflow
      if (data.llmUsed && assignment) {
        await workflowAction("saveIntel", {
          intel: {
            research: {
              summary: data.record?.adjacentSupportSummary || "",
              sourceDomains: data.record?.sourceDomains || [],
              adjacentSupport: data.record?.adjacentSupportSummary || "",
            },
          },
        });
      }
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
      let items: string[] = [];
      try {
        const parsed = JSON.parse(content);
        items = Array.isArray(parsed) ? parsed : [];
      } catch {
        const lines = content.split("\n").filter((l: string) => l.trim().startsWith("•") || l.trim().startsWith("-"));
        items = lines.map((l: string) => l.replace(/^[•\-]\s*/, "").trim()).slice(0, 5);
      }
      setLlmConfounders(items);
      // Save intel to workflow
      if (items.length > 0 && assignment) {
        await workflowAction("saveIntel", {
          intel: { confounders: { items } },
        });
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
            { role: "system", content: "You are an adversarial reviewer for a pharma innovation hypothesis. Argue AGAINST this hypothesis. Identify the strongest weakness, the most likely failure mode, and the condition under which it would be falsified. Return JSON: {\"text\": \"...\", \"weakestPoint\": \"...\", \"falsificationCondition\": \"...\"}" },
            { role: "user", content: `Hypothesis: "${hypothesis.claim}"\nPrimary uncertainty: ${hypothesis.primaryUncertainty}\nCompliance boundary: ${hypothesis.complianceBoundary}` },
          ],
          temperature: 0.5,
          max_tokens: 2048,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || "";
      let parsed: any = {};
      try { parsed = JSON.parse(content); } catch { parsed = { text: content, weakestPoint: "", falsificationCondition: "" }; }
      setLlmChallenge(parsed.text || content);
      // Save intel to workflow
      if (assignment) {
        await workflowAction("saveIntel", {
          intel: {
            challenge: {
              text: parsed.text || content,
              weakestPoint: parsed.weakestPoint || "",
              falsificationCondition: parsed.falsificationCondition || "",
            },
          },
        });
      }
    } catch {
      setLlmChallenge("Challenge unavailable.");
    } finally {
      setChallenging(false);
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

  async function uploadTelemetrySheet(file: File) {
    setUploadingSheet(true);
    setTelemetry(null);
    setTelemetryMetrics([]);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/telemetry/parse", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setTelemetry(data);
      setTelemetryMetrics(data.metrics || []);

      // Auto-populate observation form from telemetry
      if (data.observation) {
        setObsForm(prev => ({
          ...prev,
          outcomeDescription: data.observation.outcomeDescription || prev.outcomeDescription,
        }));
      }

      // Auto-fill metric fields from first extracted metric
      if (data.metrics?.length > 0) {
        const m = data.metrics[0];
        setObsForm(prev => ({
          ...prev,
          metricName: m.name,
          metricValue: String(m.value),
          metricUnit: m.unit,
          metricBaseline: m.baseline ? String(m.baseline) : "",
          higherIsBetter: m.higherIsBetter,
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Telemetry upload failed");
    } finally {
      setUploadingSheet(false);
    }
  }

  // ─── Voice commands ───────────────────────────────────────────────

  useVoiceCommand({
    run_research: runLLMResearch,
    run_confounders: runLLMConfounders,
    run_challenge: runLLMChallenge,
    accept: () => workflowAction("accept"),
    reject: () => workflowAction("reject", { note: "voice reject" }),
    allocate: plantSeed,
  });

  useVoicePage({
    pageId: "today",
    title: "Today's Mission",
    summary: status && hypothesis
      ? `Stage ${status.stageIndex + 1} of ${status.totalStages}: ${status.stageLabel}. ${status.nextAction}`
      : "No active mission. Say plant daily seed to begin.",
    actions: [
      { name: "run_research", label: "run research", available: status?.stage === "intel" && !researching, handler: async () => { await runLLMResearch(); return { success: true, speech: "Research complete." }; } },
      { name: "run_confounders", label: "attack with confounders", available: status?.stage === "intel" && !confounding, handler: async () => { await runLLMConfounders(); return { success: true, speech: "Confounders identified." }; } },
      { name: "run_challenge", label: "challenge the hypothesis", available: status?.stage === "intel" && !challenging, handler: async () => { await runLLMChallenge(); return { success: true, speech: "Challenge complete." }; } },
      { name: "accept", label: "accept mission", available: status?.stage === "briefing", handler: async () => { await workflowAction("accept"); return { success: true, speech: "Mission accepted. Proceed to intel gathering." }; } },
      { name: "reject", label: "reject mission", available: status?.stage === "briefing", handler: async () => { await workflowAction("reject", { note: "voice" }); return { success: true, speech: "Mission rejected." }; } },
      { name: "allocate", label: "plant daily seed", available: !loading, handler: async () => { await plantSeed(); return { success: true, speech: "Daily Seed planted." }; } },
      { name: "status", label: "what is my mission", available: true, handler: async () => ({ success: true, speech: status && hypothesis ? `Stage ${status.stageIndex + 1}: ${status.stageLabel}. ${status.nextAction}` : "No active mission." }) },
    ],
  });

  // ─── Render ───────────────────────────────────────────────────────

  if (userLoading || loading) return <TodaySkeleton />;
  if (error) {
    return (
      <div className="mx-auto max-w-5xl pt-4">
        <PageHeader title="Today's Mission" icon={FlaskConical}>
          <button onClick={load} className="btn btn-primary">Retry</button>
        </PageHeader>
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-sm text-red-200">{error}</div>
      </div>
    );
  }

  if (!workflow?.hasActiveWorkflow || !assignment || !hypothesis) {
    return (
      <div className="mx-auto max-w-5xl pt-4">
        <PageHeader title="Today's Mission" icon={FlaskConical} />
        {(workflow?.completedCycles || 0) > 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-accent/20 bg-accent/5 p-3 text-sm text-accent">
            <Trophy className="h-4 w-4" />
            {(workflow?.completedCycles || 0)} mission{(workflow?.completedCycles || 0) === 1 ? "" : "s"} completed
          </div>
        )}
        <EmptyState
          icon={Sprout}
          title="No active mission"
          message="Your mission queue is empty. Plant a Daily Seed to start a new workflow cycle."
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
  const intelPct = Math.round((status?.intelQuality || 0) * 100);

  return (
    <div className="mx-auto max-w-5xl space-y-6 pt-4">
      <PageHeader
        title="Today's Mission"
        icon={FlaskConical}
        subtitle={`Cycle ${assignment.trialNumber} · ${assignment.kind} · ${workflow?.completedCycles || 0} completed`}
      >
        <button onClick={plantSeed} disabled={acting} className="btn btn-ghost btn-sm">
          <Sprout className="mr-1.5 h-3.5 w-3.5" />
          New seed
        </button>
      </PageHeader>

      {/* ─── Progress Bar ────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-muted/10 p-4">
        <div className="flex items-center justify-between">
          {STAGES.map((stage, i) => {
            const Icon = stage.icon;
            const isCurrent = status?.stageIndex === i;
            const isComplete = (status?.stageIndex || 0) > i;
            const isLocked = (status?.stageIndex || 0) < i;
            return (
              <div key={stage.key} className="flex flex-1 items-center">
                <div className={`flex flex-col items-center gap-1 ${isLocked ? "opacity-30" : ""}`}>
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all ${
                    isCurrent ? "border-primary bg-primary/20 text-primary scale-110" :
                    isComplete ? "border-accent bg-accent/20 text-accent" :
                    "border-muted-foreground/30 text-muted-foreground"
                  }`}>
                    {isComplete ? <Check className="h-4 w-4" /> : isLocked ? <Lock className="h-3.5 w-3.5" /> : <Icon className="h-4 w-4" />}
                  </div>
                  <span className={`text-[10px] font-medium ${isCurrent ? "text-primary" : "text-muted-foreground"}`}>{stage.label}</span>
                </div>
                {i < STAGES.length - 1 && (
                  <div className={`mx-1 h-0.5 flex-1 rounded-full ${isComplete ? "bg-accent" : "bg-muted-foreground/20"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Mission Hero ────────────────────────────────────────── */}
      <PageSection className="overflow-hidden">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex-1">
            <div className="mb-3 flex flex-wrap gap-2">
              <span className="badge border-primary/30 bg-primary/10 text-primary"><Target className="mr-1 h-3 w-3" /> {status?.stageLabel}</span>
              <span className="badge border-accent/30 bg-accent/10 text-accent">{assignment.kind}</span>
            </div>
            <h2 className="text-2xl font-bold leading-snug tracking-tight text-foreground sm:text-3xl">{hypothesis.claim}</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/80">Next: </span>{status?.nextAction}
            </p>
            {pa && (
              <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="badge border-spinor-blue/30 bg-spinor-blue/10 text-spinor-blue">{pa.status.replace(/_/g, " ")}</span>
                <span>{pa.evidenceState}</span>
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

      {/* ─── Stage Content ───────────────────────────────────────── */}

      {/* STAGE 0: Briefing */}
      {status?.stage === "briefing" && (
        <PageSection title="Accept this mission?" icon={Target}>
          <p className="text-sm text-muted-foreground">
            Review the hypothesis and compliance boundary. Once accepted, you'll gather intel, commit to a plan, and execute in the field.
          </p>
          <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-red-400" />
              <div>
                <p className="text-sm font-semibold text-red-300">Compliance boundary</p>
                <p className="mt-1 text-sm text-foreground/80">{hypothesis.complianceBoundary}</p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={() => workflowAction("accept")} disabled={acting} className="btn btn-primary">
              {acting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
              Accept mission
            </button>
            <button onClick={() => workflowAction("reject", { note: "User rejected" })} disabled={acting} className="btn btn-outline">
              <X className="mr-1.5 h-4 w-4" />
              Reject
            </button>
          </div>
        </PageSection>
      )}

      {/* STAGE 1: Intel */}
      {status?.stage === "intel" && (
        <>
          <div className="rounded-xl border border-border/50 bg-muted/10 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Intel quality: <span className={intelPct >= 60 ? "text-accent font-medium" : "text-muted-foreground"}>{intelPct}%</span></span>
              <span className="text-xs text-muted-foreground">{status.evidenceCount}/3 evidence gathered</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full transition-all ${intelPct >= 80 ? "bg-accent" : intelPct >= 60 ? "bg-primary" : "bg-yellow-500"}`} style={{ width: `${intelPct}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              More intel = higher attribution confidence later. You can skip, but your result will be harder to attribute.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Research */}
            <PageSection title="Research" icon={Search}>
              <p className="text-xs text-muted-foreground">Cross-category prior-art findings.</p>
              <div className="mt-3 text-sm">
                {llmResearch ? (
                  llmResearch.llmUsed ? (
                    <p className="text-foreground/90 leading-relaxed line-clamp-4">{streamedResearch}</p>
                  ) : (
                    <p className="text-red-300 text-xs">LLM unavailable</p>
                  )
                ) : (
                  <p className="text-muted-foreground text-xs">Not run yet.</p>
                )}
              </div>
              <button onClick={runLLMResearch} disabled={researching} className="mt-3 btn btn-ghost btn-sm w-full">
                {researching ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />}
                {researching ? "..." : llmResearch ? "Re-run" : "Run research"}
              </button>
            </PageSection>

            {/* Confounders */}
            <PageSection title="Confounders" icon={AlertTriangle}>
              <p className="text-xs text-muted-foreground">Alternative explanations to watch for.</p>
              <div className="mt-3 text-sm">
                {llmConfounders ? (
                  <ul className="space-y-1">
                    {llmConfounders.slice(0, 3).map((c, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                        <span className="mt-1 h-1 w-1 rounded-full bg-red-400 shrink-0" />
                        <span className="line-clamp-2">{c}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-xs">Not run yet.</p>
                )}
              </div>
              <button onClick={runLLMConfounders} disabled={confounding} className="mt-3 btn btn-ghost btn-sm w-full">
                {confounding ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />}
                {confounding ? "..." : llmConfounders ? "Re-run" : "Attack"}
              </button>
            </PageSection>

            {/* Challenge */}
            <PageSection title="Challenge" icon={ShieldAlert}>
              <p className="text-xs text-muted-foreground">Adversarial review — argue against.</p>
              <div className="mt-3 text-sm">
                {llmChallenge ? (
                  <p className="text-foreground/90 leading-relaxed text-xs line-clamp-4">{streamedChallenge}</p>
                ) : (
                  <p className="text-muted-foreground text-xs">Not run yet.</p>
                )}
              </div>
              <button onClick={runLLMChallenge} disabled={challenging} className="mt-3 btn btn-ghost btn-sm w-full">
                {challenging ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />}
                {challenging ? "..." : llmChallenge ? "Re-run" : "Challenge"}
              </button>
            </PageSection>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => workflowAction("skipIntel")}
              disabled={acting}
              className="btn btn-ghost btn-sm"
            >
              Skip intel →
            </button>
            <button
              onClick={() => workflowAction("commitPlan", {
                plan: {
                  accountIds: assignment.eligibleAccountIds,
                  prediction: { metric: "engagement", expectedDirection: "increase", expectedMagnitude: "10%", unit: "rate" },
                  falsificationCriteria: "No improvement over baseline",
                  evaluationDays: 30,
                },
              })}
              disabled={acting}
              className="btn btn-primary"
            >
              Proceed to execution <ChevronRight className="ml-1 h-4 w-4" />
            </button>
          </div>
        </>
      )}

      {/* STAGE 2: Execution Plan */}
      {status?.stage === "execution" && (
        <PageSection title="Commit your execution plan" icon={Zap}>
          <p className="text-sm text-muted-foreground">
            This is your pre-registration. Your prediction is locked before you observe results — preventing hindsight bias.
          </p>
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What metric will you measure?</label>
              <input
                type="text"
                value={planForm.prediction.metric}
                onChange={(e) => setPlanForm({ ...planForm, prediction: { ...planForm.prediction, metric: e.target.value } })}
                placeholder="e.g. response rate, meeting count, prescription volume"
                className="mt-1 w-full rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Expected direction</label>
                <div className="mt-1 flex gap-2">
                  {([
                    { v: "increase", icon: TrendingUp, label: "Up" },
                    { v: "decrease", icon: TrendingDown, label: "Down" },
                    { v: "no_change", icon: Minus, label: "Same" },
                  ] as const).map(({ v, icon: Icon, label }) => (
                    <button
                      key={v}
                      onClick={() => setPlanForm({ ...planForm, prediction: { ...planForm.prediction, expectedDirection: v } })}
                      className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs ${
                        planForm.prediction.expectedDirection === v ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" /> {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Expected magnitude</label>
                <input
                  type="text"
                  value={planForm.prediction.expectedMagnitude}
                  onChange={(e) => setPlanForm({ ...planForm, prediction: { ...planForm.prediction, expectedMagnitude: e.target.value } })}
                  placeholder="e.g. 10%, 5 points"
                  className="mt-1 w-full rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-sm text-foreground"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What would falsify this?</label>
              <input
                type="text"
                value={planForm.falsificationCriteria}
                onChange={(e) => setPlanForm({ ...planForm, falsificationCriteria: e.target.value })}
                placeholder="e.g. No improvement over baseline after 30 days"
                className="mt-1 w-full rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Evaluation period (days)</label>
              <input
                type="number"
                value={planForm.evaluationDays}
                onChange={(e) => setPlanForm({ ...planForm, evaluationDays: parseInt(e.target.value) || 30 })}
                className="mt-1 w-24 rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-sm text-foreground"
              />
            </div>
          </div>
          <button
            onClick={() => workflowAction("commitPlan", {
              plan: {
                accountIds: assignment.eligibleAccountIds,
                prediction: { ...planForm.prediction, unit: planForm.prediction.unit || "rate" },
                falsificationCriteria: planForm.falsificationCriteria || "No improvement over baseline",
                evaluationDays: planForm.evaluationDays,
              },
            })}
            disabled={acting || !planForm.prediction.metric}
            className="mt-4 btn btn-primary"
          >
            {acting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Zap className="mr-1.5 h-4 w-4" />}
            Commit plan & begin execution
          </button>
        </PageSection>
      )}

      {/* STAGE 3: Observation */}
      {status?.stage === "observation" && (
        <PageSection title="Record your field observation" icon={Beaker}>
          {assignment.executionPlan && (
            <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
              <span className="font-semibold text-primary">Your prediction: </span>
              <span className="text-foreground/80">
                {assignment.executionPlan.prediction.metric} will {assignment.executionPlan.prediction.expectedDirection} by {assignment.executionPlan.prediction.expectedMagnitude}
              </span>
            </div>
          )}

          {/* Telemetry upload */}
          <div className="mb-4 rounded-xl border border-border/50 bg-muted/10 p-4">
            <p className="text-sm font-medium text-foreground">Upload your telemetry sheet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Drop your .xlsm or .xlsx file here. We'll extract metrics from named ranges, summary sheets, and call logs automatically.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsm,.xlsx,.xls"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadTelemetrySheet(file);
                }}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingSheet}
                className="btn btn-ghost btn-sm"
              >
                {uploadingSheet ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Beaker className="mr-1.5 h-3.5 w-3.5" />}
                {uploadingSheet ? "Parsing sheet..." : "Choose file"}
              </button>
              {telemetry && (
                <span className="text-xs text-accent">
                  {telemetry.summary?.totalMetrics || 0} metrics extracted via {telemetry.detectionMethods?.join(", ") || "auto-detect"}
                  {telemetry.callLogCount > 0 && ` · ${telemetry.callLogCount} call log entries`}
                </span>
              )}
            </div>

            {/* Extracted metrics display */}
            {telemetryMetrics.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Extracted metrics</p>
                {telemetryMetrics.map((m, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-border/30 bg-muted/5 px-3 py-1.5 text-xs">
                    <span className="text-foreground/80">{m.name}</span>
                    <span className="font-medium text-foreground">
                      {m.value}{m.unit}
                      {m.baseline && <span className="ml-2 text-muted-foreground">(baseline: {m.baseline}{m.unit})</span>}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{m.source.replace(/_/g, " ")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Manual observation form (pre-populated from telemetry if available) */}
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Result</label>
              <div className="mt-1 flex flex-wrap gap-2">
                {(["confirmed", "partial", "inconclusive", "falsified"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setObsForm({ ...obsForm, successKind: k, falsified: k === "falsified" })}
                    className={`rounded-lg border px-3 py-1.5 text-xs capitalize ${
                      obsForm.successKind === k ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                What happened? {telemetry && <span className="text-accent">(auto-filled from sheet)</span>}
              </label>
              <textarea
                value={obsForm.outcomeDescription}
                onChange={(e) => setObsForm({ ...obsForm, outcomeDescription: e.target.value })}
                placeholder="Describe what you observed in the field, or upload your telemetry sheet to auto-fill..."
                rows={3}
                className="mt-1 w-full rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-sm text-foreground"
              />
            </div>

            {/* Metric selector — if telemetry extracted multiple metrics, let rep pick which to report */}
            {telemetryMetrics.length > 1 && (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Select metric to report</label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {telemetryMetrics.map((m, i) => (
                    <button
                      key={i}
                      onClick={() => setObsForm({
                        ...obsForm,
                        metricName: m.name,
                        metricValue: String(m.value),
                        metricUnit: m.unit,
                        metricBaseline: m.baseline ? String(m.baseline) : "",
                        higherIsBetter: m.higherIsBetter,
                      })}
                      className={`rounded-lg border px-2 py-1 text-xs ${
                        obsForm.metricName === m.name ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground"
                      }`}
                    >
                      {m.name}: {m.value}{m.unit}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="text-xs text-muted-foreground">Metric name</label>
                <input type="text" value={obsForm.metricName} onChange={(e) => setObsForm({ ...obsForm, metricName: e.target.value })} className="mt-1 w-full rounded-lg border border-border/50 bg-muted/20 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Value</label>
                <input type="number" value={obsForm.metricValue} onChange={(e) => setObsForm({ ...obsForm, metricValue: e.target.value })} className="mt-1 w-full rounded-lg border border-border/50 bg-muted/20 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Baseline</label>
                <input type="number" value={obsForm.metricBaseline} onChange={(e) => setObsForm({ ...obsForm, metricBaseline: e.target.value })} className="mt-1 w-full rounded-lg border border-border/50 bg-muted/20 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Unit</label>
                <input type="text" value={obsForm.metricUnit} onChange={(e) => setObsForm({ ...obsForm, metricUnit: e.target.value })} className="mt-1 w-full rounded-lg border border-border/50 bg-muted/20 px-2 py-1.5 text-sm" />
              </div>
            </div>
            {obsForm.falsified && (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-red-300">Falsification evidence</label>
                <textarea
                  value={obsForm.falsificationEvidence}
                  onChange={(e) => setObsForm({ ...obsForm, falsificationEvidence: e.target.value })}
                  placeholder="What evidence falsified the hypothesis?"
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-foreground"
                />
              </div>
            )}
          </div>

          {/* Submit with all telemetry metrics if available, otherwise just the manual one */}
          <button
            onClick={() => workflowAction("observe", {
              observation: {
                successKind: obsForm.successKind,
                outcomeDescription: obsForm.outcomeDescription,
                // If telemetry extracted metrics, send ALL of them. Otherwise send the manual one.
                metrics: telemetryMetrics.length > 0
                  ? telemetryMetrics.map(m => ({
                      metric: m.name,
                      value: m.value,
                      unit: m.unit,
                      baseline: m.baseline || 0,
                      higherIsBetter: m.higherIsBetter,
                    }))
                  : obsForm.metricName && obsForm.metricValue ? [{
                      metric: obsForm.metricName,
                      value: parseFloat(obsForm.metricValue),
                      unit: obsForm.metricUnit || "count",
                      baseline: parseFloat(obsForm.metricBaseline) || 0,
                      higherIsBetter: obsForm.higherIsBetter,
                    }] : [],
                falsified: obsForm.falsified,
                falsificationEvidence: obsForm.falsificationEvidence || undefined,
                externalFactors: obsForm.externalFactors ? obsForm.externalFactors.split(",").map(s => s.trim()) : undefined,
              },
            })}
            disabled={acting || !obsForm.outcomeDescription}
            className="mt-4 btn btn-primary"
          >
            {acting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Beaker className="mr-1.5 h-4 w-4" />}
            Record observation{telemetryMetrics.length > 0 ? ` (${telemetryMetrics.length} metrics from sheet)` : ""}
          </button>
        </PageSection>
      )}

      {/* STAGE 4: Attribution */}
      {status?.stage === "attribution" && (
        <PageSection title="Causal attribution" icon={GitBranch}>
          <p className="text-sm text-muted-foreground">
            {attributionResult
              ? "Attribution complete. Review what caused your result, then finalize to close the loop."
              : "Run attribution analysis to determine what caused your result. Your intel quality affects confidence."}
          </p>
          {attributionResult && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
                  <p className="text-xs text-muted-foreground">Responsible factor</p>
                  <p className="mt-1 text-sm font-medium capitalize text-foreground">{attributionResult.responsibleFactor?.replace(/_/g, " ")}</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
                  <p className="text-xs text-muted-foreground">Confidence</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{Math.round((attributionResult.attributionConfidence || 0) * 100)}%</p>
                </div>
              </div>
              {attributionResult.counterfactualEstimate && (
                <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
                  <p className="text-xs text-muted-foreground">Counterfactual</p>
                  <p className="mt-1 text-sm text-foreground/90">{attributionResult.counterfactualEstimate}</p>
                </div>
              )}
              {attributionResult.unexplainedVariance > 0.3 && (
                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 text-xs text-yellow-200">
                  {Math.round(attributionResult.unexplainedVariance * 100)}% of the result is unexplained.
                  {status.evidenceCount < 3 && " More intel gathering in future cycles will improve attribution."}
                </div>
              )}
            </div>
          )}
          <div className="mt-4 flex gap-3">
            {!attributionResult && (
              <button onClick={() => workflowAction("attribute")} disabled={acting} className="btn btn-primary">
                {acting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <GitBranch className="mr-1.5 h-4 w-4" />}
                Run attribution
              </button>
            )}
            {attributionResult && (
              <button onClick={() => workflowAction("finalize")} disabled={acting} className="btn btn-primary">
                {acting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                Finalize & unlock next mission
              </button>
            )}
          </div>
        </PageSection>
      )}

      {/* STAGE 5: Finalized */}
      {status?.stage === "finalized" && (
        <PageSection title="Cycle complete" icon={Check}>
          <div className="flex items-center gap-3 rounded-xl border border-accent/20 bg-accent/5 p-4">
            <Trophy className="h-8 w-8 text-accent" />
            <div>
              <p className="text-sm font-semibold text-foreground">Mission {assignment.state === "falsified" ? "falsified" : "completed"}</p>
              <p className="text-xs text-muted-foreground">
                {assignment.state === "falsified"
                  ? "Honest falsification is a valuable result — it prevents others from repeating a dead end."
                  : `${workflow?.completedCycles || 0} cycle${(workflow?.completedCycles || 0) === 1 ? "" : "s"} completed.`}
              </p>
            </div>
          </div>
          {finalizeResult?.nextMissionHint && (
            <p className="mt-3 text-sm text-muted-foreground">{finalizeResult.nextMissionHint}</p>
          )}
          <button onClick={plantSeed} disabled={acting} className="mt-4 btn btn-primary">
            {acting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <><Sprout className="mr-1.5 h-4 w-4" /> Start next mission</>}
          </button>
        </PageSection>
      )}

      {/* ─── Experiment design (always visible for context) ──────── */}
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
    </div>
  );
}
