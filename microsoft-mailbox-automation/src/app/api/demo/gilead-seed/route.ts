import { NextResponse } from "next/server";
import { ensureDefaultOrg, getOrganizationBySlug, createOrganization } from "@/lib/db";
import { seedGileadDemoData } from "@/lib/gilead/seed";

export const dynamic = "force-dynamic";

/**
 * POST /api/demo/gilead-seed
 * Seeds the database with Gilead-specific demo data (hypotheses,
 * prior art, physicians, assignments, client continuity, email engine
 * data, and process definitions) and ensures the Gilead org exists for
 * demo login. Idempotent — safe to call multiple times.
 */
export async function POST() {
  try {
    ensureDefaultOrg();

    // Ensure the Gilead demo org exists for the Gilead login page
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

    const result = seedGileadDemoData();
    return NextResponse.json({
      success: true,
      seeded: result,
      message: `Seeded ${result.hypotheses} hypotheses, ${result.priorArt} prior art, ${result.physicians} physicians, and ${result.assignments} assignments`,
    });
  } catch (e: any) {
    console.error("[/api/demo/gilead-seed] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
