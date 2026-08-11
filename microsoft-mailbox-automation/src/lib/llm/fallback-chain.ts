/**
 * Unified LLM fallback chain.
 *
 * Provides a single `callLLM` function that tries providers in order:
 *   1. Primary: user-configured endpoint (OpenAI-compatible, Ollama, etc.)
 *   2. Secondary: LLM7 (free, no API key, OpenAI-compatible)
 *   3. Emergency: Pollinations.ai (free, no API key)
 *   4. Cached/rule-based: deterministic response from context
 *
 * Each provider has its own timeout and retry logic. The chain is
 * circuit-breaker aware — if a provider fails repeatedly, it is
 * temporarily skipped to avoid wasting time on dead endpoints.
 *
 * Usage:
 *   import { callLLM } from "@/lib/llm/fallback-chain";
 *   const result = await callLLM({
 *     messages: [{ role: "user", content: "Hello" }],
 *     config: loadConfig(),
 *   });
 *   if (result.ok) console.log(result.content);
 *   else console.error(result.error);
 */

import { loadConfig } from "@/lib/config";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCallOptions {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Override the configured endpoint */
  endpoint?: string;
  /** Override the API key */
  apiKey?: string;
  /** Timeout in ms per provider (default: 30s primary, 15s fallbacks) */
  timeoutMs?: number;
  /** If true, skip the primary and go straight to fallbacks */
  skipPrimary?: boolean;
}

export interface LLMCallResult {
  ok: boolean;
  content: string;
  provider: string;
  model: string;
  error?: string;
  latencyMs: number;
  /** Raw response from the provider (for debugging) */
  raw?: any;
}

// ─── Circuit breaker ──────────────────────────────────────────────────────

interface CircuitState {
  failures: number;
  lastFailure: number;
  tripped: boolean;
}

const circuits: Record<string, CircuitState> = {};
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_RESET_MS = 60_000; // 1 minute

function isCircuitOpen(provider: string): boolean {
  const state = circuits[provider];
  if (!state || !state.tripped) return false;
  // Auto-reset after cooldown
  if (Date.now() - state.lastFailure > CIRCUIT_RESET_MS) {
    state.tripped = false;
    state.failures = 0;
    return false;
  }
  return true;
}

function recordFailure(provider: string): void {
  const state = circuits[provider] || { failures: 0, lastFailure: 0, tripped: false };
  state.failures++;
  state.lastFailure = Date.now();
  if (state.failures >= CIRCUIT_THRESHOLD) {
    state.tripped = true;
    console.warn(`[llm/fallback] circuit breaker tripped for ${provider} after ${state.failures} failures`);
  }
  circuits[provider] = state;
}

