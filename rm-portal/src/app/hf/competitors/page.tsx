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
import { Trophy, Users, ExternalLink, Crown } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"

export default function HfCompetitorsPage() {
  const { data, loading } = useApi<any[]>(() => api.hfCompetitors(100, 0), [], 30000)
  const { data: counts } = useApi<Record<string, number>>(() => api.hfCounts(), [], 30000)

  if (loading || !data) return <LoadingState label="Loading competitors..." />

  const competitors = data
  const total = counts?._count_competitor_profiles ?? competitors.length
  const topRank = competitors.length > 0 ? competitors[0].rank : 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Competitor Profiles"
        subtitle="Scanned competitor masseur profiles ranked by visibility on the platform"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Users} value={total} label="Total Competitors" color="text-blue-400" />
        <StatCard icon={Trophy} value={competitors.length} label="Loaded" color="text-amber-400" />
        <StatCard icon={Crown} value={topRank ? `#${topRank}` : "—"} label="Top Rank Shown" color="text-purple-400" />
        <StatCard icon={ExternalLink} value={competitors.filter((c) => c.profile_url).length} label="With Profile URL" color="text-emerald-400" />
      </div>

      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader>
          <CardTitle className="text-base text-white">Competitor Roster</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-500">Rank</TableHead>
                <TableHead className="text-zinc-500">Username</TableHead>
                <TableHead className="text-zinc-500">Bio Snippet</TableHead>
                <TableHead className="text-zinc-500">Profile</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {competitors.map((c, i) => (
                <TableRow key={`${c.username}-${i}`} className="border-zinc-800/50">
                  <TableCell className="tabular-nums">
                    <Badge
                      variant="outline"
                      className={
                        c.rank <= 3
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-400 text-[9px]"
                          : "border-zinc-700 bg-zinc-800/50 text-zinc-400 text-[9px]"
                      }
                    >
                      #{c.rank}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium text-white">{c.username ?? "—"}</TableCell>
                  <TableCell className="max-w-md truncate text-xs text-zinc-400">
                    {c.bio ? c.bio.slice(0, 120) : "—"}
                  </TableCell>
                  <TableCell>
                    {c.profile_url ? (
                      <a
                        href={c.profile_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-blue-400 transition-colors hover:bg-zinc-800 hover:text-blue-300"
                      >
                        <ExternalLink className="h-3 w-3" /> View
                      </a>
                    ) : (
                      <span className="text-zinc-600 text-xs">—</span>
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
