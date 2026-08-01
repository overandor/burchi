"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DollarSign, Network, Activity, Trophy, Plus, Server, Zap } from "lucide-react"
import { api, useApi } from "@/lib/api"
import { PageHeader, StatCard, SectionCard, LoadingState } from "@/components/ui-helpers"

export default function MarketplacePage() {
  const { data: overview, loading } = useApi<any>(() => api.marketplaceOverview(), [], 30000)
  const [showRegisterForm, setShowRegisterForm] = useState(false)
  const [regResult, setRegResult] = useState<any>(null)
  const [registering, setRegistering] = useState(false)

  // Registration form state
  const [nodeId, setNodeId] = useState("")
  const [nodeName, setNodeName] = useState("")
  const [inferenceUrl, setInferenceUrl] = useState("")
  const [region, setRegion] = useState("us-east")
  const [pricing, setPricing] = useState("0.001")
  const [models, setModels] = useState("qwen2-0.5b-q3k")

  async function handleRegister() {
    setRegistering(true)
    const result = await api.marketplaceRegister({
      node_id: nodeId,
      name: nodeName,
      inference_url: inferenceUrl,
      models: models.split(",").map((m) => m.trim()),
      region,
      pricing_per_1k_tokens: parseFloat(pricing),
    })
    setRegResult(result)
    setRegistering(false)
    if (result) {
      setShowRegisterForm(false)
      window.location.reload()
    }
  }

  if (loading) return <LoadingState label="Loading marketplace..." />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inference Node Marketplace"
        subtitle="Open P2P inference marketplace — third-party operators register nodes, serve inference, and earn credits based on reputation"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          icon={Network}
          value={overview?.total_nodes ?? 0}
          label="Total Nodes"
          color="text-blue-400"
        />
        <StatCard
          icon={Network}
          value={overview?.third_party_nodes ?? 0}
          label="Third-Party Operators"
          color="text-purple-400"
        />
        <StatCard
          icon={Activity}
          value={overview?.total_requests ?? 0}
          label="Total Inference Requests"
          color="text-emerald-400"
        />
        <StatCard
          icon={DollarSign}
          value={overview?.total_credits_earned ?? 0}
          label="Credits Earned"
          color="text-amber-400"
        />
      </div>

      {/* Registration */}
      <SectionCard title="Register as Node Operator">
        <div className="mb-3">
          <Button onClick={() => setShowRegisterForm(!showRegisterForm)} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Register New Node
          </Button>
        </div>

        {showRegisterForm && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Node ID</label>
              <input
                value={nodeId}
                onChange={(e) => setNodeId(e.target.value)}
                placeholder="operator-node-1"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Node Name</label>
              <input
                value={nodeName}
                onChange={(e) => setNodeName(e.target.value)}
                placeholder="My Inference Node"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Inference URL</label>
              <input
                value={inferenceUrl}
                onChange={(e) => setInferenceUrl(e.target.value)}
                placeholder="https://my-node.vercel.app"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Region</label>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="us-east">US East</option>
                <option value="us-west">US West</option>
                <option value="eu-west">EU West</option>
                <option value="asia-pacific">Asia Pacific</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Models (comma-separated)</label>
              <input
                value={models}
                onChange={(e) => setModels(e.target.value)}
                placeholder="qwen2-0.5b-q3k"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Pricing per 1K tokens ($)</label>
              <input
                value={pricing}
                onChange={(e) => setPricing(e.target.value)}
                placeholder="0.001"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div className="col-span-2">
              <Button onClick={handleRegister} disabled={registering || !nodeId || !nodeName || !inferenceUrl} size="sm">
                {registering ? "Registering..." : "Register Node"}
              </Button>
            </div>
          </div>
        )}

        {regResult && (
          <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="text-sm text-emerald-400">Node registered successfully!</div>
            <pre className="text-xs text-muted-foreground mt-2 overflow-auto">
              {JSON.stringify(regResult, null, 2)}
            </pre>
          </div>
        )}
      </SectionCard>

      {/* Node List */}
      <SectionCard title="Registered Nodes">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Node ID</TableHead>
              <TableHead className="text-muted-foreground">Name</TableHead>
              <TableHead className="text-muted-foreground">Type</TableHead>
              <TableHead className="text-muted-foreground">Region</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground">Models</TableHead>
              <TableHead className="text-muted-foreground">Pricing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(overview?.nodes || []).map((n: any) => (
              <TableRow key={n.node_id} className="border-border">
                <TableCell className="font-mono text-xs text-foreground">{n.node_id}</TableCell>
                <TableCell className="text-foreground">{n.name}</TableCell>
                <TableCell>
                  <Badge variant={n.operator_type === "third_party" ? "default" : "secondary"} className="text-xs">
                    {n.operator_type === "third_party" ? "3rd Party" : "1st Party"}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{n.region}</TableCell>
                <TableCell>
                  <span className={n.status === "active" ? "text-emerald-400" : "text-muted-foreground"}>
                    {n.status}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {(n.models || []).join(", ") || "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {n.pricing > 0 ? `$${n.pricing}/1K` : "Free"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>

      {/* Reputation Leaderboard */}
      <SectionCard title="Reputation Leaderboard">
        {overview?.reputation_leaderboard && overview.reputation_leaderboard.length > 0 ? (
          <div className="space-y-2">
            {overview.reputation_leaderboard.map((r: any, i: number) => (
              <div key={r.node_id} className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    i === 0 ? "bg-amber-500/20 text-amber-400" :
                    i === 1 ? "bg-slate-400/20 text-slate-300" :
                    i === 2 ? "bg-orange-700/20 text-orange-600" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {i + 1}
                  </div>
                  <span className="font-mono text-xs text-foreground">{r.node_id}</span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-muted-foreground">
                    {r.successful_requests}/{r.total_requests} successful
                  </span>
                  <span className="text-muted-foreground">
                    {r.avg_latency_ms.toFixed(0)}ms avg
                  </span>
                  <span className="font-medium text-foreground">
                    Score: {(r.reputation_score * 100).toFixed(1)}%
                  </span>
                  <span className="text-amber-400">
                    {r.credits_earned.toFixed(2)} credits
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground py-4">
            No reputation data yet. Inference requests will build reputation over time.
          </div>
        )}
      </SectionCard>

      {/* Marketplace Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-border bg-card/50">
          <CardHeader>
            <CardTitle className="text-base text-foreground">Success Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {overview?.success_rate ? `${(overview.success_rate * 100).toFixed(1)}%` : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {overview?.total_successful ?? 0} successful out of {overview?.total_requests ?? 0} total
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card/50">
          <CardHeader>
            <CardTitle className="text-base text-foreground">Average Reputation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {overview?.avg_reputation ? `${(overview.avg_reputation * 100).toFixed(1)}%` : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Across {overview?.total_nodes ?? 0} nodes
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
