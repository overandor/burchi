/**
 * SPINOR-RL Engine — The Palindromic Perpetual Research Game.
 *
 * Integrates mission classes, physician adaptation, palindromic learning,
 * RL allocation, email sensing, anti-stagnation, sprouting, staged
 * diffusion, and anti-gaming controls into a single engine that builds
 * on the existing GOLDEN NODE infrastructure.
 *
 * Every LLM-powered function has a deterministic fallback. The system
 * always works; the LLM enhances it when available.
 */

import { nanoid } from "nanoid";
import {
  MissionCard,
  MissionClass,
  PhysicianModel,
  PhysicianAdaptationState,
  PalindromeUpdate,
  RLAgentState,
  RLReward,
  RLAction,
  EmailSignal,
  StagnationFlag,
  StagnationTransformation,
  SproutNode,
  DiffusionState,
  DiffusionStage,
  AntiGamingCheck,
  HypothesisAnatomy,
  HypothesisAssignment,
  HypothesisOutcome,
  EmailMessage,
} from "@/types";
import {
  loadMissions, saveMissions,
  loadPhysicians, savePhysicians,
  loadPalindromeUpdates, savePalindromeUpdates,
  loadRLAgentStates, saveRLAgentStates,
  loadRLRewards, saveRLRewards,
  loadEmailSignals, saveEmailSignals,
  loadStagnationFlags, saveStagnationFlags,
  loadSproutTree, saveSproutTree,
  loadDiffusionStates, saveDiffusionStates,
  loadAntiGamingChecks, saveAntiGamingChecks,
  loadHypotheses, loadHypothesisAssignments, loadHypothesisOutcomes,
  loadDerivatives, loadGoldenNodes,
} from "@/lib/config";
import { callLLM, extractJSON, ChatMessage } from "@/lib/golden/llm-client";
import { SEED_EMPLOYEES } from "@/lib/golden/seed";

const now = () => new Date().toISOString();

// ─── Mission Classes ────────────────────────────────────────────────

export const MISSION_CLASS_CONFIG: Record<MissionClass, {
  label: string;
  icon: string;
  description: string;
  color: string;
}> = {
  scout:       { label: "Scout",       icon: "🔍", description: "Search prior art, customer behavior, competitor methods, or neglected evidence", color: "#3b82f6" },
  field:       { label: "Field",       icon: "🧪", description: "Perform a constrained real-world test", color: "#22c55e" },
  builder:     { label: "Builder",     icon: "🔧", description: "Convert a successful tactic into automation or a reusable system", color: "#f59e0b" },
  replication: { label: "Replication", icon: "🔄", description: "Test another employee's result in a different setting", color: "#8b5cf6" },
  saboteur:    { label: "Saboteur",    icon: "💣", description: "Attempt to falsify a successful organizational belief", color: "#ef4444" },
  mutation:    { label: "Mutation",    icon: "🧬", description: "Generate useful derivatives of an existing hypothesis", color: "#ec4899" },
  translator:  { label: "Translator",  icon: "🌐", description: "Adapt a successful method for a different physician profile", color: "#06b6d4" },
  recovery:    { label: "Recovery",    icon: "🚑", description: "Investigate why a high-effort employee or territory is underperforming", color: "#f97316" },
  channel:     { label: "Channel",     icon: "📡", description: "Determine whether a validated process can become a separate business line", color: "#fbbf24" },
  palindrome:  { label: "Palindrome",  icon: "↔️", description: "Take a mature system backward, isolate assumptions, rebuild from first principles", color: "#a78bfa" },
};

/**
 * Generate a mission card for an employee using the RL allocation engine.
 * The mission class is selected to prevent fatigue and maximize learning.
 */
