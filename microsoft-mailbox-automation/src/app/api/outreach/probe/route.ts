import { NextRequest, NextResponse } from "next/server";
import { SEED_ACCOUNTS } from "@/lib/golden/seed";
import { createProbe, complianceCheckProbe, markProbeSent, loadProbes } from "@/lib/golden/outreach";
import { callLLM } from "@/lib/golden/llm-client";
import { sendEmailREST } from "@/lib/gmail/rest-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/outreach/probe
 *
 * Generate and optionally send a compliant email probe to an HCP.
 * The probe offers research papers or market updates — NOT product promotion.
 *
 * Body:
 *   action: "generate" | "send" | "list"
 *   employeeId: string
 *   accountId: string — target HCP account
 *   probeType: "research_paper" | "market_update" | "clinical_trial_update" | "formulary_update"
 *   hcpName?: string — override account name
 *   hcpEmail?: string — target email
 *   refreshToken?: string — Gmail refresh token for sending
 *   customTopic?: string — specific research topic to offer
 *
 * Returns:
 *   generate: { probe, complianceCheck }
 *   send: { probe, sent: boolean, gmailResult?, complianceCheck }
 *   list: { probes: OutreachProbe[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || "generate";
    const employeeId = body.employeeId || "emp-001";

    if (action === "list") {
      const probes = loadProbes(employeeId);
      return NextResponse.json({ probes, count: probes.length });
    }

    const accountId = body.accountId;
    if (!accountId) {
      return NextResponse.json({ error: "accountId is required" }, { status: 400 });
    }

    const account = SEED_ACCOUNTS.find((a) => a.id === accountId);
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const probeType = body.probeType || "research_paper";
    const hcpName = body.hcpName || account.name;
    const hcpEmail = body.hcpEmail || `${accountId}@example.com`;
    const customTopic = body.customTopic || "";

    // Generate compliant email content via LLM
    const probeContent = await generateProbeContent(probeType, hcpName, account.name, customTopic);

    // Run compliance check
    const compliance = complianceCheckProbe(probeContent.subject, probeContent.body);

    // Store the probe
    const probe = createProbe({
      employeeId,
      accountId,
      accountName: account.name,
      hcpName,
      hcpEmail,
      probeType,
      subject: probeContent.subject,
      body: probeContent.body,
      complianceChecked: true,
      complianceNotes: compliance.passed
        ? "Passed compliance check"
        : `Issues: ${compliance.issues.join("; ")}`,
    });

    if (action === "generate") {
      return NextResponse.json({
        probe,
        complianceCheck: compliance,
        canSend: compliance.passed,
      });
    }

    if (action === "send") {
      if (!compliance.passed) {
        return NextResponse.json({
          probe,
          sent: false,
          complianceCheck: compliance,
          error: "Compliance check failed — probe cannot be sent",
        }, { status: 400 });
      }

      // Check Gmail credentials
      const clientId = process.env.GMAIL_CLIENT_ID || "";
      const clientSecret = process.env.GMAIL_CLIENT_SECRET || "";
      const refreshToken = body.refreshToken || request.cookies.get("gmail-refresh-token")?.value || "";

      if (!clientId || !refreshToken) {
        // Mark as drafted — user can send manually
        return NextResponse.json({
          probe,
          sent: false,
          complianceCheck: compliance,
          gmailConnected: false,
          message: "Gmail not connected. Probe is drafted and ready to send manually.",
        });
      }

      // Send via Gmail
      try {
        const redirectUri = `https://${request.headers.get("host")}/api/gmail/callback`;
        const gmailResult = await sendEmailREST(
          { clientId, clientSecret, redirectUri, refreshToken, emailAddress: "" },
          {
            to: hcpEmail,
            subject: probeContent.subject,
            body: probeContent.body,
            isHtml: true,
          }
        );

        const updated = markProbeSent(probe.id);
        return NextResponse.json({
          probe: updated,
          sent: true,
          gmailResult,
          complianceCheck: compliance,
          gmailConnected: true,
        });
      } catch (e: any) {
        return NextResponse.json({
          probe,
          sent: false,
          complianceCheck: compliance,
          gmailConnected: true,
          error: `Gmail send failed: ${e.message}`,
        }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * Generate compliant email probe content via LLM.
 * The content offers research value — never product promotion.
 */
async function generateProbeContent(
  probeType: string,
  hcpName: string,
  accountName: string,
  customTopic: string
): Promise<{ subject: string; body: string }> {
  const typeDescriptions: Record<string, { label: string; context: string }> = {
    research_paper: {
      label: "Research Paper",
      context: "Offer to share a relevant peer-reviewed research paper or publication summary related to their therapeutic area.",
    },
    market_update: {
      label: "Market Update",
      context: "Provide a brief, factual market intelligence update (formulary changes, guideline updates, or care pathway shifts).",
    },
    clinical_trial_update: {
      label: "Clinical Trial Update",
      context: "Share publicly available clinical trial enrollment or results information relevant to their practice.",
    },
    formulary_update: {
      label: "Formulary Update",
      context: "Inform about recent formulary or coverage policy changes that may affect their practice operations.",
    },
  };

  const desc = typeDescriptions[probeType] || typeDescriptions.research_paper;
  const topicHint = customTopic ? `Specific topic focus: ${customTopic}.` : "";

  const systemPrompt = `You write compliant healthcare professional (HCP) outreach emails for Advantage Foundry.

COMPLIANCE RULES (NON-NEGOTIABLE):
- This is an EDUCATIONAL outreach email, NOT a product promotion.
- NO product names, NO product claims, NO efficacy statements.
- NO inducements, gifts, payments, or incentives.
- Offer genuine research/educational VALUE only.
- Include a clear opt-out mechanism.
- Keep it concise (150-200 words).
- Professional, peer-to-peer tone.
- Address the HCP by name and reference their practice.

Return ONLY valid JSON: { "subject": "...", "body": "..." }
The body should be HTML-formatted.`;

  const userPrompt = `Write a ${desc.label} email probe to:
- HCP: ${hcpName}
- Practice: ${accountName}
- Purpose: ${desc.context}
- ${topicHint}

The email must:
1. Be from a field representative offering educational value
2. Reference a specific (realistic but fictional) research paper or data source
3. Ask if the HCP would like to receive the full document
4. Include an opt-out link
5. Be compliant with pharma industry guidelines (no promotion, no claims)

Return JSON: { "subject": "...", "body": "..." }`;

  try {
    const result = await callLLM(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.4, maxTokens: 800 }
    );

    if (result.content) {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.subject && parsed.body) {
          return { subject: parsed.subject, body: parsed.body };
        }
      }
    }
  } catch {
    // Fall through to template
  }

  // Fallback template — always compliant
  return generateTemplateProbe(probeType, hcpName, accountName);
}

function generateTemplateProbe(probeType: string, hcpName: string, accountName: string): { subject: string; body: string } {
  const templates: Record<string, { subject: string; body: string }> = {
    research_paper: {
      subject: `Recent research relevant to ${accountName} — would you like the full paper?`,
      body: `<p>Dear ${hcpName},</p><p>I wanted to share a recent peer-reviewed publication that may be relevant to your practice at ${accountName}. The study examines care pathway optimization in your therapeutic area and includes data that may inform your clinical decisions.</p><p>Would you like me to send you the full paper? I can also provide a one-page summary if you prefer.</p><p>Best regards,<br/>Advantage Foundry Field Team</p><p style="font-size:11px;color:#888;margin-top:20px;">You are receiving this because you are a valued healthcare professional. To opt out of these educational updates, reply with "unsubscribe".</p>`,
    },
    market_update: {
      subject: `Market intelligence update for ${accountName}`,
      body: `<p>Dear ${hcpName},</p><p>I wanted to share a brief market intelligence update that may be relevant to ${accountName}. Recent changes in care pathway guidelines and formulary policies may affect how your practice approaches patient management.</p><p>Would you like me to send you a summary of the key changes?</p><p>Best regards,<br/>Advantage Foundry Field Team</p><p style="font-size:11px;color:#888;margin-top:20px;">You are receiving this because you are a valued healthcare professional. To opt out of these educational updates, reply with "unsubscribe".</p>`,
    },
    clinical_trial_update: {
      subject: `Clinical trial enrollment update relevant to ${accountName}`,
      body: `<p>Dear ${hcpName},</p><p>I wanted to inform you about a publicly registered clinical trial that may be of interest to your practice at ${accountName}. The trial is currently enrolling patients in your therapeutic area and the protocol is available on ClinicalTrials.gov.</p><p>Would you like me to share the trial details and enrollment criteria?</p><p>Best regards,<br/>Advantage Foundry Field Team</p><p style="font-size:11px;color:#888;margin-top:20px;">You are receiving this because you are a valued healthcare professional. To opt out of these educational updates, reply with "unsubscribe".</p>`,
    },
    formulary_update: {
      subject: `Formulary policy update for ${accountName}`,
      body: `<p>Dear ${hcpName},</p><p>I wanted to share a recent formulary update that may affect operations at ${accountName}. Changes in coverage policies and care pathway guidelines may impact how your practice manages patient treatment plans.</p><p>Would you like me to send you a summary of the policy changes?</p><p>Best regards,<br/>Advantage Foundry Field Team</p><p style="font-size:11px;color:#888;margin-top:20px;">You are receiving this because you are a valued healthcare professional. To opt out of these educational updates, reply with "unsubscribe".</p>`,
    },
  };

  return templates[probeType] || templates.research_paper;
}

/**
 * GET /api/outreach/probe — list probes for an employee
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId") || "emp-001";
  const probes = loadProbes(employeeId);
  return NextResponse.json({ probes, count: probes.length });
}
