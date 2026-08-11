/**
 * Email verification — reads the user's mailbox for a verification link
 * from a freshly-registered service.
 *
 * Reuses the existing Gmail REST client and Microsoft Graph client. The
 * provider is selected from the identity profile's email domain.
 */

import { loadConfig } from "@/lib/config";
import { fetchEmailsREST } from "@/lib/gmail/rest-client";
import { fetchEmails as graphFetchEmails } from "@/lib/graph/client";

const LINK_RE = /https?:\/\/[^\s"'<>]+/gi;

export interface VerificationResult {
  found: boolean;
  link?: string;
  sender?: string;
  subject?: string;
  error?: string;
}

function providerFor(email: string): "gmail" | "microsoft" | "unknown" {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (domain.endsWith("gmail.com") || domain.endsWith("googlemail.com")) return "gmail";
  if (
    domain.endsWith("outlook.com") ||
    domain.endsWith("hotmail.com") ||
    domain.endsWith("live.com") ||
    domain.endsWith("msn.com") ||
    domain.endsWith("yahoo.com") // yahoo handled via microsoft? no — unknown
  ) {
    return domain.endsWith("yahoo.com") ? "unknown" : "microsoft";
  }
  return "unknown";
}

/**
 * Poll the mailbox for a verification email matching `senderContains`,
 * extract the first plausible verification link, and return it.
 *
 * @param email       the user's mailbox address
 * @param senderContains  substring to match in the sender address
 * @param timeoutMs   total time to wait (default 120s)
 * @param pollMs      interval between polls (default 10s)
 */
export async function waitForVerificationLink(
  email: string,
  senderContains: string,
  timeoutMs = 120_000,
  pollMs = 10_000,
): Promise<VerificationResult> {
  if (!senderContains) {
    return { found: false, error: "no verification sender filter provided for this site" };
  }
  const provider = providerFor(email);
  if (provider === "unknown") {
    return {
      found: false,
      error: `mailbox provider for ${email} not configured for automatic verification; ` +
        `check the inbox manually and click the verification link`,
    };
  }

  const config = loadConfig();
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      let messages: { from?: string; subject?: string; body?: string; date?: string }[] = [];
      if (provider === "gmail") {
        const cfg = {
          clientId: process.env.GMAIL_CLIENT_ID || "",
          clientSecret: process.env.GMAIL_CLIENT_SECRET || "",
          refreshToken: process.env.GMAIL_REFRESH_TOKEN || "",
          email,
        };
        const emails = await fetchEmailsREST(cfg as any, 20);
        messages = emails.map((e: any) => ({
          from: e.from,
          subject: e.subject,
          body: e.body,
          date: e.date,
        }));
      } else {
        const emails = await graphFetchEmails(config, 20);
        messages = emails.map((e: any) => ({
          from: e.from?.emailAddress?.address,
          subject: e.subject,
          body: e.body?.content,
          date: e.receivedDateTime,
        }));
      }

      for (const m of messages) {
        const from = (m.from || "").toLowerCase();
        if (from.includes(senderContains.toLowerCase())) {
          const body = m.body || "";
          const matches = body.match(LINK_RE) || [];
          // Prefer links that look like verification/confirm.
          const verifyLink =
            matches.find((l) => /verif|confirm|activate|click|enable/i.test(l)) || matches[0];
          if (verifyLink) {
            return { found: true, link: verifyLink, sender: m.from, subject: m.subject };
          }
        }
      }
    } catch (e: any) {
      lastError = e.message;
      console.warn(`[registrar/verify] poll error: ${lastError}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  return {
    found: false,
    error: `no verification email from "${senderContains}" within ${timeoutMs / 1000}s. ` +
      (lastError ? `last error: ${lastError}` : "check the inbox manually."),
  };
}
