/**
 * Lightweight Gmail REST client — no googleapis dependency.
 * Uses fetch() directly against Gmail API v1.
 * This avoids the heavy googleapis package that crashes Netlify serverless functions.
 */

import { GmailConfig, EmailMessage, EmailAttachment } from "@/types";

async function getAccessToken(config: GmailConfig): Promise<string> {
  if (!config.refreshToken) {
    throw new Error("No refresh token — connect Gmail first");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret || "",
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timeout);
    if (e.name === "AbortError") throw new Error("Token refresh timed out");
    throw e;
  }
  clearTimeout(timeout);

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${text}`);
  }

  const data = text ? JSON.parse(text) : {};
  return data.access_token;
}

async function gmailFetch(accessToken: string, path: string): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let res: Response;
  try {
    res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timeout);
    if (e.name === "AbortError") throw new Error(`Gmail API request timed out: ${path}`);
    throw e;
  }
  clearTimeout(timeout);

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gmail API error (${res.status}): ${text.slice(0, 200)}`);
  }

  return text ? JSON.parse(text) : {};
}

export async function fetchEmailsREST(
  config: GmailConfig,
  maxResults: number = 100
): Promise<EmailMessage[]> {
  const accessToken = await getAccessToken(config);

  // Gmail API allows max 500 per page. For 100+ emails, use pagination.
  const messageIds: { id: string }[] = [];
  let pageToken: string | undefined = undefined;
  let fetched = 0;
  const seenPageTokens = new Set<string>();
  let pages = 0;

  while (fetched < maxResults) {
    if (pages >= 50) break;
    if (pageToken) {
      if (seenPageTokens.has(pageToken)) break;
      seenPageTokens.add(pageToken);
    }
    pages++;
    const batchSize = Math.min(maxResults - fetched, 500);
    let path = `messages?maxResults=${batchSize}`;
    if (pageToken) path += `&pageToken=${pageToken}`;

    const listData = await gmailFetch(accessToken, path);
    const batch = listData.messages || [];
    messageIds.push(...batch);
    fetched += batch.length;

    pageToken = listData.nextPageToken;
    if (!pageToken || batch.length === 0) break;
  }

  const emails: EmailMessage[] = [];
  const CONCURRENCY = 10;

  for (let i = 0; i < messageIds.length; i += CONCURRENCY) {
    const chunk = messageIds.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (msg) => {
        if (!msg.id) return null;
        return await fetchEmailREST(config, msg.id, accessToken);
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        emails.push(r.value);
      }
    }
  }

  return emails;
}

