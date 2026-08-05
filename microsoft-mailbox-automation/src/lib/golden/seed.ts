import { nanoid } from "nanoid";
import {
  HypothesisAnatomy,
  PriorArtRecord,
  AccountInteractionSignal,
  EngagementMode,
  RoleType,
  ResearchReliability,
  ResearchReliabilityLevel,
} from "@/types";
import {
  loadHypotheses,
  saveHypotheses,
  loadPriorArt,
  savePriorArt,
  loadResearchReliability,
  saveResearchReliability,
} from "@/lib/config";
import { researchHypothesis, buildHypothesisFromPriorArt } from "./prior-art";
import { checkHypothesis } from "./compliance";

const now = () => new Date().toISOString();

// ─── Seed employees ────────────────────────────────────────────────

export interface GoldenEmployee {
  id: string;
  name: string;
  role: RoleType;
  territory: string;
  reliabilityLevel: ResearchReliabilityLevel;
}

export const SEED_EMPLOYEES: GoldenEmployee[] = [
  { id: "emp-001", name: "Joseph Skrobynets", role: "field_representative", territory: "North Chicago", reliabilityLevel: "process_builder" },
  { id: "emp-002", name: "Maria Alvarez", role: "field_representative", territory: "South Chicago", reliabilityLevel: "hypothesis_modifier" },
  { id: "emp-003", name: "David Chen", role: "field_representative", territory: "Indianapolis", reliabilityLevel: "reliable_tester" },
  { id: "emp-004", name: "Sarah Okafor", role: "regional_manager", territory: "Midwest", reliabilityLevel: "strategy_architect" },
  { id: "emp-005", name: "Liam Walsh", role: "medical_affairs", territory: "Central", reliabilityLevel: "replicator" },
];

// ─── Seed accounts with observed interaction signals ───────────────

export interface GoldenAccount {
  id: string;
  name: string;
  territory: string;
  signal: AccountInteractionSignal;
  engagementMode: EngagementMode;
}

export const SEED_ACCOUNTS: GoldenAccount[] = [
  {
    id: "acct-001",
    name: "Lakeshore Cardiology",
    territory: "North Chicago",
    engagementMode: "system_oriented",
    signal: {
      digitalResponsiveness: 0.85,
      preferredChannel: "portal",
      selfServiceCompletion: 0.8,
      staffDelegationPattern: "staff",
      meetingPreference: "async",
      responseLatencyHours: 6,
      contentDepthPreference: "moderate",
      workflowComplexityTolerance: "high",
      priorAutomationAdoption: 0.7,
    },
  },
  {
    id: "acct-002",
    name: "Mercy Internal Medicine",
    territory: "North Chicago",
    engagementMode: "hybrid",
    signal: {
      digitalResponsiveness: 0.55,
      preferredChannel: "email",
      selfServiceCompletion: 0.5,
      staffDelegationPattern: "mixed",
      meetingPreference: "mixed",
      responseLatencyHours: 24,
      contentDepthPreference: "moderate",
      workflowComplexityTolerance: "medium",
      priorAutomationAdoption: 0.4,
    },
  },
  {
    id: "acct-003",
    name: "Riverside Family Practice",
    territory: "South Chicago",
    engagementMode: "human_guided",
    signal: {
      digitalResponsiveness: 0.2,
      preferredChannel: "in_person",
      selfServiceCompletion: 0.1,
      staffDelegationPattern: "physician",
      meetingPreference: "in_person",
      responseLatencyHours: 72,
      contentDepthPreference: "brief",
      workflowComplexityTolerance: "low",
      priorAutomationAdoption: 0.1,
    },
  },
  {
    id: "acct-004",
    name: "Summit Oncology Group",
    territory: "Indianapolis",
    engagementMode: "system_oriented",
    signal: {
      digitalResponsiveness: 0.9,
      preferredChannel: "portal",
      selfServiceCompletion: 0.85,
      staffDelegationPattern: "staff",
      meetingPreference: "virtual",
      responseLatencyHours: 4,
      contentDepthPreference: "detailed",
      workflowComplexityTolerance: "high",
      priorAutomationAdoption: 0.8,
    },
  },
  {
    id: "acct-005",
    name: "Westend Pediatrics",
    territory: "South Chicago",
    engagementMode: "hybrid",
    signal: {
      digitalResponsiveness: 0.6,
      preferredChannel: "phone",
      selfServiceCompletion: 0.45,
      staffDelegationPattern: "mixed",
      meetingPreference: "mixed",
      responseLatencyHours: 18,
      contentDepthPreference: "brief",
      workflowComplexityTolerance: "medium",
      priorAutomationAdoption: 0.35,
    },
  },
  {
    id: "acct-006",
    name: "Capital Neurology",
    territory: "Indianapolis",
    engagementMode: "human_guided",
    signal: {
      digitalResponsiveness: 0.25,
      preferredChannel: "in_person",
      selfServiceCompletion: 0.15,
      staffDelegationPattern: "physician",
      meetingPreference: "in_person",
      responseLatencyHours: 60,
      contentDepthPreference: "detailed",
      workflowComplexityTolerance: "low",
      priorAutomationAdoption: 0.1,
    },
  },
];

