"use client";

import { useCallback, useEffect, useState } from "react";
import { StatusBar } from "@/components/registrar/StatusBar";
import { Overview } from "@/components/registrar/Overview";
import { Automation } from "@/components/registrar/Automation";
import { PlatformGrid } from "@/components/registrar/PlatformGrid";
import { CredentialVault } from "@/components/registrar/CredentialVault";
import { RotationCenter } from "@/components/registrar/RotationCenter";
import { SessionManager } from "@/components/registrar/SessionManager";
import { AuditTimeline } from "@/components/registrar/AuditTimeline";
import { SecurityCenter } from "@/components/registrar/SecurityCenter";
import { Settings } from "@/components/registrar/Settings";
import type { ViewKey, StatusResponse, ApiKey, KeyPlatform, Credential, AuditEntry, SessionInfo } from "@/components/registrar/types";

interface IdentityProfile {
  email: string;
  firstName: string;
  lastName: string;
  usernameStem: string;
  phone?: string;
  birthdate?: string;
  needs: string[];
}

const NAV_ITEMS: { key: ViewKey; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "◉" },
  { key: "automation", label: "Automation", icon: "⟳" },
  { key: "platforms", label: "Platforms", icon: "▦" },
  { key: "credentials", label: "Credentials", icon: "⚿" },
  { key: "rotations", label: "Rotations", icon: "↻" },
  { key: "sessions", label: "Sessions", icon: "⇄" },
  { key: "audit", label: "Audit", icon: "≡" },
  { key: "security", label: "Security", icon: "◈" },
  { key: "settings", label: "Settings", icon: "⚙" },
];

export default function RegistrarPage() {
  const [view, setView] = useState<ViewKey>("overview");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [keyPlatforms, setKeyPlatforms] = useState<KeyPlatform[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [identity, setIdentity] = useState<IdentityProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [statusRes, keysRes, vaultRes, auditRes, sessionsRes] = await Promise.all([
        fetch("/api/registrar/status").then((r) => r.json()),
        fetch("/api/registrar/keys").then((r) => r.json()),
        fetch("/api/registrar/vault").then((r) => r.json()),
        fetch("/api/registrar/audit").then((r) => r.json()),
        fetch("/api/registrar/sessions").then((r) => r.json()),
      ]);
      setStatus(statusRes);
      setKeys(keysRes.keys || []);
      setKeyPlatforms(keysRes.platforms || []);
      setCredentials(vaultRes.credentials || []);
      setIdentity(vaultRes.identity || null);
      setAudit(auditRes.entries || []);
      setSessions(sessionsRes.sessions || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000); // live polling
    return () => clearInterval(interval);
  }, [refresh]);

  const rotateKey = async (platformId: string) => {
    setRotating(true);
    setError(null);
    try {
      const res = await fetch("/api/registrar/keys/rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "rotation failed");
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRotating(false);
    }
  };

  const deleteKey = async (platformId: string) => {
    try {
      await fetch(`/api/registrar/keys?platformId=${platformId}`, { method: "DELETE" });
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const destroySession = async (scopeId: string) => {
    try {
      await fetch(`/api/registrar/sessions?scopeId=${scopeId}`, { method: "DELETE" });
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const saveIdentity = async (profile: Partial<IdentityProfile>) => {
    const res = await fetch("/api/registrar/vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "save failed");
    await refresh();
  };

  return (
    <div className="cockpit-bg min-h-screen -mx-4 -my-6 sm:-mx-6 px-4 sm:px-6 py-6">
      <div className="flex gap-4">
        {/* Left Navigation Rail */}
        <nav className="sticky top-6 hidden h-[calc(100vh-3rem)] w-48 shrink-0 flex-col md:flex">
          <div className="cockpit-panel flex h-full flex-col rounded-xl p-2">
            <div className="px-3 py-3 mb-1">
              <div className="text-sm font-bold cockpit-text tracking-tight">Credential</div>
              <div className="text-sm font-bold cockpit-text tracking-tight">Operations</div>
            </div>
            <div className="h-px cockpit-border mb-2" />
            <div className="flex flex-1 flex-col gap-0.5">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setView(item.key)}
                  className={`nav-rail-item flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left ${
                    view === item.key ? "nav-rail-item-active" : "cockpit-text-dim hover:cockpit-text hover:bg-[hsl(var(--cockpit-elevated) / 0.5)]"
                  }`}
                >
                  <span className="text-base leading-none">{item.icon}</span>
                  <span className="font-medium">{item.label}</span>
                </button>
              ))}
            </div>
            <div className="h-px cockpit-border my-2" />
            <div className="flex flex-col gap-0.5">
              <button className="nav-rail-item flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm cockpit-text-dim hover:cockpit-text">
                <span className="text-base leading-none">⊕</span>
                <span className="font-medium">System Health</span>
              </button>
              <button className="nav-rail-item flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm cockpit-text-dim hover:cockpit-text">
                <span className="text-base leading-none">⊕</span>
                <span className="font-medium">Documentation</span>
              </button>
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* Status Bar */}
          <StatusBar status={status} loading={loading} />

          {/* Error */}
          {error && (
            <div className="chip-critical rounded-lg px-4 py-3 text-sm">
              <span className="font-mono-tech">ERROR:</span> {error}
            </div>
          )}

          {/* Mobile Nav */}
          <div className="md:hidden">
            <select
              value={view}
              onChange={(e) => setView(e.target.value as ViewKey)}
              className="w-full rounded-lg cockpit-panel border cockpit-border px-3 py-2 text-sm cockpit-text"
            >
              {NAV_ITEMS.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
          </div>

          {/* Views */}
          {view === "overview" && (
            <Overview status={status} audit={audit} onNavigate={(v) => setView(v as ViewKey)} />
          )}
          {view === "automation" && (
            <Automation audit={audit} platformHealth={status?.platformHealth ?? []} />
          )}
          {view === "platforms" && (
            <PlatformGrid
              platforms={keyPlatforms}
              platformHealth={status?.platformHealth ?? []}
              keys={keys}
              onRotate={rotateKey}
              rotating={rotating}
            />
          )}
          {view === "credentials" && (
            <CredentialVault keys={keys} credentials={credentials} onDeleteKey={deleteKey} />
          )}
          {view === "rotations" && (
            <RotationCenter
              audit={audit}
              upcoming={status?.upcoming ?? []}
              onRotate={rotateKey}
              rotating={rotating}
            />
          )}
          {view === "sessions" && (
            <SessionManager sessions={sessions} onDestroy={destroySession} />
          )}
          {view === "audit" && <AuditTimeline audit={audit} />}
          {view === "security" && <SecurityCenter status={status} />}
          {view === "settings" && <Settings identity={identity} onSave={saveIdentity} />}
        </div>
      </div>
    </div>
  );
}
