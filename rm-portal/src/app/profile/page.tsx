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
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <CircleDot className="h-5 w-5 text-emerald-400" />
          <CardTitle className="text-base text-foreground">Profile Status</CardTitle>
          <Badge
            variant="outline"
            className={`ml-auto text-[9px] ${
              isOnline
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-border/80 bg-accent/30 text-muted-foreground"
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
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Availability</span>
              <p className={`text-sm font-bold ${isOnline ? "text-emerald-400" : "text-muted-foreground"}`}>
                {availability.toUpperCase()}
              </p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Visibility</span>
              <p className="text-sm font-bold text-foreground">{visibility.toUpperCase()}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Pricing State</span>
              <p className="text-sm font-bold text-foreground">{pricingState.toUpperCase()}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Mode</span>
              <p className="text-sm font-bold text-orange-400">{data.mode}</p>
            </div>
          </div>
          <Separator className="my-4 bg-accent" />
          <div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Current Bio</span>
            <p className="mt-1 text-sm font-medium text-foreground">{data.current_bio}</p>
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
        <Card className="border-border bg-card/50">
          <CardHeader className="flex flex-row items-center gap-2">
            <GitBranch className="h-5 w-5 text-blue-400" />
            <CardTitle className="text-base text-foreground">Current Experiment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeExperiment ? (
              <>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Experiment Name</span>
                  <p className="text-sm font-medium text-foreground">{activeExperiment.name}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</span>
                    <p className="text-sm font-bold text-foreground">{activeExperiment.status}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Observations</span>
                    <p className="text-sm font-bold text-foreground tabular-nums">{activeExperiment.observations}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Reward Metric</span>
                    <p className="text-sm font-medium text-foreground">{activeExperiment.reward_metric}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</span>
                    <p className="text-sm font-bold text-orange-400">
                      {(activeExperiment.confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Experiment Confidence</span>
                    <span className="text-xs font-bold text-orange-400">
                      {(activeExperiment.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <Progress value={activeExperiment.confidence * 100} className="h-2 bg-accent" />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No active experiment</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card/50">
          <CardHeader className="flex flex-row items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-400" />
            <CardTitle className="text-base text-foreground">Leader Variant</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {leaderVariant ? (
              <>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Variant Label</span>
                  <p className="text-sm font-medium text-foreground">{leaderVariant.label}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Reward</span>
                    <p className="text-sm font-bold text-emerald-400 tabular-nums">
                      {leaderVariant.reward.toFixed(3)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</span>
                    <Badge variant="outline" className={`text-[9px] ${statusBadgeClass(leaderVariant.status)}`}>
                      {leaderVariant.status.toUpperCase()}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Impressions</span>
                    <p className="text-sm font-bold text-foreground tabular-nums">{leaderVariant.impressions}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Clicks</span>
                    <p className="text-sm font-bold text-foreground tabular-nums">{leaderVariant.clicks}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Contacts</span>
                    <p className="text-sm font-bold text-foreground tabular-nums">{leaderVariant.contacts}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Conversions</span>
                    <p className="text-sm font-bold text-foreground tabular-nums">{leaderVariant.conversions}</p>
                  </div>
                </div>
                <Separator className="bg-accent" />
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Bio Content</span>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{leaderVariant.content}</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No leader variant found</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Additional KPI Metrics */}
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Activity className="h-5 w-5 text-purple-400" />
          <CardTitle className="text-base text-foreground">Profile Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Repeat Visitors</span>
              <p className="text-sm font-bold text-foreground tabular-nums">{kpi?.repeat_visitors?.toLocaleString() ?? "—"}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Contacts</span>
              <p className="text-sm font-bold text-foreground tabular-nums">{kpi?.contacts?.toLocaleString() ?? "—"}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">CTR</span>
              <p className="text-sm font-bold text-foreground tabular-nums">
                {kpi?.ctr != null ? `${kpi.ctr.toFixed(2)}%` : "—"}
              </p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Conversion Rate</span>
              <p className="text-sm font-bold text-foreground tabular-nums">
                {kpi?.conversion_rate != null ? `${kpi.conversion_rate.toFixed(2)}%` : "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
