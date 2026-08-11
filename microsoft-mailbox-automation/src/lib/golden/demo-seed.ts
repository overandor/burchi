/**
 * Comprehensive demo seed — runs experiments through the full pipeline
 * so every page shows real content. Called automatically on first API load.
 *
 * This seeds:
 * - Hypotheses (via ensureGoldenSeeded)
 * - Assignments (via goldenEngine.allocateForAll)
 * - Experimental outcomes (success + falsification + boundary)
 * - Causal attributions
 * - Golden node candidates
 * - SPIN records with claims
 * - Discovery ledger entries
 *
 * All data is clearly labeled as development seed.
 */

import { ensureGoldenSeeded, SEED_EMPLOYEES, SEED_ACCOUNTS } from "./seed";
import { goldenEngine } from "./engine";
import {
  getActiveAssignmentsForEmployee,
  getAssignmentsForEmployee,
} from "./allocation";
import { recordOutcome, attributeOutcome, OutcomeInput } from "./outcomes";
import {
  identifyGoldenNodeCandidate,
  recordSuccessfulReplication,
  recordUsefulFailure,
} from "./golden-node";
import {
  loadGoldenNodes,
  loadHypothesisOutcomes,
  loadHypothesisAttributions,
  loadHypothesisAssignments,
} from "@/lib/config";
import {
  createSPIN,
  addContribution,
  appendSnapshot,
  SPINState,
  ContributionRole,
  AttributionClaim,
} from "../spinor/spin";
import { saveSpin, saveClaim, loadAllSpins } from "../spinor/spin-db";
import { loadProcessedEmails, saveProcessedEmails, loadSyncStatus, saveSyncStatus } from "@/lib/config";
import type { ProcessedEmailRecord, ExtractedData, ExtractedField, ExtractedTable, EmailAttachment, ParsedAttachmentData } from "@/types";

let _seeded = false;

