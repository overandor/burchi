"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { AlertCircle, Filter, TrendingDown } from "lucide-react"
import { useApi, api, type OverviewData, type FunnelStage } from "@/lib/api"
import { LoadingState, PageHeader } from "@/components/ui-helpers"

const stageColors: Record<string, string> = {
  "Profile Impressions": "text-blue-400",
  Visitors: "text-cyan-400",
  "Repeat Visitors": "text-sky-400",
  Clicks: "text-purple-400",
  Contacts: "text-amber-400",
  Bookings: "text-pink-400",
  Revenue: "text-emerald-400",
}

const stageBarColors: Record<string, string> = {
  "Profile Impressions": "bg-blue-400",
  Visitors: "bg-cyan-400",
  "Repeat Visitors": "bg-sky-400",
  Clicks: "bg-purple-400",
  Contacts: "bg-amber-400",
  Bookings: "bg-pink-400",
  Revenue: "bg-emerald-400",
}

export default function FunnelPage() {
  const { data, loading } = useApi<OverviewData>(() => api.getOverview(), [], 15000)

  if (loading || !data) return <LoadingState label="Loading revenue funnel..." />

  const stages: FunnelStage[] = data.funnel ?? []
  const available = stages.filter((s) => s.observation === "available")
  const maxCount = available.reduce(
    (m, s) => (s.count !== null && s.count > m ? s.count! : m),
    0
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Revenue Funnel"
        subtitle="Profile impressions → visitors → repeat visitors → clicks → contacts → bookings → revenue"
      />

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
          <Filter className="h-8 w-8 text-blue-400" />
          <div>
            <div className="text-2xl font-bold text-foreground">{stages.length}</div>
            <div className="text-[10px] text-muted-foreground">Funnel Stages</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
          <TrendingDown className="h-8 w-8 text-emerald-400" />
          <div>
            <div className="text-2xl font-bold text-foreground">{available.length}</div>
            <div className="text-[10px] text-muted-foreground">Available Stages</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
          <AlertCircle className="h-8 w-8 text-amber-400" />
          <div>
            <div className="text-2xl font-bold text-foreground">
              {stages.length - available.length}
            </div>
            <div className="text-[10px] text-muted-foreground">No-Data Stages</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
          <TrendingDown className="h-8 w-8 text-purple-400" />
          <div>
            <div className="text-2xl font-bold text-foreground">
              {available[0]?.count?.toLocaleString() ?? "—"}
            </div>
            <div className="text-[10px] text-muted-foreground">Top of Funnel</div>
          </div>
        </div>
      </div>

      {/* Visual funnel */}
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Filter className="h-5 w-5 text-blue-400" />
          <CardTitle className="text-base text-foreground">Conversion Funnel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {stages.map((stage, i) => {
            const unavailable = stage.observation !== "available"
            const color = stageColors[stage.stage] ?? "text-foreground/80"
            const barColor = stageBarColors[stage.stage] ?? "bg-primary"
            const widthPct =
              !unavailable && maxCount > 0 && stage.count !== null
                ? Math.max(4, (stage.count / maxCount) * 100)
                : 0

            return (
              <div key={stage.stage}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${color}`}>{stage.stage}</span>
                    {unavailable && (
                      <Badge
                        variant="outline"
                        className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[9px]"
                      >
                        <AlertCircle className="mr-1 h-2.5 w-2.5" />
                        NO DATA
                      </Badge>
                    )}
                  </div>
                  {unavailable ? (
                    <span className="text-xs text-muted-foreground/60">—</span>
                  ) : (
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-bold text-foreground tabular-nums">
                        {stage.count?.toLocaleString()}
                      </span>
                      {stage.conversion_rate !== null && (
                        <span className="text-[10px] text-muted-foreground">
                          {stage.conversion_rate}% conv
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Funnel bar */}
                {!unavailable && (
                  <div className="mt-2">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-accent">
                      <div
                        className={`h-full ${barColor} transition-all`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    {stage.conversion_rate !== null && (
                      <Progress value={stage.conversion_rate} className="mt-1.5 h-1 bg-accent" />
                    )}
                  </div>
                )}

                {i < stages.length - 1 && <Separator className="mt-4 bg-accent/30" />}
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Stage detail table */}
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <TrendingDown className="h-5 w-5 text-emerald-400" />
          <CardTitle className="text-base text-foreground">Stage Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {stages.map((stage) => {
            const unavailable = stage.observation !== "available"
            return (
              <div
                key={stage.stage}
                className="flex items-center justify-between rounded-lg border border-border/60 bg-card/30 px-3 py-2"
              >
                <span className="text-xs text-foreground/80">{stage.stage}</span>
                <div className="flex items-center gap-3">
                  {unavailable ? (
                    <Badge
                      variant="outline"
                      className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[9px]"
                    >
                      <AlertCircle className="mr-1 h-2.5 w-2.5" />
                      NO DATA
                    </Badge>
                  ) : (
                    <>
                      <span className="text-sm font-bold text-foreground tabular-nums">
                        {stage.count?.toLocaleString()}
                      </span>
                      <span className="text-[10px] text-muted-foreground tabular-nums w-16 text-right">
                        {stage.conversion_rate !== null
                          ? `${stage.conversion_rate}%`
                          : "—"}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
