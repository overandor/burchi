/**
 * Server-side email credential store.
 *
 * Stores Gmail and Microsoft 365 OAuth tokens in the SQLite database with
 * AES-256-GCM encryption at rest. The server can independently send
 * experiment emails without requiring the browser to pass tokens on every
 * request.
 *
 * Encryption key: EMAIL_CRED_KEY env var (32-byte hex or base64 string).
 * If unset, a derived key from FOUNDRY_SECRET or a per-process random key
 * is used (the latter means credentials do not survive a restart — a
 * warning is logged).
 *
 * Security:
 *   - Tokens are never logged.
 *   - Decryption happens only inside this module.
 *   - Access is scoped to (org_id, user_id).
 *   - All writes are audited via the audit_log table.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

// ─── Encryption ────────────────────────────────────────────────────────

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM standard nonce length

function resolveKey(): Buffer {
  const raw =
    process.env.EMAIL_CRED_KEY ||
    process.env.FOUNDRY_SECRET ||
    "";
  if (raw) {
    // Accept hex (64 chars = 32 bytes) or any passphrase (derive via scrypt).
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
    if (/^[0-9a-zA-Z+/]{43,44}={0,2}$/.test(raw)) {
      try {
        const b = Buffer.from(raw, "base64");
        if (b.length === 32) return b;
      } catch {
        /* fall through to scrypt */
      }
    }
    return scryptSync(raw, "foundry-email-cred-salt", 32);
  }
  // No key configured — use a per-process random key.
  // Credentials won't survive a restart, but the app still works for the
  // current session. Log a warning once.
  if (!process.env.EMAIL_CRED_KEY_WARNED) {
    console.warn(
      "[credential-store] EMAIL_CRED_KEY not set — using ephemeral key. " +
        "Email credentials will NOT persist across restarts. Set EMAIL_CRED_KEY to a 32-byte hex string for production.",
    );
    process.env.EMAIL_CRED_KEY_WARNED = "1";
  }
  return randomBytes(32);
}

let _key: Buffer | null = null;
function getKey(): Buffer {
  if (!_key) _key = resolveKey();
  return _key;
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack as base64(iv | tag | ciphertext)
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(packed: string): string {
  const buf = Buffer.from(packed, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const enc = buf.subarray(IV_LEN + 16);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

// ─── Types ─────────────────────────────────────────────────────────────

export type EmailProvider = "gmail" | "microsoft";

export interface StoredCredential {
  id: string;
  orgId: string;
  userId: string;
  provider: EmailProvider;
  email: string;
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface SaveCredentialInput {
  orgId: string;
  userId: string;
  provider: EmailProvider;
  email: string;
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  metadata?: Record<string, any>;
}

// ─── CRUD ──────────────────────────────────────────────────────────────

export function saveCredential(input: SaveCredentialInput): StoredCredential {
  const db = getDb();
  const id = randomUUID();
  const metadataJson = JSON.stringify(input.metadata || {});
  const encRefresh = encrypt(input.refreshToken);
  const encAccess = input.accessToken ? encrypt(input.accessToken) : null;

  db.prepare(
    `INSERT INTO email_credentials
       (id, org_id, user_id, provider, email, refresh_token, access_token, access_expires_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id, user_id, provider, email) DO UPDATE SET
       refresh_token = excluded.refresh_token,
       access_token = excluded.access_token,
       access_expires_at = excluded.access_expires_at,
       metadata = excluded.metadata,
       updated_at = datetime('now')`,
  ).run(
    id,
    input.orgId,
    input.userId,
    input.provider,
    input.email,
    encRefresh,
    encAccess,
    input.accessTokenExpiresAt || null,
    metadataJson,
  );

  // Audit
  db.prepare(
    `INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    input.orgId,
    input.userId,
    "email_credential_saved",
    "email_credential",
    id,
    JSON.stringify({ provider: input.provider, email: input.email }),
  );

  return getCredential(input.orgId, input.userId, input.provider, input.email)!;
}

export function getCredential(
  orgId: string,
  userId: string,
  provider: EmailProvider,
  email: string,
): StoredCredential | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM email_credentials
       WHERE org_id = ? AND user_id = ? AND provider = ? AND email = ?`,
    )
    .get(orgId, userId, provider, email) as any;
  if (!row) return null;
  return decodeRow(row);
}

export function getCredentialById(
  orgId: string,
  userId: string,
  credId: string,
): StoredCredential | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM email_credentials WHERE org_id = ? AND user_id = ? AND id = ?`,
    )
    .get(orgId, userId, credId) as any;
  if (!row) return null;
  return decodeRow(row);
}

export function getCredentialsForUser(
  orgId: string,
  userId: string,
): StoredCredential[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM email_credentials WHERE org_id = ? AND user_id = ? ORDER BY provider, email`,
    )
    .all(orgId, userId) as any[];
  return rows.map(decodeRow).filter((c): c is StoredCredential => c !== null);
}

export function deleteCredential(
  orgId: string,
  userId: string,
  credId: string,
): boolean {
  const db = getDb();
  const info = db
    .prepare(
      `DELETE FROM email_credentials WHERE org_id = ? AND user_id = ? AND id = ?`,
    )
    .run(orgId, userId, credId);
  if (info.changes > 0) {
    db.prepare(
      `INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(orgId, userId, "email_credential_deleted", "email_credential", credId);
  }
  return info.changes > 0;
}

export function updateAccessToken(
  orgId: string,
  userId: string,
  credId: string,
  accessToken: string,
  expiresAt: string,
): void {
  const db = getDb();
  const enc = encrypt(accessToken);
  db.prepare(
    `UPDATE email_credentials
     SET access_token = ?, access_expires_at = ?, updated_at = datetime('now')
     WHERE org_id = ? AND user_id = ? AND id = ?`,
  ).run(enc, expiresAt, orgId, userId, credId);
}

// ─── Helpers ───────────────────────────────────────────────────────────

function decodeRow(row: any): StoredCredential | null {
  try {
    return {
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      provider: row.provider as EmailProvider,
      email: row.email,
      refreshToken: decrypt(row.refresh_token),
      accessToken: row.access_token ? decrypt(row.access_token) : null,
      accessTokenExpiresAt: row.access_expires_at || null,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (e) {
    // Decryption failed — likely the encryption key changed since the
    // credential was stored. Log and skip rather than crashing callers.
    console.error(
      `[credential-store] Failed to decrypt credential ${row.id} (${row.provider}/${row.email}):`,
      (e as Error).message,
    );
    return null;
  }
}

/**
 * Return a safe (non-secret) view of a credential for API responses.
 * Never exposes refresh or access tokens.
 */
export function toSafeView(c: StoredCredential) {
  return {
    id: c.id,
    provider: c.provider,
    email: c.email,
    hasRefreshToken: !!c.refreshToken,
    hasAccessToken: !!c.accessToken,
    accessTokenExpiresAt: c.accessTokenExpiresAt,
    metadata: c.metadata,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}