export async function generateMission(
  employeeId: string,
  preferredClass?: MissionClass,
): Promise<{ mission: MissionCard; llmUsed: boolean; llmError?: string }> {
  const missions = loadMissions();
  const hypotheses = loadHypotheses();
  const assignments = loadHypothesisAssignments();
  const outcomes = loadHypothesisOutcomes();

  // Select mission class using RL allocation
  const missionClass = preferredClass || selectMissionClass(employeeId, missions);

  // Find the best hypothesis for this mission class
  const activeAssignment = assignments.find(
    (a) => a.employeeId === employeeId && !["falsified", "validated", "scaled", "productized", "channel", "rejected", "completed"].includes(a.state),
  );
  const hypothesis = activeAssignment
    ? hypotheses.find((h) => h.id === activeAssignment.hypothesisId)
    : hypotheses.find((h) => !outcomes.some((o) => o.hypothesisId === h.id && !o.falsified));

  if (!hypothesis) {
    // No hypothesis available — generate a scout mission
    return generateScoutMission(employeeId);
  }

  // Build the mission card with LLM enhancement
  const config = MISSION_CLASS_CONFIG[missionClass];
  const priorOutcomes = outcomes.filter((o) => o.hypothesisId === hypothesis.id);
  const testedAlready = priorOutcomes.length > 0
    ? priorOutcomes.map((o) => `${o.successKind}${o.falsified ? " (falsified)" : ""}: ${o.outcomeDescription.slice(0, 100)}`).join("; ")
    : "No prior tests on this hypothesis.";

  // LLM: generate mission-specific framing
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a mission generation engine for SPINOR-RL, a palindromic research game.
Generate a mission card for a ${config.label} mission. The mission must be specific, actionable, and grounded in the hypothesis.
Return ONLY valid JSON with this structure:
{
  "title": "Short mission title (5-8 words)",
  "claim": "The hypothesis claim being tested",
  "priorEvidence": "What evidence exists so far",
  "unknowns": ["unknown1", "unknown2"],
  "targetPopulation": "Who/what this targets",
  "experimentalAction": "The specific action to take",
  "controlComparison": "The control or comparison condition",
  "successMetric": "How success is measured",
  "failureCondition": "What would falsify this",
  "riskBoundary": "Compliance and safety boundaries",
  "minimumEvidence": "Minimum evidence needed for a conclusion",
  "strategicValue": "Why this matters strategically"
}`,
    },
    {
      role: "user",
      content: `Mission class: ${config.label} — ${config.description}
Hypothesis: "${hypothesis.claim}"
Intervention: ${hypothesis.intervention}
Control: ${hypothesis.control}
Primary outcome: ${hypothesis.primaryOutcome}
Primary uncertainty: ${hypothesis.primaryUncertainty}
Expected value: ${hypothesis.expectedValue}
Compliance boundary: ${hypothesis.complianceBoundary}
Prior tests: ${testedAlready}

Generate a ${config.label} mission card for this hypothesis.`,
    },
  ];

  const llm = await callLLM(messages, { temperature: 0.5, maxTokens: 2048 });
  let llmUsed = false;
  let llmError: string | undefined;

  let cardData: any = null;
  if (llm.used) {
    cardData = extractJSON(llm.content);
    if (cardData) {
      llmUsed = true;
    } else {
      llmError = "LLM returned unparseable JSON";
    }
  } else {
    llmError = llm.error;
  }

  // Deterministic fallback
  const mission: MissionCard = {
    id: `mission_${nanoid(8)}`,
    employeeId,
    missionClass,
    hypothesisId: hypothesis.id,
    assignmentId: activeAssignment?.id,
    title: cardData?.title || `${config.label}: ${hypothesis.claim.slice(0, 50)}`,
    claim: cardData?.claim || hypothesis.claim,
    priorEvidence: cardData?.priorEvidence || hypothesis.expectedValue,
    testedAlready,
    unknowns: cardData?.unknowns || [hypothesis.primaryUncertainty],
    targetPopulation: cardData?.targetPopulation || hypothesis.targetCondition,
    experimentalAction: cardData?.experimentalAction || hypothesis.intervention,
    controlComparison: cardData?.controlComparison || hypothesis.control,
    successMetric: cardData?.successMetric || hypothesis.primaryOutcome,
    failureCondition: cardData?.failureCondition || hypothesis.primaryUncertainty,
    riskBoundary: cardData?.riskBoundary || hypothesis.complianceBoundary,
    minimumEvidence: cardData?.minimumEvidence || "At least 3 controlled trials with consistent direction",
    strategicValue: cardData?.strategicValue || hypothesis.expectedValue,
    allocationReason: `RL-selected ${config.label} mission for ${employeeId}`,
    state: "assigned",
    createdAt: now(),
  };

  missions.push(mission);
  saveMissions(missions);
  return { mission, llmUsed, llmError };
}

/** Select a mission class that prevents fatigue and balances the portfolio. */
function selectMissionClass(employeeId: string, missions: MissionCard[]): MissionClass {
  const employeeMissions = missions.filter((m) => m.employeeId === employeeId);
  const recentClasses = employeeMissions.slice(-5).map((m) => m.missionClass);

  // All mission classes
  const allClasses: MissionClass[] = [
    "scout", "field", "builder", "replication", "saboteur",
    "mutation", "translator", "recovery", "channel", "palindrome",
  ];

  // Prefer classes not recently used
  const available = allClasses.filter((c) => !recentClasses.includes(c));
  if (available.length > 0) {
    // Weighted random: field missions more common, palindrome rare
    const weights: Record<MissionClass, number> = {
      field: 30, scout: 20, builder: 15, replication: 10,
      mutation: 10, translator: 5, recovery: 5, saboteur: 3,
      channel: 1, palindrome: 1,
    };
    const totalWeight = available.reduce((s, c) => s + weights[c], 0);
    let r = Math.random() * totalWeight;
    for (const c of available) {
      r -= weights[c];
      if (r <= 0) return c;
    }
    return available[0];
  }

  // All classes recently used — pick the least used
  const classCounts: Record<string, number> = {};
  for (const m of employeeMissions) {
    classCounts[m.missionClass] = (classCounts[m.missionClass] || 0) + 1;
  }
  return allClasses.sort((a, b) => (classCounts[a] || 0) - (classCounts[b] || 0))[0];
}

/** Generate a scout mission when no hypothesis is available. */
async function generateScoutMission(employeeId: string): Promise<{ mission: MissionCard; llmUsed: boolean; llmError?: string }> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a scout mission generator for SPINOR-RL. Generate a research scouting mission that searches for new hypotheses in pharma field execution.
Return ONLY valid JSON:
{
  "title": "Scout mission title",
  "claim": "A potential pattern worth investigating",
  "priorEvidence": "What is already known",
  "unknowns": ["unknown1", "unknown2"],
  "targetPopulation": "Who to observe",
  "experimentalAction": "What to search/observe",
  "controlComparison": "What to compare against",
  "successMetric": "What would make this scouting valuable",
  "failureCondition": "What would make this scouting useless",
  "riskBoundary": "Compliance boundaries",
  "minimumEvidence": "Minimum evidence needed",
  "strategicValue": "Why this matters"
}`,
    },
    {
      role: "user",
      content: `Generate a scout mission for employee ${employeeId}. Focus on finding untested patterns in physician engagement, workflow automation, or communication strategies within pharma boundaries.`,
    },
  ];

  const llm = await callLLM(messages, { temperature: 0.6, maxTokens: 1536 });
  let cardData: any = null;
  let llmUsed = false;
  if (llm.used) {
    cardData = extractJSON(llm.content);
    if (cardData) llmUsed = true;
  }

  const mission: MissionCard = {
    id: `mission_${nanoid(8)}`,
    employeeId,
    missionClass: "scout",
    title: cardData?.title || "Scout: Search for untested engagement patterns",
    claim: cardData?.claim || "There may be untested communication patterns that improve physician engagement",
    priorEvidence: cardData?.priorEvidence || "Standard outreach methods are well-documented but alternatives are not systematically tested",
    testedAlready: "Standard methods tested; alternatives untested",
    unknowns: cardData?.unknowns || ["Which alternative patterns exist", "Which have been tried informally"],
    targetPopulation: cardData?.targetPopulation || "Physicians in target territories",
    experimentalAction: cardData?.experimentalAction || "Observe and catalog communication patterns across territories",
    controlComparison: cardData?.controlComparison || "Compare against standard outreach methods",
    successMetric: cardData?.successMetric || "Identification of 3+ untested but plausible engagement patterns",
    failureCondition: cardData?.failureCondition || "No new patterns identified beyond standard methods",
    riskBoundary: cardData?.riskBoundary || "Approved information and workflows only; no patient-level targeting",
    minimumEvidence: cardData?.minimumEvidence || "At least 5 observations across different territories",
    strategicValue: cardData?.strategicValue || "New patterns become seeds for the hypothesis pipeline",
    allocationReason: "No hypothesis available — scout mission to discover new patterns",
    state: "assigned",
    createdAt: now(),
  };

  const missions = loadMissions();
  missions.push(mission);
  saveMissions(missions);
  return { mission, llmUsed, llmError: llm.used ? undefined : llm.error };
}