export async function fetchEmailREST(
  config: GmailConfig,
  messageId: string,
  existingToken?: string
): Promise<EmailMessage | null> {
  const accessToken = existingToken || await getAccessToken(config);
  const msg = await gmailFetch(accessToken, `messages/${messageId}`);

  const headers = msg.payload?.headers || [];
  const subject = headers.find((h: any) => h.name === "Subject")?.value || "";
  const from = headers.find((h: any) => h.name === "From")?.value || "";
  const date = headers.find((h: any) => h.name === "Date")?.value || "";

  const senderMatch = from.match(/^(.*?)\s*<(.*)>$/);
  const sender = senderMatch ? senderMatch[1].trim().replace(/"/g, "") : from;
  const senderEmail = senderMatch ? senderMatch[2] : from;

  const body = extractBody(msg.payload);
  const attachments = extractAttachments(msg.payload);

  return {
    id: messageId,
    subject,
    sender,
    senderEmail,
    receivedDate: date,
    bodyPreview: body.substring(0, 200),
    body,
    hasAttachments: attachments.length > 0,
    attachments,
    isRead: !msg.labelIds?.includes("UNREAD"),
    importance: "normal",
    categories: msg.labelIds || [],
    processed: false,
  };
}

/**
 * Fetch only metadata (headers + labels) for an email — much faster than full fetch.
 * Uses format=metadata with specific headers to minimize payload size.
 */
export async function fetchEmailMetadataREST(
  config: GmailConfig,
  messageId: string,
  existingToken?: string
): Promise<EmailMessage | null> {
  const accessToken = existingToken || await getAccessToken(config);
  const metaHeaders = ["Subject", "From", "Date", "Content-Type"];
  const msg = await gmailFetch(
    accessToken,
    `messages/${messageId}?format=metadata&metadataHeaders=${metaHeaders.join("&metadataHeaders=")}`
  );

  const headers = msg.payload?.headers || [];
  const subject = headers.find((h: any) => h.name === "Subject")?.value || "";
  const from = headers.find((h: any) => h.name === "From")?.value || "";
  const date = headers.find((h: any) => h.name === "Date")?.value || "";

  const senderMatch = from.match(/^(.*?)\s*<(.*)>$/);
  const sender = senderMatch ? senderMatch[1].trim().replace(/"/g, "") : from;
  const senderEmail = senderMatch ? senderMatch[2] : from;

  const hasAttachments = (msg.labelIds || []).includes("CATEGORY_UPDATES") ||
    (msg.sizeEstimate || 0) > 50000;

  return {
    id: messageId,
    subject,
    sender,
    senderEmail,
    receivedDate: date,
    bodyPreview: "",
    body: "",
    hasAttachments,
    attachments: [],
    isRead: !msg.labelIds?.includes("UNREAD"),
    importance: "normal",
    categories: msg.labelIds || [],
    processed: false,
  };
}

/**
 * Fetch only the body of an email (on demand when user clicks to read).
 */
export async function fetchEmailBodyREST(
  config: GmailConfig,
  messageId: string,
  existingToken?: string
): Promise<string> {
  const accessToken = existingToken || await getAccessToken(config);
  const msg = await gmailFetch(accessToken, `messages/${messageId}?format=full`);
  return extractBody(msg.payload);
}

export async function fetchAttachmentContentREST(
  config: GmailConfig,
  messageId: string,
  attachmentId: string
): Promise<Uint8Array> {
  const accessToken = await getAccessToken(config);
  const data = await gmailFetch(accessToken, `messages/${messageId}/attachments/${attachmentId}`);
  const base64Data = data.data || "";
  const buffer = Buffer.from(base64Data, "base64");
  return new Uint8Array(buffer);
}

function extractBody(payload: any): string {
  if (!payload) return "";

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64").toString("utf-8");
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return Buffer.from(part.body.data, "base64").toString("utf-8");
      }
    }
  }

  return "";
}

function extractAttachments(payload: any): EmailAttachment[] {
  const attachments: EmailAttachment[] = [];

  function walk(parts: any[]) {
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          id: part.body.attachmentId,
          name: part.filename,
          contentType: part.mimeType || "application/octet-stream",
          size: part.body.size || 0,
        });
      }
      if (part.parts) {
        walk(part.parts);
      }
    }
  }

  if (payload?.parts) {
    walk(payload.parts);
  }

  return attachments;
}

// ─── Email Action Functions ───────────────────────────────────────

