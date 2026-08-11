"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useVoiceCommand } from "@/components/useVoiceCommand";
import { useVoicePage } from "@/components/VoiceContext";

const COMMITMENT_KEYWORDS = [
  "i will", "i'll", "we will", "we'll", "i promise", "we promise",
  "follow up", "follow-up", "get back to you", "send you", "deliver by",
  "by friday", "by monday", "by end of week", "deadline", "commit to",
  "action item", "next step", "i owe", "we owe", "schedule", "confirm",
];

const RESEARCH_SIGNAL_KEYWORDS = [
  "study", "trial", "data", "evidence", "result", "finding", "outcome",
  "hypothesis", "correlation", "signal", "metric", "benchmark", "analysis",
  "research", "experiment", "cohort", "placebo", "endpoint", "efficacy",
  "adoption", "uptake", "retention", "conversion", "lift",
];

function countSignals(text: string, keywords: string[]): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  return keywords.reduce((acc, kw) => (lower.includes(kw) ? acc + 1 : acc), 0);
}

interface InboxAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  rowCount?: number;
  headers?: string[];
  parsedType?: string;
  preview?: Record<string, unknown>[];
}

interface InboxEmail {
  id: string;
  subject: string;
  from: string;
  fromEmail?: string;
  date: string;
  preview: string;
  body?: string;
  hasAttachments: boolean;
  attachmentCount?: number;
  attachments?: InboxAttachment[];
  category?: string;
  confidence?: number;
  fieldCount?: number;
  tableCount?: number;
  extractedFields?: Array<{ key: string; value: string; type: string; confidence: number }>;
  isRead: boolean;
  processed: boolean;
}

interface InboxProvider {
  provider: string;
  configured: boolean;
  email?: string;
  host?: string;
  port?: number;
  hasCredentials: boolean;
  message: string;
}

