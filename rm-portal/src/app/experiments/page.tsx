"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { AlertCircle, Crown, FlaskConical, Trophy, Eye, MousePointerClick, MessageSquare, Award } from "lucide-react"
import { useApi, api, type Experiment, type Variant } from "@/lib/api"
import { LoadingState, PageHeader, statusBadgeClass, rewardColor } from "@/components/ui-helpers"

export default function ExperimentsPage() {
  const { data, loading } = useApi<Experiment[]>(() => api.getExperiments(), [], 15000)

  if (loading || !data) return <LoadingState label="Loading experiments..." />

  // Flatten all variants across experiments
  const allVariants: (Variant & { experimentName: string })[] = data.flatMap((exp) =>
    (exp.variants || []).map((v) => ({ ...v, experimentName: exp.name }))
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Experiments" subtitle="Bio variants competing for deployment — A/B/C testing with RL reward" />

      {data.map((exp) => (
        <div key={exp.id} className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-foreground">{exp.name}</h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className={statusBadgeClass(exp.status)}>
                  {exp.status.toUpperCase()}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {exp.observations} observations · {(exp.confidence * 100).toFixed(0)}% confidence
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {(exp.variants || []).map((v) => {
              const isWinner = v.status === "leader" || v.status === "deployed"
              const hasData = v.impressions > 0
              return (
                <Card key={v.id} className={`border-border bg-card/50 ${isWinner ? "ring-1 ring-emerald-500/30" : ""}`}>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isWinner ? <Crown className="h-4 w-4 text-emerald-400" /> : <FlaskConical className="h-4 w-4 text-muted-foreground" />}
                      <CardTitle className="text-sm text-foreground">{v.label}</CardTitle>
                    </div>
                    <Badge variant="outline" className={statusBadgeClass(v.status)}>
                      {v.status.toUpperCase()}
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-xs leading-relaxed text-muted-foreground italic border-l-2 border-border pl-3">
                      &ldquo;{v.content}&rdquo;
                    </p>

                    {!hasData ? (
                      <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                        <span className="text-xs text-amber-400">No performance data yet</span>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-4 gap-3">
                          <div className="flex flex-col items-center">
                            <Eye className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                            <span className="text-sm font-bold text-foreground tabular-nums">{v.impressions}</span>
                            <span className="text-[9px] text-muted-foreground/60">impr</span>
                          </div>
                          <div className="flex flex-col items-center">
                            <MousePointerClick className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                            <span className="text-sm font-bold text-foreground tabular-nums">{v.clicks}</span>
                            <span className="text-[9px] text-muted-foreground/60">clicks</span>
                          </div>
                          <div className="flex flex-col items-center">
                            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                            <span className="text-sm font-bold text-foreground tabular-nums">{v.contacts}</span>
                            <span className="text-[9px] text-muted-foreground/60">contacts</span>
                          </div>
                          <div className="flex flex-col items-center">
                            <Trophy className="h-3.5 w-3.5 text-orange-400 mb-1" />
                            <span className={`text-sm font-bold tabular-nums ${rewardColor(v.reward)}`}>
                              {v.reward.toFixed(2)}
                            </span>
                            <span className="text-[9px] text-muted-foreground/60">reward</span>
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</span>
                            <span className="text-xs font-medium text-foreground/80">{(exp.confidence * 100).toFixed(0)}%</span>
                          </div>
                          <Progress value={exp.confidence * 100} className="h-1.5 bg-accent" />
                        </div>

                        <div className="flex items-center gap-2 text-[10px]">
                          {isWinner ? (
                            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                              <Award className="mr-1 h-2.5 w-2.5" />
                              PROMOTE — keep deployed
                            </Badge>
                          ) : v.reward > 0.2 ? (
                            <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-400">
                              RETAIN — testing
                            </Badge>
                          ) : v.reward > 0 ? (
                            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400">
                              OBSERVE — insufficient data
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-400">
                              KILL — underperforming
                            </Badge>
                          )}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
