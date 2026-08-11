"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { safeJson } from "@/lib/utils";

export default function LoginPage() {
  const { login, loading, error } = useAuth();
  const [serverConfigured, setServerConfigured] = useState(false);
  const [clientId, setClientId] = useState("");
  const [tenantId, setTenantId] = useState("common");
  const [checking, setChecking] = useState(true);

  // Local Foundry password auth
  const [mode, setMode] = useState<"login" | "register">("login");
  const [orgSlug, setOrgSlug] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState("");
  const [localSuccess, setLocalSuccess] = useState("");

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

  async function submitLocal(e: React.FormEvent) {
    e.preventDefault();
    setLocalError("");
    setLocalSuccess("");

    if (!orgSlug || !email || !password || (mode === "register" && !name)) {
      setLocalError("Please fill in all required fields");
      return;
    }

    setLocalLoading(true);
    try {
      if (mode === "login") {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgSlug, email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          setLocalError(data.error || "Login failed");
          return;
        }
        window.location.href = data.redirect || "/today";
        return;
      }

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgSlug,
          email,
          password,
          name,
          setupToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLocalError(data.error || "Registration failed");
        return;
      }
      setLocalSuccess("Account created. Sign in below.");
      setMode("login");
      setPassword("");
    } finally {
      setLocalLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary/20 border-t-primary"></div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-8">
      <div className="pointer-events-none absolute top-0 left-1/2 h-[400px] w-[600px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]"></div>
      <div className="pointer-events-none absolute bottom-0 right-1/4 h-[300px] w-[400px] rounded-full bg-accent/8 blur-[100px]"></div>
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-2xl font-bold text-white shadow-lg shadow-primary/25">F</div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Sign in to Foundry</h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">Voice-first mission execution with real authentication</p>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-card/80 p-6 shadow-xl backdrop-blur-xl">
          {error && (
            <div className="mb-4 animate-fade-in rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive break-words">
              {error}
            </div>
          )}

          {hasConfig && (
            <div className="mb-5">
              <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-400">
                <p className="font-semibold text-emerald-300">Microsoft 365 is configured</p>
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
              <div className="relative my-5 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/[0.06]"></div></div>
                <span className="relative bg-card px-2 text-xs text-muted-foreground">or</span>
              </div>
            </div>
          )}

          <form onSubmit={submitLocal} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Organization slug</label>
              <input
                type="text"
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value.toLowerCase().trim())}
                placeholder="foundry"
                className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                required
              />
            </div>
            {mode === "register" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Full name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jordan Rivera"
                  className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                  required
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@org.com"
                className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                required
                minLength={8}
              />
            </div>
            {mode === "register" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Setup token (optional for first user)</label>
                <input
                  type="text"
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                  placeholder="From FOUNDRY_SETUP_TOKEN"
                  className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                />
              </div>
            )}

            {localError && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                {localError}
              </div>
            )}
            {localSuccess && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-400">
                {localSuccess}
              </div>
            )}

            <button
              type="submit"
              disabled={localLoading}
              className="w-full rounded-xl bg-gradient-to-r from-primary to-accent px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-all hover:scale-[1.01] disabled:opacity-50 disabled:hover:scale-100"
            >
              {localLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></span>
                  {mode === "login" ? "Signing in..." : "Creating account..."}
                </span>
              ) : mode === "login" ? (
                "Sign in with Foundry"
              ) : (
                "Create account"
              )}
            </button>

            <div className="text-center text-xs text-muted-foreground">
              {mode === "login" ? (
                <>
                  Need an account?{" "}
                  <button type="button" onClick={() => setMode("register")} className="font-semibold text-primary hover:underline">
                    Register
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button type="button" onClick={() => setMode("login")} className="font-semibold text-primary hover:underline">
                    Sign in
                  </button>
                </>
              )}
            </div>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          {hasConfig
            ? "Sign in with Microsoft or your Foundry password."
            : "Sign in with your Foundry password. Ask an admin to configure Microsoft 365 for SSO."}
        </p>
      </div>
    </div>
  );
}
