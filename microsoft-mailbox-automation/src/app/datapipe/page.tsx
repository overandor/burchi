"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Upload,
  Database,
  TrendingUp,
  AlertTriangle,
  Sparkles,
  Loader2,
  X,
  ChevronRight,
  Search,
  Download,
  RefreshCw,
  Activity,
  Users,
  FileSpreadsheet,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Minus,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────

interface Overview {
  totalEntities: number;
  entitiesByType: Record<string, number>;
  totalAttributes: number;
  attributesByCategory: Record<string, number>;
  totalIngestions: number;
  totalChanges: number;
  latestIngestion: any | null;
  pendingEnrichment: number;
}

interface Attribute {
  id: string;
  attribute_key: string;
  label: string;
  data_type: string;
  category: string;
  is_timeseries: number;
  unit: string | null;
}

interface Ingestion {
  id: string;
  file_name: string;
  period: string | null;
  rows_extracted: number;
  entities_created: number;
  entities_updated: number;
  attributes_discovered: number;
  changes_detected: number;
  status: string;
  created_at: string;
}

interface Change {
  id: number;
  ingestion_id: string;
  entity_id: string;
  entity_name: string;
  entity_type: string;
  change_type: string;
  attribute_key: string | null;
  old_value: string | null;
  new_value: string | null;
  delta_numeric: number | null;
  severity: string;
  created_at: string;
}

interface EntityRow {
  _entity_id: string;
  _entity_type: string;
  _canonical_name: string;
  _status: string;
  _confidence: number;
  _first_seen: string;
  _last_seen: string;
  [key: string]: any;
}

type Tab = "overview" | "dataset" | "changes" | "ingest" | "enrich" | "scores";

// ─── Component ─────────────────────────────────────────────────────────

