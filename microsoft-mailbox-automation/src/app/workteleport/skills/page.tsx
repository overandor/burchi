"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { GitBranch, TrendingUp, ArrowLeft, Sparkles, Clock } from "lucide-react";

interface SkillGenome {
  id: string;
  name: string;
  description: string;
  maturity: string;
  usageCount: number;
  lastUsedAt?: string;
  trigger: { type: string; pattern: string; priority: number };
  modelContribution: string;
  humanContribution: string;
  performanceHistory: any[];
}

const MATURITY_COLORS: Record<string, string> = {
  first_occurrence: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  model_assisted: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  workflow_assisted: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  deterministic: "bg-green-500/10 text-green-500 border-green-500/20",
  reopened_experiment: "bg-amber-500/10 text-amber-500 border-amber-500/20",
};

const MATURITY_LABELS: Record<string, string> = {
  first_occurrence: "First Occurrence",
  model_assisted: "Model Assisted",
  workflow_assisted: "Workflow Assisted",
  deterministic: "Deterministic",
  reopened_experiment: "Reopened Experiment",
};

export default function SkillGenomeLibrary() {
  const [skills, setSkills] = useState<SkillGenome[]>([]);
  const [distribution, setDistribution] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  const fetchSkills = useCallback(async () => {
    try {
      const [skillsRes, distRes] = await Promise.all([
        fetch("/api/workteleport/skills"),
        fetch("/api/workteleport/skills?distribution=true"),
      ]);
      if (skillsRes.ok) {
        const data = await skillsRes.json();
        setSkills(data.skills || []);
      }
      if (distRes.ok) {
        const data = await distRes.json();
        setDistribution(data.distribution);
      }
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const filtered = filter === "all" ? skills : skills.filter((s) => s.maturity === filter);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Link href="/workteleport" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <GitBranch className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Skill Genome Library</h1>
              <p className="text-xs text-muted-foreground">Reusable executable representations</p>
            </div>
          </div>
      </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Maturity Distribution */}
        {distribution && (
          <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-5">
            {Object.entries(distribution).map(([maturity, count]) => (
              <div key={maturity} className={`rounded-lg border p-4 ${MATURITY_COLORS[maturity] || ""}`}>
                <div className="text-2xl font-bold">{count}</div>
                <div className="text-xs">{MATURITY_LABELS[maturity] || maturity}</div>
              </div>
            ))}
          </div>
        )}

        {/* Maturity Progression Info */}
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" /> Maturity Progression
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-gray-500/10 px-2 py-1 text-gray-500">First Occurrence</span>
            →
            <span className="rounded-full bg-blue-500/10 px-2 py-1 text-blue-500">Model Assisted</span>
            →
            <span className="rounded-full bg-purple-500/10 px-2 py-1 text-purple-500">Workflow Assisted</span>
            →
            <span className="rounded-full bg-green-500/10 px-2 py-1 text-green-500">Deterministic</span>
            <span className="ml-2 text-muted-foreground/60">(reopens on failure)</span>
          </div>
        </div>

        {/* Filter */}
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`rounded-lg px-3 py-1.5 text-xs ${filter === "all" ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}
          >
            All ({skills.length})
          </button>
          {Object.keys(MATURITY_LABELS).map((m) => (
            <button
              key={m}
              onClick={() => setFilter(m)}
              className={`rounded-lg px-3 py-1.5 text-xs ${filter === m ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}
            >
              {MATURITY_LABELS[m]} ({distribution?.[m] || 0})
            </button>
          ))}
        </div>

        {/* Skills Grid */}
        {loading ? (
          <div className="text-muted-foreground">Loading skills...</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <GitBranch className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No skill genomes yet. Skills are created automatically as workflows are executed repeatedly.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((skill) => (
              <div key={skill.id} className="rounded-xl border border-border bg-card p-5">
                <div className="mb-2 flex items-start justify-between">
                  <h3 className="text-sm font-semibold">{skill.name}</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${MATURITY_COLORS[skill.maturity] || ""}`}>
                    {MATURITY_LABELS[skill.maturity] || skill.maturity}
                  </span>
                </div>
                <p className="mb-3 text-xs text-muted-foreground">{skill.description}</p>

                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Trigger:</span>
                    <span className="font-mono">{skill.trigger.type}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Pattern:</span>
                    <span className="font-mono truncate max-w-[150px]">{skill.trigger.pattern}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Usage:</span>
                    <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" /> {skill.usageCount}x</span>
                  </div>
                  {skill.lastUsedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Last used:</span>
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(skill.lastUsedAt).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>

                {skill.performanceHistory.length > 0 && (
                  <div className="mt-3 border-t border-border/50 pt-2">
                    <div className="text-xs text-muted-foreground">Performance: {skill.performanceHistory.length} events</div>
                    <div className="mt-1 flex gap-1">
                      {skill.performanceHistory.slice(-10).map((p, i) => (
                        <div
                          key={i}
                          className={`h-2 w-2 rounded-full ${p.success ? "bg-green-500" : "bg-red-500"}`}
                          title={p.success ? "Success" : "Failed"}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {(skill.modelContribution || skill.humanContribution) && (
                  <div className="mt-3 border-t border-border/50 pt-2 text-xs">
                    {skill.modelContribution && (
                      <div className="text-blue-500">Model: {skill.modelContribution}</div>
                    )}
                    {skill.humanContribution && (
                      <div className="text-green-500">Human: {skill.humanContribution}</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
