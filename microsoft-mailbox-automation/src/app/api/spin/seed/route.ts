import { NextRequest, NextResponse } from "next/server";
import { seedDemoSPINs } from "@/lib/spinor/demo-seed";
import { getSpinCount } from "@/lib/spinor/spin-engine";

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const force = searchParams.get("force") === "true";

    if (force) {
      // Clear existing data by deleting all spins
      const { loadAllSpins, deleteSpin } = await import("@/lib/spinor/spin-engine");
      const existing = loadAllSpins();
      for (const spin of existing) {
        deleteSpin(spin.spinId);
      }
    }

    const result = seedDemoSPINs();
    return NextResponse.json({
      ...result,
      totalSpins: getSpinCount(),
      message: result.skipped
        ? "Demo data already exists. Use ?force=true to re-seed."
        : `Created ${result.created} demo SPINs with full lifecycle data.`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    spinCount: getSpinCount(),
    message: getSpinCount() > 0
      ? "Demo data exists. POST to seed (will skip if data exists). POST ?force=true to re-seed."
      : "No data. POST to seed demo SPINs.",
  });
}
