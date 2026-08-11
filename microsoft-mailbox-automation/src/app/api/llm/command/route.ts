import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent/executor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/llm/command
 *
 * Voice command agent. Interprets spoken or typed commands and
 * executes them by calling internal API endpoints.
 *
 * The agent can:
 *   - Navigate to any page
 *   - List and query data (assignments, hypotheses, outcomes, etc.)
 *   - Take actions (accept/reject missions, record outcomes, sync email)
 *   - Chain multiple API calls to fulfill complex requests
 *   - Search and triage email from connected mailboxes
 *   - Run competitive intelligence queries
 *   - Sync CRM data
 *
 * Every conversation is logged to voice_conversation_log for backup.
 *
 * Body:
 *   text: string — the spoken or typed command
 *   context?: string — current page URL
 *   conversationId?: string — for multi-turn conversations
 *   employeeId?: string — which employee is speaking
 *   history?: { role, content }[] — prior conversation turns
 *
 * Returns:
 *   {
 *     speech: string — text to speak back to the user,
 *     actionsTaken: [{ tool, args, result, success }],
 *     llmUsed: boolean,
 *     llmProvider?: string,
 *     conversationId: string,
 *     navigateTo?: string — page to navigate to,
 *     error?: string,
 *   }
 */
export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const text = body.text;
    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const context = body.context || "/today";
    const conversationId = body.conversationId;
    const employeeId = body.employeeId || "gilead-rep-001";
    const history = body.history || [];
    const pageContent = body.pageContent;

    const result = await runAgent({
      text,
      context,
      pageContent,
      conversationId,
      employeeId,
      history,
    });

    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[llm/command] error:", e);
    return NextResponse.json(
      {
        speech: "I encountered an error processing that command. Please try again.",
        actionsTaken: [],
        llmUsed: false,
        conversationId: "error",
        error: String(e),
      },
      { status: 200 },
    );
  }
}

/**
 * GET /api/llm/command
 * Returns conversation logs and statistics.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "stats";

    if (action === "conversations") {
      const { listConversations } = await import("@/lib/agent/conversation-log");
      const limit = parseInt(searchParams.get("limit") || "20", 10);
      const conversations = listConversations(limit);
      return NextResponse.json({ conversations, count: conversations.length });
    }

    if (action === "conversation") {
      const { getConversation } = await import("@/lib/agent/conversation-log");
      const conversationId = searchParams.get("conversationId");
      if (!conversationId) {
        return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
      }
      const turns = getConversation(conversationId);
      return NextResponse.json({ turns, count: turns.length });
    }

    if (action === "export") {
      const { exportAllLogs } = await import("@/lib/agent/conversation-log");
      const logs = exportAllLogs();
      return NextResponse.json({ logs, count: logs.length });
    }

    // Default: stats
    const { getConversationStats } = await import("@/lib/agent/conversation-log");
    const stats = getConversationStats();
    return NextResponse.json(stats);
  } catch (e: any) {
    console.error("[llm/command] GET error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
