import { nanoid } from "nanoid";
import {
  AppIdentity,
  AppLifecycleStage,
  MaterialEvent,
  MaterialEventType,
  ModelToolRecord,
  SourceHistoryEntry,
  SigningKeyPair,
} from "@/types";
import {
  generateSigningKeyPair,
  computeEventHash,
  hashObject,
} from "./merkle";
import {
  loadCityApps,
  saveCityApps,
  loadCityEvents,
  saveCityEvents,
} from "@/lib/config";

const now = () => new Date().toISOString();

/** Key pairs per app, kept in memory. In production these would be
 *  stored in a hardware-backed key vault. */
const keyPairStore = new Map<string, SigningKeyPair>();

/** Create a new app identity with its own signing key pair. */
export function createAppIdentity(input: {
  name: string;
  marketProblem: string;
  repository: string;
  deploymentEnvironment: string;
  budgetCents: number;
  license: string;
  marketThesis: string;
  parentAppId?: string;
}): { app: AppIdentity; keyPair: SigningKeyPair } {
  const keyPair = generateSigningKeyPair();
  const appId = `app_${nanoid(12)}`;

  const app: AppIdentity = {
    id: appId,
    name: input.name,
    publicKey: keyPair.publicKey,
    marketProblem: input.marketProblem,
    stage: "ideation",
    parentAppId: input.parentAppId ?? null,
    repository: input.repository,
    deploymentEnvironment: input.deploymentEnvironment,
    deploymentUrl: null,
    budgetCents: input.budgetCents,
    budgetSpentCents: 0,
    license: input.license,
    marketThesis: input.marketThesis,
    modelToolRecords: [],
    sourceHistory: [],
    version: "0.0.0",
    createdAt: now(),
    updatedAt: now(),
    active: true,
    rejectionReason: null,
  };

  keyPairStore.set(appId, keyPair);

  const apps = loadCityApps();
  apps.push(app);
  saveCityApps(apps);

  // Record the ideation event.
  recordMaterialEvent(appId, "ideation", {
    name: input.name,
    marketProblem: input.marketProblem,
    marketThesis: input.marketThesis,
    parentAppId: input.parentAppId ?? null,
  }, "system");

  return { app, keyPair };
}

/** Get the signing key pair for an app (from in-memory store). */
export function getKeyPair(appId: string): SigningKeyPair | undefined {
  return keyPairStore.get(appId);
}

/** Set the signing key pair for an app (for restoring from persistent storage). */
export function setKeyPair(appId: string, keyPair: SigningKeyPair): void {
  keyPairStore.set(appId, keyPair);
}

/** Record a material event with content hash and hash chain linkage. */
export function recordMaterialEvent(
  appId: string,
  type: MaterialEventType,
  payload: Record<string, unknown>,
  actor: string,
  description?: string
): MaterialEvent {
  const events = loadCityEvents();
  const previousEventHash =
    events.length > 0 && events[events.length - 1].appId === appId
      ? events[events.length - 1].contentHash
      : getLastEventHashForApp(appId);

  const eventBase = {
    id: `evt_${nanoid(12)}`,
    appId,
    type,
    timestamp: now(),
    description: description || `${type} event for ${appId}`,
    payload,
    previousEventHash,
    actor,
    verified: false,
  };

  const contentHash = computeEventHash(eventBase);
  const event: MaterialEvent = {
    ...eventBase,
    contentHash,
  };

  events.push(event);
  saveCityEvents(events);

  return event;
}

/** Get the last event hash for a specific app from the events list. */
function getLastEventHashForApp(appId: string): string | null {
  const events = loadCityEvents();
  const appEvents = events.filter((e) => e.appId === appId);
  if (appEvents.length === 0) return null;
  return appEvents[appEvents.length - 1].contentHash;
}

