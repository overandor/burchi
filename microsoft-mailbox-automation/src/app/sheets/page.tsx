"use client";

import { useState, useEffect, useCallback } from "react";
import { ProcessedEmailRecord } from "@/types";
import { formatDate, truncate } from "@/lib/utils";

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
      const data = text ? JSON.parse(text) : {};
      setRecords(data.recentRecords || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleExport = async (format: "excel" | "csv") => {
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
      const data = text ? JSON.parse(text) : {};
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Extracted Data Sheets</h2>
          <p className="text-sm text-muted-foreground">
            View and export all scientifically extracted data in spreadsheet format
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport("excel")}
            disabled={exporting || filteredRecords.length === 0}
            className="btn btn-primary"
          >
            {exporting ? "Exporting..." : "Export Excel"}
          </button>
          <button
            onClick={() => handleExport("csv")}
            disabled={exporting || filteredRecords.length === 0}
            className="btn btn-outline"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <strong>Error:</strong> {error}
        </div>
      )}

      {exportResult && (
        <div className="rounded-lg border border-green-500/50 bg-green-500/10 p-4 text-sm text-green-700">
          {exportResult}
        </div>
      )}

      <div className="flex items-center gap-4">
        <div className="flex gap-1 rounded-lg border p-1">
          {(["fields", "tables", "summary"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                view === v
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
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

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : filteredRecords.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No data available. Process emails from the dashboard first.
          </p>
        </div>
      ) : view === "fields" ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-3 px-4 font-medium">Email</th>
                <th className="text-left py-3 px-4 font-medium">Category</th>
                <th className="text-left py-3 px-4 font-medium">Field Key</th>
                <th className="text-left py-3 px-4 font-medium">Value</th>
                <th className="text-left py-3 px-4 font-medium">Type</th>
                <th className="text-left py-3 px-4 font-medium">Unit</th>
                <th className="text-left py-3 px-4 font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {allFields.slice(0, 100).map((field, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-2 px-4 max-w-[200px] truncate">{truncate(field.emailSubject, 30)}</td>
                  <td className="py-2 px-4">
                    <span className="badge border-primary/30 bg-primary/10 text-primary">
                      {field.category}
                    </span>
                  </td>
                  <td className="py-2 px-4 font-medium">{field.key}</td>
                  <td className="py-2 px-4 max-w-[200px] truncate">{field.value}</td>
                  <td className="py-2 px-4">
                    <span className="badge border-secondary bg-secondary text-secondary-foreground">
                      {field.type}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-muted-foreground">{field.unit || "—"}</td>
                  <td className="py-2 px-4">
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
          {allFields.length > 100 && (
            <p className="p-3 text-xs text-muted-foreground text-center">
              Showing 100 of {allFields.length} fields. Export to see all.
            </p>
          )}
        </div>
      ) : view === "tables" ? (
        <div className="space-y-4">
          {allTables.length === 0 ? (
            <div className="card p-12 text-center">
              <p className="text-sm text-muted-foreground">No tables extracted.</p>
            </div>
          ) : (
            allTables.map((table, i) => (
              <div key={i} className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-medium">{table.name}</p>
                    <p className="text-xs text-muted-foreground">
                      From: {truncate(table.emailSubject, 40)} &middot; Source: {table.source} &middot; {table.rows.length} rows
                    </p>
                  </div>
                  <span className="badge border-primary/30 bg-primary/10 text-primary">
                    {table.category}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        {table.headers.map((h, j) => (
                          <th key={j} className="text-left py-2 px-3 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.slice(0, 15).map((row, j) => (
                        <tr key={j} className="border-b last:border-0">
                          {table.headers.map((h, k) => (
                            <td key={k} className="py-2 px-3">{String(row[h] ?? "")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {table.rows.length > 15 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Showing 15 of {table.rows.length} rows
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-3 px-4 font-medium">Subject</th>
                <th className="text-left py-3 px-4 font-medium">Sender</th>
                <th className="text-left py-3 px-4 font-medium">Category</th>
                <th className="text-left py-3 px-4 font-medium">Confidence</th>
                <th className="text-left py-3 px-4 font-medium">Fields</th>
                <th className="text-left py-3 px-4 font-medium">Tables</th>
                <th className="text-left py-3 px-4 font-medium">Summary</th>
                <th className="text-left py-3 px-4 font-medium">Processed</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-2 px-4 max-w-[200px] truncate font-medium">{truncate(r.subject, 30)}</td>
                  <td className="py-2 px-4 max-w-[150px] truncate">{r.sender}</td>
                  <td className="py-2 px-4">
                    <span className="badge border-primary/30 bg-primary/10 text-primary">
                      {r.category}
                    </span>
                  </td>
                  <td className="py-2 px-4">
                    <span className={
                      r.confidence >= 0.8 ? "text-green-600" :
                      r.confidence >= 0.5 ? "text-orange-600" : "text-red-600"
                    }>
                      {(r.confidence * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="py-2 px-4">{r.fieldCount}</td>
                  <td className="py-2 px-4">{r.tableCount}</td>
                  <td className="py-2 px-4 max-w-[300px] truncate text-muted-foreground">
                    {truncate(r.extractedData.summary, 50)}
                  </td>
                  <td className="py-2 px-4 text-xs text-muted-foreground">{formatDate(r.processedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
