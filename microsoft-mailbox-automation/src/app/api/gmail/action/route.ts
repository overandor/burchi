import { NextRequest, NextResponse } from "next/server";
import {
  markAsReadREST,
  markAsUnreadREST,
  starEmailREST,
  archiveEmailREST,
  trashEmailREST,
  snoozeEmailREST,
  modifyLabelsREST,
} from "@/lib/gmail/rest-client";
import { normalizeOrigin, getRequestOrigin } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Generic email action endpoint.
 * POST /api/gmail/action
 * Body: { action: "read"|"unread"|"star"|"archive"|"trash"|"snooze"|"modify", messageId, ... }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const clientId = process.env.GMAIL_CLIENT_ID || "";
    const clientSecret = process.env.GMAIL_CLIENT_SECRET || "";
    const refreshToken = body.refreshToken || request.cookies.get("gmail-refresh-token")?.value || "";

    if (!clientId || !refreshToken) {
      return NextResponse.json({ error: "Gmail not connected" }, { status: 401 });
    }

    if (!body.messageId) {
      return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    }

    const redirectUri = `${normalizeOrigin(getRequestOrigin(request))}/api/gmail/callback`;
    const config = { clientId, clientSecret, redirectUri, refreshToken, emailAddress: "" };

    switch (body.action) {
      case "read":
        await markAsReadREST(config, body.messageId);
        return NextResponse.json({ success: true, action: "read" });

      case "unread":
        await markAsUnreadREST(config, body.messageId);
        return NextResponse.json({ success: true, action: "unread" });

      case "star":
        await starEmailREST(config, body.messageId);
        return NextResponse.json({ success: true, action: "star" });

      case "archive":
        await archiveEmailREST(config, body.messageId);
        return NextResponse.json({ success: true, action: "archive" });

      case "trash":
        await trashEmailREST(config, body.messageId);
        return NextResponse.json({ success: true, action: "trash" });

      case "snooze":
        if (!body.snoozeUntil) {
          return NextResponse.json({ error: "snoozeUntil is required for snooze action" }, { status: 400 });
        }
        await snoozeEmailREST(config, body.messageId, body.snoozeUntil);
        return NextResponse.json({ success: true, action: "snooze", snoozeUntil: body.snoozeUntil });

      case "modify":
        await modifyLabelsREST(config, body.messageId, {
          addLabelIds: body.addLabelIds,
          removeLabelIds: body.removeLabelIds,
        });
        return NextResponse.json({ success: true, action: "modify" });

      default:
        return NextResponse.json({
          error: `Unknown action: ${body.action}`,
          availableActions: ["read", "unread", "star", "archive", "trash", "snooze", "modify"],
        }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
