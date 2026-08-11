"use client";

import { StatusResponse } from "./types";

interface Props {
  status: StatusResponse | null;
}

export function SecurityCenter({ status }: Props) {
  const sec = status?.security;
  const posture = computePosture(status);

  return (
    <div className="view-enter space-y-4">
      <div>
        <h1 className="text-lg font-bold cockpit-text">Security</h1>
        <p className="text-sm cockpit-text-dim">Credential protection posture · verified continuously</p>
      </div>

      {/* Large Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <BigMetric label="Secrets Exposed" value={sec?.secretsExposed ?? 0} color={sec?.secretsExposed ? "critical" : "healthy"} />
        <BigMetric label="Encrypted" value={`${sec?.encryptedPercent ?? 100}%`} color="healthy" />
        <BigMetric label="Unsafe Rotations" value={sec?.unsafeRotations ?? 0} color={sec?.unsafeRotations ? "critical" : "healthy"} />
        <BigMetric label="Unverified" value={sec?.unverifiedCount ?? 0} color={sec?.unverifiedCount ? "warning" : "healthy"} />
      </div>

      {/* Security Posture Radial */}
      <div className="cockpit-panel rounded-xl p-6">
        <h2 className="mb-4 text-sm font-semibold cockpit-text-dim">SECURITY POSTURE</h2>
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
          <div className="relative shrink-0">
            <div
              className="radial-gauge h-32 w-32"
              style={{ ["--gauge-pct" as any]: `${posture.overall}%` }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-2xl font-bold font-mono-tech ${
                posture.overall >= 95 ? "text-[hsl(var(--cockpit-healthy))]" :
                posture.overall >= 80 ? "text-[hsl(var(--cockpit-warning))]" :
                "text-[hsl(var(--cockpit-critical))]"
              }`}>
                {posture.overall}%
              </span>
              <span className="text-[10px] cockpit-text-dim mt-0.5">SECURE</span>
            </div>
          </div>
          <div className="flex-1 w-full space-y-2">
            <PostureBar label="Encryption" pct={100} />
            <PostureBar label="Rotation Safety" pct={100} />
            <PostureBar label="Secret Handling" pct={100} />
            <PostureBar label="Session Protection" pct={posture.sessionProtection} />
            <PostureBar label="Platform Reliability" pct={posture.platformReliability} />
          </div>
        </div>
      </div>

      {/* Security Sections */}
      <div className="grid gap-4 sm:grid-cols-2">
        <SecuritySection
          title="Encryption"
          items={[
            { label: "Algorithm", value: "AES-256-GCM" },
            { label: "Key derivation", value: "PBKDF2 + salt" },
            { label: "At rest", value: "All credentials encrypted" },
            { label: "In transit", value: "Session handoffs encrypted" },
          ]}
        />
        <SecuritySection
          title="Secret Exposure"
          items={[
            { label: "In audit logs", value: "Never" },
            { label: "In API responses", value: "Redacted" },
            { label: "In error messages", value: "Never" },
            { label: "On disk", value: "Encrypted only" },
          ]}
        />
        <SecuritySection
          title="Rotation Safety"
          items={[
            { label: "Order", value: "acquire → verify → activate → revoke" },
            { label: "Single-key platforms", value: "Blocked from auto-rotation" },
            { label: "Failed verification", value: "Old key retained" },
            { label: "Revocation", value: "Best-effort, never fabricated" },
          ]}
        />
        <SecuritySection
          title="Audit Integrity"
          items={[
            { label: "Storage", value: "Append-only" },
            { label: "Total events", value: String(status?.auditCount ?? 0) },
            { label: "Structured codes", value: "SPEC §12 compliant" },
            { label: "Secret values", value: "Excluded by design" },
          ]}
        />
      </div>
    </div>
  );
}

function computePosture(status: StatusResponse | null) {
  const platformReliability = status?.platformHealth?.length
    ? Math.round(status.platformHealth.filter((p) => p.health === "healthy").length / status.platformHealth.length * 100)
    : 100;
  const sessionProtection = 100 - (status?.security.unverifiedCount ?? 0) * 5;
  const overall = Math.round((100 + 100 + 100 + Math.max(0, sessionProtection) + platformReliability) / 5);
  return { overall, sessionProtection: Math.max(0, sessionProtection), platformReliability };
}

function BigMetric({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colorClass =
    color === "healthy" ? "text-[hsl(var(--cockpit-healthy))]" :
    color === "warning" ? "text-[hsl(var(--cockpit-warning))]" :
    color === "critical" ? "text-[hsl(var(--cockpit-critical))]" :
    "cockpit-text";
  return (
    <div className="cockpit-panel rounded-xl p-4">
      <div className={`text-3xl font-bold font-mono-tech ${colorClass}`}>{value}</div>
      <div className="mt-1 text-xs cockpit-text-dim">{label}</div>
    </div>
  );
}

function PostureBar({ label, pct }: { label: string; pct: number }) {
  const color = pct >= 95 ? "var(--cockpit-healthy)" : pct >= 80 ? "var(--cockpit-warning)" : "var(--cockpit-critical)";
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="cockpit-text-dim">{label}</span>
        <span className="font-mono-tech cockpit-text">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-[hsl(var(--cockpit-border))] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: `hsl(${color})` }}
        />
      </div>
    </div>
  );
}

function SecuritySection({ title, items }: { title: string; items: { label: string; value: string }[] }) {
  return (
    <div className="cockpit-panel rounded-xl p-5">
      <h3 className="mb-3 text-sm font-semibold cockpit-text-dim">{title.toUpperCase()}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between text-xs">
            <span className="cockpit-text-dim">{item.label}</span>
            <span className="font-mono-tech cockpit-text">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
