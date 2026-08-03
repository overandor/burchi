import { AppConfig, EmailMessage, ProcessedEmailRecord, ParsedAttachmentData } from "@/types";
import { fetchEmails, fetchAttachments } from "@/lib/graph/client";
import { parseAttachment } from "@/lib/parsers/attachment-parser";
import { extractDataFromEmail } from "@/lib/llm/extractor";
import { generateAnalysis } from "@/lib/analysis/generator";
import { loadProcessedEmails, saveProcessedEmails, loadSyncStatus, saveSyncStatus } from "@/lib/config";
import { nanoid } from "nanoid";

export interface SyncResult {
  totalFetched: number;
  newlyProcessed: number;
  skipped: number;
  errors: string[];
  records: ProcessedEmailRecord[];
}

export async function syncAndProcess(
  config: AppConfig,
  options?: { processAll?: boolean; maxEmails?: number; userToken?: string }
): Promise<SyncResult> {
  const errors: string[] = [];
  const existingRecords = loadProcessedEmails();
  const processedEmailIds = new Set(existingRecords.map((r) => r.emailId));

  const status = loadSyncStatus();
  status.isSyncing = true;
  status.errors = [];
  saveSyncStatus(status);

  let emails: EmailMessage[] = [];
  try {
    emails = await fetchEmails(
      config,
      options?.maxEmails || config.processing.maxEmailsPerSync,
      "inbox",
      options?.userToken
    );
  } catch (e: any) {
    errors.push(`Failed to fetch emails: ${e.message}`);
    status.isSyncing = false;
    status.errors = errors;
    saveSyncStatus(status);
    return { totalFetched: 0, newlyProcessed: 0, skipped: 0, errors, records: [] };
  }

  const newRecords: ProcessedEmailRecord[] = [];
  let skipped = 0;

  for (const email of emails) {
    if (processedEmailIds.has(email.id) && !options?.processAll) {
      skipped++;
      continue;
    }

    try {
      let parsedAttachments: ParsedAttachmentData[] = [];

      if (email.hasAttachments) {
        const attachments = await fetchAttachments(config, email.id, options?.userToken);
        for (const att of attachments) {
          try {
            const parsed = await parseAttachment(att);
            parsedAttachments.push(parsed);
          } catch (e: any) {
            errors.push(`Failed to parse attachment ${att.name}: ${e.message}`);
          }
        }
      }

      const extractedData = await extractDataFromEmail(
        email,
        parsedAttachments,
        config
      );

      // Generate deterministic analysis (wikitree, mindmap, execution plan)
      const analysis = generateAnalysis({
        subject: email.subject,
        sender: email.sender,
        body: email.body || "",
        attachments: parsedAttachments.map((p, i) => ({
          name: `attachment-${i + 1}`,
          type: p.type || "unknown",
          parsedData: p,
        })),
      });

      const record: ProcessedEmailRecord = {
        id: nanoid(),
        emailId: email.id,
        subject: email.subject,
        sender: email.sender,
        receivedDate: email.receivedDate,
        processedAt: new Date().toISOString(),
        category: extractedData.category,
        confidence: extractedData.confidence,
        fieldCount: extractedData.fields.length,
        tableCount: extractedData.tables.length,
        extractedData,
        analysis,
      };

      newRecords.push(record);
    } catch (e: any) {
      errors.push(`Failed to process email "${email.subject}": ${e.message}`);
    }
  }

  const allRecords = [...newRecords, ...existingRecords];
  saveProcessedEmails(allRecords);

  const finalStatus = {
    ...status,
    lastSync: new Date().toISOString(),
    totalEmails: emails.length,
    processedEmails: allRecords.length,
    pendingEmails: Math.max(0, emails.length - allRecords.length),
    isSyncing: false,
    errors,
  };
  saveSyncStatus(finalStatus);

  return {
    totalFetched: emails.length,
    newlyProcessed: newRecords.length,
    skipped,
    errors,
    records: newRecords,
  };
}
