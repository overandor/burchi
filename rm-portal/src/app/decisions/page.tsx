"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Brain, Clock, Shield, CheckCheck } from "lucide-react"
import { useApi, api, type Decision } from "@/lib/api"
import { PageHeader, LoadingState, statusBadgeClass } from "@/components/ui-helpers"

const actionTypeColors: Record<string, string> = {
  promote: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  continue: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  rotate: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  eliminate: "border-red-500/30 bg-red-500/10 text-red-400",
  observe: "border-zinc-700 bg-zinc-800/50 text-zinc-400",
}

const modeIcons: Record<string, React.ElementType> = {
  AUTO: Brain,
  APPROVAL: Shield,
  OBSERVE: Clock,
}

export default function DecisionsPage() {
  const { data, loading } = useApi<Decision[]>(() => api.getDecisions(30), [], 10000)

  if (loading || !data) return <LoadingState label="Loading decisions..." />

  const decisions = data

  return (
    <div className="space-y-6">
      <PageHeader
        title="Decisions"
        subtitle="AI decision log — actions taken across experiments and variants"
      />

      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Brain className="h-5 w-5 text-orange-400" />
          <CardTitle className="text-base text-white">Decision Log</CardTitle>
          <Badge variant="outline" className="ml-auto border-zinc-700 bg-zinc-800/50 text-zinc-400 text-[9px]">
            {decisions.length} total
          </Badge>
        </CardHeader>
        <CardContent>
          {decisions.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
              No decisions recorded yet
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-500 text-[10px] uppercase tracking-wider">Timestamp</TableHead>
                  <TableHead className="text-zinc-500 text-[10px] uppercase tracking-wider">Action</TableHead>
                  <TableHead className="text-zinc-500 text-[10px] uppercase tracking-wider">Rationale</TableHead>
                  <TableHead className="text-zinc-500 text-[10px] uppercase tracking-wider w-32">Confidence</TableHead>
                  <TableHead className="text-zinc-500 text-[10px] uppercase tracking-wider">Mode</TableHead>
                  <TableHead className="text-zinc-500 text-[10px] uppercase tracking-wider">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decisions.map((d) => {
                  const actionColor = actionTypeColors[d.action_type] || actionTypeColors.observe
                  const ModeIcon = modeIcons[d.mode] || Clock
                  return (
                    <TableRow key={d.id} className="border-zinc-800/50 hover:bg-zinc-800/30">
                      <TableCell className="text-[10px] text-zinc-500 tabular-nums whitespace-nowrap">
                        {new Date(d.created_at).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`${actionColor} text-[9px] whitespace-nowrap`}>
                          {d.action_type.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-zinc-300 max-w-md">
                        <span className="line-clamp-2">{d.rationale}</span>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-zinc-500 tabular-nums">
                              {(d.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                          <Progress value={d.confidence * 100} className="h-1.5 bg-zinc-800" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <ModeIcon className="h-3 w-3 text-zinc-500" />
                          <span className="text-[10px] text-zinc-400">{d.mode}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`${statusBadgeClass(d.status)} text-[9px]`}
                        >
                          {d.status === "approved" && <CheckCheck className="mr-1 h-2.5 w-2.5" />}
                          {d.status.toUpperCase()}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
