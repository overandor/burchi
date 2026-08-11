import { NextRequest, NextResponse } from "next/server";
import { withFoundryVoice } from "@/lib/foundry-voice";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let body: any = {};
  try {
    body = await request.json().catch(() => ({}));

    // Load config defensively — may fail on read-only serverless filesystems
    let config: any = { llm: {} };
    try {
      const { loadConfig } = await import("@/lib/config");
      config = loadConfig();
    } catch (e) {
      console.error("[llm/infer] config load error:", e);
    }

    const endpoint = body.endpoint || config.llm?.endpoint || process.env.LLM_ENDPOINT || "";
    const apiKey = body.apiKey || config.llm?.apiKey || process.env.OPENAI_API_KEY || "";
    const model = body.model || config.llm?.model || process.env.LLM_MODEL || "";

    if (!endpoint) {
      return NextResponse.json({ error: "No LLM endpoint configured. Set it in Settings or provide in request." }, { status: 400 });
    }

    let messages = body.messages;
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "messages array is required" }, { status: 400 });
    }

    // If useTelemetry is true (or auto-detected), inject telemetry context
    // into the system prompt so the LLM has mailbox intelligence data
    if (body.useTelemetry || body.injectTelemetry) {
      try {
        let records: any[] = [];
        if (body.records && Array.isArray(body.records)) {
          records = body.records;
        } else {
          try {
            const { loadProcessedEmails } = await import("@/lib/config");
            records = loadProcessedEmails();
          } catch (e) {
            console.error("[llm/infer] loadProcessedEmails error:", e);
          }
        }

        const { generateTelemetry } = await import("@/lib/telemetry/engine");
        const report = generateTelemetry(records, body.user || "dr.gilead@mailbox.local");
        const telemetryContext = formatTelemetryForLLM(report);

        // Inject telemetry into the system message
        messages = messages.map((m: any) => {
          if (m.role === "system") {
            return {
              ...m,
              content: `${m.content}\n\n--- MAILBOX TELEMETRY CONTEXT ---\n${telemetryContext}`,
            };
          }
          return m;
        });

        // If no system message, prepend one
        if (!messages.some((m: any) => m.role === "system")) {
          messages.unshift({
            role: "system",
            content: withFoundryVoice("dashboard", `Use the mailbox telemetry context below to answer questions and generate insights.\n\n--- MAILBOX TELEMETRY CONTEXT ---\n${telemetryContext}`),
          });
        }
      } catch (e) {
        console.error("[llm/infer] telemetry injection error:", e);
      }
    }

    // Detect API format: Ollama vs Torrent GGUF vs OpenAI-compatible
    // Note: if endpoint contains /v1, it's Ollama's OpenAI-compatible mode —
    // treat it as OpenAI-compatible, not native Ollama /api/chat.
    const isOllamaChat = (endpoint.includes("/api/chat") || (endpoint.includes(":11434") && !endpoint.includes("/api/generate"))) && !endpoint.includes("/v1");
    const isOllamaGenerate = endpoint.includes("/api/generate") && !endpoint.includes("/v1");
    const isTorrentGGUF = endpoint.includes("/api/inference") || endpoint.includes("backend-five-eta");

    if (isOllamaChat) {
      // Ollama format: POST /api/chat with { model, messages, stream }
      const url = endpoint.endsWith("/api/chat")
        ? endpoint
        : `${endpoint.replace(/\/$/, "")}/api/chat`;

      const llmRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "llama3.2:1b",
          messages,
          stream: false,
        }),
      });

      const text = await llmRes.text();
      if (!llmRes.ok) {
        // Fall through to Pollinations fallback
        const pollinationsResult = await tryPollinations(messages);
        if (pollinationsResult) return NextResponse.json(pollinationsResult);
        return NextResponse.json({ error: `Ollama request failed: ${text || llmRes.statusText}` }, { status: 502 });
      }

      const data = text && !text.trim().startsWith("<") ? JSON.parse(text) : {};
      // Normalize to OpenAI-like format for the frontend
      return NextResponse.json({
        choices: [{
          message: { role: "assistant", content: data.message?.content || "" },
          finish_reason: "stop",
        }],
        model: data.model || model,
        usage: { total_tokens: data.eval_count || 0 },
        _raw: data,
      });
    }

    if (isOllamaGenerate) {
      // Ollama /api/generate format: POST with { model, prompt, system, stream }
      // Returns { response: "...", done: true }
      const url = endpoint.endsWith("/api/generate")
        ? endpoint
        : `${endpoint.replace(/\/$/, "")}/api/generate`;

      // Extract system + user content from messages array
      const systemMsg = messages.find((m: any) => m.role === "system");
      const userMsg = messages.find((m: any) => m.role === "user");
      const prompt = userMsg?.content || messages.map((m: any) => m.content).join("\n\n");
      const systemPrompt = systemMsg?.content || "";

      const llmRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "llama3.2:1b",
          prompt,
          system: systemPrompt,
          stream: false,
        }),
      });

      const text = await llmRes.text();
      if (!llmRes.ok) {
        const pollinationsResult = await tryPollinations(messages);
        if (pollinationsResult) return NextResponse.json(pollinationsResult);
        return NextResponse.json({ error: `Ollama generate request failed: ${text || llmRes.statusText}` }, { status: 502 });
      }

      const data = text && !text.trim().startsWith("<") ? JSON.parse(text) : {};
      // Normalize to OpenAI-like format for the frontend
      return NextResponse.json({
        choices: [{
          message: { role: "assistant", content: data.response || "" },
          finish_reason: "stop",
        }],
        model: data.model || model,
        usage: { total_tokens: data.eval_count || 0 },
        _raw: data,
      });
    }

    if (isTorrentGGUF) {
      // Torrent GGUF format: POST /api/inference with { prompt, model_id, system_prompt, ... }
      const url = endpoint.endsWith("/api/inference")
        ? endpoint
        : `${endpoint.replace(/\/$/, "")}/api/inference`;

      // Extract user prompt and system prompt from messages
      const userMsg = messages.find((m: any) => m.role === "user");
      const systemMsg = messages.find((m: any) => m.role === "system");
      const prompt = userMsg?.content || "";
      const systemPrompt = systemMsg?.content || body.system_prompt || null;

      const llmRes = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "X-API-Key": apiKey } : {}),
        },
        body: JSON.stringify({
          prompt,
          model_id: body.model_id || model || null,
          max_tokens: body.max_tokens ?? 2048,
          temperature: body.temperature ?? 0.7,
          stream: false,
          system_prompt: systemPrompt,
        }),
      });

      const text = await llmRes.text();
      if (!llmRes.ok) {
        return NextResponse.json({ error: `LLM request failed: ${text || llmRes.statusText}` }, { status: 502 });
      }

      const data = text && !text.trim().startsWith("<") ? JSON.parse(text) : {};
      // Normalize to OpenAI-like format for the frontend
      return NextResponse.json({
        ok: data.ok,
        choices: [{
          message: { role: "assistant", content: data.response || "" },
          finish_reason: "stop",
        }],
        model: data.model_id || model,
        usage: data.tokens || {},
        _raw: data,
      });
    }

    // OpenAI-compatible format
    // Pollinations.ai uses /openai as the full endpoint (no /chat/completions suffix)
    const isPollinations = endpoint.includes("text.pollinations.ai");
    const url = endpoint.endsWith("/chat/completions") || isPollinations
      ? endpoint
      : `${endpoint.replace(/\/$/, "")}/chat/completions`;

    if (isPollinations) {
      // For Pollinations, try GET then POST with retries
      // to handle rate limiting (429/402).
      // Use "openai" model (free anonymous tier) instead of "openai-fast" (paid).
      const pollModel = model === "openai-fast" ? "openai" : model;
      const result = await tryPollinationsDirect(messages, pollModel || "openai");
      if (result) return NextResponse.json(result);
      return NextResponse.json({ error: "Pollinations inference timed out. Try again." }, { status: 504 });
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const llmRes = await fetch(url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature: body.temperature ?? 0.7,
        max_tokens: body.max_tokens ?? 1024,
        stream: false,
      }),
    }).catch((e) => {
      clearTimeout(timeout);
      throw new Error(`Fetch to ${url} failed: ${e.message}`);
    });
    clearTimeout(timeout);

    const text = await llmRes.text();
    if (!llmRes.ok) {
      // Primary endpoint failed (e.g. disabled Vercel deployment, 402 Payment
      // Required, 503 model loading). Try a chain of free fallbacks before
      // surfacing the error so the user is never hard-blocked.
      const llm7Result = await tryLLM7(messages, model);
      if (llm7Result) return NextResponse.json(llm7Result);
      const pollinationsResult = await tryPollinations(messages);
      if (pollinationsResult) return NextResponse.json(pollinationsResult);
      // Parse error for better messaging — guard against HTML error pages
      let errorMsg = `LLM request failed: ${text || llmRes.statusText}`;
      try {
        const errData = JSON.parse(text);
        if (errData.error?.code === 503 || errData.error?.message?.includes("Loading model")) {
          errorMsg = `Model server is starting up (503). Wait a few seconds and try again, or configure a different endpoint in Settings.`;
        } else if (text.includes("DEPLOYMENT_DISABLED") || text.includes("Payment required") || llmRes.status === 402) {
          errorMsg = `Configured endpoint is unavailable (disabled or billing issue). A free fallback (LLM7/Pollinations) was attempted but also failed. Set a working endpoint in Settings.`;
        }
      } catch (e) {
        console.error("[llm/infer] error response parse error:", e);
      }
      return NextResponse.json({ error: errorMsg }, { status: 502 });
    }

    // Guard against HTML responses (some endpoints return HTML error pages
    // with a 200 status). Fall back to free providers instead of crashing.
    if (text.trim().startsWith("<")) {
      const llm7Result = await tryLLM7(messages, model);
      if (llm7Result) return NextResponse.json(llm7Result);
      const pollinationsResult = await tryPollinations(messages);
      if (pollinationsResult) return NextResponse.json(pollinationsResult);
      return NextResponse.json({ error: "Endpoint returned a non-JSON (HTML) response. Configure a valid OpenAI-compatible endpoint in Settings." }, { status: 502 });
    }

    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch {
      const llm7Result = await tryLLM7(messages, model);
      if (llm7Result) return NextResponse.json(llm7Result);
      return NextResponse.json({ error: "Endpoint returned invalid JSON. Configure a valid OpenAI-compatible endpoint in Settings." }, { status: 502 });
    }

    // ─── Retry with lower temperature if content is empty ──────────
    // Some models return empty content at high temperature (e.g. gpt-oss:20b
    // at temp=0.8). Retry once at temp=0.4 before falling back to LLM7.
    const content = data.choices?.[0]?.message?.content;
    if (!content || (typeof content === "string" && content.trim() === "")) {
      const retryTemp = 0.4;
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 60000);
      try {
        const llmRes2 = await fetch(url, {
          method: "POST",
          headers,
          signal: controller2.signal,
          body: JSON.stringify({
            model,
            messages,
            temperature: retryTemp,
            max_tokens: body.max_tokens ?? 1024,
            stream: false,
          }),
        });
        clearTimeout(timeout2);
        const text2 = await llmRes2.text();
        if (llmRes2.ok && text2 && !text2.trim().startsWith("<")) {
          try {
            const data2 = JSON.parse(text2);
            if (data2.choices?.[0]?.message?.content) {
              data = data2;
              data._retry = { reason: "empty_content", originalTemp: body.temperature ?? 0.7, retryTemp };
            }
          } catch { }
        }
      } catch {
        clearTimeout(timeout2);
      }
      // If still empty, try LLM7 fallback
      const finalContent = data.choices?.[0]?.message?.content;
      if (!finalContent || (typeof finalContent === "string" && finalContent.trim() === "")) {
        const llm7Result = await tryLLM7(messages, model);
        if (llm7Result) return NextResponse.json(llm7Result);
      }
    }

    // ─── Log inference receipt (prompt/version provenance) ────────
    try {
      const { createHash } = await import("crypto");
      const { nanoid } = await import("nanoid");
      const { getDb } = await import("@/lib/db");
      const promptHash = createHash("sha256")
        .update(JSON.stringify(messages))
        .digest("hex");
      const responseHash = data.choices?.[0]?.message?.content
        ? createHash("sha256").update(data.choices[0].message.content).digest("hex")
        : null;
      const responseTokens = data.usage?.completion_tokens || data.usage?.total_tokens || null;
      const receiptId = `rcpt_${nanoid(12)}`;
      getDb().prepare(`
        INSERT OR REPLACE INTO llm_receipts (
          id, org_id, user_id, endpoint, model,
          prompt_hash, prompt_summary, messages_count,
          max_tokens, temperature, response_hash, response_tokens,
          latency_ms, success, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        receiptId,
        "foundry",
        null,
        endpoint,
        model,
        promptHash,
        messages[0]?.content?.slice(0, 200) || "",
        messages.length,
        body.max_tokens || null,
        body.temperature ?? null,
        responseHash,
        responseTokens,
        Date.now() - startTime,
        1,
        null,
      );
      // Attach receipt to response for auditability
      data._receipt = { id: receiptId, promptHash, model, timestamp: new Date().toISOString() };
    } catch (receiptError: any) {
      console.error("[llm/infer] receipt logging error (non-blocking):", receiptError.message);
    }

    return NextResponse.json(data);
  } catch (e: any) {
    // ─── Log failed inference receipt ─────────────────────────────
    try {
      const { createHash } = await import("crypto");
      const { nanoid } = await import("nanoid");
      const { getDb } = await import("@/lib/db");
      const promptHash = createHash("sha256")
        .update(JSON.stringify(body.messages || []))
        .digest("hex");
      getDb().prepare(`
        INSERT OR REPLACE INTO llm_receipts (
          id, org_id, user_id, endpoint, model,
          prompt_hash, prompt_summary, messages_count,
          max_tokens, temperature, response_hash, response_tokens,
          latency_ms, success, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `rcpt_${nanoid(12)}`,
        "foundry",
        null,
        body.endpoint || "",
        body.model || "",
        promptHash,
        body.messages?.[0]?.content?.slice(0, 200) || "",
        body.messages?.length || 0,
        body.max_tokens || null,
        body.temperature ?? null,
        null,
        null,
        Date.now() - startTime,
        0,
        e.message,
      );
    } catch { /* non-blocking */ }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function formatTelemetryForLLM(report: any): string {
  const lines: string[] = [];

  lines.push("AGGREGATE METRICS:");
  for (const m of report.aggregateMetrics) {
    lines.push(`  - ${m.label}: ${m.value} ${m.unit} (${m.trend} ${m.changePercent}%) — ${m.description}`);
  }

  lines.push("\nREVENUE BY CATEGORY:");
  for (const c of report.revenueByCategory) {
    lines.push(`  - ${c.category}: $${c.revenue} from ${c.count} emails`);
  }

  lines.push("\nTOP INSIGHTS (sorted by value):");
  for (const i of report.topInsights) {
    lines.push(`  - [${i.severity}] ${i.title}: ${i.description}`);
    if (i.actionable) lines.push(`    Action: ${i.recommendedAction}`);
    lines.push(`    Est. Value: $${i.estimatedValue}`);
  }

  lines.push("\nEFFICIENCY GAINS:");
  for (const g of report.efficiencyGains) {
    lines.push(`  - ${g.metric}: ${g.before} min → ${g.after.toFixed(1)} min (${g.improvement.toFixed(1)}% improvement)`);
  }

  if (report.users.length > 0) {
    const u = report.users[0];
    lines.push(`\nUSER: ${u.user} (${u.email})`);
    lines.push(`  Emails: ${u.totalEmails} total, ${u.processedEmails} processed`);
    lines.push(`  Revenue: $${u.totalEstimatedRevenue} total, $${u.revenuePerEmail}/email`);
    lines.push(`  Time Saved: ${u.totalTimeSavedHours} hours`);
    lines.push(`  Efficiency Score: ${u.efficiencyScore}/100`);
    if (u.topSenders.length > 0) {
      lines.push(`  Top Senders:`);
      for (const s of u.topSenders.slice(0, 5)) {
        lines.push(`    - ${s.sender}: ${s.count} emails, $${s.estimatedValue}`);
      }
    }
  }

  return lines.join("\n");
}

async function tryPollinations(messages: any[]): Promise<any | null> {
  return tryPollinationsDirect(messages, "openai");
}

/**
 * Free, no-API-key OpenAI-compatible fallback (LLM7). Used when the user's
 * configured endpoint is disabled, billing-blocked, or returns HTML errors.
 */
async function tryLLM7(messages: any[], model?: string): Promise<any | null> {
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
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });
    clearTimeout(timeout);
    if (res.ok) {
      const text = await res.text();
      if (text && !text.trim().startsWith("<")) {
        const data = JSON.parse(text);
        if (data.choices?.[0]?.message?.content) {
          return {
            choices: data.choices,
            model: `${model || "gpt-oss:20b"} (llm7-fallback)`,
            _provider: "llm7",
          };
        }
      }
    }
  } catch (e) {
    console.error("[llm/infer] llm7 fallback error:", e);
  }
  return null;
}

async function tryPollinationsDirect(messages: any[], model: string): Promise<any | null> {
  const referrer = (process.env.NEXT_PUBLIC_OAUTH_REDIRECT_BASE || "mailbox-sci-data.netlify.app").replace(/^https?:\/\//, "");

  // POST only — GET endpoint returns 402 Payment Required for most models now.
  // Single attempt with 8s timeout to stay within Netlify's 10s function limit.
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
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
      if (data.choices?.[0]?.message?.content) {
        return {
          choices: data.choices,
          model: `${model} (pollinations)`,
          _provider: "pollinations",
        };
      }
    }
  } catch (e) {
    console.error("[llm/infer] pollinations fallback error:", e);
  }

  return null;
}