export function ensureFullDemoSeeded(): void {
  if (_seeded) return;
  _seeded = true;

  // 0. Seed demo emails with attachments
  try {
    seedDemoEmails();
  } catch (e) {
    console.error("[demo-seed] email seeding error:", e);
  }

  // 1. Seed hypotheses
  try {
    ensureGoldenSeeded();
  } catch (e: any) {
    console.error("[demo-seed] ensureGoldenSeeded error:", e.message);
  }

  // 2. Allocate for all employees
  try {
    for (const emp of SEED_EMPLOYEES) {
      const existing = getActiveAssignmentsForEmployee(emp.id);
      if (existing.length === 0) {
        goldenEngine.allocateForEmployee(emp.id);
      }
    }
  } catch (e: any) {
    console.error("[demo-seed] allocate error:", e.message);
  }

  // 3. Check if outcomes already exist — if so, don't re-seed outcomes
  // but still backfill gauntlet runs and spin claims if missing
  const existingOutcomes = loadHypothesisOutcomes();
  if (existingOutcomes.length > 0) {
    console.log(`[demo-seed] ${existingOutcomes.length} outcomes already exist — backfilling gauntlet runs and spin claims`);
    try { backfillGauntletRuns(existingOutcomes); } catch (e: any) { console.error("[demo-seed] backfillGauntletRuns threw:", e.message); }
    try { backfillSpinClaims(existingOutcomes, loadHypothesisAttributions()); } catch (e: any) { console.error("[demo-seed] backfillSpinClaims threw:", e.message); }
    return;
  }

  // 4. Run simulated experiments for the first few assignments
  const allAssignments = loadHypothesisAssignments();
  if (allAssignments.length === 0) return;

  // Accept all assignments first
  for (const a of allAssignments) {
    if (a.state === "assigned") {
      goldenEngine.accept(a.id);
    }
  }

  const acceptedAssignments = loadHypothesisAssignments().filter((a) => a.state === "accepted");

  // 5. Record outcomes for the first 4 assignments
  const outcomeSpecs: OutcomeInput[] = [
    // Assignment 1: Success — performance
    {
      assignmentId: acceptedAssignments[0]?.id ?? "",
      successKind: "performance",
      outcomeDescription:
        "Office-manager-first outreach achieved 13/18 workflow resolutions vs 7/18 with physician-first. Office managers routed 72% of requests without physician involvement.",
      metrics: [
        { metric: "Workflow resolution rate", value: 72, unit: "%", baseline: 39, higherIsBetter: true },
        { metric: "Time to resolution", value: 1.4, unit: "days", baseline: 3.2, higherIsBetter: false },
        { metric: "Physician interruptions", value: 5, unit: "count", baseline: 18, higherIsBetter: false },
      ],
      falsified: false,
      contextAtObservation: {
        externalFactors: ["Quarter-end reporting pressure reduced physician availability"],
        concurrentHypotheses: [],
      },
    },
    // Assignment 2: Success — efficiency
    {
      assignmentId: acceptedAssignments[1]?.id ?? "",
      successKind: "efficiency",
      outcomeDescription:
        "Self-service workflow completed by 64% of digitally responsive accounts. Average completion time 8 minutes vs 22-minute rep visit equivalent.",
      metrics: [
        { metric: "Self-service completion", value: 64, unit: "%", baseline: 0, higherIsBetter: true },
        { metric: "Average completion time", value: 8, unit: "minutes", baseline: 22, higherIsBetter: false },
        { metric: "Account satisfaction", value: 4.2, unit: "score", baseline: 3.8, higherIsBetter: true },
      ],
      falsified: false,
      contextAtObservation: {
        externalFactors: ["New portal UI launched in week 2"],
      },
    },
    // Assignment 3: Falsification — valuable negative result
    {
      assignmentId: acceptedAssignments[2]?.id ?? "",
      successKind: "falsification",
      outcomeDescription:
        "Hypothesis falsified: Async follow-up showed no improvement over synchronous. Response rates were 31% vs 33% baseline. The boundary is that accounts with high staff delegation do not benefit from async — they need synchronous handoff.",
      metrics: [
        { metric: "Response rate", value: 31, unit: "%", baseline: 33, higherIsBetter: true },
        { metric: "Time to response", value: 2.8, unit: "days", baseline: 2.1, higherIsBetter: false },
      ],
      falsified: true,
      falsificationEvidence:
        "No statistically significant difference. Accounts with staff delegation pattern 'mixed' or 'physician' showed no benefit. Only 'staff' delegation accounts showed improvement.",
    },
    // Assignment 4: Boundary discovery
    {
      assignmentId: acceptedAssignments[3]?.id ?? "",
      successKind: "boundary",
      outcomeDescription:
        "Boundary identified: Configurable workflow improves outcomes for system-oriented accounts but degrades for human-guided accounts. The interaction mode is the moderating variable.",
      metrics: [
        { metric: "System-oriented improvement", value: 28, unit: "%", baseline: 0, higherIsBetter: true },
        { metric: "Human-guided degradation", value: -12, unit: "%", baseline: 0, higherIsBetter: true },
      ],
      falsified: false,
      falsificationEvidence:
        "Effect reverses for human-guided accounts. The workflow must adapt to the observed interaction mode, not assume one size fits all.",
    },
  ];

  for (const spec of outcomeSpecs) {
    if (!spec.assignmentId) continue;
    try {
      recordOutcome(spec);
    } catch (e) {
      console.error("[demo-seed] outcome error:", e);
    }
  }

  // 6. Attribute outcomes
  const outcomes = loadHypothesisOutcomes();
  for (const outcome of outcomes) {
    try {
      attributeOutcome(outcome.id);
    } catch (e) {
      console.error("[demo-seed] attribution error:", e);
    }
  }

  // 6b. Backfill gauntlet runs for newly seeded outcomes
  backfillGauntletRuns(outcomes);

  // 7. Identify golden node candidates from successful outcomes
  const attributions = loadHypothesisAttributions();
  const successOutcomes = outcomes.filter((o) => !o.falsified);
  for (const outcome of successOutcomes) {
    try {
      const attribution = attributions.find((a) => a.outcomeId === outcome.id);
      if (!attribution) continue;
      identifyGoldenNodeCandidate(
        outcome.hypothesisId,
        attribution.employeeId,
        outcome.id,
        1,
        ["North", "Central"],
      );
    } catch (e) {
      console.error("[demo-seed] golden node candidate error:", e);
    }
  }

  // 8. Record useful failure for the falsified outcome
  const falsifiedOutcome = outcomes.find((o) => o.falsified);
  if (falsifiedOutcome) {
    try {
      const falsifiedAttribution = attributions.find((a) => a.outcomeId === falsifiedOutcome.id);
      recordUsefulFailure(falsifiedAttribution?.employeeId || "emp-001");
    } catch (e) {
      console.error("[demo-seed] useful failure error:", e);
    }
  }

  // 9. Record a successful replication for the first success outcome
  if (successOutcomes.length > 0) {
    try {
      const firstAttribution = attributions.find((a) => a.outcomeId === successOutcomes[0].id);
      recordSuccessfulReplication(firstAttribution?.employeeId || "emp-005");
    } catch (e) {
      console.error("[demo-seed] replication error:", e);
    }
  }

  // 10. Create SPIN records with claims
  seedSPINs(outcomes, attributions);

  // 10b. Backfill spin_claims if SPINs exist but claims don't
  backfillSpinClaims(outcomes, attributions);
}

