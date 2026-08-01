"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Boxes, Cpu, Layers, Plus, Server, Zap } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"

const RUNTIME_COLORS: Record<string, string> = {
  llama_cpp: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  vllm: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  transformers: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  onnxruntime: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  diffusers: "border-pink-500/30 bg-pink-500/10 text-pink-400",
  sentence_transformers: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
  custom: "border-border/80 bg-accent/30 text-foreground/80",
}

function runtimeBadgeClass(runtime: string): string {
  return RUNTIME_COLORS[runtime] ?? RUNTIME_COLORS.custom
}

export default function CompilerRegistryPage() {
  const { data, loading, error } = useApi<{ compiled: any[]; total: number }>(
    () => api.compilerModels(),
    [],
    30000,
  )

  if (loading) return <LoadingState label="Loading compiled models..." />

  const compiled = data?.compiled ?? []
  const total = data?.total ?? compiled.length

  // Count by runtime
  const runtimeCounts: Record<string, number> = {}
  for (const m of compiled) {
    const rt = m.runtime ?? m.execution_plan?.runtime ?? "custom"
    runtimeCounts[rt] = (runtimeCounts[rt] ?? 0) + 1
  }
  const runtimeEntries = Object.entries(runtimeCounts)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader
          title="Compiled Models Registry"
          subtitle="All models compiled into universal /v1/* inference endpoints"
        />
        <Link href="/compiler">
          <Button variant="outline">
            <Plus className="mr-2 h-4 w-4" />
            Compile More
          </Button>
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Boxes} value={total} label="Total Compiled" color="text-blue-400" />
        {runtimeEntries.slice(0, 3).map(([rt, count]) => (
          <StatCard
            key={rt}
            icon={Cpu}
            value={count}
            label={rt.replace(/_/g, " ")}
            color="text-emerald-400"
          />
        ))}
      </div>

      {error && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-4 text-sm text-amber-400">
            Backend unreachable — showing last known state.
          </CardContent>
        </Card>
      )}

      {/* Models grid */}
      {compiled.length === 0 ? (
        <Card className="border-border bg-card/50">
          <CardContent className="py-12 text-center space-y-3">
            <Boxes className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No models compiled yet.</p>
            <Link href="/compiler">
              <Button variant="outline" size="sm">
                <Plus className="mr-2 h-3.5 w-3.5" />
                Compile your first model
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {compiled.map((m, i) => {
            const runtime = m.runtime ?? m.execution_plan?.runtime ?? "custom"
            const arch = m.architectures?.[0] ?? m.model_type ?? "—"
            return (
              <Card key={m.registered_model_id ?? m.repo_id ?? i} className="border-border bg-card/50">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-blue-400" />
                    <CardTitle className="text-sm text-foreground">
                      {m.model_name ?? m.repo_id ?? "Unknown"}
                    </CardTitle>
                  </div>
                  <Badge variant="outline" className={runtimeBadgeClass(runtime)}>
                    {runtime}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                      <Zap className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                      <span className="text-sm font-bold text-foreground truncate max-w-full">{arch}</span>
                      <span className="text-[9px] text-muted-foreground/60">architecture</span>
                    </div>
                    <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                      <Layers className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                      <span className="text-sm font-bold text-foreground">
                        {m.quantization ?? "none"}
                      </span>
                      <span className="text-[9px] text-muted-foreground/60">quantization</span>
                    </div>
                  </div>
                  {m.repo_id && (
                    <div className="space-y-1">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Repo ID</span>
                      <code className="block truncate text-xs text-muted-foreground">{m.repo_id}</code>
                    </div>
                  )}
                  {m.endpoint?.url && (
                    <div className="space-y-1">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Endpoint</span>
                      <pre className="overflow-x-auto rounded-lg border border-border bg-sidebar p-2 text-[10px] text-emerald-400">
                        {m.endpoint.url}
                      </pre>
                    </div>
                  )}
                  {m.endpoint?.status && (
                    <div className="flex items-center justify-between border-t border-border pt-2">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Status</span>
                      <Badge
                        variant="outline"
                        className={
                          m.endpoint.status === "ready" || m.endpoint.status === "running"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : "border-amber-500/30 bg-amber-500/10 text-amber-400"
                        }
                      >
                        <Server className="mr-1 h-2.5 w-2.5" />
                        {m.endpoint.status}
                      </Badge>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
