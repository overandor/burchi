"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Mail, Search, TrendingUp, AlertTriangle, Sparkles, Activity,
  DollarSign, Inbox, Cpu, RefreshCw, Trash2, Check, ArrowRight,
  Database, Zap, Filter, ChevronRight, Tag, Clock,
  Radio, FlaskConical, GitBranch, Waves,
} from "lucide-react";

interface EmailDoc {
  id: string;
  subject: string;
  from: string;
  fromAddress: string;
  date: string;
  bodyPreview: string;
  isRead: boolean;
  category: string;
  hasAttachments: boolean;
  attachmentCount: number;
  importance: string;
  valueScore: number;
  valueTags: string[];
  sentiment: "positive" | "neutral" | "negative" | "urgent";
  extractedEntities: { type: string; value: string }[];
  source: string;
  syncedAt: string;
}

interface Stats {
  total: number;
  unread: number;
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
  avgValueScore: number;
  highValue: number;
  bySentiment: Record<string, number>;
  topTags: { tag: string; count: number }[];
  byDate: { date: string; count: number }[];
  nosqlConnected: boolean;
  store: string;
}

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "#10b981",
  neutral: "#64748b",
  negative: "#ef4444",
  urgent: "#f59e0b",
};

const CATEGORY_ICONS: Record<string, any> = {
  financial: DollarSign,
  "action-required": AlertTriangle,
  "business-critical": Zap,
  relationship: Sparkles,
  intelligence: Cpu,
  scheduling: Clock,
  system: Activity,
  general: Mail,
};

function scoreColor(score: number): string {
  if (score >= 70) return "#10b981";
  if (score >= 50) return "#3b82f6";
  if (score >= 30) return "#64748b";
  return "#94a3b8";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// Client-side value scoring (mirrors the server-side computeValueScore)
function computeValueClient(text: string): {
  score: number;
  tags: string[];
  sentiment: "positive" | "neutral" | "negative" | "urgent";
  entities: { type: string; value: string }[];
} {
  const t = text.toLowerCase();
  let score = 30;
  const tags: string[] = [];
  const entities: { type: string; value: string }[] = [];

  const dollarMatches = t.match(/\$[\d,]+\.?\d*/g) || [];
  if (dollarMatches.length > 0) {
    const maxAmount = Math.max(...dollarMatches.map(d => parseFloat(d.replace(/[$,]/g, ""))));
    if (maxAmount > 10000) { score += 30; tags.push("high-value"); }
    else if (maxAmount > 1000) { score += 20; tags.push("financial"); }
    else { score += 10; tags.push("transactional"); }
    dollarMatches.forEach(d => entities.push({ type: "money", value: d }));
  }
  if (/\b(urgent|asap|immediately|deadline|due by|action required|please review|approval needed)\b/.test(t)) {
    score += 15; tags.push("action-required");
  }
  if (/\b(invoice|payment|contract|proposal|quote|estimate|budget)\b/.test(t)) {
    score += 10; tags.push("business-critical");
  }
  if (/\b(meeting|schedule|calendar|appointment|call)\b/.test(t)) {
    score += 5; tags.push("scheduling");
  }
  if (/\b(introduction|referral|connection|networking)\b/.test(t)) {
    score += 8; tags.push("relationship");
  }
  if (/\b(report|analysis|data|metrics|kpi|results)\b/.test(t)) {
    score += 5; tags.push("intelligence");
  }

  let sentiment: "positive" | "neutral" | "negative" | "urgent" = "neutral";
  if (/\b(urgent|asap|critical|overdue|failed|error|problem|issue|complaint)\b/.test(t)) sentiment = "urgent";
  else if (/\b(thank|appreciate|great|excellent|congratulations|pleased|happy)\b/.test(t)) sentiment = "positive";
  else if (/\b(sorry|unfortunately|regret|decline|rejected|concern|disappointed)\b/.test(t)) sentiment = "negative";

  const dateMatches = t.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2})\b/gi) || [];
  dateMatches.forEach(d => entities.push({ type: "date", value: d }));
  const emailMatches = t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
  emailMatches.forEach(e => entities.push({ type: "email", value: e }));

  score = Math.min(100, score);
  if (tags.length === 0) tags.push("general");
  return { score, tags, sentiment, entities };
}

