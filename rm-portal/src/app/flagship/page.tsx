"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DollarSign,
  Users,
  Flame,
  MessageSquare,
  Percent,
  GitBranch,
  Brain,
  Heart,
  Activity,
  TrendingUp,
  TrendingDown,
  Clock,
  HelpCircle,
  Zap,
  Trophy,
  Skull,
  Swords,
  ArrowRight,
} from "lucide-react"
import { useApi, api, type OverviewData } from "@/lib/api"
import { LoadingState, statusBadgeClass, rewardColor } from "@/components/ui-helpers"
import { useState } from "react"

const controlModeLabels: Record<string, { label: string; color: string }> = {
  AUTO: { label: "AUTO", color: "text-emerald-400" },
  APPROVAL: { label: "APPROVAL", color: "text-amber-400" },
  OBSERVE: { label: "OBSERVE", color: "text-blue-400" },
  PAUSED: { label: "PAUSED", color: "text-orange-400" },
  EMERGENCY_STOP: { label: "EMERGENCY STOP", color: "text-red-400" },
}

function StatChip({
  icon: Icon,
  label,
  value,
  color = "text-white",
}: {
  icon: React.ElementType
  label: string
  value: string | number
  color?: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <Icon className={`h-4 w-4 shrink-0 ${color}`} />
      <div className="min-w-0">
        <div className="text-[8px] uppercase tracking-wider text-zinc-500 leading-none">{label}</div>
        <div className={`text-sm font-bold tabular-nums leading-tight ${color}`}>{value}</div>
      </div>
    </div>
  )
}