export default function InboxPage() {
  const [loading, setLoading] = useState(true);
  const [emails, setEmails] = useState<InboxEmail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<InboxProvider | null>(null);
  const [totalAttachments, setTotalAttachments] = useState(0);
  const [totalFields, setTotalFields] = useState(0);
  const [totalTables, setTotalTables] = useState(0);
  const [msConfig, setMsConfig] = useState<{ token: string; email: string } | null>(null);
  const [gmailConfig, setGmailConfig] = useState<{ clientId: string; refreshToken: string; accessToken: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const canSyncMicrosoft = msConfig || (provider?.provider === "graph" && provider?.configured);
  const canSyncGmail = gmailConfig || (provider?.provider === "gmail" && provider?.configured);
  const [selectedEmail, setSelectedEmail] = useState<InboxEmail | null>(null);
  const [selectedAttachment, setSelectedAttachment] = useState<InboxAttachment | null>(null);
  const [attachmentDetail, setAttachmentDetail] = useState<any>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [attSummary, setAttSummary] = useState<string | null>(null);
  const [attSummarizing, setAttSummarizing] = useState(false);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [viewMode, setViewMode] = useState<"table" | "chart" | "json">("table");

  // LLM analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [llmUsed, setLlmUsed] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/mailbox/status");
      const data = await res.json();
      setEmails(data.recentEmails || []);
      setProvider(data.provider || null);
      setTotalAttachments(data.totalAttachments || 0);
      setTotalFields(data.totalExtractedFields || 0);
      setTotalTables(data.totalExtractedTables || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    try {
      const raw = localStorage.getItem("microsoft-config");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.token && parsed.email) {
          setMsConfig({ token: parsed.token, email: parsed.email });
        }
      }
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem("gmail-config");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.clientId && (parsed.refreshToken || parsed.accessToken)) {
          setGmailConfig({
            clientId: parsed.clientId,
            refreshToken: parsed.refreshToken || "",
            accessToken: parsed.accessToken || "",
          });
        }
      }
    } catch { /* ignore */ }
  }, [load]);

  async function syncMailboxFromProvider() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/mailbox/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "microsoft",
          maxEmails: 25,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sync failed.");
      } else {
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function syncMailbox() {
    if (!msConfig?.token || !msConfig?.email) {
      setError("Microsoft 365 is not connected. Go to Settings to connect.");
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/mailbox/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${msConfig.token}`,
        },
        body: JSON.stringify({
          provider: "microsoft",
          mailbox: msConfig.email,
          maxEmails: 25,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sync failed.");
      } else {
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function syncGmailFromProvider() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/gmail/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxEmails: 25 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Gmail sync failed.");
      } else {
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gmail sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function syncGmail() {
    if (!gmailConfig?.clientId || !gmailConfig?.refreshToken) {
      setError("Gmail is not connected. Go to Settings to connect.");
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/gmail/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: gmailConfig.clientId,
          refreshToken: gmailConfig.refreshToken,
          maxEmails: 25,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Gmail sync failed.");
      } else {
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gmail sync failed");
    } finally {
      setSyncing(false);
    }
  }

  // Derived intelligence stats from the email corpus
  const stats = useMemo(() => {
    const total = emails.length;
    let pendingCommitments = 0;
    let researchSignals = 0;
    for (const e of emails) {
      const corpus = `${e.subject || ""} ${e.preview || ""} ${e.body || ""}`;
      if (countSignals(corpus, COMMITMENT_KEYWORDS) > 0) pendingCommitments += 1;
      researchSignals += countSignals(corpus, RESEARCH_SIGNAL_KEYWORDS);
    }
    return { total, pendingCommitments, researchSignals };
  }, [emails]);

  async function loadAttachmentDetail(emailId: string, index: number, att: InboxAttachment) {
    setSelectedAttachment(att);
    setAttachmentLoading(true);
    setAttachmentDetail(null);
    setAttSummary(null);
    setSortCol(null);
    setViewMode("table");
    try {
      const res = await fetch(`/api/inbox/attachments?emailId=${emailId}&attachmentIndex=${index}`);
      const data = await res.json();
      setAttachmentDetail(data);
    } catch (e) {
      setAttachmentDetail({ error: e instanceof Error ? e.message : "Failed to load attachment" });
    } finally {
      setAttachmentLoading(false);
    }
  }

  async function summarizeAttachment() {
    if (!attachmentDetail || attSummarizing) return;
    setAttSummarizing(true);
    setAttSummary(null);
    try {
      const headers = attachmentDetail.headers || [];
      const rows = attachmentDetail.rows || [];
      const sample = rows.slice(0, 20).map((r: Record<string, unknown>) =>
        headers.map((h: string) => `${h}: ${r[h] ?? ""}`).join(", ")
      ).join("\n");

      const res = await fetch("/api/llm/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: "You are a data analyst for a pharma field-execution system. Analyze the provided attachment data sample and produce: (1) A one-paragraph summary of what the data contains. (2) Key statistics or patterns detected (numeric ranges, category distributions, notable values). (3) Data quality observations (missing values, potential errors, duplicates). (4) Relevance to field execution or research hypotheses. Be concise and specific.",
            },
            {
              role: "user",
              content: `Attachment: ${selectedAttachment?.name || "unknown"}\nColumns: ${headers.join(", ")}\nTotal rows: ${attachmentDetail.rowCount || rows.length}\nSample data (first 20 rows):\n${sample}`,
            },
          ],
          temperature: 0.3,
          max_tokens: 1024,
        }),
      });
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning || "";
      setAttSummary(content || "No summary generated.");
    } catch (e) {
      setAttSummary(`Error: ${e instanceof Error ? e.message : "Summarization failed"}`);
    } finally {
      setAttSummarizing(false);
    }
  }

  function detectColumnType(header: string, rows: Record<string, unknown>[]): "numeric" | "date" | "boolean" | "text" {
    const values = rows.slice(0, 50).map((r) => r[header]).filter((v) => v !== null && v !== undefined && v !== "");
    if (values.length === 0) return "text";
    const numericCount = values.filter((v) => !isNaN(parseFloat(String(v))) && isFinite(Number(v))).length;
    if (numericCount / values.length > 0.8) return "numeric";
    const dateCount = values.filter((v) => !isNaN(Date.parse(String(v)))).length;
    if (dateCount / values.length > 0.7) return "date";
    const boolCount = values.filter((v) => ["true", "false", "yes", "no", "0", "1"].includes(String(v).toLowerCase())).length;
    if (boolCount / values.length > 0.8) return "boolean";
    return "text";
  }

  function getNumericStats(header: string, rows: Record<string, unknown>[]) {
    const values = rows.map((r) => parseFloat(String(r[header]))).filter((v) => !isNaN(v) && isFinite(v));
    if (values.length === 0) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    return { min, max, avg, count: values.length };
  }

  function getSortedRows(): Record<string, unknown>[] {
    if (!attachmentDetail?.rows || !sortCol) return attachmentDetail?.rows || [];
    const rows = [...attachmentDetail.rows];
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const an = parseFloat(String(av));
      const bn = parseFloat(String(bv));
      if (!isNaN(an) && !isNaN(bn)) return (an - bn) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return rows;
  }

  async function analyzeInbox() {
    if (emails.length === 0 || analyzing) return;
    setAnalyzing(true);
    setAnalysis(null);
    setAnalysisError(null);
    setLlmUsed(null);
    try {
      const corpus = emails
        .slice(0, 25)
        .map((e, i) => `--- EMAIL ${i + 1} ---\nFrom: ${e.from || "unknown"}\nDate: ${e.date || "unknown"}\nSubject: ${e.subject || "(no subject)"}\nPreview: ${(e.preview || "").slice(0, 400)}\nAttachments: ${e.attachmentCount || 0}`)
        .join("\n\n");

      const res = await fetch("/api/llm/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "You are an inbox intelligence analyst for a pharma field-execution innovation system (Advantage Foundry). Analyze the provided inbox emails and identify: (1) potential research signals — data, metrics, outcomes, or evidence relevant to ongoing hypotheses; (2) commitments — explicit or implicit promises, deadlines, follow-ups, and action items owed by or to the user; (3) hypothesis-relevant evidence — observations that could support, refute, or confound a current experiment. Return a structured markdown report with three sections (## Research Signals, ## Commitments, ## Hypothesis-Relevant Evidence). Be concise, specific, and cite the email subject/sender where relevant. If nothing is found in a category, state 'None detected.'",
            },
            {
              role: "user",
              content: `Analyze the following ${emails.length} inbox emails and produce the intelligence report:\n\n${corpus}`,
            },
          ],
          temperature: 0.4,
          max_tokens: 2048,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`);
      }
      const data = await res.json();
      const content =
        data.choices?.[0]?.message?.content ||
        data.choices?.[0]?.message?.reasoning ||
        "";
      if (!content) {
        throw new Error("LLM returned an empty response.");
      }
      setAnalysis(content);
      setLlmUsed(true);
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "Inbox analysis failed.");
      setLlmUsed(false);
    } finally {
      setAnalyzing(false);
    }
  }

  useVoiceCommand({
    analyze_inbox: () => analyzeInbox(),
  });

  useVoicePage({
    pageId: "inbox",
    title: "Communication Telemetry",
    summary: `Signal stream via ${provider?.provider || "demo"}. ${emails.length} message${emails.length !== 1 ? "s" : ""}, ${totalAttachments} attachment${totalAttachments !== 1 ? "s" : ""}, ${totalFields} extracted field${totalFields !== 1 ? "s" : ""}.`,
    actions: [
      {
        name: "analyze_inbox",
        label: "analyze inbox",
        available: emails.length > 0 && !analyzing,
        handler: async () => {
          await analyzeInbox();
          return { success: true, speech: "Inbox analysis complete. Review the signals below." };
        },
      },
    ],
  });

  const hasRealProvider =
    msConfig ||
    gmailConfig ||
    (provider && provider.provider !== "demo" && provider.provider !== "none" && provider.configured);

  const providerBadgeColor = (p?: string) => {
    switch (p) {
      case "gmail": return "border-red-500/30 bg-red-500/10 text-red-400";
      case "imap": return "border-blue-500/30 bg-blue-500/10 text-blue-400";
      case "graph": return "border-purple-500/30 bg-purple-500/10 text-purple-400";
      case "demo":
      default: return "border-muted-foreground/20 bg-muted/10 text-muted-foreground";
    }
  };

  return (
    <div className="page-enter mx-auto max-w-6xl px-8 py-10">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-foreground text-3xl font-bold tracking-tight">Communication Telemetry</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            The mailbox is a sensor. Every message produces observations about what happened under
            particular circumstances. Attachments are evidence. Commitments are experimental variables.
            This stream feeds the hypothesis engine.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {provider && provider.provider !== "demo" && provider.provider !== "none" && (
            <span className={`badge ${providerBadgeColor(provider.provider)}`}>
              <span className="status-dot bg-current" />
              {provider.provider.toUpperCase()} · {provider.configured ? "Connected" : "Not configured"}
            </span>
          )}
          {msConfig && (
            <span className="badge border-purple-500/30 bg-purple-500/10 text-purple-400 text-xs">
              <span className="status-dot bg-current" />
              Microsoft · Connected
            </span>
          )}
          {gmailConfig && (
            <span className="badge border-red-500/30 bg-red-500/10 text-red-400 text-xs">
              <span className="status-dot bg-current" />
              Gmail · Connected
            </span>
          )}
          <span className={`llm-badge ${analyzing ? "llm-badge-thinking" : llmUsed === false ? "llm-badge-offline" : "llm-badge-live"}`}>
            <span className="status-dot bg-current" />
            {analyzing ? "Analyzing" : llmUsed === false ? "LLM Offline" : "LLM Ready"}
          </span>
        </div>
      </div>

      {/* Provider status banner */}
      <div className="glass-card mt-4 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {provider && provider.provider !== "demo" && provider.provider !== "none" && provider.configured
                ? `${provider.provider.toUpperCase()} Provider Active`
                : hasRealProvider
                ? "Real mailbox connected"
                : "No mailbox connected"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {provider?.message && provider.provider !== "demo" && provider.provider !== "none"
                ? provider.message
                : hasRealProvider
                ? "Choose a provider below to sync."
                : "Connect Gmail or Microsoft 365 in Settings to see real emails."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canSyncMicrosoft && (
              <button
                onClick={msConfig ? syncMailbox : syncMailboxFromProvider}
                disabled={syncing}
                className="btn btn-primary shrink-0 text-xs"
              >
                {syncing ? "Syncing…" : "Sync Microsoft 365"}
              </button>
            )}
            {canSyncGmail && (
              <button
                onClick={gmailConfig ? syncGmail : syncGmailFromProvider}
                disabled={syncing}
                className="btn btn-primary shrink-0 text-xs bg-red-500 hover:bg-red-600"
              >
                {syncing ? "Syncing…" : "Sync Gmail"}
              </button>
            )}
            {!canSyncMicrosoft && !canSyncGmail && (
              <a href="/settings" className="btn btn-primary shrink-0 text-xs">
                Connect mailbox
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="stat-card">
          <p className="done-section-label">Total Emails</p>
          <p className="mt-2 text-3xl font-bold text-foreground">{stats.total}</p>
          <p className="mt-1 text-xs text-muted-foreground">Processed in evidence substrate</p>
        </div>
        <div className="stat-card">
          <p className="done-section-label">Attachments</p>
          <p className="mt-2 text-3xl font-bold text-foreground">{totalAttachments}</p>
          <p className="mt-1 text-xs text-muted-foreground">CSV / JSON / text extracted</p>
        </div>
        <div className="stat-card">
          <p className="done-section-label">Extracted Fields</p>
          <p className="mt-2 text-3xl font-bold text-foreground">{totalFields}</p>
          <p className="mt-1 text-xs text-muted-foreground">Structured data points</p>
        </div>
        <div className="stat-card">
          <p className="done-section-label">Pending Commitments</p>
          <p className="mt-2 text-3xl font-bold text-foreground">{stats.pendingCommitments}</p>
          <p className="mt-1 text-xs text-muted-foreground">Detected via commitment lexicon</p>
        </div>
      </div>

      {/* LLM analysis panel */}
      <div className="glass-card mt-6 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="done-section-label">LLM-Powered Analysis</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Run a structured pass over the inbox to surface research signals, commitments, and
              hypothesis-relevant evidence.
            </p>
          </div>
          <button
            type="button"
            onClick={analyzeInbox}
            disabled={analyzing || loading || emails.length === 0}
            className="btn btn-primary shrink-0"
          >
            {analyzing ? (
              <>
                <span className="llm-thinking-dots mr-2">
                  <span /><span /><span />
                </span>
                Analyzing…
              </>
            ) : (
              "Analyze inbox"
            )}
          </button>
        </div>

        {analysisError && (
          <div className="mt-4 rounded-xl border border-status-blocked/30 bg-status-blocked/10 p-4">
            <p className="text-sm text-status-blocked">{analysisError}</p>
          </div>
        )}

        {analysis && (
          <div className="mt-5 overflow-hidden rounded-xl border border-border bg-background/40 p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="badge border-primary/30 bg-primary/10 text-primary">Intelligence Report</span>
              <span className="llm-badge llm-badge-live">
                <span className="status-dot bg-current" />
                LLM Generated
              </span>
            </div>
            <div className="prose prose-invert max-w-none text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
              {analysis}
            </div>
          </div>
        )}
      </div>

      {/* Email list + detail split */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Email list */}
        <div className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <p className="done-section-label">Evidence Substrate</p>
            <button onClick={load} className="text-xs text-muted-foreground hover:text-foreground">
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="glass-card p-4">
                  <div className="skeleton h-5 w-3/4 rounded mb-2" />
                  <div className="skeleton h-4 w-1/2 rounded" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="glass-card p-6 border-destructive/20">
              <p className="text-sm text-destructive">{error}</p>
              <button className="btn btn-primary mt-4" onClick={load}>Retry</button>
            </div>
          ) : emails.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No real emails yet. Connect and sync Gmail or Microsoft 365.
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                {canSyncMicrosoft && (
                  <button
                    onClick={msConfig ? syncMailbox : syncMailboxFromProvider}
                    disabled={syncing}
                    className="btn btn-primary inline-block"
                  >
                    {syncing ? "Syncing…" : (msConfig ? `Sync ${msConfig.email}` : "Sync Microsoft 365")}
                  </button>
                )}
                {canSyncGmail && (
                  <button
                    onClick={gmailConfig ? syncGmail : syncGmailFromProvider}
                    disabled={syncing}
                    className="btn btn-primary inline-block bg-red-500 hover:bg-red-600"
                  >
                    {syncing ? "Syncing…" : "Sync Gmail"}
                  </button>
                )}
                {!canSyncMicrosoft && !canSyncGmail && (
                  <a href="/settings" className="btn btn-primary inline-block">
                    Connect mailbox
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {emails.map((e) => {
                const corpus = `${e.subject || ""} ${e.preview || ""}`;
                const hasCommitment = countSignals(corpus, COMMITMENT_KEYWORDS) > 0;
                const signalCount = countSignals(corpus, RESEARCH_SIGNAL_KEYWORDS);
                const isSelected = selectedEmail?.id === e.id;
                return (
                  <div
                    key={e.id}
                    className={`glass-card glass-card-hover cursor-pointer p-4 ${isSelected ? "ring-2 ring-primary/50" : ""}`}
                    onClick={() => { setSelectedEmail(e); setSelectedAttachment(null); setAttachmentDetail(null); }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">
                          {e.subject || "(no subject)"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          From: {e.from} · {e.date ? new Date(e.date).toLocaleDateString() : "—"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        {e.hasAttachments && (
                          <span className="badge border-blue-500/30 bg-blue-500/10 text-blue-400 text-[10px]">
                            {e.attachmentCount} attachment{(e.attachmentCount || 0) > 1 ? "s" : ""}
                          </span>
                        )}
                        {hasCommitment && (
                          <span className="badge border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px]">
                            Commitment
                          </span>
                        )}
                        {signalCount > 0 && (
                          <span className="badge border-primary/30 bg-primary/10 text-primary text-[10px]">
                            {signalCount} signal{signalCount > 1 ? "s" : ""}
                          </span>
                        )}
                        {e.category && (
                          <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground text-[10px]">
                            {e.category.replace(/_/g, " ")}
                          </span>
                        )}
                      </div>
                    </div>
                    {e.preview && (
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {e.preview.slice(0, 200)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-2">
          {!selectedEmail ? (
            <div className="glass-card p-8 text-center sticky top-4">
              <p className="text-sm text-muted-foreground">
                Select an email to view details, attachments, and extracted data.
              </p>
            </div>
          ) : (
            <div className="space-y-4 sticky top-4">
              {/* Email detail */}
              <div className="glass-card p-5">
                <p className="done-section-label">Email Detail</p>
                <h3 className="mt-2 font-semibold text-foreground">{selectedEmail.subject}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  From: {selectedEmail.from} {selectedEmail.fromEmail && `(${selectedEmail.fromEmail})`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Date: {selectedEmail.date ? new Date(selectedEmail.date).toLocaleString() : "—"}
                </p>
                {selectedEmail.preview && (
                  <p className="mt-3 text-sm text-foreground/80">{selectedEmail.preview}</p>
                )}
                {selectedEmail.extractedFields && selectedEmail.extractedFields.length > 0 && (
                  <div className="mt-4">
                    <p className="done-section-label mb-2">Extracted Fields</p>
                    <div className="space-y-1">
                      {selectedEmail.extractedFields.slice(0, 8).map((f, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{f.key}</span>
                          <span className="font-medium text-foreground">{f.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Attachments */}
              {selectedEmail.hasAttachments && selectedEmail.attachments && (
                <div className="glass-card p-5">
                  <p className="done-section-label">
                    Attachments ({selectedEmail.attachments.length})
                  </p>
                  <div className="mt-3 space-y-2">
                    {selectedEmail.attachments.map((att, i) => (
                      <div
                        key={att.id}
                        className={`cursor-pointer rounded-lg border p-3 transition-colors ${selectedAttachment?.id === att.id
                          ? "border-primary/50 bg-primary/5"
                          : "border-border bg-background/40 hover:bg-background/60"
                          }`}
                        onClick={() => loadAttachmentDetail(selectedEmail.id, i, att)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{att.name}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {att.contentType} · {att.rowCount ?? 0} rows
                            </p>
                          </div>
                          <span className="badge border-blue-500/30 bg-blue-500/10 text-blue-400 text-[10px]">
                            {att.parsedType || "parsed"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Attachment detail */}
              {selectedAttachment && (
                <div className="glass-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="done-section-label">{selectedAttachment.name}</p>
                      {attachmentDetail && !attachmentDetail.error && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {attachmentDetail.rowCount ?? 0} rows · {(attachmentDetail.headers || []).length} columns
                        </p>
                      )}
                    </div>
                    {attachmentDetail && !attachmentDetail.error && (attachmentDetail.rows || []).length > 0 && (
                      <div className="flex shrink-0 items-center gap-1">
                        {(["table", "chart", "json"] as const).map((mode) => (
                          <button key={mode}
                            onClick={() => setViewMode(mode)}
                            className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${viewMode === mode ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}>
                            {mode.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {attachmentLoading ? (
                    <p className="mt-3 text-sm text-muted-foreground">Loading attachment data…</p>
                  ) : attachmentDetail?.error ? (
                    <p className="mt-3 text-sm text-status-blocked">{attachmentDetail.error}</p>
                  ) : attachmentDetail ? (
                    <div className="mt-3">
                      {/* Column type analysis */}
                      {attachmentDetail.headers && (attachmentDetail.rows || []).length > 0 && (
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          {attachmentDetail.headers.map((h: string) => {
                            const colType = detectColumnType(h, attachmentDetail.rows || []);
                            const typeColor = {
                              numeric: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                              date: "border-blue-500/30 bg-blue-500/10 text-blue-400",
                              boolean: "border-amber-500/30 bg-amber-500/10 text-amber-400",
                              text: "border-muted-foreground/20 bg-muted/10 text-muted-foreground",
                            }[colType];
                            return (
                              <span key={h} className={`badge px-1.5 py-0.5 text-[9px] ${typeColor}`}>
                                {h} · {colType}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* Numeric column stats */}
                      {attachmentDetail.headers && (attachmentDetail.rows || []).length > 0 && viewMode === "chart" && (
                        <div className="mb-4 space-y-3">
                          {attachmentDetail.headers
                            .filter((h: string) => detectColumnType(h, attachmentDetail.rows || []) === "numeric")
                            .map((h: string) => {
                              const stats = getNumericStats(h, attachmentDetail.rows || []);
                              if (!stats) return null;
                              const range = stats.max - stats.min || 1;
                              return (
                                <div key={h} className="rounded-lg border border-border/40 bg-background/30 p-3">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-medium text-foreground">{h}</span>
                                    <span className="text-muted-foreground">avg {stats.avg.toFixed(1)}</span>
                                  </div>
                                  <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                                    <span>{stats.min.toFixed(1)}</span>
                                    <div className="relative h-2 flex-1 rounded-full bg-muted/30">
                                      <div className="absolute h-2 rounded-full bg-primary/40"
                                        style={{ left: "0%", width: "100%" }} />
                                      <div className="absolute h-3 w-1 rounded-full bg-primary"
                                        style={{ left: `${((stats.avg - stats.min) / range) * 100}%` }} />
                                    </div>
                                    <span>{stats.max.toFixed(1)}</span>
                                  </div>
                                  <p className="mt-1 text-[10px] text-muted-foreground">{stats.count} numeric values</p>
                                </div>
                              );
                            })}
                          {attachmentDetail.headers.filter((h: string) => detectColumnType(h, attachmentDetail.rows || []) === "numeric").length === 0 && (
                            <p className="text-xs text-muted-foreground">No numeric columns detected for chart visualization.</p>
                          )}
                        </div>
                      )}

                      {/* Table view with sortable columns */}
                      {attachmentDetail.rows && attachmentDetail.rows.length > 0 && viewMode === "table" && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border">
                                {attachmentDetail.headers?.map((h: string) => (
                                  <th key={h}
                                    onClick={() => {
                                      if (sortCol === h) setSortDir(sortDir === "asc" ? "desc" : "asc");
                                      else { setSortCol(h); setSortDir("asc"); }
                                    }}
                                    className="cursor-pointer px-2 py-1 text-left font-medium text-muted-foreground hover:text-foreground select-none">
                                    {h} {sortCol === h && (sortDir === "asc" ? "↑" : "↓")}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {getSortedRows().slice(0, 15).map((row: Record<string, unknown>, i: number) => (
                                <tr key={i} className="border-b border-border/50 hover:bg-muted/10">
                                  {attachmentDetail.headers?.map((h: string) => {
                                    const val = row[h];
                                    const colType = detectColumnType(h, attachmentDetail.rows || []);
                                    return (
                                      <td key={h} className="px-2 py-1 text-foreground/80">
                                        {colType === "numeric" && val != null && !isNaN(Number(val)) ? (
                                          <span className="font-mono text-emerald-400/80">{String(val)}</span>
                                        ) : colType === "boolean" ? (
                                          <span className={val === "true" || val === "yes" || val === "1" ? "text-emerald-400" : "text-red-400"}>
                                            {String(val)}
                                          </span>
                                        ) : (
                                          String(val ?? "—")
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {getSortedRows().length > 15 && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Showing 15 of {getSortedRows().length} rows
                            </p>
                          )}
                        </div>
                      )}

                      {/* JSON tree view */}
                      {attachmentDetail.rows && attachmentDetail.rows.length > 0 && viewMode === "json" && (
                        <div className="overflow-x-auto rounded-lg border border-border/40 bg-background/30 p-3">
                          <pre className="text-[10px] leading-relaxed text-foreground/70 font-mono">
                            {JSON.stringify(attachmentDetail.rows.slice(0, 5), null, 2)}
                          </pre>
                          {attachmentDetail.rows.length > 5 && (
                            <p className="mt-2 text-[10px] text-muted-foreground">
                              Showing first 5 of {attachmentDetail.rows.length} records
                            </p>
                          )}
                        </div>
                      )}

                      {/* LLM summarization */}
                      <div className="mt-4 border-t border-border/30 pt-4">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-foreground">LLM Attachment Analysis</p>
                          <button
                            onClick={summarizeAttachment}
                            disabled={attSummarizing || !attachmentDetail.rows?.length}
                            className="btn btn-primary shrink-0 text-[10px] px-2 py-1">
                            {attSummarizing ? "Analyzing…" : "Summarize"}
                          </button>
                        </div>
                        {attSummarizing && (
                          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="llm-thinking-dots"><span /><span /><span /></span>
                            Analyzing attachment data…
                          </div>
                        )}
                        {attSummary && (
                          <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                            <div className="mb-2 flex items-center gap-2">
                              <span className="badge border-primary/30 bg-primary/10 text-primary text-[9px]">AI Summary</span>
                            </div>
                            <div className="prose prose-invert max-w-none text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
                              {attSummary}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
