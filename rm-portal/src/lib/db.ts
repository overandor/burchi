/**
 * Postgres connection pool for the consent engagement platform.
 *
 * Uses DATABASE_URL env var. Works with Neon, Supabase, Vercel Postgres,
 * or any standard Postgres connection string.
 *
 * In development without a DB, routes return a 503 "database not configured"
 * response rather than crashing, so the rest of the app still works.
 */

import { Pool } from "pg"

let pool: Pool | null = null

function getPool(): Pool | null {
  if (pool) return pool
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) return null

  pool = new Pool({
    connectionString,
    // Neon and other serverless PGs need this
    ssl: connectionString.includes("neon") || connectionString.includes("supabase")
      ? { rejectUnauthorized: false }
      : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  })

  pool.on("error", (err) => {
    console.error("[db] pool error:", err.message)
  })

  return pool
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[]
  rowCount: number | null
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const p = getPool()
  if (!p) {
    throw new Error("DATABASE_URL not configured")
  }
  const result = await p.query(text, params as never[])
  return { rows: result.rows as T[], rowCount: result.rowCount }
}

export function dbAvailable(): boolean {
  return !!process.env.DATABASE_URL
}

/**
 * Run the migration SQL if the consent tables don't exist yet.
 * Safe to call multiple times — uses IF NOT EXISTS.
 */
export async function ensureSchema(): Promise<void> {
  const fs = await import("fs/promises")
  const path = await import("path")
  const migrationPath = path.join(process.cwd(), "db", "migrations", "001_consent_engagement.sql")
  const sql = await fs.readFile(migrationPath, "utf-8")
  await query(sql)
}
