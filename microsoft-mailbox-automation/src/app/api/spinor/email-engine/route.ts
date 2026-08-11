import { NextRequest, NextResponse } from "next/server";
import {
  detectEmailSignals,
  ingestEmails,
  generateHypotheses,
  createExperiment,
  approveExperiment,
  markExperimentSent,
  sendExperimentEmail,
  recordExperimentOutcome,
  promoteToGoldenNode,
  generateReverseTests,
  recordReverseTestResult,
  loadSignals,
  loadHypotheses,
  loadExperiments,
  loadGoldenNodes,
  loadEmails,
  getEngineStats,
  complianceCheckExperiment,
  type EmailMessage,
  type ExperimentDimension,
  type OutcomeType,
} from "@/lib/spinor/email-engine";
import { normalizeOrigin, getRequestOrigin } from "@/lib/utils";
import { getAuthContext } from "@/lib/auth/session";
import {
  getCredentialsForUser,
  getCredential,
  type EmailProvider,
} from "@/lib/auth/credential-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/spinor/email-engine
 *
 * The full SPINOR email experimentation pipeline.
 *
 * Actions:
 *   ingest_emails    — persist real emails and detect signals
 *   detect_signals   — parse emails for behavioral signals
 *   generate_hypotheses — LLM creates competing explanations for a signal
 *   create_experiment — set up a controlled email experiment
 *   approve_experiment — mark experiment as approved
 *   send_experiment — mark as sent
 *   record_outcome — record behavioral outcome + calculate profit + causal lift
 *   promote_golden_node — promote a winning experiment to Golden Node
 *   generate_reverse_tests — palindrome: generate tests to attack the winning method
 *   record_reverse_test — record the result of a reverse falsification test
 *   compliance_check — check an email for compliance
 *
 * GET /api/spinor/email-engine
 *   ?action=stats — engine statistics
 *   ?action=emails — list all stored emails
 *   ?action=signals — list all signals
 *   ?action=hypotheses — list hypotheses (optional: signalId)
 *   ?action=experiments — list experiments (optional: employeeId)
 *   ?action=golden_nodes — list all golden nodes
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action;

    switch (action) {
      case "ingest_emails": {
        const raw = body.emails || [];
        if (!Array.isArray(raw) || raw.length === 0) {
          return NextResponse.json({ error: "emails array is required" }, { status: 400 });
        }
        const emails = raw.map((e: any) => ({
          orgId: e.orgId,
          accountId: e.accountId || e.from,
          accountName: e.accountName || e.from,
          from: e.from,
          to: e.to || [],
          subject: e.subject,
          body: e.body || "",
          date: e.date,
          isRead: e.isRead ?? true,
          processed: e.processed ?? false,
          category: e.category || "other",
          hasAttachments: e.hasAttachments ?? false,
          tags: e.tags || [],
          source: e.source || "api",
          confidence: e.confidence ?? 0.5,
        }));
        const result = ingestEmails(emails);
        return NextResponse.json({ emails: result.emails, signals: result.signals, count: result.emails.length });
      }

      case "detect_signals": {
        const emails = body.emails || [];
        const signals = detectEmailSignals(emails);
        return NextResponse.json({ signals, count: signals.length });
      }

      case "generate_hypotheses": {
        const signalId = body.signalId;
        if (!signalId) return NextResponse.json({ error: "signalId required" }, { status: 400 });
        const hypotheses = await generateHypotheses(signalId);
        return NextResponse.json({ hypotheses, count: hypotheses.length });
      }

      case "create_experiment": {
        if (!body.signalId) return NextResponse.json({ error: "signalId required" }, { status: 400 });
        if (!body.hypothesisId) return NextResponse.json({ error: "hypothesisId required" }, { status: 400 });
        // Look up the signal to derive account info if not provided
        const signal = loadSignals().find((s) => s.id === body.signalId);
        const accountId = body.accountId || signal?.accountId || "unknown";
        const accountName = body.accountName || signal?.accountName || accountId;

        // Look up the hypothesis to derive dimension if not provided
        const hypothesis = loadHypotheses().find((h) => h.id === body.hypothesisId);
        const dimension = (body.dimension as ExperimentDimension) || hypothesis?.dimension || "content_sequence";

        const exp = createExperiment({
          signalId: body.signalId,
          hypothesisId: body.hypothesisId,
          employeeId: body.employeeId || "emp-001",
          accountId,
          accountName,
          dimension,
          controlCondition: body.controlCondition || "Standard approved email sequence",
          variation: body.variation,
          subjectLine: body.subjectLine,
          bodyPreview: body.bodyPreview || "",
          sendTiming: body.sendTiming || "immediate",
          approvedContentVersion: body.approvedContentVersion || "v1",
          complianceChecked: body.complianceChecked ?? false,
          complianceNotes: body.complianceNotes || "",
        });
        return NextResponse.json({ experiment: exp });
      }

      case "approve_experiment": {
        if (!body.experimentId) return NextResponse.json({ error: "experimentId required" }, { status: 400 });
        const exp = approveExperiment(body.experimentId);
        if (!exp) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
        return NextResponse.json({ experiment: exp });
      }

      case "send_experiment": {
        if (!body.experimentId) return NextResponse.json({ error: "experimentId required" }, { status: 400 });
        const provider = (body.provider as EmailProvider) || "gmail";

        // Resolve auth context for server-side credential lookup
        let orgId = "foundry";
        let userId = "emp-001";
        try {
          const ctx = await getAuthContext();
          orgId = ctx.orgId;
          userId = ctx.user.id;
        } catch {
          // Demo mode — use defaults
        }

        if (provider === "microsoft") {
          // 1. Try request body / cookie first (client-passed)
          let mailbox = body.mailbox || request.cookies.get("microsoft-email")?.value || "";
          let accessToken = body.accessToken || request.cookies.get("microsoft-token")?.value || "";

          // 2. Fall back to server-side credential store
          if ((!mailbox || !accessToken) && body.credentialId) {
            const cred = getCredential(orgId, userId, "microsoft", body.mailbox || "");
            if (cred && cred.accessToken) {
              mailbox = cred.email;
              accessToken = cred.accessToken;
            }
          } else if (!mailbox || !accessToken) {
            const creds = getCredentialsForUser(orgId, userId).filter((c) => c.provider === "microsoft");
            if (creds.length > 0 && creds[0].accessToken) {
              mailbox = creds[0].email;
              accessToken = creds[0].accessToken;
            }
          }

          if (!mailbox || !accessToken) {
            return NextResponse.json(
              { error: "Microsoft 365 not connected. Connect in Settings or pass an accessToken and mailbox." },
              { status: 401 },
            );
          }

          try {
            const { experiment, result } = await sendExperimentEmail(body.experimentId, {
              provider: "microsoft",
              accessToken,
              mailbox,
            });
            return NextResponse.json({ experiment, result });
          } catch (e: any) {
            console.error("[spinor/email-engine] send_experiment (microsoft) error:", e);
            return NextResponse.json({ error: e.message }, { status: 500 });
          }
        }

        // Gmail
        const clientId = process.env.GMAIL_CLIENT_ID || "";
        const clientSecret = process.env.GMAIL_CLIENT_SECRET || "";
        let refreshToken =
          body.refreshToken ||
          request.cookies.get("gmail-refresh-token")?.value ||
          "";
        let gmailEmail = body.email || "";

        // Fall back to server-side credential store
        if (!refreshToken) {
          if (body.credentialId) {
            const cred = getCredential(orgId, userId, "gmail", gmailEmail);
            if (cred) {
              refreshToken = cred.refreshToken;
              gmailEmail = cred.email;
            }
          } else {
            const creds = getCredentialsForUser(orgId, userId).filter((c) => c.provider === "gmail");
            if (creds.length > 0) {
              refreshToken = creds[0].refreshToken;
              gmailEmail = creds[0].email;
            }
          }
        }

        if (!clientId || !refreshToken) {
          return NextResponse.json(
            { error: "Gmail not connected. Provide a refreshToken or connect Gmail in Settings." },
            { status: 401 },
          );
        }

        const redirectUri = `${normalizeOrigin(getRequestOrigin(request))}/api/gmail/callback`;
        try {
          const { experiment, result } = await sendExperimentEmail(body.experimentId, {
            provider: "gmail",
            clientId,
            clientSecret,
            redirectUri,
            refreshToken,
            emailAddress: gmailEmail,
          });
          return NextResponse.json({ experiment, result });
        } catch (e: any) {
          console.error("[spinor/email-engine] send_experiment (gmail) error:", e);
          return NextResponse.json({ error: e.message }, { status: 500 });
        }
      }

      case "record_outcome": {
        if (!body.experimentId) return NextResponse.json({ error: "experimentId required" }, { status: 400 });
        if (!body.outcome) return NextResponse.json({ error: "outcome required" }, { status: 400 });
        const exp = recordExperimentOutcome(
          body.experimentId,
          body.outcome as OutcomeType,
          body.outcomeDescription || "",
          body.controlOutcome as OutcomeType | undefined,
        );
        if (!exp) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
        return NextResponse.json({ experiment: exp });
      }

      case "promote_golden_node": {
        if (!body.experimentId) return NextResponse.json({ error: "experimentId required" }, { status: 400 });
        try {
          const node = promoteToGoldenNode(body.experimentId, {
            population: body.population,
            method: body.method,
            result: body.result,
            failureBoundary: body.failureBoundary,
            replicationCount: body.replicationCount || 2,
          });
          return NextResponse.json({ goldenNode: node });
        } catch (e: any) {
          return NextResponse.json({ error: e.message }, { status: 400 });
        }
      }

      case "generate_reverse_tests": {
        if (!body.goldenNodeId) return NextResponse.json({ error: "goldenNodeId required" }, { status: 400 });
        const tests = await generateReverseTests(body.goldenNodeId);
        return NextResponse.json({ reverseTests: tests, count: tests.length });
      }

      case "record_reverse_test": {
        if (!body.testId) return NextResponse.json({ error: "testId required" }, { status: 400 });
        const test = recordReverseTestResult(
          body.testId,
          body.result,
          body.finding,
        );
        if (!test) return NextResponse.json({ error: "Reverse test not found" }, { status: 404 });
        return NextResponse.json({ reverseTest: test });
      }

      case "compliance_check": {
        const result = complianceCheckExperiment(body.subject || "", body.body || "");
        return NextResponse.json(result);
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e: any) {
    console.error("[spinor/email-engine] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "stats";

    switch (action) {
      case "stats":
        return NextResponse.json(getEngineStats());

      case "emails": {
        const emails = loadEmails();
        return NextResponse.json({ emails, count: emails.length });
      }

      case "signals": {
        const signals = loadSignals();
        return NextResponse.json({ signals, count: signals.length });
      }

      case "hypotheses": {
        const signalId = searchParams.get("signalId") || undefined;
        const hypotheses = loadHypotheses(signalId);
        return NextResponse.json({ hypotheses, count: hypotheses.length });
      }

      case "experiments": {
        const employeeId = searchParams.get("employeeId") || undefined;
        const experiments = loadExperiments(employeeId);
        return NextResponse.json({ experiments, count: experiments.length });
      }

      case "golden_nodes": {
        const goldenNodes = loadGoldenNodes();
        return NextResponse.json({ goldenNodes, count: goldenNodes.length });
      }

      default:
        return NextResponse.json({ error: "Unknown action. Valid: stats, emails, signals, hypotheses, experiments, golden_nodes" }, { status: 400 });
    }
  } catch (e: any) {
    console.error("[spinor/email-engine GET] error:", e);
    return NextResponse.json({ error: e.message || "Internal error" }, { status: 500 });
  }
}
