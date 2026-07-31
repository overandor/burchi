/**
 * Consent engagement platform — types and API client.
 *
 * HARD CONSTRAINTS (non-negotiable):
 *   1. Recipients must be opted in — no implicit/inferred/scraped consent
 *   2. No unsolicited outbound messaging — non-consenting contacts are analytics-only
 *   3. Consent must be explicit in the data model (source, timestamp, scope, withdrawal)
 *   4. Human approval ≠ recipient consent — both are required
 *   5. Optimization restricted to consenting populations
 *   6. Reward = legitimate product metrics, not persuasion success
 *   7. Eligibility enforced technically at the send boundary
 *
 * Governing flow:
 *   CONSENTED INPUT → ELIGIBILITY CHECK → MESSAGE GENERATION
 *   → APPROVAL/POLICY CHECK → SEND → MEASURE → AUDIT
 *
 * Rejected bases (will never be valid ConsentSource values):
 *   page_visit, scraped_profile, public_info, inferred_interest,
 *   third_party_list, implicit_visit_behavior, browser_history,
 *   social_media_public, directory_listing
 */

// ─── Types ─────────────────────────────────────────────────────────────

export interface Contact {
  id: string
  email: string
  name: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

/**
 * Valid consent sources — ALL require affirmative, recorded permission.
 * Any source not in this list is rejected by the API and database CHECK constraint.
 */
export type ConsentSource =
  | "csv_import" | "crm_sync" | "signup_webhook" | "double_opt_in" | "manual_import"

/**
 * Sources that are explicitly INVALID and will never be accepted.
 * This list exists for documentation and validation — if any of these
 * are passed as consent_source, the API returns 400.
 */
export const INVALID_CONSENT_SOURCES = [
  "page_visit", "scraped_profile", "public_info", "inferred_interest",
  "third_party_list", "implicit_visit_behavior", "browser_history",
  "social_media_public", "directory_listing", "analytics_inferred",
] as const

export type ConsentScope =
  | "marketing" | "support" | "transactional" | "follow_up" | "reminders" | "all"

export type RevocationStatus = "active" | "revoked"

export interface ConsentRecord {
  id: string
  contact_id: string
  consent_source: ConsentSource
  consented_at: string
  consent_scope: ConsentScope
  revocation_status: RevocationStatus
  revoked_at: string | null
  revocation_reason: string | null
  evidence: Record<string, unknown>
  created_at: string
}

export type SuppressionReason =
  | "unsubscribe" | "bounce" | "complaint" | "manual" | "expired_consent"

export interface SuppressionEntry {
  id: string
  email: string
  reason: SuppressionReason
  channel: "email" | "sms" | "push"
  created_at: string
  notes: string | null
}

export type MessageType =
  | "reply" | "follow_up" | "reminder" | "support" | "newsletter" | "transactional"

export type MessageStatus =
  | "draft" | "pending_approval" | "approved" | "rejected"
  | "sent" | "failed" | "suppressed"

export interface Message {
  id: string
  contact_id: string
  subject: string | null
  body: string
  message_type: MessageType
  status: MessageStatus
  approved_by: string | null
  approved_at: string | null
  rejected_reason: string | null
  sent_at: string | null
  provider_id: string | null
  experiment_id: string | null
  variant_id: string | null
  created_at: string
  updated_at: string
  // joined fields
  contact_email?: string
  contact_name?: string
}

export interface EligibilityDecision {
  id: string
  contact_id: string
  message_id: string | null
  eligible: boolean
  consent_record_id: string | null
  suppression_checked: boolean
  suppression_match: boolean
  reason: string
  checked_at: string
}

export type RewardMetric =
  | "response_helpfulness" | "customer_satisfaction" | "booking_completion"
  | "retention" | "reduced_support_time" | "response_rate"

export interface Experiment {
  id: string
  name: string
  description: string | null
  status: "draft" | "running" | "completed" | "stopped"
  reward_metric: RewardMetric
  audience_filter: Record<string, unknown>
  created_at: string
  ended_at: string | null
  variants?: ExperimentVariant[]
}

export interface ExperimentVariant {
  id: string
  experiment_id: string
  label: string
  content: string
  impressions: number
  responses: number
  reward_sum: number
  created_at: string
}

export type OutcomeType =
  | "response" | "helpfulness" | "csat" | "booking_completion"
  | "retention" | "support_time" | "response_rate"

export interface Outcome {
  id: string
  contact_id: string
  message_id: string | null
  outcome_type: OutcomeType
  value: number
  metadata: Record<string, unknown>
  recorded_at: string
}

export interface AuditEntry {
  id: number
  action: string
  entity_type: string
  entity_id: string | null
  actor: string
  details: Record<string, unknown>
  created_at: string
}

export interface ImportBatch {
  id: string
  source: "csv" | "json" | "crm_sync" | "webhook"
  filename: string | null
  total_rows: number
  accepted_rows: number
  rejected_rows: number
  rejection_log: Array<{ row: number; email: string; reason: string }>
  created_at: string
}

export interface ImportResult {
  batch: ImportBatch
  accepted: number
  rejected: number
  rejections: Array<{ row: number; email: string; reason: string }>
}

export interface ConsentOverview {
  total_contacts: number
  active_consent: number
  revoked_consent: number
  suppressed: number
  pending_approval: number
  sent_messages: number
  active_experiments: number
  recent_outcomes: number
}

// ─── API Client ────────────────────────────────────────────────────────

async function cFetch<T>(path: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    })
    if (!res.ok) {
      console.error(`[consent] ${path} returned ${res.status}`)
      return null
    }
    return await res.json() as T
  } catch {
    return null
  }
}

