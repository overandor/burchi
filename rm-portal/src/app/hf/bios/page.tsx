"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FileText, Sparkles, Calendar, Layers } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"

export default function HfBiosPage() {
  const { data, loading } = useApi<any[]>(() => api.hfBios(100, 0), [], 30000)
  const { data: counts } = useApi<Record<string, number>>(() => api.hfCounts(), [], 30000)

  if (loading || !data) return <LoadingState label="Loading bios..." />

  const bios = data
  const total = counts?._count_bios ?? bios.length
  const strategies = new Set(bios.map((b: any) => b.strategy).filter(Boolean))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Generated Bios"
        subtitle="AI-generated bio variants with strategy labels and generation dates"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={FileText} value={total} label="Total Bios" color="text-blue-400" />
        <StatCard icon={Sparkles} value={bios.length} label="Loaded" color="text-cyan-400" />
        <StatCard icon={Layers} value={strategies.size} label="Strategies" color="text-purple-400" />
        <StatCard icon={Calendar} value={bios.length > 0 ? bios[0].date_generated ?? "—" : "—"} label="Latest" color="text-amber-400" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {bios.map((b: any, i: number) => (
          <Card key={b.id ?? i} className="border-zinc-800 bg-zinc-900/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm text-white">{b.filename ?? `Bio #${b.id ?? i}`}</CardTitle>
                {b.strategy && (
                  <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-400 text-[9px]">
                    {b.strategy}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {b.bio_text && (
                <p className="line-clamp-4 text-xs text-zinc-400">{b.bio_text}</p>
              )}
              {b.date_generated && (
                <p className="text-[10px] text-zinc-600">Generated: {b.date_generated}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