/** Derive an adaptive engagement mode from observed signals (never from stereotypes). */
export function deriveEngagementMode(signal: AccountInteractionSignal): EngagementMode {
  const digitalScore =
    signal.digitalResponsiveness * 0.4 +
    signal.selfServiceCompletion * 0.3 +
    signal.priorAutomationAdoption * 0.3;
  if (digitalScore >= 0.6 && signal.staffDelegationPattern !== "physician") {
    return "system_oriented";
  }
  if (digitalScore <= 0.3 && signal.meetingPreference === "in_person") {
    return "human_guided";
  }
  if (signal.staffDelegationPattern === "mixed" || signal.meetingPreference === "mixed") {
    return "hybrid";
  }
  return digitalScore >= 0.45 ? "hybrid" : "human_guided";
}

// ─── Seed prior-art + hypotheses ───────────────────────────────────

interface SeedHypothesisSpec {
  claim: string;
  priorArt: {
    testedInMarket: boolean;
    testedInAdjacentIndustries: boolean;
    adjacentSupportSummary: string;
    sourceDomains: string[];
    responsibleComponent: string | null;
    requiredConditions: string[];
    risksAndConfounders: string[];
    genuinelyUnknown: string[];
  };
  anatomy: {
    targetCondition: string;
    intervention: string;
    control: string;
    primaryOutcome: string;
    secondaryOutcomes: string[];
    knownConfounders: string[];
    complianceBoundary: string;
    expectedValue: string;
    primaryUncertainty: string;
    novelComponent: string | null;
    fixedConstraints: string[];
    modifiableDimensions: HypothesisAnatomy["modifiableDimensions"];
    targetEngagementModes: EngagementMode[];
  };
}

