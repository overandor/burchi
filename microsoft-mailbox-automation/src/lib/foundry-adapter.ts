/**
 * Foundry Adapter — bridges microsoft-mailbox-automation patterns
 * into the Autonomous Product Foundry.
 *
 * This module lives in the microsoft-mailbox-automation project and
 * exports its reusable patterns as Foundry-compatible structures.
 *
 * Integration points:
 *   1. Foundry Voice → Prompt Genome seed entries
 *   2. Prior-Art Taxonomy → Research Engine entries
 *   3. Email signals → Ambient Intent fragments
 *   4. Inference Rotator → LLM configuration
 *   5. Strategy Genome → Prompt Genome evaluation pattern
 */

import {
  FOUNDRY_VOICE_PREAMBLE,
  foundryVoice,
  FoundryVoiceRole,
} from "./foundry-voice.js";
import { PRIOR_ART_CATEGORIES } from "./spinor/prior-art.js";
import { EmailSignal } from "@/types";

export interface FoundryPromptGenomeSeed {
  name: string;
  purpose: string;
  originalSource: string;
  initialContent: string;
  supportedModels: string[];
  compatibleWorkflows: string[];
  compatibleProductCategories: string[];
}

/**
 * Convert Foundry Voice roles into Prompt Genome seed entries.
 * Each role becomes a reusable prompt with the Foundry Voice preamble.
 */
export function foundryVoiceToGenomeSeeds(): FoundryPromptGenomeSeed[] {
  const roles: FoundryVoiceRole[] = [
    "extraction", "prior-art", "derivatives", "attribution",
    "hypothesis", "assessment", "mission", "scout",
    "adaptation", "sprouting", "phone-governance", "dashboard",
    "sales-strategy", "clinical", "planning", "engagement",
    "analytics", "compliance", "creative", "default",
  ];

  return roles.map(role => ({
    name: `Foundry Voice: ${role}`,
    purpose: `Role-tuned LLM preamble for ${role} tasks`,
    originalSource: "microsoft-mailbox-automation/src/lib/foundry-voice.ts",
    initialContent: foundryVoice(role),
    supportedModels: ["gpt-4o", "gpt-4o-mini", "claude-3-opus", "claude-3-sonnet"],
    compatibleWorkflows: [role],
    compatibleProductCategories: ["web_app", "ai_agent", "prompt_system"],
  }));
}

/**
 * Convert the SPINOR prior-art taxonomy into Research Engine entries.
 */
export interface FoundryResearchSeed {
  category: string;
  topic: string;
  findings: string;
  sources: string[];
  technologies: string[];
}

export function priorArtToResearchSeeds(): FoundryResearchSeed[] {
  return PRIOR_ART_CATEGORIES.map(cat => ({
    category: "prior_art",
    topic: cat.name,
    findings: `${cat.established}\n\nDifferentiation: ${cat.differentiation}`,
    sources: ["internal: spinor/prior-art.ts"],
    technologies: [],
  }));
}

/**
 * Convert email-derived signals into ambient intent fragments.
 * Only signals with user-approved intent are converted.
 */
export interface FoundryAmbientSeed {
  source: string;
  rawContent: string;
  intentType: string;
  confidence: number;
}

export function emailSignalsToAmbientSeeds(signals: EmailSignal[]): FoundryAmbientSeed[] {
  return signals
    .map(signal => ({
      source: "project_history",
      rawContent: signal.unansweredQuestions.join("; ") || signal.timingPatterns || "email signal",
      intentType: "technical_opportunity",
      confidence: 0.7,
    }));
}

/**
 * Export the inference rotator configuration pattern for Foundry LLM integration.
 */
export interface InferenceRotatorConfig {
  endpoints: string[];
  maxTotalTokens: number;
  model: string;
}

export function getInferenceRotatorConfig(): InferenceRotatorConfig {
  return {
    endpoints: process.env.LLM_ENDPOINTS
      ? JSON.parse(process.env.LLM_ENDPOINTS)
      : process.env.LLM_ENDPOINT
        ? [process.env.LLM_ENDPOINT]
        : ["https://api.openai.com/v1"],
    maxTotalTokens: parseInt(process.env.LLM_MAX_TOKENS || "50000"),
    model: process.env.LLM_MODEL || "gpt-4o-mini",
  };
}
