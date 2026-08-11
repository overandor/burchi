/**
 * Agent Executor
 *
 * Implements a tool-use loop: the LLM receives the user's command,
 * decides which API tools to call, we execute them server-side,
 * feed the results back, and repeat until the LLM produces a final
 * spoken response.
 *
 * Every turn is logged to the voice_conversation_log table for
 * full auditability and backup.
 */

import { callLLM } from "@/lib/llm/fallback-chain";
import { AGENT_TOOLS, findTool, ToolDef } from "./tool-registry";
import { logVoiceTurn, createConversation, type ConversationTurn } from "./conversation-log";
import { executeDirectTool } from "./direct-executor";

/**
 * Direct LLM call using the same approach as /api/llm/infer.
 * Tries the configured endpoint first, then LLM7, then Pollinations.
 * This is more reliable on Vercel than the full fallback chain because
 * it reads env vars directly.
 */
async function agentLLMCall(messages: { role: string; content: string }[], opts: {
  temperature?: number;
  maxTokens?: number;
}): Promise<{ ok: boolean; content: string; provider: string; error?: string }> {
  const temperature = opts.temperature ?? 0.2;
  const maxTokens = opts.maxTokens ?? 1024;

  // Try configured endpoint first
  let endpoint = "";
  let model = "";
  try {
    const { loadConfig } = await import("@/lib/config");
    const config = loadConfig();
    endpoint = config.llm?.endpoint || process.env.LLM_ENDPOINT || "";
    model = config.llm?.model || process.env.LLM_MODEL || "llama3.2:1b";
  } catch {
    endpoint = process.env.LLM_ENDPOINT || "";
    model = process.env.LLM_MODEL || "llama3.2:1b";
  }

  // Provider 1: Configured endpoint
  if (endpoint) {
    try {
      // Detect Ollama endpoints
      const isOllamaGenerate = endpoint.includes("/api/generate");
      const isOllamaChat = endpoint.includes("/api/chat") || (endpoint.includes(":11434") && !isOllamaGenerate);

      if (isOllamaGenerate) {
        const url = endpoint.endsWith("/api/generate")
          ? endpoint
          : `${endpoint.replace(/\/$/, "")}/api/generate`;
        const systemMsg = messages.find((m) => m.role === "system");
        const userMsg = messages.find((m) => m.role === "user");
        const prompt = userMsg?.content || messages.map((m) => m.content).join("\n\n");
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: model || "llama3.2:1b",
            prompt,
            system: systemMsg?.content || "",
            stream: false,
          }),
          signal: AbortSignal.timeout(60000),
        });
        if (res.ok) {
          const data = await res.json();
          const content = data.response || "";
          if (content) return { ok: true, content, provider: "ollama-generate" };
        }
      } else if (isOllamaChat) {
        const url = endpoint.endsWith("/api/chat")
          ? endpoint
          : `${endpoint.replace(/\/$/, "")}/api/chat`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: model || "llama3.2:1b",
            messages,
            stream: false,
          }),
          signal: AbortSignal.timeout(60000),
        });
        if (res.ok) {
          const data = await res.json();
          const content = data.message?.content || "";
          if (content) return { ok: true, content, provider: "ollama-chat" };
        }
      } else {
        // OpenAI-compatible endpoint
        const url = endpoint.endsWith("/chat/completions")
          ? endpoint
          : endpoint.endsWith("/v1")
            ? `${endpoint}/chat/completions`
            : `${endpoint}/v1/chat/completions`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
          signal: AbortSignal.timeout(30000),
        });
        if (res.ok) {
          const data = await res.json();
          const msg = data.choices?.[0]?.message || {};
          // gpt-oss models put output in "reasoning" when content is empty
          const content = msg.content || msg.reasoning || "";
          if (content) return { ok: true, content, provider: "primary" };
        }
      }
    } catch (e) {
      console.error("[agent] primary LLM failed:", e);
    }
  }

  // Provider 2: LLM7 (free, no API key)
  try {
    const res = await fetch("https://api.llm7.io/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-oss:20b", messages, temperature, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(45000),
    });
    if (res.ok) {
      const data = await res.json();
      const msg = data.choices?.[0]?.message || {};
      // gpt-oss models put output in "reasoning" when content is empty
      const content = msg.content || msg.reasoning || "";
      if (content) return { ok: true, content, provider: "llm7" };
    }
  } catch (e) {
    console.error("[agent] llm7 failed:", e);
  }

  // Provider 3: Pollinations (free, no API key)
  try {
    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
    const res = await fetch(
      `https://text.pollinations.ai/${encodeURIComponent(prompt.slice(0, 8000))}`,
      { signal: AbortSignal.timeout(20000) },
    );
    if (res.ok) {
      const content = await res.text();
      if (content) return { ok: true, content, provider: "pollinations" };
    }
  } catch (e) {
    console.error("[agent] pollinations failed:", e);
  }

  return { ok: false, content: "", provider: "none", error: "All LLM providers failed" };
}

