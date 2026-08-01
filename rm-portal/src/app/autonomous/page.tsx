"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Zap, Activity, DollarSign, Play, Pause, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react"
import { api, useApi } from "@/lib/api"
import { PageHeader, StatCard, SectionCard, LoadingState, statusBadgeClass } from "@/components/ui-helpers"

export default function AutonomousPage() {
  const { data: status, loading } = useApi<any>(() => api.autonomousStatus(), [], 15000)
  const { data: budget } = useApi<any>(() => api.autonomousBudget(1000), [], 60000)
  const [cycleResult, setCycleResult] = useState<any>(null)
  const [running, setRunning] = useState(false)
  const [toggling, setToggling] = useState(false)

  async function runCycle() {
    setRunning(true)
    const result = await api.autonomousCycle()
    setCycleResult(result)
    setRunning(false)
  }

  async function toggleAutonomous() {
    setToggling(true)
    if (status?.autonomous_enabled) {
      await api.autonomousDisable()
    } else {
      await api.autonomousEnable()
    }
    setToggling(false)
    window.location.reload()
  }

  if (loading) return <LoadingState label="Loading autonomous loop status..." />

  const isEnabled = status?.autonomous_enabled

  return (
    <div className="space-y-6">
      <PageHeader
        title="Autonomous Decision Loop"
        subtitle="Self-correcting experiment lifecycle with auto-approval — the AI runs without human intervention in AUTO mode"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          icon={Zap}
          value={status?.mode || "OBSERVE"}
          label="Current Mode"
          color={isEnabled ? "text-emerald-400" : "text-muted-foreground"}
        />
        <StatCard
          icon={Activity}
          value={status?.running_experiments ?? 0}
          label="Running Experiments"
          color="text-blue-400"
        />
        <StatCard
          icon={CheckCircle2}
          value={status?.completed_experiments ?? 0}
          label="Completed Experiments"
          color="text-purple-400"
        />
        <StatCard
          icon={AlertCircle}
          value={status?.recent_cycles?.length ?? 0}
          label="Recent Cycles"
          color="text-amber-400"
        />
      </div>

      {/* Control */}
      <SectionCard title="Autonomous Mode Control">
        <div className="flex items-center gap-4">
          <Button
            onClick={toggleAutonomous}
            disabled={toggling}
            variant={isEnabled ? "destructive" : "default"}
          >
            {toggling ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> :
             isEnabled ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
            {isEnabled ? "Disable Autonomous Mode" : "Enable Autonomous Mode"}
          </Button>
          <Button onClick={runCycle} disabled={running} variant="outline">
            {running ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            Run Cycle Now
          </Button>
          {isEnabled && (
            <Badge variant="default" className="bg-emerald-500/20 text-emerald-400">
              <span className="mr-1 h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              AUTONOMOUS
            </Badge>
          )}
        </div>

        {cycleResult && (
          <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
            <div className="text-sm font-medium mb-2">Cycle Result</div>
            <div className="grid grid-cols-4 gap-3 mb-3">
              <div className="rounded-md bg-background/50 p-2">
                <div className="text-xs text-muted-foreground">Mode</div>
                <div className="text-sm font-medium">{cycleResult.mode}</div>
              </div>
              <div className="rounded-md bg-background/50 p-2">
                <div className="text-xs text-muted-foreground">Evaluated</div>
                <div className="text-sm font-medium">{cycleResult.experiments_evaluated}</div>
              </div>
              <div className="rounded-md bg-background/50 p-2">
                <div className="text-xs text-muted-foreground">Decisions</div>
                <div className="text-sm font-medium">{cycleResult.decisions_made}</div>
              </div>
              <div className="rounded-md bg-background/50 p-2">
                <div className="text-xs text-muted-foreground">Auto-Approved</div>
                <div className="text-sm font-medium">{cycleResult.auto_approved}</div>
              </div>
            </div>
            {cycleResult.actions?.length > 0 && (
              <div className="space-y-1">
                {cycleResult.actions.map((a: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-xs">{a.action}</Badge>
                    <span>{a.experiment}</span>
                    {a.variant && <span>→ {a.variant}</span>}
                    {a.reward !== undefined && <span>(reward: {a.reward.toFixed(3)})</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* Capabilities */}
      <SectionCard title="Active Capabilities">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Object.entries(status?.capabilities || {}).map(([cap, enabled]: [string, any]) => (
            <div key={cap} className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
              <span className="text-sm text-foreground">{cap.replace(/_/g, " ")}</span>
              <Badge variant={enabled ? "default" : "secondary"} className="text-xs">
                {enabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Budget Allocation */}
      {budget && (
        <SectionCard title="Budget Allocation (ROI-Optimized)">
          <div className="space-y-2">
            {Object.entries(budget.allocations || {}).map(([type, data]: [string, any]) => (
              <div key={type} className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground capitalize">{type}</span>
                  <Badge variant="outline" className="text-xs">{data.percentage}%</Badge>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">Reward: {data.avg_reward}</span>
                  <span className="font-medium text-foreground">${data.budget}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Total budget: ${budget.total_budget} | Allocated based on cumulative reward signals from experiments
          </div>
        </SectionCard>
      )}

      {/* Recent Cycles */}
      {status?.recent_cycles && status.recent_cycles.length > 0 && (
        <SectionCard title="Recent Autonomous Cycles">
          <div className="space-y-2">
            {status.recent_cycles.map((c: any, i: number) => (
              <div key={i} className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2 text-sm">
                <span className="text-xs text-muted-foreground">{new Date(c.timestamp).toLocaleString()}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{c.decisions_made} decisions</span>
                  <span className="text-xs text-emerald-400">{c.auto_approved} auto-approved</span>
                  <span className="text-xs text-blue-400">{c.new_experiments} new experiments</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* How It Works */}
      <SectionCard title="How the Autonomous Loop Works">
        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 text-xs font-bold">1</div>
            <div>
              <div className="font-medium text-foreground">Evaluate Experiments</div>
              <div className="text-muted-foreground">All running experiments are evaluated based on variant rewards and statistical significance</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-500/20 text-purple-400 text-xs font-bold">2</div>
            <div>
              <div className="font-medium text-foreground">Make Decisions</div>
              <div className="text-muted-foreground">Promote high-reward variants, eliminate underperformers, continue borderline ones</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold">3</div>
            <div>
              <div className="font-medium text-foreground">Auto-Approve (AUTO mode)</div>
              <div className="text-muted-foreground">In AUTO mode, decisions are automatically approved without human intervention</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold">4</div>
            <div>
              <div className="font-medium text-foreground">Create Follow-up Experiments</div>
              <div className="text-muted-foreground">When experiments complete, new ones are automatically created with mutated variants from the winner</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-500/20 text-rose-400 text-xs font-bold">5</div>
            <div>
              <div className="font-medium text-foreground">Optimize Budget</div>
              <div className="text-muted-foreground">Budget is reallocated across channels based on cumulative ROI signals</div>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
