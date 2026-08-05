import type { ProcessedEmailRecord } from "@/types";
import { normalizeMailboxEvidence } from "./core.mjs";

export interface MailboxEvidenceContext {
  organizationId: string;
  provider: "gmail" | "microsoft_graph" | "imap" | "demo" | string;
  mailbox?: string | null;
  actorId?: string;
  pipelineVersion?: string;
  importedFrom?: string | null;
}

export type MailboxEvidenceRecord = Readonly<Record<string, unknown>>;

export function mailboxRecordToEvidence(
  record: ProcessedEmailRecord,
  context: MailboxEvidenceContext,
): MailboxEvidenceRecord {
  return normalizeMailboxEvidence(record, context);
}

export function mailboxRecordsToEvidence(
  records: ProcessedEmailRecord[],
  context: MailboxEvidenceContext,
): MailboxEvidenceRecord[] {
  return records.map((record) => mailboxRecordToEvidence(record, context));
}
