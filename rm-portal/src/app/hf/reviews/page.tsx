"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Star, MessageSquare, User, UserCheck, FileText } from "lucide-react"
import { useApi, api } from "@/lib/api"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"

function ratingColor(rating: number) {
  if (rating >= 4.5) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
  if (rating >= 3.5) return "border-blue-500/30 bg-blue-500/10 text-blue-400"
  if (rating >= 2.5) return "border-amber-500/30 bg-amber-500/10 text-amber-400"
  return "border-red-500/30 bg-red-500/10 text-red-400"
}

export default function HfReviewsPage() {
  const { data, loading } = useApi<any[]>(() => api.hfReviews(100, 0), [], 30000)
  const { data: counts } = useApi<Record<string, number>>(() => api.hfCounts(), [], 30000)

  if (loading || !data) return <LoadingState label="Loading reviews..." />

  const reviews = data
  const total = counts?._count_reviews ?? reviews.length
  const avgRating =
    reviews.length > 0
      ? (reviews.reduce((s: number, r: any) => s + (r.rating || 0), 0) / reviews.length).toFixed(2)
      : "—"
  const sources = new Set(reviews.map((r: any) => r.source).filter(Boolean))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Client Reviews"
        subtitle="Scraped reviews from clients across sources, with ratings and sentiment"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={FileText} value={total} label="Total Reviews" color="text-blue-400" />
        <StatCard icon={Star} value={avgRating} label="Avg Rating" color="text-amber-400" />
        <StatCard icon={User} value={new Set(reviews.map((r: any) => r.reviewer).filter(Boolean)).size} label="Unique Reviewers" color="text-purple-400" />
        <StatCard icon={UserCheck} value={sources.size} label="Sources" color="text-emerald-400" />
      </div>

      <div className="space-y-3">
        {reviews.map((r: any, i: number) => (
          <Card key={r.id ?? i} className="border-zinc-800 bg-zinc-900/50">
            <CardContent className="space-y-2 pt-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">{r.reviewer ?? "Anonymous"}</span>
                  <span className="text-xs text-zinc-600">→</span>
                  <span className="text-sm text-zinc-400">{r.masseur ?? "—"}</span>
                </div>
                <div className="flex items-center gap-2">
                  {r.source && (
                    <Badge variant="outline" className="border-zinc-700 bg-zinc-800/50 text-zinc-400 text-[9px]">
                      {r.source}
                    </Badge>
                  )}
                  {r.rating != null && (
                    <Badge variant="outline" className={`text-[9px] ${ratingColor(r.rating)}`}>
                      <Star className="mr-1 h-2.5 w-2.5" />
                      {r.rating.toFixed(1)}
                    </Badge>
                  )}
                </div>
              </div>
              {r.review_text && (
                <p className="text-sm text-zinc-400">{r.review_text}</p>
              )}
              {r.scraped_at && (
                <p className="text-[10px] text-zinc-600">Scraped: {r.scraped_at}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
