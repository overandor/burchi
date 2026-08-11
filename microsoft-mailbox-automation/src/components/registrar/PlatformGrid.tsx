"use client";

import { PlatformHealth, KeyPlatform, ApiKey } from "./types";

interface Props {
  platforms: KeyPlatform[];
  platformHealth: PlatformHealth[];
  keys: ApiKey[];
  onRotate: (platformId: string) => void;
  rotating: boolean;
}

export function PlatformGrid({ platforms, platformHealth, keys, onRotate, rotating }: Props) {
  const healthMap = new Map(platformHealth.map((h) => [h.id, h]));
  const keyMap = new Map(keys.map((k) => [k.platformId, k]));

  return (
    <div className="view-enter space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold cockpit-text">Platforms</h1>
          <p className="text-sm cockpit-text-dim">{platforms.length} platforms · {platformHealth.filter(p => p.qualified).length} qualified for automation</p>
        </div>
      </div>

      {/* Capability Matrix */}
      <div className="cockpit-panel overflow-x-auto rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b cockpit-border text-left text-xs cockpit-text-dim">
              <th className="px-4 py-3 font-medium">Platform</th>
              <th className="px-4 py-3 font-medium">Auth</th>
              <th className="px-4 py-3 font-medium">Acquire</th>
              <th className="px-4 py-3 font-medium">Verify</th>
              <th className="px-4 py-3 font-medium">Rotate</th>
              <th className="px-4 py-3 font-medium">Revoke</th>
              <th className="px-4 py-3 font-medium">Zero-Human</th>
            </tr>
          </thead>
          <tbody>
            {platforms.map((p) => {
              const h = healthMap.get(p.id);
              const qual = h?.qualified ?? false;
              return (
                <tr key={p.id} className="border-b cockpit-border last:border-0 hover:bg-[hsl(var(--cockpit-elevated) / 0.5)]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <HealthDot health={h?.health ?? "healthy"} />
                      <span className="font-semibold cockpit-text">{p.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono-tech text-xs cockpit-text-dim">{p.acquisition === "api" ? "API" : "Session"}</td>
                  <td className="px-4 py-3 font-mono-tech text-xs cockpit-text-dim">{p.acquisition === "api" ? "API" : "UI"}</td>
                  <td className="px-4 py-3 font-mono-tech text-xs cockpit-text-dim">API</td>
                  <td className="px-4 py-3 font-mono-tech text-xs cockpit-text-dim">{p.supportsMultipleKeys ? "Safe" : "Manual"}</td>
                  <td className="px-4 py-3 font-mono-tech text-xs cockpit-text-dim">{p.revocation === "api" ? "API" : p.revocation === "ui_playwright" ? "UI" : "Manual"}</td>
                  <td className="px-4 py-3">
                    <span className={`font-mono-tech text-sm ${qual ? "text-[hsl(var(--cockpit-healthy))]" : "text-[hsl(var(--cockpit-critical))]"}`}>
                      {qual ? "✓" : "✕"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Platform Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {platforms.map((p) => {
          const h = healthMap.get(p.id);
          const k = keyMap.get(p.id);
          return (
            <PlatformCard
              key={p.id}
              platform={p}
              health={h}
              keyRecord={k}
              onRotate={() => onRotate(p.id)}
              rotating={rotating}
            />
          );
        })}
      </div>
    </div>
  );
}

function PlatformCard({
  platform,
  health,
  keyRecord,
  onRotate,
  rotating,
}: {
  platform: KeyPlatform;
  health?: PlatformHealth;
  keyRecord?: ApiKey;
  onRotate: () => void;
  rotating: boolean;
}) {
  const healthLabel =
    health?.health === "healthy" ? "Healthy" :
    health?.health === "degraded" ? "Degraded" :
    health?.health === "critical" ? "Critical" : "Unknown";

  const healthChip =
    health?.health === "healthy" ? "chip-healthy" :
    health?.health === "degraded" ? "chip-warning" :
    health?.health === "critical" ? "chip-critical" : "chip-neutral";

  return (
    <div className="cockpit-panel card-lift rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-bold cockpit-text">{platform.name}</h3>
          <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-mono-tech ${healthChip}`}>
            {healthLabel.toUpperCase()}
          </span>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold font-mono-tech ${health?.automationScore && health.automationScore >= 80 ? "text-[hsl(var(--cockpit-healthy))]" : health?.automationScore && health.automationScore >= 50 ? "text-[hsl(var(--cockpit-warning))]" : "text-[hsl(var(--cockpit-text-dim))]"}`}>
            {health?.automationScore ?? 0}%
          </div>
          <div className="text-[10px] cockpit-text-dim">automation</div>
        </div>
      </div>

      <p className="mt-3 text-xs cockpit-text-dim line-clamp-2">{platform.description}</p>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <CapabilityRow label="Authentication" value={platform.acquisition === "api" ? "API" : "Browser Session"} />
        <CapabilityRow label="Acquisition" value={platform.acquisition === "api" ? "Documented API" : "UI Automation"} />
        <CapabilityRow label="Revocation" value={platform.revocation === "api" ? "Documented API" : platform.revocation === "ui_playwright" ? "Best Effort" : "Manual"} />
        <CapabilityRow label="Multi-Key" value={platform.supportsMultipleKeys ? "Supported" : "Single Only"} />
      </div>

      {keyRecord && (
        <div className="mt-3 border-t cockpit-border pt-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="cockpit-text-dim">Key status</span>
            <span className={`font-mono-tech ${keyRecord.status === "active" ? "text-[hsl(var(--cockpit-healthy))]" : "text-[hsl(var(--cockpit-warning))]"}`}>
              {keyRecord.status.toUpperCase()}
            </span>
          </div>
          {keyRecord.rotatedAt && (
            <div className="mt-1 flex items-center justify-between">
              <span className="cockpit-text-dim">Last rotation</span>
              <span className="font-mono-tech cockpit-text-dim">{relTime(keyRecord.rotatedAt)}</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button
          onClick={onRotate}
          disabled={rotating || !health?.qualified}
          className="flex-1 rounded-lg border cockpit-border bg-[hsl(var(--cockpit-cyan) / 0.08)] px-3 py-2 text-xs font-semibold text-[hsl(var(--cockpit-cyan))] transition-all hover:bg-[hsl(var(--cockpit-cyan) / 0.15)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {rotating ? "Rotating…" : "Rotate Now"}
        </button>
      </div>
    </div>
  );
}

function CapabilityRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="cockpit-text-dim text-[10px] uppercase tracking-wide">{label}</div>
      <div className="cockpit-text font-medium">{value}</div>
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

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.round(diff / 3600000);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
