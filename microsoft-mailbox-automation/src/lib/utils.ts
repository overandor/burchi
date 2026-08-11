import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}

/**
 * Normalize an origin URL for OAuth redirect URIs.
 * Google OAuth treats `127.0.0.1` and `localhost` as different redirect URIs.
 * `localhost` is allowed for loopback without explicit registration, but
 * `127.0.0.1` must be registered in the Google Cloud Console. This normalizes
 * `127.0.0.1` → `localhost` so the app works regardless of which address is used.
 *
 * If NEXT_PUBLIC_OAUTH_REDIRECT_BASE is set, it overrides the detected origin
 * entirely — useful when the app is accessed through a proxy (e.g. Devin preview)
 * on a different port than what's registered in the Google/Azure console.
 */
export function normalizeOrigin(origin: string): string {
  const envBase = process.env.NEXT_PUBLIC_OAUTH_REDIRECT_BASE;
  const base = typeof envBase === "string" && envBase.trim() ? envBase : origin;
  return base.replace(/127\.0\.0\.1/, "localhost").replace(/\/$/, "");
}

/**
 * Get the external origin from a Next.js request, accounting for reverse proxies
 * (Fly.io, Netlify, etc.) that set X-Forwarded-Host / X-Forwarded-Proto headers.
 */
export function getRequestOrigin(request: { headers: Headers; nextUrl: URL }): string {
  const xfHost = request.headers.get("x-forwarded-host");
  const xfProto = request.headers.get("x-forwarded-proto") || "https";
  const host = xfHost || request.headers.get("host") || request.nextUrl.host;
  return normalizeOrigin(`${xfProto}://${host}`);
}

/**
 * Safely parse a string as JSON. Returns null if the string is empty, null,
 * or not valid JSON (e.g. an HTML error page returned by a serverless
 * function or reverse proxy). This prevents the common
 * "Unexpected token '<'" crash when a fetch returns HTML instead of JSON.
 */
export function safeJson<T = any>(text: string | null | undefined): T | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Fast reject: JSON never starts with '<' (HTML) or '<!' (doctype)
  if (trimmed[0] === "<") return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

/**
 * Parse a Response body as JSON defensively. Reads text first so we never
 * throw on non-JSON bodies, and returns null instead of crashing.
 */
export async function safeJsonResponse<T = any>(res: Response): Promise<T | null> {
  const text = await res.text().catch(() => "");
  return safeJson<T>(text);
}