/** Get active missions for an employee. */
export function getActiveMissions(employeeId: string): MissionCard[] {
  return loadMissions().filter(
    (m) => m.employeeId === employeeId && (m.state === "assigned" || m.state === "accepted" || m.state === "executing"),
  );
}

/** Update mission state. */
export function updateMissionState(missionId: string, state: MissionCard["state"]): MissionCard | null {
  const missions = loadMissions();
  const idx = missions.findIndex((m) => m.id === missionId);
  if (idx < 0) return null;
  missions[idx].state = state;
  if (state === "completed" || state === "abandoned") {
    missions[idx].completedAt = now();
  }
  saveMissions(missions);
  return missions[idx];
}

// ─── Physician Adaptation Engine ────────────────────────────────────

/**
 * Update a physician's interaction model from observed email behavior.
 * Uses LLM to classify the physician's adaptation state and recommend approach.
 */
export async function updatePhysicianModel(
  physicianId: string,
  name: string,
  emails: EmailMessage[],
): Promise<{ physician: PhysicianModel; llmUsed: boolean; llmError?: string }> {
  const physicians = loadPhysicians();
  const existing = physicians.find((p) => p.physicianId === physicianId);

  // Compute signals from emails
  const signals = computePhysicianSignals(emails);

  // LLM: classify adaptation state and recommend approach
  const emailSummary = emails.slice(0, 10).map((e) => ({
    subject: e.subject,
    from: e.sender,
    date: e.receivedDate,
    isRead: e.isRead,
    responseTime: e.receivedDate,
  }));

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a physician technology-adaptation engine for SPINOR-RL.
Analyze the physician's interaction patterns and classify their adaptation state.
Return ONLY valid JSON:
{
  "currentState": "automation_resistant" | "automation_tolerant" | "automation_curious" | "automation_proficient" | "llm_aware" | "system_building" | "human_relationship_dominant" | "administrative_delegation_dominant" | "evidence_intensive" | "time_compressed" | "technically_sophisticated_conservative",
  "recommendedApproach": "How the system should communicate with this physician",
  "nextTestHypothesis": "What the system should test next with this physician",
  "reasoning": "2-3 sentence explanation"
}`,
    },
    {
      role: "user",
      content: `Physician: ${name}
Observed signals:
- Digital responsiveness: ${(signals.digitalResponsiveness * 100).toFixed(0)}%
- Preferred channel: ${signals.preferredChannel}
- Self-service completion: ${(signals.selfServiceCompletion * 100).toFixed(0)}%
- Staff delegation: ${signals.staffDelegationPattern}
- Meeting preference: ${signals.meetingPreference}
- Response latency: ${signals.responseLatencyHours}h
- Content depth preference: ${signals.contentDepthPreference}
- Workflow complexity tolerance: ${signals.workflowComplexityTolerance}
- Prior automation adoption: ${(signals.priorAutomationAdoption * 100).toFixed(0)}%

Recent emails:
${JSON.stringify(emailSummary, null, 2)}

Classify this physician's adaptation state and recommend the communication approach.`,
    },
  ];

  const llm = await callLLM(messages, { temperature: 0.3, maxTokens: 1536 });
  let llmUsed = false;
  let llmError: string | undefined;
  let llmData: any = null;

  if (llm.used) {
    llmData = extractJSON(llm.content);
    if (llmData) llmUsed = true;
    else llmError = "LLM returned unparseable JSON";
  } else {
    llmError = llm.error;
  }

  // Deterministic fallback: classify from signals
  const fallbackState = classifyFromSignals(signals);

  const physician: PhysicianModel = {
    physicianId,
    name,
    currentState: llmData?.currentState || fallbackState,
    stateHistory: [
      ...(existing?.stateHistory || []),
      { state: llmData?.currentState || fallbackState, observedAt: now(), evidence: `From ${emails.length} emails` },
    ].slice(-20),
    interactionSignals: signals,
    recommendedApproach: llmData?.recommendedApproach || getApproachForState(fallbackState),
    nextTestHypothesis: llmData?.nextTestHypothesis || `Test whether ${fallbackState.replace(/_/g, " ")} physicians respond differently to workflow-focused vs product-focused outreach`,
    updatedAt: now(),
  };

  const idx = physicians.findIndex((p) => p.physicianId === physicianId);
  if (idx >= 0) physicians[idx] = physician;
  else physicians.push(physician);
  savePhysicians(physicians);

  return { physician, llmUsed, llmError };
}

