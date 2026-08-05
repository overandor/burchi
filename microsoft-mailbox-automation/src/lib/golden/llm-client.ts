/**
 * GOLDEN NODE LLM client — bridges the deterministic golden engines to the
 * existing LLM inference layer (/api/llm/infer). Supports GGUF models served
 * via Ollama, llama.cpp, Torrent-GGUF, or any OpenAI-compatible endpoint.
 *
 * Architecture: every LLM-powered function has a deterministic fallback.
 * If the LLM is cold, unreachable, or returns unparseable output, the
 * deterministic engine result is used. The system always works; the LLM
 * enhances it when available. (GOLDEN NODE §8 — human–LLM innovation spinor)
 */

import { loadConfig } from "@/lib/config";

const LLM_TIMEOUT_MS = 55000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResult {
  content: string;
  used: boolean;
  provider: string;
  error?: string;
}

/** Call the LLM endpoint directly (OpenAI-compatible format). */
export async function callLLM(messages: ChatMessage[], opts?: {
  temperature?: number;
  maxTokens?: number;
}): Promise<LLMResult> {
  const config = loadConfig();
  const endpoint = config.llm?.endpoint || process.env.LLM_ENDPOINT;
  const model = config.llm?.model || process.env.LLM_MODEL || "gpt-oss:20b";
  const apiKey = config.llm?.apiKey || process.env.OPENAI_API_KEY || "";
  if (!endpoint) {
    return { content: "", used: false, provider: "none", error: "No LLM endpoint configured" };
  }

  // Call the LLM endpoint directly — no self-referencing fetch to /api/llm/infer
  // (which fails on Vercel protected deployments with 401).
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    // Build the full chat/completions URL
    const isPollinations = endpoint.includes("text.pollinations.ai");
    const url = endpoint.endsWith("/chat/completions") || isPollinations
      ? endpoint
      : `${endpoint.replace(/\/$/, "")}/chat/completions`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const maxTokens = opts?.maxTokens ?? 1024;
    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature: opts?.temperature ?? 0.4,
        max_tokens: maxTokens,
        stream: false,
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // Primary endpoint returned HTTP error (402 billing, 503 loading, etc).
      // Try free fallbacks before giving up.
      const llm7Content = await tryLLM7Fallback(messages, opts);
      if (llm7Content) return { content: llm7Content, used: true, provider: "llm7-fallback" };
      const pollinationsContent = await tryPollinationsFallback(messages);
      if (pollinationsContent) return { content: pollinationsContent, used: true, provider: "pollinations-fallback" };
      return { content: "", used: false, provider: "none", error: `LLM HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    if (!content || content.trim().length === 0) {
      // Reasoning models (gpt-oss) may put output in "reasoning" field
      const reasoning = data.choices?.[0]?.message?.reasoning || "";
      if (reasoning && reasoning.trim().length > 0) {
        return { content: reasoning, used: true, provider: data.model || model, error: "LLM returned reasoning instead of content" };
      }
      return { content: "", used: false, provider: data.model || "unknown", error: "Empty LLM response" };
    }
    // Guard against HTML responses (some endpoints return HTML error pages with 200)
    if (typeof content === "string" && content.trim().startsWith("<")) {
      const llm7Content = await tryLLM7Fallback(messages, opts);
      if (llm7Content) return { content: llm7Content, used: true, provider: "llm7-fallback" };
      const pollinationsContent = await tryPollinationsFallback(messages);
      if (pollinationsContent) return { content: pollinationsContent, used: true, provider: "pollinations-fallback" };
      return { content: "", used: false, provider: "none", error: "Endpoint returned HTML instead of JSON" };
    }
    return { content, used: true, provider: data.model || model };
  } catch (e: any) {
    // Primary endpoint failed (timeout, network, DNS). Try free fallbacks
    // so the golden/spinor engines still get LLM-enhanced output.
    const llm7Content = await tryLLM7Fallback(messages, opts);
    if (llm7Content) return { content: llm7Content, used: true, provider: "llm7-fallback" };
    const pollinationsContent = await tryPollinationsFallback(messages);
    if (pollinationsContent) return { content: pollinationsContent, used: true, provider: "pollinations-fallback" };
    return { content: "", used: false, provider: "none", error: e.message };
  }
}

/**
 * Free, no-API-key OpenAI-compatible fallback (LLM7).
 * Used when the user's configured endpoint is unreachable or billing-blocked.
 */
async function tryLLM7Fallback(messages: ChatMessage[], opts?: { temperature?: number; maxTokens?: number }): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const res = await fetch("https://api.llm7.io/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-oss:20b",
        messages,
        max_tokens: opts?.maxTokens ?? 1024,
        temperature: opts?.temperature ?? 0.4,
      }),
    });
    clearTimeout(timeout);
    if (res.ok) {
      const text = await res.text();
      if (text && !text.trim().startsWith("<")) {
        const data = JSON.parse(text);
        const content = data.choices?.[0]?.message?.content || "";
        if (content) return content;
        // Reasoning models may put output in "reasoning" field
        const reasoning = data.choices?.[0]?.message?.reasoning || "";
        if (reasoning) return reasoning;
      }
    }
  } catch (e) {
    console.error("[golden/llm-client] llm7 fallback error:", e);
  }
  return null;
}

/**
 * Free Pollinations fallback (no API key required).
 */
async function tryPollinationsFallback(messages: ChatMessage[]): Promise<string | null> {
  const referrer = (process.env.NEXT_PUBLIC_OAUTH_REDIRECT_BASE || "mailbox-sci-data.netlify.app").replace(/^https?:\/\//, "");
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "openai",
        messages,
        max_tokens: 512,
        seed: Math.floor(Math.random() * 99999),
        referrer,
      }),
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content || null;
    }
  } catch (e) {
    console.error("[golden/llm-client] pollinations fallback error:", e);
  }
  return null;
}

/** Extract JSON from an LLM response that may contain markdown fences or prose. */
export function extractJSON<T = any>(content: string): T | null {
  if (!content) return null;
  // Try direct parse first.
  try { return JSON.parse(content); } catch { /* continue */ }
  // Try extracting from markdown code fences.
  const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch { /* continue */ }
  }
  // Try finding the first { ... } block.
  const braceMatch = content.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch { /* continue */ }
  }
  // Try finding the first [ ... ] array.
  const arrayMatch = content.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]); } catch { /* continue */ }
  }
  return null;
}

function getBaseUrl(): string {
  // On Vercel/Netlify, the function can call itself via the deployment URL.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NETLIFY && process.env.DEPLOY_PRIME_URL) return process.env.DEPLOY_PRIME_URL;
  if (process.env.NEXT_PUBLIC_OAUTH_REDIRECT_BASE) return process.env.NEXT_PUBLIC_OAUTH_REDIRECT_BASE;
  // Local development.
  return "http://localhost:3000";
}

// ─── Structured LLM prompts for GOLDEN NODE ────────────────────────

/** LLM-powered prior-art research: investigate a claim before assignment. */
export async function llmResearchPriorArt(claim: string): Promise<{
  result: any;
  used: boolean;
  error?: string;
}> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a prior-art research engine for a pharma field execution innovation system.
Investigate the given hypothesis claim and return ONLY valid JSON with this exact structure:
{
  "testedInMarket": boolean,
  "testedInAdjacentIndustries": boolean,
  "adjacentSupportSummary": "1-2 sentence summary of evidence in adjacent industries",
  "sourceDomains": ["domain1", "domain2"],
  "responsibleComponent": "the component that appears responsible for the effect, or null",
  "requiredConditions": ["condition1", "condition2"],
  "risksAndConfounders": ["risk1", "risk2"],
  "genuinelyUnknown": ["unknown1"]
}
Be conservative. Distinguish "nobody has tested this" from "somebody tested this and it failed" from "evidence is too poor to know".
Do NOT fabricate specific study citations. If uncertain, put it in genuinelyUnknown.`,
    },
    {
      role: "user",
      content: `Hypothesis claim to research: "${claim}"`,
    },
  ];

  const llm = await callLLM(messages, { temperature: 0.3, maxTokens: 2048 });
  if (!llm.used) return { result: null, used: false, error: llm.error };
  const parsed = extractJSON(llm.content);
  if (!parsed) return { result: null, used: false, error: "LLM returned unparseable JSON" };
  return { result: parsed, used: true };
}

