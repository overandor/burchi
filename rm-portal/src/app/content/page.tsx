"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { FileText, Plus, Sparkles, TrendingUp } from "lucide-react"
import { useApi, api, type ContentItem } from "@/lib/api"
import { LoadingState, PageHeader, statusBadgeClass, scoreColor } from "@/components/ui-helpers"

const typeFilters = ["All", "Bio", "Blog", "Social", "SEO", "Email", "Interview"] as const

const typeBadgeClass: Record<string, string> = {
  bio: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  blog: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  social: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  seo: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  email: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  interview: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
}

function typeBadgeClassFor(type: string): string {
  return typeBadgeClass[type.toLowerCase()] || "border-zinc-700 bg-zinc-800/50 text-zinc-400"
}

export default function ContentStudioPage() {
  const { data, loading, refetch } = useApi<ContentItem[]>(() => api.getContent("", 50), [], 15000)
  const [activeFilter, setActiveFilter] = useState<(typeof typeFilters)[number]>("All")
  const [generating, setGenerating] = useState(false)

  if (loading || !data) return <LoadingState label="Loading content studio..." />

  const allContent = data || []
  const filtered =
    activeFilter === "All"
      ? allContent
      : allContent.filter((c) => c.type.toLowerCase() === activeFilter.toLowerCase())

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      await api.aiGenerate("bio", "", 3)
      await refetch()
    } finally {
      setGenerating(false)
    }
  }

  const counts = typeFilters.slice(1).reduce<Record<string, number>>((acc, t) => {
    acc[t] = allContent.filter((c) => c.type.toLowerCase() === t.toLowerCase()).length
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Content Studio" subtitle="Generate and manage AI content across channels" />
        <Button onClick={handleGenerate} disabled={generating} size="sm">
          <Sparkles className="h-4 w-4" />
          {generating ? "Generating..." : "Generate"}
        </Button>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {typeFilters.map((filter) => {
          const isActive = activeFilter === filter
          const count = filter === "All" ? allContent.length : counts[filter] || 0
          return (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "border-zinc-600 bg-zinc-800 text-white"
                  : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
              }`}
            >
              {filter}
              <span className="rounded-full bg-zinc-800 px-1.5 text-[10px] tabular-nums text-zinc-400">{count}</span>
            </button>
          )
        })}
      </div>

      {/* Content Grid */}
      {filtered.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16">
            <FileText className="h-8 w-8 text-zinc-600" />
            <p className="text-sm text-zinc-500">No {activeFilter !== "All" ? activeFilter.toLowerCase() : ""} content yet</p>
            <Button onClick={handleGenerate} disabled={generating} variant="outline" size="sm" className="mt-2">
              <Plus className="h-4 w-4" />
              Generate content
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <Card key={item.id} className="border-zinc-800 bg-zinc-900/50">
              <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
                <div className="space-y-1">
                  <Badge variant="outline" className={`text-[9px] uppercase ${typeBadgeClassFor(item.type)}`}>
                    {item.type}
                  </Badge>
                  <CardTitle className="text-sm text-white">{item.title}</CardTitle>
                </div>
                <Badge variant="outline" className={`text-[9px] ${statusBadgeClass(item.status)}`}>
                  {item.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="line-clamp-3 text-xs text-zinc-400">{item.body}</p>
                <Separator className="bg-zinc-800" />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-600 tabular-nums">
                    {new Date(item.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                  {item.performance_score > 0 && (
                    <div className="flex items-center gap-1">
                      <TrendingUp className={`h-3 w-3 ${scoreColor(item.performance_score)}`} />
                      <span className={`text-xs font-bold tabular-nums ${scoreColor(item.performance_score)}`}>
                        {(item.performance_score * 100).toFixed(0)}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
