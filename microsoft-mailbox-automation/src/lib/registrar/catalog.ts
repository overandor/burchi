/**
 * Curated catalog of free services suitable for autonomous, hands-off signup.
 *
 * Inclusion criteria:
 *   - Genuinely free tier (not just trial).
 *   - Email-only or OAuth signup (no forced phone, no forced CAPTCHA where
 *     possible). Sites known to CAPTCHA are marked hasCaptcha and will be
 *     handled by the runner's accessibility path, not bypassed.
 *   - Useful to a single user building a personal digital footprint.
 *
 * Selectors are best-effort heuristics; the runner also falls back to
 * label/aria matching when a selector misses.
 */

import type { SiteCatalogEntry } from "./types";

export const SITE_CATALOG: SiteCatalogEntry[] = [
  {
    id: "protonmail",
    name: "Proton Mail",
    url: "https://proton.me",
    signupUrl: "https://account.proton.me/signup",
    category: "email",
    description: "Free encrypted email with 1GB storage. Good foundation identity.",
    strategy: "email_verify",
    risk: "low",
    free: true,
    fields: [
      { fill: "username", label: "username", required: true },
      { fill: "password", label: "password", required: true },
      { fill: "password", label: "confirm password", required: true },
      { fill: "email", label: "recovery email", required: false },
    ],
    submitSelector: "button[type=submit]",
    hasCaptcha: true, // Proton uses hCaptcha; accommodation path required
    accessibilityContact: "contact@proton.me",
    verificationSenderContains: "proton",
    tags: ["email", "privacy", "identity", "communication"],
  },
  {
    id: "tutanota",
    name: "Tuta (Tutanota)",
    url: "https://tuta.com",
    signupUrl: "https://app.tuta.com/signup",
    category: "email",
    description: "Free encrypted email, 1GB, no phone required on free tier.",
    strategy: "email_verify",
    risk: "low",
    free: true,
    fields: [
      { fill: "username", label: "user name", required: true },
      { fill: "password", label: "password", required: true },
      { fill: "password", label: "confirm", required: true },
    ],
    submitSelector: "button[type=submit]",
    hasCaptcha: true,
    accessibilityContact: "hello@tutao.de",
    verificationSenderContains: "tuta",
    tags: ["email", "privacy", "identity", "communication"],
  },
  {
    id: "github",
    name: "GitHub",
    url: "https://github.com",
    signupUrl: "https://github.com/signup",
    category: "code",
    description: "Free code hosting, CI, and developer identity.",
    strategy: "email_verify",
    risk: "low",
    free: true,
    fields: [
      { fill: "email", label: "email", required: true },
      { fill: "password", label: "password", required: true },
      { fill: "username", label: "username", required: true },
      { fill: "custom", customValue: "n", label: "email preferences", required: false },
    ],
    submitSelector: "button[type=submit]",
    hasCaptcha: true, // GitHub uses a puzzle CAPTCHA
    verificationSenderContains: "github",
    tags: ["code", "developer", "identity", "storage", "ci"],
  },
  {
    id: "gitlab",
    name: "GitLab",
    url: "https://gitlab.com",
    signupUrl: "https://gitlab.com/users/sign_up",
    category: "code",
    description: "Free code hosting with CI/CD.",
    strategy: "email_verify",
    risk: "low",
    free: true,
    fields: [
      { fill: "firstName", label: "first name", required: false },
      { fill: "lastName", label: "last name", required: false },
      { fill: "username", label: "username", required: true },
      { fill: "email", label: "email", required: true },
      { fill: "password", label: "password", required: true },
    ],
    submitSelector: "button[type=submit]",
    hasCaptcha: true,
    verificationSenderContains: "gitlab",
    tags: ["code", "developer", "identity", "storage", "ci"],
  },
  {
    id: "mastodon-social",
    name: "Mastodon (mastodon.social)",
    url: "https://mastodon.social",
    signupUrl: "https://mastodon.social/auth/sign_up",
    category: "social",
    description: "Free federated social account on the flagship instance.",
    strategy: "email_verify",
    risk: "low",
    free: true,
    fields: [
      { fill: "username", label: "username", required: true },
      { fill: "email", label: "email", required: true },
      { fill: "password", label: "password", required: true },
      { fill: "password", label: "password confirmation", required: true },
    ],
    submitSelector: "button[type=submit]",
    hasCaptcha: false,
    verificationSenderContains: "mastodon",
    tags: ["social", "communication", "identity"],
  },
  {
    id: "internetarchive",
    name: "Internet Archive",
    url: "https://archive.org",
    signupUrl: "https://archive.org/account/signup",
    category: "library",
    description: "Free account to borrow books, save web pages, upload.",
    strategy: "email_verify",
    risk: "low",
    free: true,
    fields: [
      { fill: "email", label: "email", required: true },
      { fill: "username", label: "screen name", required: true },
      { fill: "password", label: "password", required: true },
    ],
    submitSelector: "button[type=submit]",
    hasCaptcha: true,
    verificationSenderContains: "archive.org",
    tags: ["library", "books", "research", "identity"],
  },
  {
    id: "wikipedia",
    name: "Wikipedia / Wikimedia",
    url: "https://www.wikipedia.org",
    signupUrl: "https://en.wikipedia.org/w/index.php?title=Special:CreateAccount",
    category: "knowledge",
    description: "Free account to edit Wikipedia and use Wikimedia tools.",
    strategy: "email_only",
    risk: "low",
    free: true,
    fields: [
      { fill: "username", label: "username", required: true },
      { fill: "password", label: "password", required: true },
      { fill: "password", label: "confirm password", required: true },
      { fill: "email", label: "email", required: false },
    ],
    submitSelector: "button[type=submit]",
    hasCaptcha: true,
    verificationSenderContains: "wikimedia",
    tags: ["knowledge", "research", "identity"],
  },
  {
    id: "openstreetmap",
    name: "OpenStreetMap",
    url: "https://www.openstreetmap.org",
    signupUrl: "https://www.openstreetmap.org/user/new",
    category: "maps",
    description: "Free account to contribute to the open map of the world.",
    strategy: "email_only",
    risk: "low",
    free: true,
    fields: [
      { fill: "email", label: "email", required: true },
      { fill: "email", label: "confirm email", required: true },
      { fill: "username", label: "display name", required: true },
      { fill: "password", label: "password", required: true },
      { fill: "password", label: "confirm password", required: true },
    ],
    submitSelector: "button[type=submit]",
    hasCaptcha: false,
    verificationSenderContains: "openstreetmap",
    tags: ["maps", "geography", "identity"],
  },
  {
    id: "keybase",
    name: "Keybase",
    url: "https://keybase.io",
    signupUrl: "https://keybase.io/",
    category: "identity",
    description: "Cryptographic identity, encrypted storage, free.",
    strategy: "email_only",
    risk: "medium",
    free: true,
    fields: [
      { fill: "username", label: "username", required: true },
      { fill: "email", label: "email", required: true },
    ],
    submitSelector: "button[type=submit]",
    hasCaptcha: false,
    tags: ["identity", "privacy", "security"],
  },
  {
    id: "jsbin",
    name: "JS Bin",
    url: "https://jsbin.com",
    signupUrl: "https://jsbin.com/register",
    category: "code",
    description: "Free JavaScript/CSS scratchpad and sharing.",
    strategy: "email_only",
    risk: "low",
    free: true,
    fields: [
      { fill: "username", label: "username", required: true },
      { fill: "email", label: "email", required: true },
      { fill: "password", label: "password", required: true },
    ],
    submitSelector: "button[type=submit]",
    hasCaptcha: false,
    tags: ["code", "developer", "tools"],
  },
];

export function getSiteById(id: string): SiteCatalogEntry | undefined {
  return SITE_CATALOG.find((s) => s.id === id);
}

export function listSites(): SiteCatalogEntry[] {
  return SITE_CATALOG;
}
