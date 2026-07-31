"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AlertCircle, Activity, Eye, MessageSquare, Brain, GitBranch, Shield, Zap, FileText, TrendingUp } from "lucide-react"
import { useApi, api, type TelemetryEvent } from "@/lib/api"
import { LoadingState, PageHeader } from "@/components/ui-helpers"

const eventIcons: Record<string, typeof Eye> = {
  visitor_sighting: Eye,
  message_sent: MessageSquare,
  rl_feedback: Brain,
  kpi_snapshot: Activity,
  availability_check: Shield,
  profile_visit: Eye,
  scrape_blocked: AlertCircle,
  ga_optimization: GitBranch,
  bio_generated: FileText,
  ai_decision: Brain,
  visitor_returned: Eye,
  click: Zap,
  reward_update: TrendingUp,
  confidence_update: Brain,
  visitor_matched: Eye,
  experiment_scheduled: GitBranch,
  variant_eliminated: AlertCircle,
  content_generated: FileText,
  control_change: Shield,
  decision_approved: Shield,
  action_executed: Zap,
}

const sourceColors: Record<string, string> = {
  engagement_engine: "text-blue-400",
  pipeline_24_7: "text-emerald-400",
  "pipeline-24-7": "text-emerald-400",
  content_generator: "text-purple-400",
  system: "text-zinc-500",
  telemetry_pipeline: "text-emerald-400",
}

export default function TelemetryPage() {
  const { data, loading } = useApi<TelemetryEvent[]>(() => api.getTelemetry(100), [], 10000)

  if (loading || !data) return <LoadingState label="Loading telemetry..." />

  return (
    <div className="space-y-6">
      <PageHeader title="Telemetry Explorer" subtitle="Real-time event stream — every observation, its source, and whether it was live" />

      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Activity className="h-5 w-5 text-emerald-400" />
          <CardTitle className="text-base text-white">Event Stream</CardTitle>
          <Badge variant="outline" className="ml-auto border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[9px]">
            <span className="mr-1 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </Badge>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px] pr-4">
            <div className="space-y-1">
              {data.length === 0 ? (
                <div className="text-center py-8 text-sm text-zinc-500">No telemetry events yet</div>
              ) : (
                data.map((e) => {
                  const Icon = eventIcons[e.event_type] || Zap
                  const unavailable = e.observation !== "available" && e.observation !== "LIVE"
                  return (
                    <div
                      key={e.id}
                      className="flex items-start gap-3 rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-3 py-2.5 hover:bg-zinc-900/60 transition-colors"
                    >
                      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-800/50 ${unavailable ? "text-amber-400" : "text-zinc-400"}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-white">{e.event_type.replace(/_/g, " ")}</span>
                          <span className={`text-[9px] ${sourceColors[e.source] || "text-zinc-500"}`}>
                            {e.source}
                          </span>
                          {unavailable && (
                            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[8px]">
                              <AlertCircle className="mr-1 h-2 w-2" />
                              NO_OBSERVATION
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5">{e.detail}</p>
                      </div>
                      <span className="text-[10px] text-zinc-600 tabular-nums shrink-0">
                        {new Date(e.timestamp).toLocaleTimeString("en-US", { hour12: false })}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
