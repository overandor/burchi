"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import {
  Users,
  MapPin,
  MessageSquare,
  Star,
  ArrowRight,
  Calendar,
  Clock,
  TrendingUp,
  CheckCircle2,
  Activity,
  Target,
} from "lucide-react"
import { useParams } from "next/navigation"
import { useApi, api, type Visitor, type TelemetryEvent } from "@/lib/api"
import { LoadingState, PageHeader, scoreColor, statusBadgeClass } from "@/components/ui-helpers"

type VisitorDetail = Visitor & { telemetry: TelemetryEvent[] }

function actionBadge(action: string) {
  if (action.includes("VIP") || action.includes("Follow up"))
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
  if (action.includes("Message"))
    return "border-blue-500/30 bg-blue-500/10 text-blue-400"
  if (action.includes("Responded") || action.includes("nurture"))
    return "border-purple-500/30 bg-purple-500/10 text-purple-400"
  return "border-border/80 bg-accent/30 text-muted-foreground"
}

function fmtDate(s?: string) {
  if (!s) return "—"
  try {
    return new Date(s).toLocaleString()
  } catch {
    return s
  }
}

export default function VisitorDetailPage() {
  const params = useParams()
  const id = String(params.id)

  const { data, loading } = useApi<VisitorDetail>(() => api.getVisitor(id), [params.id], 10000)

  if (loading) return <LoadingState label="Loading visitor profile..." />

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Visitor Detail" subtitle={id} />
        <Card className="border-border bg-card/50">
          <CardContent className="py-12 text-center">
            <Users className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm text-muted-foreground">Visitor not found or backend unreachable</p>
            <p className="mt-1 text-xs text-muted-foreground/60">ID: {id}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const v = data
  const telemetry = v.telemetry || []
  const scorePct = Math.round(v.engagement_score * 100)

  return (
    <div className="space-y-6">
      <PageHeader title={`@${v.username}`} subtitle={`Visitor profile · ${v.visit_count} visits`} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Profile card */}
        <Card className="border-border bg-card/50 lg:col-span-1">
          <CardHeader className="flex flex-row items-center gap-2">
            <Users className="h-5 w-5 text-blue-400" />
            <CardTitle className="text-base text-foreground">Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-lg font-bold text-foreground">
                {v.username.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="text-base font-bold text-foreground">{v.username}</div>
                <div className="flex items-center gap-2 mt-1">
                  {v.is_repeat && (
                    <Badge variant="outline" className="border-purple-500/30 bg-purple-500/10 text-purple-400 text-[9px]">
                      REPEAT
                    </Badge>
                  )}
                  {v.converted && (
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[9px]">
                      <CheckCircle2 className="mr-1 h-2.5 w-2.5" />
                      CONVERTED
                    </Badge>
                  )}
                  {v.lifecycle_stage && (
                    <Badge variant="outline" className="text-[9px] border-border/80 bg-accent/30 text-foreground/80">
                      {v.lifecycle_stage}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <Separator className="bg-accent" />

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <TrendingUp className="h-3.5 w-3.5" /> Visit Count
                </span>
                <span className="font-bold tabular-nums text-foreground">{v.visit_count}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" /> First Seen
                </span>
                <span className="text-xs text-foreground/80">{fmtDate(v.first_seen)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" /> Last Seen
                </span>
                <span className="text-xs text-foreground/80">{fmtDate(v.last_seen)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" /> Location
                </span>
                <span className="text-xs text-foreground/80">{v.location || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5" /> Messages
                </span>
                <span className="font-bold tabular-nums text-foreground">{v.messaged_count}</span>
              </div>
            </div>

            <Separator className="bg-accent" />

            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Inferred Intent</span>
              <p className="mt-1 text-sm text-foreground/80">{v.inferred_intent || "—"}</p>
            </div>

            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Next Recommended Action</span>
              <div className="mt-1">
                <Badge variant="outline" className={`text-[9px] ${actionBadge(v.next_action)}`}>
                  <ArrowRight className="mr-1 h-2.5 w-2.5" />
                  {v.next_action}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Engagement gauge + telemetry */}
        <div className="space-y-6 lg:col-span-2">
          {/* Engagement gauge */}
          <Card className="border-border bg-card/50">
            <CardHeader className="flex flex-row items-center gap-2">
              <Star className="h-5 w-5 text-orange-400" />
              <CardTitle className="text-base text-foreground">Engagement Score</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end gap-3">
                <span className={`text-5xl font-bold ${scoreColor(v.engagement_score)}`}>
                  {scorePct}
                </span>
                <span className="pb-1 text-sm text-muted-foreground">/ 100</span>
                <Badge
                  variant="outline"
                  className={`ml-auto text-[9px] ${
                    v.engagement_score >= 0.7
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : v.engagement_score >= 0.4
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                      : "border-border/80 bg-accent/30 text-muted-foreground"
                  }`}
                >
                  <Target className="mr-1 h-2.5 w-2.5" />
                  {v.engagement_score >= 0.8
                    ? "VERY HIGH"
                    : v.engagement_score >= 0.6
                    ? "HIGH"
                    : v.engagement_score >= 0.4
                    ? "MEDIUM"
                    : "LOW"}
                </Badge>
              </div>
              <Progress value={scorePct} className="h-3 bg-accent" />
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { label: "Low", max: 40 },
                  { label: "Medium", max: 60 },
                  { label: "High", max: 80 },
                  { label: "Very High", max: 100 },
                ].map((band) => {
                  const active = scorePct <= band.max && scorePct > band.max - 20
                  return (
                    <div
                      key={band.label}
                      className={`rounded-md border px-2 py-1.5 ${
                        active ? "border-orange-500/40 bg-orange-500/10" : "border-border bg-card/30"
                      }`}
                    >
                      <span className={`text-[10px] ${active ? "text-orange-400" : "text-muted-foreground/60"}`}>
                        {band.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Telemetry timeline */}
          <Card className="border-border bg-card/50">
            <CardHeader className="flex flex-row items-center gap-2">
              <Activity className="h-5 w-5 text-blue-400" />
              <CardTitle className="text-base text-foreground">Telemetry Timeline</CardTitle>
              <Badge variant="outline" className="ml-auto border-border/80 bg-accent/30 text-muted-foreground text-[9px]">
                {telemetry.length} EVENTS
              </Badge>
            </CardHeader>
            <CardContent>
              {telemetry.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No telemetry events recorded</div>
              ) : (
                <div className="relative space-y-4 before:absolute before:left-[7px] before:top-1 before:bottom-1 before:w-px before:bg-accent">
                  {telemetry.map((e) => (
                    <div key={e.id} className="relative flex gap-4 pl-6">
                      <div className="absolute left-0 top-1 h-3.5 w-3.5 rounded-full border-2 border-border/80 bg-card" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={`text-[9px] ${statusBadgeClass(e.observation === "available" ? "running" : "blocked")}`}
                          >
                            {e.event_type}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground/60">{fmtDate(e.timestamp)}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{e.detail || e.observation}</p>
                        {e.source && (
                          <span className="mt-0.5 block text-[10px] text-muted-foreground/60">source: {e.source}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
