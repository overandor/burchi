"use client";

import { useState } from "react";
import { AuditEntry, smartStatus } from "./types";

interface Props {
  audit: AuditEntry[];
}

export function AuditTimeline({ audit }: Props) {
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [filter, setFilter] = useState<"all" | "success" | "failed" | "blocked">("all");

  const filtered = filter === "all" ? audit : audit.filter((e) => e.outcome === filter);
  const reversed = [...filtered].reverse();

  return (
    <div className="view-enter space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold cockpit-text">Audit</h1>
          <p className="text-sm cockpit-text-dim">{audit.length} events · append-only · no secret values</p>
        </div>
        <div className="flex gap-1">
          {(["all", "success", "failed", "blocked"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-all ${
                filter === f
                  ? "bg-[hsl(var(--cockpit-cyan) / 0.12)] text-[hsl(var(--cockpit-cyan))]"
                  : "cockpit-text-dim hover:cockpit-text"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="cockpit-panel rounded-xl p-5">
        {reversed.length === 0 ? (
          <EmptyState title="No audit events" subtitle="Operations will appear here as they occur." />
        ) : (
          <div className="space-y-1">
            {reversed.slice(0, 100).map((e) => (
              <TimelineRow key={e.id} event={e} onClick={() => setSelected(e)} />
            ))}
          </div>
        )}
      </div>

      {/* Detail Panel */}
      {selected && <DetailPanel event={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function TimelineRow({ event, onClick }: { event: AuditEntry; onClick: () => void }) {
  const dotClass =
    event.outcome === "success" ? "bg-[hsl(var(--cockpit-healthy))]" :
    event.outcome === "failed" ? "bg-[hsl(var(--cockpit-critical))]" :
    event.outcome === "blocked" ? "bg-[hsl(var(--cockpit-warning))]" :
    "bg-[hsl(var(--cockpit-text-dim))]";

  const time = event.ts.replace("T", " ").replace(/\.\d+Z$/, "").slice(11, 19);

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-[hsl(var(--cockpit-elevated) / 0.5)]"
    >
      <span className={`timeline-dot h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
      <span className="font-mono-tech cockpit-text-dim w-16 shrink-0">{time}</span>
      <span className="cockpit-text w-28 shrink-0 truncate font-medium">{event.siteName}</span>
      <span className={`shrink-0 font-mono-tech text-[10px] ${
        event.outcome === "success" ? "text-[hsl(var(--cockpit-healthy))]" :
        event.outcome === "failed" ? "text-[hsl(var(--cockpit-critical))]" :
        event.outcome === "blocked" ? "text-[hsl(var(--cockpit-warning))]" :
        "cockpit-text-dim"
      }`}>
        {event.outcome.toUpperCase()}
      </span>
      {event.code && (
        <span className="shrink-0 font-mono-tech text-[10px] text-[hsl(var(--cockpit-purple))]">[{event.code}]</span>
      )}
      <span className="cockpit-text-dim truncate">{event.action}: {event.detail}</span>
    </button>
  );
}

function DetailPanel({ event, onClose }: { event: AuditEntry; onClose: () => void }) {
  const smart = smartStatus(event.code);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="drawer-enter relative h-full w-full max-w-md overflow-y-auto cockpit-panel border-l cockpit-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b cockpit-border bg-[hsl(var(--cockpit-panel))] px-5 py-4">
          <h2 className="text-base font-bold cockpit-text">Event Detail</h2>
          <button onClick={onClose} className="cockpit-text-dim hover:cockpit-text text-lg">✕</button>
        </div>
        <div className="space-y-3 p-5">
          <DetailRow label="Event ID" value={event.id} mono />
          <DetailRow label="Timestamp" value={event.ts} mono />
          <DetailRow label="Platform" value={`${event.siteName} (${event.siteId})`} />
          <DetailRow label="Action" value={event.action} mono />
          <DetailRow label="Outcome" value={event.outcome.toUpperCase()} mono />
          {event.code && <DetailRow label="Code" value={event.code} mono />}
          <DetailRow label="Detail" value={event.detail} />
          {event.code && event.code !== "INFO" && event.code !== "SUCCESS" && (
            <div className="rounded-lg border cockpit-border p-3 text-sm">
              <div className="text-xs cockpit-text-dim mb-1">Human-readable status</div>
              <div className="cockpit-text">{smart.human}</div>
              <div className="mt-1 font-mono-tech text-xs text-[hsl(var(--cockpit-purple))]">{smart.code}</div>
            </div>
          )}
          {event.tosSummary && <DetailRow label="ToS Summary" value={event.tosSummary} />}
          {event.tosAccepted !== undefined && <DetailRow label="ToS Accepted" value={event.tosAccepted ? "Yes" : "No"} />}
          <div className="rounded-lg border cockpit-border p-3 text-xs cockpit-text-dim">
            Audit records never contain credential plaintext, cookies, authentication tokens, or encryption keys.
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs cockpit-text-dim mb-0.5">{label}</div>
      <div className={`text-sm cockpit-text ${mono ? "font-mono-tech break-all" : ""}`}>{value}</div>
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm font-semibold cockpit-text">{title}</p>
      <p className="mt-1 text-xs cockpit-text-dim">{subtitle}</p>
    </div>
  );
}
