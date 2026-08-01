"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Activity, AlertCircle, AlertTriangle, Info, Radio } from "lucide-react"
import { useApi, api, type LiveEvent } from "@/lib/api"
import { LoadingState, PageHeader } from "@/components/ui-helpers"
import { useState } from "react"

const severityConfig: Record<string, { color: string; badge: string; icon: typeof Info }> = {
  info: { color: "text-blue-400", badge: "border-blue-500/30 bg-blue-500/10 text-blue-400", icon: Info },
  warning: { color: "text-amber-400", badge: "border-amber-500/30 bg-amber-500/10 text-amber-400", icon: AlertCircle },
  error: { color: "text-red-400", badge: "border-red-500/30 bg-red-500/10 text-red-400", icon: AlertTriangle },
}

export default function EventsPage() {
  const { data: events, loading } = useApi<LiveEvent[]>(() => api.getEvents(100), [], 5000)
  const [filter, setFilter] = useState<string>("all")

  const filteredEvents = events?.filter((e) => filter === "all" || e.severity === filter) ?? []

  const counts = {
    info: events?.filter((e) => e.severity === "info").length ?? 0,
    warning: events?.filter((e) => e.severity === "warning").length ?? 0,
    error: events?.filter((e) => e.severity === "error").length ?? 0,
  }

  if (loading && !events) return <LoadingState label="Loading live events..." />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Live Event Stream" subtitle="Real-time system events — polling every 5 seconds" />
        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
          <span className="mr-1.5 h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          LIVE
        </Badge>
      </div>

      {/* Event counts by severity */}
      <div className="grid grid-cols-3 gap-4">
        {(["info", "warning", "error"] as const).map((sev) => {
          const cfg = severityConfig[sev]
          const Icon = cfg.icon
          return (
            <button
              key={sev}
              onClick={() => setFilter(filter === sev ? "all" : sev)}
              className={`flex items-center gap-3 rounded-lg border p-4 transition-all ${
                filter === sev
                  ? `${cfg.badge} ring-1 ring-offset-2 ring-offset-sidebar`
                  : "border-border bg-card/50 hover:bg-card/70"
              }`}
              style={filter === sev ? { boxShadow: "0 0 0 1px currentColor" } : {}}
            >
              <Icon className={`h-6 w-6 ${filter === sev ? "" : cfg.color}`} />
              <div className="text-left">
                <div className={`text-2xl font-bold tabular-nums ${filter === sev ? "" : "text-foreground"}`}>
                  {counts[sev]}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{sev}</div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Event Stream */}
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Radio className="h-5 w-5 text-blue-400" />
          <CardTitle className="text-base text-foreground">Event Stream</CardTitle>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {filteredEvents.length} events{filter !== "all" && ` (filtered: ${filter})`}
          </span>
        </CardHeader>
        <CardContent>
          {filteredEvents.length === 0 ? (
            <LoadingState label="No events to display" />
          ) : (
            <ScrollArea className="h-[600px] rounded-lg border border-border/50">
              <div className="space-y-0.5 p-1">
                {filteredEvents.map((event, idx) => {
                  const cfg = severityConfig[event.severity] || severityConfig.info
                  const Icon = cfg.icon
                  return (
                    <div key={event.id}>
                      <div className="flex items-start gap-3 rounded-lg border border-border/50 bg-card/30 px-3 py-2.5 transition-colors hover:bg-accent/50">
                        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${cfg.color}`} />
                        <span className="mt-0.5 shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
                          {new Date(event.timestamp).toLocaleTimeString("en-US", { hour12: false })}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-muted-foreground">{event.event_type}</span>
                            <Badge variant="outline" className={`text-[8px] ${cfg.badge}`}>
                              {event.severity.toUpperCase()}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-foreground/80">{event.message}</p>
                        </div>
                      </div>
                      {idx < filteredEvents.length - 1 && <Separator className="bg-accent/20" />}
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
