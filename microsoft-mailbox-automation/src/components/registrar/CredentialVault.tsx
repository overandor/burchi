"use client";

import { useState } from "react";
import { ApiKey, Credential, relTime } from "./types";

interface Props {
  keys: ApiKey[];
  credentials: Credential[];
  onDeleteKey: (platformId: string) => void;
}

export function CredentialVault({ keys, credentials, onDeleteKey }: Props) {
  const [selected, setSelected] = useState<ApiKey | Credential | null>(null);
  const [selectedType, setSelectedType] = useState<"key" | "cred" | null>(null);

  return (
    <div className="view-enter space-y-4">
      <div>
        <h1 className="text-lg font-bold cockpit-text">Credentials</h1>
        <p className="text-sm cockpit-text-dim">
          {keys.length} API keys · {credentials.length} account credentials · all encrypted at rest
        </p>
      </div>

      {/* API Keys Table */}
      <div className="cockpit-panel overflow-x-auto rounded-xl">
        <div className="px-4 py-3 border-b cockpit-border">
          <h2 className="text-sm font-semibold cockpit-text-dim">API KEYS</h2>
        </div>
        {keys.length === 0 ? (
          <EmptyState title="No API keys stored" subtitle="Acquire credentials from the Platforms page to populate the vault." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b cockpit-border text-left text-xs cockpit-text-dim">
                <th className="px-4 py-2.5 font-medium">Credential</th>
                <th className="px-4 py-2.5 font-medium">Platform</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium hidden md:table-cell">Created</th>
                <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Next Rotation</th>
                <th className="px-4 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const daysLeft = k.rotatedAt
                  ? Math.round(k.rotationIntervalDays - (Date.now() - new Date(k.rotatedAt).getTime()) / 86400000)
                  : null;
                return (
                  <tr
                    key={k.platformId}
                    className="border-b cockpit-border last:border-0 hover:bg-[hsl(var(--cockpit-elevated) / 0.5)] cursor-pointer"
                    onClick={() => { setSelected(k); setSelectedType("key"); }}
                  >
                    <td className="px-4 py-3">
                      <div className="font-mono-tech text-xs cockpit-text">{k.keyLabel}</div>
                    </td>
                    <td className="px-4 py-3 cockpit-text">{k.platformName}</td>
                    <td className="px-4 py-3">
                      <StatusChip status={k.status} />
                    </td>
                    <td className="px-4 py-3 font-mono-tech text-xs cockpit-text-dim hidden md:table-cell">{relTime(k.createdAt)}</td>
                    <td className="px-4 py-3 font-mono-tech text-xs hidden lg:table-cell">
                      {daysLeft !== null ? (
                        <span className={daysLeft < 0 ? "text-[hsl(var(--cockpit-critical))]" : daysLeft < 3 ? "text-[hsl(var(--cockpit-warning))]" : "cockpit-text-dim"}>
                          {daysLeft < 0 ? "OVERDUE" : `${daysLeft}d`}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteKey(k.platformId); }}
                        className="text-xs text-[hsl(var(--cockpit-critical) / 0.7)] hover:text-[hsl(var(--cockpit-critical))]"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Account Credentials */}
      <div className="cockpit-panel overflow-x-auto rounded-xl">
        <div className="px-4 py-3 border-b cockpit-border">
          <h2 className="text-sm font-semibold cockpit-text-dim">ACCOUNT CREDENTIALS</h2>
        </div>
        {credentials.length === 0 ? (
          <EmptyState title="No accounts registered" subtitle="Run the registrar to provision accounts on free services." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b cockpit-border text-left text-xs cockpit-text-dim">
                <th className="px-4 py-2.5 font-medium">Site</th>
                <th className="px-4 py-2.5 font-medium">Username</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium hidden md:table-cell">Registered</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((c) => (
                <tr
                  key={c.siteId}
                  className="border-b cockpit-border last:border-0 hover:bg-[hsl(var(--cockpit-elevated) / 0.5)] cursor-pointer"
                  onClick={() => { setSelected(c); setSelectedType("cred"); }}
                >
                  <td className="px-4 py-3 cockpit-text">{c.siteName}</td>
                  <td className="px-4 py-3 font-mono-tech text-xs cockpit-text-dim">{c.username}</td>
                  <td className="px-4 py-3"><StatusChip status={c.status} /></td>
                  <td className="px-4 py-3 font-mono-tech text-xs cockpit-text-dim hidden md:table-cell">{relTime(c.registeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail Drawer */}
      {selected && (
        <DetailDrawer
          item={selected}
          type={selectedType!}
          onClose={() => { setSelected(null); setSelectedType(null); }}
        />
      )}
    </div>
  );
}

function DetailDrawer({ item, type, onClose }: { item: ApiKey | Credential; type: "key" | "cred"; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="drawer-enter relative h-full w-full max-w-md overflow-y-auto cockpit-panel border-l cockpit-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b cockpit-border bg-[hsl(var(--cockpit-panel))] px-5 py-4">
          <h2 className="text-base font-bold cockpit-text">
            {type === "key" ? (item as ApiKey).keyLabel : (item as Credential).siteName}
          </h2>
          <button onClick={onClose} className="cockpit-text-dim hover:cockpit-text text-lg">✕</button>
        </div>
        <div className="space-y-4 p-5">
          {type === "key" ? (
            <KeyDetails key_={item as ApiKey} />
          ) : (
            <CredDetails cred={item as Credential} />
          )}
        </div>
      </div>
    </div>
  );
}

function KeyDetails({ key_ }: { key_: ApiKey }) {
  const fingerprint = key_.platformId + ":" + key_.keyLabel.slice(-8);
  return (
    <>
      <DetailRow label="Platform" value={key_.platformName} />
      <DetailRow label="Status" value={key_.status.toUpperCase()} mono />
      <DetailRow label="Fingerprint" value={`sha256:${fingerprint}…`} mono />
      <DetailRow label="Created" value={relTime(key_.createdAt)} mono />
      <DetailRow label="Last Rotation" value={key_.rotatedAt ? relTime(key_.rotatedAt) : "never"} mono />
      <DetailRow label="Rotation Interval" value={`${key_.rotationIntervalDays} days`} mono />
      <DetailRow label="Encryption" value="AES-256-GCM" mono />
      <DetailRow label="Encrypted at rest" value="Yes" />
      {key_.lastError && <DetailRow label="Last Error" value={key_.lastError} mono error />}
      <div className="rounded-lg border cockpit-border p-3 text-xs cockpit-text-dim">
        Plaintext credential values are never exposed through the UI, API, or audit logs.
      </div>
    </>
  );
}

function CredDetails({ cred }: { cred: Credential }) {
  return (
    <>
      <DetailRow label="Site" value={cred.siteName} />
      <DetailRow label="Username" value={cred.username} mono />
      <DetailRow label="Email" value={cred.email} mono />
      <DetailRow label="Status" value={cred.status.toUpperCase()} mono />
      <DetailRow label="Registered" value={relTime(cred.registeredAt)} mono />
      {cred.notes && <DetailRow label="Notes" value={cred.notes} />}
      <div className="rounded-lg border cockpit-border p-3 text-xs cockpit-text-dim">
        Password is encrypted at rest and never exposed through the UI.
      </div>
    </>
  );
}

function DetailRow({ label, value, mono, error }: { label: string; value: string; mono?: boolean; error?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs cockpit-text-dim shrink-0">{label}</span>
      <span className={`text-sm text-right ${mono ? "font-mono-tech" : ""} ${error ? "text-[hsl(var(--cockpit-critical))]" : "cockpit-text"}`}>
        {value}
      </span>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const cls =
    status === "active" || status === "registered" ? "chip-healthy" :
    status === "pending" ? "chip-warning" :
    status === "blocked_captcha" ? "chip-critical" :
    status === "failed" ? "chip-critical" :
    "chip-neutral";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono-tech ${cls}`}>{status.toUpperCase().replace(/_/g, " ")}</span>;
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm font-semibold cockpit-text">{title}</p>
      <p className="mt-1 text-xs cockpit-text-dim">{subtitle}</p>
    </div>
  );
}