function computePhysicianSignals(emails: EmailMessage[]): PhysicianModel["interactionSignals"] {
  const total = emails.length || 1;
  const read = emails.filter((e) => e.isRead).length;
  const hasAttachments = emails.filter((e) => e.hasAttachments).length;

  // Estimate response latency from email dates
  const dates = emails.map((e) => new Date(e.receivedDate).getTime()).filter((d) => !isNaN(d));
  const avgLatency = dates.length > 1
    ? (Math.max(...dates) - Math.min(...dates)) / (dates.length * 3600000)
    : 24;

  return {
    digitalResponsiveness: read / total,
    preferredChannel: hasAttachments > total * 0.3 ? "email_with_attachments" : "email",
    selfServiceCompletion: Math.min(1, (emails.filter((e) => e.subject.toLowerCase().includes("confirm") || e.subject.toLowerCase().includes("schedule")).length / total) * 2),
    staffDelegationPattern: emails.some((e) => e.senderEmail.includes("admin") || e.senderEmail.includes("assistant")) ? "staff" : "physician",
    meetingPreference: "mixed",
    responseLatencyHours: Math.round(avgLatency),
    contentDepthPreference: emails.some((e) => e.body.length > 1000) ? "detailed" : "brief",
    workflowComplexityTolerance: hasAttachments > total * 0.5 ? "high" : "medium",
    priorAutomationAdoption: Math.min(1, hasAttachments / total),
  };
}

function classifyFromSignals(s: PhysicianModel["interactionSignals"]): PhysicianAdaptationState {
  if (s.priorAutomationAdoption > 0.7 && s.digitalResponsiveness > 0.7) return "automation_proficient";
  if (s.priorAutomationAdoption > 0.5) return "automation_curious";
  if (s.digitalResponsiveness < 0.3) return "automation_resistant";
  if (s.staffDelegationPattern === "staff") return "administrative_delegation_dominant";
  if (s.responseLatencyHours < 6) return "time_compressed";
  if (s.contentDepthPreference === "detailed") return "evidence_intensive";
  return "human_relationship_dominant";
}

function getApproachForState(state: PhysicianAdaptationState): string {
  const approaches: Record<PhysicianAdaptationState, string> = {
    automation_resistant: "Emphasize concise human communication, familiar terminology, and direct practical value",
    automation_tolerant: "Gradually introduce structured workflows alongside conventional communication",
    automation_curious: "Present workflow automation opportunities with clear efficiency benefits",
    automation_proficient: "Communicate through structured workflow models, automation opportunities, and interoperable data",
    llm_aware: "Engage with system architecture and measurable process improvements",
    system_building: "Offer workflow intelligence and system design collaboration",
    human_relationship_dominant: "Prioritize personal relationship building with minimal interface complexity",
    administrative_delegation_dominant: "Target administrative staff first with workflow tools",
    evidence_intensive: "Provide detailed evidence, data, and clinical workflow maps",
    time_compressed: "Use ultra-concise communications with immediate practical value",
    technically_sophisticated_conservative: "Present technical sophistication with operational caution",
  };
  return approaches[state] || "Adapt communication to observed physician preferences";
}

// ─── Palindromic Learning Updates ───────────────────────────────────

/**
 * Run the palindromic learning update after an experiment completes.
 * Forward pass: did the action improve the outcome? For whom? Can it repeat?
 * Reverse pass: what assumption generated this? What alternative explains it?
 */
