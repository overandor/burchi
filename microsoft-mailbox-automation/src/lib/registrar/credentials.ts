/**
 * Password + username generation.
 *
 * Passwords are strong, unique per site, and stored only in the encrypted vault.
 * Usernames are derived from the identity profile's stem plus a short site
 * suffix to avoid collisions across services.
 */

import { randomBytes, scryptSync } from "crypto";
import type { IdentityProfile, SiteCatalogEntry } from "./types";

const LOWER = "abcdefghijkmnpqrstuvwxyz"; // no l/o to reduce ambiguity
const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMS = "!@#$%^&*-_=+";

export function generatePassword(length = 20): string {
  const all = LOWER + UPPER + DIGITS + SYMS;
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += all[bytes[i] % all.length];
  // Guarantee at least one of each class for picker validators.
  const ensure = [LOWER, UPPER, DIGITS, SYMS].map((set) => set[randomBytes(1)[0] % set.length]);
  // Splice the guaranteed chars into deterministic positions.
  const positions = [0, 1, 2, 3];
  const arr = out.split("");
  positions.forEach((p, i) => (arr[p] = ensure[i]));
  return arr.join("");
}

/**
 * Derive a deterministic, unique-per-site username from the identity stem.
 * Deterministic so re-runs don't create duplicate accounts; the site suffix
 * avoids cross-service collisions.
 */
export function deriveUsername(profile: IdentityProfile, site: SiteCatalogEntry): string {
  const stem = profile.usernameStem.toLowerCase().replace(/[^a-z0-9]/g, "");
  const suffix = scryptSync(`${profile.email}|${site.id}`, "registrar-username", 4)
    .toString("hex")
    .slice(0, 4);
  return `${stem}${suffix}`;
}
