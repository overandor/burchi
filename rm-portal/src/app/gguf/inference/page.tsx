"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Clock, Cpu, Gauge, Play, Terminal } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader } from "@/components/ui-helpers"

export default function GgufInferencePage() {
  const { data: models, loading: modelsLoading } = useApi<any[]>(
    () => api.ggufModels(),
    [],
    30000,
  )
  const { data: logs, loading: logsLoading, refetch: refetchLogs } = useApi<any[]>(
    () => api.ggufInferenceLogs(),
    [],
    15000,
  )

  const [prompt, setPrompt] = useState("Explain gradient descent in one paragraph.")
  const [modelId, setModelId] = useState("qwen2-0.5b-q3k")
  const [maxTokens, setMaxTokens] = useState(128)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)

  const modelList = models ?? []
  const inferenceLogs = logs ?? []

  async function runInference() {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await api.ggufRunInference(prompt, modelId, maxTokens)
      if (res === null) {
        setError("Inference request failed. Check that a node is reachable.")
      } else {
        setResult(res)
        refetchLogs()
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

  if (modelsLoading) return <LoadingState label="Loading inference playground..." />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inference Playground"
        subtitle="Run prompts against torrent-distributed GGUF models and inspect timing stats"
      />

      {/* Playground */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-blue-400" />
            <CardTitle className="text-base text-white">Prompt</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-700"
              placeholder="Enter your prompt..."
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-wider text-zinc-500">Model</label>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 text-sm text-zinc-200 outline-none focus:border-zinc-700"
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
              <label className="text-[10px] uppercase tracking-wider text-zinc-500">
                Max Tokens
              </label>
              <input
                type="number"
                min={1}
                max={2048}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value) || 128)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 text-sm text-zinc-200 outline-none focus:border-zinc-700"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={runInference} disabled={running || !prompt.trim()}>
              <Play className="mr-2 h-4 w-4" />
              {running ? "Running..." : "Run Inference"}
            </Button>
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Result */}
      {result && (
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-emerald-400" />
                <CardTitle className="text-base text-white">Response</CardTitle>
              </div>
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                {result.model_id ?? modelId}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-sm leading-relaxed text-zinc-200">
              {result.response ?? "(empty response)"}
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="flex flex-col items-center rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <Gauge className="h-3.5 w-3.5 text-emerald-400 mb-1" />
                <span className="text-sm font-bold text-emerald-400 tabular-nums">
                  {typeof result.tokens_per_second === "number"
                    ? result.tokens_per_second.toFixed(1)
                    : "—"}
                </span>
                <span className="text-[9px] text-zinc-600">tokens/s</span>
              </div>
              <div className="flex flex-col items-center rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <Clock className="h-3.5 w-3.5 text-zinc-500 mb-1" />
                <span className="text-sm font-bold text-white tabular-nums">
                  {result.time_ms ?? "—"} ms
                </span>
                <span className="text-[9px] text-zinc-600">latency</span>
              </div>
              <div className="flex flex-col items-center rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <Cpu className="h-3.5 w-3.5 text-zinc-500 mb-1" />
                <span className="text-sm font-bold text-white tabular-nums">
                  {result.tokens_generated ?? "—"}
                </span>
                <span className="text-[9px] text-zinc-600">generated</span>
              </div>
              <div className="flex flex-col items-center rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <Terminal className="h-3.5 w-3.5 text-zinc-500 mb-1" />
                <span className="text-sm font-bold text-white tabular-nums truncate max-w-full">
                  {result.node_id ?? "—"}
                </span>
                <span className="text-[9px] text-zinc-600">node</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent logs */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader>
          <CardTitle className="text-base text-white">Recent Inference Logs</CardTitle>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <LoadingState label="Loading logs..." />
          ) : inferenceLogs.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">No inference logs yet.</p>
          ) : (
            <div className="space-y-2">
              {inferenceLogs.slice(0, 10).map((log) => (
                <div
                  key={log.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="border-blue-500/30 bg-blue-500/10 text-[10px] text-blue-400"
                      >
                        {log.model_id}
                      </Badge>
                      <span className="text-zinc-600">{log.node_id}</span>
                    </div>
                    <div className="flex items-center gap-3 text-zinc-500">
                      <span className="text-emerald-400">
                        {typeof log.tokens_per_second === "number"
                          ? `${log.tokens_per_second.toFixed(1)} tok/s`
                          : "—"}
                      </span>
                      <span>{log.time_ms ?? "—"} ms</span>
                      <span>{log.tokens_generated ?? "—"} tok</span>
                    </div>
                  </div>
                  <p className="line-clamp-2 text-zinc-400">
                    <span className="text-zinc-600">prompt:</span> {log.prompt}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
