/**
 * Capability Graph — Constrained Tool Permissions
 *
 * Each tool declares what it can read, create, modify, delete, who may
 * use it, what data classes are permitted, and which approvals are required.
 *
 * The planner selects the safest available execution method:
 *   native_api → deterministic_service → file_exchange → browser_agent → human_checkpoint
 *
 * Enforces least-privilege and separation-of-duties.
 */

import { nanoid } from "nanoid";
import { getDb } from "@/lib/db";
import type {
  CapabilityDeclaration,
  CapabilityCategory,
  ExecutionMethod,
  ConfidentialityClass,
} from "@/types/workteleport";

// ─── Schema helpers ────────────────────────────────────────────────────

interface CapabilityRow {
  id: string;
  org_id: string;
  name: string;
  category: string;
  description: string;
  execution_method: string;
  can_read: string;
  can_create: string;
  can_modify: string;
  can_delete: string;
  permitted_roles: string;
  permitted_users: string;
  permitted_data_classes: string;
  required_approvals: string;
  reversible: number;
  validation_tests: string;
  monetary_threshold: number | null;
  segregation_conflicts: string;
  created_at: string;
}

function rowToCapability(row: CapabilityRow): CapabilityDeclaration {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    category: row.category as CapabilityCategory,
    description: row.description,
    executionMethod: row.execution_method as ExecutionMethod,
    canRead: JSON.parse(row.can_read),
    canCreate: JSON.parse(row.can_create),
    canModify: JSON.parse(row.can_modify),
    canDelete: JSON.parse(row.can_delete),
    permittedRoles: JSON.parse(row.permitted_roles),
    permittedUsers: JSON.parse(row.permitted_users),
    permittedDataClasses: JSON.parse(row.permitted_data_classes) as ConfidentialityClass[],
    requiredApprovals: JSON.parse(row.required_approvals),
    reversible: row.reversible === 1,
    validationTests: JSON.parse(row.validation_tests),
    monetaryThreshold: row.monetary_threshold || undefined,
    segregationOfDutiesConflict: JSON.parse(row.segregation_conflicts),
  };
}

// ─── Public API ────────────────────────────────────────────────────────

export interface CreateCapabilityInput {
  orgId: string;
  name: string;
  category: CapabilityCategory;
  description: string;
  executionMethod: ExecutionMethod;
  canRead?: string[];
  canCreate?: string[];
  canModify?: string[];
  canDelete?: string[];
  permittedRoles?: string[];
  permittedUsers?: string[];
  permittedDataClasses?: ConfidentialityClass[];
  requiredApprovals?: string[];
  reversible?: boolean;
  validationTests?: string[];
  monetaryThreshold?: number;
  segregationOfDutiesConflict?: string[];
}

export function createCapability(input: CreateCapabilityInput): CapabilityDeclaration {
  const id = `cap_${nanoid(12)}`;
  getDb()
    .prepare(
      `INSERT INTO capabilities (
        id, org_id, name, category, description, execution_method,
        can_read, can_create, can_modify, can_delete,
        permitted_roles, permitted_users, permitted_data_classes,
        required_approvals, reversible, validation_tests,
        monetary_threshold, segregation_conflicts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.orgId,
      input.name,
      input.category,
      input.description,
      input.executionMethod,
      JSON.stringify(input.canRead || []),
      JSON.stringify(input.canCreate || []),
      JSON.stringify(input.canModify || []),
      JSON.stringify(input.canDelete || []),
      JSON.stringify(input.permittedRoles || []),
      JSON.stringify(input.permittedUsers || []),
      JSON.stringify(input.permittedDataClasses || ["internal"]),
      JSON.stringify(input.requiredApprovals || []),
      input.reversible === false ? 0 : 1,
      JSON.stringify(input.validationTests || []),
      input.monetaryThreshold || null,
      JSON.stringify(input.segregationOfDutiesConflict || []),
    );
  return getCapability(input.orgId, id)!;
}

export function getCapability(orgId: string, id: string): CapabilityDeclaration | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM capabilities WHERE org_id = ? AND id = ?`)
    .get(orgId, id) as CapabilityRow | undefined;
  return row ? rowToCapability(row) : undefined;
}

export function listCapabilities(orgId: string): CapabilityDeclaration[] {
  const rows = getDb()
    .prepare(`SELECT * FROM capabilities WHERE org_id = ? ORDER BY name`)
    .all(orgId) as CapabilityRow[];
  return rows.map(rowToCapability);
}

export function countCapabilities(orgId: string): number {
  const row = getDb()
    .prepare(`SELECT count(*) as c FROM capabilities WHERE org_id = ?`)
    .get(orgId) as { c: number };
  return row.c;
}

// ─── Permission Resolution ─────────────────────────────────────────────

export interface PermissionCheckResult {
  allowed: boolean;
  reasons: string[];
  selectedCapability?: CapabilityDeclaration;
}

/**
 * Check if a user with a given role can use a capability with given data.
 */