export interface AgentRequest {
  text: string;
  context?: string;
  /** Page content extracted by the client (headings, buttons, errors, text) */
  pageContent?: string;
  conversationId?: string;
  employeeId?: string;
  /** Prior conversation turns for continuity */
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface AgentAction {
  /** Tool name to invoke */
  tool: string;
  /** Arguments — query params for GET, body for POST/PATCH/PUT */
  args: Record<string, unknown>;
}

export interface AgentResponse {
  /** Final spoken response to the user */
  speech: string;
  /** Actions the agent took (for transparency and logging) */
  actionsTaken: { tool: string; args: Record<string, unknown>; result: string; success: boolean }[];
  /** Whether the LLM was used */
  llmUsed: boolean;
  /** LLM provider that responded */
  llmProvider?: string;
  /** Any error */
  error?: string;
  /** Conversation ID for logging continuity */
  conversationId: string;
  /** Navigation action if the agent wants to change the page */
  navigateTo?: string;
  /** Client-side page action for the terminal to execute */
  pageAction?: { type: string; args?: Record<string, string> };
}

const MAX_TOOL_CALLS = 8;
const MAX_TURNS = 5;

/**
 * Main agent loop. Interprets the user's command, calls tools as needed,
 * and returns a spoken response with a full action log.
 */
export async function runAgent(req: AgentRequest): Promise<AgentResponse> {
  const conversationId = req.conversationId || createConversation(req.employeeId || "unknown");
  const actionsTaken: AgentResponse["actionsTaken"] = [];
  const context = req.context || "/today";
  const employeeId = req.employeeId || "gilead-rep-001";

  // Log the user's input
  logVoiceTurn(conversationId, "user", req.text, context);

  const systemPrompt = `You are Foundry, a voice agent for a pharma field platform. You can call tools to get data and take actions.

Employee: ${employeeId}
Page: ${context}
${req.pageContent ? `\nCurrent page content:\n${req.pageContent}\n` : ""}
Tools: list_assignments, list_hypotheses, record_outcome, accept_assignment, reject_assignment, list_golden_nodes, assess_admissibility, golden_overview, gmail_search, gmail_sync, gmail_triage, microsoft_sync, mailbox_status, email_credentials, email_engine_status, run_email_experiment, competitive_actions, competitive_plan, competitive_score, frontrunner_opportunities, spin_dashboard, spin_list, spin_advance, spinor_rl_state, list_strategies, phone_records, territory_accounts, territory_routes, crm_status, list_commitments, detect_commitments, voice_diary, voice_sessions, telemetry, system_audit, health, llm_fallback_status, workteleport_skills, sheets_export, navigate

You can also request client-side page actions by returning: {"pageAction":{"type":"clickButton","args":{"text":"Analyze inbox"}}}
Page action types (you are OMNIPOTENT on the page):
- clickButton (args: text) — click a button/link by text match
- click (args: selector) — click any element by CSS selector
- fill (args: selector, value) — fill a form field by CSS selector
- inspect (args: {}) — get page structure: headings, buttons, errors, forms
- detectErrors (args: {}) — scan page for error elements
- readPage (args: {}) — get full page text content (first 1500 chars)
- eval (args: code) — execute arbitrary JavaScript on the page (FULL POWER)
- scroll (args: selector) — scroll to element by CSS selector or pixel position
- selectOption (args: selector, value) — select a dropdown option
- submitForm (args: selector) — submit a form by CSS selector (empty = first form)
- setAttribute (args: selector, attr, value) — set any attribute/style/class/text/html on any element
- fetch (args: url, options) — make an HTTP request from the browser
- highlight (args: selector) — visually highlight an element with orange outline
- injectScript (args: code) — inject a <script> tag into the page
- injectStyle (args: css) — inject a <style> tag into the page
- screenshot (args: {}) — capture page screenshot info

You can chain multiple page actions across turns. Use eval for anything not covered above.

Respond with ONLY JSON:
- To call a tool: {"tool_call":{"tool":"list_assignments","args":{"employeeId":"${employeeId}"}}}
- To respond: {"final":{"speech":"what to say","navigate":"/optional/route"}}
- To act on the page: {"pageAction":{"type":"clickButton","args":{"text":"Button Text"}}}

Examples:
User: "what are my assignments" → {"tool_call":{"tool":"list_assignments","args":{"employeeId":"${employeeId}"}}}
User: "go to foundry" → {"final":{"speech":"Going to Foundry.","navigate":"/foundry"}}
User: "sync gmail" → {"tool_call":{"tool":"gmail_sync","args":{"maxResults":50}}}
User: "click the analyze button" → {"pageAction":{"type":"clickButton","args":{"text":"Analyze"}}}
User: "what's on this page" → {"pageAction":{"type":"inspect","args":{}}}
User: "change the title to Hello" → {"pageAction":{"type":"setAttribute","args":{"selector":"h1","attr":"text","value":"Hello"}}}
User: "run fetch /api/health" → {"pageAction":{"type":"fetch","args":{"url":"/api/health"}}}
User: "execute document.title" → {"pageAction":{"type":"eval","args":{"code":"document.title"}}}`;

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
  ];

