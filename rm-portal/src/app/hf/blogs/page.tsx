"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FileText, BookOpen, Calendar, Hash } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"

export default function HfBlogsPage() {
  const { data, loading } = useApi<any[]>(() => api.hfBlogs(100, 0), [], 30000)
  const { data: counts } = useApi<Record<string, number>>(() => api.hfCounts(), [], 30000)

  if (loading || !data) return <LoadingState label="Loading blogs..." />

  const blogs = data
  const total = counts?._count_blogs ?? blogs.length
  const topics = new Set(blogs.map((b: any) => b.topic).filter(Boolean))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Generated Blog Posts"
        subtitle="AI-generated blog content for SEO and content marketing"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={BookOpen} value={total} label="Total Blogs" color="text-blue-400" />
        <StatCard icon={FileText} value={blogs.length} label="Loaded" color="text-cyan-400" />
        <StatCard icon={Hash} value={topics.size} label="Unique Topics" color="text-purple-400" />
        <StatCard icon={Calendar} value={blogs.length > 0 ? blogs[0].date_generated ?? "—" : "—"} label="Latest" color="text-amber-400" />
      </div>

      <div className="space-y-3">
        {blogs.map((b: any, i: number) => (
          <Card key={b.id ?? i} className="border-border bg-card/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm text-foreground">{b.filename ?? `Blog #${b.id ?? i}`}</CardTitle>
                {b.topic && (
                  <Badge variant="outline" className="border-purple-500/30 bg-purple-500/10 text-purple-400 text-[9px]">
                    {b.topic}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {b.content && (
                <p className="line-clamp-3 text-xs text-muted-foreground">{b.content}</p>
              )}
              {b.date_generated && (
                <p className="text-[10px] text-muted-foreground/60">Generated: {b.date_generated}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
