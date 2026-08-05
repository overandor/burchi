import { GmailConfig, EmailMessage, ProcessedEmailRecord, SyncStatus, ParsedAttachmentData } from "@/types";
import { fetchEmailsREST, fetchAttachmentContentREST } from "@/lib/gmail/rest-client";
import { parseAttachment } from "@/lib/parsers/attachment-parser";
import { generateAnalysis } from "@/lib/analysis/generator";
import { extractDataFromEmail } from "@/lib/llm/extractor";
import { loadConfig } from "@/lib/config";
import { loadProcessedEmails, saveProcessedEmails, loadSyncStatus, saveSyncStatus } from "@/lib/config";
import { nanoid } from "nanoid";

export async function syncAndProcessGmail(
  config: GmailConfig,
  maxEmails: number = 100
): Promise<{ synced: number; processed: number; errors: string[]; records: ProcessedEmailRecord[]; status: SyncStatus }> {
  const errors: string[] = [];
  let processed = 0;
  const newRecords: ProcessedEmailRecord[] = [];

  try {
    const emails = await fetchEmailsREST(config, maxEmails);
    let existing: ProcessedEmailRecord[] = [];
    try { existing = loadProcessedEmails(); } catch (e) { console.error("[gmail] error:", e); }
    const existingIds = new Set(existing.map((e) => e.emailId));

    for (const email of emails) {
      if (existingIds.has(email.id)) continue;

      try {
        const record = await processEmail(config, email);
        if (record) {
          newRecords.push(record);
          existing.push(record);
          processed++;
        }
      } catch (e: any) {
        errors.push(`Failed to process ${email.subject}: ${e.message}`);
      }
    }

    // Try to persist (works locally, fails silently on serverless)
    try {
      saveProcessedEmails(existing);
    } catch (e) { console.error("[gmail] error:", e); }

    const newStatus: SyncStatus = {
      lastSync: new Date().toISOString(),
      totalEmails: existing.length,
      processedEmails: existing.length,
      pendingEmails: 0,
      isSyncing: false,
      errors,
    };
    try { saveSyncStatus(newStatus); } catch (e) { console.error("[gmail] error:", e); }

    return { synced: emails.length, processed, errors, records: existing, status: newStatus };
  } catch (e: any) {
    errors.push(e.message);
    return { synced: 0, processed: 0, errors, records: [], status: { lastSync: null, totalEmails: 0, processedEmails: 0, pendingEmails: 0, isSyncing: false, errors } };
  }
}

export async function processEmail(
  config: GmailConfig,
  email: EmailMessage
): Promise<ProcessedEmailRecord | null> {
  // Fetch and parse attachments
  const attachmentData = [];
  const parsedAttachments: ParsedAttachmentData[] = [];
  for (const att of email.attachments) {
    try {
      const content = await fetchAttachmentContentREST(config, email.id, att.id);
      const attachmentWithContent = { ...att, content };
      const parsed = await parseAttachment(attachmentWithContent);
      attachmentData.push({
        name: att.name,
        type: parsed.type,
        parsedData: parsed,
      });
      parsedAttachments.push(parsed);
    } catch (e: any) {
      console.error(`Failed to parse attachment ${att.name}:`, e.message);
      attachmentData.push({ name: att.name, type: "unknown", parsedData: { type: "unknown" } as ParsedAttachmentData });
    }
  }

  // Generate deterministic analysis (wikitree, mindmap, execution plan)
  const analysis = generateAnalysis({
    subject: email.subject,
    sender: email.sender,
    body: email.body,
    attachments: attachmentData,
  });

  // Try LLM extraction for fields/tables/summary/category
  let fields: any[] = [];
  let tables: any[] = [];
  let summary = analysis.execution.summary;
  let category = categorizeEmail(email, attachmentData);
  let confidence = 0.85;

  try {
    const appConfig = loadConfig();
    if (appConfig.llm?.endpoint) {
      const extracted = await extractDataFromEmail(email, parsedAttachments, appConfig);
      if (extracted.fields?.length > 0) fields = extracted.fields;
      else fields = extractFieldsFromAttachments(attachmentData);
      if (extracted.tables?.length > 0) tables = extracted.tables;
      else tables = extractTablesFromAttachments(attachmentData);
      if (extracted.summary) summary = extracted.summary;
      if (extracted.category) category = extracted.category;
      confidence = extracted.confidence || 0.85;
    } else {
      // No LLM endpoint configured — fall back to deterministic extraction
      fields = extractFieldsFromAttachments(attachmentData);
      tables = extractTablesFromAttachments(attachmentData);
    }
  } catch (e: any) {
    console.error("LLM extraction failed, falling back to deterministic:", e.message);
    fields = extractFieldsFromAttachments(attachmentData);
    tables = extractTablesFromAttachments(attachmentData);
  }

  const record: ProcessedEmailRecord = {
    id: nanoid(),
    emailId: email.id,
    subject: email.subject,
    sender: email.sender,
    senderEmail: email.senderEmail,
    receivedDate: email.receivedDate,
    processedAt: new Date().toISOString(),
    category,
    confidence,
    fieldCount: fields.length,
    tableCount: tables.length,
    extractedData: {
      emailId: email.id,
      extractedAt: new Date().toISOString(),
      fields,
      tables,
      summary,
      category,
      confidence,
      source: attachmentData.length > 0 ? "attachment" : "email_body",
    },
    analysis,
  };

  return record;
}

function extractFieldsFromAttachments(
  attachments: { name: string; type: string; parsedData: any }[]
): any[] {
  const fields: any[] = [];

  for (const att of attachments) {
    if (att.parsedData?.rows && att.parsedData.rows.length > 0) {
      const firstRow = att.parsedData.rows[0];
      for (const [key, value] of Object.entries(firstRow)) {
        fields.push({
          key,
          value: String(value || ""),
          type: typeof value === "number" ? "number" : "string",
          confidence: 0.9,
        });
      }
    }
    if (att.parsedData?.text) {
      // Extract key-value pairs from text
      const lines = att.parsedData.text.split("\n").slice(0, 20);
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
  }

  return fields.slice(0, 50);
}

function extractTablesFromAttachments(
  attachments: { name: string; type: string; parsedData: any }[]
): any[] {
  const tables: any[] = [];

  for (const att of attachments) {
    if (att.parsedData?.rows && att.parsedData.rows.length > 0) {
      const headers = Object.keys(att.parsedData.rows[0]);
      tables.push({
        name: att.name,
        headers,
        rows: att.parsedData.rows.slice(0, 100),
        source: att.name,
      });
    }
  }

  return tables;
}

function categorizeEmail(
  email: EmailMessage,
  attachments: { name: string; type: string; parsedData: any }[]
): string {
  const subject = email.subject.toLowerCase();
  const attachmentTypes = attachments.map((a) => a.type);

  if (subject.includes("report") || subject.includes("analysis")) return "report";
  if (subject.includes("data") || attachmentTypes.includes("csv") || attachmentTypes.includes("excel")) return "data";
  if (subject.includes("invoice") || subject.includes("billing")) return "financial";
  if (subject.includes("research") || subject.includes("study")) return "research";
  if (attachmentTypes.includes("pdf")) return "document";

  return "general";
}