/** LLM-powered derivative generation: propose intelligent derivatives. */
export async function llmProposeDerivatives(
  parentClaim: string,
  modifiableDimensions: string[],
  outcomeDescription?: string,
  attributionReasoning?: string
): Promise<{
  derivatives: any[];
  used: boolean;
  error?: string;
}> {
  const context = outcomeDescription
    ? `\nObserved outcome: ${outcomeDescription}\nAttribution reasoning: ${attributionReasoning || "N/A"}`
    : "";

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are an innovation derivative generator for a hypothesis-to-business engine.
Given a parent hypothesis and its modifiable dimensions, propose 2-4 intelligent derivatives.
Each derivative varies exactly ONE dimension while keeping the rest fixed.
Return ONLY valid JSON with this structure:
{
  "derivatives": [
    {
      "claim": "The derivative hypothesis statement",
      "modifiedDimension": "one of the provided dimensions",
      "rationale": "Why this variation is worth testing"
    }
  ]
}`,
    },
    {
      role: "user",
      content: `Parent hypothesis: "${parentClaim}"
Modifiable dimensions: ${modifiableDimensions.join(", ")}${context}

Propose 2-4 derivatives, each varying exactly one dimension. Focus on isolating the active ingredient and exploring high-upside variations.`,
    },
  ];

  const llm = await callLLM(messages, { temperature: 0.5, maxTokens: 2048 });
  if (!llm.used) return { derivatives: [], used: false, error: llm.error };
  const parsed = extractJSON(llm.content);
  if (!parsed || !parsed.derivatives) return { derivatives: [], used: false, error: "LLM returned unparseable JSON" };
  return { derivatives: parsed.derivatives, used: true };
}

/** LLM-powered attribution reasoning: interpret which factor is responsible. */
export async function llmAttributeOutcome(
  hypothesisClaim: string,
  outcomeDescription: string,
  metrics: { metric: string; value: number; baseline: number; higherIsBetter: boolean }[],
  employeeModified: boolean,
  modifiedDimension?: string,
  externalFactors?: string[]
): Promise<{
  result: any;
  used: boolean;
  error?: string;
}> {
  const metricsStr = metrics.map(m =>
    `${m.metric}: ${m.value} (baseline ${m.baseline}, ${m.higherIsBetter ? "higher better" : "lower better"})`
  ).join("; ");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a causal attribution engine for a hypothesis testing system.
Given a hypothesis, an observed outcome, and context, determine which factor is most likely responsible.
Return ONLY valid JSON with this structure:
{
  "responsibleFactor": "parent_hypothesis" | "employee_modification" | "territory" | "execution_quality" | "external_change" | "unresolved",
  "reasoning": "2-3 sentence explanation of why this factor is the leading explanation",
  "counterfactualEstimate": "What would have happened without the intervention",
  "unexplainedVariance": 0.0-1.0,
  "confidence": 0.0-1.0
}
Be conservative. If the evidence is ambiguous, say "unresolved" with high unexplainedVariance.`,
    },
    {
      role: "user",
      content: `Hypothesis: "${hypothesisClaim}"
Outcome: ${outcomeDescription}
Metrics: ${metricsStr}
Employee modified: ${employeeModified}${modifiedDimension ? ` (dimension: ${modifiedDimension})` : ""}
External factors: ${externalFactors?.join(", ") || "none"}

Which factor is most likely responsible for the observed outcome?`,
    },
  ];

  const llm = await callLLM(messages, { temperature: 0.2, maxTokens: 1536 });
  if (!llm.used) return { result: null, used: false, error: llm.error };
  const parsed = extractJSON(llm.content);
  if (!parsed) return { result: null, used: false, error: "LLM returned unparseable JSON" };
  return { result: parsed, used: true };
}

