/**
 * Dynamic EAV store for the DataPipe living dataset.
 *
 * Entities (HCPs, products, territories) have attribute-value pairs that
 * auto-discover new columns on ingestion. Values are period-stamped so
 * month-over-month changes are queryable. No schema migration needed when
 * Gilead adds a new product or KPI — new attribute keys are created on the fly.
 */

import { getDb, DEFAULT_ORG_ID } from "@/lib/db";
import { randomUUID } from "crypto";
import { createHash } from "crypto";

export { DEFAULT_ORG_ID, getDb };

// ─── Types ─────────────────────────────────────────────────────────────

export interface DatapipeEntity {
  id: string;
  org_id: string;
  entity_type: string;
  identity_key: string;
  canonical_name: string;
  status: string;
  merged_into: string | null;
  confidence: number;
  first_seen: string;
  last_seen: string;
  created_at: string;
  updated_at: string;
}

export interface DatapipeAttribute {
  id: string;
  org_id: string;
  attribute_key: string;
  label: string;
  data_type: string;
  category: string;
  is_timeseries: number;
  unit: string | null;
  discovered_at: string;
}

export interface DatapipeValue {
  id: number;
  org_id: string;
  entity_id: string;
  attribute_key: string;
  value: string | null;
  value_numeric: number | null;
  source_file: string | null;
  source_sheet: string | null;
  source_row: number | null;
  confidence: number;
  period: string | null;
  updated_at: string;
}

export interface DatapipeIngestion {
  id: string;
  org_id: string;
  file_name: string;
  file_hash: string | null;
  period: string | null;
  sheet_filter: string | null;
  rows_extracted: number;
  entities_created: number;
  entities_updated: number;
  attributes_discovered: number;
  changes_detected: number;
  status: string;
  error: string | null;
  created_at: string;
}

export interface DatapipeChange {
  id: number;
  org_id: string;
  ingestion_id: string;
  entity_id: string;
  change_type: string;
  attribute_key: string | null;
  old_value: string | null;
  new_value: string | null;
  delta_numeric: number | null;
  severity: string;
  created_at: string;
}

export interface IngestionResult {
  ingestion_id: string;
  entities_created: number;
  entities_updated: number;
  attributes_discovered: number;
  changes_detected: number;
  changes: DatapipeChange[];
  rows_extracted: number;
}

// ─── Attribute auto-discovery ──────────────────────────────────────────

/**
 * Known attribute categories for pharma data.
 * New keys are auto-classified by pattern matching.
 */
const ATTRIBUTE_CATEGORIES: { pattern: RegExp; category: string; data_type: string; is_timeseries: boolean; unit?: string }[] = [
  // KPIs — time-series metrics
  { pattern: /^trx_/i, category: "kpi", data_type: "number", is_timeseries: true, unit: "count" },
  { pattern: /^nrx_/i, category: "kpi", data_type: "number", is_timeseries: true, unit: "count" },
  { pattern: /market_share/i, category: "kpi", data_type: "number", is_timeseries: true, unit: "%" },
  { pattern: /market_growth/i, category: "kpi", data_type: "number", is_timeseries: true, unit: "%" },
  { pattern: /contribution/i, category: "kpi", data_type: "number", is_timeseries: true, unit: "%" },
  { pattern: /call_goal/i, category: "kpi", data_type: "number", is_timeseries: true, unit: "count" },
  { pattern: /call_activity|calls_made|actual_calls/i, category: "kpi", data_type: "number", is_timeseries: true, unit: "count" },
  { pattern: /bottles/i, category: "kpi", data_type: "number", is_timeseries: true, unit: "bottles" },
  { pattern: /growth/i, category: "kpi", data_type: "number", is_timeseries: true, unit: "%" },
  // Identity
  { pattern: /^(gilead_id|npi|geo_id|territory_id)$/i, category: "identity", data_type: "string", is_timeseries: false },
  // Contact
  { pattern: /^(address|street|city|state|zip|zip_code|phone|fax|email)$/i, category: "contact", data_type: "string", is_timeseries: false },
  // Territory
  { pattern: /^(territory|region|district|area)$/i, category: "territory", data_type: "string", is_timeseries: false },
  // HCP attributes
  { pattern: /^(specialty|decile|target|target_flag|prescriber_type)$/i, category: "hcp", data_type: "string", is_timeseries: false },
  { pattern: /^(name|first_name|last_name|doctor|physician|provider)$/i, category: "identity", data_type: "string", is_timeseries: false },
];

