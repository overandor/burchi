"use client";

import { useState, useEffect, useCallback } from "react";
import { ProcessedEmailRecord } from "@/types";
import { formatDate, truncate, safeJson } from "@/lib/utils";

export default function EmailsPage() {
  const [records, setRecords] = useState<ProcessedEmailRecord[]>([]);
  const [filtered, setFiltered] = useState<ProcessedEmailRecord[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<ProcessedEmailRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    try {
      const res = await fetch("/api/mailbox/status");
      const text = await res.text();
      const data = text ? safeJson(text) : {};
      if (!data && text) { setError("Received invalid response from server"); return; }
      setRecords(data.recentRecords || []);
      setFiltered(data.recentRecords || []);
    } catch (e) {
      console.error("[emails] error:", e);
      setError("Failed to load emails. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    let result = records;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.subject.toLowerCase().includes(q) ||
          r.sender.toLowerCase().includes(q) ||
          r.extractedData.summary.toLowerCase().includes(q)
      );
    }
    if (categoryFilter) {
      result = result.filter((r) => r.category === categoryFilter);
    }
    setFiltered(result);
  }, [records, search, categoryFilter]);

  const categories = Array.from(new Set(records.map((r) => r.category)));

  return (
    <div className="container mx-auto max-w-7xl space-y-6 px-6 py-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Processed Emails</h2>
        <p className="mt-1 text-sm text-slate-500">
          Browse and search all emails that have been processed by the pipeline
        </p>
      </div>

      {error && (
        <div className="animate-fade-in rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Search by subject, sender, or summary..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm scrollbar-thin lg:col-span-1">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-500"></div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-32 items-center justify-center">
              <p className="text-sm text-slate-400">No emails found. Sync from the dashboard.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filtered.map((record) => (
                <button
                  key={record.id}
                  onClick={() => setSelectedRecord(record)}
                  className={`w-full p-4 text-left transition-all ${
                    selectedRecord?.id === record.id ? "bg-indigo-50/50 ring-1 ring-indigo-200" : "hover:bg-slate-50"
                  }`}
                >
                  <p className="truncate text-sm font-semibold text-slate-900">{truncate(record.subject, 50)}</p>
                  <p className="mt-1 text-xs text-slate-500">{record.sender}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                      {record.category}
                    </span>
                    <span className="text-xs text-slate-400">
                      {(record.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          {!selectedRecord ? (
            <div className="flex min-h-[300px] items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8 text-slate-300"><path d="M4 4h16v16H4z"/><path d="M4 4l8 8 8-8"/></svg>
                </div>
                <p className="text-sm font-medium text-slate-500">Select an email to view extracted data</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{selectedRecord.subject}</h3>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                  <span>From: <span className="font-medium text-slate-700">{selectedRecord.sender}</span></span>
                  <span>&middot;</span>
                  <span>Received: {formatDate(selectedRecord.receivedDate)}</span>
                  <span>&middot;</span>
                  <span>Processed: {formatDate(selectedRecord.processedAt)}</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                    {selectedRecord.category}
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                    {(selectedRecord.confidence * 100).toFixed(0)}% confidence
                  </span>
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                    Source: {selectedRecord.extractedData.source}
                  </span>
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Summary</h4>
                <p className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 text-sm text-slate-600">
                  {selectedRecord.extractedData.summary}
                </p>
              </div>

              {selectedRecord.extractedData.fields.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                    Extracted Fields ({selectedRecord.extractedData.fields.length})
                  </h4>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/50">
                          <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-600">Key</th>
                          <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-600">Value</th>
                          <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-600">Type</th>
                          <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-600">Unit</th>
                          <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-600">Confidence</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedRecord.extractedData.fields.map((field, i) => (
                          <tr key={i} className="hover:bg-slate-50/50">
                            <td className="px-3 py-2 font-semibold text-slate-900">{field.key}</td>
                            <td className="px-3 py-2 text-slate-700">{field.value}</td>
                            <td className="px-3 py-2">
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                                {field.type}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-400">{field.unit || "—"}</td>
                            <td className="px-3 py-2">
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
                  </div>
                </div>
              )}

              {selectedRecord.extractedData.tables.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                    Extracted Tables ({selectedRecord.extractedData.tables.length})
                  </h4>
                  <div className="space-y-4">
                    {selectedRecord.extractedData.tables.map((table, i) => (
                      <div key={i} className="rounded-lg border border-slate-200 p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-sm font-semibold text-slate-900">{table.name}</p>
                          <span className="text-xs text-slate-400">
                            Source: {table.source} &middot; {table.rows.length} rows
                          </span>
                        </div>
                        <div className="overflow-x-auto rounded-md border border-slate-100">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-slate-200 bg-slate-50/50">
                                {table.headers.map((h, j) => (
                                  <th key={j} className="px-2 py-1.5 text-left font-bold text-slate-600">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {table.rows.slice(0, 10).map((row, j) => (
                                <tr key={j} className="hover:bg-slate-50/50">
                                  {table.headers.map((h, k) => (
                                    <td key={k} className="px-2 py-1.5 text-slate-700">{String(row[h] ?? "")}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {table.rows.length > 10 && (
                          <p className="mt-2 text-xs text-slate-400">
                            Showing 10 of {table.rows.length} rows
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
