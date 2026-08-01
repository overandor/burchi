"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Crown,
  FlaskConical,
  Eye,
  MousePointerClick,
  MessageSquare,
  Trophy,
  Target,
  Sparkles,
} from "lucide-react"
import { useApi, api, type Experiment, type Variant } from "@/lib/api"
import { LoadingState, PageHeader, statusBadgeClass, rewardColor } from "@/components/ui-helpers"

export default function ArenaPage() {
  const { data, loading } = useApi<Experiment[]>(() => api.getExperiments(), [], 15000)

  if (loading) return <LoadingState label="Loading variant arena..." />

  const experiments = data ?? []

  // Pick the most relevant experiment to feature in the arena (running first, else highest confidence)
  const featured =
    experiments.find((e) => e.status === "running") ??
    experiments.find((e) => e.status !== "completed") ??
    [...experiments].sort((a, b) => b.confidence - a.confidence)[0]

  if (!featured) {
    return (
      <div className="space-y-6">
        <PageHeader title="Variant Arena" subtitle="A/B/C candidates competing head-to-head for deployment" />
        <Card className="border-border bg-card/50">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No experiments available yet.
          </CardContent>
        </Card>
      </div>
    )
  }

  const variants = featured.variants ?? []
  const sorted = [...variants].sort((a, b) => b.reward - a.reward)
  const leader = sorted[0]
  const maxReward = sorted.length ? Math.max(...sorted.map((v) => Math.abs(v.reward)), 1) : 1

  return (
    <div className="space-y-6">
      <PageHeader
        title="Variant Arena"
        subtitle="A/B/C candidates competing head-to-head for deployment"
      />

      {/* Experiment summary */}
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-blue-400" />
            <CardTitle className="text-base text-foreground">{featured.name}</CardTitle>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={statusBadgeClass(featured.status)}>
              {featured.status.toUpperCase()}
            </Badge>
            <div className="flex items-center gap-2">
              <Target className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{featured.reward_metric}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
              <FlaskConical className="h-4 w-4 text-muted-foreground mb-1" />
              <span className="text-lg font-bold text-foreground tabular-nums">{variants.length}</span>
              <span className="text-[10px] text-muted-foreground/60">variants</span>
            </div>
            <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
              <Eye className="h-4 w-4 text-muted-foreground mb-1" />
              <span className="text-lg font-bold text-foreground tabular-nums">
                {variants.reduce((s, v) => s + (v.impressions ?? 0), 0)}
              </span>
              <span className="text-[10px] text-muted-foreground/60">total impressions</span>
            </div>
            <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
              <Sparkles className="h-4 w-4 text-emerald-400 mb-1" />
              <span className="text-lg font-bold text-emerald-400 tabular-nums">
                {(featured.confidence * 100).toFixed(0)}%
              </span>
              <span className="text-[10px] text-muted-foreground/60">overall confidence</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Overall Confidence
              </span>
              <span className="text-xs font-medium text-foreground/80">
                {(featured.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <Progress value={featured.confidence * 100} className="h-1.5 bg-accent" />
          </div>
        </CardContent>
      </Card>

      {/* Variant grid */}
      {variants.length === 0 ? (
        <Card className="border-border bg-card/50">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No variants registered for this experiment.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {sorted.map((v) => (
            <VariantCard
              key={v.id}
              variant={v}
              isLeader={leader != null && v.id === leader.id}
              maxReward={maxReward}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function VariantCard({
  variant,
  isLeader,
  maxReward,
}: {
  variant: Variant
  isLeader: boolean
  maxReward: number
}) {
  const ctr =
    variant.impressions && variant.impressions > 0
      ? (variant.clicks / variant.impressions) * 100
      : 0
  const confidencePct = Math.min(100, Math.max(0, (Math.abs(variant.reward) / maxReward) * 100))

  return (
    <Card
      className={`border-border bg-card/50 ${
        isLeader ? "ring-2 ring-emerald-500/50 shadow-[0_0_20px_-5px_rgba(16,185,129,0.4)]" : ""
      }`}
    >
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          {isLeader ? (
            <Crown className="h-4 w-4 text-emerald-400" />
          ) : (
            <FlaskConical className="h-4 w-4 text-muted-foreground" />
          )}
          <CardTitle className="text-sm text-foreground">{variant.label}</CardTitle>
        </div>
        <Badge variant="outline" className={statusBadgeClass(variant.status)}>
          {variant.status.toUpperCase()}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs leading-relaxed text-muted-foreground italic border-l-2 border-border pl-3 line-clamp-4">
          &ldquo;{variant.content}&rdquo;
        </p>

        <div className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Reward</span>
          <span className={`text-lg font-bold tabular-nums ${rewardColor(variant.reward)}`}>
            {variant.reward.toFixed(2)}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <div className="flex flex-col items-center">
            <Eye className="h-3.5 w-3.5 text-muted-foreground mb-1" />
            <span className="text-sm font-bold text-foreground tabular-nums">
              {variant.impressions ?? 0}
            </span>
            <span className="text-[9px] text-muted-foreground/60">impr</span>
          </div>
          <div className="flex flex-col items-center">
            <MousePointerClick className="h-3.5 w-3.5 text-muted-foreground mb-1" />
            <span className="text-sm font-bold text-foreground tabular-nums">
              {variant.clicks ?? 0}
            </span>
            <span className="text-[9px] text-muted-foreground/60">clicks</span>
          </div>
          <div className="flex flex-col items-center">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground mb-1" />
            <span className="text-sm font-bold text-foreground tabular-nums">
              {variant.contacts ?? 0}
            </span>
            <span className="text-[9px] text-muted-foreground/60">contacts</span>
          </div>
          <div className="flex flex-col items-center">
            <Trophy className="h-3.5 w-3.5 text-orange-400 mb-1" />
            <span className="text-sm font-bold text-orange-400 tabular-nums">
              {variant.conversions ?? 0}
            </span>
            <span className="text-[9px] text-muted-foreground/60">conv</span>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Confidence
            </span>
            <span className="text-xs font-medium text-foreground/80">{confidencePct.toFixed(0)}%</span>
          </div>
          <Progress
            value={confidencePct}
            className={`h-1.5 bg-accent ${isLeader ? "[&>div]:bg-emerald-500" : ""}`}
          />
        </div>

        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
          <span>CTR {ctr.toFixed(1)}%</span>
          {isLeader && (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <Crown className="mr-1 h-2.5 w-2.5" />
              LEADER
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
