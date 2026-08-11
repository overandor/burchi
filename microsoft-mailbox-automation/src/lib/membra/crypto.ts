/**
 * Membra crypto utilities — thin wrapper over the city/merkle.ts
 * implementations of SHA-256, canonical JSON, and Ed25519 signing.
 *
 * All Membra modules use these functions for content identity,
 * manifest signing, and continuity event hashing.
 */

import {
  sha256Hex,
  hashObject,
  canonicalJSON,
  generateSigningKeyPair,
  signMessage,
  verifySignature,
} from "@/lib/city/merkle";
import type { SigningKeyPair } from "@/types";
import type { GGFUManifest, GGFUSignature } from "@/types";

export { sha256Hex, hashObject, canonicalJSON, generateSigningKeyPair, signMessage, verifySignature };

/** Compute the content hash for a file's bytes. */
export function hashContent(data: Buffer): string {
  return sha256Hex(data.toString("utf8"));
}

/** Compute the manifest hash (canonical JSON without the signature field). */
export function computeManifestHash(manifest: Omit<GGFUManifest, "signature">): string {
  return hashObject(manifest as unknown as Record<string, unknown>);
}

/** Sign a manifest and return the signature object. */
export function signManifest(
  manifest: Omit<GGFUManifest, "signature">,
  keyPair: SigningKeyPair
): GGFUSignature {
  const manifestHash = computeManifestHash(manifest);
  const signature = signMessage(keyPair.privateKey, manifestHash);
  return {
    algorithm: "ed25519",
    publicKey: keyPair.publicKey,
    value: signature,
    signedAt: new Date().toISOString(),
  };
}

/** Verify a manifest's signature. */
export function verifyManifestSignature(
  manifest: GGFUManifest
): boolean {
  if (!manifest.signature) return false;
  const { signature, ...rest } = manifest;
  const manifestHash = computeManifestHash(rest);
  return verifySignature(signature.publicKey, manifestHash, signature.value);
}

/** Generate a GGFU ID from content hash. */
export function ggfuIdFromHash(contentHash: string): string {
  return `ggfu:sha256:${contentHash}`;
}

/** Generate a logical ID from publisher and project info. */
export function logicalId(publisherId: string, projectName: string, componentName: string): string {
  const pub = publisherId.replace(/^did:/, "").replace(/[:/]/g, "-");
  return `did:membra:${pub}/${projectName}/${componentName}`;
}
