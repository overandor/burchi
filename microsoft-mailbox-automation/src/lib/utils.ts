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
  const override = process.env.NEXT_PUBLIC_OAUTH_REDIRECT_BASE;
  if (override) return override.replace(/\/$/, "");
  return origin.replace(/127\.0\.0\.1/, "localhost");
}