const SEED_SPECS: SeedHypothesisSpec[] = [
  {
    claim:
      "Digitally engaged physicians may prefer configurable, asynchronous follow-up systems over repeated scheduled contact.",
    priorArt: {
      testedInMarket: false,
      testedInAdjacentIndustries: true,
      adjacentSupportSummary: "Supported in enterprise software onboarding and professional education.",
      sourceDomains: ["Enterprise onboarding", "Professional education", "Digital health engagement"],
      responsibleComponent: "Self-service workflow with staff ownership",
      requiredConditions: ["High digital responsiveness", "Staff able to operate portal", "No unresolved medical-information request"],
      risksAndConfounders: ["Existing relationship strength", "Practice size", "Digital infrastructure", "Staff involvement"],
      genuinelyUnknown: ["Whether physicians will actually use the self-service system in pharma field execution"],
    },
    anatomy: {
      targetCondition: "Accounts showing strong digital interaction behavior",
      intervention: "Offer an approved self-service information and workflow pathway",
      control: "Standard representative-led follow-up",
      primaryOutcome: "Meaningful account progression",
      secondaryOutcomes: ["Time saved", "Response rate", "Workflow completion", "Representative effort", "Account satisfaction"],
      knownConfounders: ["Existing relationship strength", "Practice size", "Digital infrastructure", "Staff involvement"],
      complianceBoundary: "Approved information and workflows only",
      expectedValue: "Potential reduction in representative follow-up time",
      primaryUncertainty: "Whether physicians will actually use the self-service system",
      novelComponent: "Allow the account to configure its own approved follow-up pathway",
      fixedConstraints: ["Approved information", "Eligibility rules", "Contact limits"],
      modifiableDimensions: ["stakeholder", "timing", "channel", "content_sequence", "automation_step", "followup_interval"],
      targetEngagementModes: ["system_oriented", "hybrid"],
    },
  },
  {
    claim:
      "Office-manager-first outreach improves workflow resolution for digitally responsive accounts.",
    priorArt: {
      testedInMarket: true,
      testedInAdjacentIndustries: true,
      adjacentSupportSummary: "Mixed support; staff-gatekeeper models work in enterprise SaaS.",
      sourceDomains: ["Enterprise SaaS onboarding", "Practice management"],
      responsibleComponent: "Staff-gatekeeper sequencing",
      requiredConditions: ["Office manager present", "Digital responsiveness", "Staff delegation pattern"],
      risksAndConfounders: ["Office manager authority variance", "Turnover", "Practice size"],
      genuinelyUnknown: [],
    },
    anatomy: {
      targetCondition: "Accounts with an active office manager and digital responsiveness",
      intervention: "Route initial outreach through the office manager before physician contact",
      control: "Physician-first outreach",
      primaryOutcome: "Workflow resolution rate",
      secondaryOutcomes: ["Time to resolution", "Physician touchpoints avoided", "Account satisfaction"],
      knownConfounders: ["Office manager authority variance", "Turnover", "Practice size"],
      complianceBoundary: "Approved information and workflows only; no clinical-judgment manipulation",
      expectedValue: "Higher workflow resolution with fewer physician interruptions",
      primaryUncertainty: "Whether office manager authority is sufficient across account structures",
      novelComponent: null,
      fixedConstraints: ["Approved information", "Contact limits"],
      modifiableDimensions: ["stakeholder", "timing", "followup_interval"],
      targetEngagementModes: ["system_oriented", "hybrid"],
    },
  },
  {
    claim:
      "A short self-service workflow outperforms a comprehensive workflow for first-time digital accounts.",
    priorArt: {
      testedInMarket: false,
      testedInAdjacentIndustries: true,
      adjacentSupportSummary: "Progressive disclosure outperforms comprehensive forms in consumer onboarding.",
      sourceDomains: ["Consumer onboarding", "UX research"],
      responsibleComponent: "Workflow length / progressive disclosure",
      requiredConditions: ["First-time digital account", "No prior self-service adoption"],
      risksAndConfounders: ["Account maturity", "Content depth preference"],
      genuinelyUnknown: ["Optimal step count for pharma access workflows"],
    },
    anatomy: {
      targetCondition: "First-time digital accounts with no prior self-service adoption",
      intervention: "Three-step approved self-service workflow",
      control: "Comprehensive single-form workflow",
      primaryOutcome: "Workflow completion rate",
      secondaryOutcomes: ["Time to completion", "Drop-off step", "Account satisfaction"],
      knownConfounders: ["Account maturity", "Content depth preference"],
      complianceBoundary: "Approved information and workflows only",
      expectedValue: "Higher completion rate with lower cognitive load",
      primaryUncertainty: "Optimal step count for pharma access workflows",
      novelComponent: "Three-step progressive disclosure sequence for access workflows",
      fixedConstraints: ["Approved information", "Eligibility rules"],
      modifiableDimensions: ["content_sequence", "automation_step", "followup_interval"],
      targetEngagementModes: ["system_oriented", "hybrid"],
    },
  },
  {
    claim:
      "Automated reminders improve self-service workflow completion for digitally responsive accounts.",
    priorArt: {
      testedInMarket: false,
      testedInAdjacentIndustries: true,
      adjacentSupportSummary: "Supported in patient-portal engagement studies.",
      sourceDomains: ["Patient portal engagement", "Behavioral nudges"],
      responsibleComponent: "Reminder cadence",
      requiredConditions: ["Digital responsiveness", "Started but incomplete workflow"],
      risksAndConfounders: ["Reminder fatigue", "Trust erosion"],
      genuinelyUnknown: ["Whether reminders reduce trust in pharma field execution context"],
    },
    anatomy: {
      targetCondition: "Accounts that opened but did not complete a self-service workflow",
      intervention: "One automated reminder 48 hours after workflow start",
      control: "No reminder",
      primaryOutcome: "Workflow completion rate",
      secondaryOutcomes: ["Time to completion", "Opt-out rate", "Account satisfaction"],
      knownConfounders: ["Reminder fatigue", "Trust erosion", "Channel preference"],
      complianceBoundary: "Approved information and workflows only; respect opt-out and contact limits",
      expectedValue: "Higher completion rate",
      primaryUncertainty: "Whether reminders reduce trust in this context",
      novelComponent: null,
      fixedConstraints: ["Approved information", "Contact limits", "Opt-out rules"],
      modifiableDimensions: ["timing", "channel", "followup_interval"],
      targetEngagementModes: ["system_oriented"],
    },
  },
  {
    claim:
      "Human-guided accounts convert better when technology runs behind the scenes while preserving a personal face.",
    priorArt: {
      testedInMarket: true,
      testedInAdjacentIndustries: false,
      adjacentSupportSummary: "Not tested in adjacent industries; in-market observed association only.",
      sourceDomains: ["Field execution observation"],
      responsibleComponent: "Hybrid human-front / tech-back model",
      requiredConditions: ["Human-guided account", "Representative available for personal follow-up"],
      risksAndConfounders: ["Representative availability", "Account relationship strength"],
      genuinelyUnknown: ["Whether the tech-back component is the active ingredient"],
    },
    anatomy: {
      targetCondition: "Human-guided accounts preferring personal interaction",
      intervention: "Representative-led contact with automated preparation and follow-up behind the scenes",
      control: "Pure representative-led contact without automation support",
      primaryOutcome: "Account progression",
      secondaryOutcomes: ["Representative time used", "Preparation completeness", "Follow-up latency"],
      knownConfounders: ["Representative availability", "Account relationship strength"],
      complianceBoundary: "Approved information and workflows only; human-facing experience preserved",
      expectedValue: "Same or better progression with less representative effort",
      primaryUncertainty: "Whether the tech-back component is the active ingredient",
      novelComponent: "Automation in the operational layer behind a human front",
      fixedConstraints: ["Approved information", "Human-facing experience preserved"],
      modifiableDimensions: ["automation_step", "timing", "followup_interval"],
      targetEngagementModes: ["human_guided", "hybrid"],
    },
  },
];

