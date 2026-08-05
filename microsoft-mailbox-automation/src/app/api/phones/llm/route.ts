import { NextRequest, NextResponse } from "next/server";
import { buildLLMPrompt, parseLLMResponse } from "@/lib/phone-telemetry";
import { PhoneRecord } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/phones/llm — run LLM governance analysis on a phone record.
 *
 * Body: { record: PhoneRecord, endpoint?, apiKey?, model? }
 * Returns: { analysis: PhoneLLMAnalysis }
 *
 * Uses the same LLM endpoint config as the rest of the app (env vars or
 * provided in the body). Falls back to Pollinations if the primary
 * endpoint fails.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const record: PhoneRecord = body.record;

    if (!record) {
      return NextResponse.json(
        { error: "record is required" },
        { status: 400 }
      );
    }

    let config: any = { llm: {} };
    try {
      const { loadConfig } = await import("@/lib/config");
      config = loadConfig();
    } catch (e) {
      console.error("[phones/llm] config load error:", e);
    }

    const endpoint = body.endpoint || config.llm?.endpoint || process.env.LLM_ENDPOINT || "";
    const apiKey = body.apiKey || config.llm?.apiKey || process.env.OPENAI_API_KEY || "";
    const model = body.model || config.llm?.model || process.env.LLM_MODEL || "gpt-4o-mini";

    if (!endpoint) {
      return NextResponse.json(
        { error: "No LLM endpoint configured. Set it in Settings or provide in request." },
        { status: 400 }
      );
    }

    const { system, user } = buildLLMPrompt(record);

    const messages = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];

    // Detect endpoint format
    const isOllama = (endpoint.includes("/api/chat") || endpoint.includes(":11434")) && !endpoint.includes("/v1");
    const isPollinations = endpoint.includes("text.pollinations.ai");

    let llmContent = "";

    if (isOllama) {
      const url = endpoint.endsWith("/api/chat")
        ? endpoint
        : `${endpoint.replace(/\/$/, "")}/api/chat`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model || "alpha-gpt:latest", messages, stream: false }),
      });
      const text = await res.text();
      if (!res.ok) {
        const fb = await tryPollinations(messages, model);
        if (fb) llmContent = fb;
        else return NextResponse.json({ error: `Ollama failed: ${text}` }, { status: 502 });
      } else {
        const data = text ? JSON.parse(text) : {};
        llmContent = data.message?.content || "";
      }
    } else if (isPollinations) {
      const result = await tryPollinationsDirect(messages, model || "openai");
      if (result) llmContent = result;
      else return NextResponse.json({ error: "Pollinations timed out" }, { status: 504 });
    } else {
      const url = endpoint.endsWith("/chat/completions")
        ? endpoint
        : `${endpoint.replace(/\/$/, "")}/chat/completions`;

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.4,
            max_tokens: 2048,
            stream: false,
          }),
        });
        clearTimeout(timeout);
        const text = await res.text();
        if (!res.ok) {
          const fb = await tryPollinations(messages, model);
          if (fb) llmContent = fb;
          else return NextResponse.json({ error: `LLM failed: ${text}` }, { status: 502 });
        } else {
          const data = text ? JSON.parse(text) : {};
          llmContent = data.choices?.[0]?.message?.content || "";
        }
      } catch (err: any) {
        clearTimeout(timeout);
        const fb = await tryPollinations(messages, model);
        if (fb) llmContent = fb;
        else return NextResponse.json({ error: err.message }, { status: 502 });
      }
    }

    const analysis = parseLLMResponse(llmContent, model, record);
    return NextResponse.json({ analysis, ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function tryPollinations(messages: any[], model: string): Promise<string | null> {
  return tryPollinationsDirect(messages, "openai");
}

async function tryPollinationsDirect(messages: any[], model: string): Promise<string | null> {
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
        max_tokens: 1024,
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
    console.error("[phones/llm] pollinations fallback error:", e);
  }
  return null;
}