export async function runPalindromeUpdate(
  outcomeId: string,
): Promise<{ update: PalindromeUpdate; llmUsed: boolean; llmError?: string }> {
  const outcomes = loadHypothesisOutcomes();
  const outcome = outcomes.find((o) => o.id === outcomeId);
  if (!outcome) throw new Error(`Outcome ${outcomeId} not found`);

  const hypotheses = loadHypotheses();
  const hypothesis = hypotheses.find((h) => h.id === outcome.hypothesisId);
  if (!hypothesis) throw new Error(`Hypothesis not found for outcome`);

  const metricsStr = outcome.metrics.map((m) =>
    `${m.metric}: ${m.value} (baseline ${m.baseline}, ${m.higherIsBetter ? "higher better" : "lower better"})`,
  ).join("; ");

  // LLM: Forward + Reverse analysis in a single call
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are the palindromic learning engine for SPINOR-RL.
Run BOTH a forward and reverse learning pass on the experiment outcome.

FORWARD pass asks: Did the action improve the outcome? For whom? Under what conditions? Can it be repeated? Can it become a system?
REVERSE pass asks: What assumption generated this hypothesis? Was the evidence interpreted correctly? What alternative mechanism explains the result? Where should the strategy fail? Which earlier decision should be revised? What new research question has been created?

Return ONLY valid JSON:
{
  "forward": {
    "improvedOutcome": true/false,
    "forWhom": "Who benefited",
    "conditions": "Under what conditions",
    "repeatable": true/false,
    "canBecomeSystem": true/false,
    "analysis": "2-3 sentence forward analysis"
  },
  "reverse": {
    "assumptionGenerated": "The original assumption",
    "evidenceInterpretedCorrectly": true/false,
    "alternativeMechanism": "Alternative explanation",
    "whereShouldFail": "Where this should fail",
    "earlierDecisionToRevise": "What to revise",
    "newResearchQuestion": "New question created",
    "analysis": "2-3 sentence reverse analysis"
  },
  "nextHypothesis": "The next hypothesis to test based on this learning"
}`,
    },
    {
      role: "user",
      content: `Hypothesis: "${hypothesis.claim}"
Outcome: ${outcome.outcomeDescription}
Falsified: ${outcome.falsified}
Success kind: ${outcome.successKind}
Metrics: ${metricsStr}
Primary uncertainty: ${hypothesis.primaryUncertainty}
Expected value: ${hypothesis.expectedValue}

Run the palindromic learning update.`,
    },
  ];

  const llm = await callLLM(messages, { temperature: 0.3, maxTokens: 2048 });
  let llmUsed = false;
  let llmError: string | undefined;
  let llmData: any = null;

  if (llm.used) {
    llmData = extractJSON(llm.content);
    if (llmData) llmUsed = true;
    else llmError = "LLM returned unparseable JSON";
  } else {
    llmError = llm.error;
  }

  // Deterministic fallback
  const improved = !outcome.falsified;
  const forward = {
    improvedOutcome: llmData?.forward?.improvedOutcome ?? improved,
    forWhom: llmData?.forward?.forWhom || `Employee ${outcome.employeeId} in target population`,
    conditions: llmData?.forward?.conditions || hypothesis.targetCondition,
    repeatable: llmData?.forward?.repeatable ?? false,
    canBecomeSystem: llmData?.forward?.canBecomeSystem ?? (improved && outcome.successKind === "system"),
    llmAnalysis: llmData?.forward?.analysis || (improved ? "Outcome improved; needs replication before systematization." : "Outcome did not improve; falsification is valuable information."),
    llmUsed,
  };
  const reverse = {
    assumptionGenerated: llmData?.reverse?.assumptionGenerated || hypothesis.claim,
    evidenceInterpretedCorrectly: llmData?.reverse?.evidenceInterpretedCorrectly ?? true,
    alternativeMechanism: llmData?.reverse?.alternativeMechanism || "Territory or timing differences may explain the result",
    whereShouldFail: llmData?.reverse?.whereShouldFail || `Should fail in populations where ${hypothesis.targetCondition} does not hold`,
    earlierDecisionToRevise: llmData?.reverse?.earlierDecisionToRevise || "Consider whether the hypothesis was too broad",
    newResearchQuestion: llmData?.reverse?.newResearchQuestion || `Does the mechanism hold when the intervention is delivered through a different channel?`,
    llmAnalysis: llmData?.reverse?.analysis || "Reverse analysis: the original assumption should be tested with a control population.",
    llmUsed,
  };

  const update: PalindromeUpdate = {
    id: `palindrome_${nanoid(8)}`,
    outcomeId,
    hypothesisId: hypothesis.id,
    employeeId: outcome.employeeId,
    forward,
    reverse,
    learningRecord: {
      priorBelief: hypothesis.claim,
      selectedHypothesis: hypothesis.intervention,
      executedAction: outcome.outcomeDescription,
      observedResult: outcome.falsified ? "Falsified" : outcome.successKind,
      inferredMechanism: forward.llmAnalysis,
      uncertaintyUpdate: reverse.newResearchQuestion,
      rewardUpdate: improved ? "Positive reward for validated outcome" : "Positive reward for useful falsification",
      policyUpdate: forward.canBecomeSystem ? "Promote to system candidate" : "Continue exploration",
      nextHypothesis: llmData?.nextHypothesis || reverse.newResearchQuestion,
    },
    createdAt: now(),
  };

  const updates = loadPalindromeUpdates();
  updates.push(update);
  savePalindromeUpdates(updates);

  return { update, llmUsed, llmError };
}

// ─── RL Allocation Engine ───────────────────────────────────────────

/**
 * Build the RL agent state for an employee from their history.
 */
export function buildRLAgentState(employeeId: string): RLAgentState {
  const outcomes = loadHypothesisOutcomes().filter((o) => o.employeeId === employeeId);
  const derivatives = loadDerivatives().filter((d) => d.proposedByEmployeeId === employeeId);
  const missions = loadMissions().filter((m) => m.employeeId === employeeId);

  const employee = SEED_EMPLOYEES.find((e) => e.id === employeeId);

  return {
    employeeId,
    capabilityProfile: {
      executionQuality: Math.min(1, outcomes.length * 0.1),
      creativity: Math.min(1, derivatives.length * 0.15),
      reliability: outcomes.length > 0 ? outcomes.filter((o) => !o.falsified).length / outcomes.length : 0.5,
      exploration: Math.min(1, missions.filter((m) => m.missionClass === "scout" || m.missionClass === "mutation").length * 0.1),
      replication: Math.min(1, missions.filter((m) => m.missionClass === "replication").length * 0.2),
    },
    recentEffort: missions.filter((m) => Date.now() - new Date(m.createdAt).getTime() < 7 * 86400000).length,
    historicalPerformance: outcomes.filter((o) => !o.falsified).length,
    researchQuality: Math.min(1, outcomes.length * 0.05),
    priorHypothesisExposure: outcomes.map((o) => o.hypothesisId),
    experimentNovelty: derivatives.length > 0 ? 0.7 : 0.3,
    operationalWorkload: missions.filter((m) => m.state === "executing").length,
    confidenceInEvidence: outcomes.length > 0
      ? outcomes.reduce((s, o) => s + (o.falsified ? 0.3 : 0.7), 0) / outcomes.length
      : 0.3,
    unresolvedQuestions: missions.filter((m) => m.state !== "completed").map((m) => m.title).slice(0, 5),
  };
}

/**
 * Compute the RL reward for an outcome using the full reward function.
 */
export function computeRLReward(outcome: HypothesisOutcome): RLReward {
  const validatedOutcomeValue = outcome.falsified ? 0 : 1;
  const evidenceQuality = outcome.metrics.length > 0 ? 0.7 : 0.3;
  const causalConfidence = outcome.attributionId ? 0.7 : 0.3;
  const novelty = outcome.successKind === "discovery" ? 0.8 : 0.4;
  const reproducibility = 0.3; // starts low, increases with replication
  const usefulFailure = outcome.falsified ? 0.6 : 0;
  const processImprovement = outcome.successKind === "efficiency" || outcome.successKind === "system" ? 0.7 : 0;
  const knowledgeTransferred = 0.3;
  const systemCreated = outcome.successKind === "system" || outcome.successKind === "channel" ? 0.8 : 0;

  const complianceRisk = 0;
  const customerHarm = 0;
  const evidenceContamination = 0;
  const metricManipulation = 0;
  const redundantExperimentation = 0;

  const positives = validatedOutcomeValue + evidenceQuality + causalConfidence + novelty +
    reproducibility + usefulFailure + processImprovement + knowledgeTransferred + systemCreated;
  const negatives = complianceRisk + customerHarm + evidenceContamination + metricManipulation + redundantExperimentation;

  return {
    validatedOutcomeValue,
    evidenceQuality,
    causalConfidence,
    novelty,
    reproducibility,
    usefulFailure,
    processImprovement,
    knowledgeTransferred,
    systemCreated,
    complianceRisk,
    customerHarm,
    evidenceContamination,
    metricManipulation,
    redundantExperimentation,
    total: Math.round((positives - negatives) * 100) / 100,
  };
}

/**
 * Select the best RL action for an employee based on their state.
 * This is the contextual multi-agent bandit.
 */
export function selectRLAction(employeeId: string): { action: RLAction; rationale: string } {
  const state = buildRLAgentState(employeeId);
  const outcomes = loadHypothesisOutcomes().filter((o) => o.employeeId === employeeId);
  const missions = loadMissions().filter((m) => m.employeeId === employeeId);

  // Exploitation: employee has good results → give harder hypotheses
  if (state.historicalPerformance > 3 && state.confidenceInEvidence > 0.6) {
    return {
      action: "increase_difficulty",
      rationale: `Employee has ${state.historicalPerformance} successful outcomes with ${(state.confidenceInEvidence * 100).toFixed(0)}% confidence — increase difficulty for higher-upside hypotheses`,
    };
  }

  // Exploration: employee has high effort but low outcomes → give high-upside hypotheses
  if (state.recentEffort > 3 && state.historicalPerformance < 2) {
    return {
      action: "assign_hypothesis",
      rationale: `High effort (${state.recentEffort} recent missions) but low outcomes (${state.historicalPerformance}) — assign a high-upside hypothesis to test capability match`,
    };
  }

  // Recovery: employee has low effort and low outcomes → investigate
  if (state.recentEffort < 2 && state.historicalPerformance < 1) {
    return {
      action: "pair_with_collaborator",
      rationale: `Low effort and low outcomes — pair with a collaborator to investigate capability mismatch`,
    };
  }

  // Creativity: employee has derivatives → request more
  if (state.capabilityProfile.creativity > 0.3) {
    return {
      action: "request_derivative",
      rationale: `Employee shows creativity (${(state.capabilityProfile.creativity * 100).toFixed(0)}%) — request derivative experiments`,
    };
  }

  // Default: assign hypothesis
  return {
    action: "assign_hypothesis",
    rationale: `Standard allocation based on current state`,
  };
}

// ─── Email Sensor ───────────────────────────────────────────────────

/**
 * Extract competitive signals from email using LLM.
 * Email is not merely communication — it's a behavioral evidence stream.
 */
export async function extractEmailSignals(
  email: EmailMessage,
  employeeId: string,
): Promise<{ signal: EmailSignal; llmUsed: boolean; llmError?: string }> {
  const bodyPreview = (email.body || email.bodyPreview || "").slice(0, 2000);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are the email competitive sensor for SPINOR-RL.
Extract behavioral evidence from this email. Email is not merely communication — it is a behavioral evidence stream.
Return ONLY valid JSON:
{
  "commitments": ["commitment1", "commitment2"],
  "objections": ["objection1"],
  "unansweredQuestions": ["question1"],
  "timingPatterns": "When and how fast they respond",
  "stakeholderRelationships": ["relationship1"],
  "technologyAdoptionSignals": ["signal1"],
  "processBottlenecks": ["bottleneck1"],
  "unresolvedRequests": ["request1"],
  "emergingDemand": ["demand1"],
  "conversionLanguage": ["phrase1"],
  "behavioralDeviations": ["deviation1"],
  "recommendedNextAction": "What this employee should do next",
  "recommendedNextTest": "What this employee should test next",
  "untestedPossibility": "What might work but has never been tested",
  "beliefToChallenge": "What current belief should be challenged",
  "processToAutomate": "Which existing process should become automated",
  "bestEmployeeToInvestigate": "Which employee is best positioned to investigate this uncertainty"
}`,
    },
    {
      role: "user",
      content: `Email from: ${email.sender} <${email.senderEmail}>
Subject: ${email.subject}
Date: ${email.receivedDate}
Is read: ${email.isRead}
Has attachments: ${email.hasAttachments}

Body:
${bodyPreview}

Extract all competitive signals from this email.`,
    },
  ];

  const llm = await callLLM(messages, { temperature: 0.3, maxTokens: 2048 });
  let llmUsed = false;
  let llmError: string | undefined;
  let llmData: any = null;

  if (llm.used) {
    llmData = extractJSON(llm.content);
    if (llmData) llmUsed = true;
    else llmError = "LLM returned unparseable JSON";
  } else {
    llmError = llm.error;
  }

  const signal: EmailSignal = {
    id: `signal_${nanoid(8)}`,
    emailId: email.id,
    employeeId,
    commitments: llmData?.commitments || [],
    objections: llmData?.objections || [],
    unansweredQuestions: llmData?.unansweredQuestions || [],
    timingPatterns: llmData?.timingPatterns || `Response received at ${email.receivedDate}`,
    stakeholderRelationships: llmData?.stakeholderRelationships || [email.sender],
    technologyAdoptionSignals: llmData?.technologyAdoptionSignals || [],
    processBottlenecks: llmData?.processBottlenecks || [],
    unresolvedRequests: llmData?.unresolvedRequests || [],
    emergingDemand: llmData?.emergingDemand || [],
    conversionLanguage: llmData?.conversionLanguage || [],
    behavioralDeviations: llmData?.behavioralDeviations || [],
    recommendedNextAction: llmData?.recommendedNextAction || "Review email and determine next action",
    recommendedNextTest: llmData?.recommendedNextTest || "Test whether response timing correlates with engagement quality",
    untestedPossibility: llmData?.untestedPossibility || "Whether a different communication channel would improve response rate",
    beliefToChallenge: llmData?.beliefToChallenge || "The assumption that current communication frequency is optimal",
    processToAutomate: llmData?.processToAutomate || "Email triage and response prioritization",
    bestEmployeeToInvestigate: llmData?.bestEmployeeToInvestigate || employeeId,
    llmUsed,
    extractedAt: now(),
  };

  const signals = loadEmailSignals();
  signals.push(signal);
  saveEmailSignals(signals);

  return { signal, llmUsed, llmError };
}

