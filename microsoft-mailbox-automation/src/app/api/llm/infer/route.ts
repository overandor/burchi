import { NextRequest, NextResponse } from "next/server";
import { loadConfig, loadProcessedEmails } from "@/lib/config";
import { generateTelemetry } from "@/lib/telemetry/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const config = loadConfig();

    const endpoint = body.endpoint || config.llm.endpoint || process.env.LLM_ENDPOINT || "";
    const apiKey = body.apiKey || config.llm.apiKey || process.env.OPENAI_API_KEY || "";
    const model = body.model || config.llm.model || process.env.LLM_MODEL || "";

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
      let records: any[] = [];
      if (body.records && Array.isArray(body.records)) {
        records = body.records;
      } else {
        try { records = loadProcessedEmails(); } catch {}
      }

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
          content: `You are a revenue intelligence assistant. Use the mailbox telemetry context below to answer questions and generate insights.\n\n--- MAILBOX TELEMETRY CONTEXT ---\n${telemetryContext}`,
        });
      }
    }

    // Detect API format: Ollama vs Torrent GGUF vs OpenAI-compatible
    const isOllama = endpoint.includes("/api/chat") || endpoint.includes(":11434");
    const isTorrentGGUF = endpoint.includes("/api/inference") || endpoint.includes("backend-five-eta");

    if (isOllama) {
      // Ollama format: POST /api/chat with { model, messages, stream }
      const url = endpoint.endsWith("/api/chat")
        ? endpoint
        : `${endpoint.replace(/\/$/, "")}/api/chat`;

      const llmRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "alpha-gpt:latest",
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

      const data = text ? JSON.parse(text) : {};
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

      const data = text ? JSON.parse(text) : {};
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
    const url = endpoint.endsWith("/chat/completions")
      ? endpoint
      : `${endpoint.replace(/\/$/, "")}/chat/completions`;

    const llmRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: body.temperature ?? 0.7,
        max_tokens: body.max_tokens ?? 2048,
        stream: false,
      }),
    });

    const text = await llmRes.text();
    if (!llmRes.ok) {
      // Try Pollinations fallback before returning error
      const pollinationsResult = await tryPollinations(messages);
      if (pollinationsResult) return NextResponse.json(pollinationsResult);
      // Parse error for better messaging
      let errorMsg = `LLM request failed: ${text || llmRes.statusText}`;
      try {
        const errData = JSON.parse(text);
        if (errData.error?.code === 503 || errData.error?.message?.includes("Loading model")) {
          errorMsg = `Model server is starting up (503). Wait a few seconds and try again, or configure a different endpoint in Settings.`;
        }
      } catch {}
      return NextResponse.json({ error: errorMsg }, { status: 502 });
    }

    const data = text ? JSON.parse(text) : {};
    return NextResponse.json(data);
  } catch (e: any) {
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
  try {
    const res = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://pollinations.ai/",
        "Origin": "https://pollinations.ai",
      },
      body: JSON.stringify({
        model: "openai-fast",
        messages,
        max_tokens: 2048,
        seed: Math.floor(Math.random() * 99999),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.choices?.[0]?.message?.content) {
      return {
        choices: data.choices,
        model: "openai-fast (pollinations)",
        _provider: "pollinations",
      };
    }
    return null;
  } catch {
    return null;
  }
}

