import { nanoid } from "nanoid";
import {
  LineageRecord,
  InheritedComponent,
  AppIdentity,
} from "@/types";
import { hashObject } from "./merkle";
import { recordMaterialEvent, getAppById, getAncestry } from "./identity";
import {
  loadCityLineageRecords,
  saveCityLineageRecords,
  loadCityEvents,
} from "@/lib/config";
import { buildSignedMerkleRoot, getKeyPair } from "./merkle-bridge";

const now = () => new Date().toISOString();

/** Create a lineage record for an app, linking it to its ancestry
 *  via a Merkle-linked hash chain. */
export function createLineageRecord(input: {
  appId: string;
  inheritedComponents: Omit<InheritedComponent, never>[];
  changesFromParent: string[];
}): { record: LineageRecord; error?: string } {
  const app = getAppById(input.appId);
  if (!app) {
    return {
      record: null as unknown as LineageRecord,
      error: `App ${input.appId} not found`,
    };
  }

  const ancestry = getAncestry(input.appId);
  const parentAppId = app.parentAppId;
  const ancestorAppIds = ancestry
    .filter((a) => a.id !== input.appId)
    .map((a) => a.id);

  // Find siblings (same parent).
  const allApps = loadCityLineageRecords();
  let siblingAppIds: string[] = [];
  if (parentAppId) {
    // Load all apps to find siblings.
    const { loadCityApps } = require("@/lib/config");
    const apps: AppIdentity[] = loadCityApps();
    siblingAppIds = apps
      .filter((a) => a.parentAppId === parentAppId && a.id !== input.appId)
      .map((a) => a.id);
  }

  // Find children.
  const { loadCityApps } = require("@/lib/config");
  const apps: AppIdentity[] = loadCityApps();
  const childAppIds = apps
    .filter((a) => a.parentAppId === input.appId)
    .map((a) => a.id);

  // Compute current Merkle root for this app's events.
  const events = loadCityEvents().filter((e) => e.appId === input.appId);
  const keyPair = getKeyPair(input.appId);
  let merkleRootHash = "";
  if (keyPair && events.length > 0) {
    const root = buildSignedMerkleRoot(input.appId, events, keyPair, null);
    merkleRootHash = root.rootHash;
  }

  const recordBase = {
    id: `lin_${nanoid(10)}`,
    appId: input.appId,
    parentAppId,
    ancestorAppIds,
    childAppIds,
    siblingAppIds,
    inheritedComponents: input.inheritedComponents,
    changesFromParent: input.changesFromParent,
    merkleRootHash,
    createdAt: now(),
  };

  const contentHash = hashObject(recordBase);
  const record: LineageRecord = {
    ...recordBase,
    contentHash,
  };

  const all = loadCityLineageRecords();
  // Replace existing record for this app if present.
  const idx = all.findIndex((r) => r.appId === input.appId);
  if (idx >= 0) all[idx] = record;
  else all.push(record);
  saveCityLineageRecords(all);

  recordMaterialEvent(input.appId, "parent_to_child_authorization", {
    lineageId: record.id,
    parentAppId,
    ancestorCount: ancestorAppIds.length,
    inheritedComponents: input.inheritedComponents.map((c) => c.component),
    changesFromParent: input.changesFromParent,
    merkleRootHash,
  }, "system", `Lineage record created: parent=${parentAppId ?? "root"}, ancestors=${ancestorAppIds.length}`);

  return { record };
}

/** Get the lineage record for an app. */
export function getLineageRecord(appId: string): LineageRecord | undefined {
  return loadCityLineageRecords().find((r) => r.appId === appId);
}

/** List all lineage records. */
export function listLineageRecords(): LineageRecord[] {
  return loadCityLineageRecords();
}

/** Get the full lineage tree starting from a root app. */
export function getLineageTree(rootAppId: string): {
  app: AppIdentity;
  children: LineageTreeNode[];
} | null {
  const app = getAppById(rootAppId);
  if (!app) return null;

  const { loadCityApps } = require("@/lib/config");
  const allApps: AppIdentity[] = loadCityApps();
  const children = allApps
    .filter((a) => a.parentAppId === rootAppId)
    .map((a) => buildLineageTreeNode(a.id, allApps));

  return { app, children };
}

interface LineageTreeNode {
  app: AppIdentity;
  children: LineageTreeNode[];
}

function buildLineageTreeNode(appId: string, allApps: AppIdentity[]): LineageTreeNode {
  const app = allApps.find((a) => a.id === appId)!;
  const children = allApps
    .filter((a) => a.parentAppId === appId)
    .map((a) => buildLineageTreeNode(a.id, allApps));
  return { app, children };
}

/** Verify the lineage chain: each app's parent must exist and have
 *  authorized the child via a capability grant. */
export function verifyLineageChain(appId: string): {
  valid: boolean;
  breaks: { appId: string; reason: string }[];
} {
  const breaks: { appId: string; reason: string }[] = [];
  const ancestry = getAncestry(appId);

  for (let i = 0; i < ancestry.length; i++) {
    const current = ancestry[i];
    if (i === 0) {
      // Root app: no parent needed.
      if (current.parentAppId !== null) {
        breaks.push({ appId: current.id, reason: "Root app has a parentAppId" });
      }
      continue;
    }

    const parent = ancestry[i - 1];
    if (current.parentAppId !== parent.id) {
      breaks.push({
        appId: current.id,
        reason: `Expected parent ${parent.id}, got ${current.parentAppId}`,
      });
    }

    // Check capability grant exists.
    const { hasCapability } = require("./capability");
    if (!hasCapability(parent.id, current.id, "create_child_app")) {
      breaks.push({
        appId: current.id,
        reason: `No valid create_child_app capability grant from ${parent.id}`,
      });
    }
  }

  return { valid: breaks.length === 0, breaks };
}

/** Compute lineage graph statistics for the entire city. */
export function getLineageGraphStats(): {
  totalApps: number;
  rootApps: number;
  maxDepth: number;
  avgDepth: number;
  totalEdges: number;
  appsWithChildren: number;
  avgChildrenPerParent: number;
} {
  const { loadCityApps } = require("@/lib/config");
  const allApps: AppIdentity[] = loadCityApps();

  const rootApps = allApps.filter((a) => a.parentAppId === null).length;
  const totalEdges = allApps.filter((a) => a.parentAppId !== null).length;
  const appsWithChildren = new Set(
    allApps.filter((a) => a.parentAppId !== null).map((a) => a.parentAppId)
  ).size;

  // Compute depth for each app.
  const depths = allApps.map((app) => {
    let depth = 0;
    let current = app;
    while (current.parentAppId) {
      const parent = allApps.find((a) => a.id === current.parentAppId);
      if (!parent) break;
      depth++;
      current = parent;
    }
    return depth;
  });

  const maxDepth = depths.length > 0 ? Math.max(...depths) : 0;
  const avgDepth = depths.length > 0 ? depths.reduce((a, b) => a + b, 0) / depths.length : 0;

  return {
    totalApps: allApps.length,
    rootApps,
    maxDepth,
    avgDepth,
    totalEdges,
    appsWithChildren,
    avgChildrenPerParent: appsWithChildren > 0 ? totalEdges / appsWithChildren : 0,
  };
}
