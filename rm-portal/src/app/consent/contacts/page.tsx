"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Users, Upload, Trash2, Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { useApi } from "@/lib/api"
import { consentApi, type Contact, type ImportResult } from "@/lib/consent"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"

export default function ContactsPage() {
  const { data, loading, refetch } = useApi<Contact[]>(() => consentApi.getContacts(100, 0), [], 30000)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importText, setImportText] = useState("")
  const [showImport, setShowImport] = useState(false)

  const handleImport = async () => {
    if (!importText.trim()) return
    setImporting(true)
    const result = await consentApi.importContacts("csv", importText, "manual_upload.csv")
    setImporting(false)
    if (result) {
      setImportResult(result)
      setImportText("")
      setShowImport(false)
      refetch()
    }
  }

  if (loading || !data) return <LoadingState label="Loading contacts..." />

  const activeConsent = data.filter((c: any) => c.active_consent_count > 0).length

  return (
    <div className="space-y-6">
      <PageHeader title="Contacts" subtitle="Opted-in contacts with consent provenance" />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard icon={Users} value={data.length} label="Total Contacts" color="text-blue-400" />
        <StatCard icon={CheckCircle2} value={activeConsent} label="With Active Consent" color="text-emerald-400" />
        <StatCard icon={Upload} value={showImport ? "Open" : "Closed"} label="Import Dialog" color="text-amber-400" />
      </div>

      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base text-white">Contact Roster</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowImport(!showImport)}>
            <Upload className="mr-2 h-3.5 w-3.5" />
            Import CSV
          </Button>
        </CardHeader>
        <CardContent>
          {showImport && (
            <div className="mb-4 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs text-zinc-500">
                CSV format: email, name, consent_source, consent_scope, consented_at
                <br />
                consent_source: csv_import | crm_sync | signup_webhook | double_opt_in | manual_import
                <br />
                consent_scope: marketing | support | transactional | follow_up | reminders | all
              </p>
              <textarea
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-200 font-mono"
                rows={6}
                placeholder="email,name,consent_source,consent_scope,consented_at&#10;jane@example.com,Jane,double_opt_in,marketing,2026-07-01T10:00:00Z"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <Button size="sm" onClick={handleImport} disabled={importing || !importText.trim()}>
                {importing ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Importing...</> : "Import"}
              </Button>
            </div>
          )}

          {importResult && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-xs">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-emerald-400">Accepted: {importResult.accepted}</span>
              {importResult.rejected > 0 && (
                <span className="text-red-400">Rejected: {importResult.rejected}</span>
              )}
              {importResult.rejections.slice(0, 3).map((r, i) => (
                <Badge key={i} variant="outline" className="border-red-500/30 bg-red-500/10 text-red-400 text-[9px]">
                  Row {r.row}: {r.reason}
                </Badge>
              ))}
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-500">Email</TableHead>
                <TableHead className="text-zinc-500">Name</TableHead>
                <TableHead className="text-zinc-500">Consent</TableHead>
                <TableHead className="text-zinc-500">Sent</TableHead>
                <TableHead className="text-zinc-500">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-zinc-500 py-8">
                    No contacts yet. Import opted-in contacts to get started.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((c: any) => (
                  <TableRow key={c.id} className="border-zinc-800/50">
                    <TableCell className="font-medium text-white">{c.email}</TableCell>
                    <TableCell className="text-zinc-300">{c.name ?? "—"}</TableCell>
                    <TableCell>
                      {c.active_consent_count > 0 ? (
                        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[9px]">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-zinc-700 bg-zinc-800/50 text-zinc-500 text-[9px]">
                          None
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums text-zinc-400">{c.sent_count ?? 0}</TableCell>
                    <TableCell className="text-zinc-500 text-xs">{new Date(c.created_at).toLocaleDateString()}</TableCell>
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
