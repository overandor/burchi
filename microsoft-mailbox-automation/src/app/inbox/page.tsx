"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { normalizeOrigin } from "@/lib/utils";

interface TriagedEmail {
  email: {
    id: string;
    subject: string;
    sender: string;
    senderEmail: string;
    receivedDate: string;
    bodyPreview: string;
    body: string;
    hasAttachments: boolean;
    isRead: boolean;
    threadId?: string;
  };
  category: string;
  revenueScore: number;
  priority: "high" | "medium" | "low";
  isUnread: boolean;
  hasAttachments: boolean;
  suggestedAction?: string;
  estimatedValue: number;
}

interface SplitColumn {
  category: string;
  label: string;
  icon: string;
  color: string;
  emails: TriagedEmail[];
  totalValue: number;
  unreadCount: number;
}

interface FollowUp {
  email: TriagedEmail["email"];
  daysSinceReceived: number;
  estimatedValue: number;
  suggestedFollowUp: string;
  urgency: "overdue" | "soon" | "normal";
}

function formatCurrency(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${v}`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffHrs = (now.getTime() - d.getTime()) / (1000 * 60 * 60);
    if (diffHrs < 24) return d.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
    if (diffHrs < 168) return d.toLocaleDateString("en", { weekday: "short" });
    return d.toLocaleDateString("en", { month: "short", day: "numeric" });
  } catch {
    return dateStr?.slice(0, 10) || "";
  }
}

const PRIORITY_COLORS = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#6b7280",
};

const URGENCY_COLORS = {
  overdue: "#ef4444",
  soon: "#f59e0b",
  normal: "#3b82f6",
};

export default function InboxPage() {
  const [columns, setColumns] = useState<SplitColumn[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<TriagedEmail | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [emailBody, setEmailBody] = useState<string>("");
  const [loadingBody, setLoadingBody] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TriagedEmail["email"][] | null>(null);
  const [searching, setSearching] = useState(false);
  const [activeView, setActiveView] = useState<"inbox" | "followups" | "search">("inbox");
  const [summary, setSummary] = useState({ totalEmails: 0, totalUnread: 0, totalEstimatedValue: 0 });
  const [keyboardHint, setKeyboardHint] = useState<string | null>(null);
  const emailListRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Check Gmail connection
  useEffect(() => {
    const local = localStorage.getItem("gmail-config");
    if (local) {
      try {
        const config = JSON.parse(local);
        setGmailConnected(!!config.refreshToken);
      } catch {}
    }
    // Also check URL param
    if (new URLSearchParams(window.location.search).get("gmail_connected") === "true") {
      setGmailConnected(true);
    }
  }, []);

  const getRefreshToken = () => {
    const local = localStorage.getItem("gmail-config");
    if (local) {
      try { return JSON.parse(local).refreshToken; } catch {}
    }
    return null;
  };

  const fetchTriage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        setError("Gmail not connected. Connect Gmail first from the Dashboard.");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/gmail/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken, maxResults: 100 }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (data.error) {
        setError(data.error);
      } else {
        setColumns(data.columns || []);
        setSummary(data.summary || { totalEmails: 0, totalUnread: 0, totalEstimatedValue: 0 });
        if (data.columns?.length > 0 && !selectedColumn) {
          setSelectedColumn(data.columns[0].category);
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedColumn]);

  const fetchFollowUps = useCallback(async () => {
    try {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return;

      const res = await fetch("/api/gmail/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken, maxResults: 100 }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!data.error) {
        setFollowUps(data.followUps || []);
      }
    } catch (e: any) {
      console.error("Follow-ups error:", e);
    }
  }, []);

  useEffect(() => {
    if (gmailConnected) {
      fetchTriage();
      fetchFollowUps();
    } else {
      setLoading(false);
    }
  }, [gmailConnected, fetchTriage, fetchFollowUps]);

  // Keyboard shortcuts (Superhuman-style)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't intercept if typing in input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, getCurrentEmails().length - 1));
          setKeyboardHint("↓");
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          setKeyboardHint("↑");
          break;
        case "e":
          e.preventDefault();
          if (selectedEmail) handleAction("archive", selectedEmail.email.id);
          setKeyboardHint("Archive (e)");
          break;
        case "u":
          e.preventDefault();
          if (selectedEmail) handleAction(selectedEmail.isUnread ? "read" : "unread", selectedEmail.email.id);
          setKeyboardHint(selectedEmail?.isUnread ? "Mark read (u)" : "Mark unread (u)");
          break;
        case "s":
          e.preventDefault();
          if (selectedEmail) handleAction("star", selectedEmail.email.id);
          setKeyboardHint("Star (s)");
          break;
        case "#":
          e.preventDefault();
          if (selectedEmail) handleAction("trash", selectedEmail.email.id);
          setKeyboardHint("Trash (#)");
          break;
        case "r":
          e.preventDefault();
          if (selectedEmail) {
            setSelectedEmail(selectedEmail);
            document.getElementById("draft-panel")?.focus();
            setKeyboardHint("Reply (r)");
          }
          break;
        case "/":
          e.preventDefault();
          document.getElementById("search-input")?.focus();
          setKeyboardHint("Search (/)");
          break;
        case "Escape":
          setSelectedEmail(null);
          setKeyboardHint(null);
          break;
      }
      setTimeout(() => setKeyboardHint(null), 1000);
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedEmail]);

  const getCurrentEmails = (): TriagedEmail[] => {
    if (activeView === "search" && searchResults) {
      return searchResults.map((email) => ({
        email,
        category: "general",
        revenueScore: 0,
        priority: "low" as const,
        isUnread: !email.isRead,
        hasAttachments: email.hasAttachments,
        estimatedValue: 0,
      }));
    }
    if (activeView === "followups") {
      return followUps.map((f) => ({
        email: f.email,
        category: "followup",
        revenueScore: f.estimatedValue,
        priority: f.urgency === "overdue" ? "high" : "medium",
        isUnread: true,
        hasAttachments: f.email.hasAttachments,
        estimatedValue: f.estimatedValue,
        suggestedAction: f.suggestedFollowUp,
      }));
    }
    const col = columns.find((c) => c.category === selectedColumn);
    return col?.emails || [];
  };

  const handleSelectEmail = async (triaged: TriagedEmail) => {
    setSelectedEmail(triaged);
    setEmailBody("");
    setLoadingBody(true);
    try {
      // Fetch full email body via search/read or use existing body
      if (triaged.email.body && triaged.email.body.length > 200) {
        setEmailBody(triaged.email.body);
      } else {
        // Use the body we already have
        setEmailBody(triaged.email.body || triaged.email.bodyPreview || "(no body)");
      }
      // Mark as read
      if (triaged.isUnread) {
        handleAction("read", triaged.email.id);
      }
    } finally {
      setLoadingBody(false);
    }
  };

  const handleAction = async (action: string, messageId: string) => {
    try {
      const refreshToken = getRefreshToken();
      const res = await fetch("/api/gmail/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, messageId, refreshToken }),
      });
      const data = await res.json();
      if (data.success) {
        setActionResult(`${action} ✓`);
        setTimeout(() => setActionResult(null), 1500);
        // Refresh triage
        fetchTriage();
      }
    } catch (e: any) {
      setActionResult(`Error: ${e.message}`);
      setTimeout(() => setActionResult(null), 2000);
    }
  };

  const handleSend = async () => {
    if (!selectedEmail || !draftText.trim()) return;
    setSending(true);
    try {
      const refreshToken = getRefreshToken();
      const res = await fetch("/api/gmail/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: selectedEmail.email.id,
          body: draftText,
          refreshToken,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActionResult("Reply sent ✓");
        setDraftText("");
        setTimeout(() => setActionResult(null), 2000);
        fetchTriage();
      } else {
        setActionResult(`Error: ${data.error}`);
      }
    } catch (e: any) {
      setActionResult(`Error: ${e.message}`);
    } finally {
      setSending(false);
    }
  };

  const handleAIDraft = async () => {
    if (!selectedEmail) return;
    setDrafting(true);
    try {
      const refreshToken = getRefreshToken();
      const prompt = `Draft a professional reply to this email. Keep it concise and actionable.

From: ${selectedEmail.email.sender}
Subject: ${selectedEmail.email.subject}
Body: ${selectedEmail.email.bodyPreview}

Suggested action: ${selectedEmail.suggestedAction || "Reply appropriately"}

Write only the reply body, no subject line.`;

      const res = await fetch("/api/llm/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: "You are an email assistant. Draft concise, professional replies. Match the tone of the original email. Keep replies under 150 words unless the email requires more detail.",
            },
            { role: "user", content: prompt },
          ],
          useTelemetry: true,
          refreshToken,
          max_tokens: 500,
          temperature: 0.7,
        }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      const content = data.choices?.[0]?.message?.content || data.response || "";
      if (content) {
        setDraftText(content);
      } else {
        setActionResult("AI draft failed — no LLM configured");
      }
    } catch (e: any) {
      setActionResult(`AI draft error: ${e.message}`);
    } finally {
      setDrafting(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    setActiveView("search");
    try {
      const refreshToken = getRefreshToken();
      const res = await fetch("/api/gmail/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, maxResults: 50, refreshToken }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      setSearchResults(data.results || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Triaging inbox...</p>
        </div>
      </div>
    );
  }

  if (!gmailConnected) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">📧</div>
          <h2 className="text-xl font-bold mb-2">Connect Gmail to use Inbox</h2>
          <p className="text-gray-400 mb-4">
            The Split Inbox requires a connected Gmail account to triage and display emails.
          </p>
          <a href="/" className="inline-block px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-white">
            Go to Dashboard
          </a>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button onClick={fetchTriage} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-white">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const currentEmails = getCurrentEmails();
  const currentSelected = currentEmails[selectedIndex] || selectedEmail;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/50 backdrop-blur">
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold">Inbox</h1>
            <div className="flex gap-1">
              <button
                onClick={() => { setActiveView("inbox"); setSelectedIndex(0); }}
                className={`px-3 py-1 rounded text-sm ${activeView === "inbox" ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-400"}`}
              >
                Split Inbox
              </button>
              <button
                onClick={() => { setActiveView("followups"); setSelectedIndex(0); }}
                className={`px-3 py-1 rounded text-sm ${activeView === "followups" ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-400"}`}
              >
                Follow-ups {followUps.length > 0 && `(${followUps.length})`}
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="flex-1 max-w-md flex gap-2">
            <input
              id="search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search emails... (from:, subject:, is:unread, etc.)"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
            />
            <button
              onClick={handleSearch}
              disabled={searching}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300"
            >
              {searching ? "..." : "Search"}
            </button>
          </div>

          {/* Summary */}
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-400">{summary.totalEmails} emails</span>
            <span className="text-gray-400">{summary.totalUnread} unread</span>
            <span className="text-emerald-400 font-medium">{formatCurrency(summary.totalEstimatedValue)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Split Inbox Columns / Email List */}
        <div className="w-80 border-r border-gray-800 overflow-y-auto" ref={emailListRef}>
          {activeView === "inbox" && (
            <>
              {/* Column selector */}
              <div className="flex flex-wrap gap-1 p-2 border-b border-gray-800 bg-gray-900/30">
                {columns.map((col) => (
                  <button
                    key={col.category}
                    onClick={() => { setSelectedColumn(col.category); setSelectedIndex(0); }}
                    className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${
                      selectedColumn === col.category ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-800"
                    }`}
                  >
                    <span>{col.icon}</span>
                    <span>{col.label}</span>
                    {col.unreadCount > 0 && (
                      <span className="bg-emerald-600 text-white rounded-full px-1.5 text-xs">{col.unreadCount}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Email list */}
          <div className="divide-y divide-gray-800">
            {currentEmails.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">
                {activeView === "followups" ? "No follow-ups needed — you're all caught up!" : "No emails in this view."}
              </div>
            ) : (
              currentEmails.map((triaged, i) => {
                const email = triaged.email;
                const isSelected = currentSelected?.email.id === email.id;
                return (
                  <div
                    key={email.id}
                    onClick={() => { setSelectedIndex(i); handleSelectEmail(triaged); }}
                    className={`p-3 cursor-pointer transition-colors ${
                      isSelected ? "bg-gray-800" : "hover:bg-gray-900"
                    } ${triaged.isUnread ? "border-l-2" : "border-l-2 border-transparent"}`}
                    style={triaged.isUnread ? { borderLeftColor: PRIORITY_COLORS[triaged.priority] } : {}}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm truncate ${triaged.isUnread ? "font-bold text-white" : "text-gray-400"}`}>
                          {email.sender}
                        </div>
                        <div className={`text-sm truncate mt-0.5 ${triaged.isUnread ? "text-gray-200" : "text-gray-500"}`}>
                          {email.subject}
                        </div>
                        <div className="text-xs text-gray-600 truncate mt-1">{email.bodyPreview}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-xs text-gray-500">{formatDate(email.receivedDate)}</span>
                        {triaged.estimatedValue > 0 && (
                          <span className="text-xs text-emerald-400 font-medium">{formatCurrency(triaged.estimatedValue)}</span>
                        )}
                        {triaged.hasAttachments && <span className="text-xs">📎</span>}
                      </div>
                    </div>
                    {triaged.suggestedAction && isSelected && (
                      <div className="mt-2 text-xs text-blue-400 bg-blue-950/30 rounded px-2 py-1">
                        💡 {triaged.suggestedAction}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Center: Email Body */}
        <div className="flex-1 overflow-y-auto">
          {currentSelected ? (
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold">{currentSelected.email.subject}</h2>
                  <div className="text-sm text-gray-400 mt-1">
                    From: <span className="text-gray-300">{currentSelected.email.sender}</span>
                    &lt;{currentSelected.email.senderEmail}&gt;
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{currentSelected.email.receivedDate}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleAction("archive", currentSelected.email.id)} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-sm" title="Archive (e)">Archive</button>
                  <button onClick={() => handleAction("star", currentSelected.email.id)} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-sm" title="Star (s)">Star</button>
                  <button onClick={() => handleAction("trash", currentSelected.email.id)} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-sm" title="Trash (#)">Trash</button>
                </div>
              </div>

              {loadingBody ? (
                <div className="text-gray-500">Loading...</div>
              ) : (
                <div className="prose prose-invert max-w-none">
                  <pre className="whitespace-pre-wrap text-sm text-gray-300 font-sans bg-gray-900/50 rounded-lg p-4 border border-gray-800">
                    {emailBody}
                  </pre>
                </div>
              )}

              {/* AI Draft Panel */}
              <div className="mt-6 border border-gray-800 rounded-lg p-4 bg-gray-900/50">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    ✨ AI Reply
                    <button
                      onClick={handleAIDraft}
                      disabled={drafting}
                      className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 rounded text-xs text-white disabled:opacity-50"
                    >
                      {drafting ? "Drafting..." : "Generate Draft"}
                    </button>
                  </h3>
                  <button
                    onClick={handleSend}
                    disabled={sending || !draftText.trim()}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm text-white disabled:opacity-50"
                  >
                    {sending ? "Sending..." : "Send Reply (⏎)"}
                  </button>
                </div>
                <textarea
                  id="draft-panel"
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder="Click 'Generate Draft' for AI reply, or type your reply here..."
                  className="w-full h-32 bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 focus:outline-none focus:border-emerald-500 resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      handleSend();
                    }
                  }}
                />
                <div className="text-xs text-gray-500 mt-1">⌘+Enter to send</div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <div className="text-4xl mb-2">👈</div>
                <p>Select an email to read</p>
                <p className="text-xs mt-2">Use J/K to navigate, E to archive, R to reply, / to search</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Keyboard hint toast */}
      {keyboardHint && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-300 shadow-lg">
          {keyboardHint}
        </div>
      )}

      {/* Action result toast */}
      {actionResult && (
        <div className="fixed bottom-4 right-4 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm shadow-lg">
          {actionResult}
        </div>
      )}

      {/* Keyboard shortcuts help */}
      <div className="border-t border-gray-800 bg-gray-900/30 px-4 py-2 text-xs text-gray-600 flex gap-4 overflow-x-auto">
        <span><kbd className="bg-gray-800 px-1 rounded">J/K</kbd> Navigate</span>
        <span><kbd className="bg-gray-800 px-1 rounded">E</kbd> Archive</span>
        <span><kbd className="bg-gray-800 px-1 rounded">U</kbd> Mark read/unread</span>
        <span><kbd className="bg-gray-800 px-1 rounded">S</kbd> Star</span>
        <span><kbd className="bg-gray-800 px-1 rounded">R</kbd> Reply</span>
        <span><kbd className="bg-gray-800 px-1 rounded">#</kbd> Trash</span>
        <span><kbd className="bg-gray-800 px-1 rounded">/</kbd> Search</span>
        <span><kbd className="bg-gray-800 px-1 rounded">Esc</kbd> Deselect</span>
      </div>
    </div>
  );
}
