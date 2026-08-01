"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Crown, Flag, Gauge, Swords, Trophy, Users } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"

export default function GgufRacingPage() {
  const { data: stats, loading: statsLoading } = useApi<any>(
    () => api.ggufCompetitiveStats(),
    [],
    20000,
  )
  const { data: races, loading: racesLoading, refetch: refetchRaces } = useApi<any[]>(
    () => api.ggufCompetitiveRaces(),
    [],
    15000,
  )
  const { data: models } = useApi<any[]>(() => api.ggufModels(), [], 30000)

  const [prompt, setPrompt] = useState("Write a haiku about distributed systems.")
  const [modelId, setModelId] = useState("qwen2-0.5b-q3k")
  const [numWorkers, setNumWorkers] = useState(3)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)

  const s = stats ?? {}
  const raceList = races ?? []
  const modelList = models ?? []
  const workerStats: any[] = s.worker_stats ?? []

  async function runRace() {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await api.ggufRunRace(prompt, modelId, numWorkers)
      if (res === null) {
        setError("Race failed to start. Ensure workers are available.")
      } else {
        setResult(res)
        refetchRaces()
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

  if (statsLoading) return <LoadingState label="Loading competitive racing..." />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Competitive Inference Racing"
        subtitle="Pit multiple workers against each other and crown the fastest response"
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Flag} value={s.total_races ?? 0} label="total races" color="text-blue-400" />
        <StatCard icon={Users} value={workerStats.length} label="workers" color="text-violet-400" />
        <StatCard
          icon={Trophy}
          value={s.total_races ?? 0}
          label="completed"
          color="text-amber-400"
        />
        <StatCard
          icon={Gauge}
          value={s.avg_tokens_per_second != null ? s.avg_tokens_per_second.toFixed(1) : "—"}
          label="avg tok/s"
          color="text-emerald-400"
        />
      </div>

      {/* Race control */}
      <Card className="border-border bg-card/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Swords className="h-4 w-4 text-amber-400" />
            <CardTitle className="text-base text-foreground">Start a Race</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-accent/50 p-3 text-sm text-foreground/90 outline-none placeholder:text-muted-foreground/60 focus:border-border/80"
              placeholder="Enter a prompt for the race..."
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Model</label>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="w-full rounded-lg border border-border bg-accent/50 p-2.5 text-sm text-foreground/90 outline-none focus:border-border/80"
              >
                {modelList.length === 0 ? (
                  <option value="qwen2-0.5b-q3k">qwen2-0.5b-q3k (default)</option>
                ) : (
                  modelList.map((m) => (
                    <option key={m.model_id} value={m.model_id}>
                      {m.name ?? m.model_id}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Number of Workers
              </label>
              <input
                type="number"
                min={2}
                max={16}
                value={numWorkers}
                onChange={(e) => setNumWorkers(Number(e.target.value) || 2)}
                className="w-full rounded-lg border border-border bg-accent/50 p-2.5 text-sm text-foreground/90 outline-none focus:border-border/80"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={runRace} disabled={running || !prompt.trim()}>
              <Swords className="mr-2 h-4 w-4" />
              {running ? "Racing..." : "Run Race"}
            </Button>
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Race result */}
      {result && (
        <Card className="border-border bg-card/50 ring-2 ring-amber-500/40 shadow-[0_0_20px_-5px_rgba(245,158,11,0.4)]">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-amber-400" />
                <CardTitle className="text-base text-foreground">Race Result</CardTitle>
              </div>
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400">
                {result.race_id ?? "—"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <Crown className="h-5 w-5 text-amber-400" />
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Winner</span>
                <div className="text-sm font-bold text-amber-400">
                  {result.winner?.node_id ?? result.winner ?? "—"}
                </div>
              </div>
            </div>
            {Array.isArray(result.results) && result.results.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  worker results
                </span>
                {result.results.map((r: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      {r.node_id === (result.winner?.node_id ?? result.winner) ? (
                        <Crown className="h-3.5 w-3.5 text-amber-400" />
                      ) : (
                        <span className="text-muted-foreground/60 tabular-nums">#{i + 1}</span>
                      )}
                      <span className="font-medium text-foreground/90">{r.node_id ?? "—"}</span>
                    </div>
                    <div className="flex items-center gap-4 text-muted-foreground">
                      <span className="text-emerald-400">
                        {typeof r.tokens_per_second === "number"
                          ? `${r.tokens_per_second.toFixed(1)} tok/s`
                          : "—"}
                      </span>
                      <span>{r.time_ms ?? "—"} ms</span>
                      <span>{r.tokens_generated ?? "—"} tok</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Worker stats */}
      {workerStats.length > 0 && (
        <Card className="border-border bg-card/50">
          <CardHeader>
            <CardTitle className="text-base text-foreground">Worker Leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {workerStats
                .sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0))
                .map((w, i) => (
                  <div
                    key={w.node_id ?? i}
                    className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      {i === 0 ? (
                        <Crown className="h-3.5 w-3.5 text-amber-400" />
                      ) : (
                        <span className="text-muted-foreground/60 tabular-nums">#{i + 1}</span>
                      )}
                      <span className="text-xs font-medium text-foreground/90">
                        {w.node_id ?? w.name ?? "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-right">
                        <span className="font-bold text-amber-400 tabular-nums">{w.wins ?? 0}</span>
                        <span className="ml-1 text-muted-foreground/60">wins</span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-foreground tabular-nums">
                          {w.races ?? 0}
                        </span>
                        <span className="ml-1 text-muted-foreground/60">races</span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-emerald-400 tabular-nums">
                          {typeof w.avg_tokens_per_second === "number"
                            ? w.avg_tokens_per_second.toFixed(1)
                            : "—"}
                        </span>
                        <span className="ml-1 text-muted-foreground/60">avg tok/s</span>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent races */}
      <Card className="border-border bg-card/50">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Recent Races</CardTitle>
        </CardHeader>
        <CardContent>
          {racesLoading ? (
            <LoadingState label="Loading races..." />
          ) : raceList.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No races have been run yet.</p>
          ) : (
            <div className="space-y-2">
              {raceList.slice(0, 10).map((r) => (
                <div
                  key={r.race_id}
                  className="rounded-lg border border-border bg-card/40 p-3 text-xs"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <Crown className="h-3.5 w-3.5 text-amber-400" />
                      <span className="font-bold text-amber-400">
                        {r.winner?.node_id ?? r.winner ?? "—"}
                      </span>
                      <span className="text-muted-foreground/60">won</span>
                    </div>
                    <span className="text-muted-foreground/60">{r.timestamp ?? ""}</span>
                  </div>
                  <p className="line-clamp-1 text-muted-foreground">
                    <span className="text-muted-foreground/60">prompt:</span> {r.prompt}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Users className="h-3 w-3 text-muted-foreground/60" />
                    <span className="text-muted-foreground">
                      {Array.isArray(r.workers) ? r.workers.length : r.workers ?? 0} workers
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
