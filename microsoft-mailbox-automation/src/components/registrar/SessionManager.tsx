"use client";

import { SessionInfo, relTime } from "./types";

interface Props {
  sessions: SessionInfo[];
  onDestroy: (scopeId: string) => void;
}

export function SessionManager({ sessions, onDestroy }: Props) {
  const active = sessions.filter((s) => !s.consumed);
  const consumed = sessions.filter((s) => s.consumed);

  return (
    <div className="view-enter space-y-4">
      <div>
        <h1 className="text-lg font-bold cockpit-text">Sessions</h1>
        <p className="text-sm cockpit-text-dim">
          {active.length} active · {consumed.length} consumed · all encrypted at rest
        </p>
      </div>

      {/* Session Flow Visualization */}
      <div className="cockpit-panel rounded-xl p-5">
        <h2 className="mb-4 text-sm font-semibold cockpit-text-dim">SESSION FLOW</h2>
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {["Signup / Auth", "Session Created", "Encrypted Transfer", "Rotator", "Platform"].map((stage, i) => (
            <div key={stage} className="flex items-center">
              <div className={`pipe-node rounded-lg border px-3 py-2 text-xs font-mono-tech ${
                i < 2 ? "pipe-node-healthy" : i === 2 ? "pipe-node-active" : "pipe-node-idle"
              }`}>
                {stage}
              </div>
              {i < 4 && <div className={`h-px w-4 sm:w-6 ${i < 2 ? "pipe-connector-active" : "bg-[hsl(var(--cockpit-border))]"}`} />}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs cockpit-text-dim">
          Sessions are encrypted during transfer and storage. Cookie values are never exposed in the UI.
        </p>
      </div>

      {/* Active Sessions */}
      <div className="cockpit-panel rounded-xl p-5">
        <h2 className="mb-3 text-sm font-semibold cockpit-text-dim">ACTIVE SESSIONS</h2>
        {active.length === 0 ? (
          <EmptyState title="No active sessions" subtitle="Sessions will appear here after successful registration." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {active.map((s) => (
              <SessionCard key={s.id} session={s} onDestroy={() => onDestroy(s.scopeId)} />
            ))}
          </div>
        )}
      </div>

      {/* Consumed Sessions */}
      {consumed.length > 0 && (
        <div className="cockpit-panel rounded-xl p-5">
          <h2 className="mb-3 text-sm font-semibold cockpit-text-dim">CONSUMED SESSIONS</h2>
          <div className="space-y-1.5">
            {consumed.slice(-10).map((s) => (
              <div key={s.id} className="flex items-center gap-3 text-xs">
                <span className="font-mono-tech cockpit-text-dim w-32 truncate">{s.scopeId}</span>
                <span className="cockpit-text-dim">{relTime(s.createdAt)}</span>
                <span className="chip-neutral rounded px-1.5 py-0.5 text-[10px] font-mono-tech">CONSUMED</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionCard({ session, onDestroy }: { session: SessionInfo; onDestroy: () => void }) {
  const now = Date.now();
  let expiringSoon = false;
  let expired = false;
  let minsLeft: number | null = null;

  if (session.expiresAt) {
    minsLeft = Math.round((new Date(session.expiresAt).getTime() - now) / 60000);
    expired = minsLeft < 0;
    expiringSoon = minsLeft >= 0 && minsLeft < 60;
  }

  const statusChip = expired ? "chip-critical" : expiringSoon ? "chip-warning" : "chip-healthy";
  const statusLabel = expired ? "EXPIRED" : expiringSoon ? "EXPIRING SOON" : "HEALTHY";

  return (
    <div className="cockpit-elevated card-lift rounded-lg p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold cockpit-text">{session.scopeId}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono-tech ${statusChip}`}>{statusLabel}</span>
      </div>
      <div className="mt-3 space-y-1.5 text-xs">
        <Row label="Origin" value={session.origin} mono />
        <Row label="Created" value={relTime(session.createdAt)} mono />
        <Row
          label="Expires"
          value={minsLeft !== null ? (expired ? "expired" : `${minsLeft}m remaining`) : "session cookie"}
          mono
          valueClass={expired ? "text-[hsl(var(--cockpit-critical))]" : expiringSoon ? "text-[hsl(var(--cockpit-warning))]" : "text-[hsl(var(--cockpit-healthy))]"}
        />
        <Row label="Encryption" value="AES-256-GCM" mono />
      </div>
      <button
        onClick={onDestroy}
        className="mt-3 w-full rounded border cockpit-border px-2 py-1.5 text-xs text-[hsl(var(--cockpit-critical) / 0.7)] hover:text-[hsl(var(--cockpit-critical))] hover:bg-[hsl(var(--cockpit-critical) / 0.05)]"
      >
        Destroy Session
      </button>
    </div>
  );
}

function Row({ label, value, mono, valueClass }: { label: string; value: string; mono?: boolean; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="cockpit-text-dim">{label}</span>
      <span className={`${mono ? "font-mono-tech" : ""} ${valueClass || "cockpit-text"}`}>{value}</span>
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="py-6 text-center">
      <p className="text-sm font-semibold cockpit-text">{title}</p>
      <p className="mt-1 text-xs cockpit-text-dim">{subtitle}</p>
    </div>
  );
}
