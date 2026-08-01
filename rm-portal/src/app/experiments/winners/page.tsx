"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { Trophy, Crown, Medal, Award, Eye, MousePointerClick, FlaskConical } from "lucide-react"
import { useApi, api, type Experiment, type Variant } from "@/lib/api"
import { LoadingState, PageHeader, statusBadgeClass, rewardColor } from "@/components/ui-helpers"

interface RankedVariant {
  variant: Variant
  experiment: Experiment
  reward: number
}

export default function WinnersPage() {
  const { data, loading } = useApi<Experiment[]>(() => api.getExperiments(), [], 15000)

  if (loading) return <LoadingState label="Loading winner board..." />

  const experiments = data ?? []

  // Collect deployed + leader variants, rank by reward
  const ranked: RankedVariant[] = experiments.flatMap((exp) =>
    (exp.variants ?? [])
      .filter((v) => v.status === "deployed" || v.status === "leader")
      .map((v) => ({ variant: v, experiment: exp, reward: v.reward ?? 0 })),
  )
  ranked.sort((a, b) => b.reward - a.reward)

  const top = ranked[0]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Winner Board"
        subtitle="Top-performing deployed & leader variants ranked by RL reward"
      />

      {ranked.length === 0 ? (
        <Card className="border-border bg-card/50">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No deployed or leader variants yet. Experiments still in progress.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Podium */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {ranked.slice(0, 3).map((rv, i) => (
              <PodiumCard key={rv.variant.id} ranked={rv} rank={i + 1} isTop={i === 0} />
            ))}
          </div>

          {/* Leaderboard table */}
          <Card className="border-border bg-card/50">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-orange-400" />
                <CardTitle className="text-sm text-foreground">Leaderboard</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider">Rank</TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider">Variant</TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider">Experiment</TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider text-right">Reward</TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider text-right">Impressions</TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider text-right">Clicks</TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider text-right">Conversions</TableHead>
                    <TableHead className="text-muted-foreground text-[10px] uppercase tracking-wider">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ranked.map((rv, i) => (
                    <TableRow key={rv.variant.id} className="border-border/70">
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {i === 0 ? (
                            <Crown className="h-3.5 w-3.5 text-orange-400" />
                          ) : i === 1 ? (
                            <Medal className="h-3.5 w-3.5 text-foreground/80" />
                          ) : i === 2 ? (
                            <Award className="h-3.5 w-3.5 text-amber-600" />
                          ) : (
                            <span className="text-muted-foreground/60 text-xs tabular-nums">{i + 1}</span>
                          )}
                          <span className="text-xs font-medium text-foreground/80 tabular-nums">
                            {i + 1}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm font-medium text-foreground">{rv.variant.label}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <FlaskConical className="h-3 w-3 text-muted-foreground/60" />
                          <span className="text-xs text-muted-foreground">{rv.experiment.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`text-sm font-bold tabular-nums ${rewardColor(rv.reward)}`}>
                          {rv.reward.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs text-foreground/80 tabular-nums">
                          {rv.variant.impressions ?? 0}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs text-foreground/80 tabular-nums">
                          {rv.variant.clicks ?? 0}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs text-foreground/80 tabular-nums">
                          {rv.variant.conversions ?? 0}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusBadgeClass(rv.variant.status)}>
                          {rv.variant.status.toUpperCase()}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {top && (
            <Card className="border-emerald-500/20 bg-emerald-500/5">
              <CardContent className="flex items-center gap-3 py-4">
                <Crown className="h-5 w-5 text-orange-400" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-foreground">
                    {top.variant.label} leads the board
                  </div>
                  <div className="text-xs text-muted-foreground">
                    from {top.experiment.name} · reward {top.reward.toFixed(2)} ·{" "}
                    {top.variant.impressions ?? 0} impressions
                  </div>
                </div>
                <Badge variant="outline" className={statusBadgeClass(top.variant.status)}>
                  {top.variant.status.toUpperCase()}
                </Badge>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function PodiumCard({
  ranked,
  rank,
  isTop,
}: {
  ranked: RankedVariant
  rank: number
  isTop: boolean
}) {
  const { variant: v, experiment: exp, reward } = ranked
  const ctr = v.impressions && v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0

  return (
    <Card
      className={`border-border bg-card/50 ${
        isTop ? "ring-2 ring-orange-500/40 shadow-[0_0_20px_-5px_rgba(249,115,22,0.4)]" : ""
      }`}
    >
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          {rank === 1 ? (
            <Crown className="h-5 w-5 text-orange-400" />
          ) : rank === 2 ? (
            <Medal className="h-5 w-5 text-foreground/80" />
          ) : (
            <Award className="h-5 w-5 text-amber-600" />
          )}
          <CardTitle className="text-sm text-foreground">#{rank} {v.label}</CardTitle>
        </div>
        <Badge variant="outline" className={statusBadgeClass(v.status)}>
          {v.status.toUpperCase()}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">{exp.name}</div>
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Reward</div>
            <div className={`text-2xl font-bold tabular-nums ${rewardColor(reward)}`}>
              {reward.toFixed(2)}
            </div>
          </div>
          {isTop && (
            <Badge variant="outline" className="border-orange-500/30 bg-orange-500/10 text-orange-400">
              <Trophy className="mr-1 h-2.5 w-2.5" />
              CHAMPION
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <Eye className="h-3 w-3 text-muted-foreground/60 mx-auto mb-0.5" />
            <div className="text-xs font-bold text-foreground tabular-nums">{v.impressions ?? 0}</div>
            <div className="text-[9px] text-muted-foreground/60">impr</div>
          </div>
          <div>
            <MousePointerClick className="h-3 w-3 text-muted-foreground/60 mx-auto mb-0.5" />
            <div className="text-xs font-bold text-foreground tabular-nums">{v.clicks ?? 0}</div>
            <div className="text-[9px] text-muted-foreground/60">clicks</div>
          </div>
          <div>
            <Trophy className="h-3 w-3 text-muted-foreground/60 mx-auto mb-0.5" />
            <div className="text-xs font-bold text-foreground tabular-nums">{v.conversions ?? 0}</div>
            <div className="text-[9px] text-muted-foreground/60">conv</div>
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground/60 text-center">CTR {ctr.toFixed(1)}%</div>
      </CardContent>
    </Card>
  )
}
