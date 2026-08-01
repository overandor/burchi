"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  CartesianGrid,
  Cell,
} from "recharts"
import { Trophy, TrendingUp, TrendingDown, MousePointerClick, Eye } from "lucide-react"
import { useApi, api, type Experiment, type Variant } from "@/lib/api"
import { LoadingState, PageHeader, statusBadgeClass, rewardColor } from "@/components/ui-helpers"

interface Row {
  variant: Variant
  experiment: Experiment
  reward: number
  ctr: number
}

export default function RewardsPage() {
  const { data, loading } = useApi<Experiment[]>(() => api.getExperiments(), [], 15000)

  if (loading) return <LoadingState label="Loading reward explorer..." />

  const experiments = data ?? []

  const rows: Row[] = experiments.flatMap((exp) =>
    (exp.variants ?? []).map((v) => ({
      variant: v,
      experiment: exp,
      reward: v.reward ?? 0,
      ctr: v.impressions && v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0,
    })),
  )

  // Sort by reward desc for the chart + table
  rows.sort((a, b) => b.reward - a.reward)

  const chartData = rows.map((r) => ({
    name: r.variant.label,
    reward: r.reward,
    experiment: r.experiment.name,
  }))

  const positiveCount = rows.filter((r) => r.reward > 0).length
  const negativeCount = rows.filter((r) => r.reward < 0).length
  const avgReward =
    rows.length > 0 ? rows.reduce((s, r) => s + r.reward, 0) / rows.length : 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reward Explorer"
        subtitle="RL reward scores across all variants and experiments"
      />

      {/* summary stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
          <Trophy className="h-7 w-7 text-orange-400" />
          <div>
            <div className="text-xl font-bold text-foreground tabular-nums">{rows.length}</div>
            <div className="text-[10px] text-muted-foreground">total variants</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
          <TrendingUp className="h-7 w-7 text-emerald-400" />
          <div>
            <div className="text-xl font-bold text-emerald-400 tabular-nums">{positiveCount}</div>
            <div className="text-[10px] text-muted-foreground">positive reward</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
          <TrendingDown className="h-7 w-7 text-red-400" />
          <div>
            <div className="text-xl font-bold text-red-400 tabular-nums">{negativeCount}</div>
            <div className="text-[10px] text-muted-foreground">negative reward</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
          <MousePointerClick className="h-7 w-7 text-blue-400" />
          <div>
            <div className={`text-xl font-bold tabular-nums ${rewardColor(avgReward)}`}>
              {avgReward.toFixed(2)}
            </div>
            <div className="text-[10px] text-muted-foreground">avg reward</div>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="border-border bg-card/50">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No variants with reward data yet.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* chart */}
          <Card className="border-border bg-card/50">
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-400" />
                <CardTitle className="text-sm text-foreground">Variant Rewards</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[340px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis
                      dataKey="name"
                      stroke="#71717a"
                      tick={{ fill: "#a1a1aa", fontSize: 10 }}
                      angle={-35}
                      textAnchor="end"
                      height={60}
                      interval={0}
                    />
                    <YAxis
                      stroke="#71717a"
                      tick={{ fill: "#a1a1aa", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <RTooltip
                      cursor={{ fill: "rgba(63,63,70,0.3)" }}
                      contentStyle={{
                        backgroundColor: "#18181b",
                        border: "1px solid #27272a",
                        borderRadius: "6px",
                        fontSize: "12px",
                        color: "#fafafa",
                      }}
                      labelStyle={{ color: "#a1a1aa" }}
                      formatter={(value) => [Number(value).toFixed(2), "reward"]}
                    />
                    <Bar dataKey="reward" radius={[4, 4, 0, 0]}>
                      {chartData.map((entry, idx) => (
                        <Cell
                          key={`cell-${idx}`}
                          fill={entry.reward >= 0 ? "#10b981" : "#ef4444"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* table */}
          <Card className="border-border bg-card/50">
            <CardHeader>
              <CardTitle className="text-sm text-foreground">Variant Details</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider">Variant</TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider">Experiment</TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider text-right">Reward</TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider text-right">Impressions</TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider text-right">Clicks</TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider text-right">CTR</TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.variant.id} className="border-border/70">
                      <TableCell>
                        <span className="text-sm font-medium text-foreground">{r.variant.label}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">{r.experiment.name}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={`text-sm font-bold tabular-nums ${rewardColor(r.reward)}`}
                        >
                          {r.reward.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="flex items-center justify-end gap-1 text-xs text-foreground/80 tabular-nums">
                          <Eye className="h-3 w-3 text-muted-foreground/60" />
                          {r.variant.impressions ?? 0}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="flex items-center justify-end gap-1 text-xs text-foreground/80 tabular-nums">
                          <MousePointerClick className="h-3 w-3 text-muted-foreground/60" />
                          {r.variant.clicks ?? 0}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs text-foreground/80 tabular-nums">
                          {r.ctr.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusBadgeClass(r.variant.status)}>
                          {r.variant.status.toUpperCase()}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
