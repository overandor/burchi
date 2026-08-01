"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Rocket, Server, RotateCcw, Zap } from "lucide-react"
import { api, useApi } from "@/lib/api"
import { PageHeader, StatCard, SectionCard, LoadingState, statusBadgeClass } from "@/components/ui-helpers"

export default function DeploymentsPage() {
  const { data: deployments, loading } = useApi<any[]>(() => api.listDeployments(), [], 30000)
  const [deploying, setDeploying] = useState(false)
  const [showDeploy, setShowDeploy] = useState(false)
  const [modelId, setModelId] = useState("Qwen/Qwen2.5-0.5B-Instruct")
  const [modelName, setModelName] = useState("")
  const [autoScale, setAutoScale] = useState(false)

  async function handleDeploy() {
    setDeploying(true)
    await api.deployModel({ model_id: modelId, model_name: modelName, auto_scale: autoScale })
    setDeploying(false)
    setShowDeploy(false)
    window.location.reload()
  }

  if (loading) return <LoadingState label="Loading deployments..." />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deployment Pipeline"
        subtitle="One-click GPU deploy: compile model → provision → deploy endpoint → register in load balancer"
      />

      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={Rocket} value={deployments?.length ?? 0} label="Total Deployments" color="text-blue-400" />
        <StatCard icon={Server} value={deployments?.filter((d: any) => d.status === "deployed").length ?? 0} label="Active" color="text-emerald-400" />
        <StatCard icon={RotateCcw} value={deployments?.filter((d: any) => d.status === "rolled_back").length ?? 0} label="Rolled Back" color="text-amber-400" />
      </div>

      <SectionCard title="Deploy New Model">
        <Button onClick={() => setShowDeploy(!showDeploy)} size="sm">
          <Rocket className="mr-2 h-4 w-4" />
          One-Click Deploy
        </Button>

        {showDeploy && (
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Model ID</label>
              <input value={modelId} onChange={(e) => setModelId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Model Name (optional)</label>
              <input value={modelName} onChange={(e) => setModelName(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <input type="checkbox" checked={autoScale} onChange={(e) => setAutoScale(e.target.checked)} id="autoscale" />
              <label htmlFor="autoscale" className="text-sm">Enable auto-scaling</label>
            </div>
            <Button onClick={handleDeploy} disabled={deploying || !modelId} size="sm" className="col-span-2">
              {deploying ? <Zap className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
              Deploy
            </Button>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Deployments">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Model</TableHead>
              <TableHead className="text-muted-foreground">Runtime</TableHead>
              <TableHead className="text-muted-foreground">Version</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground">Endpoint</TableHead>
              <TableHead className="text-muted-foreground">Replicas</TableHead>
              <TableHead className="text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(deployments || []).map((d: any) => (
              <TableRow key={d.id} className="border-border">
                <TableCell className="font-medium text-foreground">{d.model_name}</TableCell>
                <TableCell className="text-muted-foreground">{d.runtime}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{d.version}</Badge></TableCell>
                <TableCell><span className={statusBadgeClass(d.status)}>{d.status}</span></TableCell>
                <TableCell className="text-xs text-blue-400">{d.endpoint_url || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{d.replicas}</TableCell>
                <TableCell>
                  {d.status === "deployed" && (
                    <Button size="sm" variant="ghost" onClick={async () => { await api.rollbackDeployment(d.id); window.location.reload() }}>
                      Rollback
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
    </div>
  )
}