  // Add conversation history
  if (req.history && req.history.length > 0) {
    for (const h of req.history.slice(-10)) {
      messages.push({ role: h.role, content: h.content });
    }
  }

  // Add the current user message
  messages.push({ role: "user", content: req.text });

  let turn = 0;
  let llmUsed = false;
  let llmProvider: string | undefined;

  while (turn < MAX_TURNS) {
    turn++;

    const result = await agentLLMCall(messages, { temperature: 0.2, maxTokens: 1024 });

    if (!result.ok) {
      // LLM failed — try deterministic fallback
      const fallback = deterministicFallback(req.text, context, employeeId);
      if (fallback) {
        logVoiceTurn(conversationId, "assistant", fallback.speech, context, actionsTaken);
        return {
          ...fallback,
          actionsTaken,
          llmUsed: false,
          conversationId,
          error: result.error,
        };
      }
      logVoiceTurn(conversationId, "assistant", "I couldn't process that. Try 'what are my assignments' or 'record an outcome'.", context, actionsTaken);
      return {
        speech: "I couldn't process that. Try 'what are my assignments' or 'record an outcome'.",
        actionsTaken,
        llmUsed: false,
        conversationId,
        error: result.error,
      };
    }

    llmUsed = true;
    llmProvider = result.provider;

    const content = result.content.trim();
    messages.push({ role: "assistant", content });

    // Parse the LLM response
    const parsed = parseAgentResponse(content);

    if (!parsed) {
      // LLM returned unparseable content — try heuristic tool matching
      const heuristicTool = matchHeuristicTool(content, req.text);
      if (heuristicTool && turn < MAX_TURNS) {
        const toolResult = await executeTool(heuristicTool.tool, heuristicTool.args, employeeId, context);
        actionsTaken.push({
          tool: heuristicTool.tool,
          args: heuristicTool.args,
          result: toolResult.summary,
          success: toolResult.success,
        });
        messages.push({
          role: "user",
          content: `Tool "${heuristicTool.tool}" returned:\n${toolResult.summary}\n\nNow give your final response as {"final": {"speech": "..."}}.`,
        });
        continue;
      }

      // No heuristic match — treat as final spoken response
      logVoiceTurn(conversationId, "assistant", content, context, actionsTaken);
      return {
        speech: content,
        actionsTaken,
        llmUsed,
        llmProvider,
        conversationId,
      };
    }

    if (parsed.final) {
      // Agent is done — return the spoken response
      const speech = parsed.final.speech || "Done.";
      logVoiceTurn(conversationId, "assistant", speech, context, actionsTaken);
      return {
        speech,
        actionsTaken,
        llmUsed,
        llmProvider,
        conversationId,
        navigateTo: parsed.final.navigate,
      };
    }

    if (parsed.pageAction) {
      // Agent wants to execute a client-side page action
      const speech = `Executing page action: ${parsed.pageAction.type}`;
      logVoiceTurn(conversationId, "assistant", speech, context, actionsTaken);
      return {
        speech,
        actionsTaken,
        llmUsed,
        llmProvider,
        conversationId,
        pageAction: parsed.pageAction,
      };
    }

    if (parsed.tool_call) {
      // Single tool call
      const toolResult = await executeTool(parsed.tool_call.tool, parsed.tool_call.args, employeeId, context);
      actionsTaken.push({
        tool: parsed.tool_call.tool,
        args: parsed.tool_call.args,
        result: toolResult.summary,
        success: toolResult.success,
      });

      // Feed the result back to the LLM
      messages.push({
        role: "user",
        content: `Tool "${parsed.tool_call.tool}" returned:\n${toolResult.summary}\n\nContinue based on this result. If you have enough information, give your final response.`,
      });

      if (actionsTaken.length >= MAX_TOOL_CALLS) {
        messages.push({
          role: "user",
          content: "You have reached the maximum number of tool calls. Please give your final response now.",
        });
      }
      continue;
    }

    if (parsed.tool_calls) {
      // Multiple parallel tool calls
      const toolResults = await Promise.all(
        parsed.tool_calls.map((tc) => executeTool(tc.tool, tc.args, employeeId, context)),
      );

      for (let i = 0; i < parsed.tool_calls.length; i++) {
        actionsTaken.push({
          tool: parsed.tool_calls[i].tool,
          args: parsed.tool_calls[i].args,
          result: toolResults[i].summary,
          success: toolResults[i].success,
        });
      }

      const resultsText = parsed.tool_calls
        .map((tc, i) => `Tool "${tc.tool}" returned:\n${toolResults[i].summary}`)
        .join("\n\n");

      messages.push({
        role: "user",
        content: `${resultsText}\n\nContinue based on these results. If you have enough information, give your final response.`,
      });

      if (actionsTaken.length >= MAX_TOOL_CALLS) {
        messages.push({
          role: "user",
          content: "You have reached the maximum number of tool calls. Please give your final response now.",
        });
      }
      continue;
    }

    // Should not reach here (parsed is null was handled above)
    logVoiceTurn(conversationId, "assistant", content, context, actionsTaken);
    return {
      speech: content,
      actionsTaken,
      llmUsed,
      llmProvider,
      conversationId,
    };
  }