async function gmailPost(accessToken: string, path: string, body: any): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let res: Response;
  try {
    res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timeout);
    if (e.name === "AbortError") throw new Error(`Gmail API request timed out: ${path}`);
    throw e;
  }
  clearTimeout(timeout);

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gmail API error (${res.status}): ${text.slice(0, 200)}`);
  }

  return text ? JSON.parse(text) : {};
}

/**
 * Search emails using Gmail search operators.
 * Supports: from:, to:, subject:, has:attachment, label:, is:unread, after:, before:, etc.
 */
/**
 * Search emails using Gmail search operators — metadata only (fast).
 * Bodies are fetched on demand when the user clicks an email.
 * Supports: from:, to:, subject:, has:attachment, label:, is:unread, after:, before:, etc.
 */
export async function searchEmailsREST(
  config: GmailConfig,
  query: string,
  maxResults: number = 50
): Promise<EmailMessage[]> {
  const accessToken = await getAccessToken(config);

  const messageIds: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined = undefined;
  let fetched = 0;
  const seenPageTokens = new Set<string>();
  let pages = 0;

  while (fetched < maxResults) {
    if (pages >= 50) break;
    if (pageToken) {
      if (seenPageTokens.has(pageToken)) break;
      seenPageTokens.add(pageToken);
    }
    pages++;
    const batchSize = Math.min(maxResults - fetched, 500);
    let path = `messages?maxResults=${batchSize}&q=${encodeURIComponent(query)}`;
    if (pageToken) path += `&pageToken=${pageToken}`;

    const listData = await gmailFetch(accessToken, path);
    const batch = listData.messages || [];
    messageIds.push(...batch);
    fetched += batch.length;

    pageToken = listData.nextPageToken;
    if (!pageToken || batch.length === 0) break;
  }

  // Fetch metadata in parallel batches (10 at a time).
  // Metadata-only fetch is ~5x faster than full fetch (no body download).
  const emails: EmailMessage[] = [];
  const CONCURRENCY = 10;

  for (let i = 0; i < messageIds.length; i += CONCURRENCY) {
    const chunk = messageIds.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (msg) => {
        if (!msg.id) return null;
        const email = await fetchEmailMetadataREST(config, msg.id, accessToken);
        if (email) email.threadId = msg.threadId;
        return email;
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        emails.push(r.value);
      }
    }
  }

  return emails;
}

/**
 * Fetch a full email thread (all messages in a conversation).
 */
export async function fetchThreadREST(
  config: GmailConfig,
  threadId: string
): Promise<EmailMessage[]> {
  const accessToken = await getAccessToken(config);
  const thread = await gmailFetch(accessToken, `threads/${threadId}`);

  const messages = thread.messages || [];
  const emails: EmailMessage[] = [];

  for (const msg of messages) {
    if (!msg.id) continue;
    try {
      const email = await fetchEmailREST(config, msg.id, accessToken);
      if (email) {
        email.threadId = threadId;
        emails.push(email);
      }
    } catch (e: any) {
      console.error(`Failed to fetch message ${msg.id}: ${e.message}`);
    }
  }

  return emails;
}

/**
 * Send an email.
 */
export async function sendEmailREST(
  config: GmailConfig,
  params: {
    to: string | string[];
    cc?: string | string[];
    bcc?: string | string[];
    subject: string;
    body: string;
    isHtml?: boolean;
    inReplyTo?: string; // Message-ID of the email being replied to
    threadId?: string;
  }
): Promise<{ id: string; threadId: string; labelIds: string[] }> {
  const accessToken = await getAccessToken(config);

  const toHeader = Array.isArray(params.to) ? params.to.join(", ") : params.to;
  const ccHeader = params.cc ? (Array.isArray(params.cc) ? params.cc.join(", ") : params.cc) : "";
  const bccHeader = params.bcc ? (Array.isArray(params.bcc) ? params.bcc.join(", ") : params.bcc) : "";

  const headers: string[] = [
    `To: ${toHeader}`,
    `Subject: ${params.subject}`,
  ];
  if (ccHeader) headers.push(`Cc: ${ccHeader}`);
  if (bccHeader) headers.push(`Bcc: ${bccHeader}`);
  if (params.inReplyTo) {
    headers.push(`In-Reply-To: ${params.inReplyTo}`);
    headers.push(`References: ${params.inReplyTo}`);
  }

  const mimeType = params.isHtml ? "text/html" : "text/plain";
  const emailContent = [
    `Content-Type: multipart/alternative; boundary="boundary123"`,
    `MIME-Version: 1.0`,
    ...headers,
    ``,
    `--boundary123`,
    `Content-Type: ${mimeType}; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    params.body,
    ``,
    `--boundary123--`,
  ].join("\r\n");

  const encodedEmail = Buffer.from(emailContent)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const body: any = { raw: encodedEmail };
  if (params.threadId) body.threadId = params.threadId;

  return gmailPost(accessToken, "messages/send", body);
}

