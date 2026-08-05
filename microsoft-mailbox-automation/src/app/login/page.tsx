"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { normalizeOrigin, safeJson } from "@/lib/utils";

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
        const data = text ? safeJson(text) : {};
        if (data.configured) {
          setServerConfigured(true);
          setClientId(data.clientId || "");
          setTenantId(data.tenantId || "common");
          setChecking(false);
          return;
        }
      } catch (e) { console.error("[login] error:", e); }

      // Fall back to localStorage (for backward compat)
      const local = localStorage.getItem("azure-ad-config");
      if (local) {
        try {
          const p = JSON.parse(local);
          if (p.clientId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.clientId)) {
            setClientId(p.clientId);
            setTenantId(p.tenantId || "common");
            setServerConfigured(true);
          }
        } catch (e) { console.error("[login] error:", e); }
      }
      setChecking(false);
    })();
  }, []);

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isValidClientId = clientId && UUID_REGEX.test(clientId);
  const isValidTenantId = tenantId && (tenantId === "common" || UUID_REGEX.test(tenantId));
  const hasConfig = serverConfigured && !!isValidClientId && !!isValidTenantId;

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-indigo-50/30">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-500"></div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 px-4 py-8">
      <div className="pointer-events-none absolute top-0 left-1/2 h-[400px] w-[600px] -translate-x-1/2 rounded-full bg-indigo-500/10 blur-[120px]"></div>
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 text-2xl font-bold text-white shadow-lg shadow-indigo-500/25">M</div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sign in to Microsoft</h1>
          <p className="mt-1 text-center text-sm text-slate-500">Mailbox & OneDrive access for scientific data extraction</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-xl backdrop-blur-xl">
          {error && (
            <div className="mb-4 animate-fade-in rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 break-words">
              {error}
            </div>
          )}

          {hasConfig ? (
            <div>
              <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                <p className="font-semibold text-emerald-900">✓ Microsoft 365 is configured</p>
                <p className="mt-1">Click below to sign in with your Microsoft account. No setup required.</p>
              </div>
              <button onClick={login} disabled={loading} className="flex w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-[#0078d4] to-[#00a4ef] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100">
                {loading ? (
                  <>
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
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
                <span className="text-xs text-slate-400"><code>{clientId.substring(0, 8)}...{clientId.slice(-4)}</code></span>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
                <p className="font-semibold text-amber-900">Microsoft 365 is not configured</p>
                <p className="mt-1">Ask your administrator to set <code className="rounded bg-amber-100 px-1">AZURE_CLIENT_ID</code>, <code className="rounded bg-amber-100 px-1">AZURE_TENANT_ID</code>, and <code className="rounded bg-amber-100 px-1">AZURE_CLIENT_SECRET</code> environment variables on the server.</p>
              </div>
              <button onClick={() => { window.location.href = "/dashboard"; }} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                Back to Dashboard
              </button>
            </div>
          )}

          <div className="mt-5 flex flex-wrap justify-center gap-1.5">
            {["Mail.Read", "Mail.ReadWrite", "Files.Read", "Files.ReadWrite", "User.Read"].map((s) => (
              <span key={s} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-500">{s}</span>
            ))}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">You will be redirected to Microsoft to sign in securely.</p>
      </div>
    </div>
  );
}
