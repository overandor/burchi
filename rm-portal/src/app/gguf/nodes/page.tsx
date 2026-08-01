"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Activity, Globe, Server, ServerCog } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader, statusBadgeClass } from "@/components/ui-helpers"

function timeAgo(ts: string | number | undefined): string {
  if (!ts) return "—"
  const d = new Date(ts).getTime()
  if (Number.isNaN(d)) return "—"
  const sec = Math.floor((Date.now() - d) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

function statusClass(status: string): string {
  const s = (status || "").toLowerCase()
  if (s === "online" || s === "active" || s === "healthy") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
  }
  if (s === "idle" || s === "standby") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-400"
  }
  if (s === "offline" || s === "down" || s === "error") {
    return "border-red-500/30 bg-red-500/10 text-red-400"
  }
  return statusBadgeClass(s) || "border-border/80 bg-accent/30 text-muted-foreground"
}

export default function GgufNodesPage() {
  const { data, loading } = useApi<any[]>(() => api.ggufNodes(), [], 15000)
  const [showRegister, setShowRegister] = useState(false)

  if (loading) return <LoadingState label="Loading inference nodes..." />

  const nodes = data ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader
          title="Inference Nodes"
          subtitle="Nodes participating in the torrent GGUF inference network"
        />
        <Button variant="outline" onClick={() => setShowRegister((s) => !s)}>
          <ServerCog className="mr-2 h-4 w-4" />
          Register Node
        </Button>
      </div>

      {showRegister && (
        <Card className="border-border bg-card/50">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Node registration is a placeholder. Start a node process pointing at a tracker to join
            the swarm.
          </CardContent>
        </Card>
      )}

      {nodes.length === 0 ? (
        <Card className="border-border bg-card/50">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No nodes have joined the network yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {nodes.map((n) => (
            <Card key={n.node_id} className="border-border bg-card/50">
              <CardHeader className="flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-blue-400" />
                  <CardTitle className="text-sm text-foreground">{n.name ?? n.node_id}</CardTitle>
                </div>
                <Badge variant="outline" className={statusClass(n.status)}>
                  {(n.status ?? "unknown").toUpperCase()}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                    <span className="text-sm font-bold text-foreground">{n.region ?? "—"}</span>
                    <span className="text-[9px] text-muted-foreground/60">region</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                    <Activity className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                    <span className="text-sm font-bold text-foreground">
                      {timeAgo(n.last_heartbeat)}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">heartbeat</span>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="text-muted-foreground/60">inference:</span>
                    <span className="truncate text-foreground/80">{n.inference_url ?? "—"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="text-muted-foreground/60">tracker:</span>
                    <span className="truncate text-foreground/80">{n.tracker_url ?? "—"}</span>
                  </div>
                </div>

                <div className="border-t border-border pt-3">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                    capabilities
                  </span>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(n.capabilities ?? []).length === 0 ? (
                      <span className="text-xs text-muted-foreground/60">none</span>
                    ) : (
                      (n.capabilities as string[]).map((c) => (
                        <Badge
                          key={c}
                          variant="outline"
                          className="border-border/80 bg-accent/30 text-[10px] text-foreground/80"
                        >
                          {c}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>

                <div className="border-t border-border pt-3">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                    hosted models
                  </span>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(n.models ?? []).length === 0 ? (
                      <span className="text-xs text-muted-foreground/60">none</span>
                    ) : (
                      (n.models as string[]).map((mid) => (
                        <Badge
                          key={mid}
                          variant="outline"
                          className="border-blue-500/30 bg-blue-500/10 text-[10px] text-blue-400"
                        >
                          {mid}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