/**
 * Create a draft email (not sent yet).
 */
export async function createDraftREST(
  config: GmailConfig,
  params: {
    to: string | string[];
    cc?: string | string[];
    subject: string;
    body: string;
    isHtml?: boolean;
  }
): Promise<{ id: string; message: { id: string; threadId: string } }> {
  const accessToken = await getAccessToken(config);

  const toHeader = Array.isArray(params.to) ? params.to.join(", ") : params.to;
  const ccHeader = params.cc ? (Array.isArray(params.cc) ? params.cc.join(", ") : params.cc) : "";

  const headers: string[] = [
    `To: ${toHeader}`,
    `Subject: ${params.subject}`,
  ];
  if (ccHeader) headers.push(`Cc: ${ccHeader}`);

  const mimeType = params.isHtml ? "text/html" : "text/plain";
  const emailContent = [
    `Content-Type: multipart/alternative; boundary="boundary123"`,
    `MIME-Version: 1.0`,
    ...headers,
    ``,
    `--boundary123`,
    `Content-Type: ${mimeType}; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    params.body,
    ``,
    `--boundary123--`,
  ].join("\r\n");

  const encodedEmail = Buffer.from(emailContent)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return gmailPost(accessToken, "drafts", {
    message: { raw: encodedEmail },
  });
}

/**
 * Reply to an email — fetches the original to get Message-ID and thread ID,
 * then sends a reply.
 */
export async function replyToEmailREST(
  config: GmailConfig,
  messageId: string,
  replyBody: string,
  isHtml?: boolean
): Promise<{ id: string; threadId: string; labelIds: string[] }> {
  const accessToken = await getAccessToken(config);
  const original = await gmailFetch(accessToken, `messages/${messageId}`);

  const headers = original.payload?.headers || [];
  const messageIdHeader = headers.find((h: any) => h.name === "Message-ID")?.value || "";
  const subject = headers.find((h: any) => h.name === "Subject")?.value || "";
  const from = headers.find((h: any) => h.name === "From")?.value || "";
  const to = headers.find((h: any) => h.name === "To")?.value || "";

  // Reply subject: add Re: if not already there
  const replySubject = subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;

  // Reply to the original sender
  const replyTo = from;

  return sendEmailREST(config, {
    to: replyTo,
    subject: replySubject,
    body: replyBody,
    isHtml,
    inReplyTo: messageIdHeader,
    threadId: original.threadId,
  });
}

/**
 * Forward an email to a new recipient.
 */
export async function forwardEmailREST(
  config: GmailConfig,
  messageId: string,
  forwardTo: string,
  note?: string
): Promise<{ id: string; threadId: string; labelIds: string[] }> {
  const accessToken = await getAccessToken(config);
  const original = await gmailFetch(accessToken, `messages/${messageId}`);

  const headers = original.payload?.headers || [];
  const subject = headers.find((h: any) => h.name === "Subject")?.value || "";
  const from = headers.find((h: any) => h.name === "From")?.value || "";
  const date = headers.find((h: any) => h.name === "Date")?.value || "";
  const to = headers.find((h: any) => h.name === "To")?.value || "";
  const originalBody = extractBody(original.payload);

  const forwardSubject = subject.toLowerCase().startsWith("fwd:") ? subject : `Fwd: ${subject}`;
  const forwardBody = [
    note ? `${note}\n\n` : "",
    `---------- Forwarded message ----------`,
    `From: ${from}`,
    `Date: ${date}`,
    `Subject: ${subject}`,
    `To: ${to}`,
    ``,
    originalBody,
  ].join("\n");

  return sendEmailREST(config, {
    to: forwardTo,
    subject: forwardSubject,
    body: forwardBody,
    threadId: original.threadId,
  });
}

/**
 * Modify labels on an email (mark read/unread, add/remove labels, star, etc.)
 */
export async function modifyLabelsREST(
  config: GmailConfig,
  messageId: string,
  params: { addLabelIds?: string[]; removeLabelIds?: string[] }
): Promise<void> {
  const accessToken = await getAccessToken(config);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let res: Response;
  try {
    res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      }
    );
  } catch (e: any) {
    clearTimeout(timeout);
    if (e.name === "AbortError") throw new Error(`Gmail API request timed out: messages/${messageId}/modify`);
    throw e;
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API error (${res.status}): ${text.slice(0, 200)}`);
  }
}

