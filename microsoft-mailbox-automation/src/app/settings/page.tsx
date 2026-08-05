"use client";

import { useState, useEffect } from "react";
import { AppConfig } from "@/types";
import { normalizeOrigin, safeJson } from "@/lib/utils";
import { MicrosoftLogin } from "@/components/MicrosoftLogin";

export default function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gmailServerConfigured, setGmailServerConfigured] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [azureServerConfigured, setAzureServerConfigured] = useState(false);
  const [imapConfigured, setImapConfigured] = useState(false);
  const [imapEmail, setImapEmail] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [imapHost, setImapHost] = useState("outlook.office365.com");
  const [imapConnecting, setImapConnecting] = useState(false);
  const [imapConnected, setImapConnected] = useState(false);
  const [msLoginOpen, setMsLoginOpen] = useState(false);
  const [msConnected, setMsConnected] = useState(false);
  const [msUser, setMsUser] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    fetchConfig();
    // Check server-side Gmail config
    fetch("/api/gmail/config")
      .then((r) => r.text())
      .then((text) => { if (text) { const data = safeJson(text); setGmailServerConfigured(!!data?.configured); } })
      .catch((e) => { console.error("[settings] error:", e); });
    // Check localStorage for Gmail connection state
    const local = localStorage.getItem("gmail-config");
    if (local) {
      try {
        const parsed = JSON.parse(local);
        setGmailConnected(!!parsed.refreshToken);
      } catch (e) { console.error("[settings] error:", e); }
    }
    // Check server-side Azure config
    setAzureServerConfigured(
      !!(process.env.NEXT_PUBLIC_AZURE_CLIENT_ID && process.env.NEXT_PUBLIC_AZURE_TENANT_ID)
    );
    fetch("/api/azure/config")
      .then((r) => r.text())
      .then((text) => { if (text) { const data = safeJson(text); setAzureServerConfigured(!!data?.configured); } })
      .catch((e) => {
        console.error("[settings] error:", e);
        if (config?.graph?.clientId && config?.graph?.clientSecret) {
          setAzureServerConfigured(true);
        }
      });
    // Check IMAP config
    fetch("/api/imap/config")
      .then((r) => r.text())
      .then((text) => { if (text) { const data = safeJson(text); setImapConfigured(!!data?.configured); setImapEmail(data?.email || ""); setImapHost(data?.host || "outlook.office365.com"); } })
      .catch((e) => { console.error("[settings] error:", e); });
    // Check localStorage for IMAP connection state
    const imapLocal = localStorage.getItem("imap-config");
    if (imapLocal) {
      try {
        const parsed = JSON.parse(imapLocal);
        if (parsed.email && parsed.password) {
          setImapConnected(true);
          setImapEmail(parsed.email);
          setImapHost(parsed.host || "outlook.office365.com");
        }
      } catch (e) { console.error("[settings] error:", e); }
    }
    // Check Microsoft connection state
    const msLocal = localStorage.getItem("microsoft-config");
    if (msLocal) {
      try {
        const parsed = JSON.parse(msLocal);
        if (parsed.token) {
          setMsConnected(true);
          setMsUser({ name: parsed.name || "User", email: parsed.email || "" });
        }
      } catch (e) { console.error("[settings] error:", e); }
    }
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config");
      const text = await res.text();
      const data = text ? safeJson(text) : {};
      setConfig(data);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    if (config.graph?.clientId && config.graph.clientId.length !== 36) {
      setError("Client ID must be a 36-character UUID-like string.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const text = await res.text();
      const data = text ? safeJson(text) : {};
      if (!res.ok) {
        setError(data.error || "Failed to save");
      } else {
        setMessage("Configuration saved successfully");
        fetchConfig();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleConnectGmail = async () => {
    try {
      const res = await fetch("/api/gmail/auth");
      const text = await res.text();
      const data = text ? safeJson(text) : {};
      if (!res.ok) {
        setError(data.error || "Gmail is not configured on the server.");
        return;
      }
      if (data.authUrl) {
        // If the auth URL uses a different redirect URI (e.g. Netlify for Google OAuth),
        // open in a popup and poll for the code in the callback URL
        const authUrl = data.authUrl as string;
        const urlObj = new URL(authUrl);
        const redirectUri = urlObj.searchParams.get("redirect_uri") || "";
        const currentOrigin = window.location.origin;

        if (redirectUri && !redirectUri.startsWith(currentOrigin)) {
          // OAuth redirect URI is on a different domain (e.g. Netlify)
          // Open popup and intercept the code from the callback URL
          const popup = window.open(authUrl, "gmail-oauth", "width=500,height=650");
          if (!popup) {
            setError("Popup blocked. Please allow popups for this site.");
            return;
          }
          setConnecting(true);
          const poll = setInterval(() => {
            try {
              const popupUrl = popup.location.href;
              // Check if the popup reached the callback or connect page with a code
              if (popupUrl.includes("code=")) {
                const code = new URL(popupUrl).searchParams.get("code");
                if (code) {
                  clearInterval(poll);
                  popup.close();
                  // Exchange the code on our server using the registered redirect URI
                  exchangeGmailCode(code, redirectUri);
                }
              }
              if (popupUrl.includes("gmail_connected=true")) {
                clearInterval(poll);
                popup.close();
                // Token was already stored on the other domain; try to get it from URL
                const code = new URL(popupUrl).searchParams.get("code");
                if (code) {
                  exchangeGmailCode(code, redirectUri);
                } else {
                  setError("Gmail connected on the redirect domain. Please close this popup and try syncing.");
                  setConnecting(false);
                }
              }
            } catch (e) {
              // Cross-origin: can't read popup URL until it redirects to our domain or the redirect domain
              // Try checking if popup was closed by user
              if (popup.closed) {
                clearInterval(poll);
                setConnecting(false);
              }
            }
          }, 500);
          // Timeout after 2 minutes
          setTimeout(() => {
            clearInterval(poll);
            if (!popup.closed) popup.close();
            setConnecting(false);
          }, 120000);
        } else {
          // Same-domain redirect URI — navigate directly
          window.location.href = authUrl;
        }
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const exchangeGmailCode = async (code: string, redirectUri: string) => {
    setConnecting(true);
    try {
      const exchangeRes = await fetch("/api/gmail/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, redirectUri }),
      });
      const exchangeText = await exchangeRes.text();
      const exchangeData = exchangeText ? safeJson(exchangeText) : {};

      if (exchangeRes.ok && exchangeData.refreshToken) {
        let clientId = "";
        try {
          const cfgRes = await fetch("/api/gmail/config");
          const cfgText = await cfgRes.text();
          const cfgData = cfgText ? safeJson(cfgText) : {};
          clientId = cfgData?.clientId || "";
        } catch (e) { console.error("[settings] error:", e); }

        const gmailConfig: Record<string, string> = {
          clientId,
          refreshToken: exchangeData.refreshToken,
          accessToken: exchangeData.accessToken || "",
        };
        localStorage.setItem("gmail-config", JSON.stringify(gmailConfig));
        setGmailConnected(true);
        setMessage("Gmail connected successfully!");
      } else {
        setError(exchangeData.error || "Token exchange failed.");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleMsConnected = (data: { token: string; refreshToken: string; name: string; email: string }) => {
    localStorage.setItem("microsoft-config", JSON.stringify(data));
    setMsConnected(true);
    setMsUser({ name: data.name, email: data.email });
    setMsLoginOpen(false);
    setMessage(`Connected to Microsoft 365 as ${data.name} (${data.email})`);
  };

  const handleConnectImap = async () => {
    if (!imapEmail || !imapPassword) {
      setError("Enter your Outlook email and app password");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(imapEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!imapHost || !imapHost.includes(".")) {
      setError("IMAP host must be a valid hostname (e.g. outlook.office365.com).");
      return;
    }
    setImapConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/imap/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: imapEmail, password: imapPassword, host: imapHost }),
      });
      const text = await res.text();
      const data = text ? safeJson(text) : {};
      if (!data && text) { setError("Received invalid response from server"); return; }
      if (!res.ok || !data.success) {
        setError(data.error || "IMAP connection failed");
        return;
      }
      // Save to localStorage for client-side state
      localStorage.setItem("imap-config", JSON.stringify({
        email: imapEmail,
        password: imapPassword,
        host: imapHost,
      }));
      setImapConnected(true);
      setMessage(`Connected to ${imapEmail} — ${data.totalMessages} messages in inbox`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImapConnecting(false);
    }
  };

  if (!config) {
    return (
      <div className="container mx-auto flex min-h-[40vh] max-w-3xl items-center justify-center px-6 py-8">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-500"></div>
          <p className="text-sm text-slate-500">Loading configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Settings</h2>
        <p className="mt-1 text-sm text-slate-500">
          Configure processing options and manage email connections
        </p>
      </div>

      {error && (
        <div className="animate-fade-in rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="flex items-start gap-2">
            <svg className="h-5 w-5 flex-shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <div className="flex-1"><strong>Error:</strong> {error}</div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}

      {message && (
        <div className="animate-fade-in rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><polyline points="20 6 9 17 4 12" /></svg>
            {message}
          </div>
        </div>
      )}

      {/* Email Connections */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Email Connections</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Connect your email accounts — no API keys needed, just click Connect
          </p>
        </div>

        {/* Gmail Connection */}
        <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4 transition-all hover:border-slate-300">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                <path d="M3 5h18v14H3z" stroke="#ea4335" strokeWidth="1.5" />
                <path d="M3 5l9 7 9-7" stroke="#ea4335" strokeWidth="1.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Gmail</p>
              <p className="text-xs text-slate-500">
                {gmailConnected
                  ? "Connected — email sync is active"
                  : gmailServerConfigured
                  ? "Server configured — click Connect to authorize"
                  : "Not configured on server"}
              </p>
            </div>
          </div>
          {gmailConnected ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
              Connected
            </span>
          ) : (
            <button
              onClick={handleConnectGmail}
              disabled={!gmailServerConfigured || connecting}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {connecting ? "Connecting..." : "Connect Gmail"}
            </button>
          )}
        </div>

        {/* Microsoft 365 / Outlook — Popup Login */}
        <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4 transition-all hover:border-slate-300">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <svg className="h-5 w-5" viewBox="0 0 23 23" fill="none">
                <path fill="#f25022" d="M1 1h10v10H1z" />
                <path fill="#7fba00" d="M12 1h10v10H12z" />
                <path fill="#00a4ef" d="M1 12h10v10H1z" />
                <path fill="#ffb900" d="M12 12h10v10H12z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Microsoft 365 / Outlook</p>
              <p className="text-xs text-slate-500">
                {msConnected
                  ? `Connected as ${msUser?.name} (${msUser?.email})`
                  : "Click Connect to sign in with your Microsoft account"}
              </p>
            </div>
          </div>
          {msConnected ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                Connected
              </span>
              <button
                onClick={() => {
                  localStorage.removeItem("microsoft-config");
                  setMsConnected(false);
                  setMsUser(null);
                  setMessage("Microsoft 365 disconnected");
                }}
                className="text-xs text-slate-400 hover:text-red-500"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={() => setMsLoginOpen(true)}
              className="rounded-lg bg-[#0078d4] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#106ebe]"
            >
              Connect Microsoft
            </button>
          )}
        </div>
      </div>

      {/* LLM Settings */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900">LLM Configuration</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Configure the AI model used for scientific data extraction
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-slate-600">Provider</label>
            <select
              value={config.llm.provider}
              onChange={(e) => setConfig({ ...config, llm: { ...config.llm, provider: e.target.value as any } })}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama (Free, No API Key)</option>
              <option value="anthropic">Anthropic</option>
              <option value="azure">Azure OpenAI</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Model</label>
            <input
              type="text"
              value={config.llm.model}
              onChange={(e) => setConfig({ ...config, llm: { ...config.llm, model: e.target.value } })}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              placeholder="gpt-4o"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-slate-600">API Key</label>
            <input
              type="password"
              value={config.llm.apiKey}
              onChange={(e) => setConfig({ ...config, llm: { ...config.llm, apiKey: e.target.value } })}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              placeholder="sk-..."
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-slate-600">Custom Endpoint (optional)</label>
            <input
              type="text"
              value={config.llm.endpoint || ""}
              onChange={(e) => setConfig({ ...config, llm: { ...config.llm, endpoint: e.target.value } })}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              placeholder="https://api.openai.com/v1"
            />
            <p className="mt-1 text-xs text-slate-400">
              For Azure OpenAI or custom-compatible endpoints
            </p>
          </div>
        </div>
      </div>

      {/* Processing Settings */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Processing Options</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Control how emails are fetched and processed
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-slate-600">Max Emails Per Sync</label>
            <input
              type="number"
              value={config.processing.maxEmailsPerSync}
              onChange={(e) => setConfig({ ...config, processing: { ...config.processing, maxEmailsPerSync: parseInt(e.target.value) || 50 } })}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              min={1}
              max={500}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Poll Interval (seconds)</label>
            <input
              type="number"
              value={config.processing.pollInterval}
              onChange={(e) => setConfig({ ...config, processing: { ...config.processing, pollInterval: parseInt(e.target.value) || 60 } })}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              min={10}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-slate-600">Categories (comma-separated)</label>
            <input
              type="text"
              value={config.processing.categories.join(", ")}
              onChange={(e) => setConfig({ ...config, processing: { ...config.processing, categories: e.target.value.split(",").map((c) => c.trim()).filter(Boolean) } })}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-slate-600">Extraction Prompt</label>
            <textarea
              value={config.processing.extractionPrompt}
              onChange={(e) => setConfig({ ...config, processing: { ...config.processing, extractionPrompt: e.target.value } })}
              className="mt-1 min-h-[150px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>
      </div>

      {/* Export Settings */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Export Settings</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Configure how extracted data is exported to spreadsheets
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-slate-600">Export Format</label>
            <select
              value={config.export.format}
              onChange={(e) => setConfig({ ...config, export: { ...config.export, format: e.target.value as any } })}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              <option value="excel">Excel (.xlsx)</option>
              <option value="csv">CSV (.csv)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Output Path</label>
            <input
              type="text"
              value={config.export.outputPath}
              onChange={(e) => setConfig({ ...config, export: { ...config.export, outputPath: e.target.value } })}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              placeholder="./exports"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button onClick={fetchConfig} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
          Reset
        </button>
        <button onClick={handleSave} disabled={saving} className="inline-flex h-10 items-center justify-center rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100">
          {saving ? "Saving..." : "Save Configuration"}
        </button>
      </div>

      {msLoginOpen && (
        <MicrosoftLogin
          onConnected={handleMsConnected}
          onClose={() => setMsLoginOpen(false)}
        />
      )}
    </div>
  );
}
