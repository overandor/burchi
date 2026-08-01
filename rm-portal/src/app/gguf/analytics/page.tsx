"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { BarChart3, Boxes, Cpu, Download, Gauge, HardDrive, Server, Zap } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"

function formatSize(mb: number): string {
  if (!mb && mb !== 0) return "—"
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}

export default function GgufAnalyticsPage() {
  const { data, loading } = useApi<any>(() => api.ggufAnalytics(), [], 20000)

  if (loading) return <LoadingState label="Loading analytics..." />

  const a = data ?? {}
  const events: any[] = a.events ?? []
  const topModels: any[] = a.top_models ?? []
  const nodeUptime: any[] = a.node_uptime ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Network Analytics"
        subtitle="Aggregate telemetry across the torrent GGUF inference network"
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={Download} value={a.total_downloads ?? 0} label="total downloads" color="text-blue-400" />
        <StatCard icon={Zap} value={a.total_inferences ?? 0} label="total inferences" color="text-emerald-400" />
        <StatCard icon={Server} value={a.active_nodes ?? 0} label="active nodes" color="text-violet-400" />
        <StatCard icon={Cpu} value={a.total_models ?? 0} label="total models" color="text-amber-400" />
        <StatCard icon={Boxes} value={a.total_chunks ?? 0} label="total chunks" color="text-cyan-400" />
        <StatCard icon={HardDrive} value={formatSize(a.total_size_mb)} label="total size" color="text-pink-400" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top models */}
        <Card className="border-border bg-card/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-400" />
              <CardTitle className="text-base text-foreground">Top Models</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {topModels.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No model usage data yet.</p>
            ) : (
              <div className="space-y-3">
                {topModels.map((m, i) => {
                  const maxCount = Math.max(...topModels.map((x) => x.inferences ?? x.count ?? 0), 1)
                  const count = m.inferences ?? m.count ?? 0
                  const pct = (count / maxCount) * 100
                  return (
                    <div key={m.model_id ?? i} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground/60 tabular-nums">#{i + 1}</span>
                          <span className="font-medium text-foreground/90">
                            {m.name ?? m.model_id}
                          </span>
                        </div>
                        <span className="text-muted-foreground tabular-nums">{count}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent">
                        <div
                          className="h-full rounded-full bg-blue-500/60"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent events */}
        <Card className="border-border bg-card/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-emerald-400" />
              <CardTitle className="text-base text-foreground">Recent Events</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No events recorded.</p>
            ) : (
              <div className="space-y-2">
                {events.slice(0, 12).map((ev, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="border-border/80 bg-accent/30 text-[10px] text-foreground/80"
                      >
                        {ev.type ?? ev.event ?? "event"}
                      </Badge>
                      <span className="text-muted-foreground">{ev.message ?? ev.detail ?? ""}</span>
                    </div>
                    <span className="text-muted-foreground/60">{ev.timestamp ?? ev.time ?? ""}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Node uptime */}
      {nodeUptime.length > 0 && (
        <Card className="border-border bg-card/50">
          <CardHeader>
            <CardTitle className="text-base text-foreground">Node Uptime</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {nodeUptime.map((n) => {
                const uptime = n.uptime_pct ?? n.uptime ?? 0
                return (
                  <div
                    key={n.node_id ?? n.name}
                    className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2.5"
                  >
                    <span className="text-xs font-medium text-foreground/90">
                      {n.name ?? n.node_id}
                    </span>
                    <span
                      className={`text-sm font-bold tabular-nums ${
                        uptime >= 95
                          ? "text-emerald-400"
                          : uptime >= 80
                            ? "text-amber-400"
                            : "text-red-400"
                      }`}
                    >
                      {typeof uptime === "number" ? `${uptime.toFixed(1)}%` : "—"}
                    </span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
