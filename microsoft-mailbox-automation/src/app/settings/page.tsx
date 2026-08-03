"use client";

import { useState, useEffect } from "react";
import { AppConfig } from "@/types";
import { normalizeOrigin } from "@/lib/utils";

export default function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gmailServerConfigured, setGmailServerConfigured] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [azureServerConfigured, setAzureServerConfigured] = useState(false);

  useEffect(() => {
    fetchConfig();
    // Check server-side Gmail config
    fetch("/api/gmail/config")
      .then((r) => r.text())
      .then((text) => { if (text) { const data = JSON.parse(text); setGmailServerConfigured(!!data.configured); } })
      .catch(() => {});
    // Check localStorage for Gmail connection state
    const local = localStorage.getItem("gmail-config");
    if (local) {
      try {
        const parsed = JSON.parse(local);
        setGmailConnected(!!parsed.refreshToken);
      } catch {}
    }
    // Check server-side Azure config
    setAzureServerConfigured(
      !!(process.env.NEXT_PUBLIC_AZURE_CLIENT_ID && process.env.NEXT_PUBLIC_AZURE_TENANT_ID)
    );
    // Also check via fetch to avoid env var exposure issues
    fetch("/api/azure/config")
      .then((r) => r.text())
      .then((text) => { if (text) { const data = JSON.parse(text); setAzureServerConfigured(!!data.configured); } })
      .catch(() => {
        // If endpoint doesn't exist yet, check config file
        if (config?.graph?.clientId && config?.graph?.clientSecret) {
          setAzureServerConfigured(true);
        }
      });
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config");
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      setConfig(data);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleSave = async () => {
    if (!config) return;
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
      const data = text ? JSON.parse(text) : {};
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
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setError(data.error || "Gmail is not configured on the server.");
        return;
      }
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!config) {
    return <p className="text-sm text-muted-foreground">Loading configuration...</p>;
  }

  return (
    <div className="container mx-auto max-w-3xl space-y-8 px-6 py-8">
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure processing options and manage email connections
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <strong>Error:</strong> {error}
          <button onClick={() => setError(null)} className="ml-2 text-destructive/70 hover:text-destructive">
            dismiss
          </button>
        </div>
      )}

      {message && (
        <div className="rounded-lg border border-green-500/50 bg-green-500/10 p-4 text-sm text-green-700">
          {message}
        </div>
      )}

      {/* Email Connections */}
      <div className="card p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Email Connections</h3>
          <p className="text-sm text-muted-foreground">
            Connect your email accounts — no API keys needed, just click Connect
          </p>
        </div>

        {/* Gmail Connection */}
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                <path d="M3 5h18v14H3z" stroke="#ea4335" strokeWidth="1.5" />
                <path d="M3 5l9 7 9-7" stroke="#ea4335" strokeWidth="1.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium">Gmail</p>
              <p className="text-xs text-muted-foreground">
                {gmailConnected
                  ? "Connected — email sync is active"
                  : gmailServerConfigured
                  ? "Server configured — click Connect to authorize"
                  : "Not configured on server"}
              </p>
            </div>
          </div>
          {gmailConnected ? (
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
              Connected
            </span>
          ) : (
            <button
              onClick={handleConnectGmail}
              disabled={!gmailServerConfigured}
              className="btn btn-outline !h-9 text-sm"
            >
              Connect Gmail
            </button>
          )}
        </div>

        {/* Azure / Microsoft Graph Connection */}
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                <path d="M3 5h18v14H3z" stroke="#0078d4" strokeWidth="1.5" />
                <path d="M3 5l9 7 9-7" stroke="#0078d4" strokeWidth="1.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium">Microsoft 365 / Outlook</p>
              <p className="text-xs text-muted-foreground">
                {azureServerConfigured
                  ? "Server configured — click Connect to authorize"
                  : "Not configured on server"}
              </p>
            </div>
          </div>
          {azureServerConfigured ? (
            <button
              onClick={() => {
                window.location.href = "/login";
              }}
              className="btn btn-outline !h-9 text-sm"
            >
              Connect Microsoft
            </button>
          ) : (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
              Not configured
            </span>
          )}
        </div>
      </div>

      {/* LLM Settings */}
      <div className="card p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold">LLM Configuration</h3>
          <p className="text-sm text-muted-foreground">
            Configure the AI model used for scientific data extraction
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium">Provider</label>
            <select
              value={config.llm.provider}
              onChange={(e) =>
                setConfig({
                  ...config,
                  llm: { ...config.llm, provider: e.target.value as any },
                })
              }
              className="input mt-1"
            >
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama (Free, No API Key)</option>
              <option value="anthropic">Anthropic</option>
              <option value="azure">Azure OpenAI</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Model</label>
            <input
              type="text"
              value={config.llm.model}
              onChange={(e) =>
                setConfig({
                  ...config,
                  llm: { ...config.llm, model: e.target.value },
                })
              }
              className="input mt-1"
              placeholder="gpt-4o"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium">API Key</label>
            <input
              type="password"
              value={config.llm.apiKey}
              onChange={(e) =>
                setConfig({
                  ...config,
                  llm: { ...config.llm, apiKey: e.target.value },
                })
              }
              className="input mt-1"
              placeholder="sk-..."
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium">Custom Endpoint (optional)</label>
            <input
              type="text"
              value={config.llm.endpoint || ""}
              onChange={(e) =>
                setConfig({
                  ...config,
                  llm: { ...config.llm, endpoint: e.target.value },
                })
              }
              className="input mt-1"
              placeholder="https://api.openai.com/v1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              For Azure OpenAI or custom-compatible endpoints
            </p>
          </div>
        </div>
      </div>

      {/* Processing Settings */}
      <div className="card p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Processing Options</h3>
          <p className="text-sm text-muted-foreground">
            Control how emails are fetched and processed
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium">Max Emails Per Sync</label>
            <input
              type="number"
              value={config.processing.maxEmailsPerSync}
              onChange={(e) =>
                setConfig({
                  ...config,
                  processing: {
                    ...config.processing,
                    maxEmailsPerSync: parseInt(e.target.value) || 50,
                  },
                })
              }
              className="input mt-1"
              min={1}
              max={500}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Poll Interval (seconds)</label>
            <input
              type="number"
              value={config.processing.pollInterval}
              onChange={(e) =>
                setConfig({
                  ...config,
                  processing: {
                    ...config.processing,
                    pollInterval: parseInt(e.target.value) || 60,
                  },
                })
              }
              className="input mt-1"
              min={10}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium">Categories (comma-separated)</label>
            <input
              type="text"
              value={config.processing.categories.join(", ")}
              onChange={(e) =>
                setConfig({
                  ...config,
                  processing: {
                    ...config.processing,
                    categories: e.target.value.split(",").map((c) => c.trim()).filter(Boolean),
                  },
                })
              }
              className="input mt-1"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium">Extraction Prompt</label>
            <textarea
              value={config.processing.extractionPrompt}
              onChange={(e) =>
                setConfig({
                  ...config,
                  processing: {
                    ...config.processing,
                    extractionPrompt: e.target.value,
                  },
                })
              }
              className="input mt-1 min-h-[150px] font-mono text-xs"
            />
          </div>
        </div>
      </div>

      {/* Export Settings */}
      <div className="card p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Export Settings</h3>
          <p className="text-sm text-muted-foreground">
            Configure how extracted data is exported to spreadsheets
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium">Export Format</label>
            <select
              value={config.export.format}
              onChange={(e) =>
                setConfig({
                  ...config,
                  export: { ...config.export, format: e.target.value as any },
                })
              }
              className="input mt-1"
            >
              <option value="excel">Excel (.xlsx)</option>
              <option value="csv">CSV (.csv)</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Output Path</label>
            <input
              type="text"
              value={config.export.outputPath}
              onChange={(e) =>
                setConfig({
                  ...config,
                  export: { ...config.export, outputPath: e.target.value },
                })
              }
              className="input mt-1"
              placeholder="./exports"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button onClick={fetchConfig} className="btn btn-outline">
          Reset
        </button>
        <button onClick={handleSave} disabled={saving} className="btn btn-primary">
          {saving ? "Saving..." : "Save Configuration"}
        </button>
      </div>
    </div>
  );
}
