"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Users, DollarSign, Key, Plus, Activity, TrendingUp } from "lucide-react"
import { api, useApi } from "@/lib/api"
import { PageHeader, StatCard, SectionCard, LoadingState, statusBadgeClass } from "@/components/ui-helpers"

export default function TenantsPage() {
  const { data: tenants, loading } = useApi<any[]>(() => api.listTenants(), [], 30000)
  const { data: billing, loading: billingLoading } = useApi<any>(() => api.billingOverview(), [], 30000)
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null)
  const [tenantUsage, setTenantUsage] = useState<any>(null)
  const [apiKeys, setApiKeys] = useState<any[]>([])
  const [newKey, setNewKey] = useState<any>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newTenantName, setNewTenantName] = useState("")
  const [newTenantSlug, setNewTenantSlug] = useState("")
  const [newTenantPlan, setNewTenantPlan] = useState("free")

  async function selectTenant(tid: string) {
    setSelectedTenant(tid)
    const [usage, keys] = await Promise.all([
      api.getTenantUsage(tid),
      api.listApiKeys(tid),
    ])
    setTenantUsage(usage)
    setApiKeys(keys || [])
  }

  async function handleCreateTenant() {
    if (!newTenantName || !newTenantSlug) return
    const result = await api.createTenant(newTenantName, newTenantSlug, newTenantPlan)
    if (result) {
      setShowCreateForm(false)
      setNewTenantName("")
      setNewTenantSlug("")
      setNewTenantPlan("free")
      window.location.reload()
    }
  }

  async function handleCreateApiKey() {
    if (!selectedTenant) return
    const result = await api.createApiKey(selectedTenant, "New API Key")
    if (result) {
      setNewKey(result)
      const keys = await api.listApiKeys(selectedTenant)
      setApiKeys(keys || [])
    }
  }

  if (loading) return <LoadingState label="Loading tenants..." />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenants & Billing"
        subtitle="Multi-tenant architecture with per-tenant data isolation, usage tracking, and API key management"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          icon={Users}
          value={billing?.total_tenants ?? tenants?.length ?? 0}
          label="Total Tenants"
          color="text-blue-400"
        />
        <StatCard
          icon={Users}
          value={billing?.active_tenants ?? 0}
          label="Active Tenants"
          color="text-emerald-400"
        />
        <StatCard
          icon={Activity}
          value={billing?.total_inference_used ?? 0}
          label="Total Inference Calls"
          color="text-purple-400"
        />
        <StatCard
          icon={TrendingUp}
          value={billing?.total_inference_quota ?? 0}
          label="Total Quota"
          color="text-amber-400"
        />
      </div>

      {/* Tenant List */}
      <SectionCard title="Tenants">
        <div className="mb-3">
          <Button onClick={() => setShowCreateForm(!showCreateForm)} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Create Tenant
          </Button>
        </div>

        {showCreateForm && (
          <div className="mb-4 grid grid-cols-3 gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <input
                value={newTenantName}
                onChange={(e) => setNewTenantName(e.target.value)}
                placeholder="Acme Corp"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Slug</label>
              <input
                value={newTenantSlug}
                onChange={(e) => setNewTenantSlug(e.target.value)}
                placeholder="acme"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Plan</label>
              <select
                value={newTenantPlan}
                onChange={(e) => setNewTenantPlan(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div className="col-span-3">
              <Button onClick={handleCreateTenant} disabled={!newTenantName || !newTenantSlug} size="sm">
                Create
              </Button>
            </div>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Name</TableHead>
              <TableHead className="text-muted-foreground">Slug</TableHead>
              <TableHead className="text-muted-foreground">Plan</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground">Usage</TableHead>
              <TableHead className="text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(tenants || []).map((t: any) => {
              const billingInfo = billing?.tenants?.find((b: any) => b.tenant_id === t.id)
              return (
                <TableRow key={t.id} className="border-border">
                  <TableCell className="font-medium text-foreground">{t.name}</TableCell>
                  <TableCell className="text-muted-foreground">{t.slug}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">{t.plan}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className={statusBadgeClass(t.status)}>{t.status}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {billingInfo ? `${billingInfo.inference_used}/${billingInfo.inference_quota} (${billingInfo.usage_percentage}%)` : `${t.inference_used}/${t.inference_quota}`}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => selectTenant(t.id)}>
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </SectionCard>

      {/* Selected Tenant Details */}
      {selectedTenant && tenantUsage && (
        <SectionCard title={`Tenant Details: ${tenantUsage.tenant_name}`}>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Plan</div>
              <div className="text-lg font-semibold text-foreground">{tenantUsage.plan}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Inference Used</div>
              <div className="text-lg font-semibold text-foreground">{tenantUsage.inference_used}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Quota</div>
              <div className="text-lg font-semibold text-foreground">{tenantUsage.inference_quota}</div>
            </div>
          </div>

          {/* Usage by Type */}
          {tenantUsage.usage_by_type && Object.keys(tenantUsage.usage_by_type).length > 0 && (
            <div className="mb-4">
              <div className="text-sm font-medium mb-2">Usage by Resource Type</div>
              {Object.entries(tenantUsage.usage_by_type).map(([type, data]: [string, any]) => (
                <div key={type} className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2 text-sm mb-1">
                  <span className="text-foreground">{type}</span>
                  <span className="text-muted-foreground">{data.amount} calls | ${(data.cost_cents / 100).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}

          {/* API Keys */}
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">API Keys</div>
              <Button onClick={handleCreateApiKey} size="sm" variant="outline">
                <Key className="mr-2 h-3 w-3" />
                Create Key
              </Button>
            </div>

            {newKey && (
              <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="text-xs text-emerald-400 mb-1">New API Key (save this — it won't be shown again)</div>
                <code className="text-sm text-foreground break-all">{newKey.key}</code>
              </div>
            )}

            {apiKeys.length > 0 ? (
              <div className="space-y-1">
                {apiKeys.map((k: any) => (
                  <div key={k.id} className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground">{k.label || "Unlabeled"}</span>
                      <Badge variant="outline" className="text-xs">{k.status}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {k.last_used ? `Last used: ${new Date(k.last_used).toLocaleDateString()}` : "Never used"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-2">No API keys created yet.</div>
            )}
          </div>
        </SectionCard>
      )}
    </div>
  )
}
