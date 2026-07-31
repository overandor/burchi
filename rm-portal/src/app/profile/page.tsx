"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import {
  Eye,
  MousePointerClick,
  Users,
  TrendingUp,
  GitBranch,
  CircleDot,
  Wifi,
  WifiOff,
  DollarSign,
  Activity,
} from "lucide-react"
import { useApi, api, type OverviewData } from "@/lib/api"
import { LoadingState, PageHeader, StatCard, statusBadgeClass } from "@/components/ui-helpers"

export default function ProfileStatePage() {
  const { data, loading } = useApi<OverviewData>(() => api.getOverview(), [], 15000)
  const { data: controlState } = useApi<Record<string, string>>(() => api.getControlState(), [])

  if (loading || !data) return <LoadingState label="Loading profile state..." />

  const kpi = data.kpi
  const availability = controlState?.availability || "available"
  const visibility = controlState?.visibility || "public"
  const pricingState = controlState?.pricing_state || "active"
  const isOnline = availability === "available"

  // Find leader variant from experiments
  const activeExperiment = data.experiments.find((e) => e.status === "running") || data.experiments[0]
  const leaderVariant = activeExperiment?.variants.find((v) => v.status === "leader") || activeExperiment?.variants[0]

  return (
    <div className="space-y-6">
      <PageHeader title="Profile State" subtitle="Current profile configuration and live metrics" />

      {/* Profile Status */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <CircleDot className="h-5 w-5 text-emerald-400" />
          <CardTitle className="text-base text-white">Profile Status</CardTitle>
          <Badge
            variant="outline"
            className={`ml-auto text-[9px] ${
              isOnline
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-zinc-700 bg-zinc-800/50 text-zinc-500"
            }`}
          >
            {isOnline ? (
              <>
                <Wifi className="mr-1 h-2.5 w-2.5" />
                ONLINE
              </>
            ) : (
              <>
                <WifiOff className="mr-1 h-2.5 w-2.5" />
                OFFLINE
              </>
            )}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Availability</span>
              <p className={`text-sm font-bold ${isOnline ? "text-emerald-400" : "text-zinc-500"}`}>
                {availability.toUpperCase()}
              </p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Visibility</span>
              <p className="text-sm font-bold text-white">{visibility.toUpperCase()}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Pricing State</span>
              <p className="text-sm font-bold text-white">{pricingState.toUpperCase()}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Mode</span>
              <p className="text-sm font-bold text-orange-400">{data.mode}</p>
            </div>
          </div>
          <Separator className="my-4 bg-zinc-800" />
          <div>
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Current Bio</span>
            <p className="mt-1 text-sm font-medium text-white">{data.current_bio}</p>
          </div>
        </CardContent>
      </Card>

      {/* Profile Metrics */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard icon={Eye} value={kpi?.impressions?.toLocaleString() ?? "—"} label="Impressions" color="text-blue-400" />
        <StatCard icon={Users} value={kpi?.visitors?.toLocaleString() ?? "—"} label="Visitors" color="text-emerald-400" />
        <StatCard
          icon={MousePointerClick}
          value={kpi?.clicks?.toLocaleString() ?? "—"}
          label="Clicks"
          color="text-orange-400"
        />
      </div>

      {/* Current Experiment & Leader Variant */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center gap-2">
            <GitBranch className="h-5 w-5 text-blue-400" />
            <CardTitle className="text-base text-white">Current Experiment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeExperiment ? (
              <>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">Experiment Name</span>
                  <p className="text-sm font-medium text-white">{activeExperiment.name}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">Status</span>
                    <p className="text-sm font-bold text-white">{activeExperiment.status}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">Observations</span>
                    <p className="text-sm font-bold text-white tabular-nums">{activeExperiment.observations}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">Reward Metric</span>
                    <p className="text-sm font-medium text-white">{activeExperiment.reward_metric}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">Confidence</span>
                    <p className="text-sm font-bold text-orange-400">
                      {(activeExperiment.confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">Experiment Confidence</span>
                    <span className="text-xs font-bold text-orange-400">
                      {(activeExperiment.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <Progress value={activeExperiment.confidence * 100} className="h-2 bg-zinc-800" />
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">No active experiment</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-400" />
            <CardTitle className="text-base text-white">Leader Variant</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {leaderVariant ? (
              <>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">Variant Label</span>
                  <p className="text-sm font-medium text-white">{leaderVariant.label}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">Reward</span>
                    <p className="text-sm font-bold text-emerald-400 tabular-nums">
                      {leaderVariant.reward.toFixed(3)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">Status</span>
                    <Badge variant="outline" className={`text-[9px] ${statusBadgeClass(leaderVariant.status)}`}>
                      {leaderVariant.status.toUpperCase()}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">Impressions</span>
                    <p className="text-sm font-bold text-white tabular-nums">{leaderVariant.impressions}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">Clicks</span>
                    <p className="text-sm font-bold text-white tabular-nums">{leaderVariant.clicks}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">Contacts</span>
                    <p className="text-sm font-bold text-white tabular-nums">{leaderVariant.contacts}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">Conversions</span>
                    <p className="text-sm font-bold text-white tabular-nums">{leaderVariant.conversions}</p>
                  </div>
                </div>
                <Separator className="bg-zinc-800" />
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">Bio Content</span>
                  <p className="mt-1 text-xs text-zinc-400 leading-relaxed">{leaderVariant.content}</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">No leader variant found</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Additional KPI Metrics */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Activity className="h-5 w-5 text-purple-400" />
          <CardTitle className="text-base text-white">Profile Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Repeat Visitors</span>
              <p className="text-sm font-bold text-white tabular-nums">{kpi?.repeat_visitors?.toLocaleString() ?? "—"}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Contacts</span>
              <p className="text-sm font-bold text-white tabular-nums">{kpi?.contacts?.toLocaleString() ?? "—"}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">CTR</span>
              <p className="text-sm font-bold text-white tabular-nums">
                {kpi?.ctr != null ? `${kpi.ctr.toFixed(2)}%` : "—"}
              </p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Conversion Rate</span>
              <p className="text-sm font-bold text-white tabular-nums">
                {kpi?.conversion_rate != null ? `${kpi.conversion_rate.toFixed(2)}%` : "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
