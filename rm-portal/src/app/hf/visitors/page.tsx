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
import { Users, Eye, Repeat, ExternalLink, Clock } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"

export default function HfVisitorsPage() {
  const { data, loading } = useApi<any[]>(() => api.hfVisitors(100, 0), [], 30000)
  const { data: counts } = useApi<Record<string, number>>(() => api.hfCounts(), [], 30000)

  if (loading || !data) return <LoadingState label="Loading visitors..." />

  const visitors = data
  const total = counts?._count_visitors ?? visitors.length
  const repeatVisitors = visitors.filter((v) => v.visit_count > 1).length
  const totalVisits = visitors.reduce((sum: number, v: any) => sum + (v.visit_count || 0), 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile Visitors"
        subtitle="Users who have viewed the profile, with visit frequency and recency"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Users} value={total} label="Total Visitors" color="text-blue-400" />
        <StatCard icon={Eye} value={totalVisits} label="Total Visits" color="text-cyan-400" />
        <StatCard icon={Repeat} value={repeatVisitors} label="Repeat Visitors" color="text-purple-400" />
        <StatCard icon={Clock} value={visitors.length} label="Loaded" color="text-amber-400" />
      </div>

      <Card className="border-border bg-card/50">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Visitor Log</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Username</TableHead>
                <TableHead className="text-muted-foreground">Visits</TableHead>
                <TableHead className="text-muted-foreground">First Seen</TableHead>
                <TableHead className="text-muted-foreground">Last Seen</TableHead>
                <TableHead className="text-muted-foreground">Last Online</TableHead>
                <TableHead className="text-muted-foreground">Profile</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visitors.map((v, i) => (
                <TableRow key={`${v.username}-${i}`} className="border-border/50">
                  <TableCell className="font-medium text-foreground">
                    <div className="flex items-center gap-2">
                      {v.visit_count > 1 && <Repeat className="h-3 w-3 text-purple-400" />}
                      {v.username ?? "—"}
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums text-foreground/80">{v.visit_count ?? 0}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{v.first_seen ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{v.last_seen ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{v.last_online ?? "—"}</TableCell>
                  <TableCell>
                    {v.profile_url ? (
                      <a
                        href={v.profile_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-blue-400 transition-colors hover:bg-accent hover:text-blue-300"
                      >
                        <ExternalLink className="h-3 w-3" /> View
                      </a>
                    ) : (
                      <span className="text-muted-foreground/60 text-xs">—</span>
                    )}
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
