/**
 * Identity vault — encrypted at rest with AES-256-GCM.
 *
 * Stores the user's identity profile and per-site credentials in the existing
 * SQLite kv_store. The encryption key is derived (scrypt) from
 * REGISTRAR_VAULT_PASSPHRASE, or a generated key persisted to data/.registrar.key
 * when no passphrase is configured (local dev only).
 *
 * No plaintext credentials ever touch disk or logs.
 */

import { kvLoad, kvSave, DEFAULT_ORG_ID, ensureDefaultOrg } from "@/lib/db";
import { encrypt, decrypt } from "./crypto";
import type { IdentityProfile, StoredCredential } from "./types";

const VAULT_KEY_KV = "registrar.vault";
const CREDENTIALS_KV = "registrar.credentials";

function loadEncrypted<T>(key: string): T[] {
  try {
    ensureDefaultOrg();
    const rows = kvLoad<{ value: string }>(DEFAULT_ORG_ID, key);
    if (!rows.length) return [];
    const row = rows[0];
    if (!row?.value) return [];
    return JSON.parse(decrypt(row.value)) as T[];
  } catch (e) {
    console.error(`[registrar/vault] load error for ${key}:`, e);
    return [];
  }
}

function saveEncrypted<T>(key: string, records: T[]): void {
  ensureDefaultOrg();
  const payload = encrypt(JSON.stringify(records));
  kvSave(DEFAULT_ORG_ID, key, [{ value: payload }]);
}

// ─── Identity profile ──────────────────────────────────────────────────────

export function loadIdentity(): IdentityProfile | null {
  const arr = loadEncrypted<IdentityProfile>(VAULT_KEY_KV);
  return arr[0] ?? null;
}

export function saveIdentity(profile: IdentityProfile): void {
  saveEncrypted(VAULT_KEY_KV, [profile]);
}

// ─── Per-site credentials ──────────────────────────────────────────────────

export function loadCredentials(): StoredCredential[] {
  return loadEncrypted<StoredCredential>(CREDENTIALS_KV);
}

export function saveCredentials(records: StoredCredential[]): void {
  saveEncrypted(CREDENTIALS_KV, records);
}

export function upsertCredential(cred: StoredCredential): void {
  const all = loadCredentials().filter((c) => c.siteId !== cred.siteId);
  all.push(cred);
  saveCredentials(all);
}

export function getCredential(siteId: string): StoredCredential | undefined {
  return loadCredentials().find((c) => c.siteId === siteId);
}

export function hasCredential(siteId: string): boolean {
  return !!getCredential(siteId);
}
