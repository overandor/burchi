"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertCircle,
  Cpu,
  Image as ImageIcon,
  MessageSquare,
  Play,
  Send,
  Sparkles,
  Terminal,
} from "lucide-react"
import { api } from "@/lib/api"
import { PageHeader } from "@/components/ui-helpers"

type ApiStyle = "chat" | "completions" | "embeddings" | "images" | "generic"

const API_STYLES: { key: ApiStyle; label: string; icon: React.ElementType; color: string }[] = [
  { key: "chat", label: "Chat", icon: MessageSquare, color: "text-blue-400" },
  { key: "completions", label: "Completions", icon: Terminal, color: "text-emerald-400" },
  { key: "embeddings", label: "Embeddings", icon: Cpu, color: "text-purple-400" },
  { key: "images", label: "Images", icon: ImageIcon, color: "text-pink-400" },
  { key: "generic", label: "Generic", icon: Sparkles, color: "text-amber-400" },
]

const IMAGE_SIZES = ["256x256", "512x512", "1024x1024"]

export default function CompilerPlaygroundPage() {
  const [model, setModel] = useState("")
  const [apiStyle, setApiStyle] = useState<ApiStyle>("chat")

  // Chat / completions state
  const [chatMessage, setChatMessage] = useState("What is the meaning of life?")
  const [maxTokens, setMaxTokens] = useState(128)

  // Embeddings state
  const [embedInput, setEmbedInput] = useState("The quick brown fox jumps over the lazy dog.")

  // Images state
  const [imagePrompt, setImagePrompt] = useState("A serene mountain landscape at sunset, oil painting")
  const [imageSize, setImageSize] = useState("1024x1024")

  // Generic state
  const [genericInput, setGenericInput] = useState("")
  const [genericTask, setGenericTask] = useState("auto")

  // Result state
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  async function runRequest() {
    if (!model.trim()) {
      setError("Please enter a model name or HF repo ID.")
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      let res: any = null
      switch (apiStyle) {
        case "chat":
          res = await api.v1ChatCompletions(
            model.trim(),
            [{ role: "user", content: chatMessage }],
            maxTokens,
          )
          break
        case "completions":
          res = await api.v1Completions(model.trim(), chatMessage, maxTokens)
          break
        case "embeddings":
          res = await api.v1Embeddings(model.trim(), embedInput)
          break
        case "images":
          res = await api.v1Images(model.trim(), imagePrompt, imageSize)
          break
        case "generic":
          res = await api.v1Inference(model.trim(), genericInput, genericTask)
          break
      }
      if (res === null) {
        setError("Request failed. Check that the model is compiled and the backend is reachable.")
      } else {
        setResult(res)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  // Extract display content based on API style
  function getDisplayContent(): string {
    if (!result) return ""
    if (apiStyle === "chat") {
      return result.choices?.[0]?.message?.content ?? result.choices?.[0]?.text ?? ""
    }
    if (apiStyle === "completions") {
      return result.choices?.[0]?.text ?? result.choices?.[0]?.message?.content ?? ""
    }
    if (apiStyle === "embeddings") {
      const emb = result.data?.[0]?.embedding
      if (Array.isArray(emb)) {
        return `Dimensions: ${emb.length}\nFirst 8 values: [${emb.slice(0, 8).map((v: number) => v.toFixed(6)).join(", ")}]`
      }
      return ""
    }
    if (apiStyle === "images") {
      const url = result.data?.[0]?.url
      const b64 = result.data?.[0]?.b64_json
      if (url) return `Image URL: ${url}`
      if (b64) return `Base64 image (${b64.length} chars)`
      return ""
    }
    if (apiStyle === "generic") {
      return result.output ?? result.result ?? JSON.stringify(result, null, 2)
    }
    return ""
  }

  const meta = result?._meta ?? result?.meta
  const displayContent = getDisplayContent()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inference Playground"
        subtitle="Test any compiled model against the universal OpenAI-compatible /v1/* API"
      />

      {/* Model + API style selector */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader>
          <CardTitle className="text-base text-white">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Model / HF Repo ID</label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. TheBloke/TinyLlama-1.1B-Chat-v0.3-GGUF"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-700"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">API Style</label>
            <div className="flex flex-wrap gap-2">
              {API_STYLES.map((s) => {
                const Icon = s.icon
                const active = apiStyle === s.key
                return (
                  <button
                    key={s.key}
                    onClick={() => {
                      setApiStyle(s.key)
                      setResult(null)
                      setError(null)
                    }}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                      active
                        ? "border-zinc-600 bg-zinc-800 text-white"
                        : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${active ? s.color : ""}`} />
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Request builder */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            {(() => {
              const s = API_STYLES.find((x) => x.key === apiStyle)!
              const Icon = s.icon
              return <Icon className={`h-4 w-4 ${s.color}`} />
            })()}
            <CardTitle className="text-base text-white">
              {API_STYLES.find((s) => s.key === apiStyle)?.label} Request
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(apiStyle === "chat" || apiStyle === "completions") && (
            <>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">
                  {apiStyle === "chat" ? "User Message" : "Prompt"}
                </label>
                <textarea
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-700"
                  placeholder="Enter your message..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Max Tokens</label>
                <input
                  type="number"
                  min={1}
                  max={4096}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value) || 128)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 text-sm text-zinc-200 outline-none focus:border-zinc-700"
                />
              </div>
            </>
          )}

          {apiStyle === "embeddings" && (
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-wider text-zinc-500">Input Text</label>
              <textarea
                value={embedInput}
                onChange={(e) => setEmbedInput(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-700"
                placeholder="Text to embed..."
              />
            </div>
          )}

          {apiStyle === "images" && (
            <>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Prompt</label>
                <textarea
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-700"
                  placeholder="Describe the image to generate..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Size</label>
                <div className="flex gap-2">
                  {IMAGE_SIZES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setImageSize(s)}
                      className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                        imageSize === s
                          ? "border-zinc-600 bg-zinc-800 text-white"
                          : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {apiStyle === "generic" && (
            <>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Input</label>
                <textarea
                  value={genericInput}
                  onChange={(e) => setGenericInput(e.target.value)}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-700"
                  placeholder="Input for the model..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Task</label>
                <input
                  value={genericTask}
                  onChange={(e) => setGenericTask(e.target.value)}
                  placeholder="auto"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-700"
                />
              </div>
            </>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={runRequest} disabled={loading || !model.trim()} size="lg">
              {apiStyle === "images" ? (
                <ImageIcon className="mr-2 h-4 w-4" />
              ) : apiStyle === "embeddings" ? (
                <Cpu className="mr-2 h-4 w-4" />
              ) : apiStyle === "chat" ? (
                <Send className="mr-2 h-4 w-4" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {loading
                ? "Running..."
                : apiStyle === "images"
                  ? "Generate"
                  : apiStyle === "embeddings"
                    ? "Generate"
                    : apiStyle === "chat"
                      ? "Send"
                      : "Run"}
            </Button>
            {error && (
              <span className="flex items-center gap-1 text-xs text-red-400">
                <AlertCircle className="h-3 w-3" />
                {error}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Response */}
      {result && (
        <div className="space-y-4">
          {/* Meta */}
          {meta && (
            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardHeader>
                <CardTitle className="text-sm text-white">Response Metadata</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {meta.runtime && (
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                      {meta.runtime}
                    </Badge>
                  )}
                  {meta.status && (
                    <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-400">
                      {meta.status}
                    </Badge>
                  )}
                  {meta.model && (
                    <Badge variant="outline" className="border-zinc-700 bg-zinc-800/50 text-zinc-300">
                      {meta.model}
                    </Badge>
                  )}
                  {meta.tokens_per_second !== undefined && (
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400">
                      {typeof meta.tokens_per_second === "number"
                        ? meta.tokens_per_second.toFixed(1)
                        : meta.tokens_per_second}{" "}
                      tok/s
                    </Badge>
                  )}
                  {meta.latency_ms !== undefined && (
                    <Badge variant="outline" className="border-zinc-700 bg-zinc-800/50 text-zinc-400">
                      {meta.latency_ms} ms
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Display content */}
          {displayContent && (
            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardHeader>
                <CardTitle className="text-sm text-white">Response</CardTitle>
              </CardHeader>
              <CardContent>
                {apiStyle === "images" && result.data?.[0]?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={result.data[0].url}
                    alt="Generated"
                    className="max-w-full rounded-lg border border-zinc-800"
                  />
                ) : (
                  <pre className="whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-sm leading-relaxed text-zinc-200">
                    {displayContent}
                  </pre>
                )}
              </CardContent>
            </Card>
          )}

          {/* Raw JSON */}
          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-zinc-500" />
                <CardTitle className="text-sm text-white">Raw JSON Response</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <pre className="max-h-96 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-emerald-400">
                {JSON.stringify(result, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
