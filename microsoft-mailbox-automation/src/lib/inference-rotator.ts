/**
 * Multi-node inference rotator — parallel fan-out architecture.
 *
 * Instead of sequentially chaining requests (which bloats KV cache and slows
 * down), this splits the target token count across N nodes that run in
 * PARALLEL. Each node gets a fresh, small context — so KV cache stays tiny
 * and generation speed stays at peak throughout.
 *
 * Architecture:
 *
 *   Target: 50,000 tokens    Nodes: 6 available
 *   Per-node: ~8,400 tokens  (split across multiple 1024-token requests)
 *
 *   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
 *   │ Node 1  │  │ Node 2  │  │ Node 3  │  │ Node 4  │  │ Node 5  │  │ Node 6  │
 *   │ Section │  │ Section │  │ Section │  │ Section │  │ Section │  │ Section │
 *   │   1     │  │   2     │  │   3     │  │   4     │  │   5     │  │   6     │
 *   │ ~8K tok │  │ ~8K tok │  │ ~8K tok │  │ ~8K tok │  │ ~8K tok │  │ ~8K tok │
 *   └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘
 *        └────────────┬─────────────┴──────────┴──────────┴──────────┘
 *                     │
 *                ┌────▼────┐
 *                │  Reduce │  → combine in order → 50K tokens total
 *                └─────────┘
 *
 * Total wall-clock time ≈ time for ONE node (≈7 min), not 6× that.
 */

import { InferenceEndpoint, RotationResult } from "@/types";
import { withFoundryVoice } from "@/lib/foundry-voice";

const DEFAULT_TARGET_TOKENS = 50000;
const DEFAULT_TOKENS_PER_REQUEST = 1024; // per HTTP request, within 60s timeout
const REQUEST_TIMEOUT_MS = 55000;
const MAX_RETRIES = 3;
const COLD_START_WAIT_MS = 15000;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface RotationOptions {
  messages: ChatMessage[];
  targetTokens?: number;
  maxTokensPerRequest?: number;
  temperature?: number;
  /** If true, split the task into sub-tasks and run nodes in parallel.
   *  If false, use sequential chaining (legacy mode). */
  parallel?: boolean;
  /** Override the number of parallel shards (default: use all available nodes) */
  shards?: number;
  onProgress?: (info: {
    rotation: number;
    tokensSoFar: number;
    target: number;
    node: string;
    chunk: string;
    phase: "map" | "reduce";
  }) => void;
}

interface ShardResult {
  nodeUrl: string;
  content: string;
  tokens: number;
  rotations: number;
  finishReason: string;
  error?: string;
}

export class InferenceRotator {
  private endpoints: InferenceEndpoint[];
  private healthCache: Map<string, { healthy: boolean; checkedAt: number }> =
    new Map();
  private healthTTL: number = 60000;

  constructor(endpoints: InferenceEndpoint[]) {
    this.endpoints = endpoints.filter((ep) => {
      if (!ep.url || (!ep.url.startsWith("http://") && !ep.url.startsWith("https://"))) {
        console.error(`[inference-rotator] Invalid endpoint URL (must start with http:// or https://): ${ep.url}`);
        return false;
      }
      return true;
    });
  }

  /**
   * Health-check a single endpoint.
   */
  async checkHealth(ep: InferenceEndpoint): Promise<boolean> {
    try {
      const healthUrl = ep.url.endsWith("/v1")
        ? ep.url + "/models"
        : ep.url.replace(/\/$/, "") + "/models";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(healthUrl, { signal: controller.signal });
      clearTimeout(timer);
      // 200 = healthy, 404 = server up but no models route, 503 = cold start
      const healthy = res.status !== 503;
      this.healthCache.set(ep.url, { healthy, checkedAt: Date.now() });
      ep.healthy = healthy;
      return healthy;
    } catch (e) {
      console.error("[inference-rotator] error:", e);
      this.healthCache.set(ep.url, { healthy: false, checkedAt: Date.now() });
      ep.healthy = false;
      return false;
    }
  }

  /**
   * Health-check all endpoints in parallel.
   */
  async checkAllHealth(): Promise<number> {
    const results = await Promise.allSettled(
      this.endpoints.map((ep) => this.checkHealth(ep))
    );
    return results.filter((r) => r.status === "fulfilled" && r.value).length;
  }

