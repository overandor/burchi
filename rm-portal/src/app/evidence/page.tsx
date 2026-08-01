"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { AlertCircle, ScrollText, CheckCircle2, XCircle, Ban, Eye, ArrowRight, FileJson } from "lucide-react"
import { useApi, api, type Receipt } from "@/lib/api"
import { LoadingState, PageHeader } from "@/components/ui-helpers"
import { useState } from "react"

const statusIcons: Record<string, typeof CheckCircle2> = {
  pass: CheckCircle2,
  fail: XCircle,
  blocked: Ban,
  unavailable: AlertCircle,
  dry_run: Eye,
}

const statusColors: Record<string, string> = {
  pass: "text-emerald-400",
  fail: "text-red-400",
  blocked: "text-orange-400",
  unavailable: "text-amber-400",
  dry_run: "text-blue-400",
}

const statusBadge: Record<string, string> = {
  pass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  fail: "border-red-500/30 bg-red-500/10 text-red-400",
  blocked: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  unavailable: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  dry_run: "border-blue-500/30 bg-blue-500/10 text-blue-400",
}

export default function EvidencePage() {
  const { data, loading } = useApi<Receipt[]>(() => api.getReceipts(50), [], 15000)
  const [selected, setSelected] = useState<string | null>(null)

  if (loading || !data) return <LoadingState label="Loading evidence..." />

  const selectedReceipt = data.find((r) => r.id === selected)

  return (
    <div className="space-y-6">
      <PageHeader title="Evidence & Receipts" subtitle="Every autonomous action leaves a trace — observation → decision → mutation → receipt" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Receipt list */}
        <Card className="border-border bg-card/50 lg:col-span-2">
          <CardHeader className="flex flex-row items-center gap-2">
            <ScrollText className="h-5 w-5 text-orange-400" />
            <CardTitle className="text-base text-foreground">Receipt Log</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[550px] pr-4">
              <div className="space-y-2">
                {data.map((r) => {
                  const Icon = statusIcons[r.status] || AlertCircle
                  const unavailable = r.observation !== "available"
                  return (
                    <div
                      key={r.id}
                      onClick={() => setSelected(r.id)}
                      className={`flex items-start gap-3 rounded-lg border px-3 py-3 cursor-pointer transition-colors ${
                        selected === r.id
                          ? "border-orange-500/30 bg-orange-500/5"
                          : "border-border/50 bg-card/30 hover:bg-accent/50"
                      }`}
                    >
                      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/30 ${statusColors[r.status] || "text-muted-foreground"}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-foreground">{r.action || r.decision}</span>
                          <Badge variant="outline" className={`text-[8px] ${statusBadge[r.status] || "border-border/80 bg-accent/30 text-muted-foreground"}`}>
                            {r.status.toUpperCase()}
                          </Badge>
                          {unavailable && (
                            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[8px]">
                              NO_OBS
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                          {new Date(r.timestamp).toLocaleString("en-US", { hour12: false })}
                        </span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Detail panel */}
        <Card className="border-border bg-card/50">
          <CardHeader className="flex flex-row items-center gap-2">
            <FileJson className="h-5 w-5 text-blue-400" />
            <CardTitle className="text-base text-foreground">Receipt Detail</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedReceipt ? (
              <div className="space-y-4">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Action</span>
                  <p className="text-sm font-medium text-foreground">{selectedReceipt.action || selectedReceipt.decision}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Timestamp</span>
                  <p className="text-xs text-muted-foreground">{new Date(selectedReceipt.timestamp).toLocaleString("en-US", { hour12: false })}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</span>
                  <div className="mt-1">
                    <Badge variant="outline" className={statusBadge[selectedReceipt.status] || ""}>
                      {selectedReceipt.status.toUpperCase()}
                    </Badge>
                  </div>
                </div>
                <Separator className="bg-accent" />
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Evidence Chain</span>
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      <div className="flex h-5 w-5 items-center justify-center rounded bg-accent text-[8px] text-muted-foreground">1</div>
                      <span className="text-muted-foreground">Input</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
                      <span className="text-foreground/80">{selectedReceipt.input_observation || "telemetry collected"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <div className="flex h-5 w-5 items-center justify-center rounded bg-accent text-[8px] text-muted-foreground">2</div>
                      <span className="text-muted-foreground">Source</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
                      <span className="text-foreground/80">{selectedReceipt.source}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <div className="flex h-5 w-5 items-center justify-center rounded bg-accent text-[8px] text-muted-foreground">3</div>
                      <span className="text-muted-foreground">Model</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
                      <span className="text-foreground/80">{selectedReceipt.model}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <div className="flex h-5 w-5 items-center justify-center rounded bg-accent text-[8px] text-muted-foreground">4</div>
                      <span className="text-muted-foreground">Decision</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
                      <span className="text-foreground/80">{selectedReceipt.decision}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <div className="flex h-5 w-5 items-center justify-center rounded bg-accent text-[8px] text-muted-foreground">5</div>
                      <span className="text-muted-foreground">Action</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
                      <span className="text-foreground/80">{selectedReceipt.action}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <div className="flex h-5 w-5 items-center justify-center rounded bg-accent text-[8px] text-muted-foreground">6</div>
                      <span className="text-muted-foreground">Result</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
                      <span className="text-foreground/80">{selectedReceipt.result}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <div className="flex h-5 w-5 items-center justify-center rounded bg-accent text-[8px] text-muted-foreground">7</div>
                      <span className="text-muted-foreground">Reward</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
                      <span className={`font-bold ${selectedReceipt.reward >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {selectedReceipt.reward.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
                <Separator className="bg-accent" />
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Detail Payload</span>
                  <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-sidebar p-3 text-[10px] text-muted-foreground">
                    {JSON.stringify(selectedReceipt.detail, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                Select a receipt to view evidence chain
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