export default function DatapipePage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Overview state
  const [overview, setOverview] = useState<Overview | null>(null);
  const [ingestions, setIngestions] = useState<Ingestion[]>([]);
  const [attributes, setAttributes] = useState<Attribute[]>([]);

  // Dataset state
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [datasetTotal, setDatasetTotal] = useState(0);
  const [datasetPage, setDatasetPage] = useState(0);
  const [entityTypeFilter, setEntityTypeFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Changes state
  const [changes, setChanges] = useState<Change[]>([]);
  const [changeFilter, setChangeFilter] = useState("");

  // Ingest state
  const [ingestFile, setIngestFile] = useState<File | null>(null);
  const [ingestPeriod, setIngestPeriod] = useState("");
  const [ingestSheet, setIngestSheet] = useState("");
  const [ingestEntityType, setIngestEntityType] = useState("hcp");
  const [ingestResult, setIngestResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Enrich state
  const [enrichStatus, setEnrichStatus] = useState<any>(null);

  // Drag-and-drop state
  const [dragOver, setDragOver] = useState(false);

  // Scores state
  const [scoreSummary, setScoreSummary] = useState<any>(null);
  const [scores, setScores] = useState<any[]>([]);
  const [scoreFilter, setScoreFilter] = useState<string>("");
  const [scoreComputing, setScoreComputing] = useState(false);
  const [scoreResult, setScoreResult] = useState<any>(null);

  // Entity detail drawer
  const [selectedEntity, setSelectedEntity] = useState<any>(null);
  const [entityTimeseries, setEntityTimeseries] = useState<any>(null);

  // ─── Data fetching ───────────────────────────────────────────────────

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/datapipe/overview");
      const data = await res.json();
      setOverview(data.overview);
      setIngestions(data.ingestions);
      setAttributes(data.attributes);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setInitialLoading(false);
    }
  }, []);

  const fetchDataset = useCallback(async (page = 0) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: "50",
        offset: String(page * 50),
      });
      if (entityTypeFilter) params.set("entityType", entityTypeFilter);
      if (periodFilter) params.set("period", periodFilter);
      if (searchQuery) params.set("search", searchQuery);

      const res = await fetch(`/api/datapipe/dataset?${params}`);
      const data = await res.json();
      setEntities(data.entities);
      setDatasetTotal(data.total);
      setDatasetPage(page);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [entityTypeFilter, periodFilter, searchQuery]);

  const fetchChanges = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (changeFilter) params.set("changeType", changeFilter);
      const res = await fetch(`/api/datapipe/changes?${params}`);
      const data = await res.json();
      setChanges(data.changes);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [changeFilter]);

  const handleIngest = useCallback(async () => {
    if (!ingestFile) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    setIngestResult(null);
    try {
      const fd = new FormData();
      fd.append("file", ingestFile);
      if (ingestPeriod) fd.append("period", ingestPeriod);
      if (ingestSheet) fd.append("sheet", ingestSheet);
      fd.append("entityType", ingestEntityType);

      const res = await fetch("/api/datapipe/ingest", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message);

      setIngestResult(data);
      setSuccess(
        `Ingested ${data.rows_extracted} rows → ${data.entities_created} new entities, ${data.entities_updated} updated, ${data.changes_detected} changes, ${data.attributes_discovered} new attributes`
      );
      // Refresh overview
      fetchOverview();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [ingestFile, ingestPeriod, ingestSheet, ingestEntityType, fetchOverview]);

  const handleEnrich = useCallback(async (action: string, body: any = {}) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/datapipe/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEnrichStatus(data);
      if (action === "auto_queue") {
        setSuccess(`Queued ${data.queued} NPI lookups (${data.totalEligible} eligible)`);
      } else {
        setSuccess(`Enrichment batch: ${data.succeeded} succeeded, ${data.failed} failed, ${data.remaining} remaining`);
      }
      fetchOverview();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fetchOverview]);

  const fetchScoreSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/datapipe/scores?summary=true");
      const data = await res.json();
      setScoreSummary(data);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const fetchScores = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (scoreFilter) params.set("scoreType", scoreFilter);
      const res = await fetch(`/api/datapipe/scores?${params}`);
      const data = await res.json();
      setScores(data.scores || []);
      fetchScoreSummary();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [scoreFilter, fetchScoreSummary]);

  const handleComputeScores = useCallback(async () => {
    setScoreComputing(true);
    setError(null);
    setScoreResult(null);
    try {
      const res = await fetch("/api/datapipe/scores", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setScoreResult(data);
      setSuccess(`Computed ${data.ravs_computed} RAVS, ${data.tmi_computed} TMI, ${data.ssd_computed} SSD scores in ${(data.duration_ms / 1000).toFixed(1)}s`);
      fetchScores();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setScoreComputing(false);
    }
  }, [fetchScores]);

  const fetchEntityDetail = useCallback(async (entityId: string) => {
    try {
      const res = await fetch(`/api/datapipe/entity?id=${entityId}&timeseries=true`);
      const data = await res.json();
      setSelectedEntity(data.entity);
      setEntityTimeseries(data.timeseries);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  // ─── Initial load + escape key for drawer ────────────────────────────

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  useEffect(() => {
    if (!selectedEntity) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedEntity(null);
        setEntityTimeseries(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedEntity]);

  // ─── Derived data ────────────────────────────────────────────────────

  const kpiAttributes = attributes.filter((a) => a.is_timeseries === 1);
  const identityAttributes = attributes.filter((a) => a.category === "identity");
  const contactAttributes = attributes.filter((a) => a.category === "contact");
  const hcpAttributes = attributes.filter((a) => a.category === "hcp");

  // Dynamic column selection for dataset table — prioritize identity, then KPIs
  const datasetColumns = [
    ...identityAttributes.slice(0, 3),
    ...hcpAttributes.slice(0, 2),
    ...kpiAttributes.slice(0, 5),
  ].map((a) => a.attribute_key);

  const exportCSV = (data: any[], filename: string) => {
    if (!data.length) return;
    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(","),
      ...data.map((row) =>
        headers.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary shadow-[0_0_20px_-5px_hsl(var(--primary)/0.45)]">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">DataPipe</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Living dataset — continuously enriched, auto-discovers new attributes and KPIs
            </p>
          </div>
        </div>
        <button
          onClick={() => { fetchOverview(); if (tab === "dataset") fetchDataset(datasetPage); if (tab === "changes") fetchChanges(); if (tab === "scores") fetchScores(); }}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Error / Success */}
      {error && (
        <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <span><strong>Error:</strong> {error}</span>
          <button onClick={() => setError(null)} className="rounded p-1 hover:bg-destructive/20"><X className="h-4 w-4" /></button>
        </div>
      )}
      {success && (
        <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm text-primary">
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="rounded p-1 hover:bg-primary/20"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
        {([
          { id: "overview", label: "Overview", icon: Database },
          { id: "dataset", label: "Dataset", icon: Users },
          { id: "changes", label: "What Changed", icon: Activity },
          { id: "ingest", label: "Ingest", icon: Upload },
          { id: "enrich", label: "Enrich", icon: Sparkles },
          { id: "scores", label: "Scores", icon: TrendingUp },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => {
              setTab(id);
              if (id === "dataset") fetchDataset(0);
              if (id === "changes") fetchChanges();
              if (id === "scores") fetchScores();
            }}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all",
              tab === id ? "bg-primary/15 text-primary shadow-sm" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
            {id === "enrich" && overview && (overview.pendingEnrichment ?? 0) > 0 && (
              <span className="ml-1 rounded-full bg-accent/20 px-1.5 py-0.5 text-xs font-bold text-accent">
                {overview.pendingEnrichment}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ─── Overview Tab ─── */}
      {tab === "overview" && initialLoading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : tab === "overview" && overview && (
        <div className="space-y-6">
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              icon={Users}
              label="Entities"
              value={overview.totalEntities}
              sublabel={`${overview.entitiesByType.hcp || 0} HCPs · ${overview.entitiesByType.product || 0} products`}
              color="primary"
            />
            <StatCard
              icon={Database}
              label="Attributes"
              value={overview.totalAttributes}
              sublabel={`${overview.attributesByCategory.kpi || 0} KPIs · ${overview.attributesByCategory.identity || 0} identity`}
              color="accent"
            />
            <StatCard
              icon={FileSpreadsheet}
              label="Ingestions"
              value={overview.totalIngestions}
              sublabel={overview.latestIngestion ? `Last: ${overview.latestIngestion.file_name.slice(0, 20)}` : "No data yet"}
              color="blue"
            />
            <StatCard
              icon={Activity}
              label="Changes Tracked"
              value={overview.totalChanges}
              sublabel={overview.pendingEnrichment > 0 ? `${overview.pendingEnrichment} pending enrichment` : "All enriched"}
              color="amber"
            />
          </div>

          {/* Entity types breakdown */}
          {Object.keys(overview.entitiesByType).length > 0 && (
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-bold text-foreground">Entities by Type</h3>
              <div className="flex flex-wrap gap-3">
                {Object.entries(overview.entitiesByType).map(([type, count]) => (
                  <div key={type} className="flex items-center gap-2 rounded-lg bg-muted/40 px-4 py-2">
                    <span className="text-2xl font-bold text-foreground">{count}</span>
                    <span className="text-sm text-muted-foreground">{type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Attribute categories */}
          {Object.keys(overview.attributesByCategory).length > 0 && (
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-bold text-foreground">Discovered Attributes by Category</h3>
              <div className="space-y-2">
                {Object.entries(overview.attributesByCategory).map(([cat, count]) => (
                  <div key={cat} className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground capitalize">{cat}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-32 rounded-full bg-muted/50">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${Math.min((count / overview.totalAttributes) * 100, 100)}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold text-foreground">{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent ingestions */}
          {ingestions.length > 0 && (
            <div className="rounded-xl border border-border bg-card shadow-sm">
              <div className="border-b border-border p-4">
                <h3 className="text-sm font-bold text-foreground">Recent Ingestions</h3>
              </div>
              <div className="divide-y divide-border/50">
                {ingestions.map((ing) => (
                  <div key={ing.id} className="flex items-center justify-between p-4 hover:bg-muted/20">
                    <div className="flex items-center gap-3">
                      <FileSpreadsheet className="h-5 w-5 text-muted-foreground/60" />
                      <div>
                        <p className="text-sm font-medium text-foreground">{ing.file_name}</p>
                        <p className="text-xs text-muted-foreground/70">
                          {ing.period || "no period"} · {new Date(ing.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-primary">+{ing.entities_created} new</span>
                      <span className="text-muted-foreground">{ing.entities_updated} updated</span>
                      <span className="text-accent">{ing.changes_detected} changes</span>
                      <span className="text-accent/80">{ing.attributes_discovered} new attrs</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {overview.totalEntities === 0 && (
            <div className="rounded-xl border-2 border-dashed border-border p-12 text-center">
              <Database className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
              <h3 className="text-lg font-semibold text-foreground">No data yet</h3>
              <p className="mt-1 text-sm text-muted-foreground/70">
                Upload a file on the Ingest tab to start building your living dataset.
              </p>
              <button
                onClick={() => setTab("ingest")}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <Upload className="h-4 w-4" />
                Start Ingesting
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── Dataset Tab ─── */}
      {tab === "dataset" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground/60" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchDataset(0)}
                placeholder="Search entities..."
                className="w-48 rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none"
              />
            </div>
            <select
              value={entityTypeFilter}
              onChange={(e) => { setEntityTypeFilter(e.target.value); fetchDataset(0); }}
              className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm text-foreground"
            >
              <option value="">All types</option>
              <option value="hcp">HCP</option>
              <option value="product">Product</option>
              <option value="territory">Territory</option>
            </select>
            <input
              type="text"
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchDataset(0)}
              placeholder="Period (e.g. 2026-03)"
              className="w-36 rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none"
            />
            <button
              onClick={() => fetchDataset(0)}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Query
            </button>
            {entities.length > 0 && (
              <button
                onClick={() => exportCSV(entities, "datapipe_dataset.csv")}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            )}
          </div>

          {/* Dynamic table */}
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg border border-border bg-card" />
              ))}
            </div>
          ) : entities.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-3 text-left text-xs font-bold text-muted-foreground">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-muted-foreground">Type</th>
                    {datasetColumns.map((col) => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-bold text-muted-foreground">
                        {attributes.find((a) => a.attribute_key === col)?.label || col}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-left text-xs font-bold text-muted-foreground">Last Seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {entities.map((e, i) => (
                    <tr
                      key={i}
                      onClick={() => fetchEntityDetail(e._entity_id)}
                      className="cursor-pointer hover:bg-primary/5"
                    >
                      <td className="px-4 py-2 font-medium text-foreground">{e._canonical_name}</td>
                      <td className="px-4 py-2">
                        <span className="rounded-full bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          {e._entity_type}
                        </span>
                      </td>
                      {datasetColumns.map((col) => (
                        <td key={col} className="max-w-[150px] truncate px-4 py-2 text-muted-foreground">
                          {e[col] != null ? String(e[col]) : "—"}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-xs text-muted-foreground/70">
                        {e._last_seen ? new Date(e._last_seen).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-border p-3">
                <span className="text-xs text-muted-foreground/70">
                  {entities.length} of {datasetTotal} entities
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => fetchDataset(datasetPage - 1)}
                    disabled={datasetPage === 0}
                    className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-muted-foreground disabled:opacity-30 hover:bg-muted hover:text-foreground"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => fetchDataset(datasetPage + 1)}
                    disabled={(datasetPage + 1) * 50 >= datasetTotal}
                    className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-muted-foreground disabled:opacity-30 hover:bg-muted hover:text-foreground"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border-2 border-dashed border-border p-12 text-center">
              <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground/70">No entities found. Adjust filters or ingest data.</p>
            </div>
          )}
        </div>
      )}

      {/* ─── Changes Tab ─── */}
      {tab === "changes" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <select
              value={changeFilter}
              onChange={(e) => { setChangeFilter(e.target.value); fetchChanges(); }}
              className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm text-foreground"
            >
              <option value="">All changes</option>
              <option value="new_entity">New entities</option>
              <option value="value_changed">Value changes</option>
              <option value="value_added">New values</option>
              <option value="entity_dropped">Dropped entities</option>
            </select>
            <span className="text-sm text-muted-foreground/70">{changes.length} changes</span>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-card" />
              ))}
            </div>
          ) : changes.length > 0 ? (
            <div className="space-y-2">
              {changes.map((c) => (
                <ChangeCard key={c.id} change={c} onClick={() => fetchEntityDetail(c.entity_id)} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border-2 border-dashed border-border p-12 text-center">
              <Activity className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground/70">No changes detected yet. Ingest a new file to see what changed.</p>
            </div>
          )}
        </div>
      )}

      {/* ─── Ingest Tab ─── */}
      {tab === "ingest" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Upload File (PDF, XLSX, CSV)</label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) setIngestFile(f);
                  }}
                  className={cn(
                    "flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors",
                    dragOver ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-primary/5"
                  )}
                >
                  {ingestFile ? (
                    <div className="text-center">
                      <FileSpreadsheet className="mx-auto mb-2 h-8 w-8 text-primary" />
                      <p className="text-sm font-medium text-foreground">{ingestFile.name}</p>
                      <p className="text-xs text-muted-foreground/70">{(ingestFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                  ) : (
                    <div className="text-center text-muted-foreground/60">
                      <Upload className="mx-auto mb-2 h-8 w-8" />
                      <p className="text-sm">Click or drag to upload</p>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.xlsx,.csv,.tsv"
                    className="hidden"
                    onChange={(e) => setIngestFile(e.target.files?.[0] || null)}
                  />
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Period (month stamp)</label>
                  <input
                    type="text"
                    value={ingestPeriod}
                    onChange={(e) => setIngestPeriod(e.target.value)}
                    placeholder="e.g. 2026-03"
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <p className="mt-1 text-xs text-muted-foreground/60">Used for time-series tracking. Leave blank for one-time data.</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Sheet Filter (optional)</label>
                  <input
                    type="text"
                    value={ingestSheet}
                    onChange={(e) => setIngestSheet(e.target.value)}
                    placeholder="e.g. Highlighted"
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Entity Type</label>
                  <select
                    value={ingestEntityType}
                    onChange={(e) => setIngestEntityType(e.target.value)}
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
                  >
                    <option value="hcp">HCP (doctors)</option>
                    <option value="product">Product</option>
                    <option value="territory">Territory</option>
                    <option value="all">All types</option>
                  </select>
                </div>
              </div>
            </div>
            <button
              onClick={handleIngest}
              disabled={loading || !ingestFile}
              className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Ingest into Living Dataset
            </button>
          </div>

          {/* Ingestion result */}
          {ingestResult && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-6">
              <h3 className="mb-3 text-sm font-bold text-primary">Ingestion Result</h3>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                <ResultStat label="Rows" value={ingestResult.rows_extracted} />
                <ResultStat label="New Entities" value={ingestResult.entities_created} color="primary" />
                <ResultStat label="Updated" value={ingestResult.entities_updated} color="blue" />
                <ResultStat label="New Attrs" value={ingestResult.attributes_discovered} color="accent" />
                <ResultStat label="Changes" value={ingestResult.changes_detected} color="amber" />
              </div>
              {ingestResult.changes?.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-bold text-primary/80">Detected Changes:</p>
                  <div className="space-y-1">
                    {ingestResult.changes.slice(0, 10).map((c: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ChangeIcon type={c.change_type} />
                        <span className="font-medium">{c.change_type}</span>
                        {c.attribute_key && <span className="text-muted-foreground/60">· {c.attribute_key}</span>}
                        {c.old_value && <span className="text-destructive">{String(c.old_value).slice(0, 30)}</span>}
                        {c.new_value && <span className="text-primary">→ {String(c.new_value).slice(0, 30)}</span>}
                      </div>
                    ))}
                    {ingestResult.changes.length > 10 && (
                      <p className="text-xs text-muted-foreground/60">+ {ingestResult.changes.length - 10} more — see What Changed tab</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── Enrich Tab ─── */}
      {tab === "enrich" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <Sparkles className="mt-1 h-6 w-6 text-accent" />
              <div className="flex-1">
                <h3 className="text-sm font-bold text-foreground">Enrichment Worker</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Automatically enriches entities with external data: NPI validation via NPPES registry,
                  address normalization, specialty code mapping.
                </p>
                {overview && overview.pendingEnrichment > 0 && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
                    <AlertTriangle className="h-4 w-4" />
                    {overview.pendingEnrichment} tasks pending
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => handleEnrich("auto_queue")}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/20"
              >
                <Plus className="h-4 w-4" />
                Auto-queue NPI lookups
              </button>
              <button
                onClick={() => handleEnrich("run", { batchSize: 5 })}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent/90"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Run enrichment batch
              </button>
            </div>
          </div>

          {enrichStatus && (
            <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <ResultStat label="Succeeded" value={enrichStatus.succeeded ?? 0} color="primary" />
                <ResultStat label="Failed" value={enrichStatus.failed ?? 0} color="amber" />
                <ResultStat label="Remaining" value={enrichStatus.remaining ?? 0} color="accent" />
                <ResultStat label="Queued" value={enrichStatus.queued ?? enrichStatus.totalEligible ?? 0} color="blue" />
              </div>
            </div>
          )}

          {/* Enrichment types explanation */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <EnrichmentCard
              title="NPI Lookup"
              description="Validates NPI against CMS NPPES registry. Pulls practice address, primary taxonomy, license status."
              endpoint="npiregistry.cms.hhs.gov"
            />
            <EnrichmentCard
              title="Address Normalize"
              description="Standardizes street suffixes (Street → St), directional abbreviations (North → N), and casing for dedup."
            />
            <EnrichmentCard
              title="Specialty Normalize"
              description="Maps raw codes (INF-DIS, IM, FM) to canonical names (Infectious Disease, Internal Medicine, Family Medicine)."
            />
          </div>
        </div>
      )}

      {/* ─── Scores Tab ─── */}
      {tab === "scores" && (
        <div className="space-y-4">
          {/* Compute button */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <TrendingUp className="mt-1 h-6 w-6 text-primary" />
                <div>
                  <h3 className="text-sm font-bold text-foreground">Composite Scoring Engine</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Proprietary derived signals computed from OpenFDA adverse events, ClinicalTrials.gov trial density,
                    RxNorm therapeutic classes, NPPES NPI registry, and DataPipe historical KPIs.
                  </p>
                </div>
              </div>
              <button
                onClick={handleComputeScores}
                disabled={scoreComputing}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-primary to-accent px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
              >
                {scoreComputing ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
                Compute Scores
              </button>
            </div>

            {scoreResult && (
              <div className="mt-4 grid grid-cols-4 gap-4 rounded-lg bg-primary/5 p-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{scoreResult.ravs_computed}</p>
                  <p className="text-xs text-muted-foreground">RAVS</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-accent">{scoreResult.tmi_computed}</p>
                  <p className="text-xs text-muted-foreground">TMI</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-accent/80">{scoreResult.ssd_computed}</p>
                  <p className="text-xs text-muted-foreground">SSD</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground">{(scoreResult.duration_ms / 1000).toFixed(1)}s</p>
                  <p className="text-xs text-muted-foreground">Duration</p>
                </div>
              </div>
            )}
          </div>

          {/* Score summary cards */}
          {scoreSummary && scoreSummary.total_scores > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {(["ravs", "tmi", "ssd"] as const).map((type) => {
                const stats = scoreSummary.by_type[type];
                if (!stats) return null;
                const labels: Record<string, string> = {
                  ravs: "Risk-Adjusted Value Score",
                  tmi: "Territory Momentum Index",
                  ssd: "Safety Signal Density",
                };
                const gradients: Record<string, string> = {
                  ravs: "from-primary to-blue-500",
                  tmi: "from-accent to-pink-500",
                  ssd: "from-amber-500 to-orange-500",
                };
                return (
                  <div key={type} className="rounded-xl border border-border bg-card p-5 shadow-sm">
                    <div className={cn("mb-3 inline-flex rounded-lg bg-gradient-to-r px-3 py-1 text-xs font-bold text-primary-foreground", gradients[type])}>
                      {type.toUpperCase()}
                    </div>
                    <h4 className="text-sm font-bold text-foreground">{labels[type]}</h4>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-3xl font-bold text-foreground">{stats.avg}</span>
                      <span className="text-xs text-muted-foreground/70">avg</span>
                      <span className="ml-auto text-xs text-muted-foreground/70">{stats.count} scores</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground/70">
                      <span>min: {stats.min}</span>
                      <span>max: {stats.max}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Score filter */}
          <div className="flex items-center gap-3">
            <select
              value={scoreFilter}
              onChange={(e) => { setScoreFilter(e.target.value); }}
              className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm text-foreground"
            >
              <option value="">All scores</option>
              <option value="ravs">RAVS (HCP Value)</option>
              <option value="tmi">TMI (Territory Momentum)</option>
              <option value="ssd">SSD (Safety Signal)</option>
            </select>
            <button
              onClick={fetchScores}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Refresh
            </button>
            <span className="text-sm text-muted-foreground/70">{scores.length} scores</span>
          </div>

          {/* Score list */}
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-card" />
              ))}
            </div>
          ) : scores.length > 0 ? (
            <div className="space-y-2">
              {scores.map((s) => (
                <ScoreCard key={s.id} score={s} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border-2 border-dashed border-border p-12 text-center">
              <TrendingUp className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
              <h3 className="text-lg font-semibold text-foreground">No composite scores yet</h3>
              <p className="mt-1 text-sm text-muted-foreground/70">
                Click "Compute Scores" to derive proprietary signals from OpenFDA, ClinicalTrials.gov, RxNorm, and your DataPipe KPIs.
              </p>
            </div>
          )}

          {/* Data provenance section */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h3 className="mb-3 text-sm font-bold text-foreground">Data Provenance</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <ProvenanceCard
                title="HCP Risk-Adjusted Value Score (RAVS)"
                sources={["NPPES NPI Registry", "OpenFDA FAERS", "DataPipe Historical KPIs"]}
                description="Combines NPI validity, specialty alignment, TRx trajectory, adverse event exposure, and call activity vs goal into a 0-100 score."
              />
              <ProvenanceCard
                title="Territory Momentum Index (TMI)"
                sources={["DataPipe Historical KPIs", "ClinicalTrials.gov", "OpenFDA FAERS"]}
                description="Combines period-over-period TRx/market-share deltas, clinical trial density by state, and safety signal trends into a -100 to +100 momentum signal."
              />
              <ProvenanceCard
                title="Safety Signal Density (SSD)"
                sources={["OpenFDA FAERS", "RxNorm/RxClass", "DataPipe KPIs"]}
                description="Normalizes adverse event counts against prescribing volume (events per 1000 TRx), cross-references therapeutic class breadth from RxNorm, and weights serious event ratio."
              />
              <ProvenanceCard
                title="Why These Scores Are Hard to Reproduce"
                sources={["Composite weighting logic", "Historical accumulation", "Multi-source fusion"]}
                description="Each score combines 4-5 weighted components from different public APIs. The weighting, normalization, and combination logic is proprietary. Historical KPI trends require months of DataPipe ingestion to accumulate."
              />
            </div>
          </div>
        </div>
      )}

      {/* ─── Entity Detail Drawer ─── */}
      {selectedEntity && (
        <EntityDrawer
          entity={selectedEntity}
          timeseries={entityTimeseries}
          attributes={attributes}
          onClose={() => { setSelectedEntity(null); setEntityTimeseries(null); }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sublabel, color }: any) {
  const colors: Record<string, string> = {
    primary: "text-primary bg-primary/10",
    accent: "text-accent bg-accent/10",
    blue: "text-blue-400 bg-blue-500/10",
    amber: "text-amber-400 bg-amber-500/10",
  };
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className={cn("rounded-lg p-2", colors[color])}>
          <Icon className="h-5 w-5" />
        </div>
        <span className="text-3xl font-bold text-foreground">{value}</span>
      </div>
      <p className="mt-2 text-sm font-semibold text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground/70">{sublabel}</p>
    </div>
  );
}

function ResultStat({ label, value, color = "default" }: any) {
  const colors: Record<string, string> = {
    default: "text-foreground",
    primary: "text-primary",
    blue: "text-blue-400",
    accent: "text-accent",
    amber: "text-amber-400",
  };
  return (
    <div className="text-center">
      <p className={cn("text-2xl font-bold", colors[color])}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function ChangeIcon({ type }: { type: string }) {
  if (type === "new_entity") return <Plus className="h-3.5 w-3.5 text-primary" />;
  if (type === "entity_dropped") return <Minus className="h-3.5 w-3.5 text-destructive" />;
  if (type === "value_changed") return <ArrowUpRight className="h-3.5 w-3.5 text-amber-400" />;
  if (type === "value_added") return <Plus className="h-3.5 w-3.5 text-blue-400" />;
  return <Activity className="h-3.5 w-3.5 text-muted-foreground/60" />;
}

function ChangeCard({ change, onClick }: { change: Change; onClick: () => void }) {
  const severityColors: Record<string, string> = {
    info: "border-border bg-card",
    warning: "border-amber-500/30 bg-amber-500/5",
    critical: "border-destructive/30 bg-destructive/5",
  };
  return (
    <div
      onClick={onClick}
      className={cn("flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:shadow-sm transition-shadow", severityColors[change.severity])}
    >
      <ChangeIcon type={change.change_type} />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{change.entity_name}</span>
          <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-xs text-muted-foreground">{change.entity_type}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {change.change_type.replace(/_/g, " ")}
          {change.attribute_key && ` · ${change.attribute_key}`}
          {change.old_value && ` · ${String(change.old_value).slice(0, 40)}`}
          {change.new_value && ` → ${String(change.new_value).slice(0, 40)}`}
          {change.delta_numeric !== null && (
            <span className={change.delta_numeric > 0 ? "text-primary" : "text-destructive"}>
              {" "}({change.delta_numeric > 0 ? "+" : ""}{change.delta_numeric})
            </span>
          )}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
    </div>
  );
}

function EnrichmentCard({ title, description, endpoint }: any) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h4 className="text-sm font-bold text-foreground">{title}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      {endpoint && (
        <p className="mt-2 font-mono text-xs text-accent">{endpoint}</p>
      )}
    </div>
  );
}

function ScoreCard({ score }: { score: any }) {
  const typeConfig: Record<string, { color: string; label: string; fullLabel: string }> = {
    ravs: { color: "from-primary to-blue-500", label: "RAVS", fullLabel: "Risk-Adjusted Value Score" },
    tmi: { color: "from-accent to-pink-500", label: "TMI", fullLabel: "Territory Momentum Index" },
    ssd: { color: "from-amber-500 to-orange-500", label: "SSD", fullLabel: "Safety Signal Density" },
  };
  const config = typeConfig[score.score_type] || typeConfig.ravs;
  const labelColors: Record<string, string> = {
    "High Value": "bg-primary/15 text-primary",
    "Medium Value": "bg-amber-500/15 text-amber-400",
    "Low Value": "bg-destructive/15 text-destructive",
    "Accelerating": "bg-primary/15 text-primary",
    "Stable": "bg-muted/50 text-muted-foreground",
    "Slowing": "bg-amber-500/15 text-amber-400",
    "Declining": "bg-destructive/15 text-destructive",
    "High Signal": "bg-destructive/15 text-destructive",
    "Moderate Signal": "bg-amber-500/15 text-amber-400",
    "Low Signal": "bg-primary/15 text-primary",
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn("rounded-lg bg-gradient-to-r px-2.5 py-1 text-xs font-bold text-primary-foreground", config.color)}>
            {config.label}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{score.entity_name}</p>
            <p className="text-xs text-muted-foreground/70">{config.fullLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", labelColors[score.score_label] || "bg-muted/50 text-muted-foreground")}>
            {score.score_label}
          </span>
          <span className="text-2xl font-bold text-foreground">{score.score_value}</span>
        </div>
      </div>

      {/* Component breakdown */}
      <div className="mt-3 space-y-1.5">
        {score.components.map((c: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-40 font-medium text-muted-foreground">{c.name}</span>
            <div className="h-2 flex-1 rounded-full bg-muted/40">
              <div
                className={cn("h-2 rounded-full", c.contribution > 0 ? "bg-primary/60" : "bg-destructive/60")}
                style={{ width: `${Math.min(Math.abs(c.contribution) / (score.score_type === "tmi" ? 100 : 25) * 100, 100)}%` }}
              />
            </div>
            <span className="w-16 text-right font-mono text-muted-foreground/70">
              {c.contribution > 0 ? "+" : ""}{c.contribution.toFixed(1)}
            </span>
            <span className="w-32 truncate text-muted-foreground/50" title={c.description}>{c.source}</span>
          </div>
        ))}
      </div>

      {/* Input sources */}
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/50 pt-2">
        {score.input_sources.map((src: string, i: number) => (
          <span key={i} className="rounded-full bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground/70">{src}</span>
        ))}
        <span className="ml-auto text-xs text-muted-foreground/40">
          {new Date(score.computed_at).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

function ProvenanceCard({ title, sources, description }: { title: string; sources: string[]; description: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-4">
      <h4 className="text-sm font-bold text-foreground">{title}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {sources.map((s, i) => (
          <span key={i} className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-primary">{s}</span>
        ))}
      </div>
    </div>
  );
}

function EntityDrawer({ entity, timeseries, attributes, onClose }: any) {
  const { entity: e, values } = entity;
  const kpiKeys = attributes.filter((a: Attribute) => a.is_timeseries === 1).map((a: Attribute) => a.attribute_key);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg overflow-y-auto border-l border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card p-4">
          <div>
            <h3 className="text-lg font-bold text-foreground">{e.canonical_name}</h3>
            <p className="text-xs text-muted-foreground/70">
              {e.entity_type} · first seen {new Date(e.first_seen).toLocaleDateString()} · {(e.confidence * 100).toFixed(0)}% confidence
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-muted">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-6 p-4">
          {/* All current values */}
          <div>
            <h4 className="mb-2 text-xs font-bold uppercase text-muted-foreground">Current Values</h4>
            <div className="space-y-1">
              {Object.entries(values).map(([key, val]: any) => {
                const attr = attributes.find((a: Attribute) => a.attribute_key === key);
                return (
                  <div key={key} className="flex items-center justify-between border-b border-border/30 py-1.5">
                    <span className="text-sm text-muted-foreground">{attr?.label || key}</span>
                    <span className="text-sm font-medium text-foreground">{String(val ?? "—")}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Time-series KPIs */}
          {timeseries && Object.keys(timeseries.values).length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-bold uppercase text-muted-foreground">KPI History</h4>
              <div className="space-y-3">
                {Object.entries(timeseries.values)
                  .filter(([key]) => kpiKeys.includes(key))
                  .map(([key, data]: any) => (
                    <div key={key} className="rounded-lg bg-muted/20 p-3">
                      <p className="text-sm font-semibold text-foreground">
                        {attributes.find((a: Attribute) => a.attribute_key === key)?.label || key}
                      </p>
                      <div className="mt-1 flex items-end gap-1">
                        {data.map((d: any, i: number) => (
                          <div key={i} className="flex-1 text-center">
                            <div
                              className="mx-auto w-full rounded-t bg-primary/60"
                              style={{
                                height: `${Math.min((d.numeric || 0) / Math.max(...data.map((x: any) => x.numeric || 0)) * 60, 60)}px`,
                                minHeight: "2px",
                              }}
                            />
                            <p className="mt-1 text-xs font-medium text-foreground">{d.numeric ?? "—"}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-1 flex gap-1">
                        {timeseries.periods.map((p: string) => (
                          <span key={p} className="flex-1 text-center text-xs text-muted-foreground/60">{p}</span>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
