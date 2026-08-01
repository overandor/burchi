"use client"

import { AlertCircle, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12">
      <AlertCircle className="h-4 w-4 text-destructive" />
      <span className="text-sm text-destructive">{message}</span>
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

export function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </div>
  )
}

export function StatCard({
  icon: Icon,
  value,
  label,
  color = "text-primary",
  trend,
}: {
  icon: React.ElementType
  value: string | number
  label: string
  color?: string
  trend?: string
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-4 transition-all hover:border-border/80 hover:bg-accent/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/50">
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
          <div>
            <div className="text-2xl font-bold tabular-nums text-foreground">{value}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
          </div>
        </div>
        {trend && (
          <span className="text-xs font-medium text-muted-foreground">{trend}</span>
        )}
      </div>
    </div>
  )
}

export function scoreColor(score: number): string {
  if (score >= 0.8) return "text-emerald-400"
  if (score >= 0.6) return "text-blue-400"
  if (score >= 0.4) return "text-amber-400"
  return "text-muted-foreground"
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
    retired: "border-border/80 bg-accent/30 text-muted-foreground",
    running: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    completed: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    pending: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    executed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    pass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    fail: "border-red-500/30 bg-red-500/10 text-red-400",
    blocked: "border-orange-500/30 bg-orange-500/10 text-orange-400",
    active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    draft: "border-muted-foreground/40 bg-accent/30 text-muted-foreground",
    suppressed: "border-red-500/30 bg-red-500/10 text-red-400",
    sent: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    compiled: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    pending_requirements: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  }
  return map[status] || "border-border/80 bg-accent/30 text-muted-foreground"
}

export function SectionCard({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-card ${className}`}>
      {title && (
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="text-sm font-medium text-muted-foreground">{title}</div>
      {description && <p className="max-w-sm text-xs text-muted-foreground/70">{description}</p>}
      {action}
    </div>
  )
}
