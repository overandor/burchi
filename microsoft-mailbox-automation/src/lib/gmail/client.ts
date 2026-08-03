import { google } from "googleapis";
import { GmailConfig, EmailMessage, EmailAttachment } from "@/types";

export function createGmailClient(config: GmailConfig) {
  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );

  if (config.refreshToken) {
    oauth2Client.setCredentials({
      refresh_token: config.refreshToken,
    });
  }

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  return { gmail, oauth2Client };
}

export function getAuthUrl(config: GmailConfig): string {
  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
    prompt: "consent",
  });
}

export async function exchangeCodeForTokens(
  config: GmailConfig,
  code: string
): Promise<{ refreshToken: string; accessToken: string }> {
  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );

  const { tokens } = await oauth2Client.getToken(code);
  return {
    refreshToken: tokens.refresh_token || "",
    accessToken: tokens.access_token || "",
  };
}

export async function fetchEmails(
  config: GmailConfig,
  maxResults: number = 100
): Promise<EmailMessage[]> {
  const { gmail } = createGmailClient(config);

  const listRes = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q: "has:attachment",
  });

  const messageIds = listRes.data.messages || [];
  const emails: EmailMessage[] = [];

  for (const msg of messageIds) {
    if (!msg.id) continue;
    const email = await fetchEmail(config, msg.id);
    if (email) emails.push(email);
  }

  return emails;
}

export async function fetchEmail(
  config: GmailConfig,
  messageId: string
): Promise<EmailMessage | null> {
  const { gmail } = createGmailClient(config);

  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
  });

  const msg = res.data;
  if (!msg) return null;

  const headers = msg.payload?.headers || [];
  const subject = headers.find((h) => h.name === "Subject")?.value || "";
  const from = headers.find((h) => h.name === "From")?.value || "";
  const date = headers.find((h) => h.name === "Date")?.value || "";

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

export async function fetchAttachmentContent(
  config: GmailConfig,
  messageId: string,
  attachmentId: string
): Promise<Uint8Array> {
  const { gmail } = createGmailClient(config);

  const res = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });

  const data = res.data.data || "";
  const buffer = Buffer.from(data, "base64");
  return new Uint8Array(buffer);
}