async function cPost<T>(path: string, body?: unknown): Promise<T | null> {
  return cFetch<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined })
}

async function cPatch<T>(path: string, body: unknown): Promise<T | null> {
  return cFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) })
}

async function cDelete<T>(path: string): Promise<T | null> {
  return cFetch<T>(path, { method: "DELETE" })
}

export const consentApi = {
  // Overview
  getOverview: () => cFetch<ConsentOverview>("/api/consent/overview"),

  // Contacts
  getContacts: (limit = 50, offset = 0) =>
    cFetch<Contact[]>(`/api/consent/contacts?limit=${limit}&offset=${offset}`),
  getContact: (id: string) => cFetch<Contact & { consent: ConsentRecord[] }>(`/api/consent/contacts/${id}`),
  deleteContact: (id: string) => cDelete<{ ok: boolean }>(`/api/consent/contacts/${id}`),

  // Consent records
  getConsentRecords: (contactId?: string) =>
    cFetch<ConsentRecord[]>(`/api/consent/consent-records${contactId ? `?contact_id=${contactId}` : ""}`),
  addConsent: (contactId: string, source: ConsentSource, scope: ConsentScope, consentedAt: string, evidence?: Record<string, unknown>) =>
    cPost<ConsentRecord>("/api/consent/consent-records", { contact_id: contactId, consent_source: source, consent_scope: scope, consented_at: consentedAt, evidence }),
  revokeConsent: (id: string, reason: string) =>
    cPatch<ConsentRecord>(`/api/consent/consent-records/${id}`, { revocation_status: "revoked", revocation_reason: reason }),

  // Import
  importContacts: (source: "csv" | "json", data: string, filename?: string) =>
    cPost<ImportResult>("/api/consent/import", { source, data, filename }),
  getImportBatches: () => cFetch<ImportBatch[]>("/api/consent/import"),

  // Suppression
  getSuppression: () => cFetch<SuppressionEntry[]>("/api/consent/suppression"),
  addSuppression: (email: string, reason: SuppressionReason, notes?: string) =>
    cPost<SuppressionEntry>("/api/consent/suppression", { email, reason, notes }),
  removeSuppression: (id: string) => cDelete<{ ok: boolean }>(`/api/consent/suppression/${id}`),

  // Messages
  getMessages: (status?: MessageStatus) =>
    cFetch<Message[]>(`/api/consent/messages${status ? `?status=${status}` : ""}`),
  getMessage: (id: string) => cFetch<Message & { eligibility: EligibilityDecision | null }>(`/api/consent/messages/${id}`),
  createDraft: (contactId: string, messageType: MessageType, subject: string, body: string, experimentId?: string, variantId?: string) =>
    cPost<Message>("/api/consent/messages", { contact_id: contactId, message_type: messageType, subject, body, experiment_id: experimentId, variant_id: variantId }),
  approveMessage: (id: string, approvedBy: string) =>
    cPost<{ ok: boolean }>(`/api/consent/messages/${id}/approve`, { approved_by: approvedBy }),
  rejectMessage: (id: string, reason: string) =>
    cPost<{ ok: boolean }>(`/api/consent/messages/${id}/reject`, { reason }),
  sendMessage: (id: string) =>
    cPost<{ ok: boolean; provider_id?: string; error?: string }>(`/api/consent/messages/${id}/send`),

  // Audit
  getAudit: (limit = 50, entityType?: string, entityId?: string) =>
    cFetch<AuditEntry[]>(`/api/consent/audit?limit=${limit}${entityType ? `&entity_type=${entityType}` : ""}${entityId ? `&entity_id=${entityId}` : ""}`),

  // Experiments
  getExperiments: () => cFetch<Experiment[]>("/api/consent/experiments"),
  createExperiment: (name: string, rewardMetric: RewardMetric, description?: string) =>
    cPost<Experiment>("/api/consent/experiments", { name, reward_metric: rewardMetric, description }),
  addVariant: (experimentId: string, label: string, content: string) =>
    cPost<ExperimentVariant>(`/api/consent/experiments/${experimentId}/variants`, { label, content }),

  // Outcomes
  getOutcomes: (limit = 50) => cFetch<Outcome[]>(`/api/consent/outcomes?limit=${limit}`),
  recordOutcome: (contactId: string, outcomeType: OutcomeType, value: number, messageId?: string, metadata?: Record<string, unknown>) =>
    cPost<Outcome>("/api/consent/outcomes", { contact_id: contactId, outcome_type: outcomeType, value, message_id: messageId, metadata }),

  // Webhook
  signupWebhook: (email: string, name: string, consentScope: ConsentScope, evidence: Record<string, unknown>) =>
    cPost<{ ok: boolean; contact_id: string }>("/api/consent/webhook/signup", { email, name, consent_scope: consentScope, evidence }),
}
// trigger deploy
