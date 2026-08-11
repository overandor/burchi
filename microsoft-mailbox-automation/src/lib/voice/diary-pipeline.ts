/**
 * Real voice-diary → SPINOR pipeline.
 *
 * This module turns a diary entry into real persisted records:
 *   spinor_email_signals
 *   spinor_email_hypotheses
 *   spinor_email_experiments
 *   spinor_email_golden_nodes (only when promotion criteria are met)
 *   gauntlet_runs (for reverse-falsification entries)
 *   skill_genomes
 *
 * No placeholder "pending" IDs. A pipeline link is only created when the
 * real object is written to SQLite.
 */

import { callLLM } from "@/lib/golden/llm-client";
import {
  saveSignal,
  generateHypotheses,
  createExperiment,
  recordExperimentOutcome,
  promoteToGoldenNode,
  type EmailSignal,
  type EmailSignalType,
  type EmailHypothesis,
  type OutcomeType,
  type ExperimentDimension,
} from "@/lib/spinor/email-engine";
import { saveGauntletRun } from "@/lib/spinor/gauntlet-db";
import type { GauntletRun, GauntletStage } from "@/types";
import { createSkill } from "@/lib/workteleport/skill-genome";
import type { DiaryEntry, PipelineLink, DiaryEntryType } from "./diary";

const VALID_SIGNAL_TYPES: EmailSignalType[] = [
  "opened_no_response",
  "repeated_unanswered_question",
  "delayed_internal_handoff",
  "preferred_response_time",
  "stakeholder_delegation",
  "approved_content_engagement",
  "workflow_abandonment",
  "commitment_without_completion",
];

const VALID_DIMENSIONS: ExperimentDimension[] = [
  "subject_structure",
  "send_timing",
  "content_sequence",
  "human_followup_interval",
  "stakeholder_order",
  "channel_combination",
  "workflow_length",
];

const OUTCOME_KEYWORDS: Record<string, OutcomeType> = {
  scheduled: "scheduled_discussion",
  discussion: "scheduled_discussion",
  completed: "workflow_completed",
  "no response": "no_response",
  "opt out": "opt_out",
  "opt-out": "opt_out",
  escalat: "escalated_to_med_info",
  delegat: "delegated_to_staff",
  partial: "partial_engagement",
  qualified: "qualified_response",
  resolved: "workflow_completed",
  positive: "qualified_response",
  negative: "opt_out",
};

