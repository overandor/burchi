"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Activity, Boxes, GitBranch, Network, Radio, Users } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"

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

export default function GgufP2pPage() {
  const { data: health, loading: healthLoading } = useApi<any>(
    () => api.ggufSwarmHealth(),
    [],
    15000,
  )
  const { data: peers, loading: peersLoading } = useApi<any[]>(
    () => api.ggufPeers(),
    [],
    15000,
  )
  const { data: topology, loading: topoLoading } = useApi<any>(
    () => api.ggufSwarmTopology(),
    [],
    20000,
  )
  const { data: tracker, loading: trackerLoading } = useApi<any>(
    () => api.ggufTrackerHealth(),
    [],
    15000,
  )

  if (healthLoading && peersLoading) {
    return <LoadingState label="Loading P2P swarm..." />
  }

  const h = health ?? {}
  const peerList = peers ?? []
  const topo = topology ?? {}
  const tr = tracker ?? {}
  const topoPeers: any[] = topo.peers ?? []
  const topoChunks: any[] = topo.chunks ?? []
  const connections: any[] = topo.connections ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="P2P Swarm"
        subtitle="Peer-to-peer chunk distribution and swarm topology for torrent GGUF models"
      />

      {/* Swarm health stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Users} value={h.total_peers ?? 0} label="total peers" color="text-blue-400" />
        <StatCard
          icon={Activity}
          value={h.active_peers ?? 0}
          label="active peers"
          color="text-emerald-400"
        />
        <StatCard
          icon={Boxes}
          value={h.total_chunks_available ?? 0}
          label="chunks available"
          color="text-violet-400"
        />
        <StatCard
          icon={Network}
          value={h.swarm_health ?? h.health ?? "—"}
          label="swarm health"
          color="text-amber-400"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Tracker health */}
        <Card className="border-border bg-card/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-cyan-400" />
              <CardTitle className="text-base text-foreground">Tracker Health</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {trackerLoading ? (
              <LoadingState label="Loading tracker..." />
            ) : (
              <>
                <div className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2.5">
                  <span className="text-xs text-muted-foreground">Status</span>
                  <Badge
                    variant="outline"
                    className={
                      (tr.status ?? "").toLowerCase() === "ok" ||
                      (tr.status ?? "").toLowerCase() === "healthy"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    }
                  >
                    {(tr.status ?? "unknown").toUpperCase()}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                    <span className="text-lg font-bold text-foreground tabular-nums">
                      {tr.models ?? "—"}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">tracked models</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                    <span className="text-lg font-bold text-foreground tabular-nums">
                      {tr.total_chunks ?? "—"}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">total chunks</span>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Topology summary */}
        <Card className="border-border bg-card/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-violet-400" />
              <CardTitle className="text-base text-foreground">Swarm Topology</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {topoLoading ? (
              <LoadingState label="Loading topology..." />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                    <Users className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                    <span className="text-lg font-bold text-foreground tabular-nums">
                      {topoPeers.length}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">peers</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                    <Boxes className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                    <span className="text-lg font-bold text-foreground tabular-nums">
                      {topoChunks.length}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">chunks</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                    <span className="text-lg font-bold text-foreground tabular-nums">
                      {connections.length}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">links</span>
                  </div>
                </div>
                {connections.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                      connections
                    </span>
                    {connections.slice(0, 8).map((c, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded border border-border bg-card/40 px-2.5 py-1.5 text-[11px] text-muted-foreground"
                      >
                        <span className="text-blue-400">{c.from ?? c.source}</span>
                        <span className="text-muted-foreground/60">→</span>
                        <span className="text-emerald-400">{c.to ?? c.target}</span>
                        {c.chunks != null && (
                          <span className="ml-auto text-muted-foreground/60">{c.chunks} chunks</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Peer list */}
      <Card className="border-border bg-card/50">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Peers</CardTitle>
        </CardHeader>
        <CardContent>
          {peersLoading ? (
            <LoadingState label="Loading peers..." />
          ) : peerList.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No peers connected to the swarm.</p>
          ) : (
            <div className="space-y-2">
              {peerList.map((p) => (
                <div
                  key={p.peer_id}
                  className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    <div>
                      <div className="text-xs font-medium text-foreground/90">
                        {p.peer_id?.slice(0, 16) ?? "—"}
                        {p.peer_id && p.peer_id.length > 16 ? "…" : ""}
                      </div>
                      <div className="text-[10px] text-muted-foreground/60">
                        {p.ip ?? "—"}:{p.port ?? "—"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-xs font-bold text-foreground tabular-nums">
                        {Array.isArray(p.chunks) ? p.chunks.length : p.chunks ?? 0}
                      </div>
                      <div className="text-[9px] text-muted-foreground/60">chunks</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">{timeAgo(p.last_seen)}</div>
                      <div className="text-[9px] text-muted-foreground/60">last seen</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