function backfillGauntletRuns(outcomes: ReturnType<typeof loadHypothesisOutcomes>): void {
  try {
    const { listAllGauntletRuns } = require("@/lib/spinor/gauntlet-db");
    const existingRuns = listAllGauntletRuns(100);
    console.log(`[demo-seed] backfillGauntletRuns: ${existingRuns.length} existing runs, ${outcomes.length} outcomes to process`);
    if (existingRuns.length > 0) return;

    const { runPreOutcomeGauntlet, runPostOutcomeGauntlet } = require("@/lib/spinor/gauntlet-pipeline");
    let backfilled = 0;
    for (const outcome of outcomes) {
      try {
        const preResult = runPreOutcomeGauntlet(
          outcome.hypothesisId,
          outcome.outcomeDescription,
          outcome.metrics,
          outcome.falsified,
        );
        if (preResult.passed) {
          runPostOutcomeGauntlet(preResult.run.runId, outcome);
          backfilled++;
        }
      } catch (e: any) {
        console.error(`[demo-seed] gauntlet backfill error for ${outcome.id}:`, e.message);
      }
    }
    if (backfilled > 0) {
      console.log(`[demo-seed] Backfilled ${backfilled} gauntlet runs`);
    }
  } catch (e: any) {
    console.error("[demo-seed] gauntlet backfill setup error:", e.message);
  }
}

function backfillSpinClaims(
  outcomes: ReturnType<typeof loadHypothesisOutcomes>,
  attributions: ReturnType<typeof loadHypothesisAttributions>,
): void {
  const spins = loadAllSpins();
  console.log(`[demo-seed] backfillSpinClaims: ${spins.length} spins, ${outcomes.length} outcomes, ${attributions.length} attributions`);
  if (spins.length === 0) return;

  const { dbHealth } = require("@/lib/spinor/spin-db");
  const health = dbHealth();
  if (health.claimCount > 0) return;

  const assignments = loadHypothesisAssignments();
  let claimCount = 0;
  // Match SPINs to outcomes by index (hypothesis IDs may differ across seed versions)
  for (let i = 0; i < spins.length; i++) {
    const spin = spins[i];
    const outcome = outcomes[i] || outcomes[0];
    if (!outcome) {
      console.log(`[demo-seed] backfillSpinClaims: no outcome at index ${i}`);
      continue;
    }
    const assignment = assignments.find((a) => a.id === outcome.assignmentId);
    if (!assignment) continue;
    const attribution = attributions.find((a) => a.outcomeId === outcome.id);
    if (!attribution) {
      console.log(`[demo-seed] backfillSpinClaims: no attribution for outcome ${outcome.id}`);
      continue;
    }

    const claim: AttributionClaim = {
      claimId: `CLM-${spin.spinId.slice(-6)}`,
      experimentId: assignment.id,
      hypothesisId: outcome.hypothesisId,
      outcomeMetric: outcome.metrics[0]?.metric ?? "primary",
      outcomeValue: outcome.metrics[0]?.value ?? 0,
      counterfactualEstimate: outcome.metrics[0]?.baseline ?? 0,
      causalEffect: (outcome.metrics[0]?.value ?? 0) - (outcome.metrics[0]?.baseline ?? 0),
      confidence: outcome.falsified ? 0.3 : 0.82,
      method: "diff_in_diff",
      evidence: [outcome.outcomeDescription],
      segments: ["cardiology"],
      territories: ["North Chicago"],
      testedBy: [outcome.employeeId],
      falsificationSurvived: !outcome.falsified,
      significanceLevel: 0.05,
    };
    try {
      saveClaim(spin.spinId, claim);
      spin.claimIds.push(claim.claimId);
      saveSpin(spin);
      claimCount++;
    } catch (e: any) {
      console.error(`[demo-seed] spin claim backfill error for spin ${spin.spinId}:`, e.message);
    }
  }
  console.log(`[demo-seed] backfillSpinClaims: created ${claimCount} claims`);
}