/** Get all events for an app, in chronological order. */
export function getEventsForApp(appId: string): MaterialEvent[] {
  return loadCityEvents()
    .filter((e) => e.appId === appId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** Transition an app to a new lifecycle stage. */
export function transitionStage(
  appId: string,
  newStage: AppLifecycleStage,
  reason?: string
): AppIdentity | undefined {
  const apps = loadCityApps();
  const idx = apps.findIndex((a) => a.id === appId);
  if (idx < 0) return undefined;

  const oldStage = apps[idx].stage;
  apps[idx].stage = newStage;
  apps[idx].updatedAt = now();
  saveCityApps(apps);

  recordMaterialEvent(appId, "architecture_selection", {
    from: oldStage,
    to: newStage,
    reason: reason || `Stage transition from ${oldStage} to ${newStage}`,
  }, "system", `Stage transition: ${oldStage} → ${newStage}`);

  return apps[idx];
}

/** Record a model/tool usage during app development. */
export function recordModelToolUsage(
  appId: string,
  record: Omit<ModelToolRecord, "id" | "usedAt">
): void {
  const apps = loadCityApps();
  const idx = apps.findIndex((a) => a.id === appId);
  if (idx < 0) return;

  const entry: ModelToolRecord = {
    id: `mt_${nanoid(8)}`,
    name: record.name,
    version: record.version,
    role: record.role,
    usedAt: now(),
  };

  apps[idx].modelToolRecords.push(entry);
  apps[idx].updatedAt = now();
  saveCityApps(apps);

  recordMaterialEvent(appId, "code_generation", {
    tool: entry.name,
    version: entry.version,
    role: entry.role,
  }, "system", `Model/tool used: ${entry.name} v${entry.version}`);
}

/** Record a source history entry (git commit or equivalent). */
export function recordSourceHistory(
  appId: string,
  entry: Omit<SourceHistoryEntry, "timestamp">
): void {
  const apps = loadCityApps();
  const idx = apps.findIndex((a) => a.id === appId);
  if (idx < 0) return;

  const fullEntry: SourceHistoryEntry = {
    ...entry,
    timestamp: now(),
  };

  apps[idx].sourceHistory.push(fullEntry);
  apps[idx].updatedAt = now();
  saveCityApps(apps);
}

/** Update deployment information for an app. */
export function updateDeployment(
  appId: string,
  deploymentUrl: string,
  version: string
): AppIdentity | undefined {
  const apps = loadCityApps();
  const idx = apps.findIndex((a) => a.id === appId);
  if (idx < 0) return undefined;

  apps[idx].deploymentUrl = deploymentUrl;
  apps[idx].version = version;
  apps[idx].stage = "deployment";
  apps[idx].updatedAt = now();
  saveCityApps(apps);

  recordMaterialEvent(appId, "deployment", {
    url: deploymentUrl,
    version,
  }, "system", `Deployed v${version} to ${deploymentUrl}`);

  return apps[idx];
}

/** Record budget spending. */
export function recordBudgetSpend(
  appId: string,
  amountCents: number,
  description: string
): AppIdentity | undefined {
  const apps = loadCityApps();
  const idx = apps.findIndex((a) => a.id === appId);
  if (idx < 0) return undefined;

  apps[idx].budgetSpentCents += amountCents;
  apps[idx].updatedAt = now();
  saveCityApps(apps);

  recordMaterialEvent(appId, "budget_allocation", {
    amountCents,
    description,
    totalSpent: apps[idx].budgetSpentCents,
  }, "system", `Budget spend: $${(amountCents / 100).toFixed(2)} — ${description}`);

  return apps[idx];
}

/** Reject an app with a reason. */
export function rejectApp(appId: string, reason: string): AppIdentity | undefined {
  const apps = loadCityApps();
  const idx = apps.findIndex((a) => a.id === appId);
  if (idx < 0) return undefined;

  apps[idx].stage = "rejected";
  apps[idx].rejectionReason = reason;
  apps[idx].active = false;
  apps[idx].updatedAt = now();
  saveCityApps(apps);

  recordMaterialEvent(appId, "differentiation_review", {
    rejected: true,
    reason,
  }, "system", `App rejected: ${reason}`);

  return apps[idx];
}

/** Retire an app. */
export function retireApp(appId: string, reason: string): AppIdentity | undefined {
  const apps = loadCityApps();
  const idx = apps.findIndex((a) => a.id === appId);
  if (idx < 0) return undefined;

  apps[idx].stage = "retired";
  apps[idx].active = false;
  apps[idx].updatedAt = now();
  saveCityApps(apps);

  recordMaterialEvent(appId, "retirement", {
    reason,
  }, "system", `App retired: ${reason}`);

  return apps[idx];
}

/** List all apps. */
export function listApps(): AppIdentity[] {
  return loadCityApps();
}

/** Get an app by ID. */
export function getAppById(appId: string): AppIdentity | undefined {
  return loadCityApps().find((a) => a.id === appId);
}

/** Get all child apps of a parent. */
export function getChildApps(parentAppId: string): AppIdentity[] {
  return loadCityApps().filter((a) => a.parentAppId === parentAppId);
}

/** Get the full ancestry chain for an app (root → ... → parent → app). */
export function getAncestry(appId: string): AppIdentity[] {
  const chain: AppIdentity[] = [];
  let current = getAppById(appId);
  while (current) {
    chain.unshift(current);
    if (current.parentAppId) {
      current = getAppById(current.parentAppId);
    } else {
      break;
    }
  }
  return chain;
}
