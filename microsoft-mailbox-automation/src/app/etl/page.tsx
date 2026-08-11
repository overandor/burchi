"use client";

import { useCallback, useEffect, useState } from "react";
import { Pipeline, PipelineType, StepStatus, getPipelineStats } from "@/lib/etl/pipeline-engine";

const TYPE_LABELS: Record<string, string> = {
  expense_report: "Expense Report",
  balance_sheet: "Balance Sheet",
  invoice_processing: "Invoice Processing",
  meeting_followup: "Meeting Follow-up",
  data_enrichment: "Data Enrichment",
  compliance_check: "Compliance Check",
  research_task: "Research Task",
  generic_task: "Generic Task",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#64748b",
  executing: "#f59e0b",
  completed: "#10b981",
  failed: "#ef4444",
  skipped: "#475569",
};

export default function ETLPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Pipeline | null>(null);

  // Pipeline generator form
  const [emailSubject, setEmailSubject] = useState("Expense Report - Q3 Travel Costs");
  const [emailSender, setEmailSender] = useState("jane.doe@company.com");
  const [emailBody, setEmailBody] = useState("Please process the attached expense report for Q3 travel. Total: $4,250. Includes flights, hotels, meals, and ground transport. Receipts attached as CSV.");
  const [generating, setGenerating] = useState(false);

  // Business process form
  const [csvInput, setCsvInput] = useState("name,email,company,state,revenue\nJohn Smith,john@acme.com,acme,CA,50000\nJane Doe,jane@techcorp.com,TechCorp,NY,120000\nBob Wilson,bob@startup.io,Startup,CA,25000\nAlice Lee,alice@bigcorp.com,BigCorp,TX,200000\nJohn Smith,john@acme.com,acme,CA,50000");
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/etl/pipeline");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPipelines(data.pipelines || []);
      if (data.pipelines?.length > 0 && !selected) setSelected(data.pipelines[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => { load(); }, [load]);

  async function generatePipelineFromEmail() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/etl/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailId: `email-${Date.now()}`,
          sender: emailSender,
          subject: emailSubject,
          body: emailBody,
          attachments: [{ filename: "expenses.csv", contentType: "text/csv", size: 2048 }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSelected(data.pipeline);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function processCSV() {
    setProcessing(true);
    setError(null);
    setProcessResult(null);
    try {
      const res = await fetch("/api/etl/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: csvInput,
          inputType: "csv",
          outputFormat: "json",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProcessResult(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Processing failed");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 page-enter">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">ETL Pipelines</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Email-to-pipeline transformation · Self-evolving business processes · CSV enrichment & optimization
        </p>
      </div>

      {error && (
        <div className="mt-4 glass-card p-4">
          <p className="text-destructive text-sm">{error}</p>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Email → Pipeline */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-foreground">Email → Executable Pipeline</h2>
          <p className="mt-1 text-xs text-muted-foreground">Paste an email and generate an autonomous execution pipeline</p>

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Subject</label>
              <input
                type="text"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Sender</label>
              <input
                type="text"
                value={emailSender}
                onChange={(e) => setEmailSender(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Body</label>
              <textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground font-mono"
              />
            </div>
            <button
              onClick={generatePipelineFromEmail}
              disabled={generating}
              className="btn btn-primary w-full"
            >
              {generating ? "Generating…" : "Generate Pipeline"}
            </button>
          </div>
        </div>

        {/* CSV → Enriched Business Process */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-foreground">CSV → Self-Evolving Process</h2>
          <p className="mt-1 text-xs text-muted-foreground">Paste any CSV and get enrichment, dedup, standardization, and pattern discovery</p>

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Input Data (CSV or JSON)</label>
              <textarea
                value={csvInput}
                onChange={(e) => setCsvInput(e.target.value)}
                rows={8}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground font-mono"
              />
            </div>
            <button
              onClick={processCSV}
              disabled={processing}
              className="btn btn-primary w-full"
            >
              {processing ? "Processing…" : "Process & Enrich"}
            </button>
          </div>

          {processResult && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatMini label="Input Rows" value={String(processResult.inputRows)} />
                <StatMini label="Output Rows" value={String(processResult.outputRows)} />
                <StatMini label="Duplicates" value={String(processResult.summary.duplicatesRemoved)} accent="text-orange-400" />
                <StatMini label="Quality" value={`${Math.round(processResult.qualityScore * 100)}%`} accent="text-green-400" />
              </div>

              {processResult.enrichedColumns.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Enriched Columns</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {processResult.enrichedColumns.map((col: string) => (
                      <span key={col} className="badge border-green-500/30 bg-green-500/10 text-green-400 text-xs">{col}</span>
                    ))}
                  </div>
                </div>
              )}

              {processResult.summary.patterns.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Discovered Patterns</p>
                  <ul className="mt-1 space-y-1">
                    {processResult.summary.patterns.map((p: string, i: number) => (
                      <li key={i} className="text-sm text-foreground">• {p}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase">Output (first 5 rows)</p>
                <pre className="mt-1 rounded-lg bg-muted/20 p-3 text-xs overflow-x-auto max-h-48">
                  {JSON.stringify(processResult.output.slice(0, 5), null, 2)}
                </pre>
              </div>

              {processResult.templateId && (
                <div className="rounded-lg border border-border p-2">
                  <p className="text-xs text-muted-foreground">
                    Template: <span className="font-mono text-foreground">{processResult.templateId}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">This template will be reused and refined for similar future inputs.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Generated pipelines */}
      {pipelines.length > 0 && (
        <div className="mt-6 glass-card p-6">
          <h2 className="text-lg font-semibold text-foreground">Generated Pipelines ({pipelines.length})</h2>
          <div className="mt-4 space-y-2">
            {pipelines.map((p) => {
              const isActive = selected?.pipelineId === p.pipelineId;
              return (
                <button
                  key={p.pipelineId}
                  onClick={() => setSelected(p)}
                  className={`w-full text-left rounded-xl border p-3 transition-all ${isActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="badge border-primary/30 bg-primary/10 text-primary text-xs">{TYPE_LABELS[p.type] || p.type}</span>
                    <span className="text-xs font-mono text-muted-foreground">{p.pipelineId.slice(0, 20)}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{p.status}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-foreground">{p.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{p.source.sender} · {p.steps.length} steps</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected pipeline detail */}
      {selected && (
        <div className="mt-6 glass-card p-6">
          <h2 className="text-lg font-semibold text-foreground">Pipeline Detail</h2>
          <p className="mt-1 text-sm text-foreground">{selected.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">From: {selected.source.sender} · {selected.source.subject}</p>

          <div className="mt-4 space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase">Execution Steps</h3>
            {selected.steps.map((step, i) => {
              const color = STATUS_COLORS[step.status] || "#64748b";
              return (
                <div key={step.stepId} className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold" style={{ background: `${color}30`, color }}>
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{step.name}</span>
                      <span className="badge border-border text-xs" style={{ color }}>{step.status}</span>
                      <span className="badge border-border text-xs">{step.action}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Expected: {step.expectedOutput}</p>
                    {step.llmPrompt && (
                      <div className="mt-2">
                        <p className="text-xs font-semibold text-purple-400">LLM Prompt (temp: {step.llmTemperature})</p>
                        <pre className="mt-1 rounded-lg bg-muted/20 p-2 text-xs overflow-x-auto max-h-32">{step.llmPrompt}</pre>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatMini({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold ${accent || "text-foreground"}`}>{value}</p>
    </div>
  );
}
