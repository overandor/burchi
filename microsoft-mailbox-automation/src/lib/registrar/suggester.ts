/**
 * Service suggester — recommends free services the user does not yet have an
 * account on, based on a tag overlap between their needs profile and the
 * site catalog.
 */

import { SITE_CATALOG } from "./catalog";
import { hasCredential } from "./vault";
import type { IdentityProfile, Suggestion } from "./types";

export function suggestServices(profile: IdentityProfile, limit = 10): Suggestion[] {
  const needs = profile.needs.map((n) => n.toLowerCase());
  const scored: Suggestion[] = [];

  for (const site of SITE_CATALOG) {
    if (hasCredential(site.id)) continue; // already have an account
    const siteTags = site.tags.map((t) => t.toLowerCase());
    const overlap = siteTags.filter((t) => needs.includes(t)).length;
    if (overlap === 0 && needs.length > 0) continue; // no relevance
    const matchScore = needs.length ? overlap / needs.length : 0.5;
    const reason =
      overlap > 0
        ? `matches your needs: ${siteTags.filter((t) => needs.includes(t)).join(", ")}`
        : `general-purpose free service in the ${site.category} category`;
    scored.push({ site, reason, matchScore });
  }

  scored.sort((a, b) => b.matchScore - a.matchScore);
  return scored.slice(0, limit);
}
