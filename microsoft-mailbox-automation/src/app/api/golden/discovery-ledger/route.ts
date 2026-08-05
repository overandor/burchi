import { NextResponse } from "next/server";
import { listDiscoveryLedger, getDiscoveryLedgerForEmployee, auditFairness } from "@/lib/golden/ledger";

export const dynamic = "force-dynamic";

/** GET /api/golden/discovery-ledger?employeeId=...&audit=true */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");
    const audit = searchParams.get("audit") === "true";
    if (audit) {
      return NextResponse.json({ audit: auditFairness() });
    }
    const ledger = employeeId ? [getDiscoveryLedgerForEmployee(employeeId)] : listDiscoveryLedger();
    return NextResponse.json({ ledger, count: ledger.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
