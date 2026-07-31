"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table"
import {
  Activity,
  Shield,
  Cpu,
  Bot,
  Workflow,
  RotateCw,
  Brain,
  Zap,
  OctagonX,
  Clock,
} from "lucide-react"
import { useApi, api, type ActionItem } from "@/lib/api"
import { LoadingState, PageHeader, statusBadgeClass } from "@/components/ui-helpers"

const AGENTS = [
  { name: "Pipeline 24/7", icon: Workflow, description: "Continuous content & bio generation pipeline", running: true },
  { name: "Engagement Engine", icon: Bot, description: "Visitor engagement and messaging automation", running: true },
  { name: "Master Rotator", icon: RotateCw, description: "Experiment rotation and variant management", running: true },
  { name: "AI Decision Engine", icon: Brain, description: "LLM-powered decision making and rationale", running: true },
  { name: "Telemetry Collector", icon: Activity, description: "Event collection and visitor tracking", running: true },
  { name: "Price Optimizer", icon: Zap, description: "GA-based pricing optimization", running: false },
]

export default function AgentsPage() {
  const { data: health, loading } = useApi<{ status: string; mode: string; timestamp: string }>(
    () => api.getHealth(),
    [],
    10000,
  )
  const { data: actions } = useApi<ActionItem[]>(() => api.getActions(30), [], 10000)

  if (loading && !health) return <LoadingState label="Loading agent health..." />

  const schedulerActive = health?.status === "ok" || health?.status === "healthy"
  const emergencyStop = health?.mode === "EMERGENCY_STOP"

  return (
    <div className="space-y-6">
      <PageHeader title="Agent Health" subtitle="System health and automation agent monitoring" />

      {/* System Health Status */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Shield className="h-5 w-5 text-orange-400" />
          <CardTitle className="text-base text-white">System Health</CardTitle>
          <Badge
            variant="outline"
            className={`ml-auto text-[9px] ${
              schedulerActive
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-red-500/30 bg-red-500/10 text-red-400"
            }`}
          >
            <span
              className={`mr-1 h-1.5 w-1.5 rounded-full ${
                schedulerActive ? "bg-emerald-400 animate-pulse" : "bg-red-400"
              }`}
            />
            {schedulerActive ? "HEALTHY" : "DEGRADED"}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Status</span>
              <p className={`text-sm font-bold ${schedulerActive ? "text-emerald-400" : "text-red-400"}`}>
                {health?.status?.toUpperCase() ?? "UNKNOWN"}
              </p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Mode</span>
              <p className="text-sm font-bold text-white">{health?.mode ?? "—"}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Scheduler</span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${schedulerActive ? "bg-emerald-400" : "bg-red-400"}`}
                />
                <p className={`text-sm font-bold ${schedulerActive ? "text-emerald-400" : "text-red-400"}`}>
                  {schedulerActive ? "ACTIVE" : "STOPPED"}
                </p>
              </div>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Emergency Stop</span>
              <div className="flex items-center gap-1.5">
                {emergencyStop ? (
                  <>
                    <OctagonX className="h-3.5 w-3.5 text-red-400 animate-pulse" />
                    <p className="text-sm font-bold text-red-400">ACTIVE</p>
                  </>
                ) : (
                  <>
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    <p className="text-sm font-bold text-emerald-400">CLEAR</p>
                  </>
                )}
              </div>
            </div>
          </div>
          <Separator className="my-4 bg-zinc-800" />
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Clock className="h-3.5 w-3.5" />
            Last health check: {health?.timestamp ? new Date(health.timestamp).toLocaleString() : "—"}
          </div>
        </CardContent>
      </Card>

      {/* Agent Health Cards */}
      <div>
        <h2 className="mb-3 text-sm font-bold text-white">Agent Workflows</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {AGENTS.map((agent) => {
            const Icon = agent.icon
            return (
              <Card key={agent.name} className="border-zinc-800 bg-zinc-900/50">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                          agent.running ? "bg-emerald-500/10" : "bg-zinc-800/50"
                        }`}
                      >
                        <Icon className={`h-5 w-5 ${agent.running ? "text-emerald-400" : "text-zinc-600"}`} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{agent.name}</p>
                        <p className="text-[10px] text-zinc-500">{agent.description}</p>
                      </div>
                    </div>
                    <span
                      className={`mt-1 h-2.5 w-2.5 rounded-full ${
                        agent.running ? "bg-emerald-400 animate-pulse" : "bg-red-400"
                      }`}
                    />
                  </div>
                  <Separator className="my-3 bg-zinc-800" />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">Status</span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${
                        agent.running
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : "border-red-500/30 bg-red-500/10 text-red-400"
                      }`}
                    >
                      {agent.running ? "RUNNING" : "STOPPED"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {/* Recent Actions Table */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Cpu className="h-5 w-5 text-blue-400" />
          <CardTitle className="text-base text-white">Recent Actions</CardTitle>
          <span className="ml-auto text-[10px] text-zinc-500">{actions?.length ?? 0} actions</span>
        </CardHeader>
        <CardContent>
          {!actions || actions.length === 0 ? (
            <LoadingState label="No recent actions" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-500 text-[10px] uppercase tracking-wider">Action</TableHead>
                  <TableHead className="text-zinc-500 text-[10px] uppercase tracking-wider">Target</TableHead>
                  <TableHead className="text-zinc-500 text-[10px] uppercase tracking-wider">Mode</TableHead>
                  <TableHead className="text-zinc-500 text-[10px] uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-zinc-500 text-[10px] uppercase tracking-wider">Scheduled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actions.map((action) => (
                  <TableRow key={action.id} className="border-zinc-800/50">
                    <TableCell className="text-xs text-white">{action.action_type}</TableCell>
                    <TableCell className="text-xs text-zinc-400">{action.target || "—"}</TableCell>
                    <TableCell className="text-xs text-zinc-400">{action.mode}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[9px] ${statusBadgeClass(action.status)}`}>
                        {action.status.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-[10px] text-zinc-500 tabular-nums">
                      {action.scheduled_at
                        ? new Date(action.scheduled_at).toLocaleTimeString("en-US", { hour12: false })
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