// ─── Anti-Stagnation Protocol ───────────────────────────────────────

/**
 * Detect repetitive tasks and recommend transformation.
 * Every repeated task is inspected for: automate, eliminate, experiment, promote.
 */
export async function detectStagnation(
  employeeId: string,
  taskDescription: string,
  repetitionCount: number,
): Promise<{ flag: StagnationFlag; llmUsed: boolean; llmError?: string }> {
  const predictability = Math.min(1, repetitionCount / 20);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are the anti-stagnation engine for SPINOR-RL.
A task has been repeated ${repetitionCount} times. Determine whether it should be:
- AUTOMATED: sufficiently predictable that machines can inherit it
- ELIMINATED: no longer necessary
- EXPERIMENTED ON: uncertainty remains, test variations
- PROMOTED TO SYSTEM: validated enough to become a standard process

Return ONLY valid JSON:
{
  "transformation": "automate" | "eliminate" | "experiment" | "promote_to_system",
  "rationale": "Why this transformation",
  "automationPlan": "If automate, how to automate it. If not, what to do instead."
}`,
    },
    {
      role: "user",
      content: `Task: ${taskDescription}
Repetition count: ${repetitionCount}
Predictability score: ${(predictability * 100).toFixed(0)}%
Employee: ${employeeId}

Determine the anti-stagnation transformation.`,
    },
  ];

  const llm = await callLLM(messages, { temperature: 0.3, maxTokens: 1024 });
  let llmUsed = false;
  let llmError: string | undefined;
  let llmData: any = null;

  if (llm.used) {
    llmData = extractJSON(llm.content);
    if (llmData) llmUsed = true;
    else llmError = "LLM returned unparseable JSON";
  } else {
    llmError = llm.error;
  }

  // Deterministic fallback: high predictability → automate, medium → experiment, low → keep
  let transformation: StagnationTransformation = "experiment";
  if (predictability > 0.8) transformation = "automate";
  else if (predictability > 0.6) transformation = "promote_to_system";
  else if (predictability < 0.3) transformation = "experiment";

  const flag: StagnationFlag = {
    id: `stagnation_${nanoid(8)}`,
    taskDescription,
    employeeId,
    repetitionCount,
    predictabilityScore: predictability,
    recommendedTransformation: (llmData?.transformation as StagnationTransformation) || transformation,
    rationale: llmData?.rationale || `Task repeated ${repetitionCount} times with ${(predictability * 100).toFixed(0)}% predictability`,
    automationPlan: llmData?.automationPlan || (transformation === "automate" ? "Build automated pipeline for this task" : "Continue human execution with experimental variations"),
    llmUsed,
    detectedAt: now(),
  };

  const flags = loadStagnationFlags();
  flags.push(flag);
  saveStagnationFlags(flags);

  return { flag, llmUsed, llmError };
}

// ─── Sprouting Engine ───────────────────────────────────────────────

/**
 * Sprout a derivative from a parent hypothesis.
 * The employee earns research credit for useful descendants.
 */
export async function sproutDerivative(
  hypothesisId: string,
  employeeId: string,
  modifiedDimension: string,
  parentSproutId?: string,
): Promise<{ sprout: SproutNode; llmUsed: boolean; llmError?: string }> {
  const hypotheses = loadHypotheses();
  const parent = hypotheses.find((h) => h.id === hypothesisId);
  if (!parent) throw new Error(`Hypothesis ${hypothesisId} not found`);

  const sprouts = loadSproutTree();
  const parentSprout = parentSproutId ? sprouts.find((s) => s.id === parentSproutId) : undefined;
  const depth = parentSprout ? parentSprout.depth + 1 : 0;

  // LLM: generate the derivative claim
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a sprouting engine for SPINOR-RL. Generate a derivative hypothesis by varying exactly one dimension.
Return ONLY valid JSON:
{
  "claim": "The derivative hypothesis statement",
  "rationale": "Why this variation is worth testing"
}`,
    },
    {
      role: "user",
      content: `Parent hypothesis: "${parentSprout?.claim || parent.claim}"
Modified dimension: ${modifiedDimension}
Depth: ${depth}

Generate a derivative that varies the "${modifiedDimension}" dimension.`,
    },
  ];

  const llm = await callLLM(messages, { temperature: 0.5, maxTokens: 1024 });
  let llmUsed = false;
  let llmError: string | undefined;
  let llmData: any = null;

  if (llm.used) {
    llmData = extractJSON(llm.content);
    if (llmData) llmUsed = true;
    else llmError = "LLM returned unparseable JSON";
  } else {
    llmError = llm.error;
  }

  const sprout: SproutNode = {
    id: `sprout_${nanoid(8)}`,
    hypothesisId,
    parentSproutId,
    employeeId,
    claim: llmData?.claim || `${parentSprout?.claim || parent.claim} (varying ${modifiedDimension})`,
    modifiedDimension,
    status: "proposed",
    depth,
    childrenIds: [],
    creditEmployeeId: employeeId,
    createdAt: now(),
  };

  // Update parent's children
  if (parentSproutId) {
    const parentIdx = sprouts.findIndex((s) => s.id === parentSproutId);
    if (parentIdx >= 0) {
      sprouts[parentIdx].childrenIds.push(sprout.id);
    }
  }

  sprouts.push(sprout);
  saveSproutTree(sprouts);

  return { sprout, llmUsed, llmError };
}

