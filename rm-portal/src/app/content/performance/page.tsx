"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TrendingUp, BarChart3, Target } from "lucide-react"
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid } from "recharts"
import { useApi, api, type ContentItem, type Experiment } from "@/lib/api"
import { LoadingState, PageHeader, statusBadgeClass, scoreColor } from "@/components/ui-helpers"

const typeBadgeClass: Record<string, string> = {
  bio: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  blog: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  social: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  seo: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  email: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  interview: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
}

function typeBadgeClassFor(type: string): string {
  return typeBadgeClass[type.toLowerCase()] || "border-border/80 bg-accent/30 text-muted-foreground"
}

const barColors: Record<string, string> = {
  bio: "#f97316",
  blog: "#3b82f6",
  social: "#a855f7",
  seo: "#10b981",
  email: "#f59e0b",
  interview: "#06b6d4",
}

function barColorFor(type: string): string {
  return barColors[type.toLowerCase()] || "#71717a"
}

export default function ContentPerformancePage() {
  const { data: content, loading: contentLoading } = useApi<ContentItem[]>(() => api.getContent("", 50), [], 15000)
  const { data: experiments, loading: expLoading } = useApi<Experiment[]>(() => api.getExperiments(), [])

  if (contentLoading || !content) return <LoadingState label="Loading performance data..." />

  const allContent = content || []
  const allExperiments = experiments || []
  const experimentMap = new Map<string, Experiment>()
  allExperiments.forEach((e) => experimentMap.set(e.id, e))

  // Chart data: average performance score by type
  const typeGroups = allContent.reduce<Record<string, ContentItem[]>>((acc, item) => {
    const t = item.type.toLowerCase()
    if (!acc[t]) acc[t] = []
    acc[t].push(item)
    return acc
  }, {})

  const chartData = Object.entries(typeGroups).map(([type, items]) => {
    const scored = items.filter((i) => i.performance_score > 0)
    const avg = scored.length > 0 ? scored.reduce((s, i) => s + i.performance_score, 0) / scored.length : 0
    return {
      type: type.charAt(0).toUpperCase() + type.slice(1),
      score: Number((avg * 100).toFixed(1)),
      count: items.length,
      fill: barColorFor(type),
    }
  })

  const scoredContent = allContent.filter((c) => c.performance_score > 0)
  const overallAvg =
    scoredContent.length > 0
      ? scoredContent.reduce((s, c) => s + c.performance_score, 0) / scoredContent.length
      : 0

  const topPerformer = scoredContent.length > 0
    ? scoredContent.reduce((best, c) => (c.performance_score > best.performance_score ? c : best))
    : null

  return (
    <div className="space-y-6">
      <PageHeader title="Content Performance" subtitle="Track how content performs across experiments" />

      {/* Summary stats */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
          <TrendingUp className="h-6 w-6 text-emerald-400" />
          <div>
            <div className="text-xl font-bold text-foreground">{(overallAvg * 100).toFixed(0)}</div>
            <div className="text-[10px] text-muted-foreground">Avg Performance</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
          <BarChart3 className="h-6 w-6 text-blue-400" />
          <div>
            <div className="text-xl font-bold text-foreground">{scoredContent.length}</div>
            <div className="text-[10px] text-muted-foreground">Scored Items</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
          <Target className="h-6 w-6 text-orange-400" />
          <div>
            <div className="truncate text-sm font-bold text-foreground">{topPerformer?.title || "—"}</div>
            <div className="text-[10px] text-muted-foreground">
              {topPerformer ? `Top score: ${(topPerformer.performance_score * 100).toFixed(0)}` : "No scored content"}
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card className="border-border bg-card/50">
          <CardHeader className="flex flex-row items-center gap-2">
            <BarChart3 className="h-5 w-5 text-blue-400" />
            <CardTitle className="text-base text-foreground">Performance by Content Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="type" stroke="#52525b" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#52525b" fontSize={11} tickLine={false} axisLine={false} />
                  <RTooltip
                    contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px", fontSize: "12px" }}
                    cursor={{ fill: "#27272a40" }}
                  />
                  <Bar dataKey="score" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <TrendingUp className="h-5 w-5 text-emerald-400" />
          <CardTitle className="text-base text-foreground">Content & Experiments</CardTitle>
        </CardHeader>
        <CardContent>
          {allContent.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">No content available</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Title</TableHead>
                  <TableHead className="text-muted-foreground">Type</TableHead>
                  <TableHead className="text-muted-foreground">Experiment</TableHead>
                  <TableHead className="text-muted-foreground">Score</TableHead>
                  <TableHead className="text-muted-foreground">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allContent.map((item) => {
                  const experiment = item.experiment_id ? experimentMap.get(item.experiment_id) : null
                  return (
                    <TableRow key={item.id} className="border-border/50 hover:bg-accent/20">
                      <TableCell className="max-w-[200px] truncate text-xs text-foreground/90">{item.title}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[9px] uppercase ${typeBadgeClassFor(item.type)}`}>
                          {item.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {experiment ? (
                          <span className="truncate">{experiment.name}</span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {item.performance_score > 0 ? (
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold tabular-nums ${scoreColor(item.performance_score)}`}>
                              {(item.performance_score * 100).toFixed(0)}
                            </span>
                            <Progress value={item.performance_score * 100} className="h-1.5 w-16 bg-accent" />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[9px] ${statusBadgeClass(item.status)}`}>
                          {item.status}
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
