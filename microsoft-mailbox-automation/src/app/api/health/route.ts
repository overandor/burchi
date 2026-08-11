import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // Check that config loads without crashing
  try {
    const { loadConfig } = await import("@/lib/config");
    const config = loadConfig();
    checks.config = { ok: !!config, detail: config?.llm?.endpoint ? "llm endpoint set" : "no llm endpoint" };
  } catch (e: any) {
    checks.config = { ok: false, detail: e.message };
  }

  // Check that telemetry engine initializes with empty input
  try {
    const { generateTelemetry } = await import("@/lib/telemetry/engine");
    const report = generateTelemetry([], "health-check@mailbox.local");
    checks.telemetry = { ok: !!report && Array.isArray(report.aggregateMetrics), detail: `${report.aggregateMetrics?.length || 0} metrics` };
  } catch (e: any) {
    checks.telemetry = { ok: false, detail: e.message };
  }

  // Check that analysis generator returns a valid shape on empty input
  try {
    const { generateAnalysis } = await import("@/lib/analysis/generator");
    const analysis = generateAnalysis({
      id: "health-check",
      subject: "",
      sender: "",
      receivedDate: new Date().toISOString(),
      body: "",
      attachments: [],
    } as any);
    checks.analysis = { ok: !!analysis?.wikitree && !!analysis?.mindmap && !!analysis?.execution, detail: "valid shape" };
  } catch (e: any) {
    checks.analysis = { ok: false, detail: e.message };
  }

  // Check safeJson utility
  try {
    const { safeJson } = await import("@/lib/utils");
    const valid = safeJson('{"ok":true}');
    const invalid = safeJson("<html>error</html>");
    const empty = safeJson("");
    checks.utils = { ok: valid?.ok === true && invalid === null && empty === null, detail: "safeJson working" };
  } catch (e: any) {
    checks.utils = { ok: false, detail: e.message };
  }

  // Check commitment detector initializes
  try {
    const { generateSampleCommitments } = await import("@/lib/commitment/detector");
    const samples = generateSampleCommitments();
    checks.commitment = { ok: Array.isArray(samples) && samples.length > 0, detail: `${samples.length} sample commitments` };
  } catch (e: any) {
    checks.commitment = { ok: false, detail: e.message };
  }

  // Check strategy library initializes
  try {
    const { ensureStrategiesSeeded } = await import("@/lib/strategy/library");
    const strategies = ensureStrategiesSeeded();
    checks.strategyLibrary = { ok: Array.isArray(strategies) && strategies.length >= 6, detail: `${strategies.length} strategies seeded` };
  } catch (e: any) {
    checks.strategyLibrary = { ok: false, detail: e.message };
  }

  // Check strategy assignment engine initializes
  try {
    const { assignStrategies } = await import("@/lib/strategy/assignment");
    // Use a unique employee ID to avoid state accumulation across health checks
    const healthCheckId = `health-check-${Date.now()}`;
    const assignments = assignStrategies({ employeeId: healthCheckId, role: "field_representative" });
    checks.strategyAssignment = { ok: Array.isArray(assignments), detail: `${assignments.length} assignments generated` };
  } catch (e: any) {
    checks.strategyAssignment = { ok: false, detail: e.message };
  }

  // Check strategy attribution engine initializes
  try {
    const { listAttributions } = await import("@/lib/strategy/attribution");
    const attributions = listAttributions();
    checks.strategyAttribution = { ok: Array.isArray(attributions), detail: `${attributions.length} attributions` };
  } catch (e: any) {
    checks.strategyAttribution = { ok: false, detail: e.message };
  }

  // ─── GOLDEN NODE module checks ────────────────────────────────
  try {
    const { ensureGoldenSeeded } = await import("@/lib/golden/seed");
    const hypotheses = ensureGoldenSeeded();
    checks.goldenSeed = { ok: Array.isArray(hypotheses) && hypotheses.length >= 4, detail: `${hypotheses.length} hypotheses seeded` };
  } catch (e: any) {
    checks.goldenSeed = { ok: false, detail: e.message };
  }

  try {
    const { classifyPriorArt, isAssignable } = await import("@/lib/golden/prior-art");
    const r = classifyPriorArt({
      hypothesisClaim: "x", testedInMarket: false, testedInAdjacentIndustries: true,
      adjacentSupportSummary: "Supported.", sourceDomains: [], responsibleComponent: null,
      requiredConditions: [], risksAndConfounders: [], genuinelyUnknown: [],
    });
    checks.goldenPriorArt = { ok: r.status === "transfer_candidate" && isAssignable(r.status), detail: `${r.status} / ${r.evidenceState}` };
  } catch (e: any) {
    checks.goldenPriorArt = { ok: false, detail: e.message };
  }

  try {
    const { checkHypothesis } = await import("@/lib/golden/compliance");
    const ok = checkHypothesis({
      id: "x", claim: "Improve workflow timing", priorArtId: "x", priorArtStatus: "established",
      sourceDomains: [], targetCondition: "x", intervention: "workflow", control: "x",
      primaryOutcome: "x", secondaryOutcomes: [], knownConfounders: [],
      complianceBoundary: "Approved information only", expectedValue: "x", primaryUncertainty: "x",
      novelComponent: null, kind: "reliable", researchRisk: "low", createdAt: "", origin: "research",
      fixedConstraints: [], modifiableDimensions: ["timing"], targetEngagementModes: ["system_oriented"],
    } as any);
    checks.goldenCompliance = { ok: ok.allowed, detail: ok.allowed ? "compliance guard working" : ok.violations.join(";") };
  } catch (e: any) {
    checks.goldenCompliance = { ok: false, detail: e.message };
  }

  try {
    const { goldenEngine } = await import("@/lib/golden/engine");
    goldenEngine.initialize();
    const state = goldenEngine.snapshot();
    checks.goldenEngine = { ok: Array.isArray(state.hypotheses) && Array.isArray(state.priorArt), detail: `${state.hypotheses.length} hypotheses, ${state.priorArt.length} prior-art` };
  } catch (e: any) {
    checks.goldenEngine = { ok: false, detail: e.message };
  }

  // ─── Full demo seed (outcomes, attributions, golden nodes, SPINs) ───
  try {
    const { ensureFullDemoSeeded } = await import("@/lib/golden/demo-seed");
    ensureFullDemoSeeded();
    const { loadHypothesisOutcomes, loadHypothesisAttributions, loadGoldenNodes } = await import("@/lib/config");
    const outcomes = loadHypothesisOutcomes();
    const attributions = loadHypothesisAttributions();
    const goldenNodes = loadGoldenNodes();
    checks.demoSeed = {
      ok: outcomes.length > 0,
      detail: `${outcomes.length} outcomes, ${attributions.length} attributions, ${goldenNodes.length} golden nodes`,
    };
  } catch (e: any) {
    checks.demoSeed = { ok: false, detail: e.message };
  }

  // ─── SPIN engine check ─────────────────────────────────────────
  try {
    const { dbHealth, getSpinCount } = await import("@/lib/spinor/spin-engine");
    const db = dbHealth();
    const count = getSpinCount();
    // Auto-seed if DB is empty
    if (count === 0) {
      const { seedDemoSPINs } = await import("@/lib/spinor/demo-seed");
      seedDemoSPINs();
      checks.spinEngine = { ok: true, detail: `auto-seeded ${getSpinCount()} SPINs` };
    } else {
      checks.spinEngine = { ok: db.ok, detail: `${count} SPINs, ${db.claimCount} claims, chain ${db.ok ? "ok" : "error"}` };
    }
  } catch (e: any) {
    checks.spinEngine = { ok: false, detail: e.message };
  }

  // ─── Database check ─────────────────────────────────────────────
  try {
    const { dbHealth } = await import("@/lib/db");
    const db = dbHealth();
    checks.database = { ok: db.ok, detail: db.ok ? `${db.tables} tables at ${db.path}` : "SQLite unavailable" };
  } catch (e: any) {
    checks.database = { ok: false, detail: e.message };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    {
      status: allOk ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      checks,
    },
    { status: allOk ? 200 : 503 }
  );
}
