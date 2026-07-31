"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Users, Star, TrendingUp, ArrowRight, Target, Flame } from "lucide-react"
import { useApi, api, type Visitor } from "@/lib/api"
import { LoadingState, PageHeader, StatCard, scoreColor } from "@/components/ui-helpers"

function actionBadge(action: string) {
  if (action.includes("VIP") || action.includes("Follow up"))
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
  if (action.includes("Message"))
    return "border-blue-500/30 bg-blue-500/10 text-blue-400"
  if (action.includes("Responded") || action.includes("nurture"))
    return "border-purple-500/30 bg-purple-500/10 text-purple-400"
  return "border-zinc-700 bg-zinc-800/50 text-zinc-500"
}

function rankColor(rank: number) {
  if (rank === 1) return "text-amber-400"
  if (rank === 2) return "text-zinc-300"
  if (rank === 3) return "text-orange-400"
  return "text-zinc-500"
}

export default function HighIntentPage() {
  const { data, loading } = useApi<Visitor[]>(() => api.getHighIntentVisitors(20), [], 15000)

  if (loading) return <LoadingState label="Loading high-intent queue..." />

  const visitors = (data || []).slice().sort((a, b) => b.engagement_score - a.engagement_score)

  const total = visitors.length
  const avgEngagement = total > 0 ? visitors.reduce((s, v) => s + v.engagement_score, 0) / total : 0
  const topScore = total > 0 ? Math.max(...visitors.map((v) => v.engagement_score)) : 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="High-Intent Queue"
        subtitle="Priority queue of visitors ranked by engagement score — act before they cool off"
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard icon={Target} value={total} label="Total High-Intent" color="text-orange-400" />
        <StatCard icon={TrendingUp} value={`${(avgEngagement * 100).toFixed(0)}%`} label="Avg Engagement" color="text-blue-400" />
        <StatCard icon={Flame} value={`${(topScore * 100).toFixed(0)}%`} label="Top Score" color="text-emerald-400" />
      </div>

      {/* Priority queue table */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Star className="h-5 w-5 text-orange-400" />
          <CardTitle className="text-base text-white">Priority Queue</CardTitle>
          <Badge variant="outline" className="ml-auto border-orange-500/30 bg-orange-500/10 text-orange-400 text-[9px]">
            <Flame className="mr-1 h-2.5 w-2.5" />
            {total} READY
          </Badge>
        </CardHeader>
        <CardContent>
          {visitors.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-500">No high-intent visitors detected</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="w-12 text-zinc-500">Rank</TableHead>
                  <TableHead className="text-zinc-500">Username</TableHead>
                  <TableHead className="text-zinc-500">Engagement</TableHead>
                  <TableHead className="text-zinc-500">Visits</TableHead>
                  <TableHead className="text-zinc-500">Lifecycle</TableHead>
                  <TableHead className="text-zinc-500">Inferred Intent</TableHead>
                  <TableHead className="text-zinc-500">Next Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visitors.map((v, i) => {
                  const rank = i + 1
                  return (
                    <TableRow key={v.username} className="border-zinc-800/50">
                      <TableCell>
                        <span className={`text-sm font-bold tabular-nums ${rankColor(rank)}`}>
                          {rank <= 3 ? `#${rank}` : rank}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium text-white">
                        <div className="flex items-center gap-2">
                          {v.is_repeat && <Users className="h-3 w-3 text-purple-400" />}
                          {v.username}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-bold ${scoreColor(v.engagement_score)}`}>
                            {(v.engagement_score * 100).toFixed(0)}
                          </span>
                          <div className="h-1.5 w-16 rounded-full bg-zinc-800">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-zinc-600 to-orange-400"
                              style={{ width: `${v.engagement_score * 100}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums text-zinc-300">{v.visit_count}</TableCell>
                      <TableCell>
                        {v.lifecycle_stage ? (
                          <Badge variant="outline" className="text-[9px] border-zinc-700 bg-zinc-800/50 text-zinc-300">
                            {v.lifecycle_stage}
                          </Badge>
                        ) : (
                          <span className="text-zinc-600 text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-400">
                        {v.inferred_intent || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[9px] ${actionBadge(v.next_action)}`}>
                          <ArrowRight className="mr-1 h-2.5 w-2.5" />
                          {v.next_action}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
