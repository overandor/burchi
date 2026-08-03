"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { normalizeOrigin } from "@/lib/utils";

export default function LoginPage() {
  const { login, loading, error } = useAuth();
  const [serverConfigured, setServerConfigured] = useState(false);
  const [clientId, setClientId] = useState("");
  const [tenantId, setTenantId] = useState("common");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      // Check server-side Azure config first
      try {
        const res = await fetch("/api/azure/config");
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (data.configured) {
          setServerConfigured(true);
          setClientId(data.clientId || "");
          setTenantId(data.tenantId || "common");
          setChecking(false);
          return;
        }
      } catch {}

      // Fall back to localStorage (for backward compat)
      const local = localStorage.getItem("azure-ad-config");
      if (local) {
        try {
          const p = JSON.parse(local);
          if (p.clientId && p.clientId.length >= 36) {
            setClientId(p.clientId);
            setTenantId(p.tenantId || "common");
            setServerConfigured(true);
          }
        } catch {}
      }
      setChecking(false);
    })();
  }, []);

  const hasConfig = serverConfigured && clientId && clientId.length >= 36;

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
        <svg className="h-10 w-10 animate-spin text-[#0078d4]" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-lg bg-[#0078d4] text-2xl font-bold text-white">M</div>
          <h1 className="text-2xl font-semibold text-gray-900">Sign in to Microsoft</h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">Mailbox & OneDrive access for scientific data extraction</p>
        </div>

        <div className="card p-6 shadow-lg">
          {error && (
            <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive break-words">
              {error}
            </div>
          )}

          {hasConfig ? (
            <div>
              <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800">
                <p className="font-medium text-green-900">✓ Microsoft 365 is configured</p>
                <p className="mt-1">Click below to sign in with your Microsoft account. No setup required.</p>
              </div>
              <button onClick={login} disabled={loading} className="flex w-full items-center justify-center gap-3 rounded-md bg-[#0078d4] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#106ebe] disabled:opacity-50">
                {loading ? (
                  <>
                    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Redirecting...
                  </>
                ) : (
                  <>
                    <svg className="h-5 w-5" viewBox="0 0 23 23" fill="none"><path fill="#f25022" d="M1 1h10v10H1z" /><path fill="#7fba00" d="M12 1h10v10H12z" /><path fill="#00a4ef" d="M1 12h10v10H1z" /><path fill="#ffb900" d="M12 12h10v10H12z" /></svg>
                    Sign in with Microsoft
                  </>
                )}
              </button>
              <div className="mt-3 flex items-center justify-center rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-xs text-muted-foreground"><code>{clientId.substring(0, 8)}...{clientId.slice(-4)}</code></span>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
                <p className="font-medium text-amber-900">Microsoft 365 is not configured</p>
                <p className="mt-1">Ask your administrator to set <code className="rounded bg-amber-100 px-1">AZURE_CLIENT_ID</code>, <code className="rounded bg-amber-100 px-1">AZURE_TENANT_ID</code>, and <code className="rounded bg-amber-100 px-1">AZURE_CLIENT_SECRET</code> environment variables on the server.</p>
              </div>
              <button onClick={() => { window.location.href = "/"; }} className="btn btn-outline !h-10 text-sm">
                Back to Dashboard
              </button>
            </div>
          )}

          <div className="mt-5 flex flex-wrap justify-center gap-1.5">
            {["Mail.Read", "Mail.ReadWrite", "Files.Read", "Files.ReadWrite", "User.Read"].map((s) => (
              <span key={s} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{s}</span>
            ))}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">You will be redirected to Microsoft to sign in securely.</p>
      </div>
    </div>
  );
}