function classifyAttribute(key: string): { category: string; data_type: string; is_timeseries: boolean; unit?: string } {
  for (const rule of ATTRIBUTE_CATEGORIES) {
    if (rule.pattern.test(key)) {
      return { category: rule.category, data_type: rule.data_type, is_timeseries: rule.is_timeseries, unit: rule.unit };
    }
  }
  // Heuristic: if key contains a number-like suffix, treat as numeric KPI
  if (/_(count|vol|volume|rate|ratio|pct|percent|score)$/i.test(key)) {
    return { category: "kpi", data_type: "number", is_timeseries: true };
  }
  return { category: "general", data_type: "string", is_timeseries: false };
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bTrx\b/g, "TRx")
    .replace(/\bNrx\b/g, "NRx")
    .replace(/\bHcp\b/g, "HCP");
}

/**
 * Ensure an attribute exists in dp_attributes. Create if new.
 * Returns true if the attribute was newly discovered.
 */
function ensureAttribute(orgId: string, key: string): boolean {
  const db = getDb();
  const existing = db
    .prepare(`SELECT 1 FROM dp_attributes WHERE org_id = ? AND attribute_key = ?`)
    .get(orgId, key);
  if (existing) return false;

  const classification = classifyAttribute(key);
  db.prepare(
    `INSERT OR IGNORE INTO dp_attributes (id, org_id, attribute_key, label, data_type, category, is_timeseries, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    orgId,
    key,
    humanizeKey(key),
    classification.data_type,
    classification.category,
    classification.is_timeseries ? 1 : 0,
    classification.unit || null,
  );
  return true;
}

// ─── Entity resolution ─────────────────────────────────────────────────

/**
 * Build an identity key for deduplication.
 * Priority: gilead_id > npi > normalized name + zip > normalized name + address
 */
function buildIdentityKey(entityType: string, fields: Record<string, any>): string {
  if (entityType === "hcp") {
    const gileadId = fields.gilead_id || fields["Gilead ID"] || fields["GILEAD_ID"];
    if (gileadId) return `gilead:${String(gileadId).trim()}`;

    const npi = fields.npi || fields.NPI;
    if (npi && String(npi).length === 10) return `npi:${String(npi).trim()}`;

    const name = (fields.name || fields.Name || fields.doctor || fields.physician || fields.provider || "").toString().trim().toLowerCase().replace(/\s+/g, " ");
    const zip = (fields.zip || fields.zip_code || fields.Zip || fields["Zip Code"] || "").toString().trim();
    if (name && zip) return `name_zip:${name}::${zip}`;

    const address = (fields.address || fields.Address || fields.street || "").toString().trim().toLowerCase().replace(/\s+/g, " ");
    if (name && address) return `name_addr:${name}::${address}`;

    if (name) return `name:${name}`;
  }

  if (entityType === "product") {
    const name = (fields.name || fields.product || fields.value || "").toString().trim().toLowerCase();
    return `product:${name}`;
  }

  if (entityType === "territory") {
    const geoId = fields.geo_id || fields.GEO_ID || fields.territory || "";
    return `territory:${String(geoId).trim().toLowerCase()}`;
  }

  // Generic fallback
  const name = (fields.name || fields.value || fields.canonical_name || "").toString().trim().toLowerCase();
  return `${entityType}:${name}`;
}

function buildCanonicalName(entityType: string, fields: Record<string, any>): string {
  if (entityType === "hcp") {
    const name = fields.name || fields.Name || fields.doctor || fields.physician || fields.provider || "";
    return String(name).trim();
  }
  if (entityType === "product") {
    return String(fields.name || fields.product || fields.value || "").trim();
  }
  if (entityType === "territory") {
    return String(fields.geo_id || fields.territory || fields.name || "").trim();
  }
  return String(fields.name || fields.value || "Unknown").trim();
}

/**
 * Resolve an entity by identity key. Create if new.
 * Returns { entity, isNew }.
 */
function resolveEntity(
  orgId: string,
  entityType: string,
  fields: Record<string, any>,
): { entity: DatapipeEntity; isNew: boolean } {
  const db = getDb();
  const identityKey = buildIdentityKey(entityType, fields);
  const canonicalName = buildCanonicalName(entityType, fields);

  const existing = db
    .prepare(`SELECT * FROM dp_entities WHERE org_id = ? AND entity_type = ? AND identity_key = ?`)
    .get(orgId, entityType, identityKey) as DatapipeEntity | undefined;

  if (existing) {
    // Update last_seen
    db.prepare(`UPDATE dp_entities SET last_seen = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(existing.id);
    return { entity: { ...existing, last_seen: new Date().toISOString() }, isNew: false };
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO dp_entities (id, org_id, entity_type, identity_key, canonical_name, status, confidence)
     VALUES (?, ?, ?, ?, ?, 'active', 1.0)`,
  ).run(id, orgId, entityType, identityKey, canonicalName);

  const entity = db.prepare(`SELECT * FROM dp_entities WHERE id = ?`).get(id) as DatapipeEntity;
  return { entity, isNew: true };
}

// ─── Value upsert + change detection ───────────────────────────────────

/**
 * Upsert a value for an entity-attribute-period combo.
 * Detects changes vs. the previous value and records to history.
 * Returns a change record if the value changed, null otherwise.
 */
function upsertValue(
  orgId: string,
  entityId: string,
  attributeKey: string,
  value: string | null,
  sourceFile: string | null,
  sourceSheet: string | null,
  sourceRow: number | null,
  confidence: number,
  period: string | null,
  ingestionId: string,
): DatapipeChange | null {
  const db = getDb();
  const numericValue = value !== null && value !== "" && !isNaN(Number(value)) ? Number(value) : null;

  // Check for existing value (same period or latest if no period)
  let prevValue: DatapipeValue | undefined;
  if (period) {
    prevValue = db
      .prepare(`SELECT * FROM dp_values WHERE entity_id = ? AND attribute_key = ? AND period = ?`)
      .get(entityId, attributeKey, period) as DatapipeValue | undefined;
  } else {
    prevValue = db
      .prepare(`SELECT * FROM dp_values WHERE entity_id = ? AND attribute_key = ? AND (period IS NULL OR period = '')`)
      .get(entityId, attributeKey) as DatapipeValue | undefined;
  }

  // Record in history (always)
  db.prepare(
    `INSERT INTO dp_value_history (org_id, entity_id, attribute_key, value, value_numeric, period, ingestion_id, source_file)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(orgId, entityId, attributeKey, value, numericValue, period, ingestionId, sourceFile);

  if (prevValue) {
    // Value exists for this period — check if it changed
    if (prevValue.value === value) {
      // No change — just update source metadata
      db.prepare(
        `UPDATE dp_values SET source_file = ?, source_sheet = ?, source_row = ?, confidence = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(sourceFile, sourceSheet, sourceRow, confidence, prevValue.id);
      return null;
    }

    // Value changed — update and record change
    const delta = prevValue.value_numeric !== null && numericValue !== null
      ? numericValue - prevValue.value_numeric
      : null;

    db.prepare(
      `UPDATE dp_values SET value = ?, value_numeric = ?, source_file = ?, source_sheet = ?, source_row = ?, confidence = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(value, numericValue, sourceFile, sourceSheet, sourceRow, confidence, prevValue.id);

    // Determine severity for KPI changes
    let severity = "info";
    if (delta !== null && prevValue.value_numeric !== null) {
      const pctChange = prevValue.value_numeric !== 0
        ? Math.abs(delta / prevValue.value_numeric) * 100
        : 0;
      if (pctChange > 20) severity = "warning";
      if (pctChange > 50) severity = "critical";
    }

    return {
      id: 0,
      org_id: orgId,
      ingestion_id: ingestionId,
      entity_id: entityId,
      change_type: "value_changed",
      attribute_key: attributeKey,
      old_value: prevValue.value,
      new_value: value,
      delta_numeric: delta,
      severity,
      created_at: new Date().toISOString(),
    };
  }

  // New value for this period — insert
  db.prepare(
    `INSERT INTO dp_values (org_id, entity_id, attribute_key, value, value_numeric, source_file, source_sheet, source_row, confidence, period)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(orgId, entityId, attributeKey, value, numericValue, sourceFile, sourceSheet, sourceRow, confidence, period);

  // Check if entity had any previous value for this attribute (different period)
  // Fix: properly parenthesize the OR clause
  const prevPeriodValue = db
    .prepare(`SELECT * FROM dp_values WHERE entity_id = ? AND attribute_key = ? AND (period != ? OR period IS NULL) ORDER BY updated_at DESC LIMIT 1`)
    .get(entityId, attributeKey, period || "") as DatapipeValue | undefined;

  if (!prevPeriodValue) {
    // First-ever value for this attribute — it's a "value_added" change
    return {
      id: 0,
      org_id: orgId,
      ingestion_id: ingestionId,
      entity_id: entityId,
      change_type: "value_added",
      attribute_key: attributeKey,
      old_value: null,
      new_value: value,
      delta_numeric: null,
      severity: "info",
      created_at: new Date().toISOString(),
    };
  }

  // Value exists from a previous period — compare to detect cross-period change
  if (prevPeriodValue.value !== value) {
    const delta = prevPeriodValue.value_numeric !== null && numericValue !== null
      ? numericValue - prevPeriodValue.value_numeric
      : null;

    let severity = "info";
    if (delta !== null && prevPeriodValue.value_numeric !== null) {
      const pctChange = prevPeriodValue.value_numeric !== 0
        ? Math.abs(delta / prevPeriodValue.value_numeric) * 100
        : 0;
      if (pctChange > 20) severity = "warning";
      if (pctChange > 50) severity = "critical";
    }

    return {
      id: 0,
      org_id: orgId,
      ingestion_id: ingestionId,
      entity_id: entityId,
      change_type: "value_changed",
      attribute_key: attributeKey,
      old_value: prevPeriodValue.value,
      new_value: value,
      delta_numeric: delta,
      severity,
      created_at: new Date().toISOString(),
    };
  }

  return null;
}

// ─── Ingestion ─────────────────────────────────────────────────────────

/**
 * Ingest extracted entities into the living dataset.
 *
 * For each extracted entity:
 * 1. Resolve or create the entity (dedup by identity_key)
 * 2. Auto-discover new attributes
 * 3. Upsert values with period stamping
 * 4. Detect and record changes
 *
 * Returns ingestion summary + list of changes.
 */
export function ingestEntities(
  orgId: string,
  fileName: string,
  fileHash: string,
  period: string | null,
  sheetFilter: string | null,
  extractedEntities: any[],
): IngestionResult {
  const db = getDb();
  const ingestionId = randomUUID();

  // Create ingestion record
  db.prepare(
    `INSERT INTO dp_ingestions (id, org_id, file_name, file_hash, period, sheet_filter, status)
     VALUES (?, ?, ?, ?, ?, ?, 'processing')`,
  ).run(ingestionId, orgId, fileName, fileHash, period, sheetFilter);

  try {
    let entitiesCreated = 0;
    let entitiesUpdated = 0;
    let attributesDiscovered = 0;
    const allChanges: DatapipeChange[] = [];
    const seenEntityIds = new Set<string>();

    // Group extracted entities by identity to avoid re-processing
    // Each extracted entity has: entity_type, value, source_sheet, source_row, fields
    for (const ext of extractedEntities) {
      const entityType = ext.entity_type || "hcp";
      const fields = ext.fields || {};
      // Also include the "value" as a field if not already present
      if (ext.value && !fields.value) fields.value = ext.value;

      const { entity, isNew } = resolveEntity(orgId, entityType, fields);
      seenEntityIds.add(entity.id);

      if (isNew) entitiesCreated++;
      else entitiesUpdated++;

      // Record new_entity change
      if (isNew) {
        const change: DatapipeChange = {
          id: 0,
          org_id: orgId,
          ingestion_id: ingestionId,
          entity_id: entity.id,
          change_type: "new_entity",
          attribute_key: null,
          old_value: null,
          new_value: entity.canonical_name,
          delta_numeric: null,
          severity: "info",
          created_at: new Date().toISOString(),
        };
        allChanges.push(change);
      }

      // Upsert all fields as attribute values
      for (const [key, val] of Object.entries(fields)) {
        if (val === null || val === undefined || val === "") continue;
        // Skip internal keys
        if (key.startsWith("_") || key === "value") continue;

        const attrKey = key.toLowerCase().trim().replace(/\s+/g, "_");
        const wasNew = ensureAttribute(orgId, attrKey);
        if (wasNew) attributesDiscovered++;

        const valStr = String(val).trim();
        const change = upsertValue(
          orgId,
          entity.id,
          attrKey,
          valStr,
          fileName,
          ext.source_sheet || null,
          ext.source_row || null,
          ext.confidence || 1.0,
          period,
          ingestionId,
        );
        if (change) allChanges.push(change);
      }
    }

    // Detect entities that were in previous ingestions but not this one (dropped)
    if (period) {
      const prevEntities = db
        .prepare(
          `SELECT DISTINCT e.id, e.canonical_name
           FROM dp_entities e
           JOIN dp_values v ON v.entity_id = e.id
           WHERE e.org_id = ? AND e.status = 'active'
             AND v.period IS NOT NULL AND v.period != ?
             AND e.id NOT IN (${seenEntityIds.size > 0 ? Array(seenEntityIds.size).fill("?").join(",") : "''"})`,
        )
        .all(orgId, period, ...Array.from(seenEntityIds)) as { id: string; canonical_name: string }[];

      for (const prev of prevEntities) {
        allChanges.push({
          id: 0,
          org_id: orgId,
          ingestion_id: ingestionId,
          entity_id: prev.id,
          change_type: "entity_dropped",
          attribute_key: null,
          old_value: prev.canonical_name,
          new_value: null,
          delta_numeric: null,
          severity: "warning",
          created_at: new Date().toISOString(),
        });
      }
    }

    // Persist changes
    const changeStmt = db.prepare(
      `INSERT INTO dp_changes (org_id, ingestion_id, entity_id, change_type, attribute_key, old_value, new_value, delta_numeric, severity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const change of allChanges) {
      const result = changeStmt.run(
        change.org_id,
        change.ingestion_id,
        change.entity_id,
        change.change_type,
        change.attribute_key,
        change.old_value,
        change.new_value,
        change.delta_numeric,
        change.severity,
      );
      change.id = Number(result.lastInsertRowid);
    }

    // Update ingestion record
    db.prepare(
      `UPDATE dp_ingestions
       SET rows_extracted = ?, entities_created = ?, entities_updated = ?, attributes_discovered = ?, changes_detected = ?, status = 'completed'
       WHERE id = ?`,
    ).run(
      extractedEntities.length,
      entitiesCreated,
      entitiesUpdated,
      attributesDiscovered,
      allChanges.length,
      ingestionId,
    );

    return {
      ingestion_id: ingestionId,
      entities_created: entitiesCreated,
      entities_updated: entitiesUpdated,
      attributes_discovered: attributesDiscovered,
      changes_detected: allChanges.length,
      changes: allChanges,
      rows_extracted: extractedEntities.length,
    };
  } catch (err: any) {
    db.prepare(`UPDATE dp_ingestions SET status = 'failed', error = ? WHERE id = ?`)
      .run(err.message, ingestionId);
    throw err;
  }
}

// ─── Query layer ───────────────────────────────────────────────────────

/**
 * Get the living dataset as a dynamic wide table.
 * Returns entities with all their current attribute values pivoted into columns.
 */
export function getDataset(
  orgId: string,
  options: {
    entityType?: string;
    period?: string;
    limit?: number;
    offset?: number;
    search?: string;
  } = {},
): { entities: Record<string, any>[]; attributes: DatapipeAttribute[]; total: number } {
  const db = getDb();
  const limit = options.limit || 100;
  const offset = options.offset || 0;

  // Get all attributes for this org (optionally filtered by entity type usage)
  const attributes = db
    .prepare(`SELECT * FROM dp_attributes WHERE org_id = ? ORDER BY category, attribute_key`)
    .all(orgId) as DatapipeAttribute[];

  // Build base query for entities
  let whereClause = "WHERE e.org_id = ? AND e.status = 'active'";
  const params: any[] = [orgId];
  if (options.entityType) {
    whereClause += " AND e.entity_type = ?";
    params.push(options.entityType);
  }
  if (options.search) {
    whereClause += " AND e.canonical_name LIKE ?";
    params.push(`%${options.search}%`);
  }

  const total = (db.prepare(`SELECT count(*) as c FROM dp_entities e ${whereClause}`).get(...params) as { c: number }).c;

  // Get entities
  const entities = db
    .prepare(`SELECT * FROM dp_entities e ${whereClause} ORDER BY e.last_seen DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as DatapipeEntity[];

  if (entities.length === 0) {
    return { entities: [], attributes, total };
  }

  // Get all current values for these entities
  const entityIds = entities.map((e) => e.id);
  const placeholders = entityIds.map(() => "?").join(",");
  let valueQuery = `SELECT * FROM dp_values WHERE entity_id IN (${placeholders})`;
  const valueParams: any[] = [...entityIds];
  if (options.period) {
    valueQuery += ` AND (period = ? OR period IS NULL)`;
    valueParams.push(options.period);
  }
  const values = db.prepare(valueQuery).all(...valueParams) as DatapipeValue[];

  // Pivot values into entity rows
  const valuesByEntity = new Map<string, Map<string, DatapipeValue>>();
  for (const v of values) {
    if (!valuesByEntity.has(v.entity_id)) valuesByEntity.set(v.entity_id, new Map());
    valuesByEntity.get(v.entity_id)!.set(v.attribute_key, v);
  }

  const rows = entities.map((e) => {
    const row: Record<string, any> = {
      _entity_id: e.id,
      _entity_type: e.entity_type,
      _canonical_name: e.canonical_name,
      _status: e.status,
      _confidence: e.confidence,
      _first_seen: e.first_seen,
      _last_seen: e.last_seen,
    };
    const entityValues = valuesByEntity.get(e.id);
    if (entityValues) {
      for (const attr of attributes) {
        const v = entityValues.get(attr.attribute_key);
        if (v) {
          row[attr.attribute_key] = attr.data_type === "number" ? v.value_numeric : v.value;
        }
      }
    }
    return row;
  });

  return { entities: rows, attributes, total };
}

/**
 * Get time-series values for a single entity and attribute.
 */
export function getEntityTimeSeries(
  orgId: string,
  entityId: string,
  attributeKey?: string,
): { periods: string[]; values: Record<string, { value: string | null; numeric: number | null }[]> } {
  const db = getDb();
  let query = `SELECT attribute_key, period, value, value_numeric, recorded_at
               FROM dp_value_history
               WHERE org_id = ? AND entity_id = ?`;
  const params: any[] = [orgId, entityId];
  if (attributeKey) {
    query += ` AND attribute_key = ?`;
    params.push(attributeKey);
  }
  query += ` ORDER BY attribute_key, period, recorded_at`;

  const rows = db.prepare(query).all(...params) as {
    attribute_key: string;
    period: string | null;
    value: string | null;
    value_numeric: number | null;
    recorded_at: string;
  }[];

  const result: Record<string, { value: string | null; numeric: number | null }[]> = {};
  for (const r of rows) {
    if (!result[r.attribute_key]) result[r.attribute_key] = [];
    result[r.attribute_key].push({
      value: r.value,
      numeric: r.value_numeric,
    });
  }

  const periods = [...new Set(rows.map((r) => r.period).filter(Boolean))].sort() as string[];
  return { periods, values: result };
}

/**
 * Get recent changes for the dashboard.
 */
export function getRecentChanges(
  orgId: string,
  options: { limit?: number; ingestionId?: string; changeType?: string } = {},
): DatapipeChange[] {
  const db = getDb();
  const limit = options.limit || 50;
  let query = `
    SELECT c.*, e.canonical_name as entity_name, e.entity_type
    FROM dp_changes c
    JOIN dp_entities e ON e.id = c.entity_id
    WHERE c.org_id = ?
  `;
  const params: any[] = [orgId];
  if (options.ingestionId) {
    query += ` AND c.ingestion_id = ?`;
    params.push(options.ingestionId);
  }
  if (options.changeType) {
    query += ` AND c.change_type = ?`;
    params.push(options.changeType);
  }
  query += ` ORDER BY c.created_at DESC LIMIT ?`;
  params.push(limit);

  return db.prepare(query).all(...params) as any[];
}

/**
 * Get ingestion history.
 */
export function getIngestionHistory(orgId: string, limit: number = 20): DatapipeIngestion[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM dp_ingestions WHERE org_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(orgId, limit) as DatapipeIngestion[];
}

/**
 * Get dataset overview stats.
 */
export function getDatasetOverview(orgId: string): {
  totalEntities: number;
  entitiesByType: Record<string, number>;
  totalAttributes: number;
  attributesByCategory: Record<string, number>;
  totalIngestions: number;
  totalChanges: number;
  latestIngestion: DatapipeIngestion | null;
  pendingEnrichment: number;
} {
  const db = getDb();

  const totalEntities = (db.prepare(`SELECT count(*) as c FROM dp_entities WHERE org_id = ? AND status = 'active'`).get(orgId) as { c: number }).c;

  const typeRows = db
    .prepare(`SELECT entity_type, count(*) as c FROM dp_entities WHERE org_id = ? AND status = 'active' GROUP BY entity_type`)
    .all(orgId) as { entity_type: string; c: number }[];
  const entitiesByType: Record<string, number> = {};
  for (const r of typeRows) entitiesByType[r.entity_type] = r.c;

  const totalAttributes = (db.prepare(`SELECT count(*) as c FROM dp_attributes WHERE org_id = ?`).get(orgId) as { c: number }).c;

  const catRows = db
    .prepare(`SELECT category, count(*) as c FROM dp_attributes WHERE org_id = ? GROUP BY category`)
    .all(orgId) as { category: string; c: number }[];
  const attributesByCategory: Record<string, number> = {};
  for (const r of catRows) attributesByCategory[r.category] = r.c;

  const totalIngestions = (db.prepare(`SELECT count(*) as c FROM dp_ingestions WHERE org_id = ?`).get(orgId) as { c: number }).c;
  const totalChanges = (db.prepare(`SELECT count(*) as c FROM dp_changes WHERE org_id = ?`).get(orgId) as { c: number }).c;

  const latestIngestion = db
    .prepare(`SELECT * FROM dp_ingestions WHERE org_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1`)
    .get(orgId) as DatapipeIngestion | null;

  const pendingEnrichment = (db
    .prepare(`SELECT count(*) as c FROM dp_enrichment_queue WHERE org_id = ? AND status = 'pending'`)
    .get(orgId) as { c: number }).c;

  return {
    totalEntities,
    entitiesByType,
    totalAttributes,
    attributesByCategory,
    totalIngestions,
    totalChanges,
    latestIngestion,
    pendingEnrichment,
  };
}

/**
 * Get all discovered attributes (for dynamic column rendering).
 */
export function getAttributes(orgId: string, category?: string): DatapipeAttribute[] {
  const db = getDb();
  if (category) {
    return db
      .prepare(`SELECT * FROM dp_attributes WHERE org_id = ? AND category = ? ORDER BY attribute_key`)
      .all(orgId, category) as DatapipeAttribute[];
  }
  return db
    .prepare(`SELECT * FROM dp_attributes WHERE org_id = ? ORDER BY category, attribute_key`)
    .all(orgId) as DatapipeAttribute[];
}

/**
 * Get a single entity with all its current values.
 */
export function getEntity(orgId: string, entityId: string): {
  entity: DatapipeEntity;
  values: Record<string, any>;
  attributes: DatapipeAttribute[];
} | null {
  const db = getDb();
  const entity = db
    .prepare(`SELECT * FROM dp_entities WHERE org_id = ? AND id = ?`)
    .get(orgId, entityId) as DatapipeEntity | undefined;
  if (!entity) return null;

  const values = db
    .prepare(`SELECT * FROM dp_values WHERE entity_id = ?`)
    .all(entityId) as DatapipeValue[];

  const attributes = db
    .prepare(`SELECT * FROM dp_attributes WHERE org_id = ? ORDER BY category, attribute_key`)
    .all(orgId) as DatapipeAttribute[];

  const valueMap: Record<string, any> = {};
  for (const v of values) {
    const attr = attributes.find((a) => a.attribute_key === v.attribute_key);
    valueMap[v.attribute_key] = attr?.data_type === "number" ? v.value_numeric : v.value;
  }

  return { entity, values: valueMap, attributes };
}

/**
 * Queue an enrichment task for an entity.
 */
export function queueEnrichment(
  orgId: string,
  entityId: string,
  enrichmentType: string,
  requestData: Record<string, any> = {},
): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO dp_enrichment_queue (id, org_id, entity_id, enrichment_type, status, request_data)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  ).run(id, orgId, entityId, enrichmentType, JSON.stringify(requestData));
  return id;
}

/**
 * Get pending enrichment tasks.
 */
export function getPendingEnrichment(orgId: string, limit: number = 10): any[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT q.*, e.canonical_name, e.entity_type
       FROM dp_enrichment_queue q
       JOIN dp_entities e ON e.id = q.entity_id
       WHERE q.org_id = ? AND q.status = 'pending'
       ORDER BY q.created_at LIMIT ?`,
    )
    .all(orgId, limit) as any[];
}

/**
 * Mark enrichment task complete and apply results as attribute values.
 */
export function completeEnrichment(
  taskId: string,
  results: Record<string, any>,
  period: string | null = null,
): void {
  const db = getDb();
  const task = db.prepare(`SELECT * FROM dp_enrichment_queue WHERE id = ?`).get(taskId) as any;
  if (!task) return;

  const ingestionId = `enrichment_${task.id}`;

  // Apply each result as an attribute value
  for (const [key, value] of Object.entries(results)) {
    if (value === null || value === undefined || value === "") continue;
    const attrKey = key.toLowerCase().trim().replace(/\s+/g, "_");
    ensureAttribute(task.org_id, attrKey);
    upsertValue(
      task.org_id,
      task.entity_id,
      attrKey,
      String(value),
      `enrichment:${task.enrichment_type}`,
      null,
      null,
      0.9,
      period,
      ingestionId,
    );
  }

  db.prepare(
    `UPDATE dp_enrichment_queue SET status = 'completed', result_data = ?, completed_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify(results), taskId);
}

/**
 * Compute a file hash for dedup detection.
 */
export function hashFile(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").substring(0, 16);
}

/**
 * Check if a file has already been ingested (by hash).
 */
export function isFileIngested(orgId: string, fileHash: string): boolean {
  const db = getDb();
  const row = db
    .prepare(`SELECT 1 FROM dp_ingestions WHERE org_id = ? AND file_hash = ? AND status = 'completed'`)
    .get(orgId, fileHash);
  return !!row;
}