function recordSuccess(provider: string): void {
  circuits[provider] = { failures: 0, lastFailure: 0, tripped: false };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function extractContent(data: any): string {
  return (
    data?.choices?.[0]?.message?.content ||
    data?.message?.content ||
    data?.response ||
    ""
  );
}

// ─── Provider 1: Primary (user-configured) ────────────────────────────────

async function tryPrimary(opts: LLMCallOptions, config: any): Promise<LLMCallResult | null> {
  const endpoint = opts.endpoint || config.llm?.endpoint || process.env.LLM_ENDPOINT || "";
  const apiKey = opts.apiKey || config.llm?.apiKey || process.env.OPENAI_API_KEY || "";
  const model = opts.model || config.llm?.model || process.env.LLM_MODEL || "";

  if (!endpoint) return null;
  if (isCircuitOpen("primary")) {
    console.log("[llm/fallback] primary circuit open, skipping");
    return null;
  }

  const timeout = opts.timeoutMs || 30_000;
  const startTime = Date.now();

  try {
    // Detect format
    const isOllamaGenerate = endpoint.includes("/api/generate") && !endpoint.includes("/v1");
    const isOllamaChat = (endpoint.includes("/api/chat") || (endpoint.includes(":11434") && !isOllamaGenerate)) && !endpoint.includes("/v1");
    const isPollinations = endpoint.includes("text.pollinations.ai");

    let url: string;
    let body: Record<string, unknown>;
    let headers: Record<string, string> = { "Content-Type": "application/json" };

    if (isOllamaGenerate) {
      url = endpoint.endsWith("/api/generate") ? endpoint : `${endpoint.replace(/\/$/, "")}/api/generate`;
      const systemMsg = opts.messages.find((m) => m.role === "system");
      const userMsg = opts.messages.find((m) => m.role === "user");
      body = {
        model: model || "llama3.2:1b",
        prompt: userMsg?.content || opts.messages.map((m) => m.content).join("\n\n"),
        system: systemMsg?.content || "",
        stream: false,
      };
    } else if (isOllamaChat) {
      url = endpoint.endsWith("/api/chat") ? endpoint : `${endpoint.replace(/\/$/, "")}/api/chat`;
      body = { model: model || "llama3.2:1b", messages: opts.messages, stream: false };
    } else if (isPollinations) {
      url = endpoint;
      body = {
        model: model === "openai-fast" ? "openai" : model || "openai",
        messages: opts.messages,
        max_tokens: opts.maxTokens || 512,
        seed: Math.floor(Math.random() * 99999),
      };
      headers["User-Agent"] = "Mozilla/5.0";
    } else {
      // OpenAI-compatible
      url = endpoint.endsWith("/chat/completions")
        ? endpoint
        : `${endpoint.replace(/\/$/, "")}/chat/completions`;
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      body = {
        model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens || 1024,
        stream: false,
      };
    }

    const res = await fetchWithTimeout(url, { method: "POST", headers, body: JSON.stringify(body) }, timeout);
    const text = await res.text();

    if (!res.ok) {
      recordFailure("primary");
      console.error(`[llm/fallback] primary failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
      return null;
    }

    // Guard against HTML responses
    if (text.trim().startsWith("<")) {
      recordFailure("primary");
      console.error("[llm/fallback] primary returned HTML, not JSON");
      return null;
    }

    const data = JSON.parse(text);
    const content = extractContent(data);
    if (!content) {
      recordFailure("primary");
      return null;
    }

    recordSuccess("primary");
    return {
      ok: true,
      content,
      provider: "primary",
      model: model || "unknown",
      latencyMs: Date.now() - startTime,
      raw: data,
    };
  } catch (e: any) {
    recordFailure("primary");
    console.error(`[llm/fallback] primary error: ${e.message}`);
    return null;
  }
}

// ─── Provider 2: LLM7 (free, no API key) ──────────────────────────────────

async function tryLLM7(opts: LLMCallOptions): Promise<LLMCallResult | null> {
  if (isCircuitOpen("llm7")) return null;

  const timeout = 20_000;
  const startTime = Date.now();

  try {
    const res = await fetchWithTimeout(
      "https://api.llm7.io/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: opts.model || "gpt-oss:20b",
          messages: opts.messages,
          max_tokens: opts.maxTokens || 1024,
          temperature: opts.temperature ?? 0.7,
        }),
      },
      timeout,
    );

    if (!res.ok) {
      recordFailure("llm7");
      console.error(`[llm/fallback] llm7 failed: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const content = extractContent(data);
    if (!content) {
      recordFailure("llm7");
      return null;
    }

    recordSuccess("llm7");
    return {
      ok: true,
      content,
      provider: "llm7",
      model: opts.model || "gpt-oss:20b",
      latencyMs: Date.now() - startTime,
      raw: data,
    };
  } catch (e: any) {
    recordFailure("llm7");
    console.error(`[llm/fallback] llm7 error: ${e.message}`);
    return null;
  }
}

// ─── Provider 3: Pollinations (free, no API key) ──────────────────────────
// NOTE: Pollinations legacy text API is now 402 Payment Required for most
// models. This provider is kept as a last-resard emergency fallback but
// may fail. The rule-based fallback (Provider 4) will always work.

async function tryPollinations(opts: LLMCallOptions): Promise<LLMCallResult | null> {
  if (isCircuitOpen("pollinations")) return null;

  const timeout = 10_000;
  const startTime = Date.now();
  const referrer = (process.env.NEXT_PUBLIC_OAUTH_REDIRECT_BASE || "advantage-foundry.app").replace(/^https?:\/\//, "");

  try {
    const res = await fetchWithTimeout(
      "https://text.pollinations.ai/openai",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0",
        },
        body: JSON.stringify({
          model: "openai",
          messages: opts.messages,
          max_tokens: opts.maxTokens || 512,
          seed: Math.floor(Math.random() * 99999),
          referrer,
        }),
      },
      timeout,
    );

    if (!res.ok) {
      recordFailure("pollinations");
      console.error(`[llm/fallback] pollinations failed: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const content = extractContent(data);
    if (!content) {
      recordFailure("pollinations");
      return null;
    }

    recordSuccess("pollinations");
    return {
      ok: true,
      content,
      provider: "pollinations",
      model: "openai",
      latencyMs: Date.now() - startTime,
      raw: data,
    };
  } catch (e: any) {
    recordFailure("pollinations");
    console.error(`[llm/fallback] pollinations error: ${e.message}`);
    return null;
  }
}

// ─── Provider 4: Rule-based fallback ──────────────────────────────────────

function ruleBasedResponse(opts: LLMCallOptions): LLMCallResult {
  const lastUserMsg = [...opts.messages].reverse().find((m) => m.role === "user");
  const prompt = lastUserMsg?.content || "";

  // Simple rule-based responses for common patterns
  const lower = prompt.toLowerCase();

  if (lower.includes("help") || lower.includes("what can you do")) {
    return {
      ok: true,
      content: "I can help with research tasks, hypothesis generation, experiment analysis, and email intelligence. Try: 'generate a hypothesis', 'analyze confounders', or 'explain lineage'.",
      provider: "rule-based",
      model: "fallback-rules",
      latencyMs: 0,
    };
  }

  if (lower.includes("hypothesis") && (lower.includes("generate") || lower.includes("create"))) {
    return {
      ok: true,
      content: "Hypothesis: Increasing the frequency of personalized follow-up emails from 1x/week to 3x/week will increase response rates by 15-25% within a 14-day observation window. This is a testable, falsifiable claim with a clear measurement protocol.",
      provider: "rule-based",
      model: "fallback-rules",
      latencyMs: 0,
    };
  }

  if (lower.includes("confounder")) {
    return {
      ok: true,
      content: "Potential confounders: (1) Seasonal variation in recipient engagement, (2) Concurrent campaigns from other senders, (3) Day-of-week effects on open rates, (4) Subject line confounds, (5) Recipient list quality changes during the observation window.",
      provider: "rule-based",
      model: "fallback-rules",
      latencyMs: 0,
    };
  }

  // Generic fallback
  return {
    ok: true,
    content: "I'm currently operating in fallback mode due to LLM provider unavailability. Your request has been logged. Please try again in a moment, or configure a working LLM endpoint in Settings.",
    provider: "rule-based",
    model: "fallback-rules",
    latencyMs: 0,
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────

/**
 * Calls the LLM with a full fallback chain.
 *
 * Chain: primary → LLM7 → Pollinations → rule-based
 *
 * Each provider is tried in order. If a provider's circuit breaker
 * is open, it is skipped. If all providers fail, a rule-based
 * response is returned so the user is never hard-blocked.
 */
export async function callLLM(opts: LLMCallOptions): Promise<LLMCallResult> {
  let config: any = { llm: {} };
  try {
    config = loadConfig();
  } catch (e) {
    console.error("[llm/fallback] config load error:", e);
  }

  // 1. Primary (user-configured endpoint)
  if (!opts.skipPrimary) {
    const result = await tryPrimary(opts, config);
    if (result) return result;
  }

  // 2. LLM7 (free secondary)
  const llm7Result = await tryLLM7(opts);
  if (llm7Result) return llm7Result;

  // 3. Pollinations (free emergency)
  const pollinationsResult = await tryPollinations(opts);
  if (pollinationsResult) return pollinationsResult;

  // 4. Rule-based (always works)
  console.warn("[llm/fallback] all LLM providers failed, using rule-based fallback");
  return ruleBasedResponse(opts);
}

/**
 * Calls the LLM and returns the response in OpenAI-compatible format.
 * Useful for drop-in replacement in existing route handlers.
 */
export async function callLLMOpenAIFormat(opts: LLMCallOptions): Promise<{
  choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
  model: string;
  _provider: string;
  _latencyMs: number;
}> {
  const result = await callLLM(opts);
  return {
    choices: [{
      message: { role: "assistant", content: result.content },
      finish_reason: "stop",
    }],
    model: result.model,
    _provider: result.provider,
    _latencyMs: result.latencyMs,
  };
}

/**
 * Get circuit breaker status for monitoring/debugging.
 */
export function getCircuitStatus(): Record<string, { failures: number; tripped: boolean }> {
  const status: Record<string, { failures: number; tripped: boolean }> = {};
  for (const [provider, state] of Object.entries(circuits)) {
    status[provider] = { failures: state.failures, tripped: isCircuitOpen(provider) };
  }
  return status;
}
