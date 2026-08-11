import { nanoid } from "nanoid";
import {
  CapabilityGrant,
  GrantCapability,
  SigningKeyPair,
} from "@/types";
import { hashObject, signMessage, verifySignature } from "./merkle";
import { recordMaterialEvent, getKeyPair, getAppById } from "./identity";
import {
  loadCityCapabilityGrants,
  saveCityCapabilityGrants,
} from "@/lib/config";

const now = () => new Date().toISOString();

/** Grant a capability from a parent app to a child app.
 *
 * A deployed application may create a new version of itself or authorize
 * the creation of another application only through an explicit, auditable
 * capability grant. The grant is signed by the parent app's key. */
export function grantCapability(input: {
  parentAppId: string;
  childAppId: string;
  capability: GrantCapability;
  conditions: string[];
  expiresAt?: string;
}): { grant: CapabilityGrant; error?: string } {
  const parent = getAppById(input.parentAppId);
  if (!parent) {
    return {
      grant: null as unknown as CapabilityGrant,
      error: `Parent app ${input.parentAppId} not found`,
    };
  }

  if (!parent.active) {
    return {
      grant: null as unknown as CapabilityGrant,
      error: `Parent app ${input.parentAppId} is not active`,
    };
  }

  // Check that the parent hasn't already granted this capability to this child.
  const existing = loadCityCapabilityGrants().find(
    (g) =>
      g.parentAppId === input.parentAppId &&
      g.childAppId === input.childAppId &&
      g.capability === input.capability &&
      !g.revoked
  );
  if (existing) {
    return {
      grant: existing,
      error: `Capability ${input.capability} already granted from ${input.parentAppId} to ${input.childAppId}`,
    };
  }

  const keyPair = getKeyPair(input.parentAppId);
  if (!keyPair) {
    return {
      grant: null as unknown as CapabilityGrant,
      error: `No signing key pair found for parent app ${input.parentAppId}`,
    };
  }

  const grantBase = {
    id: `grant_${nanoid(10)}`,
    parentAppId: input.parentAppId,
    childAppId: input.childAppId,
    capability: input.capability,
    conditions: input.conditions,
    grantedAt: now(),
    expiresAt: input.expiresAt ?? null,
    revoked: false,
    revocationReason: null,
  };

  const contentHash = hashObject(grantBase);
  const signature = signMessage(keyPair.privateKey, contentHash);

  const grant: CapabilityGrant = {
    ...grantBase,
    contentHash,
    signature,
  };

  const all = loadCityCapabilityGrants();
  all.push(grant);
  saveCityCapabilityGrants(all);

  recordMaterialEvent(input.parentAppId, "capability_grant", {
    grantId: grant.id,
    childAppId: input.childAppId,
    capability: input.capability,
    conditions: input.conditions,
  }, "system", `Capability granted: ${input.capability} to ${input.childAppId}`);

  return { grant };
}

/** Revoke a capability grant. */
export function revokeCapability(
  grantId: string,
  reason: string
): CapabilityGrant | undefined {
  const all = loadCityCapabilityGrants();
  const idx = all.findIndex((g) => g.id === grantId);
  if (idx < 0) return undefined;

  all[idx].revoked = true;
  all[idx].revocationReason = reason;
  saveCityCapabilityGrants(all);

  recordMaterialEvent(
    all[idx].parentAppId,
    "capability_revocation",
    { grantId, reason },
    "system",
    `Capability revoked: ${all[idx].capability} from ${all[idx].childAppId} — ${reason}`
  );

  return all[idx];
}

/** Verify a capability grant's signature and validity. */
export function verifyCapabilityGrant(grant: CapabilityGrant): {
  valid: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  const parent = getAppById(grant.parentAppId);
  if (!parent) {
    reasons.push(`Parent app ${grant.parentAppId} not found`);
  } else {
    // Verify signature using parent's public key.
    const sigValid = verifySignature(parent.publicKey, grant.contentHash, grant.signature);
    if (!sigValid) {
      reasons.push("Signature verification failed");
    }
  }

  if (grant.revoked) {
    reasons.push(`Grant revoked: ${grant.revocationReason}`);
  }

  if (grant.expiresAt && new Date(grant.expiresAt) < new Date()) {
    reasons.push(`Grant expired at ${grant.expiresAt}`);
  }

  const child = getAppById(grant.childAppId);
  if (!child) {
    reasons.push(`Child app ${grant.childAppId} not found`);
  }

  return { valid: reasons.length === 0, reasons };
}

/** Check if a parent app has granted a specific capability to a child app. */
export function hasCapability(
  parentAppId: string,
  childAppId: string,
  capability: GrantCapability
): boolean {
  const grants = loadCityCapabilityGrants().filter(
    (g) =>
      g.parentAppId === parentAppId &&
      g.childAppId === childAppId &&
      g.capability === capability &&
      !g.revoked
  );
  return grants.some((g) => {
    const { valid } = verifyCapabilityGrant(g);
    return valid;
  });
}

/** Get all capability grants from a parent app. */
export function getGrantsFromParent(parentAppId: string): CapabilityGrant[] {
  return loadCityCapabilityGrants().filter((g) => g.parentAppId === parentAppId);
}

/** Get all capability grants to a child app. */
export function getGrantsToChild(childAppId: string): CapabilityGrant[] {
  return loadCityCapabilityGrants().filter((g) => g.childAppId === childAppId);
}

/** List all capability grants. */
export function listCapabilityGrants(): CapabilityGrant[] {
  return loadCityCapabilityGrants();
}

/** Authorize the creation of a child app. This is the explicit,
 *  auditable parent-to-child authorization mechanism. */
export function authorizeChildApp(input: {
  parentAppId: string;
  childAppId: string;
  conditions: string[];
}): { grant: CapabilityGrant; error?: string } {
  return grantCapability({
    parentAppId: input.parentAppId,
    childAppId: input.childAppId,
    capability: "create_child_app",
    conditions: input.conditions,
  });
}

/** Authorize the creation of a new version of an app. */
export function authorizeNewVersion(input: {
  parentAppId: string;
  childAppId: string;
  conditions: string[];
}): { grant: CapabilityGrant; error?: string } {
  return grantCapability({
    parentAppId: input.parentAppId,
    childAppId: input.childAppId,
    capability: "create_new_version",
    conditions: input.conditions,
  });
}
