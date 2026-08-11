/**
 * Membra Content-Addressed Storage — Phase 3
 *
 * Local content-addressed storage for GGFU blobs. Stores immutable
 * blobs keyed by SHA-256 hash with tombstone support for deletion.
 */

import * as fs from "fs";
import * as path from "path";
import { sha256Hex } from "./crypto";
import type { CASEntry } from "@/types";

export class ContentAddressedStore {
  private storeDir: string;
  private indexFile: string;
  private index: Map<string, CASEntry> = new Map();
  private initialized = false;

  constructor(storeDir: string) {
    this.storeDir = storeDir;
    this.indexFile = path.join(storeDir, "_index.json");
  }

  private ensureInit(): void {
    if (this.initialized) return;
    try {
      if (!fs.existsSync(this.storeDir)) {
        fs.mkdirSync(this.storeDir, { recursive: true });
      }
      if (fs.existsSync(this.indexFile)) {
        const raw = fs.readFileSync(this.indexFile, "utf8");
        const entries: CASEntry[] = JSON.parse(raw);
        for (const entry of entries) {
          this.index.set(entry.hash, entry);
        }
      }
    } catch (e) {
      console.error("[membra/cas] init error:", e);
    }
    this.initialized = true;
  }

  private saveIndex(): void {
    try {
      const entries = Array.from(this.index.values());
      fs.writeFileSync(this.indexFile, JSON.stringify(entries, null, 2));
    } catch (e) {
      console.error("[membra/cas] save index error:", e);
    }
  }

  private blobPath(hash: string): string {
    // Use first 2 chars as subdirectory for filesystem performance.
    const prefix = hash.slice(0, 2);
    const dir = path.join(this.storeDir, prefix);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, hash);
  }

  /** Store a blob and return its hash. */
  store(data: Buffer, mediaType: string = "application/octet-stream"): string {
    this.ensureInit();
    const hash = sha256Hex(data.toString("utf8"));

    if (this.index.has(hash) && !this.index.get(hash)!.tombstone) {
      // Already stored — idempotent.
      return hash;
    }

    const blobPath = this.blobPath(hash);
    try {
      fs.writeFileSync(blobPath, data);
    } catch (e) {
      console.error("[membra/cas] store error:", e);
      throw e;
    }

    const entry: CASEntry = {
      hash,
      sizeBytes: data.length,
      mediaType,
      storedAt: new Date().toISOString(),
      backend: "local",
      encrypted: false,
      tombstone: false,
    };

    this.index.set(hash, entry);
    this.saveIndex();
    return hash;
  }

  /** Retrieve a blob by hash. Returns null if not found or tombstoned. */
  retrieve(hash: string): Buffer | null {
    this.ensureInit();
    const entry = this.index.get(hash);
    if (!entry || entry.tombstone) return null;

    const blobPath = this.blobPath(hash);
    try {
      return fs.readFileSync(blobPath);
    } catch {
      return null;
    }
  }

  /** Check if a blob exists and is not tombstoned. */
  exists(hash: string): boolean {
    this.ensureInit();
    const entry = this.index.get(hash);
    return !!entry && !entry.tombstone;
  }

  /** Delete a blob (creates a tombstone, does not remove the file). */
  delete(hash: string): boolean {
    this.ensureInit();
    const entry = this.index.get(hash);
    if (!entry) return false;
    entry.tombstone = true;
    this.saveIndex();
    return true;
  }

  /** Get the index entry for a blob. */
  getEntry(hash: string): CASEntry | null {
    this.ensureInit();
    return this.index.get(hash) ?? null;
  }

  /** List all entries. */
  list(): CASEntry[] {
    this.ensureInit();
    return Array.from(this.index.values());
  }

  /** Verify that a stored blob's hash matches its content. */
  verify(hash: string): boolean {
    this.ensureInit();
    const data = this.retrieve(hash);
    if (!data) return false;
    const computed = sha256Hex(data.toString("utf8"));
    return computed === hash;
  }
}
