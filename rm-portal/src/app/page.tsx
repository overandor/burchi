"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { AlertCircle, Brain, Clock, Cpu, GitBranch, TrendingUp, Zap, Activity, Sparkles, Play, ArrowRight, RefreshCw, FlaskConical, Users, DollarSign } from "lucide-react"
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid } from "recharts"
import { useApi, api, type OverviewData } from "@/lib/api"
import { LoadingState } from "@/components/ui-helpers"
import { useState } from "react"
import Link from "next/link"

const controlModeLabels: Record<string, { label: string; color: string }> = {
  AUTO: { label: "AUTO", color: "text-emerald-400" },
  APPROVAL: { label: "APPROVAL", color: "text-amber-400" },
  OBSERVE: { label: "OBSERVE", color: "text-blue-400" },
  PAUSED: { label: "PAUSED", color: "text-orange-400" },
  EMERGENCY_STOP: { label: "EMERGENCY STOP", color: "text-red-400" },
}

export default function MissionControlPage() {
  const { data, loading, refetch } = useApi<OverviewData>(() => api.getOverview(), [], 15000)
  const [runningDecision, setRunningDecision] = useState(false)
  const [generatingBio, setGeneratingBio] = useState(false)
  const [decisionResult, setDecisionResult] = useState<string | null>(null)
  const [bioResult, setBioResult] = useState<string | null>(null)

  const runDecision = async () => {
    setRunningDecision(true)
    setDecisionResult(null)
    try {
      const result = await api.aiDecide() as { action: string; variant: string; confidence: number } | null
      if (result) {
        setDecisionResult(`${result.action} — ${result.variant} (conf: ${(result.confidence * 100).toFixed(0)}%)`)
        refetch()
      } else {
        setDecisionResult("Failed to run decision")
      }
    } catch {
      setDecisionResult("Error running decision")
    }
    setRunningDecision(false)
  }

  const generateBio = async () => {
    setGeneratingBio(true)
    setBioResult(null)
    try {
      const result = await api.aiGenerate("bio", "", 3) as { generated: number } | null
      if (result) {
        setBioResult(`Generated ${result.generated} new bio candidates`)
        refetch()
      } else {
        setBioResult("Failed to generate bios")
      }
    } catch {
      setBioResult("Error generating bios")
    }
    setGeneratingBio(false)
  }

  if (loading || !data) return <LoadingState label="Loading mission control..." />

  const modeInfo = controlModeLabels[data.mode] || controlModeLabels.OBSERVE
  const chartData = data.reward_history.map((r) => ({
    time: r.timestamp.slice(11, 16),
    reward: r.reward,
  }))
  const leaderVariant = data.experiments.flatMap(e => e.variants || []).find(v => v.status === "leader" || v.status === "deployed")
  const pendingDecisions = data.recent_decisions.filter(d => d.status === "pending").length

  return (
    <div className="space-y-6">
      {/* Header with action buttons */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Mission Control</h1>
          <p className="text-sm text-zinc-500">Autonomous revenue operations — live status</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <span className="mr-1 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {modeInfo.label}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={refetch}
            className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Quick Action Bar */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Button
          onClick={runDecision}
          disabled={runningDecision}
          className="bg-orange-500/20 border border-orange-500/30 text-orange-400 hover:bg-orange-500/30"
        >
          {runningDecision ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          Run AI Decision
        </Button>
        <Button
          onClick={generateBio}
          disabled={generatingBio}
          className="bg-purple-500/20 border border-purple-500/30 text-purple-400 hover:bg-purple-500/30"
        >
          {generatingBio ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Generate Bios
        </Button>
        <Link href="/flagship">
          <Button variant="outline" className="w-full border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800">
            <Activity className="mr-2 h-4 w-4" />
            Flagship Terminal
          </Button>
        </Link>
        <Link href="/control">
          <Button variant="outline" className="w-full border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800">
            <Cpu className="mr-2 h-4 w-4" />
            Control Center
          </Button>
        </Link>
      </div>

      {/* Action Results */}
      {(decisionResult || bioResult) && (
        <div className="flex flex-col gap-2">
          {decisionResult && (
            <div className="flex items-center justify-between rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-2.5">
              <span className="text-sm text-orange-400">
                <Brain className="mr-2 inline h-4 w-4" />
                AI Decision: {decisionResult}
              </span>
              <button onClick={() => setDecisionResult(null)} className="text-zinc-500 hover:text-zinc-300">
                <AlertCircle className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {bioResult && (
            <div className="flex items-center justify-between rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-2.5">
              <span className="text-sm text-purple-400">
                <Sparkles className="mr-2 inline h-4 w-4" />
                {bioResult}
              </span>
              <button onClick={() => setBioResult(null)} className="text-zinc-500 hover:text-zinc-300">
                <AlertCircle className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Key Metrics Row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Link href="/kpis">
          <Card className="border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-3 pt-5">
              <DollarSign className="h-8 w-8 text-emerald-400" />
              <div>
                <div className="text-2xl font-bold text-white">${data.kpi?.revenue?.toLocaleString() || "0"}</div>
                <div className="text-[10px] text-zinc-500">Revenue</div>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/visitors">
          <Card className="border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-3 pt-5">
              <Users className="h-8 w-8 text-blue-400" />
              <div>
                <div className="text-2xl font-bold text-white">{data.kpi?.visitors || 0}</div>
                <div className="text-[10px] text-zinc-500">Visitors</div>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/experiments">
          <Card className="border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-3 pt-5">
              <FlaskConical className="h-8 w-8 text-purple-400" />
              <div>
                <div className="text-2xl font-bold text-white">{data.experiments.length}</div>
                <div className="text-[10px] text-zinc-500">Experiments</div>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/approvals">
          <Card className="border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-3 pt-5">
              <Brain className="h-8 w-8 text-orange-400" />
              <div>
                <div className="text-2xl font-bold text-white">{pendingDecisions}</div>
                <div className="text-[10px] text-zinc-500">Pending Approvals</div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* AI Operator Panel */}
        <Card className="border-zinc-800 bg-zinc-900/50 lg:col-span-2">
          <CardHeader className="flex flex-row items-center gap-2">
            <Brain className="h-5 w-5 text-orange-400" />
            <CardTitle className="text-base text-white">AI Operator</CardTitle>
            <Link href="/ai-operator" className="ml-auto">
              <span className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1">
                Details <ArrowRight className="h-3 w-3" />
              </span>
            </Link>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Current Bio</span>
                <p className="text-sm font-medium text-white">{data.current_bio}</p>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Strategy</span>
                <p className="text-sm font-medium text-white">{data.current_strategy}</p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Confidence</span>
                <span className="text-sm font-bold text-orange-400">{(data.confidence * 100).toFixed(0)}%</span>
              </div>
              <Progress value={data.confidence * 100} className="h-2 bg-zinc-800" />
            </div>

            {chartData.length > 0 && (
              <div>
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Reward History</span>
                <div className="mt-2 h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <XAxis dataKey="time" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                      <RTooltip
                        contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px", fontSize: "12px" }}
                      />
                      <Line type="monotone" dataKey="reward" stroke="#f97316" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <Separator className="bg-zinc-800" />

            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" />
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">Next Experiment</span>
                  <p className="text-xs text-zinc-300">{data.next_experiment}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">Next Scheduled</span>
                  <p className="text-xs text-zinc-300">{data.next_scheduled}</p>
                </div>
              </div>
            </div>

            {leaderVariant && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-wider text-emerald-400">Leader Variant</span>
                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[9px]">
                    {leaderVariant.status.toUpperCase()}
                  </Badge>
                </div>
                <p className="text-xs text-zinc-300 italic">&ldquo;{leaderVariant.content}&rdquo;</p>
                <div className="mt-2 flex gap-4 text-[10px] text-zinc-500">
                  <span>Impr: {leaderVariant.impressions}</span>
                  <span>Clicks: {leaderVariant.clicks}</span>
                  <span>Conv: {leaderVariant.conversions}</span>
                  <span className="text-emerald-400">Reward: {leaderVariant.reward.toFixed(2)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Live Funnel */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-400" />
            <CardTitle className="text-base text-white">Live Funnel</CardTitle>
            <Link href="/funnel" className="ml-auto">
              <span className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1">
                Details <ArrowRight className="h-3 w-3" />
              </span>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.funnel.map((stage, i) => {
              const unavailable = stage.observation !== "available"
              return (
                <div key={stage.stage}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">{stage.stage}</span>
                    {unavailable ? (
                      <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[9px]">
                        <AlertCircle className="mr-1 h-2.5 w-2.5" />
                        NO DATA
                      </Badge>
                    ) : (
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-bold text-white tabular-nums">{stage.count?.toLocaleString()}</span>
                        {stage.conversion_rate !== null && (
                          <span className="text-[10px] text-zinc-500">{stage.conversion_rate}%</span>
                        )}
                      </div>
                    )}
                  </div>
                  {!unavailable && stage.conversion_rate !== null && (
                    <Progress value={stage.conversion_rate} className="mt-1 h-1 bg-zinc-800" />
                  )}
                  {i < data.funnel.length - 1 && <Separator className="mt-3 bg-zinc-800/50" />}
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      {/* Live Events */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Activity className="h-5 w-5 text-blue-400" />
          <CardTitle className="text-base text-white">Live Telemetry</CardTitle>
          <Badge variant="outline" className="ml-auto border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[9px]">
            <span className="mr-1 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {data.live_events.map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-3 py-2 hover:bg-zinc-900/60 transition-colors">
                <span className="text-[10px] text-zinc-600 tabular-nums shrink-0">
                  {new Date(e.timestamp).toLocaleTimeString("en-US", { hour12: false })}
                </span>
                <span className="text-xs text-zinc-300">{e.message}</span>
                {e.severity === "warning" && <AlertCircle className="h-3 w-3 text-amber-400 shrink-0" />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Capabilities */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Cpu className="h-5 w-5 text-purple-400" />
          <CardTitle className="text-base text-white">Active Capabilities</CardTitle>
          <Link href="/control" className="ml-auto">
            <span className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1">
              Manage <ArrowRight className="h-3 w-3" />
            </span>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.capabilities).map(([key, enabled]) => (
              <Badge
                key={key}
                variant="outline"
                className={enabled ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-zinc-700 bg-zinc-800/50 text-zinc-500"}
              >
                <Zap className="mr-1 h-3 w-3" />
                {key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
