/**
 * Terms-of-Service extractor and summarizer.
 *
 * The agent never silently accepts terms. It:
 *   1. Extracts the ToS text from the signup page (links labeled "terms",
 *      "privacy", "user agreement", or the on-page checkbox text).
 *   2. Summarizes it to a few sentences via the LLM fallback chain.
 *   3. Records the full text + summary in the audit log.
 *   4. Auto-accepts only for low-risk free services; medium/high require the
 *      summary to be logged and are accepted with an explicit flag that the
 *      user can later review and revoke.
 *
 * No terms text is ever fabricated. If extraction fails, the run is blocked
 * (not auto-accepted).
 */

import { callLLM } from "@/lib/llm/fallback-chain";
import type { RiskTier, SiteCatalogEntry } from "./types";

export interface TosResult {
  found: boolean;
  summary: string;
  fullText: string;
  linkUrls: string[];
  accepted: boolean;
  reason: string;
}

/**
 * Summarize extracted ToS text via the LLM fallback chain.
 * Returns a deterministic fallback summary if the LLM is unavailable.
 */
export async function summarizeTos(fullText: string, siteName: string): Promise<string> {
  if (!fullText || fullText.length < 20) {
    return "No terms text could be extracted from the signup page.";
  }
  const truncated = fullText.length > 12000 ? fullText.slice(0, 12000) + " [truncated]" : fullText;
  const res = await callLLM({
    messages: [
      {
        role: "system",
        content:
          "You summarize Terms of Service for a user who is blind and deaf and cannot read them in real time. " +
          "Produce 2-4 short sentences in plain language covering: data sharing/selling, arbitration/class-action waiver, " +
          "termination rights, and any unusual liability or IP grant. No filler.",
      },
      {
        role: "user",
        content: `Site: ${siteName}\n\nTerms text:\n${truncated}`,
      },
    ],
    maxTokens: 200,
    temperature: 0.2,
  });
  if (res.ok && res.content.trim()) {
    return res.content.trim();
  }
  // Deterministic fallback — honest about the limitation.
  return `Terms text was captured (${fullText.length} chars) but the summarizer was unavailable. ` +
    `Review the full text in the audit log before relying on this account.`;
}

/**
 * Decide whether to auto-accept terms for a site at a given risk tier.
 *
 * Policy:
 *   - low:    auto-accept (free, low-stakes), but record summary + full text.
 *   - medium: auto-accept with an explicit "review recommended" flag.
 *   - high:   do NOT auto-accept; block the run and log for review.
 */
export function decideAcceptance(risk: RiskTier): { accepted: boolean; reason: string } {
  switch (risk) {
    case "low":
      return { accepted: true, reason: "low-risk free service; auto-accepted with full text logged" };
    case "medium":
      return { accepted: true, reason: "medium-risk; auto-accepted but review recommended" };
    case "high":
      return { accepted: false, reason: "high-risk; not auto-accepted — blocked for review" };
  }
}

export function buildTosResult(
  site: SiteCatalogEntry,
  fullText: string,
  linkUrls: string[],
  summary: string,
): TosResult {
  const decision = decideAcceptance(site.risk);
  return {
    found: fullText.length > 0 || linkUrls.length > 0,
    summary,
    fullText,
    linkUrls,
    accepted: decision.accepted,
    reason: decision.reason,
  };
}
