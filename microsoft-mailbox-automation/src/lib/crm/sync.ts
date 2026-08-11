/**
 * CRM Sync — Veeva / Salesforce integration layer.
 *
 * Syncs experiments, outcomes, and territory interactions to external CRM
 * systems. Supports:
 *   - Veeva CRM (REST API, OAuth 2.0 client credentials)
 *   - Salesforce (REST API, OAuth 2.0 client credentials)
 *
 * Architecture:
 *   - A sync queue table records pending and completed syncs.
 *   - Each sync attempt is logged with status, response, and retry count.
 *   - Failed syncs are retried with exponential backoff (max 3 attempts).
 *   - Credentials are stored in the email_credentials table (reusing the
 *     encrypted credential store) with provider="veeva" or "salesforce".
 *
 * Environment variables:
 *   VEEVA_CLIENT_ID, VEEVA_CLIENT_SECRET, VEEVA_HOST (e.g. my.veevavault.com)
 *   SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET, SALESFORCE_HOST
 *
 * If no credentials are configured, syncs are queued but not sent,
 * and the API returns a clear "CRM not configured" error.
 */

import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

// ─── Types ─────────────────────────────────────────────────────────────

export type CRMProvider = "veeva" | "salesforce";

export type SyncEntityType = "experiment" | "outcome" | "territory_account" | "phone_call" | "field_route";

export type SyncStatus = "pending" | "synced" | "failed" | "skipped";

