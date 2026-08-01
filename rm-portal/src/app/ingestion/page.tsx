"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Zap, Database, RefreshCw, AlertTriangle } from "lucide-react"
import { api, useApi } from "@/lib/api"
import { PageHeader, StatCard, SectionCard, LoadingState, statusBadgeClass } from "@/components/ui-helpers"

export default function IngestionPage() {
  const { data: sources, loading } = useApi<any[]>(() => api.ingestionListSources(), [], 30000)
  const { data: attribution } = useApi<any>(() => api.ingestionAttribution(), [], 30000)
  const [ingesting, setIngesting] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [sourceType, setSourceType] = useState("google_analytics")
  const [sourceName, setSourceName] = useState("")

  async function handleIngestAll() {
    setIngesting(true)
    await api.ingestionIngestAll()
    setIngesting(false)
    window.location.reload()
  }

  async function handleAddSource() {
    await api.ingestionAddSource({ source_type: sourceType, source_name: sourceName || sourceType })
    setShowAdd(false)
    setSourceName("")
    window.location.reload()
  }

  if (loading) return <LoadingState label="Loading ingestion sources..." />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cross-Platform Ingestion"
        subtitle="Unified data pipeline from Google Analytics, Meta Ads, Google Business, Yelp, and RubRatings"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Database} value={sources?.length ?? 0} label="Data Sources" color="text-blue-400" />
        <StatCard icon={Zap} value={attribution?.total_records ?? 0} label="Total Records" color="text-emerald-400" />
        <StatCard icon={Database} value={attribution?.total_sources ?? 0} label="Active Sources" color="text-purple-400" />
        <StatCard icon={AlertTriangle} value={attribution?.anomalies?.length ?? 0} label="Anomalies" color="text-amber-400" />
      </div>

      <SectionCard title="Data Sources">
        <div className="flex gap-3 mb-4">
          <Button onClick={handleIngestAll} disabled={ingesting} size="sm">
            {ingesting ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            Ingest All
          </Button>
          <Button onClick={() => setShowAdd(!showAdd)} variant="outline" size="sm">
            Add Source
          </Button>
        </div>

        {showAdd && (
          <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Source Type</label>
              <select value={sourceType} onChange={(e) => setSourceType(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
                <option value="google_analytics">Google Analytics</option>
                <option value="meta_ads">Meta Ads</option>
                <option value="google_business">Google Business</option>
                <option value="yelp">Yelp</option>
                <option value="rubratings">RubRatings</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <input value={sourceName} onChange={(e) => setSourceName(e.target.value)} placeholder="My GA Account"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <Button onClick={handleAddSource} size="sm" className="col-span-2">Add</Button>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Name</TableHead>
              <TableHead className="text-muted-foreground">Type</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground">Records</TableHead>
              <TableHead className="text-muted-foreground">Last Sync</TableHead>
              <TableHead className="text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(sources || []).map((s: any) => (
              <TableRow key={s.id} className="border-border">
                <TableCell className="font-medium text-foreground">{s.source_name}</TableCell>
                <TableCell className="text-muted-foreground">{s.source_type}</TableCell>
                <TableCell><span className={statusBadgeClass(s.status)}>{s.status}</span></TableCell>
                <TableCell className="text-muted-foreground">{s.total_records}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.last_ingested ? new Date(s.last_ingested).toLocaleString() : "Never"}</TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={async () => { await api.ingestionIngest(s.id); window.location.reload() }}>
                    Ingest
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>

      {attribution?.anomalies && attribution.anomalies.length > 0 && (
        <SectionCard title="Detected Anomalies">
          <div className="space-y-2">
            {attribution.anomalies.map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-2 rounded-md bg-amber-500/5 border border-amber-500/20 px-3 py-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span className="text-foreground">{a.source}: {a.metric} = {a.value} ({a.type})</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {attribution?.attribution && Object.keys(attribution.attribution).length > 0 && (
        <SectionCard title="Unified Attribution">
          <div className="space-y-2">
            {Object.entries(attribution.attribution).map(([type, data]: [string, any]) => (
              <div key={type} className="rounded-md bg-background/30 px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-foreground">{type}</span>
                  <Badge variant="secondary" className="text-xs">{data.records} records</Badge>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {Object.entries(data.metrics).slice(0, 6).map(([k, v]: [string, any]) => (
                    <span key={k}>{k}: {typeof v === "number" ? v.toFixed(1) : v}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  )
}