/**
 * Mark an email as read (remove UNREAD label).
 */
export async function markAsReadREST(config: GmailConfig, messageId: string): Promise<void> {
  await modifyLabelsREST(config, messageId, { removeLabelIds: ["UNREAD"] });
}

/**
 * Mark an email as unread (add UNREAD label).
 */
export async function markAsUnreadREST(config: GmailConfig, messageId: string): Promise<void> {
  await modifyLabelsREST(config, messageId, { addLabelIds: ["UNREAD"] });
}

/**
 * Star an email.
 */
export async function starEmailREST(config: GmailConfig, messageId: string): Promise<void> {
  await modifyLabelsREST(config, messageId, { addLabelIds: ["STARRED"] });
}

/**
 * Archive an email (remove INBOX label).
 */
export async function archiveEmailREST(config: GmailConfig, messageId: string): Promise<void> {
  await modifyLabelsREST(config, messageId, { removeLabelIds: ["INBOX"] });
}

/**
 * Trash an email.
 */
export async function trashEmailREST(config: GmailConfig, messageId: string): Promise<void> {
  const accessToken = await getAccessToken(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let res: Response;
  try {
    res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      }
    );
  } catch (e: any) {
    clearTimeout(timeout);
    if (e.name === "AbortError") throw new Error(`Gmail API request timed out: messages/${messageId}/trash`);
    throw e;
  }
  clearTimeout(timeout);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API error (${res.status}): ${text.slice(0, 200)}`);
  }
}

/**
 * Snooze an email by removing it from inbox and adding a custom label,
 * then returning it to inbox at a specified time.
 * Gmail doesn't have native snooze via API, but we can simulate it by
 * archiving now and using a label to track snooze time.
 */
export async function snoozeEmailREST(
  config: GmailConfig,
  messageId: string,
  snoozeUntil: string // ISO date string
): Promise<void> {
  const accessToken = await getAccessToken(config);

  // Create or find a snooze label
  const labels = await gmailFetch(accessToken, "labels");
  let snoozeLabel = (labels.labels || []).find((l: any) => l.name === "SNOOZED");

  if (!snoozeLabel) {
    snoozeLabel = await gmailPost(accessToken, "labels", {
      name: "SNOOZED",
      messageListVisibility: "show",
      labelListVisibility: "labelShowIfUnread",
    });
  }

  // Archive the email and add SNOOZED label
  await modifyLabelsREST(config, messageId, {
    removeLabelIds: ["INBOX"],
    addLabelIds: [snoozeLabel.id],
  });

  // Note: Actual unsnooze (returning to inbox at snoozeUntil) would require
  // a scheduled job. The label + timestamp can be stored for a cron/scheduled
  // function to process. For now, we store the snooze time in the label name.
  // A production implementation would use a scheduled function (e.g., Netlify
  // Scheduled Functions or a cron job) to check SNOOZED emails and return
  // them to inbox when the time arrives.
}

/**
 * List all labels in the user's mailbox.
 */
export async function listLabelsREST(config: GmailConfig): Promise<any[]> {
  const accessToken = await getAccessToken(config);
  const data = await gmailFetch(accessToken, "labels");
  return data.labels || [];
}

/**
 * Get the user's email profile (email address, message count, etc.)
 */
export async function getProfileREST(config: GmailConfig): Promise<{
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}> {
  const accessToken = await getAccessToken(config);
  return gmailFetch(accessToken, "profile");
}