  /**
   * Get healthy endpoints.
   */
  private getHealthyEndpoints(): InferenceEndpoint[] {
    return this.endpoints.filter((ep) => ep.healthy !== false);
  }

  /**
   * Send a single chat completion request to one endpoint.
   * Retries on 503 (cold start) with backoff.
   */
  private async singleRequest(
    ep: InferenceEndpoint,
    messages: ChatMessage[],
    maxTokens: number,
    temperature: number
  ): Promise<{ content: string; tokens: number; finishReason: string }> {
    const url = ep.url.endsWith("/chat/completions")
      ? ep.url
      : `${ep.url.replace(/\/$/, "")}/chat/completions`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: ep.model || "/models/model.gguf",
            messages,
            max_tokens: maxTokens,
            temperature,
            stream: false,
          }),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (res.status === 503) {
          const text = await res.text().catch(() => "");
          lastError = new Error(`HTTP 503: ${text.slice(0, 200)}`);
          if (attempt < MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, COLD_START_WAIT_MS));
            continue;
          }
          throw lastError;
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }

        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        const content = data.choices?.[0]?.message?.content || "";
        const tokens =
          data.usage?.completion_tokens || Math.ceil(content.length / 4);
        const finishReason = data.choices?.[0]?.finish_reason || "stop";

        this.healthCache.set(ep.url, { healthy: true, checkedAt: Date.now() });
        ep.healthy = true;

        return { content, tokens, finishReason };
      } catch (err) {
        clearTimeout(timer);
        lastError = err as Error;

        if (attempt < MAX_RETRIES - 1) {
          const isTimeout = err instanceof Error && err.name === "AbortError";
          const is503 = err instanceof Error && err.message.includes("503");
          if (isTimeout || is503) {
            await new Promise((r) => setTimeout(r, COLD_START_WAIT_MS));
            continue;
          }
        }

        this.healthCache.set(ep.url, {
          healthy: false,
          checkedAt: Date.now(),
        });
        ep.healthy = false;
        throw err;
      }
    }

    throw lastError || new Error("Request failed after retries");
  }

  /**
   * Run a single shard: generate targetTokens on one node via sequential
   * requests (each within the 60s timeout). The node's KV cache stays small
   * because the context is just the sub-task prompt + accumulated output.
   */
  private async runShard(
    ep: InferenceEndpoint,
    shardIndex: number,
    totalShards: number,
    systemPrompt: string,
    userPrompt: string,
    targetTokensForShard: number,
    maxTokensPerRequest: number,
    temperature: number,
    onProgress?: RotationOptions["onProgress"]
  ): Promise<ShardResult> {
    const context: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    let shardContent = "";
    let shardTokens = 0;
    let rotations = 0;
    let finishReason = "stop";

    while (shardTokens < targetTokensForShard && rotations < 200) {
      const messages = [...context];
      if (rotations > 0) {
        messages.push({
          role: "user",
          content:
            "Continue exactly where you left off. Do not repeat previous content.",
        });
      }

      try {
        const result = await this.singleRequest(
          ep,
          messages,
          maxTokensPerRequest,
          temperature
        );

        if (!result.content.trim()) {
          finishReason = "empty";
          break;
        }

        shardContent += result.content;
        shardTokens += result.tokens;
        rotations++;

        // Append assistant response to context for continuity
        context.push({ role: "assistant", content: result.content });

        // Prune context to prevent KV cache bloat:
        // Keep system prompt + original user prompt + last 4 messages
        if (context.length > 8) {
          context.splice(2, context.length - 6); // keep [system, user, last 4]
        }

        onProgress?.({
          rotation: rotations,
          tokensSoFar: shardTokens,
          target: targetTokensForShard,
          node: ep.url,
          chunk: result.content.slice(0, 100),
          phase: "map",
        });

        // Natural stop — model finished the section
        if (result.finishReason === "stop" && result.tokens < maxTokensPerRequest * 0.5) {
          finishReason = "natural_stop";
          break;
        }
      } catch (err) {
        finishReason = "error";
        return {
          nodeUrl: ep.url,
          content: shardContent,
          tokens: shardTokens,
          rotations,
          finishReason,
          error: String(err),
        };
      }
    }

    if (shardTokens >= targetTokensForShard) {
      finishReason = "target_reached";
    }

    return {
      nodeUrl: ep.url,
      content: shardContent,
      tokens: shardTokens,
      rotations,
      finishReason,
    };
  }

  /**
   * Split a task into N independent sub-tasks.
   * For large targets (book-scale), generates chapter-level sub-tasks.
   * For smaller targets, generates section-level sub-tasks.
   */
  private splitTask(
    messages: ChatMessage[],
    numShards: number
  ): { systemPrompt: string; userPrompt: string }[] {
    const systemMsg = messages.find((m) => m.role === "system");
    const userMsg = messages.find((m) => m.role === "user");
    const baseSystem = systemMsg?.content || withFoundryVoice("default", "Generate thorough, comprehensive output.");
    const basePrompt = userMsg?.content || "Write a comprehensive analysis.";

    // Extract topic
    const topicMatch = basePrompt.match(
      /(?:about|on|cover|guide to|analysis of|book about|write.*book)\s+(.+?)(?:\.|$)/i
    );
    const topic = topicMatch?.[1]?.trim() || basePrompt.slice(0, 120);

    // Detect if this is a book-scale request
    const isBook = /book|novel|500.?page|chapter|manuscript/i.test(basePrompt);
    const isGuide = /guide|comprehensive|manual|handbook|textbook/i.test(basePrompt);

    if (isBook) {
      return this.splitBookChapters(baseSystem, topic, basePrompt, numShards);
    } else if (isGuide) {
      return this.splitGuideSections(baseSystem, topic, basePrompt, numShards);
    } else {
      return this.splitGenericSections(baseSystem, topic, basePrompt, numShards);
    }
  }

  /**
   * Split a book into chapters. Each shard = one chapter.
   * Generates a chapter outline, then assigns chapters to shards.
   */
  private splitBookChapters(
    baseSystem: string,
    topic: string,
    basePrompt: string,
    numShards: number
  ): { systemPrompt: string; userPrompt: string }[] {
    // Generic book chapter outline — covers narrative arc
    const chapterTemplates = [
      { title: "Opening / Setup", focus: "Introduce the world, main characters, and central conflict. Set the tone and establish the setting." },
      { title: "Inciting Incident", focus: "The event that disrupts the status quo and sets the story in motion. Introduce the protagonist's call to action." },
      { title: "Rising Action I", focus: "The protagonist begins their journey. First obstacles, allies, and discoveries. Build tension." },
      { title: "Rising Action II", focus: "Deepening complications. The stakes rise. New characters, locations, and challenges emerge." },
      { title: "Midpoint Reversal", focus: "A major revelation or reversal that changes the protagonist's understanding. The story pivots." },
      { title: "Rising Action III", focus: "The protagonist commits to their path. Training, preparation, and gathering resources for the confrontation." },
      { title: "The Dark Night", focus: "The protagonist's lowest point. Loss, doubt, and setback. The antagonist seems to have won." },
      { title: "Climax", focus: "The final confrontation. All threads converge. The protagonist faces their ultimate challenge." },
      { title: "Falling Action", focus: "The aftermath of the climax. Consequences unfold. Loose threads begin to tie together." },
      { title: "Resolution", focus: "The new equilibrium. Character arcs complete. The world has changed. Final reflections." },
      { title: "Epilogue", focus: "A glimpse into the future. Where are the characters now? Hints of what's to come." },
      { title: "Appendix / Lore", focus: "World-building details, maps, timelines, character profiles, and supplementary material." },
      { title: "Part II: New Threat", focus: "A new chapter begins. The peace is shattered by a new threat. The hero is called again." },
      { title: "Part II: Investigation", focus: "The protagonist investigates the new threat. Clues, encounters, and growing danger." },
      { title: "Part II: Escalation", focus: "The threat escalates. Allies old and new rally. The stakes become personal." },
      { title: "Part II: Confrontation", focus: "The second major confrontation. Higher stakes, deeper losses, harder choices." },
      { title: "Part II: Resolution", focus: "The second arc resolves. New truths revealed. The world is forever changed." },
      { title: "Part III: The Long Road", focus: "The journey toward the final resolution. The protagonist grows and changes." },
      { title: "Part III: Reckoning", focus: "All debts come due. Past actions have consequences. The final test." },
      { title: "Part III: Finale", focus: "The grand finale. Everything converges. The ultimate resolution and legacy." },
    ];

    const shards: { systemPrompt: string; userPrompt: string }[] = [];

    for (let i = 0; i < numShards; i++) {
      const chapter = chapterTemplates[i % chapterTemplates.length];
      const chapterNum = i + 1;

      shards.push({
        systemPrompt: withFoundryVoice("creative", `${baseSystem}\n\nYou are writing CHAPTER ${chapterNum} of a book about: ${topic}.\nThis chapter is titled "${chapter.title}".\nFocus on: ${chapter.focus}\n\nWrite in vivid, immersive prose. Include dialogue, description, and internal monologue. This is a full-length chapter — write at least 3000 words. Do not summarize or abbreviate. Write the actual narrative prose that readers will read.`),
        userPrompt: `Write Chapter ${chapterNum}: "${chapter.title}" of the book about: ${topic}.\n\nChapter focus: ${chapter.focus}\n\nThis is chapter ${chapterNum} of ${numShards}. Other chapters are being written in parallel by other writers. Focus ONLY on this chapter.\n\nWrite full narrative prose — not an outline, not a summary. Include:\n- Vivid scene descriptions\n- Character dialogue with attribution\n- Internal thoughts and emotions\n- Sensory details (sight, sound, smell, touch, taste)\n- Pacing that builds tension\n\nWrite at least 3000 words of actual story content. Do not stop until the chapter is complete.`,
      });
    }

    return shards;
  }

  /**
   * Split a guide/manual into sections.
   */
  private splitGuideSections(
    baseSystem: string,
    topic: string,
    basePrompt: string,
    numShards: number
  ): { systemPrompt: string; userPrompt: string }[] {
    const sections = [
      "Introduction and overview",
      "Historical background and context",
      "Core principles and methodology",
      "Practical techniques and applications",
      "Advanced techniques and specializations",
      "Equipment, tools, and materials",
      "Training, certification, and education",
      "Business operations and management",
      "Marketing, branding, and client acquisition",
      "Client relations, retention, and satisfaction",
      "Legal, regulatory, and compliance considerations",
      "Health, safety, and contraindications",
      "Case studies and real-world examples",
      "Industry trends and future developments",
      "Research, evidence, and scientific basis",
      "Ethics and professional standards",
      "Pricing strategies and financial management",
      "Technology and digital tools",
      "International perspectives and cultural considerations",
      "Summary, conclusions, and recommendations",
    ];

    const shards: { systemPrompt: string; userPrompt: string }[] = [];

    for (let i = 0; i < numShards; i++) {
      const section = sections[i % sections.length];
      const sectionNum = i + 1;

      shards.push({
        systemPrompt: `${baseSystem}\n\nYou are generating SECTION ${sectionNum} of ${numShards} of a comprehensive guide about: ${topic}.\nFocus specifically on: ${section}.\nDo not cover other sections. Be extremely detailed and thorough. Write at least 3000 words for this section.`,
        userPrompt: `Write the "${section}" section of a comprehensive guide about: ${topic}.\n\nThis is section ${sectionNum} of ${numShards}. Other sections are being written in parallel. Focus ONLY on ${section}.\n\nInclude:\n- Detailed explanations with examples\n- Step-by-step procedures where applicable\n- Best practices and common pitfalls\n- Real-world scenarios\n- Data, statistics, and references where relevant\n\nWrite at least 3000 words. Do not summarize — write the full content.`,
      });
    }

    return shards;
  }

  /**
   * Generic section splitter for analysis tasks.
   */
  private splitGenericSections(
    baseSystem: string,
    topic: string,
    basePrompt: string,
    numShards: number
  ): { systemPrompt: string; userPrompt: string }[] {
    const sections = [
      "Overview and scope",
      "Background and context",
      "Methodology and approach",
      "Detailed analysis part 1",
      "Detailed analysis part 2",
      "Detailed analysis part 3",
      "Findings and results",
      "Discussion and implications",
      "Recommendations",
      "Conclusion and next steps",
    ];

    const shards: { systemPrompt: string; userPrompt: string }[] = [];

    for (let i = 0; i < numShards; i++) {
      const section = sections[i % sections.length];
      const sectionNum = i + 1;

      shards.push({
        systemPrompt: `${baseSystem}\n\nYou are generating PART ${sectionNum} of ${numShards} of a detailed analysis about: ${topic}.\nFocus on: ${section}.\nBe thorough and detailed.`,
        userPrompt: `Write the "${section}" part of the analysis about: ${topic}.\n\nThis is part ${sectionNum} of ${numShards}. Other parts are being written in parallel. Focus ONLY on ${section}. Write at least 2000 words.`,
      });
    }

    return shards;
  }

  /**
   * Combine shard results into a single coherent document.
   * Formats as a book with chapters if the task was book-scale.
   */
  private combineShards(
    shards: ShardResult[],
    topic: string,
    isBook: boolean = false
  ): string {
    const valid = shards.filter((s) => s.content.trim().length > 0);

    if (valid.length === 0) return "";

    if (isBook) {
      const chapters = valid.map((s, i) => {
        return `# Chapter ${i + 1}\n\n${s.content.trim()}`;
      });
      const wordCount = chapters.join(" ").split(/\s+/).length;
      const pageCount = Math.ceil(wordCount / 250);

      return `# ${topic}\n\n*A ${pageCount}-page book generated across ${valid.length} parallel chapters*\n\n---\n\n${chapters.join("\n\n---\n\n")}\n\n---\n\n*Total: ~${wordCount} words, ~${pageCount} pages*`;
    }

    const sections = valid.map((s, i) => {
      return `## Section ${i + 1}\n\n${s.content.trim()}`;
    });

    return `# Comprehensive Guide: ${topic}\n\n${sections.join("\n\n---\n\n")}`;
  }

  /**
   * Run parallel fan-out inference: split the task across N nodes,
   * each generating a portion of the target tokens simultaneously.
   *
   * With 6 nodes and 50K target:
   *   - Each node generates ~8.3K tokens (across ~8 sequential 1024-token requests)
   *   - All 6 nodes run in parallel
   *   - Total wall-clock time ≈ one node's time ≈ 7 minutes
   *   - Each node's KV cache stays small (just its sub-task context)
   */
  async rotate(opts: RotationOptions): Promise<RotationResult> {
    if (!Array.isArray(opts.messages) || opts.messages.length === 0) {
      throw new Error("Invalid messages: must be a non-empty array");
    }
    for (const msg of opts.messages) {
      if (!msg || typeof msg.role !== "string" || typeof msg.content !== "string") {
        throw new Error("Invalid message structure: each message must have {role: string, content: string}");
      }
    }

    const target = opts.targetTokens || DEFAULT_TARGET_TOKENS;
    const perRequest = opts.maxTokensPerRequest || DEFAULT_TOKENS_PER_REQUEST;
    const temperature = opts.temperature ?? 0.7;
    const useParallel = opts.parallel !== false; // default true

    const startTime = Date.now();

    // Determine available nodes
    const healthy = this.getHealthyEndpoints();
    const availableNodes = healthy.length > 0 ? healthy : this.endpoints;

    if (useParallel && availableNodes.length > 1) {
      // ─── PARALLEL FAN-OUT ───
      const numShards = Math.min(
        opts.shards || availableNodes.length,
        availableNodes.length,
        10 // cap at 10 shards
      );

      const tokensPerShard = Math.ceil(target / numShards);

      // Split the task into sub-tasks
      const taskShards = this.splitTask(opts.messages, numShards);

      // Extract topic for the combine phase
      const userMsg = opts.messages.find((m) => m.role === "user");
      const topicMatch = userMsg?.content.match(
        /(?:about|on|cover|guide to|analysis of|book about|write.*book)\s+(.+?)(?:\.|$)/i
      );
      const topic = topicMatch?.[1]?.trim() || "the requested topic";
      const isBook = /book|novel|500.?page|chapter|manuscript/i.test(
        userMsg?.content || ""
      );

      console.log(
        `[rotate] Parallel mode: ${numShards} shards × ${tokensPerShard} tokens = ${target} total`
      );

      // Dispatch all shards in parallel
      const shardPromises = taskShards.map((shard, i) =>
        this.runShard(
          availableNodes[i % availableNodes.length],
          i,
          numShards,
          shard.systemPrompt,
          shard.userPrompt,
          tokensPerShard,
          perRequest,
          temperature,
          opts.onProgress
        ).catch((err) => ({
          nodeUrl: availableNodes[i % availableNodes.length].url,
          content: "",
          tokens: 0,
          rotations: 0,
          finishReason: "error",
          error: String(err),
        }) as ShardResult)
      );

      const shardResults = await Promise.all(shardPromises);

      // Combine results
      const fullContent = this.combineShards(shardResults, topic, isBook);
      const totalTokens = shardResults.reduce((sum, s) => sum + s.tokens, 0);
      const nodesUsed = Array.from(
        new Set(shardResults.map((s) => s.nodeUrl))
      );
      const totalRotations = shardResults.reduce(
        (sum, s) => sum + s.rotations,
        0
      );

      const failed = shardResults.filter((s) => s.finishReason === "error");
      const finishReason =
        totalTokens >= target
          ? "target_reached"
          : failed.length === numShards
          ? "error"
          : "completed";

      return {
        content: fullContent,
        totalTokens,
        rotations: totalRotations,
        nodesUsed,
        chunks: shardResults.map((s) => ({
          node: s.nodeUrl,
          tokens: s.tokens,
          content: s.content.slice(0, 200),
        })),
        finishReason,
        elapsedMs: Date.now() - startTime,
      };
    }

    // ─── SEQUENTIAL FALLBACK (single node) ───
    return this.rotateSequential(opts, availableNodes[0], startTime);
  }

  /**
   * Sequential rotation — legacy mode for single-node or when parallel
   * is explicitly disabled.
   */
  private async rotateSequential(
    opts: RotationOptions,
    ep: InferenceEndpoint,
    startTime: number
  ): Promise<RotationResult> {
    const target = opts.targetTokens || DEFAULT_TARGET_TOKENS;
    const perRequest = opts.maxTokensPerRequest || DEFAULT_TOKENS_PER_REQUEST;
    const temperature = opts.temperature ?? 0.7;

    const chunks: { node: string; tokens: number; content: string }[] = [];
    const nodesUsed = new Set<string>([ep.url]);
    let totalTokens = 0;
    let fullContent = "";
    let rotations = 0;
    let finishReason = "stop";

    const context: ChatMessage[] = [
      {
        role: "system",
        content:
          withFoundryVoice("default", "Generate thorough, comprehensive output. When asked to continue, pick up exactly where you left off without repeating."),
      },
      ...opts.messages.filter((m) => m.role !== "system"),
    ];

    while (totalTokens < target && rotations < 100) {
      const messages = [...context];
      if (rotations > 0) {
        messages.push({
          role: "user",
          content: "Continue exactly where you left off. Do not repeat.",
        });
      }

      try {
        const result = await this.singleRequest(
          ep,
          messages,
          perRequest,
          temperature
        );

        if (!result.content.trim()) {
          finishReason = "empty";
          break;
        }

        chunks.push({
          node: ep.url,
          tokens: result.tokens,
          content: result.content,
        });
        totalTokens += result.tokens;
        fullContent += result.content;
        rotations++;

        context.push({ role: "assistant", content: result.content });

        // Prune to prevent KV cache bloat
        if (context.length > 8) {
          context.splice(1, context.length - 6);
        }

        opts.onProgress?.({
          rotation: rotations,
          tokensSoFar: totalTokens,
          target,
          node: ep.url,
          chunk: result.content.slice(0, 100),
          phase: "map",
        });

        if (result.finishReason === "stop" && result.tokens < perRequest * 0.5) {
          finishReason = "natural_stop";
          break;
        }
      } catch (err) {
        console.error(`Node ${ep.url} failed:`, err);
        if (rotations < 5) {
          await new Promise((r) => setTimeout(r, COLD_START_WAIT_MS));
          continue;
        }
        finishReason = "error";
        break;
      }
    }

    if (totalTokens >= target) finishReason = "target_reached";

    return {
      content: fullContent,
      totalTokens,
      rotations,
      nodesUsed: Array.from(nodesUsed),
      chunks,
      finishReason,
      elapsedMs: Date.now() - startTime,
    };
  }

  getStats() {
    return this.endpoints.map((ep) => ({
      url: ep.url,
      healthy: ep.healthy,
      requestCount: ep.requestCount || 0,
      lastUsed: ep.lastUsed,
    }));
  }
}

/**
 * Default inference endpoints.
 * Configure via LLM_ENDPOINTS env var or pass endpoints in the request body.
 * Keep empty by default to avoid depending on any single external/local node.
 */
export const DEFAULT_ENDPOINTS: InferenceEndpoint[] = [
  // Empty by default — configure LLM_ENDPOINTS/LLM_ENDPOINT env vars or pass endpoints in the request body.
  // Example OpenAI: { url: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY, maxTokensPerRequest: 1024 },
];
