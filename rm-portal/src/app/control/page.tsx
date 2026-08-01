"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { AlertTriangle, Shield, Zap, Pause, OctagonX, Eye, CheckCheck, Settings } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader } from "@/components/ui-helpers"
import { useState, useEffect } from "react"
import type { ControlMode } from "@/lib/types"

const modeIcons: Record<string, typeof Shield> = {
  AUTO: Zap,
  APPROVAL: CheckCheck,
  OBSERVE: Eye,
  PAUSED: Pause,
  EMERGENCY_STOP: OctagonX,
}

const modeColors: Record<string, string> = {
  AUTO: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  APPROVAL: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  OBSERVE: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  PAUSED: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  EMERGENCY_STOP: "border-red-500/30 bg-red-500/10 text-red-400",
}

const modeLabels: Record<string, { label: string; color: string; description: string }> = {
  AUTO: { label: "AUTO", color: "text-emerald-400", description: "AI operates autonomously within safety bounds" },
  APPROVAL: { label: "APPROVAL", color: "text-amber-400", description: "AI proposes, human approves before mutation" },
  OBSERVE: { label: "OBSERVE", color: "text-blue-400", description: "AI observes and recommends, no mutations" },
  PAUSED: { label: "PAUSED", color: "text-orange-400", description: "All automation suspended" },
  EMERGENCY_STOP: { label: "EMERGENCY STOP", color: "text-red-400", description: "All automation halted, manual override only" },
}

const modes: string[] = ["AUTO", "APPROVAL", "OBSERVE", "PAUSED", "EMERGENCY_STOP"]

const capabilityLabels: Record<string, string> = {
  bio_mutation: "Bio Mutation",
  messaging: "Messaging",
  visitor_engagement: "Visitor Engagement",
  photo_rotation: "Photo Rotation",
  price_changes: "Price Changes",
  content_generation: "Content Generation",
  ai_optimization: "AI Optimization",
}

export default function ControlPage() {
  const { data: controlState, refetch } = useApi(() => api.getControlState(), [], 10000)
  const { data: overview } = useApi(() => api.getOverview(), [], 15000)

  const [mode, setMode] = useState<string>("AUTO")
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({
    bio_mutation: true,
    messaging: true,
    visitor_engagement: true,
    photo_rotation: false,
    price_changes: false,
    content_generation: true,
    ai_optimization: true,
  })
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    if (controlState) {
      setMode(controlState.mode || "AUTO")
      setCapabilities({
        bio_mutation: controlState.cap_bio_mutation !== "false",
        messaging: controlState.cap_messaging !== "false",
        visitor_engagement: controlState.cap_visitor_engagement !== "false",
        photo_rotation: controlState.cap_photo_rotation === "true",
        price_changes: controlState.cap_price_changes === "true",
        content_generation: controlState.cap_content_generation !== "false",
        ai_optimization: controlState.cap_ai_optimization !== "false",
      })
    }
  }, [controlState])

  // Also sync from overview capabilities
  useEffect(() => {
    if (overview?.capabilities) {
      setCapabilities(overview.capabilities)
    }
  }, [overview])

  const changeMode = async (m: string) => {
    setUpdating(true)
    setMode(m)
    await api.setControlState("mode", m)
    setUpdating(false)
    refetch()
  }

  const toggleCapability = async (key: string) => {
    if (mode === "EMERGENCY_STOP" || mode === "PAUSED") return
    const newVal = !capabilities[key]
    setCapabilities((prev) => ({ ...prev, [key]: newVal }))
    await api.setControlState(`cap_${key}`, String(newVal))
    refetch()
  }

  const locked = mode === "EMERGENCY_STOP" || mode === "PAUSED"

  if (!controlState && !overview) return <LoadingState label="Loading control center..." />

  return (
    <div className="space-y-6">
      <PageHeader title="Control Center" subtitle="Human authority over autonomous operations" />

      {/* Mode selector */}
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Shield className="h-5 w-5 text-orange-400" />
          <CardTitle className="text-base text-foreground">Operating Mode</CardTitle>
          {updating && <span className="ml-auto text-[10px] text-muted-foreground">updating...</span>}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            {modes.map((m) => {
              const Icon = modeIcons[m]
              const info = modeLabels[m]
              const active = mode === m
              return (
                <button
                  key={m}
                  onClick={() => changeMode(m)}
                  className={`flex flex-col items-center gap-2 rounded-lg border p-4 transition-all ${
                    active
                      ? `${modeColors[m]} ring-1 ring-offset-2 ring-offset-sidebar`
                      : "border-border bg-card/30 text-muted-foreground hover:bg-accent/50"
                  }`}
                  style={active ? { boxShadow: "0 0 0 1px currentColor" } : {}}
                >
                  <Icon className="h-6 w-6" />
                  <span className="text-xs font-bold">{info.label}</span>
                  <span className="text-[9px] text-center leading-tight opacity-70">{info.description}</span>
                </button>
              )
            })}
          </div>

          {mode === "EMERGENCY_STOP" && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-red-400 animate-pulse" />
              <span className="text-xs text-red-400 font-medium">
                EMERGENCY STOP ACTIVE — All automation halted. All capabilities locked. Manual override only.
              </span>
            </div>
          )}
          {mode === "PAUSED" && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-3">
              <Pause className="h-4 w-4 text-orange-400" />
              <span className="text-xs text-orange-400 font-medium">
                PAUSED — All mutations suspended. Telemetry collection continues. Capabilities locked.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Capabilities */}
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Settings className="h-5 w-5 text-purple-400" />
          <CardTitle className="text-base text-foreground">Capability Permissions</CardTitle>
          {locked && (
            <Badge variant="outline" className="ml-auto border-border/80 bg-accent/30 text-muted-foreground text-[9px]">
              LOCKED
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(Object.keys(capabilities) as string[]).map((key) => (
              <div
                key={key}
                className={`flex items-center justify-between rounded-lg border border-border bg-card/30 px-4 py-3 ${
                  locked ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${capabilities[key] ? "bg-emerald-500/10" : "bg-accent/30"}`}>
                    <Zap className={`h-4 w-4 ${capabilities[key] ? "text-emerald-400" : "text-muted-foreground/60"}`} />
                  </div>
                  <span className="text-sm text-foreground">{capabilityLabels[key] || key}</span>
                </div>
                <Switch
                  checked={capabilities[key] && !locked}
                  onCheckedChange={() => toggleCapability(key)}
                  disabled={locked}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Current state summary */}
      <Card className="border-border bg-card/50">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Active State Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Mode</span>
              <p className={`text-sm font-bold ${modeLabels[mode]?.color || "text-muted-foreground"}`}>{modeLabels[mode]?.label || mode}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Active Capabilities</span>
              <p className="text-sm font-bold text-foreground">
                {Object.values(capabilities).filter(Boolean).length} / {Object.keys(capabilities).length}
              </p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Current Bio</span>
              <p className="text-sm font-medium text-foreground">{overview?.current_bio || "—"}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</span>
              <p className="text-sm font-bold text-orange-400">{overview ? `${(overview.confidence * 100).toFixed(0)}%` : "—"}</p>
            </div>
          </div>
          <Separator className="my-4 bg-accent" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Shield className="h-3.5 w-3.5" />
            Changes to operating mode take effect immediately. Capability toggles require mode AUTO or APPROVAL.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
