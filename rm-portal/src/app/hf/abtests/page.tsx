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
import { FlaskConical, CheckCircle2, XCircle, TrendingUp, Calendar } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader, StatCard, scoreColor } from "@/components/ui-helpers"

function boolBadge(val: any) {
  if (val === true || val === "true" || val === 1 || val === "yes") {
    return (
      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[9px]">
        <CheckCircle2 className="mr-1 h-2.5 w-2.5" /> Yes
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-400 text-[9px]">
      <XCircle className="mr-1 h-2.5 w-2.5" /> No
    </Badge>
  )
}

export default function HfABTestsPage() {
  const { data, loading } = useApi<any[]>(() => api.hfABTests(100, 0), [], 30000)
  const { data: counts } = useApi<Record<string, number>>(() => api.hfCounts(), [], 30000)

  if (loading || !data) return <LoadingState label="Loading A/B tests..." />

  const tests = data
  const total = counts?._count_abtests ?? tests.length
  const avgOverall =
    tests.length > 0
      ? (tests.reduce((s: number, t: any) => s + (t.overall || 0), 0) / tests.length).toFixed(2)
      : "—"
  const passing = tests.filter((t: any) => t.overall >= 0.7).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="A/B Test Results"
        subtitle="Bio variant scoring across dimensions — length, CTA, urgency, SEO, and more"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={FlaskConical} value={total} label="Total Tests" color="text-blue-400" />
        <StatCard icon={TrendingUp} value={avgOverall} label="Avg Overall Score" color="text-amber-400" />
        <StatCard icon={CheckCircle2} value={passing} label="Passing (≥0.7)" color="text-emerald-400" />
        <StatCard icon={Calendar} value={tests.length > 0 ? tests[0].test_date ?? "—" : "—"} label="Latest Test" color="text-purple-400" />
      </div>

      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader>
          <CardTitle className="text-base text-white">Test Scores</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-500">Date</TableHead>
                <TableHead className="text-zinc-500">Strategy</TableHead>
                <TableHead className="text-zinc-500">Bio Len</TableHead>
                <TableHead className="text-zinc-500">Phone CTA</TableHead>
                <TableHead className="text-zinc-500">Urgency</TableHead>
                <TableHead className="text-zinc-500">Emotion</TableHead>
                <TableHead className="text-zinc-500">SEO</TableHead>
                <TableHead className="text-zinc-500">Unique</TableHead>
                <TableHead className="text-zinc-500">Len Opt</TableHead>
                <TableHead className="text-zinc-500">Beats Comp</TableHead>
                <TableHead className="text-zinc-500">Overall</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tests.map((t: any, i: number) => (
                <TableRow key={i} className="border-zinc-800/50">
                  <TableCell className="text-xs text-zinc-400">{t.test_date ?? "—"}</TableCell>
                  <TableCell className="text-xs text-zinc-300">{t.strategy ?? "—"}</TableCell>
                  <TableCell className="tabular-nums text-xs text-zinc-400">{t.bio_length ?? "—"}</TableCell>
                  <TableCell className="tabular-nums text-xs text-zinc-400">{t.phone_cta_strength ?? "—"}</TableCell>
                  <TableCell className="tabular-nums text-xs text-zinc-400">{t.urgency ?? "—"}</TableCell>
                  <TableCell className="tabular-nums text-xs text-zinc-400">{t.emotional_hook ?? "—"}</TableCell>
                  <TableCell className="tabular-nums text-xs text-zinc-400">{t.seo_keywords ?? "—"}</TableCell>
                  <TableCell className="tabular-nums text-xs text-zinc-400">{t.uniqueness ?? "—"}</TableCell>
                  <TableCell>{boolBadge(t.length_optimal)}</TableCell>
                  <TableCell>{boolBadge(t.beats_competitors)}</TableCell>
                  <TableCell>
                    <span className={`text-sm font-bold ${scoreColor(t.overall ?? 0)}`}>
                      {(t.overall ?? 0).toFixed(2)}
                    </span>
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
