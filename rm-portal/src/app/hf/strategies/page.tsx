"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Trophy, Target, Star, Layers } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader, StatCard, rewardColor, scoreColor } from "@/components/ui-helpers"

export default function HfStrategiesPage() {
  const { data, loading } = useApi<any[]>(() => api.hfStrategies(100, 0), [], 30000)
  const { data: counts } = useApi<Record<string, number>>(() => api.hfCounts(), [], 30000)

  if (loading || !data) return <LoadingState label="Loading strategies..." />

  const strategies = data
  const total = counts?._count_strategies ?? strategies.length
  const bestReward =
    strategies.length > 0
      ? Math.max(...strategies.map((s: any) => s.total_reward ?? 0)).toFixed(3)
      : "—"
  const totalAppearances = strategies.reduce((s: number, st: any) => s + (st.appearances || 0), 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bio Strategies"
        subtitle="RL-tracked bio strategies with reward scores and A/B test performance"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Layers} value={total} label="Total Strategies" color="text-blue-400" />
        <StatCard icon={Trophy} value={bestReward} label="Best Reward" color="text-emerald-400" />
        <StatCard icon={Target} value={totalAppearances} label="Total Appearances" color="text-purple-400" />
        <StatCard icon={Star} value={strategies.length} label="Loaded" color="text-amber-400" />
      </div>

      <Card className="border-border bg-card/50">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Strategy Leaderboard</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Strategy</TableHead>
                <TableHead className="text-muted-foreground">Total Reward</TableHead>
                <TableHead className="text-muted-foreground">Appearances</TableHead>
                <TableHead className="text-muted-foreground">Avg Reward</TableHead>
                <TableHead className="text-muted-foreground">AB Test Score</TableHead>
                <TableHead className="text-muted-foreground">AB Test Reasoning</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {strategies.map((s: any, i: number) => (
                <TableRow key={i} className="border-border/50">
                  <TableCell className="font-medium text-foreground">{s.strategy ?? "—"}</TableCell>
                  <TableCell className={`tabular-nums font-bold ${rewardColor(s.total_reward ?? 0)}`}>
                    {(s.total_reward ?? 0).toFixed(3)}
                  </TableCell>
                  <TableCell className="tabular-nums text-foreground/80">{s.appearances ?? 0}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {(s.avg_reward ?? 0).toFixed(3)}
                  </TableCell>
                  <TableCell>
                    <span className={`text-sm font-bold ${scoreColor(s.ab_test_score ?? 0)}`}>
                      {(s.ab_test_score ?? 0).toFixed(2)}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                    {s.ab_test_reasoning ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