  // Ran out of turns
  const speech = "I've done what I can. Let me know if you need anything else.";
  logVoiceTurn(conversationId, "assistant", speech, context, actionsTaken);
  return {
    speech,
    actionsTaken,
    llmUsed,
    llmProvider,
    conversationId,
  };
}

// ─── Tool Execution ─────────────────────────────────────────────

interface ToolResult {
  success: boolean;
  summary: string;
  data?: unknown;
}

async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  employeeId: string,
  context: string,
): Promise<ToolResult> {
  // Special case: navigate is not an API call
  if (toolName === "navigate") {
    const route = String(args.route || args.path || "/");
    return { success: true, summary: `Navigation requested to ${route}` };
  }

  // Try direct execution first (bypasses Vercel deployment protection)
  const directResult = await executeDirectTool(toolName, args, employeeId);
  if (directResult) {
    return directResult;
  }

  const tool = findTool(toolName);
  if (!tool) {
    return { success: false, summary: `Unknown tool: ${toolName}` };
  }

  try {
    // Build the URL and request
    let url = tool.path;
    const fetchOptions: RequestInit = {
      method: tool.method,
      headers: { "Content-Type": "application/json" },
    };

    if (tool.method === "GET" && tool.queryParams) {
      const params = new URLSearchParams();
      for (const qp of tool.queryParams) {
        if (args[qp] !== undefined) {
          params.set(qp, String(args[qp]));
        }
      }
      // Always include employeeId if not specified but the endpoint accepts it
      if (tool.queryParams.includes("employeeId") && !params.has("employeeId")) {
        params.set("employeeId", employeeId);
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    if (["POST", "PATCH", "PUT"].includes(tool.method)) {
      fetchOptions.body = JSON.stringify(args);
    }

    // Execute the internal API call
    // We use a relative URL which works within the Next.js server
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `http://localhost:${process.env.PORT || 3000}`;
    const fullUrl = `${baseUrl}${url}`;

    const res = await fetch(fullUrl, {
      ...fetchOptions,
      signal: AbortSignal.timeout(30000),
    });

    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!res.ok) {
      const errMsg = typeof data === "object" && data !== null
        ? JSON.stringify(data).slice(0, 500)
        : String(data).slice(0, 500);
      return { success: false, summary: `HTTP ${res.status}: ${errMsg}`, data };
    }

    // Summarize the result for the LLM (truncate large responses)
    const summary = typeof data === "string"
      ? data.slice(0, 2000)
      : JSON.stringify(data).slice(0, 2000);

    return { success: true, summary, data };
  } catch (e: any) {
    return { success: false, summary: `Tool execution failed: ${e.message}` };
  }
}

// ─── Response Parsing ───────────────────────────────────────────

function parseAgentResponse(content: string): {
  tool_call?: { tool: string; args: Record<string, unknown> };
  tool_calls?: { tool: string; args: Record<string, unknown> }[];
  final?: { speech: string; navigate?: string };
  pageAction?: { type: string; args?: Record<string, string> };
} | null {
  // Try to extract JSON from the response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null; // No JSON — let heuristic matcher try
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.tool_call) {
      return { tool_call: parsed.tool_call };
    }
    if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
      return { tool_calls: parsed.tool_calls };
    }
    if (parsed.pageAction) {
      return { pageAction: parsed.pageAction };
    }
    if (parsed.final) {
      return { final: parsed.final };
    }
    // If it has action/speech (old format), convert
    if (parsed.action && parsed.speech) {
      return { final: { speech: parsed.speech, navigate: parsed.target } };
    }
    // If it has just speech
    if (parsed.speech) {
      return { final: { speech: parsed.speech } };
    }

    // Valid JSON but no recognized format — return null for heuristic matching
    return null;
  } catch {
    return null; // Invalid JSON — let heuristic matcher try
  }
}

