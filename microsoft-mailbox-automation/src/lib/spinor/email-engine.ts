/**
 * SPINOR Email Experimentation Engine
 *
 * Palindromises email by turning it from a dumb messaging channel
 * into a reversible experimentation-and-profit engine.
 *
 * Flow:
 *   Email signal → opportunity → competing hypotheses → approved experiment
 *   → personalized send → behavioral outcome → causal comparison
 *   → Golden Node → automation → reverse falsification
 *   → improved hypothesis → next email
 *
 * Every email is a controlled experiment. Every outcome is evidence.
 * Every winning method is attacked until a better one replaces it.
 */

import { callLLM } from "@/lib/golden/llm-client";
import { getDb } from "@/lib/db";
import { sendEmailREST } from "@/lib/gmail/rest-client";
import { sendEmailGraph } from "@/lib/graph/client";
import { type GmailConfig } from "@/types";
import { createHash } from "crypto";

// ─── Types ──────────────────────────────────────────────────────────

export type EmailSignalType =
  | "opened_no_response"
  | "repeated_unanswered_question"
  | "delayed_internal_handoff"
  | "preferred_response_time"
  | "stakeholder_delegation"
  | "approved_content_engagement"
  | "workflow_abandonment"
  | "commitment_without_completion";

export type ExperimentDimension =
  | "subject_structure"
  | "send_timing"
  | "content_sequence"
  | "human_followup_interval"
  | "stakeholder_order"
  | "channel_combination"
  | "workflow_length";

export type ExperimentStatus =
  | "hypothesized"
  | "approved"
  | "sending"
  | "sent"
  | "outcome_recorded"
  | "analyzed"
  | "promoted"
  | "falsified"
  | "reversed";

export type OutcomeType =
  | "qualified_response"
  | "scheduled_discussion"
  | "workflow_completed"
  | "no_response"
  | "opt_out"
  | "escalated_to_med_info"
  | "delegated_to_staff"
  | "partial_engagement";

export interface EmailSignal {
  id: string;
  accountId: string;
  accountName: string;
  signalType: EmailSignalType;
  description: string;
  evidence: string;
  detectedAt: string;
  uncertainty: string; // what uncertainty does this behavior reveal?
}

export interface EmailHypothesis {
  id: string;
  signalId: string;
  claim: string;
  dimension: ExperimentDimension;
  rationale: string;
  testable: boolean;
  competingWith: string[]; // other hypothesis IDs
  createdAt: string;
}

export interface EmailExperiment {
  id: string;
  signalId: string;
  hypothesisId: string;
  employeeId: string;
  accountId: string;
  accountName: string;
  dimension: ExperimentDimension;
  controlCondition: string;
  variation: string;
  subjectLine: string;
  bodyPreview: string;
  toEmail: string | null;
  inReplyTo: string | null;
  threadId: string | null;
  sendTiming: string;
  status: ExperimentStatus;
  approvedContentVersion: string;
  complianceChecked: boolean;
  complianceNotes: string;
  sentAt: string | null;
  outcome: OutcomeType | null;
  outcomeDescription: string | null;
  outcomeAt: string | null;
  cost: number;
  customerBurden: number;
  complianceRisk: number;
  profitContribution: ProfitBreakdown | null;
  controlOutcome: OutcomeType | null;
  causalLift: number | null;
  createdAt: string;
}

export interface ProfitBreakdown {
  incrementalBusinessValue: number;
  laborSaved: number;
  avoidedFailedCampaigns: number;
  reusableKnowledge: number;
  automationValue: number;
  executionCost: number;
  customerBurden: number;
  complianceRisk: number;
  total: number;
}

export interface EmailMessage {
  id: string;
  orgId?: string;
  accountId: string;
  accountName: string;
  from: string;
  to?: string[];
  subject: string;
  body: string;
  date: string;
  isRead: boolean;
  processed: boolean;
  category: string;
  hasAttachments: boolean;
  tags?: string[];
  source?: string; // imap, gmail, upload, api
  confidence?: number; // 0-1
  detectedAt: string;
}

export interface EmailGoldenNode {
  id: string;
  experimentId: string;
  population: string;
  method: string;
  result: string;
  failureBoundary: string;
  lift: number;
  replicationCount: number;
  complianceReliability: number;
  costPerUse: number;
  promotedAt: string;
  reverseTests: ReverseTest[];
  status: "active" | "under_attack" | "destroyed" | "narrowed";
}

export interface ReverseTest {
  id: string;
  goldenNodeId: string;
  testType: "remove_component" | "test_segment" | "reverse_order" | "compare_human_only" | "test_cheaper_variant" | "search_harm" | "narrow_scope";
  description: string;
  result: string | null;
  finding: "confirmed" | "weakened" | "destroyed" | "improved" | null;
  createdAt: string;
}

interface SpinorEmailDB {
  signals: Record<string, EmailSignal>;
  hypotheses: Record<string, EmailHypothesis>;
  experiments: Record<string, EmailExperiment>;
  goldenNodes: Record<string, EmailGoldenNode>;
  emails: Record<string, EmailMessage>;
}

// ─── SQLite Storage ──────────────────────────────────────────────────
//
// Migrated from ephemeral JSON in tmpdir to persistent SQLite.
// Data survives deployments and process restarts.

