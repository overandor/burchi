/**
 * Shared AES-256-GCM crypto for the registrar vaults.
 *
 * The encryption key is derived (scrypt) from REGISTRAR_VAULT_PASSPHRASE, or a
 * generated key persisted to data/.registrar.key when no passphrase is set
 * (local dev only). Both the identity/credential vault and the API-key vault
 * use these primitives so secrets never touch disk in plaintext.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const KEY_FILE = join(DATA_DIR, ".registrar.key");

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const SALT = "registrar-vault-v1";

function resolveKey(): Buffer {
  const passphrase = process.env.REGISTRAR_VAULT_PASSPHRASE;
  if (passphrase) {
    return scryptSync(passphrase, SALT, 32);
  }
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(KEY_FILE)) {
    return Buffer.from(readFileSync(KEY_FILE, "utf-8").trim(), "hex");
  }
  const key = randomBytes(32);
  writeFileSync(KEY_FILE, key.toString("hex"), { mode: 0o600 });
  return key;
}

export function encrypt(plaintext: string): string {
  const key = resolveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("invalid ciphertext format");
  const key = resolveKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return dec.toString("utf-8");
}
