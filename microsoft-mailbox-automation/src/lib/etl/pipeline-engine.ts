/**
 * Email-to-Pipeline ETL — converts emails with tasks into executable
 * pipelines that the LLM can operate autonomously.
 *
 * Flow:
 *   1. Ingest email (subject, body, attachments, sender, metadata)
 *   2. Classify email type (task, expense, report, invoice, meeting, etc.)
 *   3. Extract structured data (amounts, dates, vendors, line items)
 *   4. Generate executable pipeline steps
 *   5. Each step has: action, input, expected output, LLM prompt, validation
 *   6. Pipeline executes autonomously — LLM browses, computes, enriches
 *   7. Results stored as SPIN artifacts for provenance
 *
 * Supported pipeline types:
 *   - expense_report: Receipt/CSV → enriched expense report with categories
 *   - balance_sheet: Financial data → structured balance sheet
 *   - invoice_processing: Invoice → validated + categorized invoice
 *   - meeting_followup: Meeting email → action items + calendar invites
 *   - data_enrichment: CSV → enriched + optimized data
 *   - compliance_check: Document → compliance validation
 *   - research_task: Email request → web research + report
 */

import { nanoid } from "nanoid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineType =
  | "expense_report"
  | "balance_sheet"
  | "invoice_processing"
  | "meeting_followup"
  | "data_enrichment"
  | "compliance_check"
  | "research_task"
  | "generic_task";

export type StepStatus = "pending" | "executing" | "completed" | "failed" | "skipped";

export type StepAction =
  | "extract"
  | "classify"
  | "enrich"
  | "validate"
  | "compute"
  | "format"
  | "browse"
  | "synthesize"
  | "store"
  | "notify";

