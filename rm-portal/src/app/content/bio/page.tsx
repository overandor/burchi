"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import { FileText, Sparkles, TrendingUp, Hash } from "lucide-react"
import { useApi, api, type ContentItem } from "@/lib/api"
import { LoadingState, PageHeader, statusBadgeClass, scoreColor } from "@/components/ui-helpers"

export default function BioWorkshopPage() {
  const { data, loading, refetch } = useApi<ContentItem[]>(() => api.getContent("bio", 50), [], 15000)
  const [generating, setGenerating] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (loading || !data) return <LoadingState label="Loading bio workshop..." />

  const bios = data || []
  const selected = bios.find((b) => b.id === selectedId) || bios[0] || null

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      await api.aiGenerate("bio", "", 3)
      await refetch()
    } finally {
      setGenerating(false)
    }
  }

  const avgScore =
    bios.length > 0
      ? bios.reduce((sum, b) => sum + (b.performance_score || 0), 0) / bios.length
      : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Bio Workshop" subtitle="Generate, review, and refine bio variants" />
        <Button onClick={handleGenerate} disabled={generating} size="sm">
          <Sparkles className="h-4 w-4" />
          {generating ? "Generating..." : "Generate Bio Candidates"}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <FileText className="h-6 w-6 text-orange-400" />
          <div>
            <div className="text-xl font-bold text-white">{bios.length}</div>
            <div className="text-[10px] text-zinc-500">Total Bios</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <TrendingUp className="h-6 w-6 text-emerald-400" />
          <div>
            <div className="text-xl font-bold text-white">{(avgScore * 100).toFixed(0)}</div>
            <div className="text-[10px] text-zinc-500">Avg Score</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <Hash className="h-6 w-6 text-blue-400" />
          <div>
            <div className="text-xl font-bold text-white">
              {bios.length > 0 ? Math.round(bios.reduce((s, b) => s + b.body.length, 0) / bios.length) : 0}
            </div>
            <div className="text-[10px] text-zinc-500">Avg Chars</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Bio List */}
        <div className="space-y-3 lg:col-span-3">
          <h2 className="text-sm font-semibold text-zinc-300">Candidates</h2>
          {bios.length === 0 ? (
            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardContent className="flex flex-col items-center justify-center gap-2 py-16">
                <FileText className="h-8 w-8 text-zinc-600" />
                <p className="text-sm text-zinc-500">No bios generated yet</p>
                <Button onClick={handleGenerate} disabled={generating} variant="outline" size="sm" className="mt-2">
                  <Sparkles className="h-4 w-4" />
                  Generate candidates
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {bios.map((bio) => {
                const isActive = selected?.id === bio.id
                return (
                  <Card
                    key={bio.id}
                    className={`cursor-pointer border bg-zinc-900/50 transition-colors ${
                      isActive ? "border-orange-500/40" : "border-zinc-800 hover:border-zinc-700"
                    }`}
                    onClick={() => setSelectedId(bio.id)}
                  >
                    <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
                      <div className="space-y-1">
                        <CardTitle className="text-sm text-white">{bio.title}</CardTitle>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="border-orange-500/30 bg-orange-500/10 text-orange-400 text-[9px]">
                            BIO
                          </Badge>
                          <Badge variant="outline" className={`text-[9px] ${statusBadgeClass(bio.status)}`}>
                            {bio.status}
                          </Badge>
                        </div>
                      </div>
                      {bio.performance_score > 0 && (
                        <div className="flex items-center gap-1">
                          <TrendingUp className={`h-3 w-3 ${scoreColor(bio.performance_score)}`} />
                          <span className={`text-xs font-bold tabular-nums ${scoreColor(bio.performance_score)}`}>
                            {(bio.performance_score * 100).toFixed(0)}
                          </span>
                        </div>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <p className="line-clamp-2 text-xs text-zinc-400">{bio.body}</p>
                      <Separator className="bg-zinc-800" />
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-zinc-600 tabular-nums">
                          {new Date(bio.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                        <span className="text-[10px] text-zinc-500 tabular-nums">{bio.body.length} chars</span>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        {/* Editor Preview */}
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">Editor</h2>
          {selected ? (
            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
                <CardTitle className="text-sm text-white">{selected.title}</CardTitle>
                <Badge variant="outline" className={`text-[9px] ${statusBadgeClass(selected.status)}`}>
                  {selected.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <textarea
                  defaultValue={selected.body}
                  key={selected.id}
                  className="h-48 w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-200 outline-none focus:border-zinc-600"
                />
                <div className="flex items-center justify-between text-[10px] text-zinc-500">
                  <span className="tabular-nums">{selected.body.length} characters</span>
                  <span className="tabular-nums">
                    {new Date(selected.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                {selected.performance_score > 0 && (
                  <>
                    <Separator className="bg-zinc-800" />
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Performance</span>
                        <span className={`text-sm font-bold ${scoreColor(selected.performance_score)}`}>
                          {(selected.performance_score * 100).toFixed(0)}
                        </span>
                      </div>
                      <Progress value={selected.performance_score * 100} className="h-2 bg-zinc-800" />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardContent className="flex items-center justify-center py-16">
                <p className="text-sm text-zinc-500">Select a bio to edit</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
