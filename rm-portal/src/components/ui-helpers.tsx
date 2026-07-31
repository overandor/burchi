"use client"

import { AlertCircle, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-zinc-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12">
      <AlertCircle className="h-4 w-4 text-amber-400" />
      <span className="text-sm text-amber-400">{message}</span>
    </div>
  )
}

export function ObservationBadge({ observation }: { observation: string }) {
  const unavailable = observation !== "available" && observation !== "LIVE"
  if (!unavailable) return null
  return (
    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[9px]">
      <AlertCircle className="mr-1 h-2.5 w-2.5" />
      {observation.toUpperCase()}
    </Badge>
  )
}

export function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white">{title}</h1>
      <p className="text-sm text-zinc-500">{subtitle}</p>
    </div>
  )
}

export function StatCard({
  icon: Icon,
  value,
  label,
  color = "text-blue-400",
}: {
  icon: React.ElementType
  value: string | number
  label: string
  color?: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <Icon className={`h-8 w-8 ${color}`} />
      <div>
        <div className="text-2xl font-bold text-white">{value}</div>
        <div className="text-[10px] text-zinc-500">{label}</div>
      </div>
    </div>
  )
}

export function scoreColor(score: number): string {
  if (score >= 0.8) return "text-emerald-400"
  if (score >= 0.6) return "text-blue-400"
  if (score >= 0.4) return "text-amber-400"
  return "text-zinc-500"
}

export function rewardColor(reward: number): string {
  if (reward > 0.2) return "text-emerald-400"
  if (reward > 0) return "text-blue-400"
  if (reward > -0.2) return "text-amber-400"
  return "text-red-400"
}

export function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    deployed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    leader: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    testing: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    challenger: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    candidate: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    eliminated: "border-red-500/30 bg-red-500/10 text-red-400",
    retired: "border-zinc-700 bg-zinc-800/50 text-zinc-500",
    running: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    completed: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    pending: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    executed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    pass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    fail: "border-red-500/30 bg-red-500/10 text-red-400",
    blocked: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  }
  return map[status] || "border-zinc-700 bg-zinc-800/50 text-zinc-500"
}