/** LLM-powered hypothesis generation: create a new hypothesis from prior-art. */
export async function llmGenerateHypothesis(
  domain: string,
  priorArtSummary: string,
  targetEngagementMode?: string
): Promise<{
  result: any;
  used: boolean;
  error?: string;
}> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a hypothesis generation engine for a pharma field execution innovation system.
Generate a single testable hypothesis based on the given domain and prior-art evidence.
The hypothesis must respect pharma boundaries: no unapproved claims, no safety information changes, no prescribing pressure, no patient-level targeting. Only workflow, timing, channel, stakeholder order, and automation experiments.
Return ONLY valid JSON with this structure:
{
  "claim": "The hypothesis statement",
  "targetCondition": "When this condition is met",
  "intervention": "The specific intervention",
  "control": "The control/comparison condition",
  "primaryOutcome": "The primary outcome metric",
  "secondaryOutcomes": ["outcome1", "outcome2"],
  "expectedValue": "What value this could create",
  "primaryUncertainty": "The main thing we don't know",
  "novelComponent": "What's new about this, or null",
  "complianceBoundary": "Approved information and workflows only"
}`,
    },
    {
      role: "user",
      content: `Domain: ${domain}
Prior-art summary: ${priorArtSummary}
Target engagement mode: ${targetEngagementMode || "any"}

