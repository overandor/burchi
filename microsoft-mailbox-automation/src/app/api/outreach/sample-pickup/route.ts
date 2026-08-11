import { NextRequest, NextResponse } from "next/server";
import { SEED_ACCOUNTS } from "@/lib/golden/seed";
import {
  createSamplePickup,
  scheduleSample,
  markSamplePickedUp,
  markSampleDelivered,
  loadSamples,
  complianceCheckSample,
  updateSample,
} from "@/lib/golden/outreach";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/outreach/sample-pickup
 *
 * Manage pharma sample pickup scheduling and delivery tracking.
 *
 * Body:
 *   action: "request" | "schedule" | "pickup" | "deliver" | "list" | "decline"
 *   employeeId: string
 *   accountId: string
 *   sampleType?: string — e.g. "starter kit", "patient education materials"
 *   quantity?: number
 *   hcpConsent?: boolean
 *   licenseVerified?: boolean
 *   licenseNumber?: string
 *   sampleId?: string — for schedule/pickup/deliver actions
 *   scheduledDate?: string — for schedule action
 *   notes?: string
 *
 * Returns:
 *   request: { sample, complianceCheck }
 *   schedule: { sample }
 *   pickup: { sample }
 *   deliver: { sample }
 *   list: { samples: SamplePickup[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || "list";
    const employeeId = body.employeeId || "emp-001";

    if (action === "list") {
      const samples = loadSamples(employeeId);
      return NextResponse.json({ samples, count: samples.length });
    }

    if (action === "request") {
      const accountId = body.accountId;
      if (!accountId) return NextResponse.json({ error: "accountId is required" }, { status: 400 });

      const account = SEED_ACCOUNTS.find((a) => a.id === accountId);
      if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

      const hcpConsent = body.hcpConsent ?? false;
      const licenseVerified = body.licenseVerified ?? false;
      const licenseNumber = body.licenseNumber || null;

      const compliance = complianceCheckSample(hcpConsent, licenseVerified, licenseNumber);

      const sample = createSamplePickup({
        employeeId,
        accountId,
        accountName: account.name,
        hcpName: body.hcpName || account.name,
        hcpEmail: body.hcpEmail || `${accountId}@example.com`,
        sampleType: body.sampleType || "Starter Kit",
        quantity: body.quantity || 1,
        hcpConsent,
        licenseVerified,
        licenseNumber,
        notes: body.notes || "",
      });

      return NextResponse.json({ sample, complianceCheck: compliance, canSchedule: compliance.passed });
    }

    if (action === "schedule") {
      const sampleId = body.sampleId;
      if (!sampleId) return NextResponse.json({ error: "sampleId is required" }, { status: 400 });
      const scheduledDate = body.scheduledDate || new Date(Date.now() + 7 * 86400000).toISOString();
      const sample = scheduleSample(sampleId, scheduledDate);
      if (!sample) return NextResponse.json({ error: "Sample not found" }, { status: 404 });
      return NextResponse.json({ sample });
    }

    if (action === "pickup") {
      const sampleId = body.sampleId;
      if (!sampleId) return NextResponse.json({ error: "sampleId is required" }, { status: 400 });
      const sample = markSamplePickedUp(sampleId);
      if (!sample) return NextResponse.json({ error: "Sample not found" }, { status: 404 });
      return NextResponse.json({ sample });
    }

    if (action === "deliver") {
      const sampleId = body.sampleId;
      if (!sampleId) return NextResponse.json({ error: "sampleId is required" }, { status: 400 });
      const sample = markSampleDelivered(sampleId);
      if (!sample) return NextResponse.json({ error: "Sample not found" }, { status: 404 });
      return NextResponse.json({ sample });
    }

    if (action === "decline") {
      const sampleId = body.sampleId;
      if (!sampleId) return NextResponse.json({ error: "sampleId is required" }, { status: 400 });
      const sample = updateSample(sampleId, { status: "declined", notes: body.notes || "HCP declined" });
      if (!sample) return NextResponse.json({ error: "Sample not found" }, { status: 404 });
      return NextResponse.json({ sample });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * GET /api/outreach/sample-pickup — list samples for an employee
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId") || "emp-001";
  const samples = loadSamples(employeeId);
  return NextResponse.json({ samples, count: samples.length });
}
