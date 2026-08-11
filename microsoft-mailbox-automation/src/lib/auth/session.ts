/**
 * Server-side session management.
 *
 * Provides token-based authentication with org-scoped identity.
 * Tokens are stored in HTTP-only cookies and validated against
 * the SQLite sessions table.
 *
 * For the Gilead demo, pre-seeded users are available without
 * external OAuth providers.
 */

import { cookies } from "next/headers";
import { nanoid } from "nanoid";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import {
  createSession,
  getSessionByToken,
  deleteSession,
  getUser,
  createOrganization,
  getOrganizationBySlug,
  createUser,
  ensureDefaultOrg,
  DEFAULT_ORG_ID,
  setUserPasswordHash,
  getUserByEmail,
  userExistsByEmail,
  _getDb as getDb,
  type User,
  type Session,
} from "@/lib/db";
import { auditLog } from "@/lib/db";

export const SESSION_COOKIE = "foundry_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AuthContext {
  user: User;
  orgId: string;
  isAuthenticated: boolean;
  token: string;
}

/**
 * Get the current auth context from the request cookies.
 * Returns a demo context if no session is found (backwards compatibility).
 */
export async function getAuthContext(): Promise<AuthContext> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    const session = getSessionByToken(token);
    if (session) {
      const user = getUser(session.user_id);
      if (user) {
        return { user, orgId: session.org_id, isAuthenticated: true, token };
      }
    }
  }

  // Fall back to demo user (backwards compatibility with existing code)
  ensureDefaultOrg();
  const demoUser = getOrCreateDemoUser();
  return {
    user: demoUser,
    orgId: DEFAULT_ORG_ID,
    isAuthenticated: false,
    token: "",
  };
}

/**
 * Require an authenticated session. Returns the auth context or throws
 * an error suitable for returning a 401 from an API route.
 */
export async function requireAuthContext(): Promise<AuthContext> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    throw new Error("Authentication required");
  }

  const session = getSessionByToken(token);
  if (!session) {
    throw new Error("Session expired or invalid");
  }

  const user = getUser(session.user_id);
  if (!user) {
    throw new Error("User not found");
  }

  return { user, orgId: session.org_id, isAuthenticated: true, token };
}

/**
 * Get the current user ID (replaces hardcoded "emp-001").
 */
export async function getCurrentUserId(): Promise<string> {
  const ctx = await getAuthContext();
  return ctx.user.id;
}

/**
 * Get the current org ID (replaces hardcoded "foundry").
 */
export async function getCurrentOrgId(): Promise<string> {
  const ctx = await getAuthContext();
  return ctx.orgId;
}

/**
 * Hash a plaintext password with a random salt using scrypt.
 * Format: salt:hash (both base64url).
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(32).toString("base64url");
  const derived = scryptSync(password, salt, 64).toString("base64url");
  return `${salt}:${derived}`;
}

/**
 * Verify a plaintext password against a stored hash.
 */
export function verifyPassword(password: string, hash: string): boolean {
  const parts = hash.split(":");
  if (parts.length !== 2) return false;
  const [salt, stored] = parts;
  try {
    const derived = scryptSync(password, salt, 64);
    const storedBuf = Buffer.from(stored, "base64url");
    if (derived.length !== storedBuf.length) return false;
    return timingSafeEqual(derived, storedBuf);
  } catch {
    return false;
  }
}

/**
 * Login with email and password.
 * Verifies the password against the users table. No demo credentials.
 */
export function loginWithEmail(
  orgSlug: string,
  email: string,
  password: string,
): { success: boolean; token?: string; error?: string } {
  const org = getOrganizationBySlug(orgSlug);
  if (!org) {
    return { success: false, error: "Organization not found" };
  }

  const user = getUserByEmail(org.id, email);
  if (!user || !user.password_hash) {
    return { success: false, error: "Invalid credentials" };
  }

  if (!verifyPassword(password, user.password_hash)) {
    return { success: false, error: "Invalid credentials" };
  }

  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  createSession(`sess_${nanoid(16)}`, user.id, org.id, token, expiresAt);

  auditLog(org.id, user.id, "auth.login", "user", user.id);

  return { success: true, token };
}

