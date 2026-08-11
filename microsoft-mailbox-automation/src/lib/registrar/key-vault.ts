/**
 * API-key vault — encrypted storage for platform API keys.
 *
 * Reuses the shared crypto helper. Keys are stored in the SQLite kv_store as
 * ciphertext; the plaintext secret is only ever held in memory during a
 * rotation or when explicitly retrieved by the vault holder.
 */

import { kvLoad, kvSave, DEFAULT_ORG_ID, ensureDefaultOrg } from "@/lib/db";
import { encrypt, decrypt } from "./crypto";
import type { ApiKeyRecord } from "./key-types";

const KEYS_KV = "registrar.apikeys";

export function loadKeys(): ApiKeyRecord[] {
  try {
    ensureDefaultOrg();
    const rows = kvLoad<{ value: string }>(DEFAULT_ORG_ID, KEYS_KV);
    if (!rows.length) return [];
    return JSON.parse(decrypt(rows[0].value)) as ApiKeyRecord[];
  } catch (e) {
    console.error("[registrar/key-vault] load error:", e);
    return [];
  }
}

function saveKeys(records: ApiKeyRecord[]): void {
  ensureDefaultOrg();
  const payload = encrypt(JSON.stringify(records));
  kvSave(DEFAULT_ORG_ID, KEYS_KV, [{ value: payload }]);
}

export function upsertKey(key: ApiKeyRecord): void {
  const all = loadKeys().filter((k) => k.platformId !== key.platformId);
  all.push(key);
  saveKeys(all);
}

export function getKey(platformId: string): ApiKeyRecord | undefined {
  return loadKeys().find((k) => k.platformId === platformId);
}

export function deleteKey(platformId: string): void {
  saveKeys(loadKeys().filter((k) => k.platformId !== platformId));
}

/** Return the decrypted secret for a platform (use only when needed). */
export function getDecryptedKeyValue(platformId: string): string | null {
  const k = getKey(platformId);
  if (!k) return null;
  try {
    return decrypt(k.encryptedValue);
  } catch (e) {
    console.error("[registrar/key-vault] decrypt error:", e);
    return null;
  }
}

/** Return keys with plaintext values redacted for API/UI display. */
export function listKeysRedacted(): Omit<ApiKeyRecord, "encryptedValue">[] {
  return loadKeys().map(({ encryptedValue: _ev, ...rest }) => ({
    ...rest,
    hasValue: true,
  })) as any;
}
