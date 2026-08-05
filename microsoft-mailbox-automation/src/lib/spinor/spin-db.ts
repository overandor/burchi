/**
 * Portable JSON file persistence for SPINOR OS.
 *
 * Works on all platforms (HF Space, Netlify, Vercel, local) without
 * native module compilation. Uses an in-memory cache backed by a JSON
 * file on disk. On serverless platforms where the filesystem is
 * read-only or ephemeral, the in-memory cache still works for the
 * duration of the request.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import {
  SPIN,
  SPINState,
  AttributionClaim,
} from "./spin";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const DB_PATH = process.env.SPINOR_DB_PATH || join(tmpdir(), "spinor-os.json");

interface DBShape {
  spins: Record<string, SPIN>;
  claims: Record<string, AttributionClaim[]>;
}

let _cache: DBShape | null = null;

function loadDB(): DBShape {
  if (_cache) return _cache;

  try {
    if (existsSync(DB_PATH)) {
      const raw = readFileSync(DB_PATH, "utf-8");
      _cache = JSON.parse(raw);
    } else {
      _cache = { spins: {}, claims: {} };
      saveDB();
    }
  } catch {
    _cache = { spins: {}, claims: {} };
  }

  return _cache!;
}

function saveDB(): void {
  if (!_cache) return;
  try {
    const dir = dirname(DB_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(DB_PATH, JSON.stringify(_cache, null, 2), "utf-8");
  } catch {
    // Filesystem may be read-only on serverless — cache still works in-memory
  }
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export function saveSpin(spin: SPIN): void {
  const db = loadDB();
  db.spins[spin.spinId] = spin;
  saveDB();
}

export function loadSpin(spinId: string): SPIN | null {
  const db = loadDB();
  return db.spins[spinId] || null;
}

export function loadAllSpins(): SPIN[] {
  const db = loadDB();
  return Object.values(db.spins).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function loadSpinsByState(state: SPINState): SPIN[] {
  return loadAllSpins().filter((s) => s.state === state);
}

export function loadSpinsByEmployee(employeeId: string): SPIN[] {
  return loadAllSpins().filter((s) => s.employeeOwner === employeeId);
}

export function deleteSpin(spinId: string): void {
  const db = loadDB();
  delete db.spins[spinId];
  delete db.claims[spinId];
  saveDB();
}

export function getSpinCount(): number {
  const db = loadDB();
  return Object.keys(db.spins).length;
}

export function getStateDistribution(): Record<string, number> {
  const db = loadDB();
  const result: Record<string, number> = {};
  for (const spin of Object.values(db.spins)) {
    result[spin.state] = (result[spin.state] || 0) + 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Claim operations
// ---------------------------------------------------------------------------

export function saveClaim(spinId: string, claim: AttributionClaim): void {
  const db = loadDB();
  if (!db.claims[spinId]) db.claims[spinId] = [];
  // Replace if exists, otherwise append
  const idx = db.claims[spinId].findIndex((c) => c.claimId === claim.claimId);
  if (idx >= 0) {
    db.claims[spinId][idx] = claim;
  } else {
    db.claims[spinId].push(claim);
  }
  saveDB();
}

export function loadClaims(spinId: string): AttributionClaim[] {
  const db = loadDB();
  return db.claims[spinId] || [];
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export function dbHealth(): { ok: boolean; path: string; spinCount: number; claimCount: number } {
  try {
    const db = loadDB();
    const spinCount = Object.keys(db.spins).length;
    const claimCount = Object.values(db.claims).reduce((s, c) => s + c.length, 0);
    return { ok: true, path: DB_PATH, spinCount, claimCount };
  } catch (e) {
    return { ok: false, path: DB_PATH, spinCount: 0, claimCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// Reset (for testing)
// ---------------------------------------------------------------------------

export function resetDB(): void {
  _cache = { spins: {}, claims: {} };
  saveDB();
}
