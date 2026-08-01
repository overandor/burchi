"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Activity, Zap, Radio, TrendingUp, Users, Brain } from "lucide-react"
import { api, useApi } from "@/lib/api"
import { PageHeader, StatCard, SectionCard, LoadingState } from "@/components/ui-helpers"

export default function IntentScoringPage() {
  const { data: scores, loading } = useApi<any>(() => api.intentScoreAll(), [], 30000)
  const { data: status } = useApi<any>(() => api.intentStatus(), [], 60000)
  const [liveEvents, setLiveEvents] = useState<any[]>([])
  const [streaming, setStreaming] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Simulate visitor event ingestion
  async function simulateEvent() {
    const visitorId = `visitor_${Math.floor(Math.random() * 100)}`
    const eventTypes = ["page_view", "click", "scroll", "message_sent"]
    const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)]
    const result = await api.intentIngestEvent({
      visitor_id: visitorId,
      event_type: eventType,
      event_data: { page: "/profile", source: "direct" },
    })
    if (result) {
      setLiveEvents((prev) => [result, ...prev].slice(0, 20))
    }
  }

  // SSE streaming
  function startStream() {
    setStreaming(true)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || ""
    const es = new EventSource(`${apiUrl}/api/intent/stream`)
    eventSourceRef.current = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === "visitor_score") {
          setLiveEvents((prev) => [data, ...prev].slice(0, 20))
        }
      } catch {}
    }
    es.onerror = () => {
      setStreaming(false)
      es.close()
    }
  }

  function stopStream() {
    setStreaming(false)
    eventSourceRef.current?.close()
  }

  useEffect(() => {
    return () => eventSourceRef.current?.close()
  }, [])

  if (loading) return <LoadingState label="Loading intent scores..." />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Real-Time Visitor Intent Scoring"
        subtitle="Predictive booking model with live event streaming — scores visitors in real-time using logistic regression"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          icon={Users}
          value={scores?.total_visitors ?? 0}
          label="Total Visitors Scored"
          color="text-blue-400"
        />
        <StatCard
          icon={TrendingUp}
          value={scores?.average_booking_probability != null ? `${(scores.average_booking_probability * 100).toFixed(1)}%` : "—"}
          label="Avg Booking Probability"
          color="text-emerald-400"
        />
        <StatCard
          icon={Zap}
          value={scores?.high_intent_count ?? 0}
          label="High Intent (≥75%)"
          color="text-amber-400"
        />
        <StatCard
          icon={Brain}
          value={scores?.ready_to_book_count ?? 0}
          label="Ready to Book (≥50%)"
          color="text-purple-400"
        />
      </div>

      {/* Live Event Controls */}
      <SectionCard title="Live Event Stream">
        <div className="flex flex-wrap gap-3 mb-4">
          <Button onClick={simulateEvent} size="sm">
            <Zap className="mr-2 h-4 w-4" />
            Simulate Visitor Event
          </Button>
          {!streaming ? (
            <Button onClick={startStream} size="sm" variant="outline">
              <Radio className="mr-2 h-4 w-4" />
              Start SSE Stream
            </Button>
          ) : (
            <Button onClick={stopStream} size="sm" variant="destructive">
              <Radio className="mr-2 h-4 w-4 animate-pulse" />
              Stop Stream
            </Button>
          )}
          {streaming && (
            <Badge variant="default" className="bg-emerald-500/20 text-emerald-400">
              <span className="mr-1 h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              LIVE
            </Badge>
          )}
        </div>

        {liveEvents.length > 0 && (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {liveEvents.map((event, i) => {
              const score = event.intent_score || event
              const probability = score.booking_probability ?? 0
              const category = score.intent_category || "unknown"
              return (
                <div key={i} className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-foreground">
                      {event.visitor_id || score.visitor_id}
                    </span>
                    {event.event_type && (
                      <Badge variant="outline" className="text-xs">{event.event_type}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant="secondary"
                      className={`text-xs ${
                        category === "high_intent" ? "bg-amber-500/20 text-amber-400" :
                        category === "ready_to_book" ? "bg-purple-500/20 text-purple-400" :
                        category === "considering" ? "bg-blue-500/20 text-blue-400" :
                        "bg-muted text-muted-foreground"
                      }`}
                    >
                      {category}
                    </Badge>
                    <span className="font-medium text-foreground">
                      {(probability * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* Visitor Rankings */}
      <SectionCard title="Visitor Intent Rankings">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Visitor</TableHead>
              <TableHead className="text-muted-foreground">Engagement</TableHead>
              <TableHead className="text-muted-foreground">Visits</TableHead>
              <TableHead className="text-muted-foreground">Lifecycle</TableHead>
              <TableHead className="text-muted-foreground">Booking Probability</TableHead>
              <TableHead className="text-muted-foreground">Intent</TableHead>
              <TableHead className="text-muted-foreground">Recommended Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(scores?.visitors || []).slice(0, 20).map((v: any) => (
              <TableRow key={v.visitor_id} className="border-border">
                <TableCell className="font-mono text-xs text-foreground">{v.visitor_id}</TableCell>
                <TableCell className="text-muted-foreground">{(v.engagement_score * 100).toFixed(0)}%</TableCell>
                <TableCell className="text-muted-foreground">{v.visit_count}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">{v.lifecycle_stage}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-20 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full ${
                          v.booking_probability >= 0.75 ? "bg-amber-500" :
                          v.booking_probability >= 0.5 ? "bg-purple-500" :
                          v.booking_probability >= 0.2 ? "bg-blue-500" :
                          "bg-muted-foreground"
                        }`}
                        style={{ width: `${v.booking_probability * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-foreground">
                      {(v.booking_probability * 100).toFixed(1)}%
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="secondary"
                    className={`text-xs ${
                      v.intent_category === "high_intent" ? "bg-amber-500/20 text-amber-400" :
                      v.intent_category === "ready_to_book" ? "bg-purple-500/20 text-purple-400" :
                      v.intent_category === "considering" ? "bg-blue-500/20 text-blue-400" :
                      "bg-muted text-muted-foreground"
                    }`}
                  >
                    {v.intent_category}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{v.recommended_action}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>

      {/* Model Info */}
      <SectionCard title="Model Details">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground mb-1">Model</div>
            <div className="font-medium text-foreground">Logistic Regression v1</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground mb-1">Features</div>
            <div className="font-medium text-foreground">8 weighted signals</div>
          </div>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          Features: visit_count, engagement_score, message_count, time_on_page,
          lifecycle_progress, return_visitor, has_messaged, converted_before
        </div>
      </SectionCard>
    </div>
  )
}
