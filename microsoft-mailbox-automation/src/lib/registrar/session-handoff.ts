/**
 * Encrypted session handoff (SPEC §4).
 *
 * The signup/authentication component establishes a reusable authenticated
 * session and exports it through an encrypted internal handoff so the key
 * rotator can consume it without manual browser interaction.
 *
 * Session material:
 *   - encrypted at rest and in transit (via the shared crypto helper);
 *   - never written to plaintext logs;
 *   - scoped to the intended platform (origin);
 *   - carries an expiration time where available;
 *   - destroyed when no longer required.
 */

import { kvLoad, kvSave, DEFAULT_ORG_ID, ensureDefaultOrg } from "@/lib/db";
import { encrypt, decrypt } from "./crypto";
import { randomUUID } from "crypto";

export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number; // unix seconds; -1 = session cookie
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface SessionHandoff {
  id: string;
  /** Platform/site id this session is scoped to. */
  scopeId: string;
  /** Origin the cookies are valid for. */
  origin: string;
  /** Encrypted cookie blob (ciphertext). */
  encryptedCookies: string;
  createdAt: string;
  /** When the session is no longer valid (ISO), if known. */
  expiresAt: string | null;
  /** Whether the session has been consumed/destroyed. */
  consumed: boolean;
}

const SESSIONS_KV = "registrar.sessions";

function loadSessions(): SessionHandoff[] {
  try {
    ensureDefaultOrg();
    const rows = kvLoad<{ value: string }>(DEFAULT_ORG_ID, SESSIONS_KV);
    if (!rows.length) return [];
    return JSON.parse(decrypt(rows[0].value)) as SessionHandoff[];
  } catch (e) {
    console.error("[registrar/session-handoff] load error:", e);
    return [];
  }
}

function saveSessions(records: SessionHandoff[]): void {
  ensureDefaultOrg();
  const payload = encrypt(JSON.stringify(records));
  kvSave(DEFAULT_ORG_ID, SESSIONS_KV, [{ value: payload }]);
}

/**
 * Export a session produced by the signup/auth component. Cookies are
 * encrypted before storage. Returns the handoff id.
 */
export function exportSession(
  scopeId: string,
  origin: string,
  cookies: SessionCookie[],
  expiresAt: string | null = null,
): string {
  const id = randomUUID();
  const record: SessionHandoff = {
    id,
    scopeId,
    origin,
    encryptedCookies: encrypt(JSON.stringify(cookies)),
    createdAt: new Date().toISOString(),
    expiresAt,
    consumed: false,
  };
  const all = loadSessions();
  // Replace any existing unconsumed session for the same scope.
  const filtered = all.filter((s) => !(s.scopeId === scopeId && !s.consumed));
  filtered.push(record);
  saveSessions(filtered);
  return id;
}

/**
 * Consume a session for a platform. Returns the decrypted cookies and marks
 * the session consumed (so it cannot be reused). Returns null if no valid
 * session exists or it has expired.
 */
export function consumeSession(scopeId: string): SessionCookie[] | null {
  const all = loadSessions();
  const now = Date.now();
  const session = all.find((s) => s.scopeId === scopeId && !s.consumed);
  if (!session) return null;
  if (session.expiresAt && new Date(session.expiresAt).getTime() < now) {
    // Expired — mark consumed and return null.
    session.consumed = true;
    saveSessions(all);
    return null;
  }
  try {
    const cookies = JSON.parse(decrypt(session.encryptedCookies)) as SessionCookie[];
    session.consumed = true;
    saveSessions(all);
    return cookies;
  } catch (e) {
    console.error("[registrar/session-handoff] decrypt error:", e);
    session.consumed = true;
    saveSessions(all);
    return null;
  }
}

/** Peek at session metadata (no decrypted cookies) for status display. */
export function listSessions(): Omit<SessionHandoff, "encryptedCookies">[] {
  return loadSessions().map(({ encryptedCookies: _ec, ...rest }) => rest);
}

/** Destroy all sessions for a scope (SPEC §4: destroyed when no longer required). */
export function destroySessions(scopeId: string): number {
  const all = loadSessions();
  const remaining = all.filter((s) => s.scopeId !== scopeId);
  saveSessions(remaining);
  return all.length - remaining.length;
}

/** Destroy all consumed sessions (cleanup). */
export function purgeConsumedSessions(): number {
  const all = loadSessions();
  const remaining = all.filter((s) => !s.consumed);
  saveSessions(remaining);
  return all.length - remaining.length;
}

/** Convert Playwright cookies to the handoff format. */
export function fromPlaywrightCookies(cookies: any[]): SessionCookie[] {
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || "/",
    expires: c.expires ?? -1,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: (c.sameSite as SessionCookie["sameSite"]) || "Lax",
  }));
}

/** Convert handoff cookies to Playwright's addCookies format. */
export function toPlaywrightCookies(cookies: SessionCookie[]): any[] {
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires > 0 ? c.expires : undefined,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
  }));
}
