"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ScrollText } from "lucide-react"
import { useApi } from "@/lib/api"
import { consentApi, type AuditEntry } from "@/lib/consent"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"

export default function AuditPage() {
  const { data, loading } = useApi<AuditEntry[]>(() => consentApi.getAudit(100), [], 30000)

  if (loading || !data) return <LoadingState label="Loading audit trail..." />

  return (
    <div className="space-y-6">
      <PageHeader title="Audit Trail" subtitle="Immutable log — why each recipient was eligible, who approved, what was sent" />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard icon={ScrollText} value={data.length} label="Total Entries" color="text-blue-400" />
        <StatCard icon={ScrollText} value={data.filter((d) => d.action.includes("sent")).length} label="Send Events" color="text-cyan-400" />
        <StatCard icon={ScrollText} value={data.filter((d) => d.action.includes("blocked") || d.action.includes("suppressed")).length} label="Blocked Events" color="text-red-400" />
      </div>

      <Card className="border-border bg-card/50">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Audit Log (Immutable)</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px]">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">ID</TableHead>
                  <TableHead className="text-muted-foreground">Action</TableHead>
                  <TableHead className="text-muted-foreground">Entity</TableHead>
                  <TableHead className="text-muted-foreground">Actor</TableHead>
                  <TableHead className="text-muted-foreground">Details</TableHead>
                  <TableHead className="text-muted-foreground">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No audit entries yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((entry) => (
                    <TableRow key={entry.id} className="border-border/50">
                      <TableCell className="font-mono text-xs text-muted-foreground">{entry.id}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[9px] ${
                            entry.action.includes("blocked") || entry.action.includes("suppressed") || entry.action.includes("failed")
                              ? "border-red-500/30 bg-red-500/10 text-red-400"
                              : entry.action.includes("sent") || entry.action.includes("approved") || entry.action.includes("created")
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                : "border-border/80 bg-accent/30 text-muted-foreground"
                          }`}
                        >
                          {entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{entry.entity_type}{entry.entity_id ? `:${entry.entity_id.slice(0, 8)}` : ""}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{entry.actor}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate font-mono">
                        {JSON.stringify(entry.details).slice(0, 80)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(entry.created_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
