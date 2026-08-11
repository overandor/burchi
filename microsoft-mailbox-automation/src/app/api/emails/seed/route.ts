import { NextResponse } from "next/server";
import { storeEmailBatch, getEmails, isNoSqlConnected } from "@/lib/nosql/email-store";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * POST /api/emails/seed
 * Seeds demo emails into the NoSQL store if it's empty.
 */
export async function POST() {
  let orgId = "default";
  try {
    const ctx = await getAuthContext();
    orgId = ctx.orgId;
  } catch { /* demo mode */ }

  // Check if already seeded
  const { total } = await getEmails(orgId, { limit: 1 });
  if (total > 0) {
    return NextResponse.json({ seeded: false, total, message: "Already has emails" });
  }

  const now = Date.now();
  const demoEmails = [
    {
      id: "demo-001",
      subject: "Invoice #4471 — Acme Corp Q3 Migration",
      from: "billing@acme.com",
      fromAddress: "billing@acme.com",
      to: ["you@company.com"],
      date: new Date(now - 3600000).toISOString(),
      bodyPreview: "Total due: $12,450.00. Payment terms: Net 30. Project: Q3 migration. PO: 8821.",
      body: "Total due: $12,450.00. Payment terms: Net 30. Project: Q3 migration. PO: 8821. Vendor: Acme Corporation.",
      isRead: false,
      category: "financial",
      hasAttachments: true,
      attachmentCount: 1,
      importance: "high",
      source: "gmail",
      orgId,
    },
    {
      id: "demo-002",
      subject: "URGENT: Clinical trial Phase 2 results — action required by Friday",
      from: "dr.smith@researchlab.com",
      fromAddress: "dr.smith@researchlab.com",
      to: ["you@company.com"],
      date: new Date(now - 7200000).toISOString(),
      bodyPreview: "The Phase 2 trial data shows 73% efficacy. We need your approval to proceed to Phase 3 by Friday.",
      body: null,
      isRead: false,
      category: "action-required",
      hasAttachments: true,
      attachmentCount: 2,
      importance: "urgent",
      source: "microsoft",
      orgId,
    },
    {
      id: "demo-003",
      subject: "Introduction: Sarah Chen → your team (referral from Bob)",
      from: "bob@network.com",
      fromAddress: "bob@network.com",
      to: ["you@company.com"],
      date: new Date(now - 14400000).toISOString(),
      bodyPreview: "Sarah is a senior ML engineer looking for new opportunities. I thought she'd be a great fit for your team.",
      body: null,
      isRead: true,
      category: "relationship",
      hasAttachments: false,
      attachmentCount: 0,
      importance: "normal",
      source: "gmail",
      orgId,
    },
    {
      id: "demo-004",
      subject: "Q3 Board Report — metrics, KPIs, and strategic recommendations",
      from: "cfo@company.com",
      fromAddress: "cfo@company.com",
      to: ["leadership@company.com"],
      date: new Date(now - 21600000).toISOString(),
      bodyPreview: "Revenue up 23% QoQ. CAC down 12%. Three strategic recommendations for Q4 attached. Budget proposal: $2.3M.",
      body: null,
      isRead: true,
      category: "intelligence",
      hasAttachments: true,
      attachmentCount: 3,
      importance: "high",
      source: "microsoft",
      orgId,
    },
    {
      id: "demo-005",
      subject: "Contract renewal — $450K annual, expires Sep 30",
      from: "legal@partner.com",
      fromAddress: "legal@partner.com",
      to: ["you@company.com"],
      date: new Date(now - 86400000).toISOString(),
      bodyPreview: "Your partnership agreement expires Sep 30. Renewal terms: $450K/year, 3-year commitment. Please review by Aug 20.",
      body: null,
      isRead: false,
      category: "business-critical",
      hasAttachments: true,
      attachmentCount: 1,
      importance: "high",
      source: "microsoft",
      orgId,
    },
    {
      id: "demo-006",
      subject: "Thank you — incredible presentation yesterday!",
      from: "investor@vcfirm.com",
      fromAddress: "investor@vcfirm.com",
      to: ["you@company.com"],
      date: new Date(now - 172800000).toISOString(),
      bodyPreview: "The team was blown away by your demo. We'd like to schedule a follow-up to discuss a Series A. $15M range.",
      body: null,
      isRead: true,
      category: "relationship",
      hasAttachments: false,
      attachmentCount: 0,
      importance: "normal",
      source: "gmail",
      orgId,
    },
    {
      id: "demo-007",
      subject: "System alert: API rate limit exceeded — 503 errors",
      from: "alerts@monitoring.com",
      fromAddress: "alerts@monitoring.com",
      to: ["devops@company.com"],
      date: new Date(now - 10800000).toISOString(),
      bodyPreview: "Your API gateway is returning 503 errors. Rate limit exceeded at 10,000 req/min. Auto-scaling triggered.",
      body: null,
      isRead: false,
      category: "system",
      hasAttachments: false,
      attachmentCount: 0,
      importance: "urgent",
      source: "imap",
      orgId,
    },
    {
      id: "demo-008",
      subject: "Meeting: Q4 Planning Session — Aug 15, 2pm EST",
      from: "assistant@company.com",
      fromAddress: "assistant@company.com",
      to: ["leadership@company.com"],
      date: new Date(now - 18000000).toISOString(),
      bodyPreview: "Calendar invite for Q4 strategic planning. Attendees: 12. Duration: 3 hours. Location: Boardroom A.",
      body: null,
      isRead: true,
      category: "scheduling",
      hasAttachments: false,
      attachmentCount: 0,
      importance: "normal",
      source: "microsoft",
      orgId,
    },
  ];

  const { stored, docs } = await storeEmailBatch(demoEmails);

  return NextResponse.json({
    seeded: true,
    stored,
    nosqlConnected: isNoSqlConnected(),
    store: isNoSqlConnected() ? "upstash-redis" : "in-memory",
    sample: docs.map(d => ({
      subject: d.subject,
      valueScore: d.valueScore,
      valueTags: d.valueTags,
      sentiment: d.sentiment,
    })),
  });
}
