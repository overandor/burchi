import { NextRequest, NextResponse } from "next/server";
import { loadConfig, loadProcessedEmails, saveProcessedEmails } from "@/lib/config";
import { getEmail, fetchAttachments } from "@/lib/graph/client";
import { parseAttachment } from "@/lib/parsers/attachment-parser";
import { extractDataFromEmail } from "@/lib/llm/extractor";
import { nanoid } from "nanoid";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const config = loadConfig();
    const body = await request.json();
    const { emailId } = body;

    if (!emailId) {
      return NextResponse.json({ error: "emailId is required" }, { status: 400 });
    }

    const userToken = request.headers.get("Authorization")?.replace("Bearer ", "") || undefined;
    const email = await getEmail(config, emailId, userToken);

    let parsedAttachments = [];
    if (email.hasAttachments) {
      const attachments = await fetchAttachments(config, emailId, userToken);
      for (const att of attachments) {
        try {
          const parsed = await parseAttachment(att);
          parsedAttachments.push(parsed);
        } catch (e: any) {
          console.error(`Failed to parse attachment ${att.name}:`, e.message);
        }
      }
    }

    const extractedData = await extractDataFromEmail(email, parsedAttachments, config);

    const record = {
      id: nanoid(),
      emailId: email.id,
      subject: email.subject,
      sender: email.sender,
      senderEmail: email.senderEmail,
      receivedDate: email.receivedDate,
      processedAt: new Date().toISOString(),
      category: extractedData.category,
      confidence: extractedData.confidence,
      fieldCount: extractedData.fields.length,
      tableCount: extractedData.tables.length,
      extractedData,
    };

    const records = loadProcessedEmails();
    const existingIdx = records.findIndex((r) => r.emailId === emailId);
    if (existingIdx >= 0) {
      records[existingIdx] = record;
    } else {
      records.unshift(record);
    }
    saveProcessedEmails(records);

    return NextResponse.json({ success: true, record });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