/** Get the full sprout tree for a hypothesis. */
export function getSproutTree(hypothesisId: string): SproutNode[] {
  return loadSproutTree().filter((s) => s.hypothesisId === hypothesisId);
}

// ─── Staged Diffusion ───────────────────────────────────────────────

/**
 * Advance a discovery through staged diffusion.
 * Prevents premature standardization by controlling the diffusion process.
 */
export function advanceDiffusion(hypothesisId: string): DiffusionState {
  const states = loadDiffusionStates();
  const existing = states.find((d) => d.hypothesisId === hypothesisId);

  const stages: DiffusionStage[] = [
    "discovery", "internal_replication", "mechanism_isolation",
    "segment_testing", "adversarial_challenge", "controlled_diffusion",
    "operational_standard", "continuous_retesting",
  ];

  const currentStageIdx = existing ? stages.indexOf(existing.stage) : 0;
  const nextStage = stages[Math.min(currentStageIdx + 1, stages.length - 1)];

  const state: DiffusionState = {
    hypothesisId,
    stage: nextStage,
    replicatingEmployees: existing?.replicatingEmployees || [],
    mutatingEmployees: existing?.mutatingEmployees || [],
    falsifyingEmployees: existing?.falsifyingEmployees || [],
    failureTestEmployees: existing?.failureTestEmployees || [],
    standardAdoptedAt: nextStage === "operational_standard" ? now() : existing?.standardAdoptedAt,
    lastRetestAt: now(),
    llmUsed: false,
    updatedAt: now(),
  };

  const idx = states.findIndex((d) => d.hypothesisId === hypothesisId);
  if (idx >= 0) states[idx] = state;
  else states.push(state);
  saveDiffusionStates(states);

  return state;
}