function seedSPINs(
  outcomes: ReturnType<typeof loadHypothesisOutcomes>,
  attributions: ReturnType<typeof loadHypothesisAttributions>,
): void {
  // Only seed if no SPINs exist
  if (loadAllSpins().length > 0) return;

  const assignments = loadHypothesisAssignments();
  const hypotheses = loadHypothesisAssignments();

  for (const outcome of outcomes.slice(0, 3)) {
    const assignment = assignments.find((a) => a.id === outcome.assignmentId);
    if (!assignment) continue;

    const spin = createSPIN({
      hypothesisId: outcome.hypothesisId,
      employeeOwner: outcome.employeeId,
      claim: `Hypothesis ${outcome.hypothesisId} — ${outcome.successKind}`,
      intervention: "Test intervention",
      control: "Standard approach",
      population: "US cardiologists",
      primaryUncertainty: "Does the intervention improve outcomes?",
      complianceBoundary: "Approved information only",
    });

    // Add contribution
    addContribution(
      spin,
      outcome.employeeId,
      ContributionRole.MISSION_EXECUTOR,
      `Executed experiment: ${outcome.outcomeDescription.slice(0, 100)}`,
      false,
    );

    // Advance through states
    appendSnapshot(spin, SPINState.PRIOR_ART_CHECKED, "system", "system", "Prior art checked", { priorArtChecked: true });
    appendSnapshot(spin, SPINState.NOVELTY_QUALIFIED, "system", "system", "Novelty qualified", { noveltyQualified: true });
    appendSnapshot(spin, SPINState.ASSIGNED, "system", "system", "Assigned to employee", {});
    appendSnapshot(spin, SPINState.PREREGISTERED, "system", "system", "Pre-registered", { preRegistered: true });
    appendSnapshot(spin, SPINState.EXECUTING, outcome.employeeId, "mission_executor", "Execution started", {});
    appendSnapshot(spin, SPINState.OBSERVED, outcome.employeeId, "mission_executor", "Observation recorded", {});

    // Add attribution claim
    const attribution = attributions.find((a) => a.outcomeId === outcome.id);
    if (attribution) {
      const claim: AttributionClaim = {
        claimId: `CLM-${spin.spinId.slice(-6)}`,
        experimentId: assignment.id,
        hypothesisId: outcome.hypothesisId,
        outcomeMetric: outcome.metrics[0]?.metric ?? "primary",
        outcomeValue: outcome.metrics[0]?.value ?? 0,
        counterfactualEstimate: outcome.metrics[0]?.baseline ?? 0,
        causalEffect: (outcome.metrics[0]?.value ?? 0) - (outcome.metrics[0]?.baseline ?? 0),
        confidence: outcome.falsified ? 0.3 : 0.82,
        method: "diff_in_diff",
        evidence: [outcome.outcomeDescription],
        segments: ["cardiology"],
        territories: ["North Chicago"],
        testedBy: [outcome.employeeId],
        falsificationSurvived: !outcome.falsified,
        significanceLevel: 0.05,
      };
      saveClaim(spin.spinId, claim);
      spin.claimIds.push(claim.claimId);
    }

    if (outcome.falsified) {
      appendSnapshot(spin, SPINState.ATTRIBUTED, "system", "attribution_engine", "Attributed — falsified", {});
      spin.state = SPINState.ATTRIBUTED;
    } else {
      appendSnapshot(spin, SPINState.ATTRIBUTED, "system", "attribution_engine", "Attributed — significant", {});
      appendSnapshot(spin, SPINState.REPLICATED, "emp-005", "replication_executor", "Replicated in Central territory", {});
      spin.state = SPINState.REPLICATED;
      spin.replicationCount = 1;
    }

    saveSpin(spin);
  }
}

// ─── Demo email seeding with attachments ──────────────────────────────

interface DemoAttachment {
  name: string;
  contentType: string;
  size: number;
  content: string; // raw content (CSV/text/JSON)
}

interface DemoEmail {
  id: string;
  subject: string;
  sender: string;
  senderEmail: string;
  receivedDate: string;
  bodyPreview: string;
  body: string;
  hasAttachments: boolean;
  attachments: DemoAttachment[];
  category: string;
  confidence: number;
}

