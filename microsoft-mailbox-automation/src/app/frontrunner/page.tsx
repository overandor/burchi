"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Telescope,
  Sparkles,
  GitBranch,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  Award,
  Target,
  DollarSign,
  Clock,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Zap,
  Brain,
  Layers,
  Shield,
} from "lucide-react";
import { useVoicePage } from "@/components/VoiceContext";

interface Opportunity {
  id: string;
  title: string;
  description: string;
  category: string;
  gapDescription: string;
  targetUsers: string[];
  marketSignals: string[];
  noveltyDelta: string | null;
  score: number;
  status: string;
}

interface ProductGenome {
  id: string;
  name: string;
  problem: string;
  eligibleUsers: string[];
  existingAlternatives: string[];
  unresolvedNeed: string;
  priorArtBoundary: string;
  noveltyDelta: string;
  requiredFunctionality: string[];
  systemArchitecture: Record<string, any>;
  dataModel: Record<string, any>;
  externalIntegrations: string[];
  authPermissions: Record<string, any>;
  complianceConditions: string[];
  failureRollback: string[];
  testingRequirements: string[];
  deploymentTarget: string;
  pricingHypothesis: Record<string, any>;
  distributionMethod: string;
  measurableValue: string;
  costAvoided: string;
  evidenceRequired: string[];
  completenessScore: number;
  completenessChecks: Record<string, { passed: boolean; detail: string }>;
  fitnessScore: number;
  branchType: string;
  status: string;
  opportunityId: string | null;
  parentGenomeId: string | null;
}

interface WorkflowGenome {
  id: string;
  name: string;
  trigger: string;
  executionStages: string[];
  validationCriteria: string[];
  failureConditions: string[];
  humanApprovalPoints: string[];
  expectedBusinessValue: string;
  estimatedCostAvoided: string;
  expectedTimeSaved: string;
  fitnessScore: number;
  rank: number;
  status: string;
}

interface GravityQuestion {
  id: string;
  question: string;
  options: { label: string; value: string; weightChanges: Record<string, number> }[];
}

interface Epoch {
  id: string;
  epochNumber: number;
  opportunitiesScanned: number;
  candidatesGenerated: number;
  variantsGenerated: number;
  variantsEliminated: number;
  winnersPromoted: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
}

type Tab = "opportunities" | "genomes" | "workflows" | "gravity" | "epochs";