/** Seed the golden store if empty. Returns the seeded hypotheses. */
export function ensureGoldenSeeded(): HypothesisAnatomy[] {
  const existing = loadHypotheses();
  if (existing.length > 0) return existing;

  const hypotheses: HypothesisAnatomy[] = [];
  const priorArt: PriorArtRecord[] = [];

  for (const spec of SEED_SPECS) {
    const pa = researchHypothesis({
      hypothesisClaim: spec.claim,
      testedInMarket: spec.priorArt.testedInMarket,
      testedInAdjacentIndustries: spec.priorArt.testedInAdjacentIndustries,
      adjacentSupportSummary: spec.priorArt.adjacentSupportSummary,
      sourceDomains: spec.priorArt.sourceDomains,
      responsibleComponent: spec.priorArt.responsibleComponent,
      requiredConditions: spec.priorArt.requiredConditions,
      risksAndConfounders: spec.priorArt.risksAndConfounders,
      genuinelyUnknown: spec.priorArt.genuinelyUnknown,
    });
    priorArt.push(pa);
    const { hypothesis, compliance } = buildHypothesisFromPriorArt(pa, {
      claim: spec.claim,
      sourceDomains: spec.priorArt.sourceDomains,
      targetCondition: spec.anatomy.targetCondition,
      intervention: spec.anatomy.intervention,
      control: spec.anatomy.control,
      primaryOutcome: spec.anatomy.primaryOutcome,
      secondaryOutcomes: spec.anatomy.secondaryOutcomes,
      knownConfounders: spec.anatomy.knownConfounders,
      complianceBoundary: spec.anatomy.complianceBoundary,
      expectedValue: spec.anatomy.expectedValue,
      primaryUncertainty: spec.anatomy.primaryUncertainty,
      novelComponent: spec.anatomy.novelComponent,
      fixedConstraints: spec.anatomy.fixedConstraints,
      modifiableDimensions: spec.anatomy.modifiableDimensions,
      targetEngagementModes: spec.anatomy.targetEngagementModes,
    });
    if (!compliance.allowed) {
      // Seed hypotheses must pass compliance; surface as a console warning rather than silently assigning.
      console.warn(`[golden/seed] hypothesis "${spec.claim}" failed compliance: ${compliance.violations.join("; ")}`);
    }
    hypotheses.push(hypothesis);
  }

  saveHypotheses(hypotheses);
  savePriorArt(priorArt);

  // Seed research reliability for each employee.
  const reliability: ResearchReliability[] = SEED_EMPLOYEES.map((e) =>
    seedReliabilityForEmployee(e.id, e.reliabilityLevel)
  );
  saveResearchReliability(reliability);

  return hypotheses;
}