const DEMO_EMAILS: DemoEmail[] = [
  {
    id: "demo-email-001",
    subject: "Q3 Field Experiment Results — Office-Manager-First Outreach",
    sender: "Dr. Sarah Chen",
    senderEmail: "sarah.chen@northchicago-onc.com",
    receivedDate: new Date(Date.now() - 86400000 * 2).toISOString(),
    bodyPreview:
      "Hi team, attached are the Q3 results for the office-manager-first outreach trial. We saw 13/18 workflow resolutions vs 7/18 in the physician-first control arm. The CSV contains per-account outcomes...",
    body: `Hi team,

Attached are the Q3 results for the office-manager-first outreach trial.

Key findings:
- 13/18 workflow resolutions in the intervention arm vs 7/18 in the physician-first control
- Office managers routed 7 of 13 requests within 4 hours
- Average resolution time: 6.2 days vs 11.4 days baseline

The attached CSV contains per-account outcomes with resolution status, time-to-resolution, and stakeholder type.

I commit to delivering the Q4 replication protocol by Friday.

Best,
Dr. Sarah Chen
North Chicago Oncology Group`,
    hasAttachments: true,
    attachments: [
      {
        name: "Q3_outcomes_by_account.csv",
        contentType: "text/csv",
        size: 0,
        content: `account_id,account_name,stakeholder_type,resolution_status,time_to_resolution_days,arm
phy_001,Advantage Oncology North,office_manager,resolved,4.2,intervention
phy_002,Lakeshore Cardiology,office_manager,resolved,5.1,intervention
phy_003,Riverside Hematology,physician,resolved,8.3,intervention
phy_004,Summit Medical Group,office_manager,resolved,3.9,intervention
phy_005,Pinnacle Health Partners,physician,unresolved,21.0,intervention
phy_006,Westgate Oncology,office_manager,resolved,6.8,control
phy_007,Central Valley Clinic,physician,resolved,12.1,control
phy_008,Metro Cancer Center,office_manager,resolved,9.5,control
phy_009,Lakeside Medical,physician,unresolved,21.0,control
phy_010,Horizon Health,physician,resolved,10.7,control
`,
      },
    ],
    category: "research_result",
    confidence: 0.92,
  },
  {
    id: "demo-email-002",
    subject: "Trodelvy Treatment Delay Data — Community Oncology Centers",
    sender: "Mark Rodriguez",
    senderEmail: "mrodriguez@community-onc.org",
    receivedDate: new Date(Date.now() - 86400000 * 5).toISOString(),
    bodyPreview:
      "Sharing the treatment delay dataset from 12 community oncology centers. The attached CSV shows referral-to-treatment times. We're seeing significant variation...",
    body: `Hello,

Sharing the treatment delay dataset from 12 community oncology centers receiving Trodelvy.

The attached CSV shows referral-to-treatment times across centers. We're seeing significant variation — Centers C-04 and C-09 have delays >21 days while C-02 and C-07 are under 10 days.

This looks like it could support the hypothesis that pre-meeting material review reduces treatment delays.

I will follow up with the site coordinator survey by Monday.

Mark Rodriguez
Community Oncology Network`,
    hasAttachments: true,
    attachments: [
      {
        name: "trodelvy_treatment_delays.csv",
        contentType: "text/csv",
        size: 0,
        content: `center_id,center_name,referrals,treatment_delays_gt21d,avg_delay_days,has_pre_meeting_review
C-01,Northside Community Onc,18,2,11.3,yes
C-02,Lakeshire Cancer Center,22,1,8.7,yes
C-03,Valley Health Oncology,15,3,14.2,no
C-04,Riverside Community,19,5,22.1,no
C-05,Summit Medical Partners,16,2,10.9,yes
C-06,Metro Community Onc,21,4,16.8,no
C-07,Horizon Health Group,17,1,9.2,yes
C-08,Westgate Oncology Network,14,2,12.5,no
C-09,Central Plains Onc,20,6,24.3,no
C-10,Pinnacle Community,18,1,8.9,yes
C-11,Lakeside Medical Center,16,2,11.7,yes
C-12,Frontier Oncology,15,3,15.1,no
`,
      },
    ],
    category: "research_result",
    confidence: 0.88,
  },
  {
    id: "demo-email-003",
    subject: "RE: Biktarvy Adherence Study — Follow-up Commitment",
    sender: "Jennifer Park",
    senderEmail: "jpark@advantagefoundry.com",
    receivedDate: new Date(Date.now() - 86400000 * 1).toISOString(),
    bodyPreview:
      "I will send the Biktarvy adherence analysis by end of week. The preliminary data shows 64% self-service workflow completion among digitally responsive accounts...",
    body: `Hi,

I will send the Biktarvy adherence analysis by end of week.

The preliminary data shows 64% self-service workflow completion among digitally responsive accounts. Average completion time was 8 minutes vs 22 minutes for assisted workflows.

I promise to deliver the full statistical analysis by Friday and schedule a review meeting for next Monday.

Jennifer Park
Field Research Lead
Advantage Foundry`,
    hasAttachments: false,
    attachments: [],
    category: "commitment",
    confidence: 0.95,
  },
  {
    id: "demo-email-004",
    subject: "Yescarta Capacity Planning — Q4 Forecast Attachment",
    sender: "Dr. Michael Torres",
    senderEmail: "mtorres@car-t-center.org",
    receivedDate: new Date(Date.now() - 86400000 * 3).toISOString(),
    bodyPreview:
      "Attached is the Q4 capacity forecast for Yescarta treatment centers. The JSON contains projected referrals, manufacturing slots, and apheresis capacity...",
    body: `Dr. Torres here,

Attached is the Q4 capacity forecast for Yescarta treatment centers.

The JSON contains projected referrals, available manufacturing slots, and apheresis capacity for the next 90 days.

Key concern: Manufacturing slot availability drops below demand in weeks 8-12. We need to pre-book slots 90 days out.

I commit to confirming the REMS compliance review by Wednesday.

Dr. Michael Torres
CAR-T Network Coordinator`,
    hasAttachments: true,
    attachments: [
      {
        name: "yescarta_q4_capacity.json",
        contentType: "application/json",
        size: 0,
        content: JSON.stringify(
          {
            forecast_period: "2026-Q4",
            centers: [
              { center_id: "ATC-001", name: "Northside CAR-T Center", projected_referrals: 12, manufacturing_slots: 14, apheresis_capacity: 16 },
              { center_id: "ATC-002", name: "Lakeshore Cell Therapy", projected_referrals: 8, manufacturing_slots: 7, apheresis_capacity: 10 },
              { center_id: "ATC-003", name: "Metro Cancer Institute", projected_referrals: 15, manufacturing_slots: 12, apheresis_capacity: 18 },
              { center_id: "ATC-004", name: "Central Plains ImmunoTx", projected_referrals: 6, manufacturing_slots: 8, apheresis_capacity: 9 },
            ],
            risk_weeks: [
              { week: 8, demand: 11, supply: 7, gap: -4 },
              { week: 9, demand: 12, supply: 6, gap: -6 },
              { week: 10, demand: 10, supply: 5, gap: -5 },
              { week: 11, demand: 13, supply: 6, gap: -7 },
              { week: 12, demand: 14, supply: 7, gap: -7 },
            ],
          },
          null,
          2,
        ),
      },
    ],
    category: "research_result",
    confidence: 0.85,
  },
  {
    id: "demo-email-005",
    subject: "Async Follow-up Experiment — Null Result Report",
    sender: "Aisha Williams",
    senderEmail: "awilliams@advantagefoundry.com",
    receivedDate: new Date(Date.now() - 86400000 * 7).toISOString(),
    bodyPreview:
      "The async follow-up experiment showed no improvement over synchronous. Response rates were 31% vs 33% baseline. Hypothesis falsified. Accounts with physician/mixed staff delegation do not benefit...",
    body: `Team,

The async follow-up experiment showed no improvement over synchronous.

Response rates: 31% async vs 33% synchronous baseline. Hypothesis falsified.

Key boundary identified: Accounts with physician or mixed staff delegation patterns do NOT benefit from async follow-up. The effect is concentrated in office-manager-led accounts only.

Future experiments must segment by staff delegation pattern.

I will archive the raw data by EOW.

Aisha Williams
Research Operations`,
    hasAttachments: false,
    attachments: [],
    category: "falsification",
    confidence: 0.91,
  },
  {
    id: "demo-email-006",
    subject: "Livdelzi PBC Adherence — 30-Day Coordination Pilot Data",
    sender: "Dr. Kevin Liu",
    senderEmail: "kliu@liver-health-partners.com",
    receivedDate: new Date(Date.now() - 86400000 * 4).toISOString(),
    bodyPreview:
      "Sharing the 30-day coordination pilot data for Livdelzi PBC patients. The attached CSV shows adherence rates and care coordination metrics...",
    body: `Hello,

Sharing the 30-day coordination pilot data for Livdelzi PBC patients.

The attached CSV shows adherence rates and care coordination metrics. The coordinated arm (care coordinator assigned within 7 days of prescription) shows 89% adherence vs 71% in the standard care arm.

This supports the hypothesis that 30-day care coordination improves PBC adherence.

I commit to presenting at the next research review.

Dr. Kevin Liu
Liver Health Partners`,
    hasAttachments: true,
    attachments: [
      {
        name: "livdelzi_pbc_adherence.csv",
        contentType: "text/csv",
        size: 0,
        content: `patient_id,arm,coordinator_assigned_days,adherence_30d,persistence_60d,pharmacy_refills,missed_doses
PBC-001,coordinated,3,0.94,yes,2,1
PBC-002,coordinated,5,0.91,yes,2,2
PBC-003,coordinated,7,0.86,yes,2,3
PBC-004,coordinated,2,0.96,yes,2,0
PBC-005,coordinated,6,0.89,yes,2,2
PBC-006,standard,14,0.71,no,1,8
PBC-007,standard,21,0.68,no,1,9
PBC-008,standard,18,0.74,no,1,7
PBC-009,standard,25,0.65,no,1,10
PBC-010,standard,12,0.78,yes,2,5
`,
      },
    ],
    category: "research_result",
    confidence: 0.87,
  },
];