/**
 * Register a new organization and user, or a new user in an existing org.
 * Requires the FOUNDRY_SETUP_TOKEN env var when any user already exists,
 * to prevent open registration on a deployed instance.
 */
export function registerUser(input: {
  orgSlug: string;
  orgName?: string;
  email: string;
  password: string;
  name: string;
  role?: string;
  therapeuticArea?: string | null;
  setupToken?: string;
}): { success: boolean; user?: User; error?: string } {
  const setupToken = process.env.FOUNDRY_SETUP_TOKEN;
  const anyUser = getDb().prepare("SELECT 1 FROM users LIMIT 1").get() as
    | { "1": number }
    | undefined;

  if (anyUser && setupToken && input.setupToken !== setupToken) {
    return {
      success: false,
      error: "A setup token is required to register additional users",
    };
  }

  let org = getOrganizationBySlug(input.orgSlug);
  if (!org) {
    if (anyUser && !input.setupToken) {
      return { success: false, error: "Organization not found" };
    }
    org = createOrganization(
      input.orgSlug,
      input.orgName || input.orgSlug,
      input.orgSlug,
      { tier: "enterprise", industry: "pharma" },
    );
  }

  if (userExistsByEmail(org.id, input.email)) {
    return { success: false, error: "Email already registered" };
  }

  const userId = `usr_${nanoid(12)}`;
  const user = createUser(
    userId,
    org.id,
    input.email,
    input.name,
    input.role || "field_rep",
    input.therapeuticArea || null,
  );

  setUserPasswordHash(user.id, hashPassword(input.password));

  auditLog(org.id, user.id, "auth.register", "user", user.id);

  return { success: true, user: { ...user, password_hash: null } };
}

/**
 * Logout the current user by deleting their session.
 */
export async function logout(): Promise<void> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    deleteSession(token);
  }
}

/**
 * Set the session cookie in the response.
 */
export function setSessionCookie(token: string): void {
  const secure = process.env.NODE_ENV === "production";
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });
}

/**
 * Clear the session cookie.
 */
export function clearSessionCookie(): void {
  cookies().delete(SESSION_COOKIE);
}

/** Set or reset a user's password. */
export function setUserPassword(userId: string, password: string): void {
  setUserPasswordHash(userId, hashPassword(password));
}

// ─── Demo user management ─────────────────────────────────────────────

/** Demo credentials for pitch demos. Empty by default — real auth uses password_hash. */
const DEMO_CREDENTIALS: Record<string, { userId: string; password: string; name: string; role: string; therapeuticArea?: string }> = {};

let _demoUser: User | null = null;

function getOrCreateDemoUser(): User {
  if (_demoUser) return _demoUser;
  ensureDefaultOrg();
  const demoId = "emp-001";
  let user = getUser(demoId);
  if (!user) {
    user = createUser(
      demoId,
      DEFAULT_ORG_ID,
      "demo@advantagefoundry.com",
      "Demo User",
      "field_rep",
      null,
    );
  }
  _demoUser = user;
  return user;
}

// ─── Demo credentials (removed) ───────────────────────────────────────
// Real authentication uses the users.password_hash column and the
// register / login flows. No hardcoded accounts are retained.

/**
 * Ensure the Gilead demo organization and user exist.
 * Called by the /api/demo/gilead-seed endpoint before seeding
 * Gilead-specific demo data.
 */
export function ensureGileadDemoOrg(): void {
  ensureDefaultOrg();
  const gileadUserId = "emp-gilead-001";
  let user = getUser(gileadUserId);
  if (!user) {
    user = createUser(
      gileadUserId,
      DEFAULT_ORG_ID,
      "gilead-demo@advantagefoundry.com",
      "Gilead Demo User",
      "field_rep",
      "Oncology",
    );
  }
}
