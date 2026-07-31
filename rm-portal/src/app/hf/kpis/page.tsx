"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  CartesianGrid,
} from "recharts"
import { Activity, Eye, MousePointerClick, TrendingUp, Infinity as InfinityIcon, Zap, Calendar } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader, StatCard, scoreColor } from "@/components/ui-helpers"

function gradeColor(grade: string) {
  if (grade?.startsWith("A")) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
  if (grade?.startsWith("B")) return "border-blue-500/30 bg-blue-500/10 text-blue-400"
  if (grade?.startsWith("C")) return "border-amber-500/30 bg-amber-500/10 text-amber-400"
  return "border-red-500/30 bg-red-500/10 text-red-400"
}

export default function HfKpisPage() {
  const { data, loading } = useApi<any[]>(() => api.hfKPIs(200, 0), [], 30000)
  const { data: counts } = useApi<Record<string, number>>(() => api.hfCounts(), [], 30000)

  if (loading || !data) return <LoadingState label="Loading KPIs..." />

  const kpis = data
  const total = counts?._count_kpis ?? kpis.length
  const latest = kpis.length > 0 ? kpis[0] : null
  const chartData = kpis
    .slice()
    .reverse()
    .map((k: any) => ({
      timestamp: k.timestamp,
      immortality: k.immortality_score ?? 0,
      virality: k.virality_score ?? 0,
      profile_views: k.profile_views ?? 0,
      contact_clicks: k.contact_clicks ?? 0,
    }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="HF KPI Dashboard"
        subtitle="Immortality and virality scores with profile views and contact clicks over time"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={InfinityIcon} value={latest ? (latest.immortality_score ?? 0).toFixed(2) : "—"} label="Immortality Score" color="text-blue-400" />
        <StatCard icon={Zap} value={latest ? (latest.virality_score ?? 0).toFixed(2) : "—"} label="Virality Score" color="text-purple-400" />
        <StatCard icon={Eye} value={latest?.profile_views ?? "—"} label="Profile Views" color="text-cyan-400" />
        <StatCard icon={MousePointerClick} value={latest?.contact_clicks ?? "—"} label="Contact Clicks" color="text-amber-400" />
      </div>

      {/* Latest snapshot grades */}
      {latest && (
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center gap-2">
            <Activity className="h-5 w-5 text-blue-400" />
            <CardTitle className="text-base text-white">Latest Snapshot</CardTitle>
            <Badge variant="outline" className="ml-auto border-zinc-700 bg-zinc-800/50 text-zinc-400 text-[9px]">
              {latest.timestamp ?? "—"}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <InfinityIcon className="h-8 w-8 text-blue-400" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-2xl font-bold ${scoreColor(latest.immortality_score ?? 0)}`}>
                      {(latest.immortality_score ?? 0).toFixed(2)}
                    </span>
                    {latest.immortality_grade && (
                      <Badge variant="outline" className={`text-[9px] ${gradeColor(latest.immortality_grade)}`}>
                        {latest.immortality_grade}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500">Immortality</div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <Zap className="h-8 w-8 text-purple-400" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-2xl font-bold ${scoreColor(latest.virality_score ?? 0)}`}>
                      {(latest.virality_score ?? 0).toFixed(2)}
                    </span>
                    {latest.virality_grade && (
                      <Badge variant="outline" className={`text-[9px] ${gradeColor(latest.virality_grade)}`}>
                        {latest.virality_grade}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500">Virality</div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <Eye className="h-8 w-8 text-cyan-400" />
                <div>
                  <div className="text-2xl font-bold text-white">{latest.profile_views ?? "—"}</div>
                  <div className="text-[10px] text-zinc-500">Profile Views</div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <Calendar className="h-8 w-8 text-amber-400" />
                <div>
                  <div className="text-2xl font-bold text-white">{latest.new_visits ?? "—"}</div>
                  <div className="text-[10px] text-zinc-500">New Visits</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Score trends chart */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <TrendingUp className="h-5 w-5 text-blue-400" />
          <CardTitle className="text-base text-white">Immortality & Virality Trends</CardTitle>
          <Badge variant="outline" className="ml-auto border-zinc-700 bg-zinc-800/50 text-zinc-400 text-[9px]">
            {total} POINTS
          </Badge>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="timestamp" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} domain={[0, 1]} />
                  <RTooltip
                    contentStyle={{
                      background: "#18181b",
                      border: "1px solid #3f3f46",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Line type="monotone" dataKey="immortality" stroke="#60a5fa" strokeWidth={2} dot={false} name="Immortality" />
                  <Line type="monotone" dataKey="virality" stroke="#c084fc" strokeWidth={2} dot={false} name="Virality" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
              No KPI history available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Views & clicks chart */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Eye className="h-5 w-5 text-cyan-400" />
          <CardTitle className="text-base text-white">Profile Views & Contact Clicks</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="timestamp" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                  <RTooltip
                    contentStyle={{
                      background: "#18181b",
                      border: "1px solid #3f3f46",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Line type="monotone" dataKey="profile_views" stroke="#22d3ee" strokeWidth={2} dot={false} name="Profile Views" />
                  <Line type="monotone" dataKey="contact_clicks" stroke="#fbbf24" strokeWidth={2} dot={false} name="Contact Clicks" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
              No view/click history available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
