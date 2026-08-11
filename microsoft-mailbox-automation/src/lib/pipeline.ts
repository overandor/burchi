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
  provider?: string;
  mailbox?: string;
}

const FETCH_TIMEOUT_MS = 30000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      controller.signal.addEventListener("abort", () => {
        reject(new Error(`${label} timed out after ${ms}ms`));
      });
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function syncAndProcess(
  config: AppConfig,
  options?: { processAll?: boolean; maxEmails?: number; userToken?: string; mailbox?: string }
): Promise<SyncResult> {
  const errors: string[] = [];
  const existingRecords = loadProcessedEmails();
  const processedEmailIds = new Set(existingRecords.map((r) => r.emailId));

  const status = loadSyncStatus();
  status.isSyncing = true;
  status.errors = [];
  saveSyncStatus(status);

  // Allow client-provided mailbox to override config (needed for stateless / Vercel)
  const effectiveConfig: AppConfig = {
    ...config,
    graph: {
      ...config.graph,
      mailbox: options?.mailbox || config.graph.mailbox,
    },
  };

  if (!effectiveConfig.graph.mailbox && options?.userToken) {
    errors.push("A mailbox address is required to fetch emails with a user token");
    status.isSyncing = false;
    status.errors = errors;
    saveSyncStatus(status);
    return { totalFetched: 0, newlyProcessed: 0, skipped: 0, errors, records: [] };
  }

  let emails: EmailMessage[] = [];
  try {
    emails = await withTimeout(
      fetchEmails(
        effectiveConfig,
        options?.maxEmails || config.processing.maxEmailsPerSync,
        "inbox",
        options?.userToken
      ),
      FETCH_TIMEOUT_MS,
      "fetchEmails"
    );
  } catch (e: any) {
    console.error("[pipeline] error:", e);
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
        const attachments = await withTimeout(
          fetchAttachments(effectiveConfig, email.id, options?.userToken),
          FETCH_TIMEOUT_MS,
          `fetchAttachments(${email.id})`
        );
        for (const att of attachments) {
          try {
            const parsed = await parseAttachment(att);
            parsedAttachments.push(parsed);
          } catch (e: any) {
            console.error("[pipeline] error:", e);
            errors.push(`Failed to parse attachment ${att.name}: ${e.message}`);
          }
        }
      }

      let extractedData: any;
      try {
        extractedData = await extractDataFromEmail(email, parsedAttachments, effectiveConfig);
      } catch (e: any) {
        console.error("[pipeline] extraction failed for", email.subject, e.message);
        errors.push(`Extraction failed for "${email.subject}": ${e.message}`);
        extractedData = {
          emailId: email.id,
          extractedAt: new Date().toISOString(),
          fields: [],
          tables: [],
          summary: email.bodyPreview || email.body?.slice(0, 200) || "",
          category: "Other",
          confidence: 0.5,
          source: parsedAttachments.length > 0 ? "attachment" : "email_body",
        };
      }

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
        senderEmail: email.senderEmail,
        receivedDate: email.receivedDate,
        processedAt: new Date().toISOString(),
        category: extractedData.category || "Other",
        confidence: extractedData.confidence || 0.5,
        fieldCount: extractedData.fields?.length || 0,
        tableCount: extractedData.tables?.length || 0,
        extractedData,
        analysis,
      };

      newRecords.push(record);
    } catch (e: any) {
      console.error("[pipeline] error:", e);
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
    provider: options?.userToken ? "graph" : effectiveConfig.graph.clientId ? "graph" : "demo",
    mailbox: effectiveConfig.graph.mailbox,
  };
}
