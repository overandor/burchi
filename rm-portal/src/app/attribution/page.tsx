"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Award,
  Eye,
  MousePointerClick,
  MessageSquare,
  Target,
  TrendingUp,
  FlaskConical,
  Crown,
  Activity,
} from "lucide-react"
import { useApi, api, type OverviewData, type Experiment, type Variant } from "@/lib/api"
import { LoadingState, PageHeader, StatCard, rewardColor, statusBadgeClass } from "@/components/ui-helpers"

export default function AttributionPage() {
  const { data, loading } = useApi<OverviewData>(() => api.getOverview(), [], 15000)
  const { data: experiments, loading: expLoading } = useApi<Experiment[]>(
    () => api.getExperiments(),
    []
  )

  if (loading || expLoading || !data) {
    return <LoadingState label="Loading attribution dashboard..." />
  }

  const kpi = data.kpi
  const exps = experiments ?? []
  const allVariants: Variant[] = exps.flatMap((e) => e.variants ?? [])
  const sortedVariants = allVariants.slice().sort((a, b) => b.reward - a.reward)
  const maxImpressions = allVariants.reduce(
    (m, v) => (v.impressions > m ? v.impressions : m),
    0
  )

  const fmt = (n: number | null | undefined) =>
    n === null || n === undefined ? "—" : n.toLocaleString()
  const fmtPct = (n: number | null | undefined) =>
    n === null || n === undefined ? "—" : `${n.toFixed(2)}%`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attribution Dashboard"
        subtitle="Which content, bio, and experiment variants produced traffic and revenue"
      />

      {/* Real-time KPI board */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Activity className="h-5 w-5 text-emerald-400" />
          <CardTitle className="text-base text-white">Real-Time KPI Board</CardTitle>
          <Badge
            variant="outline"
            className="ml-auto border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[9px]"
          >
            <span className="mr-1 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              icon={Eye}
              value={fmt(kpi?.impressions)}
              label="Impressions"
              color="text-blue-400"
            />
            <StatCard
              icon={MousePointerClick}
              value={fmt(kpi?.clicks)}
              label="Clicks"
              color="text-purple-400"
            />
            <StatCard
              icon={MessageSquare}
              value={fmt(kpi?.contacts)}
              label="Contacts"
              color="text-amber-400"
            />
            <StatCard
              icon={Target}
              value={fmt(kpi?.bookings)}
              label="Bookings"
              color="text-pink-400"
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">CTR</span>
              <p className="text-lg font-bold text-white">{fmtPct(kpi?.ctr)}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Conv. Rate</span>
              <p className="text-lg font-bold text-white">{fmtPct(kpi?.conversion_rate)}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Revenue</span>
              <p className="text-lg font-bold text-emerald-400">
                {kpi?.revenue !== undefined ? `$${kpi.revenue.toLocaleString()}` : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Visitors</span>
              <p className="text-lg font-bold text-white">{fmt(kpi?.visitors)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Impact — experiment variants by reward */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <FlaskConical className="h-5 w-5 text-blue-400" />
          <CardTitle className="text-base text-white">AI Impact — Variants by Reward</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedVariants.length > 0 ? (
            sortedVariants.map((v, i) => {
              const isLeader = i === 0
              return (
                <div
                  key={v.id}
                  className={`rounded-lg border bg-zinc-900/30 px-3 py-3 ${
                    isLeader ? "border-emerald-500/30 ring-1 ring-emerald-500/20" : "border-zinc-800/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isLeader ? (
                        <Crown className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <Award className="h-4 w-4 text-zinc-500" />
                      )}
                      <span className="text-sm font-medium text-white">{v.label}</span>
                      <Badge
                        variant="outline"
                        className={`text-[9px] ${statusBadgeClass(v.status)}`}
                      >
                        {v.status.toUpperCase()}
                      </Badge>
                    </div>
                    <span className={`text-sm font-bold tabular-nums ${rewardColor(v.reward)}`}>
                      {v.reward.toFixed(3)}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[11px] text-zinc-500">{v.content}</p>
                  <div className="mt-2 flex items-center gap-4 text-[10px] text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" /> {fmt(v.impressions)}
                    </span>
                    <span className="flex items-center gap-1">
                      <MousePointerClick className="h-3 w-3" /> {fmt(v.clicks)}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" /> {fmt(v.contacts)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Target className="h-3 w-3" /> {fmt(v.conversions)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <Progress
                      value={maxImpressions > 0 ? (v.impressions / maxImpressions) * 100 : 0}
                      className="h-1 bg-zinc-800"
                    />
                  </div>
                </div>
              )
            })
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
              No experiment variants available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attribution breakdown table */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <TrendingUp className="h-5 w-5 text-purple-400" />
          <CardTitle className="text-base text-white">Attribution Breakdown by Variant</CardTitle>
        </CardHeader>
        <CardContent>
          {allVariants.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400">Variant</TableHead>
                  <TableHead className="text-zinc-400">Status</TableHead>
                  <TableHead className="text-right text-zinc-400">Impressions</TableHead>
                  <TableHead className="text-right text-zinc-400">Clicks</TableHead>
                  <TableHead className="text-right text-zinc-400">Contacts</TableHead>
                  <TableHead className="text-right text-zinc-400">Conversions</TableHead>
                  <TableHead className="text-right text-zinc-400">CTR</TableHead>
                  <TableHead className="text-right text-zinc-400">Reward</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedVariants.map((v) => {
                  const ctr =
                    v.impressions > 0 ? (v.clicks / v.impressions) * 100 : null
                  return (
                    <TableRow key={v.id} className="border-zinc-800/60">
                      <TableCell className="text-zinc-300">{v.label}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[9px] ${statusBadgeClass(v.status)}`}
                        >
                          {v.status.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-white tabular-nums">
                        {fmt(v.impressions)}
                      </TableCell>
                      <TableCell className="text-right text-white tabular-nums">
                        {fmt(v.clicks)}
                      </TableCell>
                      <TableCell className="text-right text-white tabular-nums">
                        {fmt(v.contacts)}
                      </TableCell>
                      <TableCell className="text-right text-white tabular-nums">
                        {fmt(v.conversions)}
                      </TableCell>
                      <TableCell className="text-right text-zinc-300 tabular-nums">
                        {fmtPct(ctr)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-bold tabular-nums ${rewardColor(v.reward)}`}
                      >
                        {v.reward.toFixed(3)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
              No attribution data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Experiment context */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <FlaskConical className="h-5 w-5 text-amber-400" />
          <CardTitle className="text-base text-white">Experiments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {exps.length > 0 ? (
            exps.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between rounded-lg border border-zinc-800/60 bg-zinc-900/30 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="text-xs text-zinc-300">{e.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500">{e.variants?.length ?? 0} variants</span>
                  <Badge
                    variant="outline"
                    className={`text-[9px] ${statusBadgeClass(e.status)}`}
                  >
                    {e.status.toUpperCase()}
                  </Badge>
                </div>
              </div>
            ))
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
              No experiments available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