function parseDemoAttachment(att: DemoAttachment): ParsedAttachmentData {
  const buffer = Buffer.from(att.content, "utf-8");
  const ext = att.name.split(".").pop()?.toLowerCase() || "";

  if (ext === "csv" || att.contentType === "text/csv") {
    const lines = att.content.trim().split("\n");
    const headers = lines[0].split(",");
    const rows = lines.slice(1).map((line) => {
      const values = line.split(",");
      const row: Record<string, unknown> = {};
      headers.forEach((h, i) => (row[h.trim()] = values[i]?.trim() ?? ""));
      return row;
    });
    return { type: "csv", rows, metadata: { rowCount: rows.length, headers } };
  }

  if (ext === "json" || att.contentType === "application/json") {
    try {
      const json = JSON.parse(att.content);
      if (Array.isArray(json)) {
        return { type: "csv", rows: json };
      }
      return { type: "text", text: JSON.stringify(json, null, 2) };
    } catch {
      return { type: "text", text: att.content };
    }
  }

  return { type: "text", text: att.content };
}

function seedDemoEmails(): void {
  const existing = loadProcessedEmails();
  if (existing.length > 0) return;

  const records: ProcessedEmailRecord[] = DEMO_EMAILS.map((email) => {
    const parsedAttachments = email.attachments.map(parseDemoAttachment);

    const fields: ExtractedField[] = [];
    const tables: ExtractedTable[] = [];

    // Extract fields from attachments
    for (let i = 0; i < parsedAttachments.length; i++) {
      const parsed = parsedAttachments[i];
      const attName = email.attachments[i].name;

      if (parsed.type === "csv" && parsed.rows && parsed.rows.length > 0) {
        const headers = parsed.metadata?.headers as string[] || Object.keys(parsed.rows[0]);
        tables.push({
          name: attName,
          headers,
          rows: parsed.rows as Record<string, string | number>[],
          source: `attachment:${attName}`,
        });

        // Extract numeric summary fields
        const firstRow = parsed.rows[0] as Record<string, unknown>;
        for (const [key, value] of Object.entries(firstRow)) {
          if (typeof value === "number" || (typeof value === "string" && !isNaN(Number(value)) && value.trim() !== "")) {
            fields.push({
              key: `${attName}:${key}`,
              value: String(value),
              type: "number",
              confidence: 0.9,
            });
          }
        }
      } else if (parsed.type === "text" && parsed.text) {
        fields.push({
          key: `${attName}:content_length`,
          value: String(parsed.text.length),
          type: "number",
          confidence: 0.8,
        });
      }
    }

    // Extract fields from email body
    const commitmentMatch = email.body.match(/I (?:will|commit to|promise to)\s+([^.]+)/i);
    if (commitmentMatch) {
      fields.push({
        key: "commitment",
        value: commitmentMatch[1].trim(),
        type: "string",
        confidence: 0.85,
      });
    }

    const extractedData: ExtractedData = {
      emailId: email.id,
      extractedAt: new Date().toISOString(),
      fields,
      tables,
      summary: email.bodyPreview,
      category: email.category,
      confidence: email.confidence,
      source: email.hasAttachments ? "both" : "email_body",
    };

    return {
      id: `rec_${email.id}`,
      emailId: email.id,
      subject: email.subject,
      sender: email.sender,
      senderEmail: email.senderEmail,
      receivedDate: email.receivedDate,
      processedAt: new Date().toISOString(),
      category: email.category,
      confidence: email.confidence,
      fieldCount: fields.length,
      tableCount: tables.length,
      extractedData,
    };
  });

  saveProcessedEmails(records);

  // Update sync status
  const status = {
    lastSync: new Date().toISOString(),
    totalEmails: records.length,
    processedEmails: records.length,
    pendingEmails: 0,
    isSyncing: false,
    errors: [],
  };
  saveSyncStatus(status);
}

