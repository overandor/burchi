"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Shield, CheckCircle2, XCircle } from "lucide-react"
import { useApi } from "@/lib/api"
import { consentApi, type ConsentRecord } from "@/lib/consent"
import { LoadingState, PageHeader } from "@/components/ui-helpers"

export default function ConsentRecordsPage() {
  const { data, loading } = useApi<ConsentRecord[]>(() => consentApi.getConsentRecords(), [], 30000)

  if (loading || !data) return <LoadingState label="Loading consent records..." />

  return (
    <div className="space-y-6">
      <PageHeader title="Consent Records" subtitle="Provenance for every contact — source, scope, and revocation status" />

      <Card className="border-border bg-card/50">
        <CardHeader>
          <CardTitle className="text-base text-foreground">All Consent Records</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Contact</TableHead>
                <TableHead className="text-muted-foreground">Source</TableHead>
                <TableHead className="text-muted-foreground">Scope</TableHead>
                <TableHead className="text-muted-foreground">Consented At</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Revoked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No consent records yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((r) => (
                  <TableRow key={r.id} className="border-border/50">
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.contact_id.slice(0, 8)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[9px]">{r.consent_source}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[9px]">{r.consent_scope}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.consented_at).toLocaleString()}</TableCell>
                    <TableCell>
                      {r.revocation_status === "active" ? (
                        <span className="flex items-center gap-1 text-emerald-400 text-xs">
                          <CheckCircle2 className="h-3 w-3" /> Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-400 text-xs">
                          <XCircle className="h-3 w-3" /> Revoked
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.revoked_at ? new Date(r.revoked_at).toLocaleDateString() : "—"}
                      {r.revocation_reason ? ` (${r.revocation_reason})` : ""}
                    </TableCell>
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
