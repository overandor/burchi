"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Users, MapPin, MessageSquare, Repeat, Star, ArrowRight } from "lucide-react"
import { useApi, api, type Visitor } from "@/lib/api"
import { LoadingState, PageHeader, scoreColor } from "@/components/ui-helpers"

function actionBadge(action: string) {
  if (action.includes("VIP") || action.includes("Follow up"))
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
  if (action.includes("Message"))
    return "border-blue-500/30 bg-blue-500/10 text-blue-400"
  if (action.includes("Responded") || action.includes("nurture"))
    return "border-purple-500/30 bg-purple-500/10 text-purple-400"
  return "border-zinc-700 bg-zinc-800/50 text-zinc-500"
}

export default function VisitorsPage() {
  const { data, loading } = useApi<Visitor[]>(() => api.getVisitors(100), [], 15000)

  if (loading || !data) return <LoadingState label="Loading visitors..." />

  const visitors = data
  const totalVisitors = visitors.length
  const repeatVisitors = visitors.filter((v) => v.is_repeat).length
  const messagedVisitors = visitors.filter((v) => v.messaged).length
  const highIntent = visitors.filter((v) => v.engagement_score >= 0.7).length

  return (
    <div className="space-y-6">
      <PageHeader title="Visitor Intelligence" subtitle="Relationship graph — who's watching, who's returning, who's ready" />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="flex items-center gap-3 pt-5">
            <Users className="h-8 w-8 text-blue-400" />
            <div>
              <div className="text-2xl font-bold text-white">{totalVisitors}</div>
              <div className="text-[10px] text-zinc-500">Total Tracked</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="flex items-center gap-3 pt-5">
            <Repeat className="h-8 w-8 text-purple-400" />
            <div>
              <div className="text-2xl font-bold text-white">{repeatVisitors}</div>
              <div className="text-[10px] text-zinc-500">Repeat Visitors</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="flex items-center gap-3 pt-5">
            <MessageSquare className="h-8 w-8 text-emerald-400" />
            <div>
              <div className="text-2xl font-bold text-white">{messagedVisitors}</div>
              <div className="text-[10px] text-zinc-500">Contacted</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="flex items-center gap-3 pt-5">
            <Star className="h-8 w-8 text-orange-400" />
            <div>
              <div className="text-2xl font-bold text-white">{highIntent}</div>
              <div className="text-[10px] text-zinc-500">High Intent</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Visitor table */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader>
          <CardTitle className="text-base text-white">Visitor Roster</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-500">Username</TableHead>
                <TableHead className="text-zinc-500">Visits</TableHead>
                <TableHead className="text-zinc-500">Last Seen</TableHead>
                <TableHead className="text-zinc-500">Location</TableHead>
                <TableHead className="text-zinc-500">Engagement</TableHead>
                <TableHead className="text-zinc-500">Messaged</TableHead>
                <TableHead className="text-zinc-500">Next Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visitors.map((v) => (
                <TableRow key={v.username} className="border-zinc-800/50">
                  <TableCell className="font-medium text-white">
                    <div className="flex items-center gap-2">
                      {v.is_repeat && <Repeat className="h-3 w-3 text-purple-400" />}
                      {v.username}
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums text-zinc-300">{v.visit_count}</TableCell>
                  <TableCell className="text-xs text-zinc-400">
                    {v.last_online}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-400">
                    {v.location ? (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-zinc-600" />
                        {v.location}
                      </span>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold ${scoreColor(v.engagement_score)}`}>
                        {(v.engagement_score * 100).toFixed(0)}
                      </span>
                      <div className="h-1.5 w-12 rounded-full bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-zinc-600 to-orange-400"
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
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
