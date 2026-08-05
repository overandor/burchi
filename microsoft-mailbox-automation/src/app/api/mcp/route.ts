import { NextRequest, NextResponse } from "next/server";
import { generateTelemetry, generateMCPContext } from "@/lib/telemetry/engine";
import { loadProcessedEmails } from "@/lib/config";
import { normalizeOrigin, getRequestOrigin } from "@/lib/utils";
import {
  searchEmailsREST,
  fetchEmailREST,
  fetchThreadREST,
  sendEmailREST,
  createDraftREST,
  replyToEmailREST,
  forwardEmailREST,
  markAsReadREST,
  markAsUnreadREST,
  starEmailREST,
  archiveEmailREST,
  trashEmailREST,
  snoozeEmailREST,
  listLabelsREST,
  getProfileREST,
} from "@/lib/gmail/rest-client";
import type { GmailConfig } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * MCP Server endpoint — exposes mailbox telemetry AND email actions as MCP resources and tools.
 *
 * GET  /api/mcp        → returns MCP server manifest (resources + tools)
 * POST /api/mcp        → invokes a tool and returns the result
 *
 * This follows the Model Context Protocol specification so any MCP-compatible
 * LLM client (Claude, ChatGPT, Cursor, etc.) can discover and consume both
 * mailbox intelligence (telemetry) and email actions (search, send, reply, etc.)
 */

const SERVER_INFO = {
  name: "mailbox-intelligence-mcp",
  version: "2.0.0",
  description:
    "Mailbox intelligence MCP — email actions (search, send, reply, triage) + revenue telemetry and efficiency insights",
};

// ─── Helpers ──────────────────────────────────────────────────────

function getGmailConfig(request: NextRequest, body: any): GmailConfig | null {
  const clientId = process.env.GMAIL_CLIENT_ID || "";
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || "";
  const refreshToken =
    body?.refreshToken ||
    request.cookies.get("gmail-refresh-token")?.value ||
    "";
  const redirectUri = `${normalizeOrigin(getRequestOrigin(request))}/api/gmail/callback`;

  if (!clientId || !refreshToken) return null;

  return { clientId, clientSecret, redirectUri, refreshToken, emailAddress: "" };
}

// ─── Email Action Tool Definitions ─────────────────────────────────

const EMAIL_ACTION_TOOLS = [
  {
    name: "search_emails",
    description: "Search emails using Gmail search operators (from:, to:, subject:, has:attachment, is:unread, after:, before:, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query, e.g. 'from:boss@company.com is:unread'" },
        maxResults: { type: "number", description: "Max results (default 50)", default: 50 },
      },
      required: ["query"],
    },
  },
  {
    name: "read_email",
    description: "Read a single email by its ID — returns full body, headers, and attachments metadata",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "Gmail message ID" },
      },
      required: ["messageId"],
    },
  },
  {
    name: "read_thread",
    description: "Read a full email thread (all messages in a conversation)",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "Gmail thread ID" },
      },
      required: ["threadId"],
    },
  },
  {
    name: "send_email",
    description: "Send an email to one or more recipients",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email(s), comma-separated" },
        cc: { type: "string", description: "CC recipients, comma-separated" },
        bcc: { type: "string", description: "BCC recipients, comma-separated" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body (plain text or HTML)" },
        isHtml: { type: "boolean", description: "Whether body is HTML", default: false },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "draft_email",
    description: "Create a draft email (not sent yet — user can review and send later)",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email(s)" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body" },
        isHtml: { type: "boolean", description: "Whether body is HTML", default: false },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "reply_to_email",
    description: "Reply to an existing email — automatically sets In-Reply-To and thread ID",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "ID of the email to reply to" },
        body: { type: "string", description: "Reply body" },
        isHtml: { type: "boolean", description: "Whether body is HTML", default: false },
      },
      required: ["messageId", "body"],
    },
  },
  {
    name: "forward_email",
    description: "Forward an email to a new recipient with an optional note",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "ID of the email to forward" },
        forwardTo: { type: "string", description: "Recipient to forward to" },
        note: { type: "string", description: "Optional note to prepend" },
      },
      required: ["messageId", "forwardTo"],
    },
  },
  {
    name: "mark_as_read",
    description: "Mark an email as read",
    inputSchema: {
      type: "object",
      properties: { messageId: { type: "string" } },
      required: ["messageId"],
    },
  },
  {
    name: "mark_as_unread",
    description: "Mark an email as unread",
    inputSchema: {
      type: "object",
      properties: { messageId: { type: "string" } },
      required: ["messageId"],
    },
  },
  {
    name: "star_email",
    description: "Star an email for follow-up",
    inputSchema: {
      type: "object",
      properties: { messageId: { type: "string" } },
      required: ["messageId"],
    },
  },
  {
    name: "archive_email",
    description: "Archive an email (remove from inbox)",
    inputSchema: {
      type: "object",
      properties: { messageId: { type: "string" } },
      required: ["messageId"],
    },
  },
  {
    name: "trash_email",
    description: "Move an email to trash",
    inputSchema: {
      type: "object",
      properties: { messageId: { type: "string" } },
      required: ["messageId"],
    },
  },
  {
    name: "snooze_email",
    description: "Snooze an email until a specified time (archives it and adds SNOOZED label)",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string" },
        snoozeUntil: { type: "string", description: "ISO date string for when to return to inbox" },
      },
      required: ["messageId", "snoozeUntil"],
    },
  },
  {
    name: "list_labels",
    description: "List all labels in the user's mailbox",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_profile",
    description: "Get the user's Gmail profile (email address, total messages, total threads)",
    inputSchema: { type: "object", properties: {} },
  },
];

