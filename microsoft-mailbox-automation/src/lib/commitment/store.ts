import { nanoid } from "nanoid";
import { CommitmentContract, CommitmentMetrics } from "@/types";
import {
  loadCommitments,
  saveCommitments,
  loadCommitmentMetrics,
  saveCommitmentMetrics,
} from "@/lib/config";

function nowIso(): string {
  return new Date().toISOString();
}

export function listCommitments(): CommitmentContract[] {
  return loadCommitments();
}

export function getCommitmentById(id: string): CommitmentContract | null {
  const all = loadCommitments();
  return all.find((c) => c.id === id) ?? null;
}

export function getCommitmentByEmailId(emailId: string): CommitmentContract | null {
  const all = loadCommitments();
  return all.find((c) => c.emailId === emailId) ?? null;
}

function normalizeContract(contract: CommitmentContract): CommitmentContract {
  return {
    ...contract,
    id: contract.id || nanoid(),
    mandatoryOutputs: Array.isArray(contract.mandatoryOutputs)
      ? contract.mandatoryOutputs
      : [],
    inferredOutputs: Array.isArray(contract.inferredOutputs)
      ? contract.inferredOutputs
      : [],
    permittedTools: Array.isArray(contract.permittedTools)
      ? contract.permittedTools
      : [],
    dependencies: Array.isArray(contract.dependencies)
      ? contract.dependencies
      : [],
    assumptions: Array.isArray(contract.assumptions)
      ? contract.assumptions
      : [],
    auditEvents: Array.isArray(contract.auditEvents) ? contract.auditEvents : [],
    detectedAt: contract.detectedAt || nowIso(),
  };
}

function mergeContracts(existing: CommitmentContract, incoming: CommitmentContract): CommitmentContract {
  const preserveStatus =
    existing.status !== "detected" && incoming.status === "detected";

  const merged: CommitmentContract = {
    ...existing,
    ...incoming,
    id: existing.id,
    status: preserveStatus ? existing.status : incoming.status,
    deliverables: incoming.deliverables ?? existing.deliverables,
    executedAt: incoming.executedAt ?? existing.executedAt,
    completedAt: incoming.completedAt ?? existing.completedAt,
    auditEvents: [
      ...(Array.isArray(existing.auditEvents) ? existing.auditEvents : []),
      ...(Array.isArray(incoming.auditEvents) ? incoming.auditEvents : []),
    ],
  };

  return merged;
}

export function upsertCommitment(contract: CommitmentContract): CommitmentContract {
  const all = loadCommitments();
  const idx = all.findIndex((c) => c.id === contract.id);

  const normalized = normalizeContract(contract);

  if (idx >= 0) {
    all[idx] = mergeContracts(all[idx], normalized);
  } else {
    all.unshift(normalized);
  }

  saveCommitments(all);
  return idx >= 0 ? all[idx] : normalized;
}

export function upsertCommitmentByEmailId(contract: CommitmentContract): CommitmentContract {
  const existing = getCommitmentByEmailId(contract.emailId);
  if (existing) {
    return upsertCommitment({ ...contract, id: existing.id });
  }
  return upsertCommitment(contract);
}

export function addCommitmentAuditEvent(
  id: string,
  event: string,
  detail: string,
): CommitmentContract {
  const all = loadCommitments();
  const idx = all.findIndex((c) => c.id === id);
  if (idx < 0) {
    throw new Error(`Commitment not found: ${id}`);
  }

  const updated: CommitmentContract = {
    ...all[idx],
    auditEvents: [
      ...(Array.isArray(all[idx].auditEvents) ? all[idx].auditEvents : []),
      { timestamp: nowIso(), event, detail },
    ],
  };

  all[idx] = updated;
  saveCommitments(all);
  return updated;
}

export function updateCommitmentStatus(
  id: string,
  status: CommitmentContract["status"],
  detail?: string,
): CommitmentContract {
  const all = loadCommitments();
  const idx = all.findIndex((c) => c.id === id);
  if (idx < 0) {
    throw new Error(`Commitment not found: ${id}`);
  }

  const updated: CommitmentContract = {
    ...all[idx],
    status,
  };

  if (status === "executing") {
    updated.executedAt = updated.executedAt || nowIso();
  }
  if (status === "completed") {
    updated.completedAt = updated.completedAt || nowIso();
  }

  updated.auditEvents = [
    ...(Array.isArray(updated.auditEvents) ? updated.auditEvents : []),
    {
      timestamp: nowIso(),
      event: "status",
      detail: detail ?? `Status changed to ${status}`,
    },
  ];

  all[idx] = updated;
  saveCommitments(all);
  return updated;
}

export function loadMetrics(): CommitmentMetrics {
  return loadCommitmentMetrics();
}

export function recordExecutionOutcome(input: {
  capabilityOk: boolean;
  inputsOk: boolean;
  toolsOk: boolean;
  qaOk: boolean;
  durationMs: number;
}): CommitmentMetrics {
  const metrics = loadCommitmentMetrics();

  const bump = (key: keyof Pick<CommitmentMetrics,
    "capability" | "inputsAvailable" | "toolCompletion" | "qualityApproval" | "acceptedWithoutRevision"
  >, ok: boolean) => {
    const existing = metrics[key];
    metrics[key] = {
      success: existing.success + (ok ? 1 : 0),
      total: existing.total + 1,
    };
  };

  bump("capability", input.capabilityOk);
  bump("inputsAvailable", input.inputsOk);
  bump("toolCompletion", input.toolsOk);
  bump("qualityApproval", input.qaOk);

  const duration = Math.max(0, Math.round(input.durationMs));
  metrics.durationsMs = Array.isArray(metrics.durationsMs)
    ? [...metrics.durationsMs, duration].slice(-500)
    : [duration];

  metrics.lastUpdatedAt = nowIso();
  saveCommitmentMetrics(metrics);
  return metrics;
}

export function recordAcceptanceOutcome(input: {
  acceptedWithoutRevision: boolean;
}): CommitmentMetrics {
  const metrics = loadCommitmentMetrics();

  metrics.acceptedWithoutRevision = {
    success: metrics.acceptedWithoutRevision.success + (input.acceptedWithoutRevision ? 1 : 0),
    total: metrics.acceptedWithoutRevision.total + 1,
  };

  metrics.lastUpdatedAt = nowIso();
  saveCommitmentMetrics(metrics);
  return metrics;
}

export function recordOutcome(input: {
  capabilityOk: boolean;
  inputsOk: boolean;
  toolsOk: boolean;
  qaOk: boolean;
  acceptedWithoutRevision?: boolean;
  durationMs: number;
}): CommitmentMetrics {
  const afterExecution = recordExecutionOutcome({
    capabilityOk: input.capabilityOk,
    inputsOk: input.inputsOk,
    toolsOk: input.toolsOk,
    qaOk: input.qaOk,
    durationMs: input.durationMs,
  });

  if (typeof input.acceptedWithoutRevision === "boolean") {
    return recordAcceptanceOutcome({ acceptedWithoutRevision: input.acceptedWithoutRevision });
  }

  return afterExecution;
}
