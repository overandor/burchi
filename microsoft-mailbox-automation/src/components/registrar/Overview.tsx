"use client";

import { StatusResponse, AttentionItem, secondsAgo, smartStatus } from "./types";
import { PipelineVisualization } from "./PipelineVisualization";

interface Props {
  status: StatusResponse | null;
  audit: any[];
  onNavigate: (view: string) => void;
}

export function Overview({ status, audit, onNavigate }: Props) {
  const health = status?.systemHealth ?? "paused";
  const orbClass =
    health === "healthy" ? "orb-healthy" :
    health === "degraded" ? "orb-degraded" :
    health === "critical" ? "orb-critical" :
    "orb-paused";

  const healthLabel =
    health === "healthy" ? "AUTOMATION HEALTHY" :
    health === "degraded" ? "AUTOMATION DEGRADED" :
    health === "critical" ? "AUTOMATION CRITICAL" :
    "AUTOMATION PAUSED";

  const healthSubtext =
    health === "healthy" ? "All supported credential pipelines are operating normally." :
    health === "degraded" ? "Some platforms require attention. No credentials are at risk." :
    health === "critical" ? "Critical issues detected. Immediate review recommended." :
    "Automation is paused. No rotations are running.";

  // Derive pipeline states from recent audit events.
  const recentAudit = audit.slice(-8);
  const pipelineStates = derivePipelineStates(recentAudit);

  // Running automations (from recent audit with "running" or "start" actions).
  const running = recentAudit.filter((e) => e.action.includes("start") || e.action.includes("rotat")).slice(-3);

  // Attention items.
  const attention = status?.attention?.slice(0, 5) ?? [];

  // Upcoming rotations.
  const upcoming = status?.upcoming?.slice(0, 5) ?? [];

  return (
    <div className="view-enter space-y-6">
      {/* Hero Section */}
      <div className="cockpit-panel flex items-center gap-6 rounded-xl p-6 sm:p-8">
        <div className={`h-16 w-16 shrink-0 rounded-full ${orbClass} sm:h-20 sm:w-20`} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl" style={{ color: `hsl(var(--cockpit-${health === "healthy" ? "healthy" : health === "degraded" ? "warning" : health === "critical" ? "critical" : "text-dim"}))` }}>
            {healthLabel}
          </h1>
          <p className="mt-1 text-sm cockpit-text-dim">{healthSubtext}</p>
          <p className="mt-2 text-sm cockpit-text">
            <span className="font-mono-tech font-semibold">{status?.activeCredentials ?? "—"}</span> credentials protected across{" "}
            <span className="font-mono-tech font-semibold">{status?.platformCount ?? "—"}</span> platforms
          </p>
        </div>
      </div>

      {/* Live Pipeline */}
      <div className="cockpit-panel rounded-xl p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wide cockpit-text-dim">PIPELINE</h2>
          <button
            onClick={() => onNavigate("automation")}
            className="text-xs text-[hsl(var(--cockpit-cyan))] hover:underline"
          >
            View details →
          </button>
        </div>
        <PipelineVisualization states={pipelineStates} />
        <div className="mt-3 flex flex-wrap gap-3 text-[10px] font-mono-tech cockpit-text-dim">
          <Legend symbol="✓" label="complete" color="healthy" />
          <Legend symbol="●" label="active" color="cyan" />
          <Legend symbol="◐" label="waiting" color="warning" />
          <Legend symbol="✕" label="failed" color="critical" />
          <Legend symbol="○" label="idle" color="dim" />
        </div>
      </div>

      {/* Two-column: Running + Attention */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Running Automations */}
        <div className="cockpit-panel rounded-xl p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-wide cockpit-text-dim">RUNNING NOW</h2>
          {running.length === 0 ? (
            <EmptyState title="No rotations running" subtitle="Everything is quiet. All scheduled credentials are within policy." />
          ) : (
            <div className="space-y-2">
              {running.map((e, i) => (
                <div key={i} className="cockpit-elevated card-lift rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold cockpit-text">{e.siteName}</span>
                    <span className="text-[10px] font-mono-tech cockpit-text-dim">{secondsAgo(Math.round((Date.now() - new Date(e.ts).getTime()) / 1000))}</span>
                  </div>
                  <p className="mt-1 text-xs cockpit-text-dim">{e.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Attention Required */}
        <div className="cockpit-panel rounded-xl p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-wide cockpit-text-dim">ATTENTION REQUIRED</h2>
          {attention.length === 0 ? (
            <EmptyState title="No issues detected" subtitle="All systems operating within normal parameters." />
          ) : (
            <div className="space-y-2">
              {attention.map((item, i) => (
                <AttentionCard key={i} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Platform Fleet Summary */}
      <div className="cockpit-panel rounded-xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wide cockpit-text-dim">PLATFORM FLEET</h2>
          <button onClick={() => onNavigate("platforms")} className="text-xs text-[hsl(var(--cockpit-cyan))] hover:underline">
            View all →
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(status?.platformHealth ?? []).slice(0, 6).map((p) => (
            <div key={p.id} className="cockpit-elevated card-lift rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold cockpit-text">{p.name}</span>
                <HealthDot health={p.health} />
              </div>
              <div className="mt-2 flex items-center gap-2 text-[10px] font-mono-tech cockpit-text-dim">
                <span>{p.acquisition.toUpperCase()}</span>
                <span>·</span>
                <span>{p.automationScore}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Security + Upcoming */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="cockpit-panel rounded-xl p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-wide cockpit-text-dim">SECURITY</h2>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Encrypted" value={`${status?.security.encryptedPercent ?? 100}%`} color="healthy" />
            <Metric label="Exposed" value={status?.security.secretsExposed ?? 0} color={status?.security.secretsExposed ? "critical" : "healthy"} />
            <Metric label="Unsafe" value={status?.security.unsafeRotations ?? 0} color={status?.security.unsafeRotations ? "critical" : "healthy"} />
          </div>
        </div>

        <div className="cockpit-panel rounded-xl p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-wide cockpit-text-dim">UPCOMING ROTATIONS</h2>
          {upcoming.length === 0 ? (
            <EmptyState title="No upcoming rotations" subtitle="All credentials are within their rotation policy." />
          ) : (
            <div className="space-y-2">
              {upcoming.map((u, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="cockpit-text">{u.platformName}</span>
                  <span className={`font-mono-tech text-xs ${u.due ? "text-[hsl(var(--cockpit-critical))]" : u.daysUntilRotation < 3 ? "text-[hsl(var(--cockpit-warning))]" : "cockpit-text-dim"}`}>
                    {u.due ? "DUE NOW" : `${u.daysUntilRotation}d`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Audit */}
      <div className="cockpit-panel rounded-xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wide cockpit-text-dim">RECENT AUDIT</h2>
          <button onClick={() => onNavigate("audit")} className="text-xs text-[hsl(var(--cockpit-cyan))] hover:underline">
            View timeline →
          </button>
        </div>
        <div className="space-y-1.5">
          {audit.slice(-5).reverse().map((e) => (
            <div key={e.id} className="flex items-center gap-3 text-xs">
              <span className="font-mono-tech cockpit-text-dim w-16 shrink-0">{e.ts.replace("T", " ").replace(/\.\d+Z$/, "").slice(11)}</span>
              <span className="cockpit-text w-24 shrink-0 truncate">{e.siteName}</span>
              <span className={`shrink-0 ${outcomeColor(e.outcome)}`}>{e.outcome.toUpperCase()}</span>
              <span className="cockpit-text-dim truncate">{e.detail}</span>
            </div>
          ))}
          {audit.length === 0 && <EmptyState title="No audit events" subtitle="Operations will appear here as they occur." />}
        </div>
      </div>
    </div>
  );
}

function derivePipelineStates(audit: any[]): Partial<Record<string, any>> {
  const states: Partial<Record<string, any>> = {};
  const lastByAction: Record<string, any> = {};
  for (const e of audit) {
    lastByAction[e.action] = e;
  }
  if (lastByAction["signup_start"] || lastByAction["key_rotation_start"]) states.AUTHENTICATE = "healthy";
  if (lastByAction["session_exported"] || lastByAction["session_handoff_consumed"]) states.SESSION = "healthy";
  if (lastByAction["key_acquisition_failed"]) states.ACQUIRE = "failed";
  else if (lastByAction["key_verified"]) states.ACQUIRE = "healthy";
  if (lastByAction["key_verified"]) states.VERIFY = "healthy";
  else if (lastByAction["key_verified"]?.outcome === "VERIFICATION_FAILED") states.VERIFY = "failed";
  if (lastByAction["key_activated"]) states.ENCRYPT = "healthy";
  if (lastByAction["key_activated"]) states.ACTIVATE = "healthy";
  if (lastByAction["key_revocation"]) states.REVOKE = "healthy";
  if (lastByAction["key_rotation_complete"]) states.AUDIT = "healthy";
  return states;
}

function AttentionCard({ item }: { item: AttentionItem }) {
  const sevClass =
    item.severity === "critical" ? "chip-critical" :
    item.severity === "warning" ? "chip-warning" :
    "chip-neutral";
  const smart = smartStatus(item.type);
  return (
    <div className="cockpit-elevated card-lift rounded-lg p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold cockpit-text">{item.platform}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono-tech ${sevClass}`}>{item.severity.toUpperCase()}</span>
      </div>
      <p className="mt-1 text-xs cockpit-text-dim">{item.message}</p>
    </div>
  );
}

function HealthDot({ health }: { health: string }) {
  const cls =
    health === "healthy" ? "bg-[hsl(var(--cockpit-healthy))]" :
    health === "degraded" ? "bg-[hsl(var(--cockpit-warning))]" :
    "bg-[hsl(var(--cockpit-critical))]";
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />;
}

function Metric({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colorClass =
    color === "healthy" ? "text-[hsl(var(--cockpit-healthy))]" :
    color === "critical" ? "text-[hsl(var(--cockpit-critical))]" :
    color === "warning" ? "text-[hsl(var(--cockpit-warning))]" :
    "cockpit-text";
  return (
    <div className="cockpit-elevated rounded-lg p-3 text-center">
      <div className={`text-lg font-bold font-mono-tech ${colorClass}`}>{value}</div>
      <div className="mt-0.5 text-[10px] cockpit-text-dim">{label}</div>
    </div>
  );
}

function Legend({ symbol, label, color }: { symbol: string; label: string; color: string }) {
  const cls =
    color === "healthy" ? "text-[hsl(var(--cockpit-healthy))]" :
    color === "cyan" ? "text-[hsl(var(--cockpit-cyan))]" :
    color === "warning" ? "text-[hsl(var(--cockpit-warning))]" :
    color === "critical" ? "text-[hsl(var(--cockpit-critical))]" :
    "cockpit-text-dim";
  return <span className="flex items-center gap-1"><span className={cls}>{symbol}</span> {label}</span>;
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="py-6 text-center">
      <p className="text-sm font-semibold cockpit-text">{title}</p>
      <p className="mt-1 text-xs cockpit-text-dim">{subtitle}</p>
    </div>
  );
}

function outcomeColor(outcome: string): string {
  if (outcome === "success") return "text-[hsl(var(--cockpit-healthy))]";
  if (outcome === "blocked") return "text-[hsl(var(--cockpit-warning))]";
  if (outcome === "failed") return "text-[hsl(var(--cockpit-critical))]";
  return "cockpit-text-dim";
}