// ─── Self-configuring inbox detection ─────────────────────────────────

export interface InboxProviderConfig {
  provider: "gmail" | "imap" | "graph" | "demo" | "none";
  configured: boolean;
  email?: string;
  host?: string;
  port?: number;
  hasCredentials: boolean;
  message: string;
}

/**
 * Auto-detect which inbox provider is available based on environment
 * variables and stored configuration. This enables the inbox to
 * self-configure without manual setup.
 */
export function detectInboxProvider(ctx?: { orgId?: string; userId?: string }): InboxProviderConfig {
  // 0. Check stored server-side email credentials (if user context is provided)
  if (ctx?.orgId && ctx?.userId) {
    try {
      const { getCredentialsForUser } = require("@/lib/auth/credential-store");
      const creds = getCredentialsForUser(ctx.orgId, ctx.userId);
      const ms = creds.find((c: any) => c.provider === "microsoft");
      if (ms) {
        return {
          provider: "graph",
          configured: true,
          email: ms.email,
          hasCredentials: true,
          message: `Microsoft 365 connected for ${ms.email}.`,
        };
      }
      const gmail = creds.find((c: any) => c.provider === "gmail");
      if (gmail) {
        return {
          provider: "gmail",
          configured: true,
          email: gmail.email,
          hasCredentials: true,
          message: `Gmail connected for ${gmail.email}.`,
        };
      }
    } catch {
      // Credential store not available; fall through to env-based detection
    }
  }

  // 1. Check Gmail OAuth credentials (app-only is not a connected account)
  const gmailClientId = process.env.GMAIL_CLIENT_ID;
  const gmailClientSecret = process.env.GMAIL_CLIENT_SECRET;
  const gmailRefreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (gmailClientId && (gmailRefreshToken || (gmailClientSecret && process.env.GMAIL_ACCESS_TOKEN))) {
    return {
      provider: "gmail",
      configured: true,
      hasCredentials: true,
      message: "Gmail OAuth connected.",
    };
  }
  if (gmailClientId) {
    return {
      provider: "gmail",
      configured: false,
      hasCredentials: false,
      message: "Gmail OAuth app configured. Connect your account in Settings.",
    };
  }

  // 2. Check IMAP credentials
  const imapEmail = process.env.IMAP_EMAIL || process.env.OUTLOOK_EMAIL;
  const imapPassword = process.env.IMAP_PASSWORD || process.env.OUTLOOK_PASSWORD;
  if (imapEmail && imapPassword) {
    return {
      provider: "imap",
      configured: true,
      email: imapEmail,
      host: process.env.IMAP_HOST || "outlook.office365.com",
      port: parseInt(process.env.IMAP_PORT || "993"),
      hasCredentials: true,
      message: `IMAP configured for ${imapEmail}.`,
    };
  }

  // 3. Check Microsoft Graph config (app-only is not a connected account)
  try {
    // Lazy import to avoid circular deps
    const { loadConfig } = require("@/lib/config");
    const config = loadConfig();
    const graphAccess = config.graph?.accessToken || config.graph?.refreshToken || process.env.MS_TOKEN;
    if (config.graph?.clientId && graphAccess) {
      return {
        provider: "graph",
        configured: true,
        email: config.graph.mailbox,
        hasCredentials: true,
        message: `Microsoft Graph connected for ${config.graph.mailbox || process.env.MS_MAILBOX || "account"}.`,
      };
    }
    if (config.graph?.clientId) {
      return {
        provider: "graph",
        configured: false,
        hasCredentials: false,
        message: "Microsoft Graph app configured. Connect your account in Settings.",
      };
    }
  } catch {
    // Config not available
  }

  // 4. No real provider found
  return {
    provider: "none",
    configured: false,
    hasCredentials: false,
    message: "No real mailbox connected. Connect Gmail or Microsoft 365 in Settings.",
  };
}
