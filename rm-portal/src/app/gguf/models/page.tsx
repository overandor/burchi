"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Boxes, Cpu, HardDrive, Layers, Link2, Server, Zap } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader } from "@/components/ui-helpers"

function formatSize(mb: number): string {
  if (!mb && mb !== 0) return "—"
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}

function formatParams(count: number): string {
  if (!count && count !== 0) return "—"
  if (count >= 1e9) return `${(count / 1e9).toFixed(1)}B`
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}K`
  return String(count)
}

export default function GgufModelsPage() {
  const { data, loading } = useApi<any[]>(() => api.ggufModels(), [], 20000)
  const [showRegister, setShowRegister] = useState(false)

  if (loading) return <LoadingState label="Loading GGUF models..." />

  const models = data ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader
          title="GGUF Models"
          subtitle="Torrent-distributed GGUF models available across the inference network"
        />
        <Button variant="outline" onClick={() => setShowRegister((s) => !s)}>
          <Boxes className="mr-2 h-4 w-4" />
          Register Model
        </Button>
      </div>

      {showRegister && (
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="py-6 text-center text-sm text-zinc-500">
            Model registration is a placeholder. Connect a tracker node to publish a new GGUF model
            to the swarm.
          </CardContent>
        </Card>
      )}

      {models.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="py-12 text-center text-sm text-zinc-500">
            No models registered yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {models.map((m) => (
            <Card key={m.model_id} className="border-zinc-800 bg-zinc-900/50">
              <CardHeader className="flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-blue-400" />
                  <CardTitle className="text-sm text-white">{m.name ?? m.model_id}</CardTitle>
                </div>
                <Badge variant="outline" className="border-zinc-700 bg-zinc-800/50 text-zinc-300">
                  {m.quantization ?? "—"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col items-center rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                    <Cpu className="h-3.5 w-3.5 text-zinc-500 mb-1" />
                    <span className="text-sm font-bold text-white tabular-nums">
                      {formatParams(m.parameter_count)}
                    </span>
                    <span className="text-[9px] text-zinc-600">parameters</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                    <HardDrive className="h-3.5 w-3.5 text-zinc-500 mb-1" />
                    <span className="text-sm font-bold text-white tabular-nums">
                      {formatSize(m.model_size)}
                    </span>
                    <span className="text-[9px] text-zinc-600">size</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                    <Layers className="h-3.5 w-3.5 text-zinc-500 mb-1" />
                    <span className="text-sm font-bold text-white tabular-nums">
                      {m.chunk_count ?? "—"}
                    </span>
                    <span className="text-[9px] text-zinc-600">chunks</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                    <Zap className="h-3.5 w-3.5 text-zinc-500 mb-1" />
                    <span className="text-sm font-bold text-white tabular-nums">
                      {m.architecture ?? "—"}
                    </span>
                    <span className="text-[9px] text-zinc-600">arch</span>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Link2 className="h-3 w-3 text-zinc-600" />
                    <span className="text-zinc-600">tracker:</span>
                    <span className="truncate text-zinc-300">{m.tracker_url ?? "—"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Server className="h-3 w-3 text-zinc-600" />
                    <span className="text-zinc-600">inference:</span>
                    <span className="truncate text-zinc-300">{m.inference_url ?? "—"}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 border-t border-zinc-800 pt-3">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-600">merkle</span>
                  <code className="truncate text-[10px] text-zinc-500">
                    {m.merkle_root ? String(m.merkle_root).slice(0, 24) + "…" : "—"}
                  </code>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