// ─── Deterministic Fallback ─────────────────────────────────────

function deterministicFallback(
  text: string,
  context: string,
  employeeId: string,
): { speech: string; navigateTo?: string } | null {
  const lower = text.toLowerCase().trim();

  // Navigation
  const navMap: Record<string, string> = {
    "today": "/today", "inbox": "/inbox", "frontrunner": "/frontrunner",
    "leaders": "/leaders", "foundry": "/foundry", "experiment": "/experiment",
    "process lab": "/process-lab", "email lab": "/email-lab",
    "spin lifecycle": "/spin-lifecycle", "spinor-rl": "/spinor-rl",
    "golden nodes": "/golden-nodes", "results": "/results",
    "autopilot": "/autopilot", "diary": "/diary", "history": "/history",
    "learnings": "/learnings", "settings": "/settings", "phones": "/phones",
    "territory": "/territory", "telemetry": "/telemetry", "spinor": "/spinor",
    "world": "/world", "gilead": "/gilead", "sheets": "/sheets",
  };

  for (const [key, route] of Object.entries(navMap)) {
    if (lower.includes(`go to ${key}`) || lower.includes(`open ${key}`) || lower === key) {
      return { speech: `Navigating to ${key}.`, navigateTo: route };
    }
  }

  if (lower.includes("help") || lower.includes("what can you do")) {
    return {
      speech: "I can list your assignments, record outcomes, accept or reject missions, sync your mailbox, search emails, check competitive intelligence, run admissibility assessments, and navigate to any page. Just tell me what you need.",
    };
  }

  if (lower.includes("status") || lower.includes("what's here") || lower.includes("summarize")) {
    return { speech: "Reading current page state." };
  }

  return null;
}

