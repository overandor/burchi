"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  FlaskConical,
  Crown,
  Circle,
  Calendar,
  Eye,
  Layers,
  TrendingUp,
  GitBranch,
} from "lucide-react"
import { useApi, api, type Experiment } from "@/lib/api"
import { LoadingState, PageHeader, statusBadgeClass } from "@/components/ui-helpers"

export default function TimelinePage() {
  const { data, loading } = useApi<Experiment[]>(() => api.getExperiments(20), [], 15000)

  if (loading) return <LoadingState label="Loading experiment timeline..." />

  const experiments = (data ?? []).slice().sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Experiment Timeline"
        subtitle="Chronological history of experiments and their outcomes"
      />

      {experiments.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="py-12 text-center text-sm text-zinc-500">
            No experiments recorded yet.
          </CardContent>
        </Card>
      ) : (
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="p-6">
            <ol className="relative space-y-8">
              {/* vertical line */}
              <span
                className="absolute left-[11px] top-2 bottom-2 w-px bg-zinc-800"
                aria-hidden
              />
              {experiments.map((exp) => (
                <TimelineEntry key={exp.id} experiment={exp} />
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function TimelineEntry({ experiment: exp }: { experiment: Experiment }) {
  const variants = exp.variants ?? []
  const winner = exp.winner_id
    ? variants.find((v) => v.id === exp.winner_id)
    : variants.find((v) => v.status === "deployed" || v.status === "leader")
  const isCompleted = exp.status === "completed"
  const isRunning = exp.status === "running"
  const created = new Date(exp.created_at)

  const dotColor = isCompleted
    ? "bg-blue-400"
    : isRunning
      ? "bg-emerald-400"
      : "bg-zinc-600"

  const ringColor = isCompleted
    ? "ring-blue-500/30"
    : isRunning
      ? "ring-emerald-500/30"
      : "ring-zinc-700"

  return (
    <li className="relative pl-10">
      {/* dot */}
      <span
        className={`absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full ring-2 ${ringColor} bg-zinc-900`}
      >
        <Circle className={`h-2.5 w-2.5 ${dotColor} fill-current`} />
      </span>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        {/* header row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-zinc-500" />
            <span className="text-sm font-semibold text-white">{exp.name}</span>
          </div>
          <Badge variant="outline" className={statusBadgeClass(exp.status)}>
            {exp.status.toUpperCase()}
          </Badge>
        </div>

        {/* meta row */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {created.toLocaleDateString()}{" "}
            <span className="text-zinc-600">{created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </span>
          <span className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            {exp.type}
          </span>
          <span className="flex items-center gap-1">
            <Layers className="h-3 w-3" />
            {variants.length} variant{variants.length === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-1">
            <Eye className="h-3 w-3" />
            {exp.observations ?? 0} observations
          </span>
        </div>

        {/* confidence */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Confidence</span>
            <span className="text-xs font-medium text-zinc-300">
              {(exp.confidence * 100).toFixed(0)}%
            </span>
          </div>
          <Progress value={exp.confidence * 100} className="h-1.5 bg-zinc-800" />
        </div>

        {/* winner */}
        {isCompleted && winner && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
            <Crown className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-xs text-emerald-400">
              Winner: <span className="font-semibold">{winner.label}</span>
            </span>
            <span className="ml-auto flex items-center gap-1 text-[10px] text-zinc-500">
              <TrendingUp className="h-3 w-3" />
              reward {winner.reward.toFixed(2)}
            </span>
          </div>
        )}

        {isCompleted && !winner && (
          <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-500">
            Completed — no winner recorded.
          </div>
        )}

        {/* variant labels preview */}
        {variants.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {variants.slice(0, 5).map((v) => (
              <Badge
                key={v.id}
                variant="outline"
                className={`text-[9px] ${statusBadgeClass(v.status)}`}
              >
                {v.label}
              </Badge>
            ))}
            {variants.length > 5 && (
              <span className="text-[10px] text-zinc-600">+{variants.length - 5} more</span>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
