"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Users, Star, TrendingUp, CheckCircle2, ArrowRight } from "lucide-react"
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import { useApi, api, type Visitor } from "@/lib/api"
import { LoadingState, PageHeader, StatCard, scoreColor } from "@/components/ui-helpers"

const ENGAGEMENT_BINS = [
  { range: "0-0.2", min: 0, max: 0.2, color: "#71717a" },
  { range: "0.2-0.4", min: 0.2, max: 0.4, color: "#f59e0b" },
  { range: "0.4-0.6", min: 0.4, max: 0.6, color: "#3b82f6" },
  { range: "0.6-0.8", min: 0.6, max: 0.8, color: "#22c55e" },
  { range: "0.8-1.0", min: 0.8, max: 1.01, color: "#10b981" },
]

const PIE_COLORS = ["#71717a", "#f59e0b", "#3b82f6", "#22c55e", "#10b981", "#a855f7", "#ec4899"]

function actionBadge(action: string) {
  if (action.includes("VIP") || action.includes("Follow up"))
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
  if (action.includes("Message"))
    return "border-blue-500/30 bg-blue-500/10 text-blue-400"
  if (action.includes("Responded") || action.includes("nurture"))
    return "border-purple-500/30 bg-purple-500/10 text-purple-400"
  return "border-zinc-700 bg-zinc-800/50 text-zinc-500"
}

export default function EngagementPage() {
  const { data, loading } = useApi<Visitor[]>(() => api.getVisitors(100), [], 15000)

  if (loading) return <LoadingState label="Loading engagement analytics..." />

  const visitors = data || []

  const total = visitors.length
  const avgEngagement = total > 0 ? visitors.reduce((s, v) => s + v.engagement_score, 0) / total : 0
  const highIntent = visitors.filter((v) => v.engagement_score >= 0.7).length
  const converted = visitors.filter((v) => v.converted).length

  // Engagement distribution
  const distribution = ENGAGEMENT_BINS.map((bin) => ({
    range: bin.range,
    count: visitors.filter((v) => v.engagement_score >= bin.min && v.engagement_score < bin.max).length,
    color: bin.color,
  }))

  // Lifecycle stage breakdown
  const stageMap = new Map<string, number>()
  visitors.forEach((v) => {
    const stage = v.lifecycle_stage || "unknown"
    stageMap.set(stage, (stageMap.get(stage) || 0) + 1)
  })
  const stageData = Array.from(stageMap.entries()).map(([name, value]) => ({ name, value }))

  // Ranked by engagement
  const ranked = visitors.slice().sort((a, b) => b.engagement_score - a.engagement_score)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Engagement Analytics"
        subtitle="Distribution, lifecycle breakdown, and ranking of visitor engagement"
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Users} value={total} label="Total Visitors" color="text-blue-400" />
        <StatCard icon={TrendingUp} value={`${(avgEngagement * 100).toFixed(0)}%`} label="Avg Engagement" color="text-orange-400" />
        <StatCard icon={Star} value={highIntent} label="High Intent" color="text-emerald-400" />
        <StatCard icon={CheckCircle2} value={converted} label="Converted" color="text-purple-400" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Engagement distribution */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center gap-2">
            <TrendingUp className="h-5 w-5 text-orange-400" />
            <CardTitle className="text-base text-white">Engagement Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="range" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                  <RTooltip
                    contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px", fontSize: "12px" }}
                    cursor={{ fill: "#27272a50" }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {distribution.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Lifecycle stage breakdown */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center gap-2">
            <Users className="h-5 w-5 text-blue-400" />
            <CardTitle className="text-base text-white">Lifecycle Stage Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {stageData.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
                No lifecycle stage data available
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stageData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      innerRadius={40}
                      paddingAngle={2}
                    >
                      {stageData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="#18181b" strokeWidth={2} />
                      ))}
                    </Pie>
                    <RTooltip
                      contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px", fontSize: "12px" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-3">
              {stageData.map((s, i) => (
                <div key={s.name} className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                  />
                  <span className="text-[10px] text-zinc-400">{s.name}</span>
                  <span className="text-[10px] font-bold text-zinc-300">{s.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Visitor ranking table */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Star className="h-5 w-5 text-orange-400" />
          <CardTitle className="text-base text-white">Visitor Ranking</CardTitle>
          <Badge variant="outline" className="ml-auto border-zinc-700 bg-zinc-800/50 text-zinc-400 text-[9px]">
            SORTED BY ENGAGEMENT
          </Badge>
        </CardHeader>
        <CardContent>
          {ranked.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-500">No visitors to rank</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="w-12 text-zinc-500">Rank</TableHead>
                  <TableHead className="text-zinc-500">Username</TableHead>
                  <TableHead className="text-zinc-500">Engagement</TableHead>
                  <TableHead className="text-zinc-500">Visits</TableHead>
                  <TableHead className="text-zinc-500">Lifecycle</TableHead>
                  <TableHead className="text-zinc-500">Converted</TableHead>
                  <TableHead className="text-zinc-500">Next Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranked.map((v, i) => {
                  const rank = i + 1
                  return (
                    <TableRow key={v.username} className="border-zinc-800/50">
                      <TableCell>
                        <span
                          className={`text-sm font-bold tabular-nums ${
                            rank === 1 ? "text-amber-400" : rank <= 3 ? "text-zinc-300" : "text-zinc-500"
                          }`}
                        >
                          {rank <= 3 ? `#${rank}` : rank}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium text-white">{v.username}</TableCell>
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
                      <TableCell>
                        {v.converted ? (
                          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[9px]">
                            <CheckCircle2 className="mr-1 h-2.5 w-2.5" />
                            YES
                          </Badge>
                        ) : (
                          <span className="text-zinc-600 text-xs">—</span>
                        )}
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
