"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Mail, Workflow, Shield, GitBranch, FlaskConical, Sparkles,
  TrendingUp, AlertCircle, CheckCircle2, Clock, ArrowRight,
  Layers, Brain, Target, Zap, FileText, Lock,
} from "lucide-react";

interface EvidenceEnvelope {
  id: string;
  source: string;
  sender: string;
  originalContent: string;
  contentHash: string;
  requestedWork?: string;
  createdAt: string;
}

interface TaskIR {
  id: string;
  objective: string;
  taskType: string;
  status: string;
  createdAt: string;
}

interface Workflow {
  id: string;
  state: string;
  steps: any[];
  createdAt: string;
}

interface CommitRecord {
  id: string;
  actionType: string;
  actionTarget: string;
  committed: boolean;
  committedAt: string;
}

interface Stats {
  evidence: number;
  tasks: number;
  workflows: number;
  commits: number;
  skills: number;
  twins: number;
  ventures: number;
  hypotheses: number;
}

export default function WorkteleportDashboard() {
  const [evidence, setEvidence] = useState<EvidenceEnvelope[]>([]);
  const [tasks, setTasks] = useState<TaskIR[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [commits, setCommits] = useState<CommitRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [compileInput, setCompileInput] = useState("");
  const [compiling, setCompiling] = useState(false);
  const [compileResult, setCompileResult] = useState<any>(null);

  const fetchData = useCallback(async () => {
    try {
      const [evRes, taskRes, wfRes, commitRes] = await Promise.all([
        fetch("/api/workteleport/evidence?limit=5"),
        fetch("/api/workteleport/compile?limit=5"),
        fetch("/api/workteleport/workflow?limit=5"),
        fetch("/api/workteleport/commit?limit=5"),
      ]);
      if (evRes.ok) {
        const evData = await evRes.json();
        setEvidence(evData.envelopes || []);
      }
      if (taskRes.ok) {
        const taskData = await taskRes.json();
        setTasks(taskData.tasks || []);
      }
      if (wfRes.ok) {
        const wfData = await wfRes.json();
        setWorkflows(wfData.workflows || []);
      }
      if (commitRes.ok) {
        const commitData = await commitRes.json();
        setCommits(commitData.records || []);
      }

      const counts: Stats = {
        evidence: evidence.length,
        tasks: tasks.length,
        workflows: workflows.length,
        commits: commits.length,
        skills: 0,
        twins: 0,
        ventures: 0,
        hypotheses: 0,
      };
      setStats(counts);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleCompile() {
    if (!compileInput.trim()) return;
    setCompiling(true);
    setError(null);
    try {
      // Step 1: Create evidence envelope
      const evRes = await fetch("/api/workteleport/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "manual",
          sourceIdentifier: `manual_${Date.now()}`,
          sender: "user",
          originalContent: compileInput,
          requestedWork: compileInput,
        }),
      });
      if (!evRes.ok) throw new Error("Failed to create evidence envelope");
      const evData = await evRes.json();

      // Step 2: Compile through the pipeline
      const compileRes = await fetch("/api/workteleport/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evidenceEnvelopeId: evData.envelope.id }),
      });
      if (!compileRes.ok) {
        const errData = await compileRes.json();
        throw new Error(errData.error || "Compilation failed");
      }
      const result = await compileRes.json();
      setCompileResult(result);
      fetchData();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCompiling(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading WORKTELEPORT...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Workflow className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold">WORKTELEPORT-RL</h1>
              <p className="text-xs text-muted-foreground">Email-to-Execution Compiler</p>
            </div>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/workteleport/skills" className="text-muted-foreground hover:text-foreground">Skills</Link>
            <Link href="/workteleport/twins" className="text-muted-foreground hover:text-foreground">Twins</Link>
            <Link href="/workteleport/ventures" className="text-muted-foreground hover:text-foreground">Ventures</Link>
            <Link href="/workteleport/dissect" className="text-muted-foreground hover:text-foreground">Dissect</Link>
            <Link href="/workteleport/taxonomy" className="text-muted-foreground hover:text-foreground">Taxonomy</Link>
            <Link href="/" className="text-muted-foreground hover:text-foreground">Home</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Stats Grid */}
        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-8">
          <StatCard icon={<Mail className="h-4 w-4" />} label="Evidence" value={evidence.length} color="text-blue-500" />
          <StatCard icon={<FileText className="h-4 w-4" />} label="Tasks" value={tasks.length} color="text-cyan-500" />
          <StatCard icon={<Workflow className="h-4 w-4" />} label="Workflows" value={workflows.length} color="text-purple-500" />
          <StatCard icon={<Lock className="h-4 w-4" />} label="Commits" value={commits.length} color="text-orange-500" />
          <StatCard icon={<GitBranch className="h-4 w-4" />} label="Skills" value={stats?.skills ?? 0} color="text-green-500" />
          <StatCard icon={<FlaskConical className="h-4 w-4" />} label="Twins" value={stats?.twins ?? 0} color="text-pink-500" />
          <StatCard icon={<Target className="h-4 w-4" />} label="Ventures" value={stats?.ventures ?? 0} color="text-amber-500" />
          <StatCard icon={<Brain className="h-4 w-4" />} label="Hypotheses" value={stats?.hypotheses ?? 0} color="text-indigo-500" />
        </div>

        {/* Compiler Input */}
        <section className="mb-8 rounded-xl border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Email-to-Execution Compiler</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Paste an email or request. The system will create an Evidence Envelope, classify intent,
            decompose into typed tasks, resolve role contracts, plan capabilities, and generate Task IRs.
          </p>
          <textarea
            className="mb-3 w-full rounded-lg border border-border bg-background p-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            rows={4}
            placeholder="e.g., Please reconcile the attached travel expenses and create an expense report before Friday."
            value={compileInput}
            onChange={(e) => setCompileInput(e.target.value)}
          />
          <button
            onClick={handleCompile}
            disabled={compiling || !compileInput.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {compiling ? (
              <>
                <Clock className="h-4 w-4 animate-spin" /> Compiling...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4" /> Compile to Task IR
              </>
            )}
          </button>

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          )}

          {compileResult && (
            <div className="mt-6 space-y-4">
              {/* Understanding */}
              <div className="rounded-lg border border-border bg-background p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Brain className="h-4 w-4 text-primary" /> Stage 1: Communication Understanding
                </h3>
                <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                  <div><span className="text-muted-foreground">Sender:</span> {compileResult.understanding.senderName}</div>
                  <div><span className="text-muted-foreground">Relationship:</span> {compileResult.understanding.relationship}</div>
                  <div><span className="text-muted-foreground">Authority:</span> {compileResult.understanding.authorityLevel}</div>
                  <div><span className="text-muted-foreground">Speaker:</span> {compileResult.understanding.properSpeaker}</div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {compileResult.understanding.intentTypes?.map((intent: string) => (
                    <span key={intent} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{intent}</span>
                  ))}
                </div>
              </div>

              {/* Role Contract */}
              <div className="rounded-lg border border-border bg-background p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Shield className="h-4 w-4 text-primary" /> Stage 3: Role Operating Contract
                </h3>
                <div className="space-y-1 text-xs">
                  <div><span className="text-muted-foreground">Requester permitted:</span> {compileResult.roleContract?.requesterPermitted ? "Yes" : "No"}</div>
                  <div><span className="text-muted-foreground">Monetary threshold:</span> ${compileResult.roleContract?.monetaryThreshold || 0}</div>
                  <div><span className="text-muted-foreground">Segregation of duties:</span> {compileResult.roleContract?.segregationOfDutiesRequired ? "Required" : "Not required"}</div>
                  {compileResult.roleContract?.prohibitedActions?.length > 0 && (
                    <div className="text-red-500">Prohibited: {compileResult.roleContract.prohibitedActions.join(", ")}</div>
                  )}
                </div>
              </div>

              {/* Tasks */}
              <div className="rounded-lg border border-border bg-background p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Layers className="h-4 w-4 text-primary" /> Stage 4: Task IRs ({compileResult.tasks?.length || 0})
                </h3>
                <div className="space-y-2">
                  {compileResult.tasks?.map((task: any, i: number) => (
                    <div key={task.id} className="rounded-lg border border-border/50 bg-card/50 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-muted-foreground">{task.id.substring(0, 16)}...</span>
                        <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-500">{task.taskType}</span>
                      </div>
                      <p className="mt-1 text-sm">{task.objective}</p>
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Status:</span>
                        <span className="font-medium">{task.status}</span>
                        {task.approvalBoundary?.required && (
                          <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-500">Approval required</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Recent Activity */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Evidence Envelopes */}
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <Mail className="h-4 w-4 text-blue-500" /> Recent Evidence Envelopes
            </h2>
            {evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground">No evidence envelopes yet.</p>
            ) : (
              <div className="space-y-2">
                {evidence.map((ev) => (
                  <div key={ev.id} className="rounded-lg border border-border/50 bg-background p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-muted-foreground">{ev.id.substring(0, 20)}...</span>
                      <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-blue-500">{ev.source}</span>
                    </div>
                    <p className="mt-1 truncate text-sm">{ev.originalContent}</p>
                    {ev.requestedWork && (
                      <p className="mt-1 text-xs text-muted-foreground">Work: {ev.requestedWork}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Workflows */}
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <Workflow className="h-4 w-4 text-purple-500" /> Recent Workflows
            </h2>
            {workflows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workflows yet. Compile a request above to create one.</p>
            ) : (
              <div className="space-y-2">
                {workflows.map((wf) => (
                  <div key={wf.id} className="rounded-lg border border-border/50 bg-background p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-muted-foreground">{wf.id.substring(0, 20)}...</span>
                      <StateBadge state={wf.state} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {wf.steps.length} step(s) · Created {new Date(wf.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Tasks */}
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4 text-cyan-500" /> Recent Task IRs
            </h2>
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks yet.</p>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <div key={task.id} className="rounded-lg border border-border/50 bg-background p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-muted-foreground">{task.id.substring(0, 20)}...</span>
                      <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-cyan-500">{task.taskType}</span>
                    </div>
                    <p className="mt-1 text-sm">{task.objective}</p>
                    <div className="mt-1 text-xs text-muted-foreground">Status: {task.status}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Commits */}
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <Lock className="h-4 w-4 text-orange-500" /> Recent Commit Records
            </h2>
            {commits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No commits yet. Execute a workflow to generate commits.</p>
            ) : (
              <div className="space-y-2">
                {commits.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border/50 bg-background p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-muted-foreground">{c.id.substring(0, 20)}...</span>
                      {c.committed ? (
                        <span className="flex items-center gap-1 text-green-500"><CheckCircle2 className="h-3 w-3" /> Committed</span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-500"><AlertCircle className="h-3 w-3" /> Blocked</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm">{c.actionType} → {c.actionTarget}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Navigation Cards */}
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <NavCard href="/workteleport/skills" icon={<GitBranch />} title="Skill Genome Library" desc="Reusable executable representations with maturity progression" />
          <NavCard href="/workteleport/twins" icon={<FlaskConical />} title="Experiment Twins" desc="Every workflow gets an experimental counterpart" />
          <NavCard href="/workteleport/ventures" icon={<Target />} title="Venture Capsules" desc="Golden Nodes packaged as deployable business channels" />
          <NavCard href="/workteleport/dissect" icon={<Brain />} title="Dissect Pipeline" desc="Hypothesis → PICO-TMR → Demoronify → Research → Novelty" />
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className={`mb-1 ${color}`}>{icon}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    pending: "bg-gray-500/10 text-gray-500",
    executing: "bg-blue-500/10 text-blue-500",
    awaiting_approval: "bg-amber-500/10 text-amber-500",
    completed: "bg-green-500/10 text-green-500",
    failed: "bg-red-500/10 text-red-500",
    rolled_back: "bg-orange-500/10 text-orange-500",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${colors[state] || colors.pending}`}>{state}</span>
  );
}

function NavCard({ href, icon, title, desc }: { href: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link href={href} className="group rounded-xl border border-border bg-card p-5 transition hover:border-primary/50 hover:bg-primary/5">
      <div className="mb-2 text-primary">{icon}</div>
      <h3 className="text-sm font-semibold group-hover:text-primary">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
      <div className="mt-3 flex items-center gap-1 text-xs text-primary opacity-0 transition group-hover:opacity-100">
        Open <ArrowRight className="h-3 w-3" />
      </div>
    </Link>
  );
}
