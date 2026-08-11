import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/llm/receipts
 * Returns LLM inference receipts — prompt hashes, model versions, latency,
 * success/failure status. This is the provenance audit trail for every
 * LLM call in the system.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const model = searchParams.get("model");
    const success = searchParams.get("success");

    let query = `SELECT * FROM llm_receipts`;
    const conditions: string[] = [];
    const params: any[] = [];
    if (model) { conditions.push("model = ?"); params.push(model); }
    if (success !== null && success !== undefined) { conditions.push("success = ?"); params.push(success === "true" ? 1 : 0); }
    if (conditions.length) query += ` WHERE ${conditions.join(" AND ")}`;
    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const receipts = getDb().prepare(query).all(...params) as any[];

    // Aggregate stats
    const stats = getDb().prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
        AVG(latency_ms) as avg_latency,
        COUNT(DISTINCT model) as unique_models,
        COUNT(DISTINCT prompt_hash) as unique_prompts
      FROM llm_receipts
    `).get() as any;

    return NextResponse.json({
      receipts,
      stats: {
        total: stats.total || 0,
        successful: stats.successful || 0,
        failed: stats.failed || 0,
        avgLatencyMs: Math.round(stats.avg_latency || 0),
        uniqueModels: stats.unique_models || 0,
        uniquePrompts: stats.unique_prompts || 0,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
