import * as crypto from "crypto";
import { MaterialEvent, MerkleRoot, MerkleNode, SigningKeyPair } from "@/types";

/**
 * Merkle tree with content hashing and signed roots.
 *
 * Every material event produces a SHA-256 content hash. Events are
 * organized into a binary Merkle tree whose signed root provides
 * tamper-evident proof of the application's development lineage at a
 * particular time.
 *
 * Signing uses Ed25519 via Node's crypto module. If the Web Crypto API
 * is the only available runtime, callers may supply pre-computed
 * signatures.
 */

/** Compute SHA-256 hash of a string, returning hex. */
export function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

/** Compute SHA-256 hash of a JSON-serializable object, returning hex. */
export function hashObject(obj: Record<string, unknown>): string {
  const canonical = canonicalJSON(obj);
  return sha256Hex(canonical);
}

/** Canonical JSON serialization: sorted keys, no whitespace. */
export function canonicalJSON(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJSON).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ":" + canonicalJSON((obj as Record<string, unknown>)[k]));
  return "{" + pairs.join(",") + "}";
}

/** Generate an Ed25519 signing key pair. */
export function generateSigningKeyPair(): SigningKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubDer = publicKey.export({ type: "spki", format: "der" });
  const privDer = privateKey.export({ type: "pkcs8", format: "der" });
  return {
    publicKey: pubDer.toString("hex"),
    privateKey: privDer.toString("hex"),
    keyId: sha256Hex(pubDer.toString("hex")).slice(0, 16),
    createdAt: new Date().toISOString(),
  };
}

/** Sign a message with an Ed25519 private key (hex). Returns hex signature. */
export function signMessage(privateKeyHex: string, message: string): string {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyHex, "hex"),
    format: "der",
    type: "pkcs8",
  });
  const signature = crypto.sign(null, Buffer.from(message, "utf8"), privateKey);
  return signature.toString("hex");
}

/** Verify a signature with an Ed25519 public key (hex). */
export function verifySignature(
  publicKeyHex: string,
  message: string,
  signatureHex: string
): boolean {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyHex, "hex"),
      format: "der",
      type: "spki",
    });
    return crypto.verify(
      null,
      Buffer.from(message, "utf8"),
      publicKey,
      Buffer.from(signatureHex, "hex")
    );
  } catch {
    return false;
  }
}

/** Compute the content hash for a material event. */
export function computeEventHash(event: Omit<MaterialEvent, "contentHash">): string {
  const payload = {
    id: event.id,
    appId: event.appId,
    type: event.type,
    timestamp: event.timestamp,
    description: event.description,
    payload: event.payload,
    previousEventHash: event.previousEventHash,
    actor: event.actor,
  };
  return hashObject(payload);
}

/** Verify that a material event's content hash matches its content. */
export function verifyEventHash(event: MaterialEvent): boolean {
  const { contentHash, ...rest } = event;
  const computed = computeEventHash(rest);
  return computed === contentHash;
}

/** Build a Merkle tree from leaf hashes and return all node hashes. */
export function buildMerkleTree(leafHashes: string[]): {
  rootHash: string;
  nodeHashes: string[];
  nodes: MerkleNode[];
} {
  if (leafHashes.length === 0) {
    return { rootHash: sha256Hex(""), nodeHashes: [sha256Hex("")], nodes: [] };
  }

  const nodes: MerkleNode[] = [];
  const allHashes: string[] = [];

  // Create leaf nodes.
  for (const hash of leafHashes) {
    const node: MerkleNode = {
      hash,
      leftChildHash: null,
      rightChildHash: null,
      isLeaf: true,
    };
    nodes.push(node);
    allHashes.push(hash);
  }

  // Build tree bottom-up.
  let currentLevel = leafHashes.slice();
  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      const combined = left + right;
      const parentHash = sha256Hex(combined);
      const node: MerkleNode = {
        hash: parentHash,
        leftChildHash: left,
        rightChildHash: right,
        isLeaf: false,
      };
      nodes.push(node);
      allHashes.push(parentHash);
      nextLevel.push(parentHash);
    }
    currentLevel = nextLevel;
  }

  return { rootHash: currentLevel[0], nodeHashes: allHashes, nodes };
}