// ─── GET: Manifest and read-only actions ──────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "manifest";

  let records: any[] = [];
  try {
    records = loadProcessedEmails();
  } catch (e) {
    console.error("[mcp] loadProcessedEmails error:", e);
  }

  const recordsParam = searchParams.get("records");
  if (recordsParam) {
    try {
      records = JSON.parse(decodeURIComponent(recordsParam));
    } catch (e) {
      console.error("[mcp] records param parse error:", e);
    }
  }

  const userEmail = searchParams.get("user") || "dr.gilead@mailbox.local";
  const report = generateTelemetry(records, userEmail);

  if (action === "manifest") {
    const mcpContext = generateMCPContext(report);
    return NextResponse.json({
      ...SERVER_INFO,
      resources: mcpContext.resources,
      tools: [...mcpContext.tools, ...EMAIL_ACTION_TOOLS],
      capabilities: {
        resources: true,
        tools: true,
        prompts: false,
        sampling: false,
      },
    });
  }

  if (action === "report") return NextResponse.json(report);
  if (action === "insights") return NextResponse.json({ insights: report.topInsights });
  if (action === "efficiency") return NextResponse.json({ efficiencyGains: report.efficiencyGains });

  if (action === "metrics") {
    return NextResponse.json({
      aggregate: report.aggregateMetrics,
      users: report.users.map(u => ({
        user: u.user, email: u.email, metrics: u.metrics,
        revenuePerEmail: u.revenuePerEmail, totalEstimatedRevenue: u.totalEstimatedRevenue,
        totalTimeSavedHours: u.totalTimeSavedHours, efficiencyScore: u.efficiencyScore,
      })),
    });
  }

  if (action === "tools") {
    const mcpContext = generateMCPContext(report);
    return NextResponse.json({ tools: [...mcpContext.tools, ...EMAIL_ACTION_TOOLS] });
  }

  if (action === "resources") {
    const mcpContext = generateMCPContext(report);
    return NextResponse.json({ resources: mcpContext.resources });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}

