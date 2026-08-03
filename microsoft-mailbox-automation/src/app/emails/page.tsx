"use client";

import { useState, useEffect, useCallback } from "react";
import { ProcessedEmailRecord } from "@/types";
import { formatDate, truncate } from "@/lib/utils";

export default function EmailsPage() {
  const [records, setRecords] = useState<ProcessedEmailRecord[]>([]);
  const [filtered, setFiltered] = useState<ProcessedEmailRecord[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<ProcessedEmailRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRecords = useCallback(async () => {
    try {
      const res = await fetch("/api/mailbox/status");
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      setRecords(data.recentRecords || []);
      setFiltered(data.recentRecords || []);
    } catch (e) {
      console.error(e);
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
        <h2 className="text-2xl font-bold">Processed Emails</h2>
        <p className="text-sm text-muted-foreground">
          Browse and search all emails that have been processed by the pipeline
        </p>
      </div>

      <div className="flex gap-4">
        <input
          type="text"
          placeholder="Search by subject, sender, or summary..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input flex-1"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="input w-48"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-1 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground text-center">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">
              No emails found. Sync and process emails from the dashboard.
            </p>
          ) : (
            <div className="divide-y">
              {filtered.map((record) => (
                <button
                  key={record.id}
                  onClick={() => setSelectedRecord(record)}
                  className={`w-full text-left p-4 hover:bg-accent transition-colors ${
                    selectedRecord?.id === record.id ? "bg-accent" : ""
                  }`}
                >
                  <p className="text-sm font-medium truncate">{truncate(record.subject, 50)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{record.sender}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="badge border-primary/30 bg-primary/10 text-primary">
                      {record.category}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {(record.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card p-6 lg:col-span-2">
          {!selectedRecord ? (
            <div className="flex items-center justify-center h-full min-h-[300px]">
              <p className="text-sm text-muted-foreground">
                Select an email to view extracted data
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold">{selectedRecord.subject}</h3>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span>From: {selectedRecord.sender}</span>
                  <span>&middot;</span>
                  <span>Received: {formatDate(selectedRecord.receivedDate)}</span>
                  <span>&middot;</span>
                  <span>Processed: {formatDate(selectedRecord.processedAt)}</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="badge border-primary/30 bg-primary/10 text-primary">
                    {selectedRecord.category}
                  </span>
                  <span className="badge border-green-500/30 bg-green-500/10 text-green-700">
                    {(selectedRecord.confidence * 100).toFixed(0)}% confidence
                  </span>
                  <span className="badge border-blue-500/30 bg-blue-500/10 text-blue-700">
                    Source: {selectedRecord.extractedData.source}
                  </span>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-2">Summary</h4>
                <p className="text-sm text-muted-foreground bg-muted/50 rounded-md p-4">
                  {selectedRecord.extractedData.summary}
                </p>
              </div>

              {selectedRecord.extractedData.fields.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">
                    Extracted Fields ({selectedRecord.extractedData.fields.length})
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-3 font-medium">Key</th>
                          <th className="text-left py-2 px-3 font-medium">Value</th>
                          <th className="text-left py-2 px-3 font-medium">Type</th>
                          <th className="text-left py-2 px-3 font-medium">Unit</th>
                          <th className="text-left py-2 px-3 font-medium">Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRecord.extractedData.fields.map((field, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-2 px-3 font-medium">{field.key}</td>
                            <td className="py-2 px-3">{field.value}</td>
                            <td className="py-2 px-3">
                              <span className="badge border-secondary bg-secondary text-secondary-foreground">
                                {field.type}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-muted-foreground">{field.unit || "—"}</td>
                            <td className="py-2 px-3">
                              <span className={
                                field.confidence >= 0.8 ? "text-green-600" :
                                field.confidence >= 0.5 ? "text-orange-600" : "text-red-600"
                              }>
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
                  <h4 className="text-sm font-semibold mb-2">
                    Extracted Tables ({selectedRecord.extractedData.tables.length})
                  </h4>
                  <div className="space-y-4">
                    {selectedRecord.extractedData.tables.map((table, i) => (
                      <div key={i} className="border rounded-md p-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="font-medium text-sm">{table.name}</p>
                          <span className="text-xs text-muted-foreground">
                            Source: {table.source} &middot; {table.rows.length} rows
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b">
                                {table.headers.map((h, j) => (
                                  <th key={j} className="text-left py-1.5 px-2 font-medium">
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {table.rows.slice(0, 10).map((row, j) => (
                                <tr key={j} className="border-b last:border-0">
                                  {table.headers.map((h, k) => (
                                    <td key={k} className="py-1.5 px-2">
                                      {String(row[h] ?? "")}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {table.rows.length > 10 && (
                          <p className="text-xs text-muted-foreground mt-2">
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
