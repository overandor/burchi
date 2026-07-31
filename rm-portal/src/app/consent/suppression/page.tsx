"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Ban, Plus, Trash2, Loader2 } from "lucide-react"
import { useApi } from "@/lib/api"
import { consentApi, type SuppressionEntry, type SuppressionReason } from "@/lib/consent"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"

export default function SuppressionPage() {
  const { data, loading, refetch } = useApi<SuppressionEntry[]>(() => consentApi.getSuppression(), [], 30000)
  const [showAdd, setShowAdd] = useState(false)
  const [email, setEmail] = useState("")
  const [reason, setReason] = useState<SuppressionReason>("unsubscribe")
  const [adding, setAdding] = useState(false)

  const handleAdd = async () => {
    if (!email.trim()) return
    setAdding(true)
    await consentApi.addSuppression(email, reason)
    setAdding(false)
    setEmail("")
    setShowAdd(false)
    refetch()
  }

  const handleRemove = async (id: string) => {
    await consentApi.removeSuppression(id)
    refetch()
  }

  if (loading || !data) return <LoadingState label="Loading suppression list..." />

  return (
    <div className="space-y-6">
      <PageHeader title="Suppression List" subtitle="Unsubscribes, bounces, and complaints — enforced at send boundary" />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Ban} value={data.length} label="Total Suppressed" color="text-red-400" />
        <StatCard icon={Ban} value={data.filter((d) => d.reason === "unsubscribe").length} label="Unsubscribes" color="text-orange-400" />
        <StatCard icon={Ban} value={data.filter((d) => d.reason === "bounce").length} label="Bounces" color="text-amber-400" />
        <StatCard icon={Ban} value={data.filter((d) => d.reason === "complaint").length} label="Complaints" color="text-red-400" />
      </div>

      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base text-white">Suppressed Emails</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
            <Plus className="mr-2 h-3.5 w-3.5" /> Add
          </Button>
        </CardHeader>
        <CardContent>
          {showAdd && (
            <div className="mb-4 flex gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <input
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-white"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <select
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-white"
                value={reason}
                onChange={(e) => setReason(e.target.value as SuppressionReason)}
              >
                <option value="unsubscribe">unsubscribe</option>
                <option value="bounce">bounce</option>
                <option value="complaint">complaint</option>
                <option value="manual">manual</option>
                <option value="expired_consent">expired_consent</option>
              </select>
              <Button size="sm" onClick={handleAdd} disabled={adding || !email.trim()}>
                {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
              </Button>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-500">Email</TableHead>
                <TableHead className="text-zinc-500">Reason</TableHead>
                <TableHead className="text-zinc-500">Channel</TableHead>
                <TableHead className="text-zinc-500">Added</TableHead>
                <TableHead className="text-zinc-500"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-zinc-500 py-8">
                    No suppressed emails.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((s) => (
                  <TableRow key={s.id} className="border-zinc-800/50">
                    <TableCell className="font-medium text-white">{s.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-400 text-[9px]">
                        {s.reason}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-zinc-400 text-xs">{s.channel}</TableCell>
                    <TableCell className="text-zinc-500 text-xs">{new Date(s.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Button size="xs" variant="ghost" onClick={() => handleRemove(s.id)}>
                        <Trash2 className="h-3 w-3 text-zinc-500" />
                      </Button>
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
