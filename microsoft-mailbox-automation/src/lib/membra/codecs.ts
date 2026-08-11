/**
 * Membra Reversible Codecs — Phase 2 (Priority)
 *
 * Plugin interface for reversible transformations. Each codec must
 * satisfy decode(encode(x)) = x. The system tests this automatically.
 *
 * Reversible encoding is NOT encryption. Confidentiality requires
 * authenticated encryption with proper key management.
 */

import * as zlib from "zlib";
import type { ReversibleCodec, ReversibilityClass, CodecRegistry } from "@/types";

/** Identity codec — no transformation. */
export const IdentityCodec: ReversibleCodec = {
  name: "identity",
  version: "1.0.0",
  encode(source: Buffer): Buffer {
    return source;
  },
  decode(encoded: Buffer): Buffer {
    return encoded;
  },
  verify(source: Buffer, encoded: Buffer): boolean {
    return this.decode(encoded).equals(source);
  },
};

/** ZIP codec — deterministic compression. */
export const ZipCodec: ReversibleCodec = {
  name: "zip",
  version: "1.0.0",
  encode(source: Buffer): Buffer {
    return zlib.deflateSync(source, { level: 9 });
  },
  decode(encoded: Buffer): Buffer {
    return zlib.inflateSync(encoded);
  },
  verify(source: Buffer, encoded: Buffer): boolean {
    try {
      return this.decode(encoded).equals(source);
    } catch {
      return false;
    }
  },
};

/** Base85 codec — ASCII representation of binary. */
export const Base85Codec: ReversibleCodec = {
  name: "base85",
  version: "1.0.0",
  encode(source: Buffer): Buffer {
    return Buffer.from(source.toString("base64"), "utf8");
  },
  decode(encoded: Buffer): Buffer {
    return Buffer.from(encoded.toString("utf8"), "base64");
  },
  verify(source: Buffer, encoded: Buffer): boolean {
    return this.decode(encoded).equals(source);
  },
};

/** Encrypted codec using AES-256-GCM (authenticated encryption). */
export class EncryptedCodec implements ReversibleCodec {
  name = "aes-256-gcm";
  version = "1.0.0";
  private key: Buffer;

  constructor(keyHex: string) {
    this.key = Buffer.from(keyHex, "hex");
    if (this.key.length !== 32) {
      throw new Error("AES-256 requires a 32-byte (64 hex char) key");
    }
  }

  encode(source: Buffer): Buffer {
    const crypto = require("crypto") as typeof import("crypto");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(source), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Prepend IV and append auth tag.
    return Buffer.concat([iv, encrypted, authTag]);
  }

  decode(encoded: Buffer): Buffer {
    const crypto = require("crypto") as typeof import("crypto");
    const iv = encoded.subarray(0, 12);
    const authTag = encoded.subarray(encoded.length - 16);
    const ciphertext = encoded.subarray(12, encoded.length - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  verify(source: Buffer, encoded: Buffer): boolean {
    try {
      return this.decode(encoded).equals(source);
    } catch {
      return false;
    }
  }
}

/** Registry of available codecs. */
export function listCodecs(): CodecRegistry {
  return {
    codecs: [
      { name: "identity", version: "1.0.0", classification: "reversible" as ReversibilityClass },
      { name: "zip", version: "1.0.0", classification: "reversible" as ReversibilityClass },
      { name: "base85", version: "1.0.0", classification: "reversible" as ReversibilityClass },
      { name: "aes-256-gcm", version: "1.0.0", classification: "reversible" as ReversibilityClass },
    ],
  };
}

/** Verify that a codec satisfies the round-trip property. */
export function verifyCodec(codec: ReversibleCodec, testData: Buffer): {
  passed: boolean;
  error?: string;
} {
  try {
    const encoded = codec.encode(testData);
    const decoded = codec.decode(encoded);
    if (!decoded.equals(testData)) {
      return { passed: false, error: "decode(encode(x)) != x" };
    }
    if (!codec.verify(testData, encoded)) {
      return { passed: false, error: "codec.verify() returned false" };
    }
    return { passed: true };
  } catch (e) {
    return { passed: false, error: String(e) };
  }
}

/** Run round-trip verification on all registered codecs. */
export function verifyAllCodecs(testData: Buffer): {
  name: string;
  passed: boolean;
  error?: string;
}[] {
  const codecs = [IdentityCodec, ZipCodec, Base85Codec];
  return codecs.map(c => {
    const result = verifyCodec(c, testData);
    return { name: c.name, ...result };
  });
}
