"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Mail, CheckCircle2, XCircle, Send, Loader2, AlertCircle } from "lucide-react"
import { useApi } from "@/lib/api"
import { consentApi, type Message, type MessageStatus } from "@/lib/consent"
import { LoadingState, PageHeader, StatCard, statusBadgeClass } from "@/components/ui-helpers"

export default function MessagesPage() {
  const { data, loading, refetch } = useApi<Message[]>(() => consentApi.getMessages(), [], 15000)
  const [filter, setFilter] = useState<MessageStatus | "all">("all")
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionResult, setActionResult] = useState<string | null>(null)

  const handleApprove = async (id: string) => {
    setActionLoading(id)
    const result = await consentApi.approveMessage(id, "operator")
    setActionLoading(null)
    setActionResult(result ? "Approved" : "Failed to approve")
    setTimeout(() => setActionResult(null), 3000)
    refetch()
  }

  const handleReject = async (id: string) => {
    setActionLoading(id)
    const result = await consentApi.rejectMessage(id, "Not suitable")
    setActionLoading(null)
    setActionResult(result ? "Rejected" : "Failed to reject")
    setTimeout(() => setActionResult(null), 3000)
    refetch()
  }

  const handleSend = async (id: string) => {
    setActionLoading(id)
    const result = await consentApi.sendMessage(id)
    setActionLoading(null)
    setActionResult(result?.ok ? "Sent" : `Send failed: ${result?.error || "unknown"}`)
    setTimeout(() => setActionResult(null), 5000)
    refetch()
  }

  if (loading || !data) return <LoadingState label="Loading messages..." />

  const filtered = filter === "all" ? data : data.filter((m) => m.status === filter)
  const pending = data.filter((m) => m.status === "pending_approval" || m.status === "draft").length
  const approved = data.filter((m) => m.status === "approved").length
  const sent = data.filter((m) => m.status === "sent").length

  const filters: Array<{ label: string; value: MessageStatus | "all" }> = [
    { label: "All", value: "all" },
    { label: "Drafts", value: "draft" },
    { label: "Pending", value: "pending_approval" },
    { label: "Approved", value: "approved" },
    { label: "Sent", value: "sent" },
    { label: "Suppressed", value: "suppressed" },
  ]

  return (
    <div className="space-y-6">
      <PageHeader title="Messages" subtitle="Drafts, approvals, and sent — with eligibility and suppression enforcement" />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Mail} value={data.length} label="Total Messages" color="text-blue-400" />
        <StatCard icon={AlertCircle} value={pending} label="Pending Approval" color="text-amber-400" />
        <StatCard icon={CheckCircle2} value={approved} label="Approved" color="text-emerald-400" />
        <StatCard icon={Send} value={sent} label="Sent" color="text-cyan-400" />
      </div>

      {actionResult && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-xs text-foreground/80">
          {actionResult.startsWith("Sent") || actionResult.startsWith("Approved") || actionResult.startsWith("Rejected")
            ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            : <XCircle className="h-3.5 w-3.5 text-red-400" />}
          {actionResult}
        </div>
      )}

      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base text-foreground">Message Queue</CardTitle>
          <div className="flex gap-1">
            {filters.map((f) => (
              <Button
                key={f.value}
                size="xs"
                variant={filter === f.value ? "default" : "outline"}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Recipient</TableHead>
                <TableHead className="text-muted-foreground">Subject</TableHead>
                <TableHead className="text-muted-foreground">Type</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No messages in this filter.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((m) => (
                  <TableRow key={m.id} className="border-border/50">
                    <TableCell className="text-xs">
                      <div className="text-foreground">{m.contact_email ?? "—"}</div>
                      <div className="text-muted-foreground">{m.contact_name ?? ""}</div>
                    </TableCell>
                    <TableCell className="text-sm text-foreground/80 max-w-xs truncate">{m.subject ?? "(no subject)"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[9px]">{m.message_type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[9px] ${statusBadgeClass(m.status)}`}>
                        {m.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {(m.status === "draft" || m.status === "pending_approval") && (
                          <Button
                            size="xs"
                            variant="outline"
                            className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                            onClick={() => handleApprove(m.id)}
                            disabled={actionLoading === m.id}
                          >
                            {actionLoading === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Approve"}
                          </Button>
                        )}
                        {(m.status === "draft" || m.status === "pending_approval") && (
                          <Button
                            size="xs"
                            variant="outline"
                            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                            onClick={() => handleReject(m.id)}
                            disabled={actionLoading === m.id}
                          >
                            Reject
                          </Button>
                        )}
                        {m.status === "approved" && (
                          <Button
                            size="xs"
                            className="bg-cyan-600 hover:bg-cyan-700 text-foreground"
                            onClick={() => handleSend(m.id)}
                            disabled={actionLoading === m.id}
                          >
                            {actionLoading === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Send className="mr-1 h-3 w-3" /> Send</>}
                          </Button>
                        )}
                        {m.status === "suppressed" && (
                          <span className="text-[10px] text-red-400">Blocked: not eligible</span>
                        )}
                      </div>
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