function ensureEmailTables(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS spinor_email_signals (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      account_name TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      description TEXT NOT NULL,
      evidence TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      uncertainty TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_spinor_signals_account ON spinor_email_signals(account_id);

    CREATE TABLE IF NOT EXISTS spinor_email_hypotheses (
      id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL,
      claim TEXT NOT NULL,
      dimension TEXT NOT NULL,
      rationale TEXT NOT NULL,
      testable INTEGER NOT NULL DEFAULT 1,
      competing_with TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_spinor_hypotheses_signal ON spinor_email_hypotheses(signal_id);

    CREATE TABLE IF NOT EXISTS spinor_email_experiments (
      id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL,
      hypothesis_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      account_name TEXT NOT NULL,
      dimension TEXT NOT NULL,
      control_condition TEXT NOT NULL,
      variation TEXT NOT NULL,
      subject_line TEXT NOT NULL,
      body_preview TEXT DEFAULT '',
      to_email TEXT,
      in_reply_to TEXT,
      thread_id TEXT,
      send_timing TEXT NOT NULL,
      status TEXT NOT NULL,
      approved_content_version TEXT DEFAULT 'v1',
      compliance_checked INTEGER NOT NULL DEFAULT 0,
      compliance_notes TEXT DEFAULT '',
      sent_at TEXT,
      outcome TEXT,
      outcome_description TEXT,
      outcome_at TEXT,
      cost REAL NOT NULL DEFAULT 0,
      customer_burden REAL NOT NULL DEFAULT 0,
      compliance_risk REAL NOT NULL DEFAULT 0,
      profit_contribution TEXT,
      control_outcome TEXT,
      causal_lift REAL,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_spinor_exp_employee ON spinor_email_experiments(employee_id);
    CREATE INDEX IF NOT EXISTS idx_spinor_exp_status ON spinor_email_experiments(status);

    CREATE TABLE IF NOT EXISTS spinor_email_experiments_new (
      id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL,
      hypothesis_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      account_name TEXT NOT NULL,
      dimension TEXT NOT NULL,
      control_condition TEXT NOT NULL,
      variation TEXT NOT NULL,
      subject_line TEXT NOT NULL,
      body_preview TEXT DEFAULT '',
      to_email TEXT,
      in_reply_to TEXT,
      thread_id TEXT,
      send_timing TEXT NOT NULL,
      status TEXT NOT NULL,
      approved_content_version TEXT DEFAULT 'v1',
      compliance_checked INTEGER NOT NULL DEFAULT 0,
      compliance_notes TEXT DEFAULT '',
      sent_at TEXT,
      outcome TEXT,
      outcome_description TEXT,
      outcome_at TEXT,
      cost REAL NOT NULL DEFAULT 0,
      customer_burden REAL NOT NULL DEFAULT 0,
      compliance_risk REAL NOT NULL DEFAULT 0,
      profit_contribution TEXT,
      control_outcome TEXT,
      causal_lift REAL,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_spinor_exp_employee ON spinor_email_experiments(employee_id);
    CREATE INDEX IF NOT EXISTS idx_spinor_exp_status ON spinor_email_experiments(status);

    CREATE TABLE IF NOT EXISTS spinor_email_golden_nodes (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      population TEXT NOT NULL,
      method TEXT NOT NULL,
      result TEXT NOT NULL,
      failure_boundary TEXT NOT NULL,
      lift REAL NOT NULL,
      replication_count INTEGER NOT NULL DEFAULT 0,
      compliance_reliability REAL NOT NULL DEFAULT 0,
      cost_per_use REAL NOT NULL DEFAULT 0,
      promoted_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      reverse_tests TEXT DEFAULT '[]',
      data TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS spinor_emails (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      account_id TEXT NOT NULL,
      account_name TEXT NOT NULL,
      from_address TEXT NOT NULL,
      to_addresses TEXT DEFAULT '[]',
      subject TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      processed INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'other',
      has_attachments INTEGER NOT NULL DEFAULT 0,
      tags TEXT DEFAULT '[]',
      source TEXT DEFAULT 'api',
      confidence REAL DEFAULT 0.5,
      detected_at TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_spinor_emails_account ON spinor_emails(account_id);
    CREATE INDEX IF NOT EXISTS idx_spinor_emails_date ON spinor_emails(date);
    CREATE INDEX IF NOT EXISTS idx_spinor_emails_source ON spinor_emails(source);
  `);

  // Add any columns introduced after initial schema creation
  const columns = db.prepare(`PRAGMA table_info(spinor_email_experiments)`).all() as any[];
  const names = new Set(columns.map((c) => c.name));
  for (const col of ["to_email", "in_reply_to", "thread_id"]) {
    if (!names.has(col)) {
      try {
        db.exec(`ALTER TABLE spinor_email_experiments ADD COLUMN ${col} TEXT`);
      } catch (e: any) {
        console.warn(`[email-engine] failed to add ${col}: ${e.message}`);
      }
    }
  }
}

function loadDB(): SpinorEmailDB {
  ensureEmailTables();
  const db = getDb();

  const signalRows = db.prepare(`SELECT * FROM spinor_email_signals`).all() as any[];
  const signals: Record<string, EmailSignal> = {};
  for (const row of signalRows) {
    signals[row.id] = {
      id: row.id,
      accountId: row.account_id,
      accountName: row.account_name,
      signalType: row.signal_type,
      description: row.description,
      evidence: row.evidence,
      detectedAt: row.detected_at,
      uncertainty: row.uncertainty,
    };
  }

  const hypRows = db.prepare(`SELECT * FROM spinor_email_hypotheses`).all() as any[];
  const hypotheses: Record<string, EmailHypothesis> = {};
  for (const row of hypRows) {
    hypotheses[row.id] = {
      id: row.id,
      signalId: row.signal_id,
      claim: row.claim,
      dimension: row.dimension,
      rationale: row.rationale,
      testable: !!row.testable,
      competingWith: JSON.parse(row.competing_with || "[]"),
      createdAt: row.created_at,
    };
  }

  const expRows = db.prepare(`SELECT * FROM spinor_email_experiments`).all() as any[];
  const experiments: Record<string, EmailExperiment> = {};
  for (const row of expRows) {
    experiments[row.id] = {
      id: row.id,
      signalId: row.signal_id,
      hypothesisId: row.hypothesis_id,
      employeeId: row.employee_id,
      accountId: row.account_id,
      accountName: row.account_name,
      dimension: row.dimension,
      controlCondition: row.control_condition,
      variation: row.variation,
      subjectLine: row.subject_line,
      bodyPreview: row.body_preview || "",
      toEmail: row.to_email || null,
      inReplyTo: row.in_reply_to || null,
      threadId: row.thread_id || null,
      sendTiming: row.send_timing,
      status: row.status,
      approvedContentVersion: row.approved_content_version || "v1",
      complianceChecked: !!row.compliance_checked,
      complianceNotes: row.compliance_notes || "",
      sentAt: row.sent_at,
      outcome: row.outcome as OutcomeType | null,
      outcomeDescription: row.outcome_description,
      outcomeAt: row.outcome_at,
      cost: row.cost,
      customerBurden: row.customer_burden,
      complianceRisk: row.compliance_risk,
      profitContribution: row.profit_contribution ? JSON.parse(row.profit_contribution) : null,
      controlOutcome: row.control_outcome as OutcomeType | null,
      causalLift: row.causal_lift,
      createdAt: row.created_at,
    };
  }

  const goldenRows = db.prepare(`SELECT * FROM spinor_email_golden_nodes`).all() as any[];
  const goldenNodes: Record<string, EmailGoldenNode> = {};
  for (const row of goldenRows) {
    goldenNodes[row.id] = {
      id: row.id,
      experimentId: row.experiment_id,
      population: row.population,
      method: row.method,
      result: row.result,
      failureBoundary: row.failure_boundary,
      lift: row.lift,
      replicationCount: row.replication_count,
      complianceReliability: row.compliance_reliability,
      costPerUse: row.cost_per_use,
      promotedAt: row.promoted_at,
      reverseTests: JSON.parse(row.reverse_tests || "[]"),
      status: row.status as "active" | "under_attack" | "destroyed" | "narrowed",
    };
  }

  const emailRows = db.prepare(`SELECT * FROM spinor_emails`).all() as any[];
  const emails: Record<string, EmailMessage> = {};
  for (const row of emailRows) {
    emails[row.id] = {
      id: row.id,
      orgId: row.org_id,
      accountId: row.account_id,
      accountName: row.account_name,
      from: row.from_address,
      to: JSON.parse(row.to_addresses || "[]"),
      subject: row.subject,
      body: row.body,
      date: row.date,
      isRead: !!row.is_read,
      processed: !!row.processed,
      category: row.category,
      hasAttachments: !!row.has_attachments,
      tags: JSON.parse(row.tags || "[]"),
      source: row.source,
      confidence: row.confidence,
      detectedAt: row.detected_at,
    };
  }

  return { signals, hypotheses, experiments, goldenNodes, emails };
}

export function saveSignal(signal: EmailSignal): void {
  ensureEmailTables();
  getDb().prepare(
    `INSERT OR REPLACE INTO spinor_email_signals
     (id, account_id, account_name, signal_type, description, evidence, detected_at, uncertainty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(signal.id, signal.accountId, signal.accountName, signal.signalType,
    signal.description, signal.evidence, signal.detectedAt, signal.uncertainty);
}

export function saveHypothesis(hyp: EmailHypothesis): void {
  ensureEmailTables();
  getDb().prepare(
    `INSERT OR REPLACE INTO spinor_email_hypotheses
     (id, signal_id, claim, dimension, rationale, testable, competing_with, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(hyp.id, hyp.signalId, hyp.claim, hyp.dimension, hyp.rationale,
    hyp.testable ? 1 : 0, JSON.stringify(hyp.competingWith), hyp.createdAt);
}

function saveExperiment(exp: EmailExperiment): void {
  ensureEmailTables();
  getDb().prepare(
    `INSERT OR REPLACE INTO spinor_email_experiments
     (id, signal_id, hypothesis_id, employee_id, account_id, account_name, dimension,
      control_condition, variation, subject_line, body_preview, to_email, in_reply_to, thread_id, send_timing, status,
      approved_content_version, compliance_checked, compliance_notes, sent_at,
      outcome, outcome_description, outcome_at, cost, customer_burden, compliance_risk,
      profit_contribution, control_outcome, causal_lift, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(exp.id, exp.signalId, exp.hypothesisId, exp.employeeId, exp.accountId,
    exp.accountName, exp.dimension, exp.controlCondition, exp.variation,
    exp.subjectLine, exp.bodyPreview, exp.toEmail, exp.inReplyTo, exp.threadId, exp.sendTiming, exp.status,
    exp.approvedContentVersion, exp.complianceChecked ? 1 : 0, exp.complianceNotes,
    exp.sentAt, exp.outcome, exp.outcomeDescription, exp.outcomeAt,
    exp.cost, exp.customerBurden, exp.complianceRisk,
    exp.profitContribution ? JSON.stringify(exp.profitContribution) : null,
    exp.controlOutcome, exp.causalLift, exp.createdAt);
}

function saveGoldenNode(node: EmailGoldenNode): void {
  ensureEmailTables();
  getDb().prepare(
    `INSERT OR REPLACE INTO spinor_email_golden_nodes
     (id, experiment_id, population, method, result, failure_boundary, lift,
      replication_count, compliance_reliability, cost_per_use, promoted_at, status, reverse_tests)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(node.id, node.experimentId, node.population, node.method, node.result,
    node.failureBoundary, node.lift, node.replicationCount,
    node.complianceReliability, node.costPerUse, node.promotedAt,
    node.status, JSON.stringify(node.reverseTests));
}

function genId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
}

function deterministicEmailId(email: { from: string; subject: string; date: string }): string {
  const hash = createHash("sha256").update(`${email.from}|${email.subject}|${email.date}`).digest("hex");
  return `em_${hash.slice(0, 16)}`;
}

function deterministicSignalId(emailId: string, signalType: string): string {
  const hash = createHash("sha256").update(`${emailId}|${signalType}`).digest("hex");
  return `sig_${hash.slice(0, 16)}`;
}

export function saveEmail(email: EmailMessage): void {
  ensureEmailTables();
  getDb().prepare(
    `INSERT OR REPLACE INTO spinor_emails
     (id, org_id, account_id, account_name, from_address, to_addresses, subject, body,
      date, is_read, processed, category, has_attachments, tags, source, confidence, detected_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    email.id,
    email.orgId || null,
    email.accountId,
    email.accountName,
    email.from,
    JSON.stringify(email.to || []),
    email.subject,
    email.body,
    email.date,
    email.isRead ? 1 : 0,
    email.processed ? 1 : 0,
    email.category,
    email.hasAttachments ? 1 : 0,
    JSON.stringify(email.tags || []),
    email.source || "api",
    email.confidence ?? 0.5,
    email.detectedAt,
    JSON.stringify({}),
  );
}

export function loadEmails(filter?: { accountId?: string; source?: string; unreadOnly?: boolean }): EmailMessage[] {
  ensureEmailTables();
  const db = getDb();
  const params: any[] = [];
  const conditions: string[] = [];
  if (filter?.accountId) { conditions.push("account_id = ?"); params.push(filter.accountId); }
  if (filter?.source) { conditions.push("source = ?"); params.push(filter.source); }
  if (filter?.unreadOnly) { conditions.push("is_read = 0"); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM spinor_emails ${where} ORDER BY date DESC`).all(...params) as any[];
  return rows.map((row) => ({
    id: row.id,
    orgId: row.org_id,
    accountId: row.account_id,
    accountName: row.account_name,
    from: row.from_address,
    to: JSON.parse(row.to_addresses || "[]"),
    subject: row.subject,
    body: row.body,
    date: row.date,
    isRead: !!row.is_read,
    processed: !!row.processed,
    category: row.category,
    hasAttachments: !!row.has_attachments,
    tags: JSON.parse(row.tags || "[]"),
    source: row.source,
    confidence: row.confidence,
    detectedAt: row.detected_at,
  }));
}

export function deleteEmail(id: string): void {
  ensureEmailTables();
  getDb().prepare(`DELETE FROM spinor_emails WHERE id = ?`).run(id);
}

export function ingestEmails(emails: Omit<EmailMessage, "id" | "detectedAt">[]): { emails: EmailMessage[]; signals: EmailSignal[] } {
  const saved: EmailMessage[] = [];
  const newEmails: EmailMessage[] = [];
  for (const incoming of emails) {
    const id = deterministicEmailId(incoming);
    const email: EmailMessage = {
      ...incoming,
      id,
      detectedAt: new Date().toISOString(),
    };
    // Check if this email already exists to avoid duplicate signal generation
    const existing = loadDB().emails[id];
    saveEmail(email);
    saved.push(email);
    if (!existing) {
      newEmails.push(email);
    }

    // ─── Create evidence envelope for each ingested email ─────────
    // This connects the email engine to the workteleport evidence layer.
    try {
      createEvidenceEnvelopeFromEmail(email);
    } catch (e: any) {
      console.error("[email-engine] evidence envelope creation error:", e.message);
    }
  }
  // Only generate signals for genuinely new emails
  const signals = newEmails.length > 0 ? detectEmailSignals(newEmails) : [];
  return { emails: saved, signals };
}

// ─── 1. EMAIL SENSOR ────────────────────────────────────────────────
//
// Reads permissioned email and CRM events for behavioral signals.
// Does not ask "what email should we send?" — asks "what uncertainty
// does this email behavior reveal?"

export function detectEmailSignals(emails: Array<{
  id: string;
  accountId?: string;
  accountName?: string;
  subject: string;
  from: string;
  date: string;
  isRead: boolean;
  processed: boolean;
  category: string;
  hasAttachments: boolean;
  body?: string;
}>): EmailSignal[] {
  const signals: EmailSignal[] = [];

  for (const email of emails) {
    // Opened but no response
    if (email.isRead && !email.processed) {
      const sig: EmailSignal = {
        id: deterministicSignalId(email.id, "opened_no_response"),
        accountId: email.accountId || email.from,
        accountName: email.accountName || email.from,
        signalType: "opened_no_response",
        description: `Opened "${email.subject}" but took no action`,
        evidence: `Read ${email.date}, no response detected`,
        detectedAt: new Date().toISOString(),
        uncertainty: "Why did they read but not act? Is the content unclear, the timing wrong, or the ask too heavy?",
      };
      saveSignal(sig);
      signals.push(sig);
    }

    // Workflow abandonment (processed but category suggests incomplete workflow)
    if (email.processed && email.category === "Other") {
      const sig: EmailSignal = {
        id: deterministicSignalId(email.id, "workflow_abandonment"),
        accountId: email.accountId || email.from,
        accountName: email.accountName || email.from,
        signalType: "workflow_abandonment",
        description: `Email "${email.subject}" categorized as generic — workflow not completed`,
        evidence: `Category: ${email.category}, processed but no clear workflow outcome`,
        detectedAt: new Date().toISOString(),
        uncertainty: "Did the workflow fail, or was it never started? What step did they abandon?",
      };
      saveSignal(sig);
      signals.push(sig);
    }

    // Approved content engagement (has attachments + processed = engaged with content)
    if (email.hasAttachments && email.processed) {
      const sig: EmailSignal = {
        id: deterministicSignalId(email.id, "approved_content_engagement"),
        accountId: email.accountId || email.from,
        accountName: email.accountName || email.from,
        signalType: "approved_content_engagement",
        description: `Engaged with approved content in "${email.subject}"`,
        evidence: `Has attachments, processed, category: ${email.category}`,
        detectedAt: new Date().toISOString(),
        uncertainty: "They engaged with content but did it change behavior? What would convert engagement to action?",
      };
      saveSignal(sig);
      signals.push(sig);
    }
  }

  return signals;
}

export function loadSignals(): EmailSignal[] {
  return Object.values(loadDB().signals).sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}

// ─── 2. COMPETING HYPOTHESIS GENERATOR ──────────────────────────────
//
// For each signal, the LLM generates rival explanations.
// Different employees test different explanations instead of
// everybody blasting the same template like corporate zombies.

export async function generateHypotheses(signalId: string): Promise<EmailHypothesis[]> {
  const db = loadDB();
  const signal = db.signals[signalId];
  if (!signal) throw new Error("Signal not found");

  const systemPrompt = `You are SPINOR, a pharma email experimentation engine.
Given an email behavioral signal, generate 3-5 COMPETING hypotheses that explain the behavior.
Each hypothesis must:
- Be testable via a controlled email experiment
- Target a different experiment dimension (subject_structure, send_timing, content_sequence, human_followup_interval, stakeholder_order, channel_combination, workflow_length)
- Be specific and falsifiable
- Not be a vague "make it better" hypothesis

Return ONLY valid JSON array:
[
  {
    "claim": "specific testable claim",
    "dimension": "one of the 7 dimensions",
    "rationale": "why this explains the behavior",
    "testable": true
  }
]`;

  const userPrompt = `Signal: ${signal.signalType}
Description: ${signal.description}
Evidence: ${signal.evidence}
Uncertainty: ${signal.uncertainty}

Generate competing hypotheses that explain this behavior.`;

  let hypotheses: EmailHypothesis[] = [];

  try {
    const result = await callLLM(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.5, maxTokens: 800 }
    );

    if (result.content) {
      const jsonMatch = result.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{
          claim: string;
          dimension: ExperimentDimension;
          rationale: string;
          testable: boolean;
        }>;
        const ids = parsed.map(() => genId("hyp"));
        hypotheses = parsed.map((h, i) => ({
          id: ids[i],
          signalId,
          claim: h.claim,
          dimension: h.dimension,
          rationale: h.rationale,
          testable: h.testable ?? true,
          competingWith: ids.filter((id) => id !== ids[i]),
          createdAt: new Date().toISOString(),
        }));
      }
    }
  } catch { /* fall through to templates */ }

  // Fallback: deterministic hypotheses based on signal type
  if (hypotheses.length === 0) {
    hypotheses = generateTemplateHypotheses(signal);
  }

  for (const h of hypotheses) {
    db.hypotheses[h.id] = h;
    saveHypothesis(h);
  }
  return hypotheses;
}

export function generateTemplateHypotheses(signal: EmailSignal): EmailHypothesis[] {
  const id1 = genId("hyp");
  const id2 = genId("hyp");
  const id3 = genId("hyp");
  const ids = [id1, id2, id3];

  const templates: Record<EmailSignalType, Array<{ claim: string; dimension: ExperimentDimension; rationale: string }>> = {
    opened_no_response: [
      { claim: "The email subject does not signal urgency or relevance to the recipient's daily workflow", dimension: "subject_structure", rationale: "They opened it but the subject didn't frame the content as actionable" },
      { claim: "The email arrives at a time when the recipient is too busy to act", dimension: "send_timing", rationale: "Opening but not acting suggests timing mismatch" },
      { claim: "The content requires a decision the recipient is not authorized to make alone", dimension: "stakeholder_order", rationale: "They read it but need to delegate — the email should target staff first" },
    ],
    repeated_unanswered_question: [
      { claim: "The question is buried in too much content and the recipient misses it", dimension: "content_sequence", rationale: "Repeating the question without response suggests visibility, not refusal" },
      { claim: "The recipient needs a human follow-up call, not another email", dimension: "channel_combination", rationale: "Email-only attempts have exhausted the channel" },
      { claim: "The question requires medical information routing, not a sales response", dimension: "content_sequence", rationale: "Unanswered scientific questions may need med-info escalation" },
    ],
    delayed_internal_handoff: [
      { claim: "The handoff interval is too long — staff lose context", dimension: "human_followup_interval", rationale: "Delays suggest the follow-up arrives after the context has faded" },
      { claim: "The email should go to the staff first, not the physician", dimension: "stakeholder_order", rationale: "Handoff delays mean the wrong person received it first" },
      { claim: "The workflow is too long for a single email cycle", dimension: "workflow_length", rationale: "Complex handoffs need shorter, sequential steps" },
    ],
    preferred_response_time: [
      { claim: "Sending at the recipient's preferred time increases response rate", dimension: "send_timing", rationale: "Response time patterns reveal optimal send windows" },
      { claim: "A shorter email at any time outperforms a long email at the right time", dimension: "content_sequence", rationale: "Timing may matter less than cognitive load" },
      { claim: "Combining email + same-day human call outperforms email alone at any time", dimension: "channel_combination", rationale: "Timing preference may actually be a channel preference" },
    ],
    stakeholder_delegation: [
      { claim: "Sending to office staff first, then physician, improves completion", dimension: "stakeholder_order", rationale: "Delegation patterns show staff are the real gatekeepers" },
      { claim: "A workflow that includes staff in the first step reduces handoff delay", dimension: "workflow_length", rationale: "Delegation works when the workflow anticipates it" },
      { claim: "Email to physician with explicit 'please delegate to staff' instruction outperforms staff-first", dimension: "content_sequence", rationale: "Physicians may prefer to retain control with explicit delegation" },
    ],
    approved_content_engagement: [
      { claim: "Adding a single clear next-step call-to-action converts engagement to action", dimension: "content_sequence", rationale: "They engaged with content but lacked a clear action path" },
      { claim: "Following up within 24 hours with a human call converts content engagement to discussion", dimension: "human_followup_interval", rationale: "Content engagement creates a window that closes quickly" },
      { claim: "Shortening the content and adding a scheduling link outperforms comprehensive content", dimension: "workflow_length", rationale: "Comprehensive content may create decision fatigue" },
    ],
    workflow_abandonment: [
      { claim: "The workflow has too many steps — reducing to 2 steps increases completion", dimension: "workflow_length", rationale: "Abandonment suggests cognitive or operational overload" },
      { claim: "A human follow-up within 48 hours rescues abandoned workflows", dimension: "human_followup_interval", rationale: "Abandonment may be temporary — a nudge could recover it" },
      { claim: "The workflow fails because it requires a channel switch — keeping it email-only improves completion", dimension: "channel_combination", rationale: "Channel switches create drop-off points" },
    ],
    commitment_without_completion: [
      { claim: "Sending a commitment reminder within 72 hours increases completion", dimension: "human_followup_interval", rationale: "Commitments decay without reminders" },
      { claim: "Simplifying the commitment to a single action increases completion", dimension: "content_sequence", rationale: "Complex commitments are harder to fulfill" },
      { claim: "A human call to fulfill the commitment outperforms email reminders", dimension: "channel_combination", rationale: "Some commitments need human accountability" },
    ],
  };

  const template = templates[signal.signalType] || templates.opened_no_response;
  return template.map((t, i) => ({
    id: ids[i],
    signalId: signal.id,
    claim: t.claim,
    dimension: t.dimension,
    rationale: t.rationale,
    testable: true,
    competingWith: ids.filter((id) => id !== ids[i]),
    createdAt: new Date().toISOString(),
  }));
}

export function loadHypotheses(signalId?: string): EmailHypothesis[] {
  const all = Object.values(loadDB().hypotheses);
  return signalId ? all.filter((h) => h.signalId === signalId) : all;
}

// ─── 3. EMAIL EXPERIMENT ENGINE ─────────────────────────────────────
//
// Every email is a controlled experiment. The platform locks regulated
// content and permits controlled variation only in approved dimensions.

function extractEmailFromAccountId(raw: string): string | null {
  if (!raw) return null;
  const match = raw.match(/<([^>]+@[^>]+)>/);
  if (match) return match[1].trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())) return raw.trim();
  return null;
}

export function createExperiment(input: {
  signalId: string;
  hypothesisId: string;
  employeeId: string;
  accountId: string;
  accountName: string;
  dimension: ExperimentDimension;
  controlCondition: string;
  variation: string;
  subjectLine: string;
  bodyPreview: string;
  toEmail?: string | null;
  inReplyTo?: string | null;
  threadId?: string | null;
  sendTiming: string;
  approvedContentVersion: string;
  complianceChecked: boolean;
  complianceNotes: string;
}): EmailExperiment {
  const db = loadDB();
  const signal = db.signals[input.signalId];
  const accountEmail =
    input.toEmail ||
    extractEmailFromAccountId(input.accountId) ||
    extractEmailFromAccountId(input.accountName) ||
    (signal ? extractEmailFromAccountId(signal.accountId) : null);
  const accountEmails = accountEmail ? loadEmails({ accountId: input.accountId }) : [];
  const sourceEmail = accountEmails[0];
  const exp: EmailExperiment = {
    id: genId("exp"),
    ...input,
    toEmail: accountEmail,
    inReplyTo: input.inReplyTo || (sourceEmail ? sourceEmail.from : null),
    threadId: input.threadId || null,
    status: "hypothesized",
    sentAt: null,
    outcome: null,
    outcomeDescription: null,
    outcomeAt: null,
    cost: 0.5, // base cost per email
    customerBurden: 0.1,
    complianceRisk: 0,
    profitContribution: null,
    controlOutcome: null,
    causalLift: null,
    createdAt: new Date().toISOString(),
  };
  db.experiments[exp.id] = exp;
  saveExperiment(exp);
  return exp;
}

export function approveExperiment(id: string): EmailExperiment | null {
  const db = loadDB();
  const exp = db.experiments[id];
  if (!exp) return null;
  exp.status = "approved";
  saveExperiment(exp);
  return exp;
}

export function markExperimentSent(id: string): EmailExperiment | null {
  const db = loadDB();
  const exp = db.experiments[id];
  if (!exp) return null;
  exp.status = "sent";
  exp.sentAt = new Date().toISOString();
  saveExperiment(exp);
  return exp;
}

export interface MicrosoftSendConfig {
  provider: "microsoft";
  accessToken: string;
  mailbox: string;
}

export type ExperimentSendConfig = GmailConfig | MicrosoftSendConfig;

export async function sendExperimentEmail(
  id: string,
  config: ExperimentSendConfig,
): Promise<{ experiment: EmailExperiment; result: { id: string; threadId?: string } }> {
  const db = loadDB();
  const exp = db.experiments[id];
  if (!exp) throw new Error("Experiment not found");
  if (exp.status !== "approved" && exp.status !== "hypothesized") {
    throw new Error(`Experiment must be approved before sending (status: ${exp.status})`);
  }
  if (!exp.toEmail) {
    throw new Error("Experiment has no recipient email. Use an email signal with a valid from address.");
  }

  const body = exp.bodyPreview
    ? `${exp.bodyPreview}\n\n${exp.variation}`
    : exp.variation;

  let result: { id: string; threadId?: string };

  if (config.provider === "microsoft") {
    const sendResult = await sendEmailGraph(config.accessToken, config.mailbox, {
      to: exp.toEmail,
      subject: exp.subjectLine,
      body,
      isHtml: false,
      inReplyTo: exp.inReplyTo || undefined,
    });
    result = { id: sendResult.id };
  } else {
    const gmailResult = await sendEmailREST(config, {
      to: exp.toEmail,
      subject: exp.subjectLine,
      body,
      isHtml: false,
      inReplyTo: exp.inReplyTo || undefined,
      threadId: exp.threadId || undefined,
    });
    result = { id: gmailResult.id, threadId: gmailResult.threadId };
  }

  exp.status = "sent";
  exp.sentAt = new Date().toISOString();
  if (result.threadId) exp.threadId = result.threadId;
  saveExperiment(exp);

  return { experiment: exp, result };
}

export function recordExperimentOutcome(
  id: string,
  outcome: OutcomeType,
  outcomeDescription: string,
  controlOutcome?: OutcomeType,
): EmailExperiment | null {
  const db = loadDB();
  const exp = db.experiments[id];
  if (!exp) return null;
  exp.outcome = outcome;
  exp.outcomeDescription = outcomeDescription;
  exp.outcomeAt = new Date().toISOString();
  exp.controlOutcome = controlOutcome || null;
  exp.status = "outcome_recorded";

  // Calculate causal lift
  const outcomeValue: Record<OutcomeType, number> = {
    qualified_response: 1.0,
    scheduled_discussion: 0.9,
    workflow_completed: 0.8,
    delegated_to_staff: 0.5,
    partial_engagement: 0.3,
    no_response: 0,
    opt_out: -0.3,
    escalated_to_med_info: 0.2,
  };
  const treatmentValue = outcomeValue[outcome] ?? 0;
  const controlValue = controlOutcome ? (outcomeValue[controlOutcome] ?? 0) : 0;
  exp.causalLift = Math.round((treatmentValue - controlValue) * 100) / 100;

  // Calculate profit contribution
  exp.profitContribution = calculateProfit(exp);
  exp.status = "analyzed";
  saveExperiment(exp);

  // ─── Wire into golden outcome pipeline ─────────────────────────
  // Every email engine experiment outcome also flows into the golden
  // hypothesis outcome system, creating a unified evidence chain.
  try {
    const { recordOutcome } = require("@/lib/golden/outcomes");
    const { loadHypothesisAssignments } = require("@/lib/config");

    // Find or create a matching assignment for this experiment's hypothesis
    const assignments = loadHypothesisAssignments();
    const matchingAssignment = assignments.find(
      (a: any) => a.hypothesisId === exp.hypothesisId && a.employeeId === exp.employeeId,
    );

    if (matchingAssignment) {
      const falsified = exp.causalLift !== null && exp.causalLift <= 0;
      recordOutcome({
        assignmentId: matchingAssignment.id,
        successKind: falsified ? "falsification" : "performance",
        outcomeDescription: outcomeDescription,
        metrics: [
          {
            metric: "Causal lift",
            value: exp.causalLift || 0,
            unit: "lift",
            baseline: 0,
            higherIsBetter: true,
          },
          {
            metric: "Profit contribution",
            value: exp.profitContribution?.total || 0,
            unit: "USD",
            baseline: 0,
            higherIsBetter: true,
          },
        ],
        falsified,
        falsificationEvidence: falsified ? `Causal lift was ${exp.causalLift} (≤ 0)` : undefined,
        contextAtObservation: {
          externalFactors: [],
          concurrentHypotheses: [],
        },
      });
    }
  } catch (e: any) {
    console.error("[email-engine] golden outcome wiring error (non-blocking):", e.message);
  }

  return exp;
}

export function loadExperiments(employeeId?: string): EmailExperiment[] {
  const all = Object.values(loadDB().experiments);
  return employeeId ? all.filter((e) => e.employeeId === employeeId) : all;
}

// ─── 4. PROFIT CALCULATOR ───────────────────────────────────────────
//
// Profit comes from four places:
//   incremental business value
//   + labor saved
//   + avoided failed campaigns
//   + reusable knowledge
//   + automation value
//   − execution cost
//   − customer burden
//   − compliance risk

export function calculateProfit(exp: EmailExperiment): ProfitBreakdown {
  const outcomeValue: Record<OutcomeType, number> = {
    qualified_response: 50,
    scheduled_discussion: 80,
    workflow_completed: 60,
    delegated_to_staff: 20,
    partial_engagement: 10,
    no_response: 0,
    opt_out: -20,
    escalated_to_med_info: 5,
  };

  const incrementalBusinessValue = exp.outcome ? (outcomeValue[exp.outcome] || 0) : 0;
  const laborSaved = exp.outcome === "workflow_completed" ? 15 : exp.outcome === "delegated_to_staff" ? 10 : 0;
  const avoidedFailedCampaigns = exp.causalLift && exp.causalLift > 0.3 ? 25 : 0;
  const reusableKnowledge = exp.outcome ? 5 : 0; // every outcome is information
  const automationValue = exp.dimension === "send_timing" || exp.dimension === "content_sequence" ? 8 : 0;
  const executionCost = exp.cost;
  const customerBurden = exp.customerBurden;
  const complianceRisk = exp.complianceRisk;

  const total = incrementalBusinessValue + laborSaved + avoidedFailedCampaigns + reusableKnowledge + automationValue
    - executionCost - customerBurden - complianceRisk;

  return {
    incrementalBusinessValue,
    laborSaved,
    avoidedFailedCampaigns,
    reusableKnowledge,
    automationValue,
    executionCost,
    customerBurden,
    complianceRisk,
    total: Math.round(total * 100) / 100,
  };
}

// ─── 5. GOLDEN NODE PROMOTION ───────────────────────────────────────
//
// A sequence is promoted only after it demonstrates:
//   meaningful lift, replication, known eligible population,
//   acceptable cost, compliance reliability, known failure boundaries.

export function promoteToGoldenNode(experimentId: string, input: {
  population: string;
  method: string;
  result: string;
  failureBoundary: string;
  replicationCount: number;
}): EmailGoldenNode | null {
  const db = loadDB();
  const exp = db.experiments[experimentId];
  if (!exp) return null;

  // Promotion criteria
  if (!exp.causalLift || exp.causalLift < 0.2) {
    throw new Error("Insufficient causal lift for Golden Node promotion (minimum 0.2)");
  }
  if (input.replicationCount < 2) {
    throw new Error("Insufficient replication for Golden Node promotion (minimum 2)");
  }
  if (!exp.complianceChecked) {
    throw new Error("Compliance check required for Golden Node promotion");
  }

  const node: EmailGoldenNode = {
    id: genId("egn"),
    experimentId,
    population: input.population,
    method: input.method,
    result: input.result,
    failureBoundary: input.failureBoundary,
    lift: exp.causalLift,
    replicationCount: input.replicationCount,
    complianceReliability: exp.complianceRisk === 0 ? 1.0 : 0.8,
    costPerUse: exp.cost,
    promotedAt: new Date().toISOString(),
    reverseTests: [],
    status: "active",
  };

  db.goldenNodes[node.id] = node;
  exp.status = "promoted";
  saveGoldenNode(node);
  saveExperiment(exp);
  return node;
}

export function loadGoldenNodes(): EmailGoldenNode[] {
  return Object.values(loadDB().goldenNodes).sort((a, b) => b.promotedAt.localeCompare(a.promotedAt));
}

// ─── 6. REVERSE FALSIFICATION (PALINDROME) ──────────────────────────
//
// After promotion, SPINOR reverses the discovery:
//   remove one component → test another segment → reverse the order
//   → compare human-only execution → test cheaper variants
//   → search for harm or fatigue → narrow or destroy the method
//
// The system does not endlessly repeat yesterday's winning email
// until customers hate it. It continuously asks:
//   What made this work, where does it stop working, and what
//   cheaper or better method should replace it?

export async function generateReverseTests(goldenNodeId: string): Promise<ReverseTest[]> {
  const db = loadDB();
  const node = db.goldenNodes[goldenNodeId];
  if (!node) throw new Error("Golden Node not found");

  const testTypes: Array<{ type: ReverseTest["testType"]; description: string }> = [
    { type: "remove_component", description: `Remove one component from the winning sequence for "${node.population}" and measure whether lift persists` },
    { type: "test_segment", description: `Test the winning method on a different segment than "${node.population}" to find where it fails` },
    { type: "reverse_order", description: `Reverse the order of steps in the method and compare to the original` },
    { type: "compare_human_only", description: `Compare the automated email sequence against human-only execution — does the email add value?` },
    { type: "test_cheaper_variant", description: `Test a cheaper variant (fewer touches, shorter content, automated only) — can cost be reduced without losing lift?` },
    { type: "search_harm", description: `Search for evidence of harm, fatigue, or annoyance in the recipient population` },
    { type: "narrow_scope", description: `Narrow the eligible population — is the method over-applied to accounts where it doesn't help?` },
  ];

  const tests: ReverseTest[] = testTypes.map((t) => ({
    id: genId("rev"),
    goldenNodeId,
    testType: t.type,
    description: t.description,
    result: null,
    finding: null,
    createdAt: new Date().toISOString(),
  }));

  node.reverseTests = tests;
  node.status = "under_attack";
  saveGoldenNode(node);
  return tests;
}

export function recordReverseTestResult(
  testId: string,
  result: string,
  finding: "confirmed" | "weakened" | "destroyed" | "improved",
): ReverseTest | null {
  const db = loadDB();
  for (const node of Object.values(db.goldenNodes)) {
    const test = node.reverseTests.find((t) => t.id === testId);
    if (test) {
      test.result = result;
      test.finding = finding;
      // Update node status based on findings
      if (finding === "destroyed") node.status = "destroyed";
      else if (finding === "weakened") node.status = "under_attack";
      else if (finding === "improved") node.status = "active";
      saveGoldenNode(node);
      return test;
    }
  }
  return null;
}

// ─── COMPLIANCE CHECK ───────────────────────────────────────────────

export function complianceCheckExperiment(
  subject: string,
  body: string,
): { passed: boolean; issues: string[] } {
  const issues: string[] = [];
  const lower = (subject + " " + body).toLowerCase();

  const forbidden = [
    /\b(effective|safe|efficacy|proven|superior|better than)\b/i,
    /\b(indicated for|treats|cures|prevents)\b/i,
    /\b(off-label|unapproved use)\b/i,
    /\b(gift|free sample|incentive|reward|payment)\b/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(lower)) issues.push("Non-compliant content detected — no product claims or inducements");
  }

  if (!lower.includes("unsubscribe") && !lower.includes("opt-out")) {
    issues.push("Missing opt-out mechanism");
  }

  return { passed: issues.length === 0, issues };
}

// ─── STATS ──────────────────────────────────────────────────────────

export function getEngineStats(): {
  signals: number;
  hypotheses: number;
  experiments: number;
  analyzed: number;
  goldenNodes: number;
  activeNodes: number;
  destroyedNodes: number;
  totalProfit: number;
  avgLift: number;
} {
  const db = loadDB();
  const experiments = Object.values(db.experiments);
  const analyzed = experiments.filter((e) => e.status === "analyzed" || e.status === "promoted");
  const nodes = Object.values(db.goldenNodes);
  const totalProfit = analyzed.reduce((s, e) => s + (e.profitContribution?.total || 0), 0);
  const liftExperiments = analyzed.filter((e) => e.causalLift !== null);
  const avgLift = liftExperiments.length > 0
    ? liftExperiments.reduce((s, e) => s + (e.causalLift || 0), 0) / liftExperiments.length
    : 0;

  return {
    signals: Object.keys(db.signals).length,
    hypotheses: Object.keys(db.hypotheses).length,
    experiments: experiments.length,
    analyzed: analyzed.length,
    goldenNodes: nodes.length,
    activeNodes: nodes.filter((n) => n.status === "active").length,
    destroyedNodes: nodes.filter((n) => n.status === "destroyed").length,
    totalProfit: Math.round(totalProfit * 100) / 100,
    avgLift: Math.round(avgLift * 100) / 100,
  };
}

// ─── Evidence Envelope Integration ────────────────────────────────────

/**
 * Create an evidence envelope from an ingested email.
 * This connects the email engine to the workteleport evidence layer,
 * ensuring every email has a provenance-preserving record with content
 * hash, confidentiality class, and permitted uses.
 */
function createEvidenceEnvelopeFromEmail(email: EmailMessage): void {
  try {
    const { createEvidenceEnvelope } = require("@/lib/workteleport/evidence");
    const { createHash } = require("crypto");

    const contentHash = createHash("sha256")
      .update(`${email.subject}\n${email.body}`)
      .digest("hex");

    createEvidenceEnvelope({
      orgId: email.orgId || "default",
      userId: "email-engine",
      source: "email" as any,
      sourceIdentifier: email.id,
      sender: email.from,
      recipient: email.accountName || email.accountId,
      originalContent: `Subject: ${email.subject}\n\n${email.body}`,
      attachments: [],
      extractedEntities: [],
      factualClaims: [],
      requestedWork: null,
      deadlines: [],
      confidentialityClass: "internal" as any,
      permittedUses: ["task_execution", "experimentation"],
      retentionRule: "90d",
      llmInterpretation: undefined,
    });
  } catch (e: any) {
    // Evidence envelope creation is non-blocking — the email is still ingested
    console.error("[email-engine] evidence envelope error:", e.message);
  }
}
