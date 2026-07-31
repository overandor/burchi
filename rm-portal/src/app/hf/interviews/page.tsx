"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Mic, FileText, Calendar, Hash } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"

export default function HfInterviewsPage() {
  const { data, loading } = useApi<any[]>(() => api.hfInterviews(100, 0), [], 30000)
  const { data: counts } = useApi<Record<string, number>>(() => api.hfCounts(), [], 30000)

  if (loading || !data) return <LoadingState label="Loading interviews..." />

  const interviews = data
  const total = counts?._count_interviews ?? interviews.length
  const angles = new Set(interviews.map((iv: any) => iv.angle).filter(Boolean))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Generated Interview Sets"
        subtitle="AI-generated interview Q&A sets for content and SEO angles"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Mic} value={total} label="Total Interviews" color="text-blue-400" />
        <StatCard icon={FileText} value={interviews.length} label="Loaded" color="text-cyan-400" />
        <StatCard icon={Hash} value={angles.size} label="Unique Angles" color="text-purple-400" />
        <StatCard icon={Calendar} value={interviews.length > 0 ? interviews[0].date_generated ?? "—" : "—"} label="Latest" color="text-amber-400" />
      </div>

      <div className="space-y-3">
        {interviews.map((iv: any, i: number) => (
          <Card key={iv.id ?? i} className="border-zinc-800 bg-zinc-900/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm text-white">{iv.filename ?? `Interview #${iv.id ?? i}`}</CardTitle>
                {iv.angle && (
                  <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-400 text-[9px]">
                    {iv.angle}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {iv.content && (
                <p className="line-clamp-3 text-xs text-zinc-400">{iv.content}</p>
              )}
              {iv.date_generated && (
                <p className="text-[10px] text-zinc-600">Generated: {iv.date_generated}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
