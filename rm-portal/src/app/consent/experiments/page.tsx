"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FlaskConical } from "lucide-react"
import { useApi } from "@/lib/api"
import { consentApi, type Experiment } from "@/lib/consent"
import { LoadingState, PageHeader, StatCard, statusBadgeClass } from "@/components/ui-helpers"

export default function ExperimentsPage() {
  const { data, loading } = useApi<Experiment[]>(() => consentApi.getExperiments(), [], 30000)

  if (loading || !data) return <LoadingState label="Loading experiments..." />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Experiments"
        subtitle="A/B tests on consenting audiences only — optimizing for legitimate outcomes"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={FlaskConical} value={data.length} label="Total Experiments" color="text-purple-400" />
        <StatCard icon={FlaskConical} value={data.filter((e) => e.status === "running").length} label="Running" color="text-emerald-400" />
        <StatCard icon={FlaskConical} value={data.filter((e) => e.status === "completed").length} label="Completed" color="text-blue-400" />
        <StatCard icon={FlaskConical} value={data.filter((e) => e.status === "draft").length} label="Drafts" color="text-amber-400" />
      </div>

      <Card className="border-border bg-card/50">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Experiments</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Name</TableHead>
                <TableHead className="text-muted-foreground">Reward Metric</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Variants</TableHead>
                <TableHead className="text-muted-foreground">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No experiments yet. Experiments run only on contacts with active consent.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((exp) => (
                  <TableRow key={exp.id} className="border-border/50">
                    <TableCell className="font-medium text-foreground">{exp.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[9px]">{exp.reward_metric}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[9px] ${statusBadgeClass(exp.status)}`}>
                        {exp.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{exp.variants?.length ?? 0}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{new Date(exp.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-border bg-card/50">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Allowed Reward Metrics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {[
            "response_helpfulness — How helpful the response was to the recipient",
            "customer_satisfaction — CSAT score from the recipient",
            "booking_completion — Booking completed after an inbound inquiry",
            "retention — Recipient remains engaged over time",
            "reduced_support_time — Time saved in support resolution",
            "response_rate — Recipient responds (inbound engagement, not conversion)",
          ].map((m, i) => (
            <div key={i} className="text-xs text-muted-foreground py-0.5">
              <Badge variant="outline" className="mr-2 text-[9px] border-emerald-500/30 bg-emerald-500/10 text-emerald-400">allowed</Badge>
              {m}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
