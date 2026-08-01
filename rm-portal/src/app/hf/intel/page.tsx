"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Radar, RefreshCw, DollarSign, TrendingUp, AlertCircle, Activity, Zap } from "lucide-react"
import { api, useApi } from "@/lib/api"
import { PageHeader, StatCard, SectionCard, LoadingState } from "@/components/ui-helpers"

export default function MarketIntelPage() {
  const { data: status, loading: statusLoading } = useApi<any>(() => api.marketIntelStatus(), [], 30000)
  const { data: pricing, loading: pricingLoading } = useApi<any>(() => api.marketIntelPricing(), [], 30000)
  const { data: changes, loading: changesLoading } = useApi<any>(() => api.marketIntelChanges(), [], 30000)
  const [pipelineResult, setPipelineResult] = useState<any>(null)
  const [scrapeResult, setScrapeResult] = useState<any>(null)
  const [running, setRunning] = useState(false)
  const [scraping, setScraping] = useState(false)

  async function runPipeline() {
    setRunning(true)
    const result = await api.marketIntelPipeline()
    setPipelineResult(result)
    setRunning(false)
  }

  async function runScrape() {
    setScraping(true)
    const result = await api.marketIntelScrape(20)
    setScrapeResult(result)
    setScraping(false)
  }

  if (statusLoading) return <LoadingState label="Loading market intelligence..." />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Market Intelligence Auto-Ingest"
        subtitle="Automated competitor scraping, bio change detection, pricing feed, and content auto-triggering"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          icon={Radar}
          value={status?.status === "active" ? "Active" : "Unknown"}
          label="Pipeline Status"
          color="text-emerald-400"
        />
        <StatCard
          icon={DollarSign}
          value={pricing?.average_price ? `$${pricing.average_price}` : "—"}
          label="Avg Competitor Price"
          color="text-blue-400"
        />
        <StatCard
          icon={AlertCircle}
          value={changes?.changes_detected ?? 0}
          label="Bio Changes Detected"
          color="text-amber-400"
        />
        <StatCard
          icon={Activity}
          value={pricing?.total_priced ?? 0}
          label="Priced Competitors"
          color="text-purple-400"
        />
      </div>

      {/* Pipeline Controls */}
      <SectionCard title="Pipeline Controls">
        <div className="flex flex-wrap gap-3">
          <Button onClick={runScrape} disabled={scraping}>
            {scraping ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Radar className="mr-2 h-4 w-4" />}
            Scrape Competitors
          </Button>
          <Button onClick={runPipeline} disabled={running}>
            {running ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            Run Full Pipeline
          </Button>
        </div>

        {scrapeResult && (
          <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
            <div className="text-sm font-medium mb-2">Scrape Result</div>
            <pre className="text-xs text-muted-foreground overflow-auto">
              {JSON.stringify(scrapeResult, null, 2)}
            </pre>
          </div>
        )}

        {pipelineResult && (
          <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
            <div className="text-sm font-medium mb-2">Pipeline Result</div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="rounded-md bg-background/50 p-2">
                <div className="text-xs text-muted-foreground">Scraped</div>
                <div className="text-sm font-medium">{pipelineResult.steps?.scrape?.scraped_count ?? 0}</div>
              </div>
              <div className="rounded-md bg-background/50 p-2">
                <div className="text-xs text-muted-foreground">Changes</div>
                <div className="text-sm font-medium">{pipelineResult.steps?.change_detection?.changes_detected ?? 0}</div>
              </div>
              <div className="rounded-md bg-background/50 p-2">
                <div className="text-xs text-muted-foreground">Avg Price</div>
                <div className="text-sm font-medium">${pipelineResult.pricing?.average ?? 0}</div>
              </div>
              <div className="rounded-md bg-background/50 p-2">
                <div className="text-xs text-muted-foreground">Auto-Triggered</div>
                <div className="text-sm font-medium">{pipelineResult.steps?.auto_trigger?.triggered_count ?? 0}</div>
              </div>
            </div>
            <pre className="text-xs text-muted-foreground overflow-auto">
              {JSON.stringify(pipelineResult.changes?.slice(0, 5), null, 2)}
            </pre>
          </div>
        )}
      </SectionCard>

      {/* Pricing Distribution */}
      {pricingLoading ? (
        <div className="text-sm text-muted-foreground">Loading pricing data...</div>
      ) : (
        <SectionCard title="Competitor Pricing Distribution">
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Minimum</div>
              <div className="text-lg font-semibold text-foreground">${pricing?.min_price ?? 0}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Median</div>
              <div className="text-lg font-semibold text-foreground">${pricing?.median_price ?? 0}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Average</div>
              <div className="text-lg font-semibold text-foreground">${pricing?.average_price ?? 0}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Maximum</div>
              <div className="text-lg font-semibold text-foreground">${pricing?.max_price ?? 0}</div>
            </div>
          </div>
          {pricing?.price_distribution && (
            <div className="space-y-2">
              {pricing.price_distribution.slice(0, 10).map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">#{p.rank}</Badge>
                    <span className="text-foreground">{p.username}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{p.location}</span>
                    <span className="font-medium text-foreground">${p.price}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Bio Changes */}
      {changesLoading ? (
        <div className="text-sm text-muted-foreground">Loading changes...</div>
      ) : (
        <SectionCard title="Bio Change Detection">
          {changes?.changes && changes.changes.length > 0 ? (
            <div className="space-y-2">
              {changes.changes.map((c: any, i: number) => (
                <div key={i} className="flex items-center justify-between rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-400" />
                    <span className="text-foreground">{c.username}</span>
                    <Badge variant="outline" className="text-xs">{c.change_type}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">Rank #{c.rank}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-4">
              No bio changes detected. {changes?.competitors_checked ?? 0} competitors checked.
            </div>
          )}
        </SectionCard>
      )}

      {/* Pipeline Architecture */}
      <SectionCard title="Pipeline Architecture">
        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 text-xs font-bold">1</div>
            <div>
              <div className="font-medium text-foreground">Competitor Scraping</div>
              <div className="text-muted-foreground">POST /api/market-intel/scrape — Fetches competitor profiles and stores snapshots</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold">2</div>
            <div>
              <div className="font-medium text-foreground">Bio Change Detection</div>
              <div className="text-muted-foreground">GET /api/market-intel/changes — Diffs current bios against previous snapshots</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold">3</div>
            <div>
              <div className="font-medium text-foreground">Pricing Data Feed</div>
              <div className="text-muted-foreground">GET /api/market-intel/pricing — Extracts and tracks competitor pricing</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-500/20 text-purple-400 text-xs font-bold">4</div>
            <div>
              <div className="font-medium text-foreground">Auto-Trigger Content</div>
              <div className="text-muted-foreground">POST /api/market-intel/pipeline — Auto-generates counter-strategies when changes are detected</div>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
