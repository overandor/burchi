"use client";

import { useState } from "react";
import { IdentityProfile } from "@/lib/registrar/types";

interface Props {
  identity: IdentityProfile | null;
  onSave: (profile: Partial<IdentityProfile>) => Promise<void>;
}

export function Settings({ identity, onSave }: Props) {
  const [form, setForm] = useState<Partial<IdentityProfile>>(
    identity || { needs: ["email", "code", "storage", "identity", "communication"] }
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    await onSave(form);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="view-enter space-y-4">
      <div>
        <h1 className="text-lg font-bold cockpit-text">Settings</h1>
        <p className="text-sm cockpit-text-dim">Identity profile and automation configuration</p>
      </div>

      {/* Identity Profile */}
      <div className="cockpit-panel rounded-xl p-5">
        <h2 className="mb-4 text-sm font-semibold cockpit-text-dim">IDENTITY PROFILE</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" value={form.firstName || ""} onChange={(v) => setForm({ ...form, firstName: v })} />
          <Field label="Last name" value={form.lastName || ""} onChange={(v) => setForm({ ...form, lastName: v })} />
          <Field label="Email" value={form.email || ""} onChange={(v) => setForm({ ...form, email: v })} />
          <Field label="Username stem" value={form.usernameStem || ""} onChange={(v) => setForm({ ...form, usernameStem: v })} />
          <Field label="Phone (optional)" value={form.phone || ""} onChange={(v) => setForm({ ...form, phone: v })} />
          <Field label="Birthdate (optional)" value={form.birthdate || ""} onChange={(v) => setForm({ ...form, birthdate: v })} />
        </div>
        <div className="mt-4">
          <label className="text-xs cockpit-text-dim">Needs / interests</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {["email", "code", "storage", "identity", "communication", "ai", "dev", "cloud", "analytics", "automation"].map((tag) => (
              <button
                key={tag}
                onClick={() => {
                  const needs = form.needs || [];
                  setForm({
                    ...form,
                    needs: needs.includes(tag) ? needs.filter((n) => n !== tag) : [...needs, tag],
                  });
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                  (form.needs || []).includes(tag)
                    ? "bg-[hsl(var(--cockpit-cyan) / 0.15)] text-[hsl(var(--cockpit-cyan))] border border-[hsl(var(--cockpit-cyan) / 0.3)]"
                    : "cockpit-elevated cockpit-text-dim border cockpit-border hover:cockpit-text"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-[hsl(var(--cockpit-cyan) / 0.12)] border border-[hsl(var(--cockpit-cyan) / 0.3)] px-4 py-2 text-sm font-semibold text-[hsl(var(--cockpit-cyan))] hover:bg-[hsl(var(--cockpit-cyan) / 0.2)] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Profile"}
          </button>
          {saved && <span className="text-xs text-[hsl(var(--cockpit-healthy))]">✓ Saved</span>}
        </div>
      </div>

      {/* Automation Configuration */}
      <div className="cockpit-panel rounded-xl p-5">
        <h2 className="mb-4 text-sm font-semibold cockpit-text-dim">AUTOMATION CONFIGURATION</h2>
        <div className="space-y-3">
          <ConfigRow label="CAPTCHA policy" value="Fail closed — never bypass" />
          <ConfigRow label="ToS acceptance" value="Auto-accept low-risk free services only" />
          <ConfigRow label="Rotation order" value="acquire → verify → activate → revoke" />
          <ConfigRow label="Session handoff" value="Encrypted, scoped, consume-once" />
          <ConfigRow label="Audit logging" value="Append-only, no secret values" />
          <ConfigRow label="Encryption" value="AES-256-GCM at rest" />
        </div>
      </div>

      {/* SPEC Reference */}
      <div className="cockpit-panel rounded-xl p-5">
        <h2 className="mb-2 text-sm font-semibold cockpit-text-dim">SPECIFICATION</h2>
        <p className="text-xs cockpit-text-dim">
          The credential pipeline is governed by <span className="font-mono-tech cockpit-text">SPEC.md</span>.
          All operations follow the structured status codes and safety invariants defined there.
          No CAPTCHA bypass. No fabricated success. No plaintext secrets in logs.
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs cockpit-text-dim">{label}</span>
      <input
        className="mt-1 block w-full rounded-lg cockpit-elevated border cockpit-border px-3 py-2 text-sm cockpit-text outline-none focus:border-[hsl(var(--cockpit-cyan) / 0.5)]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="cockpit-text-dim">{label}</span>
      <span className="font-mono-tech text-xs cockpit-text">{value}</span>
    </div>
  );
}