/** Build and sign a Merkle root from a list of material events. */
export function buildSignedMerkleRoot(
  appId: string,
  events: MaterialEvent[],
  keyPair: SigningKeyPair,
  previousRootHash: string | null
): MerkleRoot {
  const leafHashes = events.map((e) => e.contentHash);
  const { rootHash, nodeHashes } = buildMerkleTree(leafHashes);
  const signature = signMessage(keyPair.privateKey, rootHash);

  return {
    appId,
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

/** Verify a signed Merkle root against its events. */
export function verifyMerkleRoot(
  root: MerkleRoot,
  events: MaterialEvent[]
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // Check leaf count matches.
  if (root.leafCount !== events.length) {
    reasons.push(`Leaf count mismatch: root has ${root.leafCount}, events has ${events.length}`);
  }

  // Check leaf hashes match event content hashes.
  for (let i = 0; i < events.length; i++) {
    if (root.leafHashes[i] !== events[i].contentHash) {
      reasons.push(`Leaf ${i} hash mismatch: root has ${root.leafHashes[i]}, event has ${events[i].contentHash}`);
    }
    if (!verifyEventHash(events[i])) {
      reasons.push(`Event ${events[i].id} content hash does not match its content`);
    }
  }

  // Rebuild tree and check root hash.
  const { rootHash: computedRoot } = buildMerkleTree(root.leafHashes);
  if (computedRoot !== root.rootHash) {
    reasons.push(`Root hash mismatch: stored ${root.rootHash}, computed ${computedRoot}`);
  }

  // Verify signature.
  const sigValid = verifySignature(root.signingPublicKey, root.rootHash, root.signature);
  if (!sigValid) {
    reasons.push("Signature verification failed");
  }

  return { valid: reasons.length === 0, reasons };
}

/** Verify the hash chain: each event's previousEventHash must match the
 *  prior event's contentHash. */
export function verifyHashChain(events: MaterialEvent[]): {
  valid: boolean;
  breaks: { eventId: string; reason: string }[];
} {
  const breaks: { eventId: string; reason: string }[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (i === 0) {
      if (event.previousEventHash !== null) {
        breaks.push({ eventId: event.id, reason: "First event has non-null previousEventHash" });
      }
    } else {
      if (event.previousEventHash !== events[i - 1].contentHash) {
        breaks.push({
          eventId: event.id,
          reason: `Hash chain break: expected ${events[i - 1].contentHash}, got ${event.previousEventHash}`,
        });
      }
    }
  }
  return { valid: breaks.length === 0, breaks };
}

/** Generate a Merkle proof for a specific leaf index. */
export function generateMerkleProof(
  leafHashes: string[],
  leafIndex: number
): { proof: { hash: string; isRight: boolean }[]; rootHash: string } {
  if (leafHashes.length === 0 || leafIndex < 0 || leafIndex >= leafHashes.length) {
    return { proof: [], rootHash: sha256Hex("") };
  }

  const proof: { hash: string; isRight: boolean }[] = [];
  let currentLevel = leafHashes.slice();
  let idx = leafIndex;

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      nextLevel.push(sha256Hex(left + right));
    }

    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (siblingIdx < currentLevel.length) {
      proof.push({
        hash: currentLevel[siblingIdx],
        isRight: idx % 2 === 0,
      });
    } else {
      // Odd node, sibling is itself.
      proof.push({
        hash: currentLevel[idx],
        isRight: true,
      });
    }

    currentLevel = nextLevel;
    idx = Math.floor(idx / 2);
  }

  return { proof, rootHash: currentLevel[0] };
}

/** Verify a Merkle proof for a specific leaf. */
export function verifyMerkleProof(
  leafHash: string,
  proof: { hash: string; isRight: boolean }[],
  expectedRoot: string
): boolean {
  let computed = leafHash;
  for (const step of proof) {
    if (step.isRight) {
      computed = sha256Hex(computed + step.hash);
    } else {
      computed = sha256Hex(step.hash + computed);
    }
  }
  return computed === expectedRoot;
}
