"use client";

import { StatusResponse, secondsAgo } from "./types";

interface Props {
  status: StatusResponse | null;
  loading: boolean;
}

export function StatusBar({ status, loading }: Props) {
  const health = status?.systemHealth ?? "paused";
  const healthLabel = health.toUpperCase().replace(/_/g, " ");
  const healthClass =
    health === "healthy" ? "text-[hsl(var(--cockpit-healthy))]" :
    health === "degraded" ? "text-[hsl(var(--cockpit-warning))]" :
    health === "critical" ? "text-[hsl(var(--cockpit-critical))]" :
    "text-[hsl(var(--cockpit-text-dim))]";

  const dotClass =
    health === "healthy" ? "bg-[hsl(var(--cockpit-healthy))]" :
    health === "degraded" ? "bg-[hsl(var(--cockpit-warning))]" :
    health === "critical" ? "bg-[hsl(var(--cockpit-critical))]" :
    "bg-[hsl(var(--cockpit-text-dim))]";

  return (
    <div className="cockpit-panel flex items-center gap-4 rounded-lg px-4 py-2 text-xs sm:text-sm">
      <div className="flex items-center gap-2 font-mono-tech">
        <span className={`inline-block h-2 w-2 rounded-full ${dotClass} ${health !== "paused" ? "animate-pulse" : ""}`} />
        <span className={healthClass + " font-semibold tracking-wide"}>SYSTEM {healthLabel}</span>
      </div>
      <div className="h-4 w-px bg-[hsl(var(--cockpit-border))]" />
      <Stat label="Platforms" value={status?.platformCount ?? "—"} />
      <Stat label="Active Credentials" value={status?.activeCredentials ?? "—"} />
      <Stat label="Rotations Running" value={status?.rotationsRunning ?? 0} />
      <Stat
        label="Critical Issues"
        value={status?.criticalCount ?? 0}
        valueClass={status?.criticalCount ? "text-[hsl(var(--cockpit-critical))]" : ""}
      />
      <div className="ml-auto flex items-center gap-2 cockpit-text-dim font-mono-tech">
        <span className="hidden sm:inline">Last event</span>
        <span>{loading ? "…" : secondsAgo(status?.lastEventSecondsAgo ?? null)}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, valueClass }: { label: string; value: string | number; valueClass?: string }) {
  return (
    <div className="hidden items-center gap-1.5 md:flex">
      <span className="cockpit-text-dim">{label}</span>
      <span className={`font-mono-tech font-semibold ${valueClass || "cockpit-text"}`}>{value}</span>
    </div>
  );
}