export function seedReliabilityForEmployee(
  employeeId: string,
  level: ResearchReliabilityLevel
): ResearchReliability {
  const base = levelToBaseScores(level);
  return {
    employeeId,
    level,
    executionFidelity: base.executionFidelity,
    evidenceQuality: base.evidenceQuality,
    ethicalJudgment: 0.9,
    usefulOverrides: base.usefulOverrides,
    experimentCompletion: base.experimentCompletion,
    confounderDetection: base.confounderDetection,
    derivativeQuality: base.derivativeQuality,
    collaboration: 0.8,
    updatedAt: now(),
  };
}

function levelToBaseScores(level: ResearchReliabilityLevel): {
  executionFidelity: number;
  evidenceQuality: number;
  usefulOverrides: number;
  experimentCompletion: number;
  confounderDetection: number;
  derivativeQuality: number;
} {
  switch (level) {
    case "participant":
      return { executionFidelity: 0.5, evidenceQuality: 0.4, usefulOverrides: 0, experimentCompletion: 0.5, confounderDetection: 0.3, derivativeQuality: 0.2 };
    case "reliable_tester":
      return { executionFidelity: 0.75, evidenceQuality: 0.7, usefulOverrides: 1, experimentCompletion: 0.8, confounderDetection: 0.6, derivativeQuality: 0.4 };
    case "replicator":
      return { executionFidelity: 0.8, evidenceQuality: 0.8, usefulOverrides: 2, experimentCompletion: 0.85, confounderDetection: 0.7, derivativeQuality: 0.6 };
    case "hypothesis_modifier":
      return { executionFidelity: 0.85, evidenceQuality: 0.85, usefulOverrides: 3, experimentCompletion: 0.9, confounderDetection: 0.8, derivativeQuality: 0.75 };
    case "process_builder":
      return { executionFidelity: 0.9, evidenceQuality: 0.9, usefulOverrides: 4, experimentCompletion: 0.92, confounderDetection: 0.85, derivativeQuality: 0.85 };
    case "strategy_architect":
      return { executionFidelity: 0.92, evidenceQuality: 0.93, usefulOverrides: 5, experimentCompletion: 0.95, confounderDetection: 0.9, derivativeQuality: 0.9 };
    case "golden_node_founder":
      return { executionFidelity: 0.95, evidenceQuality: 0.95, usefulOverrides: 6, experimentCompletion: 0.97, confounderDetection: 0.92, derivativeQuality: 0.95 };
  }
}

export { checkHypothesis };