const variantStatusConfig: Record<string, { icon: typeof Trophy; color: string; badge: string }> = {
  leader: { icon: Trophy, color: "text-emerald-400", badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" },
  challenger: { icon: Swords, color: "text-blue-400", badge: "border-blue-500/30 bg-blue-500/10 text-blue-400" },
  eliminated: { icon: Skull, color: "text-red-400", badge: "border-red-500/30 bg-red-500/10 text-red-400" },
  candidate: { icon: Zap, color: "text-amber-400", badge: "border-amber-500/30 bg-amber-500/10 text-amber-400" },
  testing: { icon: Zap, color: "text-blue-400", badge: "border-blue-500/30 bg-blue-500/10 text-blue-400" },
  deployed: { icon: Trophy, color: "text-emerald-400", badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" },
}

const severityColor: Record<string, string> = {
  info: "text-blue-400",
  warning: "text-amber-400",
  error: "text-red-400",
}

export default function FlagshipPage() {
  const { data, loading } = useApi<OverviewData>(() => api.getOverview(), [], 10000)
  const [whyOpen, setWhyOpen] = useState<string | null>(null)

  if (loading || !data) return <LoadingState label="Initializing flagship terminal..." />

  const modeInfo = controlModeLabels[data.mode] || controlModeLabels.OBSERVE
  const kpi = data.kpi
  const activeExperiment = data.experiments.find((e) => e.status === "running") || data.experiments[0]

  // Top 3 variants by reward
  const allVariants = data.experiments.flatMap((e) => e.variants)
  const topVariants = [...allVariants].sort((a, b) => b.reward - a.reward).slice(0, 3)

  const highIntentCount = data.high_intent_visitors.length
  const conversionRate = kpi?.conversion_rate ?? 0
  const revenueToday = kpi?.revenue ?? 0
  const visitorsToday = kpi?.visitors ?? 0
  const contacts = kpi?.contacts ?? 0

  const latestDecision = data.recent_decisions[0]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Flagship Terminal</h1>
          <p className="text-sm text-zinc-500">Trading terminal × AI operations center — live revenue intelligence</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <span className="mr-1.5 h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </Badge>
          <Badge variant="outline" className={`text-[9px] ${modeInfo.color}`}>
            {modeInfo.label}
          </Badge>
        </div>
      </div>

      {/* TOP BAR — Full width stat chips */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
        <StatChip icon={DollarSign} label="Revenue Today" value={`$${revenueToday.toLocaleString()}`} color="text-emerald-400" />
        <StatChip icon={Users} label="Visitors Today" value={visitorsToday.toLocaleString()} color="text-blue-400" />
        <StatChip icon={Flame} label="High-Intent" value={highIntentCount} color="text-orange-400" />
        <StatChip icon={MessageSquare} label="Contacts" value={contacts.toLocaleString()} color="text-purple-400" />
        <StatChip icon={Percent} label="Conv. Rate" value={`${conversionRate.toFixed(1)}%`} color="text-cyan-400" />
        <StatChip
          icon={GitBranch}
          label="Experiment"
          value={activeExperiment?.name?.slice(0, 12) ?? "—"}
          color="text-blue-400"
        />
        <StatChip
          icon={Brain}
          label="AI Confidence"
          value={`${(data.confidence * 100).toFixed(0)}%`}
          color="text-orange-400"
        />
        <StatChip
          icon={Heart}
          label="System Health"
          value={data.mode === "EMERGENCY_STOP" ? "CRITICAL" : "OK"}
          color={data.mode === "EMERGENCY_STOP" ? "text-red-400" : "text-emerald-400"}
        />
      </div>

      {/* MIDDLE SECTION — 3 columns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* CENTER-LEFT: LIVE BUSINESS — Funnel */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center gap-2 pb-3">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <CardTitle className="text-xs font-bold text-white uppercase tracking-wider">Live Business</CardTitle>
            <Badge variant="outline" className="ml-auto border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[8px]">
              REAL-TIME
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {data.funnel.map((stage, i) => {
              const unavailable = stage.observation !== "available"
              const prevStage = i > 0 ? data.funnel[i - 1] : null
              const dropoff = prevStage?.count && stage.count ? prevStage.count - stage.count : 0
              return (
                <div key={stage.stage}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">{stage.stage}</span>
                    {unavailable ? (
                      <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[8px]">
                        NO DATA
                      </Badge>
                    ) : (
                      <div className="flex items-baseline gap-2">
                        <span className="text-base font-bold text-white tabular-nums">{stage.count?.toLocaleString()}</span>
                        {stage.conversion_rate !== null && (
                          <span className="text-[9px] text-zinc-500">{stage.conversion_rate}%</span>
                        )}
                      </div>
                    )}
                  </div>
                  {!unavailable && stage.conversion_rate !== null && (
                    <Progress value={stage.conversion_rate} className="mt-1 h-1 bg-zinc-800" />
                  )}
                  {i > 0 && dropoff > 0 && !unavailable && (
                    <div className="mt-0.5 flex items-center gap-1 text-[9px] text-red-400/70">
                      <TrendingDown className="h-2.5 w-2.5" />
                      -{dropoff} dropoff
                    </div>
                  )}
                  {i < data.funnel.length - 1 && (
                    <div className="my-1.5 flex justify-center">
                      <ArrowRight className="h-3 w-3 rotate-90 text-zinc-700" />
                    </div>
                  )}
                </div>
              )
            })}
            <Separator className="bg-zinc-800 my-2" />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[8px] uppercase tracking-wider text-zinc-500">High-Intent Visitors</span>
                <p className="text-sm font-bold text-orange-400 tabular-nums">{highIntentCount}</p>
              </div>
              <div>
                <span className="text-[8px] uppercase tracking-wider text-zinc-500">Repeat Visitors</span>
                <p className="text-sm font-bold text-blue-400 tabular-nums">{kpi?.repeat_visitors ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CENTER: AI OPERATOR */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center gap-2 pb-3">
            <Brain className="h-4 w-4 text-orange-400" />
            <CardTitle className="text-xs font-bold text-white uppercase tracking-wider">AI Operator</CardTitle>
            <button
              onClick={() => setWhyOpen(whyOpen === "operator" ? null : "operator")}
              className="ml-auto flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-[8px] text-zinc-400 hover:text-white"
            >
              <HelpCircle className="h-2.5 w-2.5" />
              WHY?
            </button>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div>
              <span className="text-[8px] uppercase tracking-wider text-zinc-500">Current Hypothesis</span>
              <p className="mt-0.5 text-xs text-white leading-snug">{data.next_experiment}</p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 text-center">
                <div className="text-[8px] uppercase tracking-wider text-zinc-500">Evidence</div>
                <div className="text-lg font-bold text-blue-400 tabular-nums">
                  {activeExperiment?.observations ?? 0}
                </div>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 text-center">
                <div className="text-[8px] uppercase tracking-wider text-zinc-500">Confidence</div>
                <div className="text-lg font-bold text-orange-400 tabular-nums">
                  {(data.confidence * 100).toFixed(0)}%
                </div>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 text-center">
                <div className="text-[8px] uppercase tracking-wider text-zinc-500">Strategy</div>
                <div className="text-[10px] font-bold text-white leading-tight pt-1">
                  {data.current_strategy.split(" ").slice(0, 3).join(" ")}
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[8px] uppercase tracking-wider text-zinc-500">Confidence Level</span>
                <span className="text-xs font-bold text-orange-400">{(data.confidence * 100).toFixed(0)}%</span>
              </div>
              <Progress value={data.confidence * 100} className="h-1.5 bg-zinc-800" />
            </div>

            {latestDecision && (
              <div className="rounded border border-zinc-800/50 bg-zinc-900/30 p-2">
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3 w-3 text-amber-400" />
                  <span className="text-[8px] uppercase tracking-wider text-zinc-500">Last Action</span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-300 leading-snug">{latestDecision.rationale}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="outline" className={`text-[8px] ${statusBadgeClass(latestDecision.status)}`}>
                    {latestDecision.status.toUpperCase()}
                  </Badge>
                  <span className="text-[9px] text-zinc-500">{latestDecision.action_type}</span>
                </div>
              </div>
            )}

            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              <Clock className="h-3 w-3" />
              Next decision: <span className="text-zinc-400">{data.next_scheduled}</span>
            </div>

            {whyOpen === "operator" && (
              <div className="rounded border border-orange-500/20 bg-orange-500/5 p-2 text-[10px] text-zinc-400 leading-relaxed">
                <span className="font-bold text-orange-400">WHY?</span> The AI selected this hypothesis based on{" "}
                {activeExperiment?.observations ?? 0} observations with a reward signal of{" "}
                {topVariants[0]?.reward.toFixed(2) ?? "N/A"}. The confidence score reflects the statistical certainty
                that the current leader outperforms challengers.
              </div>
            )}
          </CardContent>
        </Card>

        {/* CENTER-RIGHT: EXPERIMENT ARENA */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center gap-2 pb-3">
            <Swords className="h-4 w-4 text-blue-400" />
            <CardTitle className="text-xs font-bold text-white uppercase tracking-wider">Experiment Arena</CardTitle>
            <Badge variant="outline" className="ml-auto border-blue-500/30 bg-blue-500/10 text-blue-400 text-[8px]">
              {topVariants.length} VARIANTS
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {topVariants.map((variant, idx) => {
              const cfg = variantStatusConfig[variant.status] || variantStatusConfig.candidate
              const VIcon = cfg.icon
              return (
                <div
                  key={variant.id}
                  className={`rounded-lg border p-2.5 ${
                    idx === 0 ? "border-emerald-500/20 bg-emerald-500/5" : "border-zinc-800 bg-zinc-900/30"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded bg-zinc-800 text-[9px] font-bold text-zinc-400">
                        {idx + 1}
                      </span>
                      <span className="text-xs font-medium text-white truncate max-w-[100px]">{variant.label}</span>
                    </div>
                    <Badge variant="outline" className={`text-[8px] ${cfg.badge}`}>
                      <VIcon className="mr-1 h-2.5 w-2.5" />
                      {variant.status.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    <div>
                      <span className="text-[8px] uppercase tracking-wider text-zinc-500">Reward</span>
                      <p className={`text-sm font-bold tabular-nums ${rewardColor(variant.reward)}`}>
                        {variant.reward.toFixed(3)}
                      </p>
                    </div>
                    <div>
                      <span className="text-[8px] uppercase tracking-wider text-zinc-500">Impr.</span>
                      <p className="text-sm font-bold text-white tabular-nums">{variant.impressions}</p>
                    </div>
                    <div>
                      <span className="text-[8px] uppercase tracking-wider text-zinc-500">Conv.</span>
                      <p className="text-sm font-bold text-white tabular-nums">{variant.conversions}</p>
                    </div>
                  </div>
                  <div className="mt-1.5">
                    <Progress
                      value={Math.min(Math.abs(variant.reward) * 100, 100)}
                      className="h-0.5 bg-zinc-800"
                    />
                  </div>
                </div>
              )
            })}
            {topVariants.length === 0 && (
              <p className="text-xs text-zinc-500 py-4 text-center">No variants available</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* BOTTOM — LIVE TELEMETRY (full width) */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2 pb-3">
          <Activity className="h-4 w-4 text-blue-400" />
          <CardTitle className="text-xs font-bold text-white uppercase tracking-wider">Live Telemetry</CardTitle>
          <Badge variant="outline" className="ml-auto border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[8px]">
            <span className="mr-1 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            STREAMING
          </Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <ScrollArea className="h-[200px] rounded-lg border border-zinc-800/50">
            <div className="space-y-0.5 p-1">
              {data.live_events.map((event) => {
                const sevColor = severityColor[event.severity] || severityColor.info
                return (
                  <div
                    key={event.id}
                    className="flex items-center gap-3 rounded border border-zinc-800/30 bg-zinc-900/20 px-2.5 py-1.5"
                  >
                    <span className="text-[9px] text-zinc-600 tabular-nums shrink-0">
                      {new Date(event.timestamp).toLocaleTimeString("en-US", { hour12: false })}
                    </span>
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${sevColor.replace("text-", "bg-")}`} />
                    <span className="text-[9px] font-mono text-zinc-500 shrink-0">{event.event_type}</span>
                    <span className="text-[11px] text-zinc-300 truncate">{event.message}</span>
                  </div>
                )
              })}
              {data.live_events.length === 0 && (
                <p className="text-xs text-zinc-500 py-4 text-center">No live events</p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
