"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Brain, ArrowRight, Building2, Shield, Activity } from "lucide-react";

export default function GileadLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("joseph.martinez@gilead.com");
  const [password, setPassword] = useState("foundry2026");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Ensure the Gilead demo org and data exist
      await fetch("/api/demo/gilead-seed", { method: "POST" });

      // Try login first
      let res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgSlug: "gilead", email, password }),
      });

      let data = await res.json();

      // If credentials are invalid, try registering the demo user
      if (!res.ok && data.error === "Invalid credentials") {
        const demoUsers: Record<string, { name: string; role: string; therapeuticArea?: string }> = {
          "joseph.martinez@gilead.com": { name: "Joseph Martinez", role: "field_rep", therapeuticArea: "HIV" },
          "sarah.chen@gilead.com": { name: "Sarah Chen", role: "field_rep", therapeuticArea: "Oncology" },
          "director@gilead.com": { name: "Michael Rodriguez", role: "director" },
          "admin@gilead.com": { name: "Anna Åsberg", role: "admin" },
        };

        const demoUser = demoUsers[email];
        if (demoUser) {
          // Register the demo user
          const regRes = await fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orgSlug: "gilead",
              orgName: "Gilead Sciences",
              email,
              password,
              name: demoUser.name,
              role: demoUser.role,
              therapeuticArea: demoUser.therapeuticArea,
            }),
          });

          if (regRes.ok) {
            // Now login
            res = await fetch("/api/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orgSlug: "gilead", email, password }),
            });
            data = await res.json();
          }
        }
      }

      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }

      router.push("/today");
    } catch (e: any) {
      setError(e.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Aurora background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-96 w-[600px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute top-20 right-10 h-72 w-72 rounded-full bg-accent/15 blur-[100px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-12">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary">
            <Building2 className="h-3 w-3" />
            Gilead Sciences — Evidence-Governed Implementation Science Network
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            SPINOR-Gilead Implementation Science OS
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Discover, falsify, replicate, and automate approved operational methods — while preserving medical truth, functional boundaries, and health-equity constraints.
          </p>
        </div>

        {/* Login card */}
        <div className="w-full max-w-md">
          <div className="glass-card p-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Gilead Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input w-full"
                  placeholder="your.name@gilead.com"
                  required
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input w-full"
                  required
                />
              </div>

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary w-full"
              >
                {loading ? "Signing in..." : "Sign In"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </button>
            </form>

            {/* Demo credentials hint */}
            <div className="mt-6 border-t border-border/50 pt-4">
              <p className="text-xs font-medium text-muted-foreground">Demo Accounts:</p>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground/80">
                <button
                  onClick={() => { setEmail("joseph.martinez@gilead.com"); setPassword("foundry2026"); }}
                  className="block w-full text-left hover:text-foreground"
                >
                  joseph.martinez@gilead.com — HIV Field Rep
                </button>
                <button
                  onClick={() => { setEmail("sarah.chen@gilead.com"); setPassword("foundry2026"); }}
                  className="block w-full text-left hover:text-foreground"
                >
                  sarah.chen@gilead.com — Oncology Field Rep
                </button>
                <button
                  onClick={() => { setEmail("director@gilead.com"); setPassword("foundry2026"); }}
                  className="block w-full text-left hover:text-foreground"
                >
                  director@gilead.com — Regional Director
                </button>
                <button
                  onClick={() => { setEmail("admin@gilead.com"); setPassword("foundry2026"); }}
                  className="block w-full text-left hover:text-foreground"
                >
                  admin@gilead.com — Admin (Anna Åsberg)
                </button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground/60">
                Password for all demo accounts: foundry2026
              </p>
            </div>
          </div>
        </div>

        {/* Feature highlights */}
        <div className="mt-8 grid grid-cols-3 gap-4 text-center">
          <div className="flex flex-col items-center gap-1">
            <Mic className="h-5 w-5 text-primary" />
            <span className="text-xs text-muted-foreground">Evidence Capture</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Brain className="h-5 w-5 text-primary" />
            <span className="text-xs text-muted-foreground">Barrier Genome</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Shield className="h-5 w-5 text-primary" />
            <span className="text-xs text-muted-foreground">Compliance-Native</span>
          </div>
        </div>
      </div>
    </div>
  );
}
