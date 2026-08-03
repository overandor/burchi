"use client";

import { useState, useEffect, useCallback } from "react";
import { ProcessedEmailRecord, SyncStatus, WikiTreeNode, MindmapNode, ExecutionStep } from "@/types";
import { formatDate, truncate, normalizeOrigin } from "@/lib/utils";
import MermaidMindmap from "@/components/MermaidMindmap";

export default function DashboardPage() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [records, setRecords] = useState<ProcessedEmailRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<ProcessedEmailRecord | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [gmailServerConfigured, setGmailServerConfigured] = useState(false);
  const [azureServerConfigured, setAzureServerConfigured] = useState(false);
  const [azureMailbox, setAzureMailbox] = useState<string>("");
  const [imapConnected, setImapConnected] = useState(false);
  const [telemetrySummary, setTelemetrySummary] = useState<{ totalRevenue: number; timeSaved: number; efficiency: number; dataPoints: number } | null>(null);
  const [view, setView] = useState<"value" | "mindmap" | "execution" | "data">("value");
  const [isSeeding, setIsSeeding] = useState(false);
  const [swipeMode, setSwipeMode] = useState(false);
  const [swipeIndex, setSwipeIndex] = useState(0);
  const [swipeDirection, setSwipeDirection] = useState<"left" | "right" | null>(null);
  const [swipeDecisions, setSwipeDecisions] = useState<Record<string, "keep" | "skip">>({});

  // LLM inference state — default to LLM7 (free, no API key, OpenAI-compatible)
  const [llmConfig, setLLMConfig] = useState({ endpoint: "https://api.llm7.io/v1/chat/completions", apiKey: "", model: "gpt-oss:20b" });
  const [llmPrompt, setLLMPrompt] = useState("");
  const [llmSystem, setLLMSystem] = useState("You are a data extraction assistant. Analyze email content and attachments to produce structured summaries, wikitrees, mindmaps, and execution plans.");
  const [inferencing, setInferencing] = useState(false);
  const [llmResults, setLLMResults] = useState<{ role: string; content: string; timestamp: string }[]>([]);
  const [llmError, setLLMError] = useState<string | null>(null);
  const [rotateProgress, setRotateProgress] = useState<string | null>(null);

  // Remote URL list state
  const [remoteURLs, setRemoteURLs] = useState<{ id: string; url: string; label: string; status: "idle" | "checking" | "online" | "offline"; lastChecked?: string; responseTime?: number }[]>([]);
  const [newURL, setNewURL] = useState("");
  const [newURLLabel, setNewURLLabel] = useState("");
  const [checkingAll, setCheckingAll] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/mailbox/status");
      const text = await res.text();
      if (text) {
        const data = JSON.parse(text);
        if (data && data.totalEmails > 0) {
          setStatus(data);
          localStorage.setItem("sync-status", JSON.stringify(data));
        } else {
          // Fallback to localStorage on serverless where filesystem is empty
          const local = localStorage.getItem("sync-status");
          if (local) setStatus(JSON.parse(local));
        }
      }
    } catch {
      const local = localStorage.getItem("sync-status");
      if (local) setStatus(JSON.parse(local));
    }
  }, []);

  const fetchRecords = useCallback(async () => {
    try {
      const res = await fetch("/api/sheets/export?format=json");
      const text = await res.text();
      if (text) {
        const data = JSON.parse(text);
        if (data.records && data.records.length > 0) {
          setRecords(data.records);
          localStorage.setItem("processed-emails", JSON.stringify(data.records));
        } else {
          // Fallback to localStorage on serverless where filesystem is empty
          const local = localStorage.getItem("processed-emails");
          if (local) setRecords(JSON.parse(local));
        }
      }
    } catch {
      const local = localStorage.getItem("processed-emails");
      if (local) setRecords(JSON.parse(local));
    }
  }, []);

  useEffect(() => {
    // Check server-side Gmail config first, then fall back to localStorage
    fetch("/api/gmail/config")
      .then((r) => r.text())
      .then((text) => { if (text) { const data = JSON.parse(text); setGmailServerConfigured(!!data.configured);
        // Check localStorage for refresh token (per-user auth result)
        const local = localStorage.getItem("gmail-config");
        let hasRefreshToken = false;
        if (local) {
          try {
            const parsed = JSON.parse(local);
            hasRefreshToken = !!parsed.refreshToken;
          } catch { }
        }
        setGmailConnected(hasRefreshToken || new URLSearchParams(window.location.search).get("gmail_connected") === "true");
      } })
      .catch(() => {
        const local = localStorage.getItem("gmail-config");
        let hasRefreshToken = false;
        if (local) {
          try {
            const parsed = JSON.parse(local);
            hasRefreshToken = !!parsed.refreshToken;
          } catch { }
        }
        setGmailConnected(hasRefreshToken || new URLSearchParams(window.location.search).get("gmail_connected") === "true");
      });

    // Handle Gmail OAuth error redirect
    const params = new URLSearchParams(window.location.search);
    const gError = params.get("gmail_error");
    if (gError) {
      if (gError === "no_code") {
        setGmailError("Google did not return an authorization code. This usually means the redirect URI in your Google Cloud Console doesn't match. Make sure the authorized redirect URI is set to: " + normalizeOrigin(window.location.origin) + "/api/gmail/callback");
      } else {
        setGmailError("Gmail connection error: " + gError);
      }
      // Clean the URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Check Azure config status
    fetch("/api/azure/config")
      .then((r) => r.text())
      .then((text) => { if (text) { const data = JSON.parse(text); setAzureServerConfigured(!!data.configured); setAzureMailbox(data.mailbox || ""); } })
      .catch(() => { });

    // Check IMAP connection state
    const imapLocal = localStorage.getItem("imap-config");
    if (imapLocal) {
      try { const parsed = JSON.parse(imapLocal); setImapConnected(!!(parsed.email && parsed.password)); } catch {}
    }

    // Load cached records from localStorage immediately (works on serverless)
    try {
      const cachedRecords = localStorage.getItem("processed-emails");
      if (cachedRecords) setRecords(JSON.parse(cachedRecords));
      const cachedStatus = localStorage.getItem("sync-status");
      if (cachedStatus) setStatus(JSON.parse(cachedStatus));
    } catch { }
    fetchStatus();
    fetchRecords();
    const interval = setInterval(() => { fetchStatus(); fetchRecords(); }, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchRecords]);

  useEffect(() => {
    const savedLLM = localStorage.getItem("llm-config");
    if (savedLLM) { try { setLLMConfig(JSON.parse(savedLLM)); } catch { } }
    const savedURLs = localStorage.getItem("etl-remote-urls");
    if (savedURLs) { try { setRemoteURLs(JSON.parse(savedURLs)); } catch { } }
  }, []);

  const handleConnectGmail = async () => {
    try {
      setGmailError(null);
      // Call the server-side auth endpoint — it reads credentials from env vars
      const res = await fetch("/api/gmail/auth");
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setGmailError(data.error || "Gmail is not configured on the server.");
        return;
      }
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (e: any) {
      setGmailError(e.message || "Failed to start Gmail connection.");
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const local = localStorage.getItem("gmail-config");
      let gmailCreds: any = {};
      if (local) {
        try { gmailCreds = JSON.parse(local); } catch { }
      }
      if (!gmailCreds.refreshToken) {
        setError("Gmail not connected. Click Connect Gmail first.");
        setIsSyncing(false);
        return;
      }
      const res = await fetch("/api/gmail/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxEmails: 100, ...gmailCreds }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setError(data.error || "Sync failed");
      } else {
        setSyncResult(`Synced ${data.synced} emails, processed ${data.processed} new`);
        // Store records in localStorage (serverless can't persist to filesystem)
        if (data.records) {
          localStorage.setItem("processed-emails", JSON.stringify(data.records));
          setRecords(data.records);
        }
        if (data.status) {
          localStorage.setItem("sync-status", JSON.stringify(data.status));
          setStatus(data.status);
        }
        // Auto-display telemetry from sync result
        if (data.telemetry) {
          const t = data.telemetry;
          const revenueMetric = t.aggregateMetrics?.find((m: any) => m.key === "agg_revenue" || m.key === "total_revenue");
          const timeMetric = t.aggregateMetrics?.find((m: any) => m.key === "agg_time_saved" || m.key === "time_saved");
          const effMetric = t.aggregateMetrics?.find((m: any) => m.key === "agg_efficiency" || m.key === "efficiency_score");
          const dataMetric = t.aggregateMetrics?.find((m: any) => m.key === "agg_emails" || m.key === "data_points");
          setTelemetrySummary({
            totalRevenue: revenueMetric?.value || 0,
            timeSaved: timeMetric?.value || 0,
            efficiency: effMetric?.value || 0,
            dataPoints: dataMetric?.value || 0,
          });
        }
        fetchRecords();
        fetchStatus();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleImapSync = async () => {
    setIsSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const local = localStorage.getItem("imap-config");
      if (!local) {
        setError("Microsoft 365 not connected. Go to Settings to connect.");
        setIsSyncing(false);
        return;
      }
      const creds = JSON.parse(local);
      const res = await fetch("/api/imap/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: creds.email, password: creds.password, host: creds.host, maxEmails: 50 }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setError(data.error || "IMAP sync failed");
        setIsSyncing(false);
        return;
      }
      // Convert IMAP messages to processed records
      const newRecords: ProcessedEmailRecord[] = (data.messages || []).map((msg: any) => ({
        id: msg.id,
        subject: msg.subject,
        from: msg.from,
        fromAddress: msg.fromAddress,
        receivedDateTime: msg.receivedDateTime,
        bodyPreview: msg.bodyPreview,
        hasAttachments: msg.hasAttachments,
        category: "Other",
        extractedData: { fields: [], tables: [], summary: msg.bodyPreview, confidence: 0.5 },
        processedAt: new Date().toISOString(),
      }));
      // Merge with existing records
      const existing = localStorage.getItem("processed-emails");
      const existingRecords: ProcessedEmailRecord[] = existing ? JSON.parse(existing) : [];
      const merged = [...newRecords, ...existingRecords.filter(r => !newRecords.some(n => n.id === r.id))];
      localStorage.setItem("processed-emails", JSON.stringify(merged));
      setRecords(merged);
      const newStatus: SyncStatus = {
        lastSync: new Date().toISOString(),
        totalEmails: merged.length,
        processedEmails: merged.length,
        pendingEmails: 0,
        isSyncing: false,
        errors: [],
      };
      localStorage.setItem("sync-status", JSON.stringify(newStatus));
      setStatus(newStatus);
      setSyncResult(`Fetched ${data.count} emails from ${creds.email}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const fetchTelemetry = useCallback(async () => {
    try {
      const local = localStorage.getItem("processed-emails");
      const records = local ? JSON.parse(local) : [];
      if (records.length === 0) return;
      const res = await fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records }),
      });
      const text = await res.text();
      if (text) {
        const t = JSON.parse(text);
        const revenueMetric = t.aggregateMetrics?.find((m: any) => m.key === "agg_revenue" || m.key === "total_revenue");
        const timeMetric = t.aggregateMetrics?.find((m: any) => m.key === "agg_time_saved" || m.key === "time_saved");
        const effMetric = t.aggregateMetrics?.find((m: any) => m.key === "agg_efficiency" || m.key === "efficiency_score");
        const dataMetric = t.aggregateMetrics?.find((m: any) => m.key === "agg_emails" || m.key === "data_points");
        setTelemetrySummary({
          totalRevenue: revenueMetric?.value || 0,
          timeSaved: timeMetric?.value || 0,
          efficiency: effMetric?.value || 0,
          dataPoints: dataMetric?.value || 0,
        });
      }
    } catch { }
  }, []);

  useEffect(() => {
    if (records.length > 0 && !telemetrySummary) {
      fetchTelemetry();
    }
  }, [records, telemetrySummary, fetchTelemetry]);

  const handleSeedDemo = async () => {
    setIsSeeding(true);
    setError(null);
    setSyncResult(null);
    try {
      const res = await fetch("/api/demo/seed", { method: "POST" });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setError(data.error || "Failed to load sample data");
      } else {
        setSyncResult(data.message || `Loaded ${data.seeded} sample emails`);
        if (data.records) {
          localStorage.setItem("processed-emails", JSON.stringify(data.records));
          setRecords(data.records);
        }
        if (data.status) {
          localStorage.setItem("sync-status", JSON.stringify(data.status));
          setStatus(data.status);
        }
        fetchRecords();
        fetchStatus();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSeeding(false);
    }
  };

  // Auto-seed sample data in demo mode with no records
  const isDemo = process.env.NEXT_PUBLIC_DEMO === "true";
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isDemo) return;
    if (records.length > 0 || status?.totalEmails) return;
    const seeded = sessionStorage.getItem("demo-auto-seeded");
    if (seeded) return;
    sessionStorage.setItem("demo-auto-seeded", "true");
    handleSeedDemo();
  }, [isDemo, records.length, status?.totalEmails, handleSeedDemo]);

  const saveLLMConfig = () => {
    localStorage.setItem("llm-config", JSON.stringify(llmConfig));
  };

  const [rotateInfo, setRotateInfo] = useState<{ rotations: number; tokens: number; nodes: string[] } | null>(null);

  const runInference = async () => {
    if (!llmPrompt.trim()) return;
    setInferencing(true);
    setLLMError(null);
    setRotateInfo(null);
    setRotateProgress("Sending prompt to inference endpoint...");

    // Build context from selected email (if any) so the LLM has the data
    let emailContext = "";
    if (selectedRecord) {
      const r = selectedRecord;
      const fields = r.extractedData?.fields?.map(f => `  - ${f.key}: ${f.value} (${f.type}, confidence: ${f.confidence})`).join("\n") || "";
      const tables = r.extractedData?.tables?.map(t => `  Table: ${t.name} (${t.headers?.length || 0} cols, ${t.rows?.length || 0} rows)\n  Headers: ${t.headers?.join(", ")}\n  Sample: ${JSON.stringify(t.rows?.[0] || {})}`).join("\n") || "";
      const summary = r.extractedData?.summary || "";
      emailContext = `\n\n--- SELECTED EMAIL CONTEXT ---\nSubject: ${r.subject}\nFrom: ${r.sender || "Unknown"}\nDate: ${r.receivedDate || "Unknown"}\nCategory: ${r.category}\nSummary: ${summary}\n\nExtracted Fields:\n${fields || "  (none)"}\n\nExtracted Tables:\n${tables || "  (none)"}\n--- END EMAIL CONTEXT ---\n`;
    }

    const messages = [
      { role: "system", content: llmSystem + (emailContext ? `\nYou have access to the following email context. Use it to answer the user's question:` : "") },
      { role: "user", content: emailContext + llmPrompt },
    ];

    // If using LLM7 (free, no API key, CORS-enabled), call directly from client
    // to avoid Netlify serverless function timeout
    if (llmConfig.endpoint.includes("api.llm7.io") && !llmConfig.apiKey) {
      try {
        setRotateProgress("Querying LLM7...");
        const res = await fetch("https://api.llm7.io/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: llmConfig.model || "gpt-oss:20b",
            messages,
            max_tokens: 1024,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            setLLMResults((prev) => [
              { role: "user", content: llmPrompt, timestamp: new Date().toISOString() },
              { role: "assistant", content, timestamp: new Date().toISOString() },
              ...prev,
            ]);
            setLLMPrompt("");
            setRotateProgress(null);
            setInferencing(false);
            return;
          }
        }
        const errText = await res.text().catch(() => "");
        setLLMError(`LLM7 returned ${res.status}. ${errText.slice(0, 200)}`);
        setRotateProgress(null);
        setInferencing(false);
        return;
      } catch (e: any) {
        setLLMError(`Client-side inference failed: ${e.message}`);
        setRotateProgress(null);
        setInferencing(false);
        return;
      }
    }

    // For other endpoints (OpenAI, Ollama, etc.), use server-side proxy
    try {
      const res = await fetch("/api/llm/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: llmConfig.endpoint,
          apiKey: llmConfig.apiKey,
          model: llmConfig.model,
          messages,
          temperature: 0.7,
          max_tokens: 2048,
        }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setLLMError(data.error || "Inference failed — check that the endpoint is reachable.");
      } else {
        const content = data.choices?.[0]?.message?.content || data.content || JSON.stringify(data);
        setLLMResults((prev) => [
          { role: "user", content: llmPrompt, timestamp: new Date().toISOString() },
          { role: "assistant", content, timestamp: new Date().toISOString() },
          ...prev,
        ]);
        setLLMPrompt("");
      }
    } catch (e: any) {
      setLLMError(e.message);
    } finally {
      setInferencing(false);
      setRotateProgress(null);
    }
  };

  const addURL = () => {
    if (!newURL) return;
    const url = { id: `url-${Date.now()}`, url: newURL, label: newURLLabel || newURL, status: "idle" as const };
    const updated = [...remoteURLs, url];
    setRemoteURLs(updated);
    localStorage.setItem("etl-remote-urls", JSON.stringify(updated));
    setNewURL("");
    setNewURLLabel("");
  };

  const removeURL = (id: string) => {
    const updated = remoteURLs.filter((u) => u.id !== id);
    setRemoteURLs(updated);
    localStorage.setItem("etl-remote-urls", JSON.stringify(updated));
  };

  const checkURL = async (url: typeof remoteURLs[0]) => {
    setRemoteURLs((prev) => prev.map((u) => u.id === url.id ? { ...u, status: "checking" } : u));
    const start = Date.now();
    try {
      await fetch(url.url, { mode: "no-cors", signal: AbortSignal.timeout(10000) });
      const elapsed = Date.now() - start;
      setRemoteURLs((prev) => prev.map((u) => u.id === url.id ? { ...u, status: "online", lastChecked: new Date().toISOString(), responseTime: elapsed } : u));
    } catch {
      setRemoteURLs((prev) => prev.map((u) => u.id === url.id ? { ...u, status: "offline", lastChecked: new Date().toISOString() } : u));
    }
  };

  const checkAllURLs = async () => {
    setCheckingAll(true);
    for (const url of remoteURLs) {
      await checkURL(url);
    }
    setCheckingAll(false);
  };

  return (
    <div className="container mx-auto max-w-7xl space-y-6 px-6 py-8">
      {/* Header section */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Dashboard
          </h2>
          <p className="text-sm text-muted-foreground">
            Gmail auto-analysis pipeline — wikitree, mindmap & execution
          </p>
        </div>
        <div className="flex gap-2">
          {isDemo && (
            <button
              onClick={handleSeedDemo}
              disabled={isSeeding}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-indigo-500/40 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
            >
              {isSeeding ? "Loading..." : "Load Sample Data"}
            </button>
          )}
          {!gmailConnected && (
            <button onClick={handleConnectGmail} className="btn btn-outline !h-10 text-sm">
              Connect Gmail
            </button>
          )}
          {imapConnected && (
            <button
              onClick={handleImapSync}
              disabled={isSyncing}
              className="btn btn-outline !h-10 text-sm !border-[#0078d4] !text-[#0078d4] hover:!bg-[#0078d4] hover:!text-white"
            >
              {isSyncing ? "Syncing..." : "Sync Outlook"}
            </button>
          )}
          <button
            onClick={handleSync}
            disabled={isSyncing || !gmailConnected}
            className="btn btn-outline !h-10 text-sm"
          >
            {isSyncing ? "Syncing..." : "Sync & Analyze"}
          </button>
        </div>
      </div>

      {/* Status cards */}
      {isDemo && (
        <div className="rounded-xl border border-indigo-200/60 bg-gradient-to-r from-indigo-50 to-purple-50 p-4 text-sm text-indigo-800 animate-fade-in-up">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-white text-[10px] font-bold">AI</div>
            <p className="font-semibold">Demo Mode — LLM7 Powered</p>
          </div>
          <p className="mt-1.5 pl-7">
            Sample data is pre-loaded. AI inference runs via the free LLM7 endpoint (gpt-oss:20b). Connect Gmail or Microsoft 365 for live email processing.
          </p>
        </div>
      )}
      {syncResult && (
        <div className="rounded-xl border border-emerald-200/60 bg-emerald-50 p-3 text-sm text-emerald-700 animate-fade-in">
          {syncResult}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive animate-fade-in">
          {error}
        </div>
      )}

      {/* Gmail error banner */}
      {gmailError && (
        <div className="rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900 animate-fade-in-up">
          <div className="flex items-start gap-2">
            <svg className="h-5 w-5 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="flex-1">
              <p className="font-medium">Gmail Connection Issue</p>
              <p className="mt-1 text-xs">{gmailError}</p>
            </div>
            <button onClick={() => setGmailError(null)} className="text-amber-400 hover:text-amber-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="stat-card border-slate-200 bg-white hover:shadow-lg animate-fade-in-up">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Total Emails</p>
              <p className="text-2xl font-bold text-slate-900">{status?.totalEmails || records.length || 0}</p>
            </div>
          </div>
        </div>
        <div className="stat-card border-slate-200 bg-white hover:shadow-lg animate-fade-in-up delay-100">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Processed</p>
              <p className="text-2xl font-bold text-slate-900">{status?.processedEmails || records.length}</p>
            </div>
          </div>
        </div>
        <div className="stat-card border-slate-200 bg-white hover:shadow-lg animate-fade-in-up delay-200">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Last Sync</p>
              <p className="text-sm font-bold text-slate-900">{status?.lastSync ? formatDate(status.lastSync) : "Never"}</p>
            </div>
          </div>
        </div>
        <div className="stat-card border-slate-200 bg-white hover:shadow-lg animate-fade-in-up delay-300">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${gmailConnected ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Gmail</p>
              <p className={`text-sm font-bold ${gmailConnected ? "text-emerald-600" : "text-slate-400"}`}>
                {gmailConnected ? "Connected" : "Not connected"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Connection status + LLM + Telemetry summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Mailbox connections */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-900">Mailbox Connections</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-full ${gmailConnected ? "bg-emerald-500" : "bg-slate-300"}`} />
                <span className="text-sm font-medium text-slate-700">Gmail</span>
              </div>
              <span className={`text-xs font-semibold ${gmailConnected ? "text-emerald-600" : "text-slate-400"}`}>
                {gmailConnected ? "Connected" : gmailServerConfigured ? "Ready to connect" : "Not configured"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-full ${azureServerConfigured ? "bg-emerald-500" : "bg-slate-300"}`} />
                <span className="text-sm font-medium text-slate-700">Microsoft 365</span>
              </div>
              <span className={`text-xs font-semibold ${azureServerConfigured ? "text-emerald-600" : "text-slate-400"}`}>
                {azureServerConfigured ? `Connected (${azureMailbox || "configured"})` : "Needs credentials"}
              </span>
            </div>
          </div>
        </div>

        {/* LLM status */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-900">LLM Engine</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-sm font-medium text-slate-700">Endpoint</span>
              <span className="text-xs font-mono text-slate-500 truncate max-w-[160px]">{llmConfig.endpoint || "default"}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-sm font-medium text-slate-700">Model</span>
              <span className="text-xs font-mono text-slate-500">{llmConfig.model || "default"}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-sm font-medium text-slate-700">Status</span>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch("/api/llm/infer", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ messages: [{ role: "user", content: "ping" }], max_tokens: 5 }),
                    });
                    if (res.ok) {
                      setLLMError(null);
                      setSyncResult("LLM is responding.");
                    } else {
                      setLLMError("LLM returned an error.");
                    }
                  } catch (e: any) {
                    setLLMError(e.message);
                  }
                }}
                className="rounded-md bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-200"
              >
                Test
              </button>
            </div>
          </div>
        </div>

        {/* Telemetry summary */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-900">Telemetry Summary</h3>
          {telemetrySummary ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-emerald-50 px-3 py-2">
                <p className="text-xs text-slate-500">Est. Revenue</p>
                <p className="text-lg font-bold text-emerald-600">${telemetrySummary.totalRevenue.toLocaleString()}</p>
              </div>
              <div className="rounded-lg bg-blue-50 px-3 py-2">
                <p className="text-xs text-slate-500">Time Saved</p>
                <p className="text-lg font-bold text-blue-600">{telemetrySummary.timeSaved}h</p>
              </div>
              <div className="rounded-lg bg-violet-50 px-3 py-2">
                <p className="text-xs text-slate-500">Efficiency</p>
                <p className="text-lg font-bold text-violet-600">{telemetrySummary.efficiency}/100</p>
              </div>
              <div className="rounded-lg bg-amber-50 px-3 py-2">
                <p className="text-xs text-slate-500">Data Points</p>
                <p className="text-lg font-bold text-amber-600">{telemetrySummary.dataPoints}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400 py-4 text-center">Sync emails to generate telemetry</p>
          )}
        </div>
      </div>

      {/* Main content: email list + analysis view */}
      <div className="grid grid-cols-12 gap-4">
        {/* Email list */}
        <div className="col-span-12 md:col-span-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Processed Emails</h3>
            {records.length > 0 && (
              <button
                onClick={() => { setSwipeMode(!swipeMode); setSwipeIndex(0); setSwipeDirection(null); }}
                className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${swipeMode ? "bg-primary text-primary-foreground" : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                  }`}
              >
                {swipeMode ? "List View" : "Swipe Review"}
              </button>
            )}
          </div>

          {swipeMode ? (
            <SwipeReviewPanel
              records={records}
              index={swipeIndex}
              direction={swipeDirection}
              decisions={swipeDecisions}
              onSwipe={(recordId, dir) => {
                setSwipeDecisions({ ...swipeDecisions, [recordId]: dir === "right" ? "keep" : "skip" });
                setSwipeDirection(dir);
                setTimeout(() => {
                  setSwipeDirection(null);
                  if (swipeIndex < records.length - 1) {
                    setSwipeIndex(swipeIndex + 1);
                  } else {
                    setSwipeMode(false);
                  }
                }, 300);
              }}
              onSelect={(record) => { setSelectedRecord(record); setSwipeMode(false); }}
            />
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto scrollbar-thin">
              {records.length === 0 && (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No processed emails yet. Connect Gmail and sync to start.
                </p>
              )}
              {records.map((record) => (
                <button
                  key={record.id}
                  onClick={() => setSelectedRecord(record)}
                  className={`w-full text-left rounded-xl border p-3 transition-all hover:shadow-md ${selectedRecord?.id === record.id ? "border-indigo-300 bg-indigo-50/50 ring-1 ring-indigo-200" : "border-slate-200 hover:border-slate-300"
                    } ${swipeDecisions[record.id] === "keep" ? "ring-2 ring-green-400" : ""} ${swipeDecisions[record.id] === "skip" ? "opacity-40" : ""}`}
                >
                  <p className="text-sm font-semibold truncate text-slate-900">{record.subject}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{record.sender}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{record.category}</span>
                    <span className="text-xs text-muted-foreground">
                      {record.analysis ? "Analyzed" : "Pending"}
                    </span>
                    {swipeDecisions[record.id] === "keep" && (
                      <span className="text-xs text-green-600 font-medium">Kept</span>
                    )}
                    {swipeDecisions[record.id] === "skip" && (
                      <span className="text-xs text-red-500 font-medium">Skipped</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Analysis view */}
        <div className="col-span-12 md:col-span-8 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {!selectedRecord ? (
            <div className="flex h-[600px] items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8 text-slate-400">
                    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-slate-500">
                  Select an email to view its wikitree, mindmap, and execution plan
                </p>
              </div>
            </div>
          ) : (
            <div>
              {/* View tabs */}
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{selectedRecord.subject}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    From {selectedRecord.sender} · {formatDate(selectedRecord.receivedDate)}
                  </p>
                </div>
                <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
                  {(["value", "mindmap", "execution", "data"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        }`}
                    >
                      {v === "value" ? "Value Extraction" : v === "mindmap" ? "Mindmap" : v === "execution" ? "Execution" : "Data"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="max-h-[550px] overflow-y-auto scrollbar-thin rounded-lg">
                {view === "value" && selectedRecord.analysis && (
                  (selectedRecord.analysis as any).valueExtraction ? (
                    <ValueExtractionView data={(selectedRecord.analysis as any).valueExtraction} />
                  ) : (
                    <WikiTreeView node={selectedRecord.analysis.wikitree.root} />
                  )
                )}
                {view === "mindmap" && selectedRecord.analysis && (
                  (selectedRecord.analysis as any).mindmapMermaid ? (
                    <MermaidMindmap chart={(selectedRecord.analysis as any).mindmapMermaid} />
                  ) : (
                    <MindmapView node={selectedRecord.analysis.mindmap.root} />
                  )
                )}
                {view === "execution" && selectedRecord.analysis && (
                  <ExecutionView plan={selectedRecord.analysis.execution} />
                )}
                {view === "data" && (
                  <DataView record={selectedRecord} />
                )}
                {!selectedRecord.analysis && (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No analysis available for this email
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* LLM Inference & Remote URL List */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* LLM Inference Panel */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900">AI Inference</h3>
              <p className="text-sm text-muted-foreground">Chat with your model for ETL analysis</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${inferencing ? "bg-amber-400 animate-pulse" : "bg-emerald-500"}`} />
              <span className="text-xs font-medium text-muted-foreground">
                {inferencing ? "Generating..." : "Ready"}
              </span>
            </div>
          </div>

          {/* Collapsible config */}
          <details className="rounded-lg border border-slate-200 bg-slate-50/50">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600 select-none">
              Model Configuration
            </summary>
            <div className="space-y-3 p-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Endpoint URL</label>
                <input
                  type="text"
                  value={llmConfig.endpoint}
                  onChange={(e) => setLLMConfig({ ...llmConfig, endpoint: e.target.value })}
                  onBlur={saveLLMConfig}
                  className="input mt-1 text-xs"
                  placeholder="https://gguf-serverless-poc.vercel.app/v1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">API Key</label>
                  <input
                    type="password"
                    value={llmConfig.apiKey}
                    onChange={(e) => setLLMConfig({ ...llmConfig, apiKey: e.target.value })}
                    onBlur={saveLLMConfig}
                    className="input mt-1 text-xs"
                    placeholder="sk-..."
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Model</label>
                  <input
                    type="text"
                    value={llmConfig.model}
                    onChange={(e) => setLLMConfig({ ...llmConfig, model: e.target.value })}
                    onBlur={saveLLMConfig}
                    className="input mt-1 text-xs"
                    placeholder="gguf-model"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">System Prompt</label>
                <textarea
                  value={llmSystem}
                  onChange={(e) => setLLMSystem(e.target.value)}
                  className="input mt-1 min-h-[60px] text-xs"
                />
              </div>
            </div>
          </details>

          {/* Quick presets */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Quick Actions</label>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "Extract Fields", prompt: "Extract all scientific data fields from this email and its attachments. For each field, provide: field name, value, unit, data type, and confidence score. Return as a structured JSON array." },
                { label: "Extract Tables", prompt: "Identify and extract all tabular data from this email's attachments. Return each table with headers, row count, and sample rows in JSON format." },
                { label: "Summarize", prompt: "Provide a comprehensive summary of this email's scientific content. Include: key findings, methodology, data quality assessment, and recommended next steps." },
                { label: "Classify", prompt: "Classify this email into a scientific domain (environmental, clinical, chemistry, biology, physics, other). Provide classification confidence and reasoning." },
                { label: "Detect Anomalies", prompt: "Analyze the data in this email for anomalies, outliers, or values exceeding known thresholds. Flag any readings that require immediate attention." },
                { label: "Transform to CSV", prompt: "Transform all extracted data from this email into CSV format. Include headers and all data rows. Return the CSV content in a code block." },
                { label: "Build Schema", prompt: "Design a database schema (SQL DDL) to store the scientific data from this email. Include tables, columns, types, constraints, and relationships." },
                { label: "Generate Queries", prompt: "Generate SQL queries to analyze the scientific data from this email. Include: aggregation queries, filtering by threshold, trend analysis, and anomaly detection queries." },
                { label: "Compare Datasets", prompt: "Compare the data in this email with typical expected values for this scientific domain. Highlight deviations, missing fields, and data quality issues." },
                { label: "Build Mermaid", prompt: "Generate a Mermaid mindmap diagram that organizes the key concepts, data fields, and findings from this email. Use proper mindmap syntax with the root node as the email subject." },
              ].map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => setLLMPrompt(preset.prompt)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600 transition-all"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt input */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Prompt</label>
            <textarea
              value={llmPrompt}
              onChange={(e) => setLLMPrompt(e.target.value)}
              className="input min-h-[80px] text-sm"
              placeholder="Ask the model to analyze email content, extract data, generate summaries..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runInference();
              }}
            />
          </div>

          {llmError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
              {llmError}
            </div>
          )}

          <button
            onClick={runInference}
            disabled={inferencing || !llmPrompt.trim()}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white shadow-lg transition-all hover:bg-slate-800 disabled:opacity-40"
          >
            {inferencing ? (
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
                </svg>
                Send
              </span>
            )}
          </button>

          {rotateProgress && inferencing && (
            <div className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-xs text-blue-700">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {rotateProgress}
              </div>
            </div>
          )}

          {rotateInfo && (
            <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-xs text-green-700">
              <div className="flex items-center gap-3">
                <span>✓ {rotateInfo.rotations} rotations</span>
                <span>· {rotateInfo.tokens} tokens</span>
                <span>· {rotateInfo.nodes.length} node(s)</span>
              </div>
              <div className="mt-1 text-[10px] text-green-600">
                {rotateInfo.nodes.map(n => n.replace("https://", "").replace("/v1", "")).join(", ")}
              </div>
            </div>
          )}

          {llmResults.length > 0 && (
            <div className="space-y-3 max-h-[400px] overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/30 p-3">
              {llmResults.map((r, i) => (
                <div
                  key={i}
                  className={`flex ${r.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                      r.role === "user"
                        ? "bg-slate-900 text-white rounded-br-md"
                        : "bg-white border border-slate-200 text-slate-800 rounded-bl-md"
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className={`text-[10px] font-semibold uppercase ${r.role === "user" ? "text-slate-300" : "text-slate-400"}`}>
                        {r.role === "user" ? "You" : "AI"}
                      </span>
                      <span className={`text-[10px] ${r.role === "user" ? "text-slate-400" : "text-slate-400"}`}>
                        {new Date(r.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed">{r.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Remote URL List */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Remote URL List</h3>
              <p className="text-sm text-muted-foreground">Monitor ETL pipeline endpoints</p>
            </div>
            <button
              onClick={checkAllURLs}
              disabled={checkingAll || remoteURLs.length === 0}
              className="btn btn-outline !h-9 text-xs"
            >
              {checkingAll ? "Checking..." : "Check All"}
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={newURLLabel}
              onChange={(e) => setNewURLLabel(e.target.value)}
              className="input flex-1 text-sm"
              placeholder="Label"
            />
            <input
              type="text"
              value={newURL}
              onChange={(e) => setNewURL(e.target.value)}
              className="input flex-1 text-sm"
              placeholder="https://example.com"
              onKeyDown={(e) => e.key === "Enter" && addURL()}
            />
            <button onClick={addURL} disabled={!newURL} className="btn btn-primary !h-10 text-sm">
              Add
            </button>
          </div>

          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {remoteURLs.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No URLs added yet. Add remote endpoints to monitor.
              </p>
            )}
            {remoteURLs.map((url) => (
              <div key={url.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{url.label}</p>
                    <p className="text-xs text-muted-foreground truncate">{url.url}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${url.status === "online" ? "bg-green-100 text-green-700" :
                    url.status === "offline" ? "bg-red-100 text-red-700" :
                      url.status === "checking" ? "bg-blue-100 text-blue-700" :
                        "bg-slate-100 text-slate-600"
                    }`}>
                    {url.status}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex gap-3 text-muted-foreground">
                    {url.lastChecked && <span>{new Date(url.lastChecked).toLocaleTimeString()}</span>}
                    {url.responseTime !== undefined && <span>{url.responseTime}ms</span>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => checkURL(url)} disabled={url.status === "checking"} className="text-xs text-primary hover:underline">
                      {url.status === "checking" ? "..." : "Check"}
                    </button>
                    <button onClick={() => removeURL(url.id)} className="text-xs text-destructive hover:underline">
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function WikiTreeView({ node, depth = 0 }: { node: WikiTreeNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const colors = ["bg-blue-50 border-blue-200", "bg-green-50 border-green-200", "bg-amber-50 border-amber-200", "bg-purple-50 border-purple-200", "bg-pink-50 border-pink-200"];

  return (
    <div className="space-y-1">
      <div
        className={`rounded-lg border p-2 ${colors[depth % colors.length]}`}
        style={{ marginLeft: `${depth * 16}px` }}
      >
        <div className="flex items-center gap-2">
          {node.children.length > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs font-bold text-slate-500"
            >
              {expanded ? "▼" : "▶"}
            </button>
          )}
          <span className="text-sm font-medium">{node.title}</span>
        </div>
        {node.content && (
          <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{node.content}</p>
        )}
        {node.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {node.tags.map((tag) => (
              <span key={tag} className="rounded bg-white/60 px-1.5 py-0.5 text-xs text-slate-600">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      {expanded && node.children.map((child) => (
        <WikiTreeView key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function MindmapView({ node, depth = 0 }: { node: MindmapNode; depth?: number }) {
  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#ec4899"];
  const color = node.color || colors[depth % colors.length];

  return (
    <div className="space-y-2">
      <div style={{ marginLeft: `${depth * 24}px` }}>
        <div
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: color }}
        >
          {node.label}
        </div>
        {node.children.length > 0 && (
          <div className="mt-2 space-y-2 border-l-2 pl-4" style={{ borderColor: color }}>
            {node.children.map((child) => (
              <MindmapView key={child.id} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ExecutionView({ plan }: { plan: { steps: ExecutionStep[]; summary: string; estimatedTime: string; dependencies: string[] } }) {
  const statusColors: Record<string, string> = {
    completed: "bg-green-100 text-green-700 border-green-300",
    in_progress: "bg-blue-100 text-blue-700 border-blue-300",
    pending: "bg-slate-100 text-slate-600 border-slate-300",
    failed: "bg-red-100 text-red-700 border-red-300",
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-slate-50 p-3">
        <p className="text-sm font-medium">{plan.summary}</p>
        <p className="mt-1 text-xs text-muted-foreground">Estimated time: {plan.estimatedTime}</p>
      </div>

      <div className="space-y-2">
        {plan.steps.map((step, i) => (
          <div key={step.id} className="rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-bold">
                {step.order}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">{step.action}</p>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </div>
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusColors[step.status]}`}>
                {step.status.replace("_", " ")}
              </span>
            </div>
            {(step.inputs.length > 0 || step.outputs.length > 0) && (
              <div className="mt-2 flex gap-4 pl-10 text-xs">
                {step.inputs.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">In: </span>
                    <code className="text-slate-600">{step.inputs.join(", ")}</code>
                  </div>
                )}
                {step.outputs.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">Out: </span>
                    <code className="text-slate-600">{step.outputs.join(", ")}</code>
                  </div>
                )}
              </div>
            )}
            {i < plan.steps.length - 1 && (
              <div className="mt-2 pl-3 text-slate-300">↓</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DataView({ record }: { record: ProcessedEmailRecord }) {
  const data = record.extractedData;
  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-2 text-sm font-semibold">Summary</h4>
        <p className="text-sm text-muted-foreground">{data.summary}</p>
      </div>

      {data.fields.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Extracted Fields ({data.fields.length})</h4>
          <div className="grid grid-cols-2 gap-2">
            {data.fields.map((field, i) => (
              <div key={i} className="rounded border p-2">
                <p className="text-xs font-medium">{field.key}</p>
                <p className="text-xs text-muted-foreground">{field.value}</p>
                {field.unit && <p className="text-xs text-muted-foreground">Unit: {field.unit}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.tables.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Data Tables ({data.tables.length})</h4>
          {data.tables.map((table, i) => (
            <div key={i} className="mb-3 rounded border p-2">
              <p className="text-xs font-medium mb-2">{table.name} ({table.rows.length} rows)</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      {table.headers.map((h) => (
                        <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.slice(0, 10).map((row, j) => (
                      <tr key={j} className="border-b">
                        {table.headers.map((h) => (
                          <td key={h} className="px-2 py-1">{String(row[h] || "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SwipeReviewPanel({
  records,
  index,
  direction,
  decisions,
  onSwipe,
  onSelect,
}: {
  records: ProcessedEmailRecord[];
  index: number;
  direction: "left" | "right" | null;
  decisions: Record<string, "keep" | "skip">;
  onSwipe: (recordId: string, dir: "left" | "right") => void;
  onSelect: (record: ProcessedEmailRecord) => void;
}) {
  if (index >= records.length) {
    const kept = Object.values(decisions).filter((d) => d === "keep").length;
    const skipped = Object.values(decisions).filter((d) => d === "skip").length;
    return (
      <div className="flex h-[400px] flex-col items-center justify-center text-center">
        <p className="text-lg font-semibold">Review Complete</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {kept} kept · {skipped} skipped · {records.length} total
        </p>
      </div>
    );
  }

  const record = records[index];
  const animClass = direction === "right"
    ? "translate-x-[150%] rotate-12 opacity-0 transition-all duration-300"
    : direction === "left"
      ? "-translate-x-[150%] -rotate-12 opacity-0 transition-all duration-300"
      : "";

  return (
    <div className="flex flex-col items-center">
      {/* Progress */}
      <div className="mb-3 w-full">
        <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
          <span>{index + 1} / {records.length}</span>
          <span>{Object.keys(decisions).length} reviewed</span>
        </div>
        <div className="h-1 rounded-full bg-slate-200 overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${(index / records.length) * 100}%` }} />
        </div>
      </div>

      {/* Swipe card */}
      <div className={`relative w-full ${animClass}`}>
        <div className="card p-5 min-h-[280px] flex flex-col">
          {/* KEEP / SKIP stamps */}
          {direction === "right" && (
            <div className="absolute top-4 right-4 rounded-lg border-2 border-green-500 px-3 py-1 text-sm font-bold text-green-500 rotate-12">
              KEEP
            </div>
          )}
          {direction === "left" && (
            <div className="absolute top-4 left-4 rounded-lg border-2 border-red-500 px-3 py-1 text-sm font-bold text-red-500 -rotate-12">
              SKIP
            </div>
          )}

          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <p className="text-sm font-semibold leading-tight">{record.subject}</p>
              <p className="text-xs text-muted-foreground mt-1">{record.sender}</p>
              <p className="text-[10px] text-muted-foreground">{formatDate(record.receivedDate)}</p>
            </div>
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px]">{record.category}</span>
          </div>

          {/* Preview */}
          <div className="flex-1 text-xs text-muted-foreground overflow-hidden">
            {record.extractedData?.summary && (
              <p className="line-clamp-3">{record.extractedData.summary}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {record.extractedData?.fields?.slice(0, 6).map((f: any, i: number) => (
                <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px]">
                  {f.key}: {f.value}
                </span>
              ))}
            </div>
            {record.extractedData?.tables?.length > 0 && (
              <p className="mt-2 text-[10px]">
                {record.extractedData.tables.length} table(s), {record.fieldCount} fields extracted
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="mt-4 flex items-center justify-center gap-4">
            <button
              onClick={() => onSwipe(record.id, "left")}
              className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-red-300 bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
              title="Skip (swipe left)"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <button
              onClick={() => onSelect(record)}
              className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-blue-300 bg-blue-50 text-blue-500 hover:bg-blue-100 transition-colors"
              title="View details"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>
            <button
              onClick={() => onSwipe(record.id, "right")}
              className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-green-300 bg-green-50 text-green-500 hover:bg-green-100 transition-colors"
              title="Keep (swipe right)"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Hint */}
      <p className="mt-3 text-[10px] text-muted-foreground text-center">
        Swipe right to keep · Swipe left to skip · Center to view details
      </p>
    </div>
  );
}

function ValueExtractionView({ data }: { data: any }) {
  const categoryColors: Record<string, string> = {
    "Data Extraction": "border-blue-300 bg-blue-50",
    "Data Transformation": "border-purple-300 bg-purple-50",
    "Document Parsing": "border-amber-300 bg-amber-50",
    "Classification": "border-cyan-300 bg-cyan-50",
    "Risk Detection": "border-red-300 bg-red-50",
    "Synthesis": "border-green-300 bg-green-50",
    "Data Engineering": "border-indigo-300 bg-indigo-50",
    "Compliance": "border-slate-400 bg-slate-50",
    "Delivery": "border-teal-300 bg-teal-50",
    "Visualization": "border-pink-300 bg-pink-50",
  };

  return (
    <div className="space-y-4">
      {/* Header with total value */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-green-300 bg-green-50 p-3">
          <p className="text-[10px] font-medium text-green-700 uppercase tracking-wide">Total Estimated Value</p>
          <p className="text-2xl font-bold text-green-800">${data.totalEstimatedValue.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-blue-300 bg-blue-50 p-3">
          <p className="text-[10px] font-medium text-blue-700 uppercase tracking-wide">Risk-Adjusted Value</p>
          <p className="text-2xl font-bold text-blue-800">${data.riskAdjustedValue.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-purple-300 bg-purple-50 p-3">
          <p className="text-[10px] font-medium text-purple-700 uppercase tracking-wide">Capital Turnover</p>
          <p className="text-sm font-bold text-purple-800 leading-tight">{data.capitalTurnover}</p>
        </div>
      </div>

      {/* ROI metrics */}
      <div className="flex gap-3 text-xs">
        <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">{data.roi}</span>
        <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">Payback: {data.paybackPeriod}</span>
        <span className="rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-700">{data.elements.length} value elements</span>
      </div>

      {/* Value elements table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-3 text-left font-semibold text-slate-700">Category</th>
              <th className="py-2 pr-3 text-left font-semibold text-slate-700">Element</th>
              <th className="py-2 pr-3 text-left font-semibold text-slate-700">Description</th>
              <th className="py-2 pr-3 text-right font-semibold text-slate-700">Est. Value</th>
              <th className="py-2 pr-3 text-center font-semibold text-slate-700">Confidence</th>
              <th className="py-2 text-left font-semibold text-slate-700">Capital Potential</th>
            </tr>
          </thead>
          <tbody>
            {data.elements.map((el: any) => (
              <tr key={el.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2 pr-3">
                  <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${categoryColors[el.category] || "border-slate-200 bg-slate-50"}`}>
                    {el.category}
                  </span>
                </td>
                <td className="py-2 pr-3 font-medium text-slate-800">{el.element}</td>
                <td className="py-2 pr-3 text-slate-600 max-w-xs">{el.description}</td>
                <td className="py-2 pr-3 text-right font-bold tabular-nums text-green-700">${el.estimatedValue.toLocaleString()}</td>
                <td className="py-2 pr-3 text-center">
                  <div className="inline-flex items-center gap-1">
                    <div className="h-1.5 w-12 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full bg-green-500" style={{ width: `${el.confidence * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-slate-500">{(el.confidence * 100).toFixed(0)}%</span>
                  </div>
                </td>
                <td className="py-2 text-[11px] text-slate-600 max-w-xs">{el.capitalPotential}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300">
              <td colSpan={3} className="py-2 pr-3 font-bold text-slate-800">Total Per-Extraction Value</td>
              <td className="py-2 pr-3 text-right font-bold tabular-nums text-green-700">${data.totalEstimatedValue.toLocaleString()}</td>
              <td colSpan={2} className="py-2 text-[11px] text-slate-600">{data.capitalTurnover}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Value breakdown bar */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="mb-2 text-[10px] font-medium text-slate-600 uppercase tracking-wide">Value Distribution by Category</p>
        <div className="flex h-3 w-full overflow-hidden rounded-full">
          {data.elements.map((el: any) => {
            const colors: Record<string, string> = {
              "Data Extraction": "bg-blue-400",
              "Data Transformation": "bg-purple-400",
              "Document Parsing": "bg-amber-400",
              "Classification": "bg-cyan-400",
              "Risk Detection": "bg-red-400",
              "Synthesis": "bg-green-400",
              "Data Engineering": "bg-indigo-400",
              "Compliance": "bg-slate-400",
              "Delivery": "bg-teal-400",
              "Visualization": "bg-pink-400",
            };
            const width = (el.estimatedValue / data.totalEstimatedValue) * 100;
            return <div key={el.id} className={colors[el.category] || "bg-slate-400"} style={{ width: `${width}%` }} title={`${el.element}: $${el.estimatedValue}`} />;
          })}
        </div>
      </div>
    </div>
  );
}