// ─── Anti-Gaming Controls ───────────────────────────────────────────

/**
 * Run anti-gaming checks on an experiment.
 * Separates activity from effort, effort from evidence, evidence from causality.
 */
export function runAntiGamingCheck(
  experimentId: string,
  employeeId: string,
  outcome: HypothesisOutcome,
): AntiGamingCheck {
  const check: AntiGamingCheck = {
    id: `agc_${nanoid(8)}`,
    experimentId,
    employeeId,
    preRegisteredConditions: true,
    controlPopulationUsed: outcome.metrics.some((m) => m.baseline > 0),
    holdoutTestingUsed: false,
    randomizedAssignment: false,
    outcomeDelayWindow: 7,
    evidenceProvenance: outcome.outcomeDescription.slice(0, 200),
    anomalyDetected: false,
    duplicateExperiment: false,
    selectiveReportingPenalty: outcome.falsified ? 0 : 0.1,
    negativeFindingReported: outcome.falsified,
    passed: true,
    checkedAt: now(),
  };

  // Flag if no control population
  if (!check.controlPopulationUsed) {
    check.passed = false;
  }

  // Flag selective reporting (only positive results reported)
  if (!outcome.falsified && outcome.metrics.length === 0) {
    check.selectiveReportingPenalty = 0.3;
  }

  const checks = loadAntiGamingChecks();
  checks.push(check);
  saveAntiGamingChecks(checks);

  return check;
}

// ─── Full State Snapshot ────────────────────────────────────────────

export function getSpinorRLState() {
  return {
    missions: loadMissions(),
    physicians: loadPhysicians(),
    palindromeUpdates: loadPalindromeUpdates(),
    rlAgentStates: loadRLAgentStates(),
    rlRewards: loadRLRewards(),
    emailSignals: loadEmailSignals(),
    stagnationFlags: loadStagnationFlags(),
    sproutTree: loadSproutTree(),
    diffusionStates: loadDiffusionStates(),
    antiGamingChecks: loadAntiGamingChecks(),
  };
}