Generate one testable, pharma-compliant hypothesis.`,
    },
  ];

  const llm = await callLLM(messages, { temperature: 0.6, maxTokens: 2048 });
  if (!llm.used) return { result: null, used: false, error: llm.error };
  const parsed = extractJSON(llm.content);
  if (!parsed) return { result: null, used: false, error: "LLM returned unparseable JSON" };
  return { result: parsed, used: true };
}

/** LLM-powered Golden Node assessment: evaluate whether a hypothesis qualifies. */
export async function llmAssessGoldenNode(
  claim: string,
  observedResult: string,
  replicationCount: number,
  economicValue: number
): Promise<{
  result: any;
  used: boolean;
  error?: string;
}> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a Golden Node assessment engine. A Golden Node is a hypothesis that evolved beyond a tactic into a defensible capability.
Evaluate whether the given evidence meets the six criteria:
1. Measurable effect
2. Repeatability
3. Portability
4. Defensible mechanism
5. Reusable process
6. Economic value
Return ONLY valid JSON:
{
  "measurableEffect": boolean,
  "repeatability": boolean,
  "portability": boolean,
  "defensibleMechanism": boolean,
  "reusableProcess": boolean,
  "economicValueAssessment": "low" | "moderate" | "high",
  "recommendedStage": "local_success" | "rep_owned_process" | "replicated_method" | "organizational_capability" | "productized_service" | "independent_channel",
  "reasoning": "2-3 sentence explanation"
}`,
    },
    {
      role: "user",
      content: `Hypothesis: "${claim}"
Observed result: ${observedResult}
Replication count: ${replicationCount} territories
Economic value estimate: $${economicValue}

Assess whether this qualifies as a Golden Node.`,
    },
  ];

  const llm = await callLLM(messages, { temperature: 0.3, maxTokens: 1536 });
  if (!llm.used) return { result: null, used: false, error: llm.error };
  const parsed = extractJSON(llm.content);
  if (!parsed) return { result: null, used: false, error: "LLM returned unparseable JSON" };
  return { result: parsed, used: true };
}