// ─── POST: Tool invocation ────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const toolName = body.tool || body.name;
    const userEmail = body.user || "dr.gilead@mailbox.local";

    // Telemetry tools (don't need Gmail config)
    let records: any[] = [];
    if (body.records && Array.isArray(body.records)) {
      records = body.records;
    } else {
      try { records = loadProcessedEmails(); } catch (e) { console.error("[mcp] loadProcessedEmails error:", e); }
    }

    const report = generateTelemetry(records, userEmail);

    // ─── Action-based responses (for telemetry page) ───
    const action = body.action;
    if (action === "report") return NextResponse.json(report);
    if (action === "insights") return NextResponse.json({ insights: report.topInsights });
    if (action === "efficiency") return NextResponse.json({ efficiencyGains: report.efficiencyGains });
    if (action === "manifest" || (!action && !toolName)) {
      // Return manifest
      const manifest = {
        server: { name: "mailbox-automation", version: "1.0.0" },
        resources: [
          { uri: "mailbox://telemetry/report", name: "Telemetry Report", description: "Full telemetry report with revenue, efficiency, and insights", mimeType: "application/json" },
          { uri: "mailbox://telemetry/insights", name: "Top Insights", description: "Actionable insights sorted by estimated value", mimeType: "application/json" },
          { uri: "mailbox://telemetry/efficiency", name: "Efficiency Gains", description: "Time savings and efficiency improvements", mimeType: "application/json" },
        ],
        tools: [
          { name: "get_revenue_report", description: "Get aggregate revenue report", inputSchema: { type: "object", properties: {} } },
          { name: "get_user_metrics", description: "Get per-user metrics", inputSchema: { type: "object", properties: {} } },
          { name: "get_insights", description: "Get top actionable insights", inputSchema: { type: "object", properties: {} } },
          { name: "get_efficiency_gains", description: "Get efficiency gains", inputSchema: { type: "object", properties: {} } },
          { name: "search_emails", description: "Search emails in Gmail", inputSchema: { type: "object", properties: { query: { type: "string" }, maxResults: { type: "number" } } } },
          { name: "send_email", description: "Send an email", inputSchema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } } } },
        ],
      };
      return NextResponse.json(manifest);
    }

    // ─── Telemetry tools ───
    switch (toolName) {
      case "get_revenue_report":
        return NextResponse.json({
          tool: toolName,
          result: {
            aggregateMetrics: report.aggregateMetrics,
            revenueByCategory: report.revenueByCategory,
            totalUsers: report.totalUsers,
            generatedAt: report.generatedAt,
          },
        });

      case "get_user_metrics":
        return NextResponse.json({
          tool: toolName,
          result: report.users.map(u => ({
            user: u.user, email: u.email, totalEmails: u.totalEmails,
            processedEmails: u.processedEmails, metrics: u.metrics,
            revenuePerEmail: u.revenuePerEmail, totalEstimatedRevenue: u.totalEstimatedRevenue,
            totalTimeSavedHours: u.totalTimeSavedHours, efficiencyScore: u.efficiencyScore,
            topSenders: u.topSenders, categoryBreakdown: u.categoryBreakdown,
          })),
        });

      case "get_insights":
        return NextResponse.json({ tool: toolName, result: report.topInsights });

      case "get_efficiency_gains":
        return NextResponse.json({ tool: toolName, result: report.efficiencyGains });
    }

    // ─── Email action tools (need Gmail config) ───
    const gmailConfig = getGmailConfig(request, body);
    if (!gmailConfig) {
      return NextResponse.json({
        error: "Gmail not connected. Provide refreshToken in the request body or connect Gmail first.",
        availableTelemetryTools: ["get_revenue_report", "get_user_metrics", "get_insights", "get_efficiency_gains"],
      }, { status: 401 });
    }

    switch (toolName) {
      case "search_emails": {
        const results = await searchEmailsREST(gmailConfig, body.query || "", body.maxResults || 50);
        return NextResponse.json({ tool: toolName, result: results });
      }

      case "read_email": {
        const email = await fetchEmailREST(gmailConfig, body.messageId);
        return NextResponse.json({ tool: toolName, result: email });
      }

      case "read_thread": {
        const thread = await fetchThreadREST(gmailConfig, body.threadId);
        return NextResponse.json({ tool: toolName, result: thread });
      }

      case "send_email": {
        const result = await sendEmailREST(gmailConfig, {
          to: body.to,
          cc: body.cc,
          bcc: body.bcc,
          subject: body.subject,
          body: body.body,
          isHtml: body.isHtml,
        });
        return NextResponse.json({ tool: toolName, result });
      }

      case "draft_email": {
        const result = await createDraftREST(gmailConfig, {
          to: body.to,
          cc: body.cc,
          subject: body.subject,
          body: body.body,
          isHtml: body.isHtml,
        });
        return NextResponse.json({ tool: toolName, result });
      }

      case "reply_to_email": {
        const result = await replyToEmailREST(gmailConfig, body.messageId, body.body, body.isHtml);
        return NextResponse.json({ tool: toolName, result });
      }

      case "forward_email": {
        const result = await forwardEmailREST(gmailConfig, body.messageId, body.forwardTo, body.note);
        return NextResponse.json({ tool: toolName, result });
      }

      case "mark_as_read": {
        await markAsReadREST(gmailConfig, body.messageId);
        return NextResponse.json({ tool: toolName, result: { success: true } });
      }

      case "mark_as_unread": {
        await markAsUnreadREST(gmailConfig, body.messageId);
        return NextResponse.json({ tool: toolName, result: { success: true } });
      }

      case "star_email": {
        await starEmailREST(gmailConfig, body.messageId);
        return NextResponse.json({ tool: toolName, result: { success: true } });
      }

      case "archive_email": {
        await archiveEmailREST(gmailConfig, body.messageId);
        return NextResponse.json({ tool: toolName, result: { success: true } });
      }

      case "trash_email": {
        await trashEmailREST(gmailConfig, body.messageId);
        return NextResponse.json({ tool: toolName, result: { success: true } });
      }

      case "snooze_email": {
        await snoozeEmailREST(gmailConfig, body.messageId, body.snoozeUntil);
        return NextResponse.json({ tool: toolName, result: { success: true, snoozeUntil: body.snoozeUntil } });
      }

      case "list_labels": {
        const labels = await listLabelsREST(gmailConfig);
        return NextResponse.json({ tool: toolName, result: labels });
      }

      case "get_profile": {
        const profile = await getProfileREST(gmailConfig);
        return NextResponse.json({ tool: toolName, result: profile });
      }

      default:
        return NextResponse.json({
          error: `Unknown tool: ${toolName}`,
          availableTools: [
            "get_revenue_report", "get_user_metrics", "get_insights", "get_efficiency_gains",
            "search_emails", "read_email", "read_thread", "send_email", "draft_email",
            "reply_to_email", "forward_email", "mark_as_read", "mark_as_unread",
            "star_email", "archive_email", "trash_email", "snooze_email",
            "list_labels", "get_profile",
          ],
        }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
