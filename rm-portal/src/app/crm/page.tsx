"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Zap, RefreshCw, Plus, Building2 } from "lucide-react"
import { api, useApi } from "@/lib/api"
import { PageHeader, StatCard, SectionCard, LoadingState, statusBadgeClass } from "@/components/ui-helpers"

export default function CRMPage() {
  const { data: connections, loading } = useApi<any[]>(() => api.crmListConnections(), [], 30000)
  const [syncing, setSyncing] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [crmType, setCrmType] = useState("hubspot")
  const [crmName, setCrmName] = useState("")
  const [apiKey, setApiKey] = useState("")

  async function handleSyncAll() {
    setSyncing(true)
    await api.crmSyncAll()
    setSyncing(false)
    window.location.reload()
  }

  async function handleAdd() {
    await api.crmAddConnection({ crm_type: crmType, name: crmName || crmType, api_key: apiKey })
    setShowAdd(false)
    setCrmName("")
    setApiKey("")
    window.location.reload()
  }

  if (loading) return <LoadingState label="Loading CRM connections..." />

  return (
    <div className="space-y-6">
      <PageHeader
        title="CRM Integration"
        subtitle="Sync consent-verified contacts to HubSpot, Salesforce, and Pipedrive"
      />

      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={Building2} value={connections?.length ?? 0} label="CRM Connections" color="text-blue-400" />
        <StatCard icon={Zap} value={connections?.reduce((sum: number, c: any) => sum + c.total_synced, 0) ?? 0} label="Total Synced" color="text-emerald-400" />
        <StatCard icon={RefreshCw} value={connections?.filter((c: any) => c.sync_enabled === "true").length ?? 0} label="Auto-Sync Enabled" color="text-purple-400" />
      </div>

      <SectionCard title="CRM Connections">
        <div className="flex gap-3 mb-4">
          <Button onClick={handleSyncAll} disabled={syncing} size="sm">
            {syncing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            Sync All
          </Button>
          <Button onClick={() => setShowAdd(!showAdd)} variant="outline" size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Add CRM
          </Button>
        </div>

        {showAdd && (
          <div className="mb-4 grid grid-cols-3 gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">CRM Type</label>
              <select value={crmType} onChange={(e) => setCrmType(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
                <option value="hubspot">HubSpot</option>
                <option value="salesforce">Salesforce</option>
                <option value="pipedrive">Pipedrive</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <input value={crmName} onChange={(e) => setCrmName(e.target.value)} placeholder="My HubSpot"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">API Key</label>
              <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder="••••••••"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <Button onClick={handleAdd} size="sm" className="col-span-3">Add Connection</Button>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Name</TableHead>
              <TableHead className="text-muted-foreground">Type</TableHead>
              <TableHead className="text-muted-foreground">Sync Enabled</TableHead>
              <TableHead className="text-muted-foreground">Total Synced</TableHead>
              <TableHead className="text-muted-foreground">Last Sync</TableHead>
              <TableHead className="text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(connections || []).map((c: any) => (
              <TableRow key={c.id} className="border-border">
                <TableCell className="font-medium text-foreground">{c.name}</TableCell>
                <TableCell className="text-muted-foreground capitalize">{c.crm_type}</TableCell>
                <TableCell><span className={statusBadgeClass(c.sync_enabled)}>{c.sync_enabled}</span></TableCell>
                <TableCell className="text-muted-foreground">{c.total_synced}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{c.last_sync ? new Date(c.last_sync).toLocaleString() : "Never"}</TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={async () => { await api.crmSync(c.id); window.location.reload() }}>
                    Sync
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
    </div>
  )
}
