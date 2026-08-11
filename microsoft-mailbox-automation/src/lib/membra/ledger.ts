/**
 * Membra Continuity Ledger — Phase 5
 *
 * Append-only event ledger with hash chaining and Merkle root
 * generation. Tracks the complete lifecycle of GGFU units from
 * creation through execution, derivation, and appraisal.
 */

import { nanoid } from "nanoid";
import { sha256Hex, hashObject, signMessage, verifySignature } from "./crypto";
import {
  buildMerkleTree,
  generateMerkleProof,
  verifyMerkleProof,
} from "@/lib/city/merkle";
import type {
  ContinuityEvent,
  ContinuityEventType,
  ContinuityMerkleRoot,
  ExecutionMetrics,
  SigningKeyPair,
} from "@/types";

/** Create a new continuity event. */
export function createEvent(input: {
  eventType: ContinuityEventType;
  actorId: string;
  ggfuId: string;
  sessionId?: string;
  inputHash?: string;
  outputHash?: string;
  metrics?: ExecutionMetrics;
  previousEventHash?: string | null;
  payload?: Record<string, unknown>;
}): ContinuityEvent {
  const eventId = `evt_${nanoid(16)}`;
  const timestamp = new Date().toISOString();

  const eventWithoutHash: Omit<ContinuityEvent, "contentHash" | "signature" | "signingPublicKey"> = {
    eventId,
    eventType: input.eventType,
    timestamp,
    actorId: input.actorId,
    ggfuId: input.ggfuId,
    sessionId: input.sessionId ?? null,
    inputHash: input.inputHash ?? null,
    outputHash: input.outputHash ?? null,
    metrics: input.metrics ?? null,
    previousEventHash: input.previousEventHash ?? null,
    payload: input.payload ?? {},
  };

  const contentHash = hashObject(eventWithoutHash as unknown as Record<string, unknown>);

  return {
    ...eventWithoutHash,
    contentHash,
    signature: null,
    signingPublicKey: null,
  };
}

/** Sign a continuity event. */
export function signEvent(event: ContinuityEvent, keyPair: SigningKeyPair): ContinuityEvent {
  const signature = signMessage(keyPair.privateKey, event.contentHash);
  return { ...event, signature, signingPublicKey: keyPair.publicKey };
}

/** Verify a continuity event's signature. */
export function verifyEvent(event: ContinuityEvent): boolean {
  if (!event.signature || !event.signingPublicKey) return false;
  return verifySignature(event.signingPublicKey, event.contentHash, event.signature);
}

/** Verify the hash chain of a sequence of events. */
export function verifyEventChain(events: ContinuityEvent[]): {
  valid: boolean;
  breaks: { eventId: string; reason: string }[];
} {
  const breaks: { eventId: string; reason: string }[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (i === 0) {
      if (event.previousEventHash !== null) {
        breaks.push({ eventId: event.eventId, reason: "First event has non-null previousEventHash" });
      }
    } else {
      if (event.previousEventHash !== events[i - 1].contentHash) {
        breaks.push({
          eventId: event.eventId,
          reason: `Hash chain break: expected ${events[i - 1].contentHash}, got ${event.previousEventHash}`,
        });
      }
    }
  }
  return { valid: breaks.length === 0, breaks };
}

/** Build and sign a Merkle root from a batch of events. */
export function buildContinuityMerkleRoot(
  events: ContinuityEvent[],
  keyPair: SigningKeyPair,
  previousRootHash: string | null
): ContinuityMerkleRoot {
  const leafHashes = events.map(e => e.contentHash);
  const { rootHash, nodeHashes } = buildMerkleTree(leafHashes);
  const signature = signMessage(keyPair.privateKey, rootHash);

  return {
    rootHash,
    nodeHashes,
    leafHashes,
    leafCount: leafHashes.length,
    signature,
    signingPublicKey: keyPair.publicKey,
    keyId: keyPair.keyId,
    signedAt: new Date().toISOString(),
    previousRootHash,
  };
}

/** Generate an inclusion proof for a specific event in a Merkle root. */
export function generateContinuityProof(
  events: ContinuityEvent[],
  eventIndex: number
): { proof: { hash: string; isRight: boolean }[]; rootHash: string } {
  const leafHashes = events.map(e => e.contentHash);
  return generateMerkleProof(leafHashes, eventIndex);
}

/** Verify an inclusion proof against a Merkle root. */
export function verifyContinuityProof(
  leafHash: string,
  proof: { hash: string; isRight: boolean }[],
  expectedRoot: string
): boolean {
  return verifyMerkleProof(leafHash, proof, expectedRoot);
}

/** In-memory ledger for testing and prototyping. */
export class ContinuityLedger {
  private events: ContinuityEvent[] = [];
  private merkleRoots: ContinuityMerkleRoot[] = [];
  private keyPair: SigningKeyPair | null = null;

  /** Set the signing key pair for the ledger. */
  setKeyPair(keyPair: SigningKeyPair): void {
    this.keyPair = keyPair;
  }

  /** Append an event to the ledger. */
  append(event: ContinuityEvent): void {
    if (this.keyPair && !event.signature) {
      event = signEvent(event, this.keyPair);
    }
    this.events.push(event);
  }

  /** Append a new event, automatically chaining to the previous one. */
  appendNew(input: Omit<Parameters<typeof createEvent>[0], "previousEventHash">): ContinuityEvent {
    const previousHash = this.events.length > 0
      ? this.events[this.events.length - 1].contentHash
      : null;
    const event = createEvent({ ...input, previousEventHash: previousHash });
    this.append(event);
    return event;
  }

  /** Get all events. */
  getEvents(): ContinuityEvent[] {
    return [...this.events];
  }

  /** Get events for a specific GGFU unit. */
  getEventsForUnit(ggfuId: string): ContinuityEvent[] {
    return this.events.filter(e => e.ggfuId === ggfuId);
  }

  /** Seal the current batch of events into a Merkle root. */
  seal(): ContinuityMerkleRoot | null {
    if (!this.keyPair || this.events.length === 0) return null;
    const previousRoot = this.merkleRoots.length > 0
      ? this.merkleRoots[this.merkleRoots.length - 1].rootHash
      : null;
    const root = buildContinuityMerkleRoot(this.events, this.keyPair, previousRoot);
    this.merkleRoots.push(root);
    return root;
  }

  /** Get all Merkle roots. */
  getMerkleRoots(): ContinuityMerkleRoot[] {
    return [...this.merkleRoots];
  }

  /** Verify the entire ledger. */
  verify(): { valid: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const { valid: chainValid, breaks } = verifyEventChain(this.events);
    if (!chainValid) {
      reasons.push(...breaks.map(b => `${b.eventId}: ${b.reason}`));
    }
    for (const event of this.events) {
      if (event.signature && !verifyEvent(event)) {
        reasons.push(`${event.eventId}: signature verification failed`);
      }
    }
    return { valid: reasons.length === 0, reasons };
  }
}
