"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertCircle,
  Boxes,
  Cpu,
  FileBox,
  Gauge,
  HardDrive,
  Heart,
  Layers,
  Link2,
  Lock,
  MemoryStick,
  Play,
  Sparkles,
  Tag,
  Terminal,
  Zap,
} from "lucide-react"
import { api } from "@/lib/api"
import { LoadingState, PageHeader } from "@/components/ui-helpers"

const EXAMPLE_MODELS = [
  "TheBloke/TinyLlama-1.1B-Chat-v0.3-GGUF",
  "microsoft/phi-2",
  "sentence-transformers/all-MiniLM-L6-v2",
  "stable-diffusion-v1-5/stable-diffusion-v1-5",
]

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

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "—"
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`
  return `${bytes} B`
}

function formatNum(n: number | null): string {
  if (n === null || n === undefined) return "—"
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

interface ExecutionPlan {
  runtime: string
  runtime_description: string
  api_style: string
  target_endpoint: string
  estimated_vram_mb: number | null
  estimated_ram_mb: number | null
  requires_gpu: boolean
  notes: string[]
  missing_requirements: string[]
}

interface ModelFile {
  filename: string
  format: string
  size: number
}

interface CompileResult {
  repo_id: string
  author: string
  model_name: string
  pipeline_tag: string | null
  library_name: string | null
  tags: string[]
  architectures: string[]
  model_type: string | null
  vocab_size: number | null
  hidden_size: number | null
  num_hidden_layers: number | null
  torch_dtype: string | null
  files: ModelFile[]
  formats_detected: string[]
  total_size_bytes: number | null
  quantization: string | null
  execution_plan: ExecutionPlan
  gated: boolean
  private: boolean
  downloads: number
  likes: number
  error: string | null
  endpoint?: {
    url: string
    runtime: string
    api_style: string
    status: string
    missing: string[]
  }
  registered_model_id?: string | null
}

export default function CompilerPage() {
  const [repoId, setRepoId] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CompileResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleCompile(id?: string) {
    const target = (id ?? repoId).trim()
    if (!target) return
    if (id) setRepoId(id)
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await api.compilerCompile(target)
      if (res === null) {
        setError(`Failed to compile "${target}". The model may not exist or the backend is unreachable.`)
      } else if (res.error) {
        setError(res.error)
        setResult(res)
      } else {
        setResult(res)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="HF Model Compiler"
        subtitle="Inspect any Hugging Face repo and compile it into a universal /v1/* inference endpoint"
      />

      {/* Hero input */}
      <Card className="border-border bg-card/50">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Hugging Face Repo ID
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={repoId}
                onChange={(e) => setRepoId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCompile()}
                placeholder="e.g. TheBloke/TinyLlama-1.1B-Chat-v0.3-GGUF"
                className="flex-1 rounded-lg border border-border bg-accent/50 p-2.5 text-sm text-foreground/90 outline-none placeholder:text-muted-foreground/60 focus:border-border/80"
              />
              <Button onClick={() => handleCompile()} disabled={loading || !repoId.trim()} size="lg">
                <Play className="mr-2 h-4 w-4" />
                {loading ? "Compiling..." : "Compile"}
              </Button>
            </div>
          </div>

          {/* Example chips */}
          <div className="space-y-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Try an example</span>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_MODELS.map((m) => (
                <button
                  key={m}
                  onClick={() => handleCompile(m)}
                  disabled={loading}
                  className="rounded-full border border-border bg-accent/50 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-border/80 hover:text-foreground/90 disabled:opacity-50"
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {loading && (
        <Card className="border-border bg-card/50">
          <CardContent className="py-6">
            <LoadingState label={`Compiling ${repoId}...`} />
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && !loading && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="flex items-center gap-2 py-6">
            <AlertCircle className="h-4 w-4 text-red-400" />
            <span className="text-sm text-red-400">{error}</span>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="space-y-6">
          {/* Model metadata */}
          <Card className="border-border bg-card/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Boxes className="h-4 w-4 text-blue-400" />
                  <CardTitle className="text-base text-foreground">Model Metadata</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  {result.gated && (
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400">
                      <Lock className="mr-1 h-2.5 w-2.5" />
                      GATED
                    </Badge>
                  )}
                  {result.private && (
                    <Badge variant="outline" className="border-border/80 bg-accent/30 text-muted-foreground">
                      <Lock className="mr-1 h-2.5 w-2.5" />
                      PRIVATE
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Repo ID</span>
                  <code className="block truncate text-sm text-foreground/90">{result.repo_id}</code>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Author</span>
                  <span className="text-sm text-foreground/90">{result.author}</span>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Model Name</span>
                  <span className="text-sm text-foreground/90">{result.model_name}</span>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Pipeline Tag</span>
                  <span className="text-sm text-foreground/90">{result.pipeline_tag ?? "—"}</span>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Library</span>
                  <span className="text-sm text-foreground/90">{result.library_name ?? "—"}</span>
                </div>
                <div className="flex gap-6">
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Downloads</span>
                    <div className="flex items-center gap-1 text-sm text-foreground/90">
                      <Gauge className="h-3 w-3 text-muted-foreground" />
                      {formatNum(result.downloads)}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Likes</span>
                    <div className="flex items-center gap-1 text-sm text-foreground/90">
                      <Heart className="h-3 w-3 text-pink-400" />
                      {formatNum(result.likes)}
                    </div>
                  </div>
                </div>
              </div>
              {result.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
                  <Tag className="h-3 w-3 text-muted-foreground/60" />
                  {result.tags.slice(0, 12).map((t) => (
                    <Badge key={t} variant="outline" className="border-border/80 bg-accent/30 text-[10px] text-muted-foreground">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Architecture */}
            <Card className="border-border bg-card/50">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-purple-400" />
                  <CardTitle className="text-base text-foreground">Architecture</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                    <Cpu className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                    <span className="text-sm font-bold text-foreground">
                      {result.architectures.length > 0 ? result.architectures.join(", ") : "—"}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">architectures</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                    <span className="text-sm font-bold text-foreground">{result.model_type ?? "—"}</span>
                    <span className="text-[9px] text-muted-foreground/60">model type</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                    <Terminal className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                    <span className="text-sm font-bold text-foreground tabular-nums">
                      {formatNum(result.vocab_size)}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">vocab size</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                    <MemoryStick className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                    <span className="text-sm font-bold text-foreground tabular-nums">
                      {result.hidden_size ?? "—"}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">hidden size</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                    <span className="text-sm font-bold text-foreground tabular-nums">
                      {result.num_hidden_layers ?? "—"}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">layers</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                    <Zap className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                    <span className="text-sm font-bold text-foreground">{result.torch_dtype ?? "—"}</span>
                    <span className="text-[9px] text-muted-foreground/60">dtype</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Files */}
            <Card className="border-border bg-card/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileBox className="h-4 w-4 text-emerald-400" />
                    <CardTitle className="text-base text-foreground">Files & Formats</CardTitle>
                  </div>
                  <Badge variant="outline" className="border-border/80 bg-accent/30 text-foreground/80">
                    {result.files.length} files
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {result.formats_detected.length > 0 ? (
                    result.formats_detected.map((f) => (
                      <Badge
                        key={f}
                        variant="outline"
                        className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      >
                        {f}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">No formats detected</span>
                  )}
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {result.files.slice(0, 12).map((f) => (
                    <div
                      key={f.filename}
                      className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2 text-xs"
                    >
                      <span className="truncate text-foreground/80">{f.filename}</span>
                      <div className="flex items-center gap-2">
                        {f.format && (
                          <Badge variant="outline" className="border-border/80 bg-accent/30 text-[9px] text-muted-foreground">
                            {f.format}
                          </Badge>
                        )}
                        <span className="tabular-nums text-muted-foreground">{formatBytes(f.size)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {result.total_size_bytes !== null && (
                  <div className="flex items-center justify-between border-t border-border pt-3 text-xs">
                    <span className="text-muted-foreground/60">Total size</span>
                    <span className="font-bold text-foreground/90 tabular-nums">
                      {formatBytes(result.total_size_bytes)}
                    </span>
                  </div>
                )}
                {result.quantization && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground/60">Quantization</span>
                    <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-400">
                      {result.quantization}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Execution plan */}
          {result.execution_plan && (
            <Card className="border-border bg-card/50">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-400" />
                  <CardTitle className="text-base text-foreground">Execution Plan</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Runtime</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={runtimeBadgeClass(result.execution_plan.runtime)}>
                        {result.execution_plan.runtime}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{result.execution_plan.api_style}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Target Endpoint</span>
                    <pre className="overflow-x-auto rounded-lg border border-border bg-sidebar p-2.5 text-xs text-emerald-400">
                      {result.execution_plan.target_endpoint}
                    </pre>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">{result.execution_plan.runtime_description}</p>

                {/* Resource estimates */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                    <HardDrive className="h-3.5 w-3.5 text-blue-400 mb-1" />
                    <span className="text-sm font-bold text-foreground tabular-nums">
                      {result.execution_plan.estimated_vram_mb !== null
                        ? `${result.execution_plan.estimated_vram_mb} MB`
                        : "—"}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">VRAM</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                    <MemoryStick className="h-3.5 w-3.5 text-amber-400 mb-1" />
                    <span className="text-sm font-bold text-foreground tabular-nums">
                      {result.execution_plan.estimated_ram_mb !== null
                        ? `${result.execution_plan.estimated_ram_mb} MB`
                        : "—"}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">RAM</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg border border-border bg-card/40 p-3">
                    <Cpu className="h-3.5 w-3.5 text-muted-foreground mb-1" />
                    <span className="text-sm font-bold text-foreground">
                      {result.execution_plan.requires_gpu ? "Required" : "Optional"}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">GPU</span>
                  </div>
                </div>

                {/* Notes */}
                {result.execution_plan.notes.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Notes</span>
                    <ul className="space-y-1">
                      {result.execution_plan.notes.map((n, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <span className="mt-0.5 text-muted-foreground/60">•</span>
                          <span>{n}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Missing requirements */}
                {result.execution_plan.missing_requirements.length > 0 && (
                  <div className="space-y-1.5 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                    <span className="text-[10px] uppercase tracking-wider text-red-400">Missing Requirements</span>
                    <ul className="space-y-1">
                      {result.execution_plan.missing_requirements.map((m, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-red-400">
                          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{m}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Endpoint result */}
          {result.endpoint && (
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Link2 className="h-4 w-4 text-emerald-400" />
                    <CardTitle className="text-base text-foreground">Compiled Endpoint</CardTitle>
                  </div>
                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                    {result.endpoint.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Endpoint URL</span>
                  <pre className="overflow-x-auto rounded-lg border border-border bg-sidebar p-3 text-xs text-emerald-400">
                    {result.endpoint.url}
                  </pre>
                </div>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Runtime</span>
                    <Badge variant="outline" className={runtimeBadgeClass(result.endpoint.runtime)}>
                      {result.endpoint.runtime}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">API Style</span>
                    <span className="text-sm text-foreground/90">{result.endpoint.api_style}</span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Registered Model ID</span>
                    <code className="text-xs text-foreground/80">
                      {result.registered_model_id ?? "—"}
                    </code>
                  </div>
                </div>
                {result.endpoint.missing.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                    <span className="text-xs text-amber-400">
                      Missing: {result.endpoint.missing.join(", ")}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3 border-t border-border pt-3">
                  <Link href="/compiler/playground">
                    <Button variant="outline" size="sm">
                      <Terminal className="mr-2 h-3.5 w-3.5" />
                      Test in Playground
                    </Button>
                  </Link>
                  <Link href="/compiler/registry">
                    <Button variant="ghost" size="sm">
                      <Boxes className="mr-2 h-3.5 w-3.5" />
                      View Registry
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
