import { AppConfig, EmailMessage, EmailAttachment } from "@/types";

interface GraphTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(config: AppConfig, userToken?: string): Promise<string> {
  if (userToken) {
    return userToken;
  }

  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const url = `https://login.microsoftonline.com/${config.graph.tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: config.graph.clientId,
    client_secret: config.graph.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const data: GraphTokenResponse = await response.json().catch(() => ({}));
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 300) * 1000,
  };

  return data.access_token;
}

function userPrefix(userToken: string | undefined, mailbox: string): string {
  if (userToken) return "/me";
  return `/users/${mailbox}`;
}

async function graphRequest(
  token: string,
  endpoint: string,
  method: string = "GET",
  body?: unknown
): Promise<any> {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `https://graph.microsoft.com/v1.0${endpoint}`;

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response: Response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Graph API error (${response.status}): ${error}`);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function fetchEmails(
  config: AppConfig,
  maxEmails: number = 50,
  folderId: string = "inbox",
  userToken?: string
): Promise<EmailMessage[]> {
  const token = await getAccessToken(config, userToken);
  const mailbox = config.graph.mailbox;
  const prefix = userPrefix(userToken, mailbox);

  const endpoint = `${prefix}/mailFolders/${folderId}/messages?$top=${maxEmails}&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,isRead,importance,categories,body&$orderby=receivedDateTime desc`;

  const data = await graphRequest(token, endpoint);

  if (!data.value || data.value.length === 0) {
    return [];
  }

  return data.value.map((msg: any): EmailMessage => ({
    id: msg.id,
    subject: msg.subject || "(No Subject)",
    sender: msg.from?.emailAddress?.name || "Unknown",
    senderEmail: msg.from?.emailAddress?.address || "unknown@example.com",
    receivedDate: msg.receivedDateTime,
    bodyPreview: msg.bodyPreview || "",
    body: msg.body?.content || "",
    hasAttachments: msg.hasAttachments || false,
    attachments: [],
    isRead: msg.isRead || false,
    importance: msg.importance || "normal",
    categories: msg.categories || [],
    processed: false,
  }));
}

export async function fetchAttachments(
  config: AppConfig,
  emailId: string,
  userToken?: string
): Promise<EmailAttachment[]> {
  const token = await getAccessToken(config, userToken);
  const mailbox = config.graph.mailbox;
  const prefix = userPrefix(userToken, mailbox);

  const endpoint = `${prefix}/messages/${emailId}/attachments`;
  const data = await graphRequest(token, endpoint);

  if (!data.value || data.value.length === 0) {
    return [];
  }

  return data.value.map((att: any): EmailAttachment => ({
    id: att.id,
    name: att.name || "unknown",
    contentType: att.contentType || "application/octet-stream",
    size: att.size || 0,
    content: att.contentBytes
      ? new Uint8Array(
        atob(att.contentBytes)
          .split("")
          .map((c) => c.charCodeAt(0))
      )
      : undefined,
  }));
}

export async function sendEmailGraph(
  token: string,
  mailbox: string,
  params: {
    to: string | string[];
    subject: string;
    body: string;
    isHtml?: boolean;
    inReplyTo?: string;
    replyTo?: string;
  },
): Promise<{ id: string }> {
  const toRecipients = (Array.isArray(params.to) ? params.to : [params.to]).map((addr) => ({
    emailAddress: { address: addr },
  }));

  const body: any = {
    message: {
      subject: params.subject,
      body: {
        contentType: params.isHtml ? "HTML" : "Text",
        content: params.body,
      },
      toRecipients,
    },
    saveToSentItems: true,
  };

  if (params.inReplyTo) {
    body.message.internetMessageHeaders = [
      { name: "In-Reply-To", value: params.inReplyTo },
      { name: "References", value: params.inReplyTo },
    ];
  }
  if (params.replyTo) {
    body.message.replyTo = [{ emailAddress: { address: params.replyTo } }];
  }

  const from = token ? "/me" : `/users/${mailbox}`;
  const result = await graphRequest(token, `${from}/sendMail`, "POST", body);
  // Graph sendMail returns 202 Accepted with empty body on success
  return { id: result?.id || "sent" };
}

export async function markEmailAsRead(
  config: AppConfig,
  emailId: string,
  userToken?: string
): Promise<void> {
  const token = await getAccessToken(config, userToken);
  const mailbox = config.graph.mailbox;
  const prefix = userPrefix(userToken, mailbox);

  await graphRequest(token, `${prefix}/messages/${emailId}`, "PATCH", {
    isRead: true,
  });
}

export async function getEmail(
  config: AppConfig,
  emailId: string,
  userToken?: string
): Promise<EmailMessage> {
  const token = await getAccessToken(config, userToken);
  const mailbox = config.graph.mailbox;
  const prefix = userPrefix(userToken, mailbox);

  const endpoint = `${prefix}/messages/${emailId}?$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,isRead,importance,categories,body`;

  const msg = await graphRequest(token, endpoint);

  return {
    id: msg.id,
    subject: msg.subject || "(No Subject)",
    sender: msg.from?.emailAddress?.name || "Unknown",
    senderEmail: msg.from?.emailAddress?.address || "unknown@example.com",
    receivedDate: msg.receivedDateTime,
    bodyPreview: msg.bodyPreview || "",
    body: msg.body?.content || "",
    hasAttachments: msg.hasAttachments || false,
    attachments: [],
    isRead: msg.isRead || false,
    importance: msg.importance || "normal",
    categories: msg.categories || [],
    processed: false,
  };
}

export async function listFolders(
  config: AppConfig,
  userToken?: string
): Promise<{ id: string; name: string }[]> {
  const token = await getAccessToken(config, userToken);
  const mailbox = config.graph.mailbox;
  const prefix = userPrefix(userToken, mailbox);

  const data = await graphRequest(
    token,
    `${prefix}/mailFolders?$select=id,displayName`
  );

  return (data.value || []).map((f: any) => ({
    id: f.id,
    name: f.displayName,
  }));
}

export function validateConfig(config: AppConfig): string[] {
  const errors: string[] = [];
  if (!config.graph.clientId) errors.push("Graph client ID is required");
  if (!config.graph.tenantId) errors.push("Graph tenant ID is required");
  if (!config.llm.apiKey) errors.push("LLM API key is required");
  return errors;
}
