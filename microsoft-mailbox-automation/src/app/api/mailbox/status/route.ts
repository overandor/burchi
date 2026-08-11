import { NextResponse } from "next/server";
import { loadSyncStatus, loadProcessedEmails } from "@/lib/config";
import { ensureFullDemoSeeded, detectInboxProvider } from "@/lib/golden/demo-seed";
import { loadEmails } from "@/lib/spinor/email-engine";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/mailbox/status
 * Returns inbox status with recent emails (including attachment metadata)
 * and the auto-detected provider configuration.
 */
export async function GET() {
  try {
    // Seed demo data on first load so all pages have content.
    ensureFullDemoSeeded();

    const status = loadSyncStatus();
    const records = loadProcessedEmails();

    // If a user is logged in, let credential detection know about stored tokens.
    let provider;
    try {
      const ctx = await getAuthContext();
      provider = detectInboxProvider({ orgId: ctx.orgId, userId: ctx.user.id });
    } catch {
      provider = detectInboxProvider();
    }

    const realEmails = loadEmails();

    // Combine real persisted emails with processed records, deduplicating by emailId
    const seenIds = new Set<string>();
    const allRecords = [
      ...realEmails.map((e) => ({
        emailId: e.id,
        subject: e.subject,
        sender: e.from,
        senderEmail: e.from,
        receivedDate: e.date,
        extractedData: {
          summary: e.body.slice(0, 160),
          fields: [] as any[],
          tables: [] as any[],
        },
        category: e.category,
        confidence: e.confidence,
        isRead: e.isRead,
        processed: e.processed,
        source: e.source,
        accountId: e.accountId,
      })),
      ...records,
    ].filter((r) => {
      const key = r.emailId;
      if (seenIds.has(key)) return false;
      seenIds.add(key);
      return true;
    });

    // Map ProcessedEmailRecord → inbox email format with attachment info
    const recentEmails = allRecords.slice(0, 20).map((r) => {
      const tables = r.extractedData?.tables || [];
      const fields = r.extractedData?.fields || [];
      const attachments = tables.map((t, i) => ({
        id: `att_${r.emailId}_${i}`,
        name: t.name,
        contentType: t.name.endsWith(".csv") ? "text/csv" : t.name.endsWith(".json") ? "application/json" : "application/octet-stream",
        size: JSON.stringify(t.rows).length,
        rowCount: t.rows.length,
        headers: t.headers,
        parsedType: "csv",
        preview: t.rows.slice(0, 3),
      }));

      return {
        id: r.emailId,
        subject: r.subject,
        from: r.sender,
        fromEmail: r.senderEmail,
        date: r.receivedDate,
        preview: r.extractedData?.summary || r.subject,
        body: r.extractedData?.summary || "",
        hasAttachments: tables.length > 0,
        attachmentCount: tables.length,
        attachments,
        category: r.category,
        confidence: r.confidence,
        fieldCount: fields.length,
        tableCount: tables.length,
        extractedFields: fields.slice(0, 10),
        isRead: true,
        processed: true,
      };
    });

    return NextResponse.json({
      ...status,
      recentEmails,
      recentRecords: allRecords.slice(0, 10),
      provider,
      realEmailCount: realEmails.length,
      totalEmails: allRecords.length,
      totalAttachments: recentEmails.reduce((sum, e) => sum + (e.attachmentCount || 0), 0),
      totalExtractedFields: allRecords.reduce((sum, r) => sum + (r.extractedData?.fields?.length || 0), 0),
      totalExtractedTables: allRecords.reduce((sum, r) => sum + (r.extractedData?.tables?.length || 0), 0),
    });
  } catch (e: any) {
    console.error("[mailbox/status] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
