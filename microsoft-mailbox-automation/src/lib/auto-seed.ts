/**
 * Auto-seed demo data on first database access.
 *
 * This ensures the application has real data immediately after deployment,
 * without requiring a manual seed API call. Idempotent — safe to call
 * on every startup.
 */

import { ensureDefaultOrg, getOrganizationBySlug, createOrganization, getUserByEmail, createUser } from "@/lib/db";
import { ensureGileadDemoOrg, setUserPassword } from "@/lib/auth/session";

let _seeded = false;

export function ensureDemoDataSeeded(): void {
  if (_seeded) return;
  _seeded = true; // Set immediately to prevent re-entry

  try {
    ensureDefaultOrg();
    ensureGileadDemoOrg();

    // Ensure the Gilead demo org exists
    if (!getOrganizationBySlug("gilead")) {
      createOrganization(
        "gilead",
        "Gilead Sciences",
        "gilead",
        {
          tier: "enterprise",
          industry: "pharma",
          therapeuticAreas: ["HIV", "Oncology", "Liver Disease", "Inflammation"],
          products: ["Biktarvy", "Descovy", "Trodelvy", "Yescarta", "Livdelzi"],
          fieldForce: 3933,
          crmPlatform: "Veeva Vault CRM",
        },
      );
    }

    // Ensure the Gilead demo org has a user with a password
    const gileadOrg = getOrganizationBySlug("gilead");
    if (gileadOrg) {
      const existingUser = getUserByEmail(gileadOrg.id, "demo@gilead.com");
      if (!existingUser) {
        const user = createUser(
          "emp-gilead-demo",
          gileadOrg.id,
          "demo@gilead.com",
          "Gilead Demo User",
          "field_rep",
          "Oncology",
        );
        setUserPassword(user.id, "demodemo1");
      } else if (!existingUser.password_hash) {
        setUserPassword(existingUser.id, "demodemo1");
      }
    }

    // Seed Gilead demo data (hypotheses, prior art, physicians, assignments,
    // client continuity, email engine data, process definitions)
    // Use dynamic require to avoid circular dependency at module load time
    try {
      const { seedGileadDemoData } = require("@/lib/gilead/seed");
      const result = seedGileadDemoData();
      if (result.clientContinuity > 0 || result.emailSignals > 0 || result.processes > 0) {
        console.log("[auto-seed] Seeded demo data:", JSON.stringify(result));
      }
    } catch (seedError) {
      console.error("[auto-seed] Seed error (non-fatal):", seedError);
    }

    // Seed workteleport tables (evidence envelopes, skill genomes,
    // experiment twins, commit records) so the auth-gated endpoints
    // have content on the live deployment.
    try {
      // Ensure a demo user exists in the foundry org for FK constraints
      const { getUserByEmail, createUser } = require("@/lib/db");
      const foundryOrg = getOrganizationBySlug("foundry") || getOrganizationBySlug("gilead");
      const wtOrgId = foundryOrg?.id || "foundry";
      let wtUserId = "demo-user";
      if (foundryOrg) {
        const existingUser = getUserByEmail(foundryOrg.id, "demo@foundry.local");
        if (existingUser) {
          wtUserId = existingUser.id;
        } else {
          const newUser = createUser(
            "demo-user",
            foundryOrg.id,
            "demo@foundry.local",
            "Demo User",
            "field_rep",
            "Oncology",
          );
          wtUserId = newUser.id;
        }
      }
      const { seedWorkteleportDemoData } = require("@/lib/workteleport/demo-seed");
      const wtResult = seedWorkteleportDemoData(wtOrgId, wtUserId);
      if (wtResult.evidenceEnvelopes > 0 || wtResult.skillGenomes > 0) {
        console.log("[auto-seed] Seeded workteleport data:", JSON.stringify(wtResult));
      }
    } catch (wtError) {
      console.error("[auto-seed] Workteleport seed error (non-fatal):", wtError);
    }

    // Seed a demo LLM receipt so the llm_receipts table is not empty.
    // This represents the provenance trail for the LLM call that generated
    // the demo hypotheses. Real receipts will be added on every /api/llm/infer call.
    try {
      const { getDb } = require("@/lib/db");
      const { createHash } = require("crypto");
      const { nanoid } = require("nanoid");
      const db = getDb();
      const existingReceipts = (db.prepare(`SELECT COUNT(*) as c FROM llm_receipts`).get() as { c: number }).c;
      if (existingReceipts === 0) {
        const promptHash = createHash("sha256")
          .update("Generate hypotheses for pharma field outreach optimization")
          .digest("hex");
        db.prepare(`
          INSERT OR REPLACE INTO llm_receipts (
            id, org_id, user_id, endpoint, model,
            prompt_hash, prompt_summary, messages_count,
            max_tokens, temperature, response_hash, response_tokens,
            latency_ms, success, error_message
          ) VALUES (?, 'foundry', NULL, 'demo', 'gpt-4o', ?, ?, 1, 2000, 0.7, NULL, 450, 3200, 1, NULL)
        `).run(`rcpt_${nanoid(12)}`, promptHash, "Generate hypotheses for pharma field outreach optimization");
        console.log("[auto-seed] Seeded demo LLM receipt");
      }
    } catch (receiptError) {
      console.error("[auto-seed] LLM receipt seed error (non-fatal):", receiptError);
    }
  } catch (e) {
    console.error("[auto-seed] Error:", e);
  }
}