// Compute stats from client-side emails
function computeStatsClient(emails: EmailDoc[]): Stats {
  const total = emails.length;
  const unread = emails.filter(e => !e.isRead).length;
  const byCategory: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const bySentiment: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  let scoreSum = 0;
  let highValue = 0;

  for (const e of emails) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    bySource[e.source] = (bySource[e.source] || 0) + 1;
    bySentiment[e.sentiment] = (bySentiment[e.sentiment] || 0) + 1;
    scoreSum += e.valueScore;
    if (e.valueScore >= 70) highValue++;
    for (const t of e.valueTags) tagCounts[t] = (tagCounts[t] || 0) + 1;
  }

  const topTags = Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    total, unread, byCategory, bySource,
    avgValueScore: total > 0 ? Math.round(scoreSum / total) : 0,
    highValue, bySentiment, topTags,
    byDate: [],
    nosqlConnected: false,
    store: "client-cache",
  };
}

export default function EmailLabPage() {
  const [emails, setEmails] = useState<EmailDoc[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selected, setSelected] = useState<EmailDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "high-value">("all");
  const [nosqlConnected, setNosqlConnected] = useState(false);
  const [storeName, setStoreName] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [emailsRes, statsRes] = await Promise.all([
        fetch("/api/emails?limit=50"),
        fetch("/api/emails?stats=true"),
      ]);
      const emailsData = await emailsRes.json();
      const statsData = await statsRes.json();
      setEmails(emailsData.emails || []);
      setStats(statsData);
      setNosqlConnected(emailsData.nosqlConnected ?? false);
      setStoreName(emailsData.store || "unknown");
    } catch (e) {
      console.error("[email-lab] load error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Load cached emails from localStorage first (instant display)
    const cached = localStorage.getItem("email-lab-cache");
    if (cached) {
      try {
        const cachedEmails = JSON.parse(cached);
        if (Array.isArray(cachedEmails) && cachedEmails.length > 0) {
          setEmails(cachedEmails);
          // Load stats from cached emails
          const cachedStats = computeStatsClient(cachedEmails);
          setStats(cachedStats);
        }
      } catch { /* ignore */ }
    }

    // Then try server-side load + seed
    fetch("/api/emails?limit=1").then(r => r.json()).then(async (d) => {
      if (d.total === 0 && !cached) {
        await fetch("/api/emails/seed", { method: "POST" });
      }
      if (!cached) loadAll();
    }).catch(() => {
      if (!cached) loadAll();
    });
  }, [loadAll]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) { loadAll(); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/emails/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setEmails(data.emails || []);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, loadAll]);

  const handleFilter = useCallback(async (f: "all" | "unread" | "high-value") => {
    setFilter(f);
    setLoading(true);
    try {
      let url = "/api/emails?limit=50";
      if (f === "unread") url += "&unread=true";
      if (f === "high-value") url += "&minScore=70";
      const res = await fetch(url);
      const data = await res.json();
      setEmails(data.emails || []);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelect = useCallback(async (email: EmailDoc) => {
    setSelected(email);
    if (!email.isRead) {
      await fetch(`/api/emails/${email.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      });
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, isRead: true } : e));
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    await fetch(`/api/emails/${id}`, { method: "DELETE" });
    setEmails(prev => prev.filter(e => e.id !== id));
    setSelected(null);
    loadAll();
  }, [loadAll]);

  const handleSync = useCallback(async () => {
    setLoading(true);

    // Try Microsoft first
    const msConfig = localStorage.getItem("microsoft-config");
    if (msConfig) {
      try {
        const { token, email } = JSON.parse(msConfig);
        if (token) {
          console.log("[email-lab] syncing from Microsoft...");
          const syncRes = await fetch("/api/microsoft/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, maxEmails: 1000 }),
          });
          const syncData = await syncRes.json();
          if (syncData.messages && syncData.messages.length > 0) {
            console.log(`[email-lab] got ${syncData.messages.length} emails from Microsoft`);
            // Store to NoSQL (best-effort — may not persist on serverless)
            try {
              await fetch("/api/emails/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ emails: syncData.messages, source: "microsoft" }),
              });
            } catch { /* non-fatal */ }

            // Process emails client-side with value scoring
            const processed: EmailDoc[] = syncData.messages.map((m: any) => {
              const { score, tags, sentiment, entities } = computeValueClient(m.subject + " " + (m.bodyPreview || ""));
              return {
                id: m.id,
                subject: m.subject || "(no subject)",
                from: m.from || "unknown",
                fromAddress: m.fromAddress || "",
                to: [],
                date: m.receivedDateTime || new Date().toISOString(),
                bodyPreview: m.bodyPreview || "",
                body: null,
                isRead: m.isRead ?? true,
                category: m.importance === "high" ? "action-required" : "general",
                hasAttachments: m.hasAttachments ?? false,
                attachmentCount: 0,
                importance: m.importance || "normal",
                valueScore: score,
                valueTags: tags,
                sentiment,
                extractedEntities: entities,
                source: "microsoft",
                syncedAt: new Date().toISOString(),
              };
            });
            setEmails(processed);
            // Cache in localStorage for persistence across reloads
            localStorage.setItem("email-lab-cache", JSON.stringify(processed));
            setLoading(false);
            return;
          }
        }
      } catch (e) { console.error("[email-lab] Microsoft sync error:", e); }
    }

    // Try Gmail
    const gmailConfig = localStorage.getItem("gmail-config");
    if (gmailConfig) {
      try {
        const { refreshToken, clientId } = JSON.parse(gmailConfig);
        if (refreshToken && clientId) {
          console.log("[email-lab] syncing from Gmail...");
          const syncRes = await fetch("/api/gmail/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientId, refreshToken, maxEmails: 1000 }),
          });
          const syncData = await syncRes.json();
          if (syncData.emails && syncData.emails.length > 0) {
            console.log(`[email-lab] got ${syncData.emails.length} emails from Gmail`);
            const processed: EmailDoc[] = syncData.emails.map((m: any) => {
              const { score, tags, sentiment, entities } = computeValueClient(m.subject + " " + (m.snippet || m.bodyPreview || ""));
              return {
                id: m.id || `gmail-${Date.now()}-${Math.random()}`,
                subject: m.subject || "(no subject)",
                from: m.from || "unknown",
                fromAddress: "",
                to: [],
                date: m.date || new Date().toISOString(),
                bodyPreview: m.snippet || m.bodyPreview || "",
                body: null,
                isRead: !m.labelIds?.includes("UNREAD"),
                category: "general",
                hasAttachments: !!m.attachmentCount,
                attachmentCount: m.attachmentCount || 0,
                importance: "normal",
                valueScore: score,
                valueTags: tags,
                sentiment,
                extractedEntities: entities,
                source: "gmail",
                syncedAt: new Date().toISOString(),
              };
            });
            setEmails(processed);
            localStorage.setItem("email-lab-cache", JSON.stringify(processed));
            setLoading(false);
            return;
          }
        }
      } catch (e) { console.error("[email-lab] Gmail sync error:", e); }
    }

    // No provider connected — seed demo data
    console.log("[email-lab] no provider, seeding demo...");
    try {
      await fetch("/api/emails/seed", { method: "POST" });
    } catch { /* non-fatal */ }
    loadAll();
  }, [loadAll]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100">
      {/* ─── Ambient glow background ─── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
        <div className="absolute top-1/2 -right-40 h-96 w-96 rounded-full bg-purple-500/10 blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-emerald-500/5 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-6 py-8">
        {/* ─── Header ─── */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/30">
                <Mail className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Email Lab</h1>
                <p className="text-sm text-slate-400">Email as a store of value — NoSQL powered intelligence</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* DB status badge */}
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${nosqlConnected
                ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20"
                : "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20"
              }`}>
              <Database className="h-3.5 w-3.5" />
              {nosqlConnected ? `Connected · ${storeName}` : `In-memory · ${storeName}`}
            </div>
            <button
              onClick={handleSync}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Sync
            </button>
          </div>
        </div>

        {/* ─── Stats Row ─── */}
        {stats && (
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
            <StatCard label="Total" value={stats.total} icon={Inbox} color="#3b82f6" />
            <StatCard label="Unread" value={stats.unread} icon={Mail} color="#f59e0b" />
            <StatCard label="High Value" value={stats.highValue} icon={Zap} color="#10b981" />
            <StatCard label="Avg Score" value={stats.avgValueScore} icon={TrendingUp} color="#8b5cf6" />
            <StatCard label="Urgent" value={stats.bySentiment.urgent || 0} icon={AlertTriangle} color="#ef4444" />
            <StatCard label="Positive" value={stats.bySentiment.positive || 0} icon={Sparkles} color="#10b981" />
          </div>
        )}

        {/* ─── Main grid ─── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* ─── Email list (left, 2 cols) ─── */}
          <div className="lg:col-span-2">
            {/* Search + filters */}
            <div className="mb-4 flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Search emails, tags, entities..."
                  className="w-full rounded-xl bg-white/5 py-2.5 pl-10 pr-4 text-sm text-slate-200 placeholder-slate-500 ring-1 ring-white/10 outline-none transition focus:ring-blue-500/40"
                />
              </div>
              <div className="flex gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/10">
                {(["all", "unread", "high-value"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => handleFilter(f)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${filter === f
                        ? "bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30"
                        : "text-slate-400 hover:text-slate-200"
                      }`}
                  >
                    {f === "high-value" ? "High Value" : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Email list */}
            <div className="space-y-2">
              {emails.length === 0 && !loading && (
                <div className="rounded-2xl bg-white/5 p-12 text-center ring-1 ring-white/10">
                  <Inbox className="mx-auto h-10 w-10 text-slate-600" />
                  <p className="mt-4 text-sm text-slate-400">No emails yet. Click Sync to pull from your mailbox.</p>
                </div>
              )}
              {emails.map((email) => {
                const CatIcon = CATEGORY_ICONS[email.category] || Mail;
                const isSelected = selected?.id === email.id;
                return (
                  <div
                    key={email.id}
                    onClick={() => handleSelect(email)}
                    className={`group cursor-pointer rounded-2xl p-4 ring-1 transition-all ${isSelected
                        ? "bg-blue-500/10 ring-blue-500/30"
                        : "bg-white/[0.03] ring-white/10 hover:bg-white/[0.06] hover:ring-white/20"
                      } ${!email.isRead ? "border-l-2 border-l-blue-500" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Category icon */}
                      <div
                        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1"
                        style={{
                          backgroundColor: `${scoreColor(email.valueScore)}15`,
                          color: scoreColor(email.valueScore),
                          borderColor: `${scoreColor(email.valueScore)}30`,
                        }}
                      >
                        <CatIcon className="h-4 w-4" />
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`truncate text-sm ${!email.isRead ? "font-semibold text-slate-100" : "font-medium text-slate-300"}`}>
                            {email.subject}
                          </p>
                          <span className="shrink-0 text-xs text-slate-500">{timeAgo(email.date)}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-slate-400">{email.from}</p>
                        <p className="mt-1 truncate text-xs text-slate-500">{email.bodyPreview}</p>

                        {/* Tags + score */}
                        <div className="mt-2 flex items-center gap-2">
                          {/* Value score bar */}
                          <div className="flex items-center gap-1.5">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${email.valueScore}%`, backgroundColor: scoreColor(email.valueScore) }}
                              />
                            </div>
                            <span className="text-[10px] font-medium" style={{ color: scoreColor(email.valueScore) }}>
                              {email.valueScore}
                            </span>
                          </div>
                          {/* Sentiment dot */}
                          <div
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: SENTIMENT_COLORS[email.sentiment] }}
                            title={email.sentiment}
                          />
                          {/* Tags */}
                          {email.valueTags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 ring-1 ring-white/10"
                            >
                              {tag}
                            </span>
                          ))}
                          {/* Attachments */}
                          {email.hasAttachments && (
                            <span className="text-[10px] text-slate-500">📎 {email.attachmentCount}</span>
                          )}
                        </div>
                      </div>

                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-600 transition group-hover:text-slate-400" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─── Detail panel (right, 1 col) ─── */}
          <div className="lg:col-span-1">
            {selected ? (
              <div className="sticky top-6 rounded-2xl bg-white/[0.03] p-6 ring-1 ring-white/10">
                {/* Header */}
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-slate-100">{selected.subject}</h3>
                    <p className="mt-1 text-xs text-slate-400">{selected.from}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {new Date(selected.date).toLocaleString()} · via {selected.source}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(selected.id)}
                    className="rounded-lg p-2 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* Value score */}
                <div className="mb-4 rounded-xl bg-gradient-to-br from-white/5 to-transparent p-4 ring-1 ring-white/10">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-400">Value Score</span>
                    <span className="text-2xl font-bold" style={{ color: scoreColor(selected.valueScore) }}>
                      {selected.valueScore}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${selected.valueScore}%`, backgroundColor: scoreColor(selected.valueScore) }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selected.valueTags.map((tag) => (
                      <span
                        key={tag}
                        className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[10px] font-medium text-slate-300 ring-1 ring-white/10"
                      >
                        <Tag className="h-2.5 w-2.5" />
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Sentiment */}
                <div className="mb-4 flex items-center gap-3">
                  <span className="text-xs font-medium text-slate-400">Sentiment:</span>
                  <div
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ring-1"
                    style={{
                      backgroundColor: `${SENTIMENT_COLORS[selected.sentiment]}15`,
                      color: SENTIMENT_COLORS[selected.sentiment],
                      borderColor: `${SENTIMENT_COLORS[selected.sentiment]}30`,
                    }}
                  >
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: SENTIMENT_COLORS[selected.sentiment] }} />
                    {selected.sentiment}
                  </div>
                </div>

                {/* Body preview */}
                <div className="mb-4">
                  <span className="text-xs font-medium text-slate-400">Preview</span>
                  <p className="mt-2 rounded-xl bg-white/5 p-3 text-sm leading-relaxed text-slate-300 ring-1 ring-white/10">
                    {selected.bodyPreview}
                  </p>
                </div>

                {/* Extracted entities */}
                {selected.extractedEntities.length > 0 && (
                  <div className="mb-4">
                    <span className="text-xs font-medium text-slate-400">Extracted Entities</span>
                    <div className="mt-2 space-y-1.5">
                      {selected.extractedEntities.slice(0, 8).map((entity, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 font-mono text-blue-300 ring-1 ring-blue-500/20">
                            {entity.type}
                          </span>
                          <span className="text-slate-300">{entity.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Metadata */}
                <div className="flex items-center justify-between border-t border-white/10 pt-4 text-xs text-slate-500">
                  <span>Importance: {selected.importance}</span>
                  <span>Synced: {timeAgo(selected.syncedAt)} ago</span>
                </div>
              </div>
            ) : (
              <div className="sticky top-6 rounded-2xl bg-white/[0.03] p-12 text-center ring-1 ring-white/10">
                <Mail className="mx-auto h-10 w-10 text-slate-600" />
                <p className="mt-4 text-sm text-slate-400">Select an email to view details</p>
              </div>
            )}
          </div>
        </div>

        {/* ─── Top tags strip ─── */}
        {stats && stats.topTags.length > 0 && (
          <div className="mt-8 rounded-2xl bg-white/[0.02] p-6 ring-1 ring-white/10">
            <div className="mb-4 flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-200">Value Distribution</h3>
            </div>
            <div className="flex flex-wrap gap-3">
              {stats.topTags.map(({ tag, count }) => (
                <div
                  key={tag}
                  className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/10"
                >
                  <span className="text-sm font-medium text-slate-200">{tag}</span>
                  <span className="rounded-md bg-blue-500/20 px-1.5 py-0.5 text-xs font-bold text-blue-300">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Activity sparkline ─── */}
        {stats && stats.byDate.length > 0 && (
          <div className="mt-4 rounded-2xl bg-white/[0.02] p-6 ring-1 ring-white/10">
            <div className="mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-200">Email Activity (14 days)</h3>
            </div>
            <div className="flex items-end gap-1.5" style={{ height: "60px" }}>
              {stats.byDate.map(({ date, count }) => {
                const maxCount = Math.max(...stats.byDate.map(d => d.count), 1);
                const height = (count / maxCount) * 100;
                return (
                  <div key={date} className="group relative flex-1">
                    <div
                      className="w-full rounded-t-md bg-gradient-to-t from-blue-500/40 to-blue-400/80 transition-all hover:from-blue-500/60 hover:to-blue-400"
                      style={{ height: `${Math.max(height, 4)}%` }}
                    />
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 rounded-md bg-slate-800 px-2 py-1 text-[10px] text-slate-300 opacity-0 transition group-hover:opacity-100">
                      {count} emails
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stat card component ─────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/10 transition hover:ring-white/20">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}15`, color }}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-100">{value}</p>
    </div>
  );
}
