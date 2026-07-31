"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TrendingUp } from "lucide-react"
import { useApi } from "@/lib/api"
import { consentApi, type Outcome } from "@/lib/consent"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"

export default function OutcomesPage() {
  const { data, loading } = useApi<Outcome[]>(() => consentApi.getOutcomes(100), [], 30000)

  if (loading || !data) return <LoadingState label="Loading outcomes..." />

  const avgValue = data.length > 0 ? (data.reduce((s, o) => s + o.value, 0) / data.length).toFixed(2) : "0"

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outcomes"
        subtitle="Measurement of legitimate results — helpfulness, CSAT, booking-after-inquiry, retention, support time"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={TrendingUp} value={data.length} label="Total Outcomes" color="text-pink-400" />
        <StatCard icon={TrendingUp} value={avgValue} label="Avg Value" color="text-blue-400" />
        <StatCard icon={TrendingUp} value={data.filter((o) => o.outcome_type === "csat").length} label="CSAT Scores" color="text-emerald-400" />
        <StatCard icon={TrendingUp} value={data.filter((o) => o.outcome_type === "booking_completion").length} label="Bookings" color="text-amber-400" />
      </div>

      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader>
          <CardTitle className="text-base text-white">Recorded Outcomes</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-500">Contact</TableHead>
                <TableHead className="text-zinc-500">Type</TableHead>
                <TableHead className="text-zinc-500">Value</TableHead>
                <TableHead className="text-zinc-500">Message</TableHead>
                <TableHead className="text-zinc-500">Recorded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-zinc-500 py-8">
                    No outcomes recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((o) => (
                  <TableRow key={o.id} className="border-zinc-800/50">
                    <TableCell className="text-xs text-zinc-400">{(o as any).contact_email ?? o.contact_id.slice(0, 8)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[9px]">{o.outcome_type}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums text-white">{o.value}</TableCell>
                    <TableCell className="text-xs text-zinc-500">{(o as any).message_subject ?? (o.message_id ? o.message_id.slice(0, 8) : "—")}</TableCell>
                    <TableCell className="text-xs text-zinc-500">{new Date(o.recorded_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