export interface PipelineStep {
  stepId: string;
  order: number;
  action: StepAction;
  name: string;
  description: string;
  input: Record<string, unknown>;
  expectedOutput: string;
  llmPrompt?: string;
  llmTemperature?: number;
  status: StepStatus;
  result?: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface Pipeline {
  pipelineId: string;
  emailId: string;
  type: PipelineType;
  title: string;
  source: {
    sender: string;
    subject: string;
    receivedAt: string;
    bodyPreview: string;
    attachments: string[];
  };
  steps: PipelineStep[];
  status: "draft" | "ready" | "executing" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  result?: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Email classification
// ---------------------------------------------------------------------------

interface EmailInput {
  emailId: string;
  sender: string;
  subject: string;
  body: string;
  receivedAt: string;
  attachments?: { filename: string; contentType: string; size: number }[];
}

interface ClassificationResult {
  type: PipelineType;
  confidence: number;
  reason: string;
  extractedData: Record<string, unknown>;
}

export function classifyEmail(email: EmailInput): ClassificationResult {
  const subject = email.subject.toLowerCase();
  const body = email.body.toLowerCase();
  const text = `${subject} ${body}`;
  const attachments = email.attachments || [];

  // Expense report
  if (
    text.includes("expense") ||
    text.includes("receipt") ||
    text.includes("reimburse") ||
    attachments.some((a) => a.filename.match(/\.(csv|xlsx|pdf|jpg|png)$/i))
  ) {
    return {
      type: "expense_report",
      confidence: 0.85,
      reason: "Email mentions expenses or has receipt/CSV attachments",
      extractedData: {
        hasAttachments: attachments.length > 0,
        attachmentTypes: attachments.map((a) => a.contentType),
      },
    };
  }

  // Balance sheet
  if (text.includes("balance sheet") || text.includes("financial statement") || text.includes("p&l")) {
    return {
      type: "balance_sheet",
      confidence: 0.80,
      reason: "Email references financial statements",
      extractedData: {},
    };
  }

  // Invoice
  if (text.includes("invoice") || text.includes("bill") || text.includes("payment due")) {
    return {
      type: "invoice_processing",
      confidence: 0.82,
      reason: "Email references invoices or payments",
      extractedData: {},
    };
  }

  // Meeting followup
  if (text.includes("meeting") || text.includes("action items") || text.includes("follow up") || text.includes("minutes")) {
    return {
      type: "meeting_followup",
      confidence: 0.78,
      reason: "Email references meetings or action items",
      extractedData: {},
    };
  }

  // Data enrichment
  if (attachments.some((a) => a.filename.match(/\.(csv|tsv|xlsx)$/i)) || text.includes("enrich") || text.includes("optimize data")) {
    return {
      type: "data_enrichment",
      confidence: 0.75,
      reason: "Email has data files or mentions enrichment",
      extractedData: {},
    };
  }

  // Compliance
  if (text.includes("compliance") || text.includes("regulatory") || text.includes("audit")) {
    return {
      type: "compliance_check",
      confidence: 0.80,
      reason: "Email references compliance or regulatory matters",
      extractedData: {},
    };
  }

  // Research
  if (text.includes("research") || text.includes("investigate") || text.includes("analyze") || text.includes("report on")) {
    return {
      type: "research_task",
      confidence: 0.70,
      reason: "Email requests research or analysis",
      extractedData: {},
    };
  }

  return {
    type: "generic_task",
    confidence: 0.50,
    reason: "Could not classify into specific pipeline type",
    extractedData: {},
  };
}

// ---------------------------------------------------------------------------
// Pipeline generation
// ---------------------------------------------------------------------------

export function generatePipeline(email: EmailInput): Pipeline {
  const classification = classifyEmail(email);
  const pipelineId = `PLN-${nanoid(12).toUpperCase()}`;
  const now = new Date().toISOString();

  const steps = generateSteps(classification.type, email, classification.extractedData);

  return {
    pipelineId,
    emailId: email.emailId,
    type: classification.type,
    title: `[${classification.type}] ${email.subject}`,
    source: {
      sender: email.sender,
      subject: email.subject,
      receivedAt: email.receivedAt,
      bodyPreview: email.body.slice(0, 200),
      attachments: (email.attachments || []).map((a) => a.filename),
    },
    steps,
    status: "ready",
    createdAt: now,
    updatedAt: now,
    metadata: {
      classificationConfidence: classification.confidence,
      classificationReason: classification.reason,
    },
  };
}

function generateSteps(
  type: PipelineType,
  email: EmailInput,
  extractedData: Record<string, unknown>,
): PipelineStep[] {
  const baseStep = (order: number, action: StepAction, name: string, description: string): PipelineStep => ({
    stepId: `STP-${nanoid(8).toUpperCase()}`,
    order,
    action,
    name,
    description,
    input: {},
    expectedOutput: "",
    status: "pending",
  });

  switch (type) {
    case "expense_report":
      return [
        {
          ...baseStep(1, "extract", "Extract Receipts", "Extract receipt data from attachments and email body"),
          input: { attachments: email.attachments, body: email.body },
          expectedOutput: "Array of receipt objects with vendor, date, amount, category",
          llmPrompt: `Extract expense data from the following email and attachments. For each receipt/expense, extract: vendor, date, amount, currency, category (meals, travel, lodging, supplies, other), description. Return as JSON array.`,
          llmTemperature: 0.1,
        },
        {
          ...baseStep(2, "enrich", "Categorize & Enrich", "Categorize expenses and enrich with tax codes"),
          input: { receipts: "${steps.1.result}" },
          expectedOutput: "Enriched receipts with tax categories and cost centers",
          llmPrompt: `Given these receipts, enrich each with: tax_category (VAT, sales_tax, none), cost_center, project_code, billable (boolean). Return as JSON array.`,
          llmTemperature: 0.2,
        },
        {
          ...baseStep(3, "compute", "Calculate Totals", "Calculate totals by category, tax, and grand total"),
          input: { enrichedReceipts: "${steps.2.result}" },
          expectedOutput: "Summary object with category totals, tax totals, grand total",
        },
        {
          ...baseStep(4, "format", "Format Report", "Format as professional expense report"),
          input: { totals: "${steps.3.result}", receipts: "${steps.2.result}" },
          expectedOutput: "Formatted expense report (HTML + CSV)",
          llmPrompt: `Format this expense data as a professional expense report with: summary table, line items, category breakdown, tax summary. Return HTML.`,
          llmTemperature: 0.3,
        },
        {
          ...baseStep(5, "validate", "Validate Compliance", "Check expense policy compliance"),
          input: { report: "${steps.4.result}" },
          expectedOutput: "Compliance check results with violations if any",
          llmPrompt: `Check this expense report against standard corporate expense policy: meals max $75/day, lodging max $250/night, travel economy class. Flag violations. Return JSON.`,
          llmTemperature: 0.1,
        },
        {
          ...baseStep(6, "store", "Store Results", "Store the expense report and notify"),
          input: { report: "${steps.4.result}", compliance: "${steps.5.result}" },
          expectedOutput: "Stored report ID + notification sent",
        },
      ];

    case "balance_sheet":
      return [
        {
          ...baseStep(1, "extract", "Extract Financial Data", "Extract financial figures from email and attachments"),
          input: { body: email.body, attachments: email.attachments },
          expectedOutput: "Structured financial data (assets, liabilities, equity)",
          llmPrompt: `Extract balance sheet data from this email. Identify: assets (current, fixed), liabilities (current, long-term), equity. Return as JSON with line items.`,
          llmTemperature: 0.1,
        },
        {
          ...baseStep(2, "compute", "Verify Balance", "Verify assets = liabilities + equity"),
          input: { data: "${steps.1.result}" },
          expectedOutput: "Balance verification result",
        },
        {
          ...baseStep(3, "format", "Format Balance Sheet", "Format as standard balance sheet"),
          input: { data: "${steps.1.result}", verification: "${steps.2.result}" },
          expectedOutput: "Formatted balance sheet (HTML)",
          llmPrompt: `Format this balance sheet data as a standard accounting balance sheet with proper sections. Return HTML.`,
          llmTemperature: 0.2,
        },
        {
          ...baseStep(4, "store", "Store & Notify", "Store balance sheet and notify stakeholders"),
          input: { report: "${steps.3.result}" },
          expectedOutput: "Stored report ID + notification sent",
        },
      ];

    case "data_enrichment":
      return [
        {
          ...baseStep(1, "extract", "Parse CSV/Data", "Parse attached CSV or data from email"),
          input: { attachments: email.attachments, body: email.body },
          expectedOutput: "Parsed data array",
          llmPrompt: `Parse the data from this email/attachments. Return as JSON array of objects.`,
          llmTemperature: 0.1,
        },
        {
          ...baseStep(2, "browse", "Web Enrichment", "Enrich each row with web-sourced data"),
          input: { data: "${steps.1.result}" },
          expectedOutput: "Enriched data with additional columns",
          llmPrompt: `For each row in this data, enrich with relevant information from the web. Add columns for: company_info, industry, location, revenue_range, employee_count. Return as JSON array.`,
          llmTemperature: 0.3,
        },
        {
          ...baseStep(3, "compute", "Optimize", "Optimize the data — dedupe, standardize, score"),
          input: { enrichedData: "${steps.2.result}" },
          expectedOutput: "Optimized data with quality scores",
          llmPrompt: `Optimize this data: remove duplicates, standardize formats, add a quality_score (0-1) for each row based on completeness. Return as JSON array.`,
          llmTemperature: 0.2,
        },
        {
          ...baseStep(4, "format", "Format Output", "Format as CSV + summary report"),
          input: { optimizedData: "${steps.3.result}" },
          expectedOutput: "CSV file + summary statistics",
          llmPrompt: `Convert this optimized data to CSV format. Also generate a summary with: total rows, columns, quality distribution. Return JSON with csv and summary fields.`,
          llmTemperature: 0.2,
        },
        {
          ...baseStep(5, "store", "Store Results", "Store enriched data"),
          input: { output: "${steps.4.result}" },
          expectedOutput: "Stored file ID",
        },
      ];

    case "research_task":
      return [
        {
          ...baseStep(1, "extract", "Extract Research Question", "Extract the research question from the email"),
          input: { body: email.body, subject: email.subject },
          expectedOutput: "Structured research question with scope",
          llmPrompt: `Extract the research question from this email. Identify: topic, scope, required_depth, deadline. Return as JSON.`,
          llmTemperature: 0.2,
        },
        {
          ...baseStep(2, "browse", "Web Research", "Search the web for relevant information"),
          input: { question: "${steps.1.result}" },
          expectedOutput: "Research findings with sources",
          llmPrompt: `Research this topic thoroughly. Find 5-10 relevant sources. For each, extract: title, url, key_findings, credibility_score. Return as JSON array.`,
          llmTemperature: 0.4,
        },
        {
          ...baseStep(3, "synthesize", "Synthesize Report", "Synthesize findings into a coherent report"),
          input: { findings: "${steps.2.result}", question: "${steps.1.result}" },
          expectedOutput: "Structured research report",
          llmPrompt: `Synthesize these research findings into a structured report with: executive_summary, key_findings, implications, recommendations, sources. Return as markdown.`,
          llmTemperature: 0.5,
        },
        {
          ...baseStep(4, "store", "Store & Notify", "Store report and notify requester"),
          input: { report: "${steps.3.result}" },
          expectedOutput: "Stored report ID + notification sent",
        },
      ];

    case "meeting_followup":
      return [
        {
          ...baseStep(1, "extract", "Extract Action Items", "Extract action items from meeting email"),
          input: { body: email.body, subject: email.subject },
          expectedOutput: "Array of action items with assignee, deadline",
          llmPrompt: `Extract action items from this meeting email. For each: action, assignee, deadline, priority. Return as JSON array.`,
          llmTemperature: 0.2,
        },
        {
          ...baseStep(2, "format", "Format Summary", "Format meeting summary with action items"),
          input: { actionItems: "${steps.1.result}", body: email.body },
          expectedOutput: "Formatted meeting summary",
          llmPrompt: `Format this meeting summary with: attendees, key_decisions, action_items table. Return as HTML.`,
          llmTemperature: 0.3,
        },
        {
          ...baseStep(3, "notify", "Notify Assignees", "Send notifications to action item assignees"),
          input: { actionItems: "${steps.1.result}" },
          expectedOutput: "Notifications sent count",
        },
      ];

    case "invoice_processing":
      return [
        {
          ...baseStep(1, "extract", "Extract Invoice Data", "Extract invoice details from email/attachments"),
          input: { body: email.body, attachments: email.attachments },
          expectedOutput: "Invoice object with vendor, items, totals, due date",
          llmPrompt: `Extract invoice data: vendor, invoice_number, date, due_date, line_items (description, quantity, unit_price, amount), subtotal, tax, total. Return as JSON.`,
          llmTemperature: 0.1,
        },
        {
          ...baseStep(2, "validate", "Validate Invoice", "Validate invoice data for accuracy"),
          input: { invoice: "${steps.1.result}" },
          expectedOutput: "Validation results with discrepancies",
          llmPrompt: `Validate this invoice: check math (line items sum to subtotal, subtotal + tax = total), check due_date is valid, flag missing fields. Return JSON.`,
          llmTemperature: 0.1,
        },
        {
          ...baseStep(3, "classify", "Categorize", "Categorize invoice for accounting"),
          input: { invoice: "${steps.1.result}" },
          expectedOutput: "Accounting categories (expense type, cost center, GL code)",
          llmPrompt: `Categorize this invoice for accounting: expense_type, cost_center, gl_code, payment_terms. Return JSON.`,
          llmTemperature: 0.2,
        },
        {
          ...baseStep(4, "store", "Store & Route", "Store invoice and route for approval"),
          input: { invoice: "${steps.1.result}", validation: "${steps.2.result}", categories: "${steps.3.result}" },
          expectedOutput: "Stored invoice ID + approval routed",
        },
      ];

    case "compliance_check":
      return [
        {
          ...baseStep(1, "extract", "Extract Document", "Extract document content from email"),
          input: { body: email.body, attachments: email.attachments },
          expectedOutput: "Document text content",
          llmPrompt: `Extract the full text content from this email and attachments. Return as text.`,
          llmTemperature: 0.1,
        },
        {
          ...baseStep(2, "validate", "Compliance Check", "Check document against compliance rules"),
          input: { document: "${steps.1.result}" },
          expectedOutput: "Compliance check results",
          llmPrompt: `Check this document against standard compliance rules: no off-label claims, no promotional language, accurate safety information, proper disclaimers. Flag violations. Return JSON with violations array.`,
          llmTemperature: 0.1,
        },
        {
          ...baseStep(3, "format", "Format Report", "Format compliance report"),
          input: { results: "${steps.2.result}" },
          expectedOutput: "Formatted compliance report",
          llmPrompt: `Format this compliance check as a report with: summary, violations (severity, description, recommendation), overall_status. Return HTML.`,
          llmTemperature: 0.2,
        },
        {
          ...baseStep(4, "store", "Store & Notify", "Store compliance report and notify"),
          input: { report: "${steps.3.result}" },
          expectedOutput: "Stored report ID + notification sent",
        },
      ];

    default: // generic_task
      return [
        {
          ...baseStep(1, "extract", "Extract Task", "Extract the task from the email"),
          input: { body: email.body, subject: email.subject },
          expectedOutput: "Structured task description",
          llmPrompt: `Extract the task from this email. What is being asked? What are the deliverables? What is the deadline? Return as JSON.`,
          llmTemperature: 0.2,
        },
        {
          ...baseStep(2, "synthesize", "Plan Execution", "Plan how to execute the task"),
          input: { task: "${steps.1.result}" },
          expectedOutput: "Execution plan with steps",
          llmPrompt: `Create an execution plan for this task. Break it into 3-5 concrete steps. Return as JSON array.`,
          llmTemperature: 0.3,
        },
        {
          ...baseStep(3, "store", "Store & Notify", "Store the plan and notify"),
          input: { plan: "${steps.2.result}" },
          expectedOutput: "Stored plan ID + notification sent",
        },
      ];
  }
}

// ---------------------------------------------------------------------------
// Pipeline storage (in-memory + file)
// ---------------------------------------------------------------------------

const pipelines: Map<string, Pipeline> = new Map();

export function savePipeline(pipeline: Pipeline): void {
  pipelines.set(pipeline.pipelineId, pipeline);
}

export function loadPipeline(pipelineId: string): Pipeline | null {
  return pipelines.get(pipelineId) || null;
}

export function loadAllPipelines(): Pipeline[] {
  return Array.from(pipelines.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deletePipeline(pipelineId: string): void {
  pipelines.delete(pipelineId);
}

// ---------------------------------------------------------------------------
// Pipeline execution (simulated — real LLM calls happen via /api/llm/infer)
// ---------------------------------------------------------------------------

export function advanceStep(pipelineId: string, stepResult?: Record<string, unknown>): Pipeline | null {
  const pipeline = loadPipeline(pipelineId);
  if (!pipeline) return null;

  const currentStep = pipeline.steps.find((s) => s.status === "pending");
  if (!currentStep) {
    pipeline.status = "completed";
    pipeline.updatedAt = new Date().toISOString();
    savePipeline(pipeline);
    return pipeline;
  }

  currentStep.status = "executing";
  currentStep.startedAt = new Date().toISOString();
  pipeline.status = "executing";
  savePipeline(pipeline);

  // If result provided, mark as completed
  if (stepResult) {
    currentStep.result = stepResult;
    currentStep.status = "completed";
    currentStep.completedAt = new Date().toISOString();
    currentStep.durationMs = currentStep.startedAt
      ? Date.now() - new Date(currentStep.startedAt).getTime()
      : 0;
  }

  pipeline.updatedAt = new Date().toISOString();
  savePipeline(pipeline);
  return pipeline;
}

export function getPipelineStats(): {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
} {
  const all = loadAllPipelines();
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const p of all) {
    byType[p.type] = (byType[p.type] || 0) + 1;
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
  }
  return { total: all.length, byType, byStatus };
}
