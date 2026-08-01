"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Repeat, MapPin, MessageSquare, ArrowRight, TrendingUp, Hash } from "lucide-react"
import { useApi, api, type Visitor } from "@/lib/api"
import { LoadingState, PageHeader, StatCard, scoreColor } from "@/components/ui-helpers"

function actionBadge(action: string) {
  if (action.includes("VIP") || action.includes("Follow up"))
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
  if (action.includes("Message"))
    return "border-blue-500/30 bg-blue-500/10 text-blue-400"
  if (action.includes("Responded") || action.includes("nurture"))
    return "border-purple-500/30 bg-purple-500/10 text-purple-400"
  return "border-border/80 bg-accent/30 text-muted-foreground"
}

function heatColor(count: number, max: number) {
  if (max === 0) return "bg-accent/30 text-muted-foreground/60"
  const ratio = count / max
  if (ratio >= 0.8) return "bg-orange-500/80 text-foreground"
  if (ratio >= 0.6) return "bg-orange-500/60 text-foreground"
  if (ratio >= 0.4) return "bg-orange-500/40 text-foreground"
  if (ratio >= 0.2) return "bg-orange-500/20 text-foreground/80"
  return "bg-orange-500/10 text-muted-foreground"
}

export default function RepeatVisitorPage() {
  const { data, loading } = useApi<Visitor[]>(() => api.getVisitors(100), [], 15000)

  if (loading) return <LoadingState label="Loading repeat visitors..." />

  const allVisitors = data || []
  const repeatVisitors = allVisitors.filter((v) => v.is_repeat === true || v.visit_count > 1)

  const total = repeatVisitors.length
  const avgVisits = total > 0 ? repeatVisitors.reduce((s, v) => s + v.visit_count, 0) / total : 0
  const maxVisits = total > 0 ? Math.max(...repeatVisitors.map((v) => v.visit_count)) : 0
  const messagedCount = repeatVisitors.filter((v) => v.messaged).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Repeat Visitor Board"
        subtitle="Returning visitors — the warmest part of your funnel, ranked by visit frequency"
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Repeat} value={total} label="Total Repeat" color="text-purple-400" />
        <StatCard icon={TrendingUp} value={avgVisits.toFixed(1)} label="Avg Visits" color="text-blue-400" />
        <StatCard icon={Hash} value={maxVisits} label="Max Visits" color="text-orange-400" />
        <StatCard icon={MessageSquare} value={messagedCount} label="Messaged" color="text-emerald-400" />
      </div>

      {/* Heatmap grid */}
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Repeat className="h-5 w-5 text-purple-400" />
          <CardTitle className="text-base text-foreground">Visit Count Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          {repeatVisitors.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No repeat visitors yet</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {repeatVisitors
                .slice()
                .sort((a, b) => b.visit_count - a.visit_count)
                .map((v) => (
                  <div
                    key={v.username}
                    className={`flex flex-col items-center justify-center rounded-md px-3 py-2 ${heatColor(v.visit_count, maxVisits)}`}
                    title={`${v.username} — ${v.visit_count} visits`}
                  >
                    <span className="text-xs font-medium">{v.username}</span>
                    <span className="text-lg font-bold tabular-nums">{v.visit_count}</span>
                  </div>
                ))}
            </div>
          )}
          <div className="mt-4 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>Less</span>
            <div className="h-3 w-6 rounded bg-orange-500/10" />
            <div className="h-3 w-6 rounded bg-orange-500/20" />
            <div className="h-3 w-6 rounded bg-orange-500/40" />
            <div className="h-3 w-6 rounded bg-orange-500/60" />
            <div className="h-3 w-6 rounded bg-orange-500/80" />
            <span>More</span>
          </div>
        </CardContent>
      </Card>

      {/* Repeat visitor table */}
      <Card className="border-border bg-card/50">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Repeat Visitor Roster</CardTitle>
        </CardHeader>
        <CardContent>
          {repeatVisitors.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No repeat visitors yet</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Username</TableHead>
                  <TableHead className="text-muted-foreground">Visits</TableHead>
                  <TableHead className="text-muted-foreground">Last Seen</TableHead>
                  <TableHead className="text-muted-foreground">Location</TableHead>
                  <TableHead className="text-muted-foreground">Engagement</TableHead>
                  <TableHead className="text-muted-foreground">Messaged</TableHead>
                  <TableHead className="text-muted-foreground">Next Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repeatVisitors
                  .slice()
                  .sort((a, b) => b.visit_count - a.visit_count)
                  .map((v) => (
                    <TableRow key={v.username} className="border-border/50">
                      <TableCell className="font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          <Repeat className="h-3 w-3 text-purple-400" />
                          {v.username}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm font-bold tabular-nums text-purple-400">{v.visit_count}</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {v.last_online}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {v.location ? (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-muted-foreground/60" />
                            {v.location}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-bold ${scoreColor(v.engagement_score)}`}>
                            {(v.engagement_score * 100).toFixed(0)}
                          </span>
                          <div className="h-1.5 w-12 rounded-full bg-accent">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-muted-foreground to-orange-400"
                              style={{ width: `${v.engagement_score * 100}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {v.messaged ? (
                          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[9px]">
                            <MessageSquare className="mr-1 h-2.5 w-2.5" />
                            {v.messaged_count}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground/60 text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[9px] ${actionBadge(v.next_action)}`}>
                          <ArrowRight className="mr-1 h-2.5 w-2.5" />
                          {v.next_action}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
