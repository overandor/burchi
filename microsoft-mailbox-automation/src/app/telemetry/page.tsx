"use client";

import { useState, useEffect, useCallback } from "react";
import { ProcessedEmailRecord } from "@/types";

interface TelemetryMetric {
  key: string;
  label: string;
  value: number;
  unit: string;
  category: "revenue" | "efficiency" | "intelligence" | "risk";
  trend: "up" | "down" | "flat";
  changePercent: number;
  description: string;
}

interface TelemetryInsight {
  id: string;
  type: "opportunity" | "risk" | "efficiency" | "revenue";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  estimatedValue: number;
  actionable: boolean;
  recommendedAction: string;
}

interface UserTelemetry {
  user: string;
  email: string;
  totalEmails: number;
  processedEmails: number;
  metrics: TelemetryMetric[];
  revenuePerEmail: number;
  totalEstimatedRevenue: number;
  totalTimeSavedHours: number;
  efficiencyScore: number;
  topSenders: { sender: string; count: number; estimatedValue: number }[];
  categoryBreakdown: { category: string; count: number; revenue: number }[];
  revenueTimeline: { date: string; revenue: number; emails: number }[];
  insights: TelemetryInsight[];
}

interface TelemetryReport {
  generatedAt: string;
  user: string;
  totalUsers: number;
  aggregateMetrics: TelemetryMetric[];
  users: UserTelemetry[];
  topInsights: TelemetryInsight[];
  revenueByCategory: { category: string; revenue: number; count: number }[];
  efficiencyGains: { metric: string; before: number; after: number; improvement: number }[];
}

const CATEGORY_COLORS: Record<string, string> = {
  revenue: "#10b981",
  efficiency: "#3b82f6",
  intelligence: "#8b5cf6",
  risk: "#ef4444",
};

const SEVERITY_COLORS: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#10b981",
};

const TYPE_ICONS: Record<string, string> = {
  opportunity: "🎯",
  risk: "⚠️",
  efficiency: "⚡",
  revenue: "💰",
};

