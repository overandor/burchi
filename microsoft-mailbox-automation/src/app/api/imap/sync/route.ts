import { NextRequest, NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { ProcessedEmailRecord, ParsedAttachmentData } from "@/types";
import { generateAnalysis } from "@/lib/analysis/generator";
import { extractDataFromEmail } from "@/lib/llm/extractor";
import { loadConfig } from "@/lib/config";
import { generateTelemetry } from "@/lib/telemetry/engine";
import { nanoid } from "nanoid";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/imap/sync — fetch emails via IMAP AND run the full analysis pipeline.
 *
 * This is the IMAP equivalent of /api/gmail/sync. It:
 *   1. Connects to the IMAP server
 *   2. Fetches recent messages (with body text)
 *   3. Runs generateAnalysis() → wikitree, mindmap, execution plan
 *   4. Runs extractDataFromEmail() → fields, tables, summary, category
 *   5. Returns processed records + telemetry
 *
 * Body: { email, password, host?, port?, maxEmails?, folder? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));

  const email = body.email || "";
  const password = body.password || "";
  const host = body.host || "outlook.office365.com";
  const port = parseInt(body.port?.toString() || "993");
  const maxEmails = body.maxEmails || 50;
  const folder = body.folder || "INBOX";

  if (!email || !password) {
    return NextResponse.json(
      { error: "IMAP credentials not provided. Connect Microsoft 365 in Settings first." },
      { status: 400 }
    );
  }

  const client = new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: { user: email, pass: password },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const uids = await client.search({ all: true }, { uid: true });
      const uidList = Array.isArray(uids) ? uids : [];
      const recentUids = uidList.slice(-maxEmails).reverse();

      const records: ProcessedEmailRecord[] = [];
      const errors: string[] = [];
      const appConfig = loadConfig();

      for (const uid of recentUids) {
        try {
          const msg = await client.fetchOne(
            uid,
            { uid: true, envelope: true, bodyStructure: true, flags: true, internalDate: true },
            { uid: true }
          );
          if (!msg) continue;

          // Fetch body text (first 5000 chars)
          let bodyText = "";
          try {
            const content = await client.download(uid, "1", { uid: true });
            if (content && content.content) {
              const chunks: Buffer[] = [];
              const stream = content.content as any;
              const reader = stream.getReader ? stream.getReader() : null;
              if (reader) {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  chunks.push(Buffer.from(value));
                  if (Buffer.concat(chunks).length > 5000) break;
                }
              }
              bodyText = Buffer.concat(chunks)
                .toString("utf-8")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 5000);
            }
          } catch (e) {
            console.error("[imap/sync] body fetch error:", e);
          }

          const subject = msg.envelope?.subject || "(no subject)";
          const sender = msg.envelope?.from?.[0]
            ? `${msg.envelope.from[0].name || ""} <${msg.envelope.from[0].address || ""}>`.trim()
            : "unknown";
          const receivedDate = msg.internalDate
            ? new Date(msg.internalDate).toISOString()
            : new Date().toISOString();
          const hasAttachments = !!(msg.bodyStructure?.childNodes?.some(
            (c: any) => c.type === "attachment"
          ));

          // Generate deterministic analysis (wikitree, mindmap, execution plan)
          const analysis = generateAnalysis({
            subject,
            sender,
            body: bodyText,
            attachments: [],
          });

          // Try LLM extraction for fields/tables/summary/category
          let fields: any[] = [];
          let tables: any[] = [];
          let summary = analysis.execution.summary;
          let category = "general";
          let confidence = 0.8;

          try {
            if (appConfig.llm?.endpoint) {
              const extracted = await extractDataFromEmail(
                {
                  id: uid.toString(),
                  subject,
                  sender,
                  body: bodyText,
                  receivedDate,
                  attachments: [],
                  hasAttachments,
                } as any,
                [],
                appConfig
              );
              if (extracted.fields?.length > 0) fields = extracted.fields;
              if (extracted.tables?.length > 0) tables = extracted.tables;
              if (extracted.summary) summary = extracted.summary;
              if (extracted.category) category = extracted.category;
              confidence = extracted.confidence || 0.85;
            } else {
              // No LLM configured — extract key-value pairs from body text
              const lines = bodyText.split("\n").slice(0, 30);
              for (const line of lines) {
                const match = line.match(/^([A-Za-z][A-Za-z0-9\s]+):\s*(.+)$/);
                if (match) {
                  fields.push({
                    key: match[1].trim(),
                    value: match[2].trim(),
                    type: "string",
                    confidence: 0.7,
                  });
                }
              }
            }
          } catch (e: any) {
            console.error("LLM extraction failed, using deterministic:", e.message);
          }

          // Categorize based on subject keywords
          const subjLower = subject.toLowerCase();
          if (subjLower.includes("report") || subjLower.includes("analysis")) category = "report";
          else if (subjLower.includes("data") || subjLower.includes("csv")) category = "data";
          else if (subjLower.includes("invoice") || subjLower.includes("billing")) category = "financial";
          else if (subjLower.includes("research") || subjLower.includes("study")) category = "research";
          else if (subjLower.includes("trial") || subjLower.includes("clinical")) category = "clinical";
          else if (subjLower.includes("lab") || subjLower.includes("spectro")) category = "lab";

          const record: ProcessedEmailRecord = {
            id: nanoid(),
            emailId: uid.toString(),
            subject,
            sender,
            receivedDate,
            processedAt: new Date().toISOString(),
            category,
            confidence,
            fieldCount: fields.length,
            tableCount: tables.length,
            extractedData: {
              emailId: uid.toString(),
              extractedAt: new Date().toISOString(),
              fields,
              tables,
              summary,
              category,
              confidence,
              source: "email_body",
            },
            analysis,
          };

          records.push(record);
        } catch (e: any) {
          errors.push(`Failed to process UID ${uid}: ${e.message}`);
        }
      }

      // Generate telemetry from records
      let telemetry = null;
      try {
        telemetry = generateTelemetry(records, email);
      } catch (e: any) {
        console.error("Telemetry generation failed:", e.message);
      }

      const status = {
        lastSync: new Date().toISOString(),
        totalEmails: records.length,
        processedEmails: records.length,
        pendingEmails: 0,
        isSyncing: false,
        errors,
      };

      return NextResponse.json({
        synced: records.length,
        processed: records.length,
        errors,
        records,
        status,
        telemetry,
      });
    } finally {
      lock.release();
    }
  } catch (e: any) {
    let errorMsg = e.message || "IMAP connection failed";
    if (errorMsg.includes("Authentication failed") || errorMsg.includes("INVALID")) {
      errorMsg =
        "Authentication failed. For Outlook.com/Microsoft 365, you need an App Password " +
        "(not your regular password). Enable 2FA at https://account.microsoft.com/security, " +
        "then create an app password at https://account.live.com/proofs/AppPassword.";
    } else if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("ENOTFOUND")) {
      errorMsg = `Cannot connect to ${host}:${port}. Check the IMAP host setting.`;
    }
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  } finally {
    try {
      await client.logout();
    } catch (e) {
      console.error("[imap/sync] logout error:", e);
    }
  }
}