export function checkPermission(
  orgId: string,
  capabilityId: string,
  userRole: string,
  userId: string,
  dataClass: ConfidentialityClass,
): PermissionCheckResult {
  const cap = getCapability(orgId, capabilityId);
  if (!cap) {
    return { allowed: false, reasons: ["Capability not found"] };
  }

  const reasons: string[] = [];

  // Check role permission
  if (cap.permittedRoles.length > 0 && !cap.permittedRoles.includes(userRole)) {
    reasons.push(`Role ${userRole} not permitted (allowed: ${cap.permittedRoles.join(", ")})`);
  }

  // Check user permission (if user-specific list exists)
  if (cap.permittedUsers.length > 0 && !cap.permittedUsers.includes(userId)) {
    reasons.push(`User ${userId} not in permitted users list`);
  }

  // Check data class
  const dataClassHierarchy: ConfidentialityClass[] = ["public", "internal", "confidential", "restricted", "regulated"];
  const capMaxClass = Math.max(...cap.permittedDataClasses.map((c) => dataClassHierarchy.indexOf(c)));
  const requiredClassIdx = dataClassHierarchy.indexOf(dataClass);
  if (requiredClassIdx > capMaxClass) {
    reasons.push(`Data class ${dataClass} exceeds capability's permitted classes`);
  }

  return {
    allowed: reasons.length === 0,
    reasons: reasons.length > 0 ? reasons : ["All checks passed"],
    selectedCapability: cap,
  };
}

/**
 * Check for separation-of-duties violations between two capabilities.
 */
export function checkSegregationOfDuties(
  orgId: string,
  cap1Id: string,
  cap2Id: string,
): { violated: boolean; reason: string } {
  if (cap1Id === cap2Id) {
    return { violated: false, reason: "Same capability" };
  }
  const cap1 = getCapability(orgId, cap1Id);
  const cap2 = getCapability(orgId, cap2Id);
  if (!cap1 || !cap2) {
    return { violated: false, reason: "Capability not found" };
  }

  if (cap1.segregationOfDutiesConflict.includes(cap2Id)) {
    return { violated: true, reason: `${cap1.name} conflicts with ${cap2.name}` };
  }
  if (cap2.segregationOfDutiesConflict.includes(cap1Id)) {
    return { violated: true, reason: `${cap2.name} conflicts with ${cap1.name}` };
  }

  return { violated: false, reason: "No conflict" };
}

// ─── Capability Planning (Stage 5) ─────────────────────────────────────

/**
 * Select the safest available execution method for a task.
 * Prefers native API, falls back to deterministic service, then file
 * exchange, then browser agent, and finally human checkpoint.
 */
export function planCapabilities(
  orgId: string,
  taskType: string,
  userRole: string,
  userId: string,
  dataClass: ConfidentialityClass = "internal",
): CapabilityDeclaration[] {
  const allCaps = listCapabilities(orgId);
  const methodPriority: ExecutionMethod[] = [
    "native_api",
    "deterministic_service",
    "file_exchange",
    "browser_agent",
    "human_checkpoint",
  ];

  // Filter capabilities that match the task type category
  const categoryMap: Record<string, CapabilityCategory[]> = {
    research: ["read"],
    create: ["create"],
    modify: ["modify"],
    reconcile: ["read", "modify"],
    compare: ["read"],
    enrich: ["read", "modify"],
    submit: ["submit"],
    schedule: ["create"],
    communicate: ["communicate"],
    approve: ["approve"],
    escalate: ["communicate"],
    monitor: ["read"],
    experiment: ["execute"],
  };

  const allowedCategories = categoryMap[taskType] || ["read"];

  // Sort by execution method priority
  const sorted = allCaps
    .filter((c) => allowedCategories.includes(c.category))
    .sort((a, b) => methodPriority.indexOf(a.executionMethod) - methodPriority.indexOf(b.executionMethod));

  // Return capabilities the user is permitted to use
  return sorted.filter((c) => {
    const check = checkPermission(orgId, c.id, userRole, userId, dataClass);
    return check.allowed;
  });
}

// ─── Default Capabilities Seeding ──────────────────────────────────────

/**
 * Seed default capabilities for an org.
 * These represent the basic tool set available to all organizations.
 */