function formatCurrency(v: number): string {
  if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${v.toLocaleString()}`;
}

function formatNumber(v: number): string {
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return v.toLocaleString();
}

export default function TelemetryPage() {
  const [report, setReport] = useState<TelemetryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"overview" | "insights" | "efficiency" | "mcp">("overview");
  const [mcpManifest, setMcpManifest] = useState<any>(null);

  const fetchTelemetry = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Get records from localStorage (populated by sync)
      const local = localStorage.getItem("processed-emails");
      let records: ProcessedEmailRecord[] = [];
      if (local) {
        try { records = JSON.parse(local); } catch {}
      }

      // Also try fetching from the API
      try {
        const res = await fetch("/api/sheets/export?format=json");
        const text = await res.text();
        if (text) {
          const data = JSON.parse(text);
          if (data.records && data.records.length > 0) {
            records = data.records;
          }
        }
      } catch {}

      // Call MCP endpoint with records via POST (avoids 414 URI Too Long)
      const res = await fetch(`/api/mcp?action=report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records, action: "report" }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (data.error) {
        setError(data.error);
      } else {
        setReport(data);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMCPManifest = useCallback(async () => {
    try {
      const local = localStorage.getItem("processed-emails");
      let records: any[] = [];
      if (local) { try { records = JSON.parse(local); } catch {} }
      const res = await fetch(`/api/mcp?action=manifest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records, action: "manifest" }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      setMcpManifest(data);
    } catch (e: any) {
      console.error("MCP manifest error:", e);
    }
  }, []);

  useEffect(() => {
    fetchTelemetry();
  }, [fetchTelemetry]);

  useEffect(() => {
    if (view === "mcp") fetchMCPManifest();
  }, [view, fetchMCPManifest]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-200 border-t-slate-900 mx-auto mb-4"></div>
          <p className="text-sm text-slate-500">Generating telemetry report...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-600 mb-4">{error}</p>
          <button
            onClick={fetchTelemetry}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!report || report.users.length === 0 || report.aggregateMetrics[3]?.value === 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center max-w-md">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
            <svg className="h-6 w-6 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">No telemetry data yet</h2>
          <p className="text-sm text-slate-500 mb-4">
            Sync your mailbox first to generate revenue and efficiency telemetry.
            The system needs processed email records to calculate metrics.
          </p>
          <a href="/dashboard" className="inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Go to Dashboard
          </a>
        </div>
      </div>
    );
  }

  const user = report.users[0];
  const maxCategoryRevenue = Math.max(...report.revenueByCategory.map(c => c.revenue), 1);
  const maxTimelineRevenue = Math.max(...user.revenueTimeline.map(t => t.revenue), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Telemetry</h1>
          <p className="text-sm text-slate-500">
            Revenue & efficiency intelligence for {user.user} · {user.email}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {(["overview", "insights", "efficiency", "mcp"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-all ${
                view === v
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {v === "mcp" ? "MCP" : v}
            </button>
          ))}
        </div>
      </div>

      {/* Overview View */}
      {view === "overview" && (
        <div className="space-y-6">
          {/* Aggregate Metrics */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {report.aggregateMetrics.map((m) => (
              <div
                key={m.key}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{m.category}</span>
                  <span className={`text-xs font-medium ${m.trend === "up" ? "text-emerald-600" : "text-red-500"}`}>
                    {m.trend === "up" ? "↑" : "↓"} {m.changePercent}%
                  </span>
                </div>
                <div className="text-2xl font-bold text-slate-900">
                  {m.unit === "USD" ? formatCurrency(m.value) : formatNumber(m.value)}
                  <span className="ml-1 text-sm font-normal text-slate-400">{m.unit !== "USD" ? m.unit : ""}</span>
                </div>
                <p className="mt-1 text-xs font-medium text-slate-600">{m.label}</p>
                <p className="mt-0.5 text-xs text-slate-400">{m.description}</p>
              </div>
            ))}
          </div>

          {/* Revenue by Category */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-base font-bold text-slate-900">Revenue by Email Category</h2>
            <div className="space-y-3">
              {report.revenueByCategory.map((cat) => (
                <div key={cat.category}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="capitalize text-slate-700">{cat.category} ({cat.count} emails)</span>
                    <span className="font-semibold text-emerald-600">{formatCurrency(cat.revenue)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all"
                      style={{ width: `${(cat.revenue / maxCategoryRevenue) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Revenue Timeline */}
          {user.revenueTimeline.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-base font-bold text-slate-900">Revenue Timeline</h2>
              <div className="flex h-40 items-end gap-1 overflow-x-auto">
                {user.revenueTimeline.map((t, i) => (
                  <div key={i} className="flex min-w-[40px] flex-col items-center">
                    <div className="mb-1 text-xs text-slate-400">{formatCurrency(t.revenue)}</div>
                    <div
                      className="w-8 rounded-t bg-gradient-to-t from-indigo-500 to-indigo-400 transition-all hover:from-indigo-600 hover:to-indigo-500"
                      style={{ height: `${(t.revenue / maxTimelineRevenue) * 100}%`, minHeight: "4px" }}
                      title={`${t.emails} emails on ${t.date}`}
                    />
                    <div className="mt-1 origin-left rotate-45 text-xs text-slate-400">{t.date.slice(5)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Senders */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-base font-bold text-slate-900">Top Senders by Value</h2>
            <div className="space-y-1">
              {user.topSenders.map((s, i) => (
                <div key={i} className="flex items-center justify-between border-b border-slate-100 py-2.5 last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-xs font-bold text-white">
                      {s.sender.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-900">{s.sender}</div>
                      <div className="text-xs text-slate-400">{s.count} emails</div>
                    </div>
                  </div>
                  <div className="font-semibold text-emerald-600">{formatCurrency(s.estimatedValue)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* User Metrics Detail */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-base font-bold text-slate-900">Per-User Metrics</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              {user.metrics.map((m) => (
                <div key={m.key} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                  <div className="mb-1 text-xs text-slate-400">{m.label}</div>
                  <div className="text-xl font-bold text-slate-900">
                    {m.unit === "USD" ? formatCurrency(m.value) : `${formatNumber(m.value)}${m.unit !== "emails" && m.unit !== "hours" && m.unit !== "fields" ? m.unit : ""}`}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{m.description}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

        {view === "insights" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">Actionable Insights</h2>
              <span className="text-sm text-slate-400">{report.topInsights.length} insights · sorted by value</span>
            </div>
            {report.topInsights.map((insight) => (
              <div
                key={insight.id}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md"
              >
                <div className="flex items-start gap-4">
                  <div className="text-2xl">{TYPE_ICONS[insight.type]}</div>
                  <div className="flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-slate-900">{insight.title}</h3>
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: `${SEVERITY_COLORS[insight.severity]}15`,
                          color: SEVERITY_COLORS[insight.severity],
                        }}
                      >
                        {insight.severity}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-500">
                        {insight.type}
                      </span>
                    </div>
                    <p className="mb-3 text-sm text-slate-600">{insight.description}</p>
                    {insight.actionable && (
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                        <div className="mb-1 text-xs font-medium text-slate-400">Recommended Action</div>
                        <p className="text-sm text-slate-700">{insight.recommendedAction}</p>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-emerald-600">
                      {formatCurrency(insight.estimatedValue)}
                    </div>
                    <div className="text-xs text-slate-400">est. value</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Efficiency View */}
        {view === "efficiency" && (
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-base font-bold text-slate-900">Efficiency Gains</h2>
              <div className="space-y-4">
                {report.efficiencyGains.map((gain, i) => (
                  <div key={i} className="rounded-lg border border-slate-100 bg-slate-50/50 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-medium text-slate-900">{gain.metric}</h3>
                      <span className="text-lg font-bold text-emerald-600">{gain.improvement.toFixed(1)}% faster</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <div className="mb-1 text-xs text-slate-400">Before (manual)</div>
                        <div className="flex h-6 items-center rounded bg-red-50 px-2">
                          <span className="text-sm text-red-600">{gain.before.toFixed(1)} min/email</span>
                        </div>
                      </div>
                      <div className="text-slate-300">→</div>
                      <div className="flex-1">
                        <div className="mb-1 text-xs text-slate-400">After (automated)</div>
                        <div className="flex h-6 items-center rounded bg-emerald-50 px-2">
                          <span className="text-sm text-emerald-600">{gain.after.toFixed(1)} min/email</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Efficiency Score Breakdown */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-base font-bold text-slate-900">Efficiency Score Breakdown</h2>
              <div className="flex items-center gap-6">
                <div className="relative h-32 w-32">
                  <svg className="h-32 w-32 -rotate-90 transform">
                    <circle cx="64" cy="64" r="56" fill="none" stroke="#e2e8f0" strokeWidth="12" />
                    <circle
                      cx="64" cy="64" r="56" fill="none" stroke="#10b981" strokeWidth="12"
                      strokeDasharray={`${(user.efficiencyScore / 100) * 351.86} 351.86`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-3xl font-bold text-emerald-600">{user.efficiencyScore}</div>
                      <div className="text-xs text-slate-400">/ 100</div>
                    </div>
                  </div>
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Emails Processed</span>
                    <span className="font-medium text-slate-900">{user.processedEmails} / {user.totalEmails}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Time Saved</span>
                    <span className="font-medium text-slate-900">{user.totalTimeSavedHours} hours</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Revenue per Email</span>
                    <span className="font-medium text-emerald-600">{formatCurrency(user.revenuePerEmail)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Total Revenue Potential</span>
                    <span className="font-medium text-emerald-600">{formatCurrency(user.totalEstimatedRevenue)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MCP Server View */}
        {view === "mcp" && (
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900">MCP Server Endpoint</h2>
                  <p className="text-sm text-slate-500">Model Context Protocol — expose telemetry to any LLM client</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
                  Active
                </span>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-sm">
                <div className="text-slate-400">Endpoint URL:</div>
                <div className="mt-1 text-emerald-600">
                  {typeof window !== "undefined" ? window.location.origin : ""}/api/mcp
                </div>
              </div>
            </div>

            {mcpManifest && (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="mb-3 font-bold text-slate-900">Available Resources</h3>
                  <div className="space-y-2">
                    {mcpManifest.resources?.map((r: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg border border-slate-100 p-3">
                        <span className="font-mono text-sm text-indigo-600">{r.uri}</span>
                        <span className="text-sm text-slate-300">·</span>
                        <span className="text-sm text-slate-600">{r.name}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="mb-3 font-bold text-slate-900">Available Tools</h3>
                  <div className="space-y-2">
                    {mcpManifest.tools?.map((t: any, i: number) => (
                      <div key={i} className="rounded-lg border border-slate-100 p-3">
                        <div className="font-mono text-sm text-emerald-600">{t.name}</div>
                        <div className="mt-1 text-sm text-slate-500">{t.description}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="mb-3 font-bold text-slate-900">Usage Example</h3>
                  <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-4 text-sm text-slate-300">
{`# Get full telemetry report
curl "${typeof window !== "undefined" ? window.location.origin : ""}/api/mcp?action=report"

# Get top insights
curl "${typeof window !== "undefined" ? window.location.origin : ""}/api/mcp?action=insights"

# Invoke a tool
curl -X POST "${typeof window !== "undefined" ? window.location.origin : ""}/api/mcp" \\
  -H "Content-Type: application/json" \\
  -d '{"tool": "get_revenue_report"}'`}
                  </pre>
                </div>
              </>
            )}
          </div>
        )}
    </div>
  );
}
