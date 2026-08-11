"use client";

import { AuditEntry, PIPELINE_STAGES, smartStatus, relTime } from "./types";
import { PipelineVisualization } from "./PipelineVisualization";

interface Props {
  audit: AuditEntry[];
  upcoming: any[];
  onRotate: (platformId: string) => void;
  rotating: boolean;
}

export function RotationCenter({ audit, upcoming, onRotate, rotating }: Props) {
  // Rotation events grouped by correlation (platform + time window).
  const rotationEvents = audit.filter((e) =>
    e.action.includes("key_rotation") || e.action.includes("key_acquir") ||
    e.action.includes("key_verif") || e.action.includes("key_activ") ||
    e.action.includes("key_revoc") || e.action.includes("key_stored")
  );
  const recentRotations = rotationEvents.slice(-20).reverse();
  const failedRotations = rotationEvents.filter((e) => e.outcome === "failed" || (e.code && e.code !== "SUCCESS" && e.code !== "INFO"));

  // Metrics
  const todayCount = rotationEvents.filter((e) => {
    const d = new Date(e.ts);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;
  const successCount = rotationEvents.filter((e) => e.outcome === "success").length;
  const successRate = rotationEvents.length > 0 ? Math.round((successCount / rotationEvents.length) * 1000) / 10 : 100;

  return (
    <div className="view-enter space-y-4">
      <div>
        <h1 className="text-lg font-bold cockpit-text">Rotations</h1>
        <p className="text-sm cockpit-text-dim">Credential lifecycle operations · acquire → verify → store → activate → revoke</p>
      </div>

      {/* Top Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Today" value={todayCount} color="cyan" />
        <MetricCard label="Success Rate" value={`${successRate}%`} color="healthy" />
        <MetricCard label="Failures" value={failedRotations.length} color={failedRotations.length ? "warning" : "healthy"} />
        <MetricCard label="Upcoming" value={upcoming.length} color="neutral" />
      </div>

      {/* Upcoming Rotations */}
      <div className="cockpit-panel rounded-xl p-5">
        <h2 className="mb-3 text-sm font-semibold cockpit-text-dim">UPCOMING ROTATIONS</h2>
        {upcoming.length === 0 ? (
          <EmptyState title="No upcoming rotations" subtitle="All credentials are within their rotation policy." />
        ) : (
          <div className="space-y-2">
            {upcoming.map((u, i) => (
              <div key={i} className="cockpit-elevated card-lift flex items-center justify-between rounded-lg p-3">
                <div>
                  <div className="text-sm font-semibold cockpit-text">{u.platformName}</div>
                  <div className="text-xs cockpit-text-dim font-mono-tech">{u.keyLabel}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`font-mono-tech text-xs ${u.due ? "text-[hsl(var(--cockpit-critical))]" : u.daysUntilRotation < 3 ? "text-[hsl(var(--cockpit-warning))]" : "cockpit-text-dim"}`}>
                    {u.due ? "DUE NOW" : `${u.daysUntilRotation}d remaining`}
                  </span>
                  <button
                    onClick={() => onRotate(u.platformId)}
                    disabled={rotating}
                    className="rounded border cockpit-border bg-[hsl(var(--cockpit-cyan) / 0.08)] px-2.5 py-1 text-xs font-semibold text-[hsl(var(--cockpit-cyan))] hover:bg-[hsl(var(--cockpit-cyan) / 0.15)] disabled:opacity-40"
                  >
                    Rotate
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Rotation Timeline */}
      <div className="cockpit-panel rounded-xl p-5">
        <h2 className="mb-3 text-sm font-semibold cockpit-text-dim">RECENT ROTATIONS</h2>
        {recentRotations.length === 0 ? (
          <EmptyState title="No rotations yet" subtitle="Rotation events will appear here as they occur." />
        ) : (
          <div className="space-y-3">
            {recentRotations.slice(0, 10).map((e) => (
              <RotationTimelineCard key={e.id} event={e} />
            ))}
          </div>
        )}
      </div>

      {/* Failure Experience */}
      {failedRotations.length > 0 && (
        <div className="cockpit-panel rounded-xl p-5 border-[hsl(var(--cockpit-warning) / 0.3)]">
          <h2 className="mb-3 text-sm font-semibold text-[hsl(var(--cockpit-warning))]">ROTATION FAILURES</h2>
          <div className="space-y-3">
            {failedRotations.slice(-5).reverse().map((e) => (
              <FailureCard key={e.id} event={e} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RotationTimelineCard({ event }: { event: AuditEntry }) {
  const smart = smartStatus(event.code);
  const isSuccess = event.outcome === "success";
  const isFailed = event.outcome === "failed";
  const isBlocked = event.outcome === "blocked";

  return (
    <div className="flex items-start gap-3">
      <div className={`mt-1 h-2 w-2 shrink-0 rounded-full timeline-dot ${
        isSuccess ? "bg-[hsl(var(--cockpit-healthy))]" :
        isFailed ? "bg-[hsl(var(--cockpit-critical))]" :
        isBlocked ? "bg-[hsl(var(--cockpit-warning))]" :
        "bg-[hsl(var(--cockpit-text-dim))]"
      }`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold cockpit-text">{event.siteName}</span>
          <span className="font-mono-tech text-[10px] cockpit-text-dim">{event.ts.replace("T", " ").replace(/\.\d+Z$/, "").slice(11, 19)}</span>
        </div>
        <p className="text-xs cockpit-text-dim mt-0.5">{event.detail}</p>
        {event.code && event.code !== "INFO" && event.code !== "SUCCESS" && (
          <p className="text-[10px] font-mono-tech mt-1 text-[hsl(var(--cockpit-warning))]">{smart.human} ({smart.code})</p>
        )}
      </div>
    </div>
  );
}

function FailureCard({ event }: { event: AuditEntry }) {
  const smart = smartStatus(event.code);
  return (
    <div className="cockpit-elevated rounded-lg p-4 border-l-2 border-[hsl(var(--cockpit-warning) / 0.5)]">
      <div className="text-sm font-semibold cockpit-text">{event.siteName}</div>
      <p className="mt-1 text-sm cockpit-text">{smart.human}</p>
      <div className="mt-2 space-y-1 text-xs">
        <div className="flex gap-2">
          <span className="cockpit-text-dim shrink-0">Stage:</span>
          <span className="font-mono-tech text-[hsl(var(--cockpit-warning))]">{event.action.replace(/_/g, " ").toUpperCase()}</span>
        </div>
        <div className="flex gap-2">
          <span className="cockpit-text-dim shrink-0">Reason:</span>
          <span className="cockpit-text">{event.detail}</span>
        </div>
        <div className="flex gap-2">
          <span className="cockpit-text-dim shrink-0">Code:</span>
          <span className="font-mono-tech text-[hsl(var(--cockpit-warning))]">{smart.code}</span>
        </div>
        <div className="flex gap-2">
          <span className="cockpit-text-dim shrink-0">Automatic action:</span>
          <span className="text-[hsl(var(--cockpit-healthy))]">Existing credential retained · no revocation performed</span>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colorClass =
    color === "healthy" ? "text-[hsl(var(--cockpit-healthy))]" :
    color === "warning" ? "text-[hsl(var(--cockpit-warning))]" :
    color === "critical" ? "text-[hsl(var(--cockpit-critical))]" :
    color === "cyan" ? "text-[hsl(var(--cockpit-cyan))]" :
    "cockpit-text";
  return (
    <div className="cockpit-panel rounded-xl p-4">
      <div className={`text-2xl font-bold font-mono-tech ${colorClass}`}>{value}</div>
      <div className="mt-1 text-xs cockpit-text-dim">{label}</div>
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