// ─── Heuristic Tool Matching ────────────────────────────────────

/**
 * When the LLM fails to produce a proper tool_call JSON, try to
 * infer the intended tool from the user's original text and the
 * LLM's response content.
 */
function matchHeuristicTool(
  llmContent: string,
  userText: string,
): { tool: string; args: Record<string, unknown> } | null {
  const combined = `${userText} ${llmContent}`.toLowerCase();
  const lowerUser = userText.toLowerCase();

  // ─── ACTION COMMANDS (check first, before data queries) ─────

  // Accept assignment
  if (lowerUser.includes("accept") && lowerUser.includes("assignment")) {
    const idMatch = userText.match(/asg_\w+/i) || userText.match(/assignment\s+(\S+)/i);
    return { tool: "accept_assignment", args: { assignmentId: idMatch ? idMatch[0].replace(/^assignment\s+/i, "") : "" } };
  }
  // Reject assignment
  if (lowerUser.includes("reject") && lowerUser.includes("assignment")) {
    const idMatch = userText.match(/asg_\w+/i) || userText.match(/assignment\s+(\S+)/i);
    const noteMatch = userText.match(/note[:\s]+(.+)/i);
    return {
      tool: "reject_assignment", args: {
        assignmentId: idMatch ? idMatch[0].replace(/^assignment\s+/i, "") : "",
        note: noteMatch ? noteMatch[1] : "",
      }
    };
  }
  // Record outcome
  if (lowerUser.includes("record") && lowerUser.includes("outcome")) {
    const idMatch = userText.match(/asg_\w+/i) || userText.match(/assignment\s+(\S+)/i);
    const desc = userText.replace(/.*(?:record|outcome|assignment\s+\S+|barrier|performance|efficiency|discovery)/i, "").trim() || "Outcome recorded via voice agent";
    return {
      tool: "record_outcome", args: {
        assignmentId: idMatch ? idMatch[0] : "",
        successKind: lowerUser.includes("efficiency") ? "efficiency" : lowerUser.includes("discovery") ? "discovery" : "performance",
        outcomeDescription: userText.length > 20 ? userText : "Outcome recorded via voice agent",
        metrics: [],
        falsified: lowerUser.includes("falsif"),
        useLLM: true,
      }
    };
  }

  // ─── DATA QUERIES ────────────────────────────────────────────

  // Gmail/Microsoft actions (check before generic email)
  if (combined.includes("gmail") && combined.includes("sync")) {
    return { tool: "gmail_sync", args: { maxResults: 50 } };
  }
  if (combined.includes("gmail") && combined.includes("search")) {
    return { tool: "gmail_search", args: { query: userText.replace(/.*search/i, "").trim() || "is:inbox", maxResults: 10 } };
  }
  if (combined.includes("gmail") && combined.includes("triage")) {
    return { tool: "gmail_triage", args: {} };
  }
  if (combined.includes("microsoft") && combined.includes("sync")) {
    return { tool: "microsoft_sync", args: {} };
  }

  // Email credentials (check before generic mailbox)
  if (combined.includes("email credential") || combined.includes("connected email") || combined.includes("my email")) {
    return { tool: "email_credentials", args: {} };
  }
  if (combined.includes("mailbox") || combined.includes("email status") || combined.includes("mail status")) {
    return { tool: "mailbox_status", args: {} };
  }

  // Competitive (check before generic)
  if (combined.includes("competitive") && combined.includes("score")) {
    return { tool: "competitive_score", args: {} };
  }
  if (combined.includes("competitive") && combined.includes("plan")) {
    return { tool: "competitive_plan", args: {} };
  }
  if (combined.includes("competitive") && combined.includes("action")) {
    return { tool: "competitive_actions", args: {} };
  }

  // Phone records (check before generic "record")
  if (combined.includes("phone") && combined.includes("record")) {
    return { tool: "phone_records", args: {} };
  }

  // Territory (check before generic)
  if (combined.includes("territory") && combined.includes("account")) {
    return { tool: "territory_accounts", args: {} };
  }
  if (combined.includes("territory") && combined.includes("route")) {
    return { tool: "territory_routes", args: {} };
  }

  // ─── Simple data queries ─────────────────────────────────────
  if (combined.includes("assignment") || combined.includes("my mission") || combined.includes("what am i working on")) {
    return { tool: "list_assignments", args: {} };
  }
  if (combined.includes("hypothesis") && !combined.includes("generate")) {
    return { tool: "list_hypotheses", args: {} };
  }
  if (combined.includes("outcome") && combined.includes("list")) {
    return { tool: "list_outcomes", args: {} };
  }
  if (combined.includes("golden node") || combined.includes("golden")) {
    return { tool: "list_golden_nodes", args: {} };
  }
  if (combined.includes("frontrunner") || combined.includes("opportunit")) {
    return { tool: "frontrunner_opportunities", args: {} };
  }
  if (combined.includes("spin") && combined.includes("dashboard")) {
    return { tool: "spin_dashboard", args: {} };
  }
  if (combined.includes("spin") && combined.includes("list")) {
    return { tool: "spin_list", args: {} };
  }
  if (combined.includes("strategy") || combined.includes("strategies")) {
    return { tool: "list_strategies", args: {} };
  }
  if (combined.includes("crm") || combined.includes("sync status")) {
    return { tool: "crm_status", args: {} };
  }
  if (combined.includes("commitment")) {
    return { tool: "list_commitments", args: {} };
  }
  if (combined.includes("admissib")) {
    return { tool: "assess_admissibility", args: {} };
  }
  if (combined.includes("golden") && combined.includes("overview")) {
    return { tool: "golden_overview", args: {} };
  }
  if (combined.includes("spinor-rl") || combined.includes("reinforcement")) {
    return { tool: "spinor_rl_state", args: {} };
  }
  if (combined.includes("voice diary") || combined.includes("diary")) {
    return { tool: "voice_diary", args: {} };
  }
  if (combined.includes("telemetry") || combined.includes("metrics")) {
    return { tool: "telemetry", args: {} };
  }
  if (combined.includes("health") || combined.includes("system status")) {
    return { tool: "health", args: {} };
  }
  if (combined.includes("audit")) {
    return { tool: "system_audit", args: {} };
  }
  if (combined.includes("llm") && combined.includes("status")) {
    return { tool: "llm_fallback_status", args: {} };
  }
  if (combined.includes("workteleport") || combined.includes("skill")) {
    return { tool: "workteleport_skills", args: {} };
  }
  if (combined.includes("export") || combined.includes("sheet")) {
    return { tool: "sheets_export", args: { type: "experiments" } };
  }

  return null;
}
