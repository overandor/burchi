/**
 * API-key management types.
 *
 * A "key platform" is a service that issues API keys/tokens to authenticated
 * users (e.g. Hugging Face, GitHub, OpenAI). The registrar acquires keys for
 * platforms the user has an account on, stores them encrypted, and rotates
 * them on a configurable schedule.
 */

export type KeyAcquisitionMethod =
  | "ui_playwright" // navigate the platform's token page in a logged-in browser session
  | "api" // platform exposes a documented key-creation API endpoint
  | "manual"; // no automation possible; user must create and paste the key

export type KeyRevocationMethod = "ui_playwright" | "api" | "manual" | "none";

export interface KeyPlatform {
  id: string; // stable slug, e.g. "huggingface"
  name: string;
  /** URL of the page where API keys/tokens are managed. */
  tokenPageUrl: string;
  /** How a new key can be created. */
  acquisition: KeyAcquisitionMethod;
  /** How an old key can be revoked. */
  revocation: KeyRevocationMethod;
  /** Whether the platform supports multiple concurrent keys (affects rotation safety). */
  supportsMultipleKeys: boolean;
  /** Default rotation interval in days. */
  defaultRotationDays: number;
  /** Heuristic selectors for the UI acquisition flow (best-effort). */
  createButtonSelector?: string;
  newNameFieldSelector?: string;
  newScopeSelector?: string;
  confirmButtonSelector?: string;
  /** Selector that locates the freshly-created secret value on the page. */
  keyValueSelector?: string;
  /** Selector for an existing key's revoke/delete button (by key id attribute). */
  revokeButtonSelector?: string;
  /** Optional: documented API endpoint to create a key (when acquisition=api). */
  createEndpoint?: string;
  /** Optional: documented API endpoint to revoke a key. */
  revokeEndpoint?: string;
  /** Tags for matching. */
  tags: string[];
  description: string;
}

export interface ApiKeyRecord {
  platformId: string;
  platformName: string;
  /** Platform-side key id/name if known (for revocation). */
  keyLabel: string;
  /** Encrypted secret value (ciphertext). */
  encryptedValue: string;
  /** Plaintext scopes, e.g. "read,write". */
  scopes: string;
  createdAt: string; // ISO
  rotatedAt: string | null; // ISO of last rotation
  expiresAt: string | null; // ISO, optional
  rotationIntervalDays: number;
  status: "active" | "revoked" | "failed" | "pending";
  lastError?: string;
}

export interface RotationResult {
  platformId: string;
  platformName: string;
  rotated: boolean;
  message: string;
  oldKeyRevoked: boolean;
}
