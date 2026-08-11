import { NextRequest, NextResponse } from "next/server";
import { loadProcessedEmails } from "@/lib/config";
import { ensureFullDemoSeeded } from "@/lib/golden/demo-seed";

export const dynamic = "force-dynamic";

/**
 * GET /api/inbox/attachments?emailId=...&attachmentIndex=...
 * Returns the full parsed attachment data (rows, headers, preview)
 * for a specific email's attachment.
 *
 * Without params, returns all attachments across all emails.
 */
export async function GET(req: NextRequest) {
  try {
    ensureFullDemoSeeded();

    const { searchParams } = new URL(req.url);
    const emailId = searchParams.get("emailId");
    const attachmentIndex = searchParams.get("attachmentIndex");

    const records = loadProcessedEmails();

    if (emailId) {
      const record = records.find((r) => r.emailId === emailId);
      if (!record) {
        return NextResponse.json({ error: "Email not found" }, { status: 404 });
      }

      const tables = record.extractedData?.tables || [];
      const fields = record.extractedData?.fields || [];

      if (attachmentIndex !== null) {
        const idx = parseInt(attachmentIndex);
        const table = tables[idx];
        if (!table) {
          return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
        }
        return NextResponse.json({
          emailId,
          attachmentIndex: idx,
          name: table.name,
          headers: table.headers,
          rows: table.rows,
          rowCount: table.rows.length,
          source: table.source,
          extractedFields: fields.filter((f) => f.key.startsWith(table.name)),
        });
      }

      return NextResponse.json({
        emailId,
        subject: record.subject,
        attachments: tables.map((t, i) => ({
          index: i,
          name: t.name,
          rowCount: t.rows.length,
          headers: t.headers,
          preview: t.rows.slice(0, 5),
        })),
      });
    }

    // Return all attachments across all emails
    const allAttachments: Array<{
      emailId: string;
      subject: string;
      attachmentName: string;
      rowCount: number;
      headers: string[];
      preview: Record<string, string | number>[];
    }> = [];

    for (const record of records) {
      const tables = record.extractedData?.tables || [];
      for (const table of tables) {
        allAttachments.push({
          emailId: record.emailId,
          subject: record.subject,
          attachmentName: table.name,
          rowCount: table.rows.length,
          headers: table.headers,
          preview: table.rows.slice(0, 3),
        });
      }
    }

    return NextResponse.json({
      totalAttachments: allAttachments.length,
      attachments: allAttachments,
    });
  } catch (e: any) {
    console.error("[inbox/attachments] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
