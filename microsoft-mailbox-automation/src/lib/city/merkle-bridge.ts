/** Bridge module to avoid circular imports between identity and merkle.
 *
 *  Re-exports the Merkle functions needed by identity.ts and lineage.ts. */
export {
  buildSignedMerkleRoot,
  verifyMerkleRoot,
  verifyHashChain,
  generateMerkleProof,
  verifyMerkleProof,
  sha256Hex,
  hashObject,
  canonicalJSON,
  generateSigningKeyPair,
  signMessage,
  verifySignature,
  computeEventHash,
  verifyEventHash,
  buildMerkleTree,
} from "./merkle";

/** Get the signing key pair for an app from the identity module's
 *  in-memory store. This is a lazy import to avoid circular dependency. */
export function getKeyPair(appId: string) {
  const { getKeyPair: getKP } = require("./identity");
  return getKP(appId);
}