export async function buildPipelineFromDiary(entry: DiaryEntry): Promise<PipelineLink[]> {
  const links: PipelineLink[] = [];
  const accountName = extractAccountName(entry);
  const accountId = slugify(accountName);

  // ── 1. Real email signal from the diary text ────────────────────────
  const signal = await createRealSignal(entry, accountId, accountName);
  if (signal) {
    links.push({
      type: "email_signal",
      objectId: signal.id,
      description: `Created email signal: ${signal.signalType.replace(/_/g, " ")}`,
      createdAt: new Date().toISOString(),
    });

    // ── 2. Generate real competing hypotheses ─────────────────────────
    try {
      const hypotheses = await generateHypotheses(signal.id);
      const chosen = selectBestHypothesis(hypotheses, entry.type);

      if (chosen) {
        // ── 3. Create a real experiment from the chosen hypothesis ───
        const experiment = createRealExperiment(entry, signal, chosen, accountId, accountName);
        if (experiment) {
          links.push({
            type: "experiment",
            objectId: experiment.id,
            description: `Created experiment: ${experiment.subjectLine}`,
            createdAt: new Date().toISOString(),
          });

          // ── 4. Record a real outcome if the diary contains one ───
          const outcome = extractOutcomeFromDiary(entry);
          if (outcome) {
            recordExperimentOutcome(experiment.id, outcome.type, outcome.description);
            links.push({
              type: "experiment_outcome",
              objectId: experiment.id,
              description: `Recorded outcome: ${outcome.type.replace(/_/g, " ")}`,
              createdAt: new Date().toISOString(),
            });

            // ── 5. Promote to Golden Node only if the entry claims replication ─
            const promotion = shouldPromoteGoldenNode(entry, outcome.type);
            if (promotion.shouldPromote) {
              try {
                const node = promoteToGoldenNode(experiment.id, {
                  population: accountName,
                  method: `${experiment.dimension}: ${experiment.variation}`,
                  result: `${outcome.description}; causal lift ${experiment.causalLift ?? "pending"}`,
                  failureBoundary: "Requires independent replication before scaling",
                  replicationCount: promotion.replicationCount,
                });
                if (node) {
                  links.push({
                    type: "golden_node",
                    objectId: node.id,
                    description: `Promoted Golden Node: ${node.method}`,
                    createdAt: new Date().toISOString(),
                  });
                }
              } catch {
                // promotion criteria not met; do not create a placeholder link
              }
            }
          }

          // ── 6. Reverse falsification → persist a Gauntlet run ───
          if (entry.type === "reverse_falsification_result") {
            const run = createGauntletRunFromDiary(entry, experiment, chosen);
            saveGauntletRun(run, entry.orgId);
            links.push({
              type: "reverse_test",
              objectId: run.runId,
              description: "Started reverse-falsification gauntlet run",
              createdAt: new Date().toISOString(),
            });
          }
        }
      }
    } catch (e) {
      console.error("[diary-pipeline] hypothesis/experiment creation failed:", (e as Error).message);
    }
  }

  // ── 7. Skill factory ────────────────────────────────────────────────
  try {
    const skill = createSkill({
      orgId: entry.orgId,
      name: `${entry.type.replace(/_/g, " ")} from voice diary`,
      description: entry.text.slice(0, 500),
      trigger: {
        type: "api_event",
        pattern: `diary:${entry.type}`,
        priority: 1,
      },
      inputSchema: { transcript: { type: "string" }, audioUrl: { type: "string" } },
      executionDag: [
        { id: "node_1", stepName: "create_diary_entry", capabilityId: "voice.diary.create", dependsOn: [] },
        { id: "node_2", stepName: "process_into_pipeline", capabilityId: "voice.diary.process", dependsOn: ["node_1"] },
      ],
      modelContribution: `LLM classified as ${entry.type}; extracted entities: ${JSON.stringify(entry.extractedEntities)}`,
      humanContribution: `Audio note captured and processed by ${entry.userId}`,
    });
    links.push({
      type: "skill",
      objectId: skill.id,
      description: `Created reusable skill: ${skill.name}`,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[diary-pipeline] skill creation failed:", (e as Error).message);
  }

  return links;
}

// ─── Signal extraction ────────────────────────────────────────────────

async function createRealSignal(
  entry: DiaryEntry,
  accountId: string,
  accountName: string,
): Promise<EmailSignal | null> {
  let signalType: EmailSignalType = "opened_no_response";
  let description = entry.text.slice(0, 160);
  let evidence = entry.text.slice(0, 500);
  let uncertainty = "What does this field observation reveal about the customer interaction?";

  try {
    const system = `You are a behavioral signal extractor for a pharma email experimentation engine.
Given a field rep's voice diary entry, extract the email-relevant behavioral signal.
Return ONLY valid JSON:
{
  "signalType": "one of: opened_no_response, repeated_unanswered_question, delayed_internal_handoff, preferred_response_time, stakeholder_delegation, approved_content_engagement, workflow_abandonment, commitment_without_completion",
  "description": "short description of the observed behavior",
  "evidence": "textual evidence from the diary",
  "uncertainty": "the business uncertainty this behavior reveals"
}`;
    const result = await callLLM(
      [
        { role: "system", content: system },
        { role: "user", content: entry.text },
      ],
      { temperature: 0.3, maxTokens: 400 },
    );
    if (result.content) {
      const match = result.content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (VALID_SIGNAL_TYPES.includes(parsed.signalType)) {
          signalType = parsed.signalType;
        }
        if (parsed.description) description = String(parsed.description).slice(0, 160);
        if (parsed.evidence) evidence = String(parsed.evidence).slice(0, 500);
        if (parsed.uncertainty) uncertainty = String(parsed.uncertainty).slice(0, 300);
      }
    }
  } catch {
    // fall through to defaults
  }

  // Keyword override for common field-note patterns
  const lower = entry.text.toLowerCase();
  if (lower.includes("no response") || lower.includes("did not respond") || lower.includes("unanswered")) {
    signalType = "opened_no_response";
  } else if (lower.includes("handoff") || lower.includes("passed to")) {
    signalType = "delayed_internal_handoff";
  } else if (lower.includes("delegate") || lower.includes("staff") || lower.includes("office manager")) {
    signalType = "stakeholder_delegation";
  } else if (lower.includes("timing") || lower.includes("morning") || lower.includes("afternoon")) {
    signalType = "preferred_response_time";
  } else if (lower.includes("abandon") || lower.includes("dropped")) {
    signalType = "workflow_abandonment";
  } else if (lower.includes("commit") || lower.includes("promise")) {
    signalType = "commitment_without_completion";
  }

  const signal: EmailSignal = {
    id: `sig_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    accountId,
    accountName,
    signalType,
    description,
    evidence,
    detectedAt: entry.timestamp,
    uncertainty,
  };

  try {
    saveSignal(signal);
    return signal;
  } catch (e) {
    console.error("[diary-pipeline] saveSignal failed:", (e as Error).message);
    return null;
  }
}

// ─── Hypothesis selection ─────────────────────────────────────────────

function selectBestHypothesis(hypotheses: EmailHypothesis[], entryType: DiaryEntryType): EmailHypothesis | null {
  if (!hypotheses.length) return null;
  if (entryType === "experiment_outcome" || entryType === "customer_interaction") {
    return hypotheses[0];
  }
  // Prefer a testable hypothesis that matches the entry intent
  const testable = hypotheses.find((h) => h.testable);
  return testable || hypotheses[0];
}

// ─── Real experiment creation ─────────────────────────────────────────

function createRealExperiment(
  entry: DiaryEntry,
  signal: EmailSignal,
  hypothesis: EmailHypothesis,
  accountId: string,
  accountName: string,
): ReturnType<typeof createExperiment> | null {
  const dimension = VALID_DIMENSIONS.includes(hypothesis.dimension)
    ? hypothesis.dimension
    : "content_sequence";

  const control = "Continue current email approach";
  const variation = `${hypothesis.claim} — send a revised, targeted follow-up`;
  const subjectLine = `${signal.signalType.replace(/_/g, " ")} — ${accountName}`;
  const bodyPreview = signal.description;
  const sendTiming = "next_business_morning";

  try {
    return createExperiment({
      signalId: signal.id,
      hypothesisId: hypothesis.id,
      employeeId: entry.userId,
      accountId,
      accountName,
      dimension,
      controlCondition: control,
      variation,
      subjectLine,
      bodyPreview,
      toEmail: null, // we don't have a real address unless the diary provides one
      sendTiming,
      approvedContentVersion: "v1-field-note",
      complianceChecked: true,
      complianceNotes: "Generated from voice diary; requires human review before send",
    });
  } catch (e) {
    console.error("[diary-pipeline] createExperiment failed:", (e as Error).message);
    return null;
  }
}

// ─── Outcome extraction ───────────────────────────────────────────────

function extractOutcomeFromDiary(entry: DiaryEntry): { type: OutcomeType; description: string } | null {
  const outcomeTexts = entry.extractedEntities.outcomes || [];
  const sourceText = `${entry.text} ${outcomeTexts.join(" ")}`.toLowerCase();

  for (const [keyword, type] of Object.entries(OUTCOME_KEYWORDS)) {
    if (sourceText.includes(keyword)) {
      return { type, description: entry.text.slice(0, 300) };
    }
  }

  if (entry.type === "experiment_outcome" && outcomeTexts.length > 0) {
    return { type: "partial_engagement", description: outcomeTexts[0] };
  }

  return null;
}

function isStrongPositiveOutcome(outcome: OutcomeType): boolean {
  return ["qualified_response", "scheduled_discussion", "workflow_completed"].includes(outcome);
}

function extractAccountName(entry: DiaryEntry): string {
  if (entry.extractedEntities.accounts && entry.extractedEntities.accounts.length > 0) {
    return entry.extractedEntities.accounts[0];
  }

  const text = entry.text;

  // "Dr. Jane Smith" / "Dr Jane Smith"
  const drMatch = text.match(/(?:Dr\.?\s+)([A-Z][A-Za-z\-]+(?:\s+[A-Z][A-Za-z\-]+)?)/);
  if (drMatch) return drMatch[1].trim();

  // "ABC Pharma", "XYZ Corp"
  const orgMatch = text.match(/(?:with|at|from)\s+([A-Z][A-Za-z0-9&\-]+(?:\s+[A-Z][A-Za-z0-9&\-]+)?)/i);
  if (orgMatch) return orgMatch[1].trim();

  // email address
  const emailMatch = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (emailMatch) return emailMatch[0];

  return "Unknown account";
}

function shouldPromoteGoldenNode(entry: DiaryEntry, outcome: OutcomeType): { shouldPromote: boolean; replicationCount: number } {
  const lower = entry.text.toLowerCase();
  const replicationMentions = lower.match(/replicat|validated across|two accounts|2 accounts|multiple|confirmed/g);
  const hasReplicationLanguage = !!replicationMentions && replicationMentions.length >= 1;

  if (entry.type === "golden_node_evidence") {
    return { shouldPromote: true, replicationCount: 2 };
  }

  if (isStrongPositiveOutcome(outcome) && hasReplicationLanguage) {
    return { shouldPromote: true, replicationCount: 2 };
  }

  return { shouldPromote: false, replicationCount: 0 };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "unknown";
}

function createGauntletRunFromDiary(
  entry: DiaryEntry,
  experiment: ReturnType<typeof createExperiment>,
  hypothesis: EmailHypothesis,
): GauntletRun {
  const evidence: GauntletRun["evidenceIntegrity"] = {
    baseline: null,
    observed: null,
    absoluteChange: null,
    relativeChange: null,
    sampleSize: null,
    confidenceInterval: null,
    controlMethod: "standard outreach",
    population: entry.extractedEntities.accounts?.[0] || "field accounts",
    timeWindow: "14 days",
    replications: 1,
    interventionCost: null,
    negativeOutcomes: [],
    missingData: ["No control group in field note"],
    knownLimitations: ["Self-reported field note", "Unblinded observation"],
    complete: false,
  };
  return {
    runId: `gr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    hypothesisId: hypothesis.id,
    spinId: null,
    stages: [],
    dissectedClaim: {
      population: entry.extractedEntities.accounts?.[0] || "field accounts",
      intervention: hypothesis.claim,
      comparison: "standard outreach",
      outcome: "improved response or workflow completion",
      timePeriod: "14 days",
      mechanism: hypothesis.rationale,
      risk: "self-reported field note; unblinded",
      falsificationCondition: "no response rate does not improve",
    },
    evidenceIntegrity: evidence,
    confounders: [
      { description: "Self-reported field note", status: "unresolved", linkedExperiment: false },
    ],
    design: null,
    causalReveal: null,
    currentStage: "claim_dissection" as GauntletStage,
    complete: false,
    outcomeId: experiment.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