export function seedDefaultCapabilities(orgId: string): number {
  if (countCapabilities(orgId) > 0) return 0;

  const defaults: CreateCapabilityInput[] = [
    {
      orgId,
      name: "Email Reader",
      category: "read",
      description: "Read email messages and extract content",
      executionMethod: "native_api",
      canRead: ["email_messages", "email_attachments"],
      permittedRoles: ["field_rep", "director", "admin"],
      permittedDataClasses: ["internal", "confidential"],
      reversible: true,
      validationTests: ["message_id_verified", "content_hash_matched"],
    },
    {
      orgId,
      name: "CRM Record Reader",
      category: "read",
      description: "Read CRM records (accounts, contacts, activities)",
      executionMethod: "native_api",
      canRead: ["crm_accounts", "crm_contacts", "crm_activities"],
      permittedRoles: ["field_rep", "director", "admin"],
      permittedDataClasses: ["internal", "confidential"],
      reversible: true,
      validationTests: ["record_exists", "fields_valid"],
    },
    {
      orgId,
      name: "Document Parser",
      category: "read",
      description: "Parse PDF, CSV, and spreadsheet attachments",
      executionMethod: "deterministic_service",
      canRead: ["pdf_files", "csv_files", "spreadsheets"],
      permittedRoles: ["field_rep", "director", "admin"],
      permittedDataClasses: ["internal", "confidential"],
      reversible: true,
      validationTests: ["parse_complete", "no_data_loss"],
    },
    {
      orgId,
      name: "Expense Report Drafter",
      category: "create",
      description: "Create draft expense reports from transaction data",
      executionMethod: "deterministic_service",
      canCreate: ["expense_report_drafts"],
      canModify: ["unsubmitted_expense_reports"],
      permittedRoles: ["field_rep", "director", "admin"],
      permittedDataClasses: ["internal", "confidential"],
      requiredApprovals: ["employee_confirmation"],
      reversible: true,
      validationTests: ["totals_match", "all_receipts_attached"],
      monetaryThreshold: 100,
    },
    {
      orgId,
      name: "Expense Report Submitter",
      category: "submit",
      description: "Submit expense reports for approval",
      executionMethod: "native_api",
      canCreate: ["expense_submissions"],
      permittedRoles: ["field_rep", "director", "admin"],
      permittedDataClasses: ["internal", "confidential"],
      requiredApprovals: ["employee_approval", "manager_approval"],
      reversible: false,
      validationTests: ["report_validated", "approvals_collected"],
      monetaryThreshold: 100,
      segregationOfDutiesConflict: [], // set after creation
    },
    {
      orgId,
      name: "Email Sender",
      category: "communicate",
      description: "Send email messages on behalf of user",
      executionMethod: "native_api",
      canCreate: ["email_messages"],
      permittedRoles: ["field_rep", "director", "admin"],
      permittedDataClasses: ["internal", "confidential"],
      requiredApprovals: ["content_review"],
      reversible: false,
      validationTests: ["recipient_verified", "content_approved", "no_prohibited_content"],
    },
    {
      orgId,
      name: "Calendar Manager",
      category: "create",
      description: "Create and modify calendar events",
      executionMethod: "native_api",
      canCreate: ["calendar_events"],
      canModify: ["own_calendar_events"],
      permittedRoles: ["field_rep", "director", "admin"],
      permittedDataClasses: ["internal"],
      reversible: true,
      validationTests: ["no_conflict", "attendees_valid"],
    },
    {
      orgId,
      name: "CRM Record Updater",
      category: "modify",
      description: "Update CRM records with new information",
      executionMethod: "native_api",
      canModify: ["crm_accounts", "crm_contacts"],
      permittedRoles: ["field_rep", "director", "admin"],
      permittedDataClasses: ["internal", "confidential"],
      requiredApprovals: ["data_validation"],
      reversible: true,
      validationTests: ["fields_valid", "no_data_loss"],
    },
    {
      orgId,
      name: "Browser Agent",
      category: "execute",
      description: "Controlled browser automation for systems without APIs",
      executionMethod: "browser_agent",
      canRead: ["web_pages"],
      canCreate: ["form_submissions"],
      permittedRoles: ["admin"],
      permittedDataClasses: ["internal"],
      requiredApprovals: ["human_checkpoint"],
      reversible: false,
      validationTests: ["page_state_verified", "action_confirmed"],
    },
    {
      orgId,
      name: "Human Checkpoint",
      category: "approve",
      description: "Human execution capsule for tasks requiring human judgment",
      executionMethod: "human_checkpoint",
      canRead: ["all_assigned_data"],
      canCreate: ["human_decisions"],
      permittedRoles: ["field_rep", "director", "admin"],
      permittedDataClasses: ["internal", "confidential", "restricted", "regulated"],
      reversible: true,
      validationTests: ["human_confirmed"],
    },
  ];

  let count = 0;
  for (const input of defaults) {
    createCapability(input);
    count++;
  }

  // Set segregation of duties: submitter conflicts with drafter
  const caps = listCapabilities(orgId);
  const submitter = caps.find((c) => c.name === "Expense Report Submitter");
  const drafter = caps.find((c) => c.name === "Expense Report Drafter");
  if (submitter && drafter) {
    getDb()
      .prepare(`UPDATE capabilities SET segregation_conflicts = ? WHERE org_id = ? AND id = ?`)
      .run(JSON.stringify([drafter.id]), orgId, submitter.id);
    getDb()
      .prepare(`UPDATE capabilities SET segregation_conflicts = ? WHERE org_id = ? AND id = ?`)
      .run(JSON.stringify([submitter.id]), orgId, drafter.id);
  }

  return count;
}