export default function FrontrunnerPage() {
  const [tab, setTab] = useState<Tab>("opportunities");
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [genomes, setGenomes] = useState<ProductGenome[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowGenome[]>([]);
  const [questions, setQuestions] = useState<GravityQuestion[]>([]);
  const [epochs, setEpochs] = useState<Epoch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOpp, setSelectedOpp] = useState<string | null>(null);
  const [selectedGenome, setSelectedGenome] = useState<string | null>(null);
  const [expandedGenome, setExpandedGenome] = useState<string | null>(null);
  const [userSignal, setUserSignal] = useState("");
  const [generating, setGenerating] = useState<string | null>(null);

  useVoicePage({
    pageId: "frontrunner",
    title: "SPINOR Frontrunner",
    summary: `${opportunities.length} opportunities, ${genomes.length} product genomes, ${workflows.length} workflow genomes`,
    actions: [
      { name: "scan", label: "scan opportunities", available: true, handler: async () => { await runScan(); return { success: true, speech: "Scan complete." }; } },
      { name: "epoch", label: "run epoch", available: true, handler: async () => { await runEpoch(); return { success: true, speech: "Epoch complete." }; } },
    ],
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [oppRes, genomeRes, wfRes, qRes, epochRes] = await Promise.all([
        fetch("/api/frontrunner/opportunities", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ opportunities: [] })),
        fetch("/api/frontrunner/genomes", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ genomes: [] })),
        fetch("/api/frontrunner/workflows", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ workflows: [] })),
        fetch("/api/frontrunner/gravity?action=questions", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ questions: [] })),
        fetch("/api/frontrunner/epoch", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ epochs: [] })),
      ]);
      setOpportunities(oppRes.opportunities || []);
      setGenomes(genomeRes.genomes || []);
      setWorkflows(wfRes.workflows || []);
      setQuestions(qRes.questions || []);
      setEpochs(epochRes.epochs || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function runScan() {
    setLoading(true);
    setError(null);
    try {
      const signals = userSignal.trim() ? [userSignal.trim()] : [];
      const res = await fetch("/api/frontrunner/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan", userSignals: signals }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setOpportunities(data.opportunities || []);
      setUserSignal("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function runEpoch() {
    setLoading(true);
    setError(null);
    try {
      const signals = userSignal.trim() ? [userSignal.trim()] : [];
      const res = await fetch("/api/frontrunner/epoch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userSignals: signals }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function generateGenome(opportunityId: string) {
    setGenerating(opportunityId);
    setError(null);
    try {
      const res = await fetch("/api/frontrunner/genomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", opportunityId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadAll();
      setTab("genomes");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(null);
    }
  }

  async function generateVariants(genomeId: string) {
    setGenerating(genomeId);
    setError(null);
    try {
      const res = await fetch("/api/frontrunner/genomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_variants", genomeId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(null);
    }
  }

  async function compileWorkflow(genomeId: string) {
    setGenerating(genomeId);
    setError(null);
    try {
      const res = await fetch("/api/frontrunner/genomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "compile_workflow", genomeId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadAll();
      setTab("workflows");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(null);
    }
  }

  async function answerGravity(q: GravityQuestion, value: string, weightChanges: Record<string, number>) {
    try {
      await fetch("/api/frontrunner/gravity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: q.id,
          questionText: q.question,
          answer: value,
          weightChanges,
        }),
      });
      await loadAll();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const tabs: { id: Tab; label: string; icon: any; count: number }[] = [
    { id: "opportunities", label: "Opportunities", icon: Telescope, count: opportunities.length },
    { id: "genomes", label: "Product Genomes", icon: GitBranch, count: genomes.length },
    { id: "workflows", label: "Workflow Portfolio", icon: Layers, count: workflows.length },
    { id: "gravity", label: "Choice Gravity", icon: Target, count: questions.length },
    { id: "epochs", label: "Epochs", icon: Clock, count: epochs.length },
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 page-enter">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-[0_0_20px_-4px_hsl(var(--primary)/0.35)]">
            <Telescope className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">SPINOR Frontrunner</h1>
            <p className="text-sm text-muted-foreground">Prior-art-native, zero-blank-page product evolution</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          The system performs the preparatory work before asking you to choose a direction.
          You enter a prepared possibility field rather than a blank conversation.
        </p>
      </div>

      {/* Scan bar */}
      <div className="mb-6 flex gap-2">
        <input
          type="text"
          value={userSignal}
          onChange={(e) => setUserSignal(e.target.value)}
          placeholder="Optional: describe a pain point, missing integration, or manual workflow..."
          className="flex-1 rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
        <button
          onClick={runScan}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Telescope className="h-4 w-4" />}
          Scan
        </button>
        <button
          onClick={runEpoch}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          Run Full Epoch
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-destructive/70 hover:text-destructive">×</button>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-border">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              {t.count > 0 && (
                <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading && tab === "opportunities" && opportunities.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Opportunities tab */}
      {tab === "opportunities" && (
        <div className="space-y-4">
          {opportunities.length === 0 && !loading && (
            <div className="rounded-lg border border-border bg-muted/10 p-12 text-center">
              <Telescope className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground mb-4">
                No opportunities yet. Run a scan to discover real product gaps.
              </p>
              <button
                onClick={runScan}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Telescope className="h-4 w-4" />
                Scan Now
              </button>
            </div>
          )}
          {opportunities.map((opp) => (
            <div
              key={opp.id}
              className={`rounded-lg border bg-card p-5 transition-colors ${
                selectedOpp === opp.id ? "border-primary" : "border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-foreground">{opp.title}</h3>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Score: {opp.score}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{opp.description}</p>
                  <p className="text-sm text-foreground/80 mb-3">
                    <span className="font-medium">Gap: </span>{opp.gapDescription}
                  </p>
                  {opp.targetUsers.length > 0 && (
                    <div className="mb-2">
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Target Users</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {opp.targetUsers.map((u, i) => (
                          <span key={i} className="rounded bg-muted px-2 py-0.5 text-xs text-foreground/80">{u}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {opp.marketSignals.length > 0 && (
                    <div className="mb-2">
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Market Signals</span>
                      <ul className="mt-1 space-y-0.5">
                        {opp.marketSignals.map((s, i) => (
                          <li key={i} className="text-xs text-foreground/70">• {s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {opp.noveltyDelta && (
                    <p className="text-xs text-foreground/70 mt-2">
                      <span className="font-medium">Novelty: </span>{opp.noveltyDelta}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => generateGenome(opp.id)}
                  disabled={generating === opp.id}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                >
                  {generating === opp.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Generate Genome
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Genomes tab */}
      {tab === "genomes" && (
        <div className="space-y-3">
          {genomes.length === 0 && !loading && (
            <div className="rounded-lg border border-border bg-muted/10 p-12 text-center">
              <GitBranch className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                No product genomes yet. Generate one from an opportunity.
              </p>
            </div>
          )}
          {genomes.map((genome) => {
            const expanded = expandedGenome === genome.id;
            const checks = Object.entries(genome.completenessChecks);
            const passedChecks = checks.filter(([, c]) => c.passed).length;
            return (
              <div key={genome.id} className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-foreground">{genome.name}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        genome.branchType === "primary" ? "bg-primary/10 text-primary" :
                        genome.branchType === "low_cost" ? "bg-emerald-500/10 text-emerald-400" :
                        genome.branchType === "high_upside" ? "bg-amber-500/10 text-amber-400" :
                        "bg-violet-500/10 text-violet-400"
                      }`}>
                        {genome.branchType.replace(/_/g, " ")}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        genome.status === "ready" ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground"
                      }`}>
                        {genome.status}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{genome.problem}</p>

                    {/* Scores */}
                    <div className="flex gap-4 mb-3">
                      <div className="flex items-center gap-1.5">
                        <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Completeness:</span>
                        <span className={`text-xs font-medium ${genome.completenessScore >= 70 ? "text-emerald-400" : "text-amber-400"}`}>
                          {genome.completenessScore}% ({passedChecks}/{checks.length})
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Fitness:</span>
                        <span className="text-xs font-medium text-primary">{genome.fitnessScore}</span>
                      </div>
                    </div>

                    {/* Quick info */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      {genome.measurableValue && (
                        <div><span className="text-muted-foreground">Value: </span><span className="text-foreground/80">{genome.measurableValue.slice(0, 80)}</span></div>
                      )}
                      {genome.deploymentTarget && (
                        <div><span className="text-muted-foreground">Deploy: </span><span className="text-foreground/80">{genome.deploymentTarget}</span></div>
                      )}
                      {genome.pricingHypothesis?.model && (
                        <div><span className="text-muted-foreground">Pricing: </span><span className="text-foreground/80">{genome.pricingHypothesis.model}</span></div>
                      )}
                      {genome.distributionMethod && (
                        <div><span className="text-muted-foreground">Distribution: </span><span className="text-foreground/80">{genome.distributionMethod}</span></div>
                      )}
                    </div>

                    {/* Expandable details */}
                    {expanded && (
                      <div className="mt-4 space-y-3 border-t border-border pt-3">
                        {/* Completeness checks */}
                        <div>
                          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Production Completeness Gate</span>
                          <div className="mt-1 grid grid-cols-2 gap-1">
                            {checks.map(([key, check]) => (
                              <div key={key} className="flex items-center gap-1.5 text-xs">
                                {check.passed ? (
                                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                                ) : (
                                  <XCircle className="h-3 w-3 text-destructive" />
                                )}
                                <span className="text-foreground/70">{key}:</span>
                                <span className="text-muted-foreground">{check.detail}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Required functionality */}
                        {genome.requiredFunctionality.length > 0 && (
                          <div>
                            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Required Functionality</span>
                            <ul className="mt-1 space-y-0.5">
                              {genome.requiredFunctionality.map((f, i) => (
                                <li key={i} className="text-xs text-foreground/70">• {f}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Data model */}
                        {genome.dataModel?.entities && (
                          <div>
                            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Data Model</span>
                            <div className="mt-1 space-y-1">
                              {genome.dataModel.entities.map((e: any, i: number) => (
                                <div key={i} className="text-xs text-foreground/70">
                                  <span className="font-medium">{e.name}</span>: {e.fields?.join(", ")}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Evidence required */}
                        {genome.evidenceRequired.length > 0 && (
                          <div>
                            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Evidence Still Required</span>
                            <ul className="mt-1 space-y-0.5">
                              {genome.evidenceRequired.map((e, i) => (
                                <li key={i} className="text-xs text-amber-400/80">• {e}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button
                      onClick={() => setExpandedGenome(expanded ? null : genome.id)}
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-foreground/70 hover:bg-muted/30"
                    >
                      {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      Details
                    </button>
                    <button
                      onClick={() => generateVariants(genome.id)}
                      disabled={generating === genome.id}
                      className="flex items-center gap-1 rounded border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-xs text-violet-400 hover:bg-violet-500/20 disabled:opacity-50"
                    >
                      {generating === genome.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitBranch className="h-3 w-3" />}
                      Variants
                    </button>
                    <button
                      onClick={() => compileWorkflow(genome.id)}
                      disabled={generating === genome.id}
                      className="flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20 disabled:opacity-50"
                    >
                      {generating === genome.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Layers className="h-3 w-3" />}
                      Compile Workflow
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Workflows tab */}
      {tab === "workflows" && (
        <div className="space-y-3">
          {workflows.length === 0 && !loading && (
            <div className="rounded-lg border border-border bg-muted/10 p-12 text-center">
              <Layers className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                No workflow genomes yet. Compile one from a product genome.
              </p>
            </div>
          )}
          {workflows.map((wf, i) => (
            <div key={wf.id} className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {wf.rank > 0 && (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {wf.rank}
                      </span>
                    )}
                    <h3 className="font-semibold text-foreground">{wf.name}</h3>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Fitness: {wf.fitnessScore}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    <span className="font-medium">Trigger: </span>{wf.trigger}
                  </p>
                  {wf.executionStages.length > 0 && (
                    <div className="mb-2">
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Execution Stages</span>
                      <ol className="mt-1 space-y-0.5">
                        {wf.executionStages.map((s, idx) => (
                          <li key={idx} className="text-xs text-foreground/70">{idx + 1}. {s}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {wf.expectedBusinessValue && (
                      <div><span className="text-muted-foreground">Value: </span><span className="text-foreground/80">{wf.expectedBusinessValue.slice(0, 60)}</span></div>
                    )}
                    {wf.estimatedCostAvoided && (
                      <div><span className="text-muted-foreground">Cost Avoided: </span><span className="text-foreground/80">{wf.estimatedCostAvoided}</span></div>
                    )}
                    {wf.expectedTimeSaved && (
                      <div><span className="text-muted-foreground">Time Saved: </span><span className="text-foreground/80">{wf.expectedTimeSaved}</span></div>
                    )}
                  </div>
                  {wf.failureConditions.length > 0 && (
                    <div className="mt-2">
                      <span className="text-xs font-medium uppercase tracking-wider text-destructive/70">Failure Conditions</span>
                      <ul className="mt-0.5 space-y-0.5">
                        {wf.failureConditions.map((f, idx) => (
                          <li key={idx} className="text-xs text-destructive/60">• {f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Gravity tab */}
      {tab === "gravity" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/10 p-4">
            <p className="text-sm text-muted-foreground">
              Your answers act as gravity: they pull some branches closer, push others away,
              and change implementation priority. Only questions with high information value are asked.
            </p>
          </div>
          {questions.map((q) => (
            <div key={q.id} className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-medium text-foreground mb-3">{q.question}</h3>
              <div className="flex flex-wrap gap-2">
                {q.options.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => answerGravity(q, opt.value, opt.weightChanges)}
                    className="rounded-lg border border-border bg-muted/20 px-4 py-2 text-sm text-foreground/80 hover:border-primary hover:bg-primary/10 hover:text-primary transition-colors"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Epochs tab */}
      {tab === "epochs" && (
        <div className="space-y-3">
          {epochs.length === 0 && !loading && (
            <div className="rounded-lg border border-border bg-muted/10 p-12 text-center">
              <Clock className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                No epochs run yet. Run a full epoch to execute the complete evolutionary cycle.
              </p>
            </div>
          )}
          {epochs.map((epoch) => (
            <div key={epoch.id} className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-primary">Epoch {epoch.epochNumber}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    epoch.status === "completed" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
                  }`}>
                    {epoch.status}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {epoch.startedAt} {epoch.completedAt ? `→ ${epoch.completedAt}` : ""}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-3 text-center">
                <div className="rounded bg-muted/20 p-2">
                  <div className="text-lg font-bold text-foreground">{epoch.opportunitiesScanned}</div>
                  <div className="text-xs text-muted-foreground">Scanned</div>
                </div>
                <div className="rounded bg-muted/20 p-2">
                  <div className="text-lg font-bold text-foreground">{epoch.candidatesGenerated}</div>
                  <div className="text-xs text-muted-foreground">Candidates</div>
                </div>
                <div className="rounded bg-muted/20 p-2">
                  <div className="text-lg font-bold text-foreground">{epoch.variantsGenerated}</div>
                  <div className="text-xs text-muted-foreground">Variants</div>
                </div>
                <div className="rounded bg-muted/20 p-2">
                  <div className="text-lg font-bold text-foreground">{epoch.variantsEliminated}</div>
                  <div className="text-xs text-muted-foreground">Eliminated</div>
                </div>
                <div className="rounded bg-muted/20 p-2">
                  <div className="text-lg font-bold text-emerald-400">{epoch.winnersPromoted}</div>
                  <div className="text-xs text-muted-foreground">Promoted</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
