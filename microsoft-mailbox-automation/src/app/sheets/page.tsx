"use client";

import { useState, useEffect, useCallback } from "react";
import { ProcessedEmailRecord } from "@/types";
import { formatDate, truncate, safeJson } from "@/lib/utils";

export default function SheetsPage() {
  const [records, setRecords] = useState<ProcessedEmailRecord[]>([]);
  const [view, setView] = useState<"fields" | "tables" | "summary">("fields");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    try {
      const res = await fetch("/api/mailbox/status");
      const text = await res.text();
      const data = text ? safeJson(text) : {};
      setRecords(data.recentRecords || []);
    } catch (e) {
      console.error("[sheets] error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleExport = async (format: "excel" | "csv") => {
    if (format !== "excel" && format !== "csv") {
      setError("Invalid export format. Must be 'excel' or 'csv'.");
      return;
    }
    setExporting(true);
    setError(null);
    setExportResult(null);
    try {
      const res = await fetch("/api/sheets/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, category: categoryFilter || undefined }),
      });
      const text = await res.text();
      const data = text ? safeJson(text) : {};
      if (!data && text) { setError("Received invalid response from server"); return; }
      if (!res.ok) {
        setError(data.error);
      } else {
        setExportResult(`Exported ${data.recordCount} records to ${data.filepath}`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  const filteredRecords = categoryFilter
    ? records.filter((r) => r.category === categoryFilter)
    : records;

  const allFields = filteredRecords.flatMap((r) =>
    r.extractedData.fields.map((f) => ({
      ...f,
      emailSubject: r.subject,
      sender: r.sender,
      receivedDate: r.receivedDate,
      category: r.category,
      processedAt: r.processedAt,
    }))
  );

  const allTables = filteredRecords.flatMap((r) =>
    r.extractedData.tables.map((t) => ({
      ...t,
      emailSubject: r.subject,
      sender: r.sender,
      category: r.category,
    }))
  );

  const categories = Array.from(new Set(records.map((r) => r.category)));

  return (
    <div className="container mx-auto max-w-7xl space-y-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Extracted Data Sheets</h2>
          <p className="mt-1 text-sm text-slate-500">
            View and export all scientifically extracted data in spreadsheet format
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport("excel")}
            disabled={exporting || filteredRecords.length === 0}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
          >
            {exporting ? "Exporting..." : "Export Excel"}
          </button>
          <button
            onClick={() => handleExport("csv")}
            disabled={exporting || filteredRecords.length === 0}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="animate-fade-in rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}

      {exportResult && (
        <div className="animate-fade-in rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><polyline points="20 6 9 17 4 12" /></svg>
            {exportResult}
          </div>
        </div>
      )}

      <div className="flex items-center gap-4">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {(["fields", "tables", "summary"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold capitalize transition-all ${
                view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="w-48 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-500"></div>
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8 text-slate-300"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg>
          </div>
          <p className="text-sm text-slate-400">No data available. Process emails from the dashboard first.</p>
        </div>
      ) : view === "fields" ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-600">Email</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-600">Category</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-600">Field Key</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-600">Value</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-600">Type</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-600">Unit</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-600">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {allFields.slice(0, 100).map((field, i) => (
                <tr key={i} className="hover:bg-slate-50/50">
                  <td className="max-w-[200px] truncate px-4 py-2 text-slate-700">{truncate(field.emailSubject, 30)}</td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                      {field.category}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-semibold text-slate-900">{field.key}</td>
                  <td className="max-w-[200px] truncate px-4 py-2 text-slate-700">{field.value}</td>
                  <td className="px-4 py-2">
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {field.type}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-400">{field.unit || "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`font-semibold ${
                      field.confidence >= 0.8 ? "text-emerald-600" :
                      field.confidence >= 0.5 ? "text-amber-600" : "text-red-600"
                    }`}>
                      {(field.confidence * 100).toFixed(0)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {allFields.length > 100 && (
            <p className="p-3 text-center text-xs text-slate-400">
              Showing 100 of {allFields.length} fields. Export to see all.
            </p>
          )}
        </div>
      ) : view === "tables" ? (
        <div className="space-y-4">
          {allTables.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
              <p className="text-sm text-slate-400">No tables extracted.</p>
            </div>
          ) : (
            allTables.map((table, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-900">{table.name}</p>
                    <p className="text-xs text-slate-400">
                      From: {truncate(table.emailSubject, 40)} &middot; Source: {table.source} &middot; {table.rows.length} rows
                    </p>
                  </div>
                  <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                    {table.category}
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/50">
                        {table.headers.map((h, j) => (
                          <th key={j} className="px-3 py-2 text-left font-bold text-slate-600">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {table.rows.slice(0, 15).map((row, j) => (
                        <tr key={j} className="hover:bg-slate-50/50">
                          {table.headers.map((h, k) => (
                            <td key={k} className="px-3 py-2 text-slate-700">{String(row[h] ?? "")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {table.rows.length > 15 && (
                  <p className="mt-2 text-xs text-slate-400">
                    Showing 15 of {table.rows.length} rows
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-600">Subject</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-600">Sender</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-600">Category</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-600">Confidence</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-600">Fields</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-600">Tables</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-600">Summary</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-600">Processed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRecords.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/50">
                  <td className="max-w-[200px] truncate px-4 py-2 font-semibold text-slate-900">{truncate(r.subject, 30)}</td>
                  <td className="max-w-[150px] truncate px-4 py-2 text-slate-700">{r.sender}</td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                      {r.category}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`font-semibold ${
                      r.confidence >= 0.8 ? "text-emerald-600" :
                      r.confidence >= 0.5 ? "text-amber-600" : "text-red-600"
                    }`}>
                      {(r.confidence * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{r.fieldCount}</td>
                  <td className="px-4 py-2 text-slate-700">{r.tableCount}</td>
                  <td className="max-w-[300px] truncate px-4 py-2 text-slate-400">
                    {truncate(r.extractedData.summary, 50)}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-400">{formatDate(r.processedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
