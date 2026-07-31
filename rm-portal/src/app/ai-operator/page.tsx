"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import {
  Brain,
  Zap,
  Clock,
  GitBranch,
  FlaskConical,
  Layers,
  Trophy,
  Activity,
  Loader2,
} from "lucide-react"
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  CartesianGrid,
} from "recharts"
import { useApi, api, type AIStatus, type OverviewData } from "@/lib/api"
import { PageHeader, LoadingState, StatCard } from "@/components/ui-helpers"

const controlModeLabels: Record<string, { label: string; color: string }> = {
  AUTO: { label: "AUTO", color: "text-emerald-400" },
  APPROVAL: { label: "APPROVAL", color: "text-amber-400" },
  OBSERVE: { label: "OBSERVE", color: "text-blue-400" },
  PAUSED: { label: "PAUSED", color: "text-orange-400" },
  EMERGENCY_STOP: { label: "EMERGENCY STOP", color: "text-red-400" },
}

export default function AIOperatorPage() {
  const { data: status, loading: statusLoading } = useApi<AIStatus>(
    () => api.getAIStatus(),
    [],
    10000
  )
  const { data: overview, loading: overviewLoading, refetch } = useApi<OverviewData>(
    () => api.getOverview(),
    [],
    15000
  )
  const [running, setRunning] = useState(false)

  if (statusLoading || overviewLoading || !status || !overview) {
    return <LoadingState label="Loading AI operator..." />
  }

  const modeInfo = controlModeLabels[status.mode] || controlModeLabels.OBSERVE
  const chartData = overview.reward_history.map((r) => ({
    time: r.timestamp.slice(11, 16),
    reward: r.reward,
  }))
  const evidenceCount = overview.recent_decisions.length
  const lastDecision = overview.recent_decisions[0]
  const leaderExperiment = overview.experiments.find((e) => e.status === "running") || overview.experiments[0]
  const leaderVariant = leaderExperiment?.variants.find((v) => v.status === "leader") || leaderExperiment?.variants[0]

  const handleDecide = async () => {
    setRunning(true)
    try {
      await api.aiDecide()
      await refetch()
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="AI Operator"
          subtitle="Autonomous decision engine — hypothesis, evidence, and reward"
        />
        <div className="flex items-center gap-3">
          <Badge variant="outline" className={`${modeInfo.color} border-current/30 bg-current/10`}>
            <span className="mr-1 h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
            {modeInfo.label}
          </Badge>
          <Button onClick={handleDecide} disabled={running} size="sm">
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            Run Decision Cycle
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          icon={Activity}
          value={evidenceCount}
          label="Evidence Count"
          color="text-blue-400"
        />
        <StatCard
          icon={Brain}
          value={`${(status.confidence * 100).toFixed(0)}%`}
          label="Confidence"
          color="text-orange-400"
        />
        <StatCard
          icon={Layers}
          value={status.active_variants}
          label="Active Variants"
          color="text-emerald-400"
        />
        <StatCard
          icon={Trophy}
          value={status.leader_reward.toFixed(2)}
          label="Leader Reward"
          color="text-amber-400"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Hypothesis & Action */}
        <Card className="border-zinc-800 bg-zinc-900/50 lg:col-span-2">
          <CardHeader className="flex flex-row items-center gap-2">
            <Brain className="h-5 w-5 text-orange-400" />
            <CardTitle className="text-base text-white">Current Hypothesis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Current Bio</span>
                <p className="text-sm font-medium text-white">{status.current_bio}</p>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Strategy</span>
                <p className="text-sm font-medium text-white">{status.strategy}</p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Confidence</span>
                <span className="text-sm font-bold text-orange-400">
                  {(status.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <Progress value={status.confidence * 100} className="h-2 bg-zinc-800" />
            </div>

            <Separator className="bg-zinc-800" />

            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">Current Action</span>
                  <p className="text-xs text-zinc-300">
                    {lastDecision
                      ? `${lastDecision.action_type} — ${lastDecision.rationale}`
                      : "No actions yet"}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">Next Decision</span>
                  <p className="text-xs text-zinc-300">{overview.next_scheduled}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" />
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">Next Experiment</span>
                  <p className="text-xs text-zinc-300">{overview.next_experiment}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Experiment info */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center gap-2">
            <FlaskConical className="h-5 w-5 text-blue-400" />
            <CardTitle className="text-base text-white">Current Experiment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Experiment</span>
              <p className="text-sm font-medium text-white">
                {status.current_experiment || "—"}
              </p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Observations</span>
              <p className="text-sm font-medium text-white tabular-nums">
                {status.observations.toLocaleString()}
              </p>
            </div>
            <Separator className="bg-zinc-800" />
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Leader Variant</span>
              <p className="text-sm font-medium text-emerald-400">
                {leaderVariant?.label || "—"}
              </p>
              {leaderVariant && (
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  reward {leaderVariant.reward.toFixed(2)} · {leaderVariant.impressions} impressions
                </p>
              )}
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Active Variants</span>
              <p className="text-sm font-medium text-white tabular-nums">
                {status.active_variants}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Reward history chart */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-400" />
          <CardTitle className="text-base text-white">Reward History</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <XAxis dataKey="time" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <RTooltip
                    contentStyle={{
                      background: "#18181b",
                      border: "1px solid #3f3f46",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Line type="monotone" dataKey="reward" stroke="#f97316" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
              No reward history yet
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