export interface SyncQueueEntry {
  id: string;
  orgId: string;
  userId: string;
  provider: CRMProvider;
  entityType: SyncEntityType;
  entityId: string;
  externalId: string | null;
  status: SyncStatus;
  attempts: number;
  lastError: string | null;
  lastSyncedAt: string | null;
  payload: Record<string, any>;
  response: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CRMConfig {
  provider: CRMProvider;
  clientId: string;
  clientSecret: string;
  host: string;
  tokenEndpoint?: string;
  apiBasePath?: string;
}

// ─── Config resolution ─────────────────────────────────────────────────

export function getCRMConfig(provider: CRMProvider): CRMConfig | null {
  if (provider === "veeva") {
    const clientId = process.env.VEEVA_CLIENT_ID || "";
    const clientSecret = process.env.VEEVA_CLIENT_SECRET || "";
    const host = process.env.VEEVA_HOST || "";
    if (!clientId || !clientSecret || !host) return null;
    return {
      provider: "veeva",
      clientId,
      clientSecret,
      host,
      tokenEndpoint: `https://${host}/services/oauth2/token`,
      apiBasePath: `/api/v22.2`,
    };
  }
  if (provider === "salesforce") {
    const clientId = process.env.SALESFORCE_CLIENT_ID || "";
    const clientSecret = process.env.SALESFORCE_CLIENT_SECRET || "";
    const host = process.env.SALESFORCE_HOST || "";
    if (!clientId || !clientSecret || !host) return null;
    return {
      provider: "salesforce",
      clientId,
      clientSecret,
      host,
      tokenEndpoint: `https://${host}/services/oauth2/token`,
      apiBasePath: `/services/data/v58.0`,
    };
  }
  return null;
}

export function getAvailableCRMs(): CRMProvider[] {
  const providers: CRMProvider[] = [];
  if (getCRMConfig("veeva")) providers.push("veeva");
  if (getCRMConfig("salesforce")) providers.push("salesforce");
  return providers;
}

// ─── Token management ──────────────────────────────────────────────────

let _tokenCache: Record<string, { token: string; expiresAt: number }> = {};

async function getAccessToken(config: CRMConfig): Promise<string> {
  const cacheKey = config.provider;
  const cached = _tokenCache[cacheKey];
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.token;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(config.tokenEndpoint!, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`CRM auth failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const token = data.access_token;
    const expiresIn = data.expires_in || 3600;
    _tokenCache[cacheKey] = { token, expiresAt: Date.now() + expiresIn * 1000 };
    return token;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Sync queue ────────────────────────────────────────────────────────

export function enqueueSync(
  orgId: string,
  userId: string,
  provider: CRMProvider,
  entityType: SyncEntityType,
  entityId: string,
  payload: Record<string, any>,
): SyncQueueEntry {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  // Check if there's an existing entry for this entity+provider
  const existing = db
    .prepare(
      `SELECT * FROM crm_sync_queue WHERE org_id = ? AND provider = ? AND entity_type = ? AND entity_id = ?`,
    )
    .get(orgId, provider, entityType, entityId) as any;

  if (existing) {
    // Update the existing entry with new payload and reset to pending
    db.prepare(
      `UPDATE crm_sync_queue SET payload = ?, status = 'pending', last_error = NULL, updated_at = ? WHERE id = ?`,
    ).run(JSON.stringify(payload), now, existing.id);
    return getSyncEntry(orgId, userId, existing.id)!;
  }

  db.prepare(
    `INSERT INTO crm_sync_queue (id, org_id, user_id, provider, entity_type, entity_id, external_id, status, attempts, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 'pending', 0, ?, ?, ?)`,
  ).run(id, orgId, userId, provider, entityType, entityId, JSON.stringify(payload), now, now);

  return getSyncEntry(orgId, userId, id)!;
}

export function getSyncEntry(orgId: string, userId: string, entryId: string): SyncQueueEntry | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM crm_sync_queue WHERE org_id = ? AND id = ?`)
    .get(orgId, entryId) as any;
  return row ? decodeSyncRow(row) : null;
}

export function getSyncQueue(
  orgId: string,
  filter?: { status?: SyncStatus; provider?: CRMProvider; entityType?: SyncEntityType },
): SyncQueueEntry[] {
  const db = getDb();
  let sql = `SELECT * FROM crm_sync_queue WHERE org_id = ?`;
  const params: any[] = [orgId];
  if (filter?.status) { sql += ` AND status = ?`; params.push(filter.status); }
  if (filter?.provider) { sql += ` AND provider = ?`; params.push(filter.provider); }
  if (filter?.entityType) { sql += ` AND entity_type = ?`; params.push(filter.entityType); }
  sql += ` ORDER BY updated_at DESC LIMIT 200`;
  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(decodeSyncRow);
}

function updateSyncEntry(
  orgId: string,
  entryId: string,
  updates: { status: SyncStatus; externalId?: string | null; response?: Record<string, any> | null; error?: string | null },
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const sets = ["status = ?", "attempts = attempts + 1", "updated_at = ?"];
  const params: any[] = [updates.status, now];

  if (updates.externalId !== undefined) { sets.push("external_id = ?"); params.push(updates.externalId); }
  if (updates.response !== undefined) { sets.push("response = ?"); params.push(JSON.stringify(updates.response || {})); }
  if (updates.error !== undefined) { sets.push("last_error = ?"); params.push(updates.error); }
  if (updates.status === "synced") { sets.push("last_synced_at = ?"); params.push(now); }

  params.push(orgId, entryId);
  db.prepare(`UPDATE crm_sync_queue SET ${sets.join(", ")} WHERE org_id = ? AND id = ?`).run(...params);
}

// ─── Sync execution ────────────────────────────────────────────────────

interface SyncResult {
  success: boolean;
  externalId?: string;
  response?: Record<string, any>;
  error?: string;
}

export async function executeSync(orgId: string, entryId: string): Promise<SyncResult> {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM crm_sync_queue WHERE org_id = ? AND id = ?`)
    .get(orgId, entryId) as any;

  if (!row) return { success: false, error: "Sync entry not found" };

  const entry = decodeSyncRow(row);
  const config = getCRMConfig(entry.provider);

  if (!config) {
    updateSyncEntry(orgId, entryId, {
      status: "skipped",
      error: `${entry.provider} CRM not configured`,
    });
    return { success: false, error: `${entry.provider} CRM not configured` };
  }

  if (entry.attempts >= 3) {
    updateSyncEntry(orgId, entryId, {
      status: "failed",
      error: entry.lastError || "Max retries exceeded",
    });
    return { success: false, error: "Max retries exceeded" };
  }

  try {
    const token = await getAccessToken(config);
    const endpoint = entry.externalId
      ? `${config.apiBasePath}/sobjects/${getObjectName(entry.entityType)}/${entry.externalId}`
      : `${config.apiBasePath}/sobjects/${getObjectName(entry.entityType)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const method = entry.externalId ? "PATCH" : "POST";
    const res = await fetch(`https://${config.host}${endpoint}`, {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(transformPayload(entry.entityType, entry.payload)),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const text = await res.text();
    let response: Record<string, any> = {};
    try { response = text ? JSON.parse(text) : {}; } catch { response = { raw: text.slice(0, 500) }; }

    if (res.ok) {
      const externalId = response.id || response.External_Id__c || entry.externalId || randomUUID();
      updateSyncEntry(orgId, entryId, {
        status: "synced",
        externalId,
        response,
      });
      return { success: true, externalId, response };
    }

    // Rate limit or server error — retry
    if (res.status === 429 || res.status >= 500) {
      updateSyncEntry(orgId, entryId, {
        status: "pending",
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      });
      return { success: false, error: `HTTP ${res.status} (will retry)` };
    }

    // Client error — don't retry
    updateSyncEntry(orgId, entryId, {
      status: "failed",
      error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      response,
    });
    return { success: false, error: `HTTP ${res.status}` };
  } catch (e: any) {
    updateSyncEntry(orgId, entryId, {
      status: "pending",
      error: e.message,
    });
    return { success: false, error: e.message };
  }
}

export async function processPendingSyncs(orgId: string, provider?: CRMProvider): Promise<{
  processed: number;
  synced: number;
  failed: number;
  skipped: number;
}> {
  const pending = getSyncQueue(orgId, { status: "pending", provider });
  let synced = 0, failed = 0, skipped = 0;

  for (const entry of pending) {
    const result = await executeSync(orgId, entry.id);
    if (result.success) synced++;
    else if (result.error?.includes("not configured")) skipped++;
    else failed++;
  }

  return { processed: pending.length, synced, failed, skipped };
}

// ─── Helpers ───────────────────────────────────────────────────────────

function getObjectName(entityType: SyncEntityType): string {
  switch (entityType) {
    case "experiment": return "Email_Experiment__c";
    case "outcome": return "Experiment_Outcome__c";
    case "territory_account": return "Account";
    case "phone_call": return "Call_Log__c";
    case "field_route": return "Field_Route__c";
    default: return "Custom_Object__c";
  }
}

function transformPayload(entityType: SyncEntityType, payload: Record<string, any>): Record<string, any> {
  // Transform internal payload to CRM field names
  switch (entityType) {
    case "experiment":
      return {
        Subject_Line__c: payload.subjectLine,
        Variation__c: payload.variation,
        Status__c: payload.status,
        Hypothesis_ID__c: payload.hypothesisId,
        Recipient_Email__c: payload.toEmail,
        Send_Timing__c: payload.sendTiming,
        Compliance_Checked__c: payload.complianceChecked,
      };
    case "outcome":
      return {
        Experiment_ID__c: payload.experimentId,
        Outcome_Type__c: payload.outcome,
        Description__c: payload.description,
        Causal_Lift__c: payload.causalLift,
        Profit_Contribution__c: payload.profitContribution,
        Falsified__c: payload.falsified,
      };
    case "territory_account":
      return {
        Name: payload.accountName,
        HCP_Name__c: payload.hcpName,
        Specialty__c: payload.specialty,
        Territory__c: payload.territory,
        Funnel_State__c: payload.funnelState,
        Autonomy_Class__c: payload.autonomyClass,
        Priority_Score__c: payload.priorityScore,
      };
    case "phone_call":
      return {
        Phone_Number__c: payload.phoneNumber,
        Call_Type__c: payload.type,
        Direction__c: payload.direction,
        Duration_Seconds__c: payload.durationSec,
        Notes__c: payload.notes,
        Call_Timestamp__c: payload.timestamp,
      };
    case "field_route":
      return {
        Route_Date__c: payload.date,
        Status__c: payload.status,
        Stop_Count__c: payload.stops?.length || 0,
        Stops_JSON__c: JSON.stringify(payload.stops || []),
      };
    default:
      return payload;
  }
}

function decodeSyncRow(row: any): SyncQueueEntry {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    provider: row.provider as CRMProvider,
    entityType: row.entity_type as SyncEntityType,
    entityId: row.entity_id,
    externalId: row.external_id,
    status: row.status as SyncStatus,
    attempts: row.attempts,
    lastError: row.last_error,
    lastSyncedAt: row.last_synced_at,
    payload: row.payload ? JSON.parse(row.payload) : {},
    response: row.response ? JSON.parse(row.response) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
