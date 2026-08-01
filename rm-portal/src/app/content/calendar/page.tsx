"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Calendar, CalendarDays } from "lucide-react"
import { useApi, api, type ContentItem } from "@/lib/api"
import { LoadingState, PageHeader } from "@/components/ui-helpers"

const typeBadgeClass: Record<string, string> = {
  bio: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  blog: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  social: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  seo: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  email: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  interview: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
}

function typeBadgeClassFor(type: string): string {
  return typeBadgeClass[type.toLowerCase()] || "border-border/80 bg-accent/30 text-muted-foreground"
}

function dateKey(iso: string): string {
  return iso.slice(0, 10)
}

function formatDateLabel(key: string): string {
  const d = new Date(key + "T00:00:00")
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
}

export default function ContentCalendarPage() {
  const { data, loading } = useApi<ContentItem[]>(() => api.getContent("", 100), [], 15000)

  if (loading || !data) return <LoadingState label="Loading content calendar..." />

  const allContent = data || []

  // Group by date
  const grouped = allContent.reduce<Record<string, ContentItem[]>>((acc, item) => {
    const key = dateKey(item.created_at)
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  // Overall type counts
  const typeCounts = allContent.reduce<Record<string, number>>((acc, item) => {
    const t = item.type.toLowerCase()
    acc[t] = (acc[t] || 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Content Calendar" subtitle="Content organized by creation date" />
        <Badge variant="outline" className="border-border/80 bg-accent/30 text-foreground/80">
          <CalendarDays className="mr-1 h-3 w-3" />
          {sortedDates.length} days
        </Badge>
      </div>

      {/* Type summary */}
      <Card className="border-border bg-card/50">
        <CardHeader className="flex flex-row items-center gap-2">
          <Calendar className="h-5 w-5 text-blue-400" />
          <CardTitle className="text-base text-foreground">Type Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(typeCounts).map(([type, count]) => (
              <Badge key={type} variant="outline" className={`text-[10px] ${typeBadgeClassFor(type)}`}>
                {type}
                <span className="ml-1.5 rounded-full bg-accent px-1.5 text-[9px] tabular-nums text-foreground/80">{count}</span>
              </Badge>
            ))}
            {Object.keys(typeCounts).length === 0 && (
              <span className="text-xs text-muted-foreground">No content available</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Calendar days */}
      {sortedDates.length === 0 ? (
        <Card className="border-border bg-card/50">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16">
            <Calendar className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">No content scheduled yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sortedDates.map((date) => {
            const items = grouped[date]
            const dayTypeCounts = items.reduce<Record<string, number>>((acc, item) => {
              const t = item.type.toLowerCase()
              acc[t] = (acc[t] || 0) + 1
              return acc
            }, {})

            return (
              <Card key={date} className="border-border bg-card/50">
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 flex-col items-center justify-center rounded-lg border border-border bg-sidebar">
                      <span className="text-[8px] uppercase text-muted-foreground">
                        {new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short" })}
                      </span>
                      <span className="text-sm font-bold leading-none text-foreground">
                        {new Date(date + "T00:00:00").getDate()}
                      </span>
                    </div>
                    <div>
                      <CardTitle className="text-sm text-foreground">{formatDateLabel(date)}</CardTitle>
                      <p className="text-[10px] text-muted-foreground">{items.length} item{items.length !== 1 ? "s" : ""}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {Object.entries(dayTypeCounts).map(([type, count]) => (
                      <Badge key={type} variant="outline" className={`text-[9px] ${typeBadgeClassFor(type)}`}>
                        {type} · {count}
                      </Badge>
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  <Separator className="mb-3 bg-accent" />
                  <div className="space-y-2">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/30 px-3 py-2"
                      >
                        <Badge variant="outline" className={`shrink-0 text-[9px] uppercase ${typeBadgeClassFor(item.type)}`}>
                          {item.type}
                        </Badge>
                        <span className="truncate text-xs text-foreground/90">{item.title}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
                          {new Date(item.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
