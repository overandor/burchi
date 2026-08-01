"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import {
  Shield,
  CheckCheck,
  Clock,
  Inbox,
  Loader2,
  Brain,
  Trophy,
} from "lucide-react"
import { useApi, api, type Decision } from "@/lib/api"
import { PageHeader, LoadingState, statusBadgeClass } from "@/components/ui-helpers"

const actionTypeColors: Record<string, string> = {
  promote: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  continue: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  rotate: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  eliminate: "border-red-500/30 bg-red-500/10 text-red-400",
  observe: "border-border/80 bg-accent/30 text-muted-foreground",
}

export default function ApprovalsPage() {
  const { data, loading, refetch } = useApi<Decision[]>(
    () => api.getDecisions(30),
    [],
    10000
  )
  const [approvingId, setApprovingId] = useState<string | null>(null)

  if (loading || !data) return <LoadingState label="Loading approval queue..." />

  const pending = data.filter((d) => d.status === "pending")
  const total = data.length

  const handleApprove = async (id: string) => {
    setApprovingId(id)
    try {
      await api.approveDecision(id)
      await refetch()
    } finally {
      setApprovingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approval Queue"
        subtitle="Pending AI decisions awaiting human review and approval"
      />

      {/* Counts */}
      <div className="flex items-center gap-3">
        <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400">
          <Clock className="mr-1 h-2.5 w-2.5" />
          {pending.length} pending
        </Badge>
        <Badge variant="outline" className="border-border/80 bg-accent/30 text-muted-foreground">
          <CheckCheck className="mr-1 h-2.5 w-2.5" />
          {total} total
        </Badge>
      </div>

      {pending.length === 0 ? (
        <Card className="border-border bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Inbox className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-foreground/80">No pending approvals</p>
            <p className="text-xs text-muted-foreground mt-1">
              All decisions have been reviewed. The queue is clear.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {pending.map((d) => {
            const actionColor = actionTypeColors[d.action_type] || actionTypeColors.observe
            return (
              <Card key={d.id} className="border-border bg-card/50">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-amber-400" />
                    <CardTitle className="text-sm text-foreground">
                      Decision {d.id.slice(0, 8)}
                    </CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`${actionColor} text-[9px]`}>
                      {d.action_type.toUpperCase()}
                    </Badge>
                    <Badge variant="outline" className={`${statusBadgeClass(d.status)} text-[9px]`}>
                      {d.status.toUpperCase()}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Rationale</span>
                    <p className="text-xs text-foreground/80 mt-1 leading-relaxed">{d.rationale}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</span>
                        <span className="text-xs font-bold text-orange-400 tabular-nums">
                          {(d.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      <Progress value={d.confidence * 100} className="h-1.5 bg-accent" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Brain className="h-3.5 w-3.5 text-muted-foreground" />
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Mode</span>
                        <p className="text-xs text-foreground/80">{d.mode}</p>
                      </div>
                    </div>
                  </div>

                  <Separator className="bg-accent" />

                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                      {new Date(d.created_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </span>
                    <Button
                      onClick={() => handleApprove(d.id)}
                      disabled={approvingId === d.id}
                      size="sm"
                    >
                      {approvingId === d.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCheck className="h-3.5 w-3.5" />
                      )}
                      Approve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
