"use client"

import { TrendingUp, TrendingDown, Minus, AlertCircle } from "lucide-react"
import type { TelemetryMetric } from "@/lib/api"
import { useApi, api, getRibbonFallback } from "@/lib/api"

function MetricChip({ metric }: { metric: TelemetryMetric }) {
  const unavailable = metric.observation !== "available" && metric.observation !== "LIVE"

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-1.5 transition-colors hover:bg-accent/30">
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{metric.label}</span>
        {unavailable ? (
          <div className="flex items-center gap-1">
            <AlertCircle className="h-3 w-3 text-amber-400" />
            <span className="text-xs font-medium text-amber-400">UNAVAILABLE</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-bold text-foreground tabular-nums">
              {metric.value?.toLocaleString() ?? "—"}
            </span>
            {metric.change_pct !== undefined && metric.change_pct !== 0 && (
              <span
                className={`flex items-center text-[10px] ${
                  metric.trend === "up" ? "text-emerald-400" : metric.trend === "down" ? "text-red-400" : "text-muted-foreground"
                }`}
              >
                {metric.trend === "up" && <TrendingUp className="mr-0.5 h-2.5 w-2.5" />}
                {metric.trend === "down" && <TrendingDown className="mr-0.5 h-2.5 w-2.5" />}
                {metric.trend === "flat" && <Minus className="mr-0.5 h-2.5 w-2.5" />}
                {Math.abs(metric.change_pct)}%
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function TelemetryRibbon() {
  const { data } = useApi(() => api.getOverview(), [], 30000)
  const ribbon = data?.ribbon || getRibbonFallback()

  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-border bg-sidebar/50 px-4 py-2 backdrop-blur-sm">
      <span className="mr-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-live" />
        Live
      </span>
      {ribbon.map((m) => (
        <MetricChip key={m.label} metric={m} />
      ))}
    </div>
  )
}
