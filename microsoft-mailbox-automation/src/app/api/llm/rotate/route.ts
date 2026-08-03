import { NextRequest, NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { InferenceRotator, DEFAULT_ENDPOINTS } from "@/lib/inference-rotator";
import { InferenceEndpoint } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — enough for parallel shards
// Note: For book-scale (160K+ tokens), run the client script locally
// or deploy to a platform with longer timeouts (Fly.io, Railway, etc.)

/**
 * POST /api/llm/rotate
 *
 * Multi-node parallel inference. Splits the target token count across
 * N nodes that run simultaneously, then combines the results.
 *
 * With 6 nodes and 50K target:
 *   - Each node generates ~8.3K tokens (its own section)
 *   - All nodes run in parallel
 *   - Total time ≈ one node's time (~7 min), not 46 min
 *   - Each node's KV cache stays small → full speed throughout
 *
 * Body:
 *   messages: ChatMessage[]          — the conversation
 *   targetTokens?: number            — default 50000
 *   maxTokensPerRequest?: number     — default 1024 (per HTTP request, within 60s)
 *   temperature?: number             — default 0.7
 *   parallel?: boolean               — default true (fan-out mode)
 *   shards?: number                  — override number of parallel shards
 *   endpoints?: InferenceEndpoint[]  — override the node pool
 *
 * Returns:
 *   content: string          — full combined text
 *   totalTokens: number
 *   rotations: number        — total HTTP requests across all shards
 *   nodesUsed: string[]
 *   chunks: { node, tokens, content }[]
 *   finishReason: string
 *   elapsedMs: number
 *   endpointStats: { url, healthy, requestCount }[]
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const config = loadConfig();

    const messages = body.messages;
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    // Build endpoint pool: body > config > defaults
    let endpoints: InferenceEndpoint[] = body.endpoints || [];
    if (endpoints.length === 0 && config.llm.endpoints?.length) {
      endpoints = config.llm.endpoints;
    }
    if (endpoints.length === 0) {
      if (config.llm.endpoint) {
        endpoints = [
          {
            url: config.llm.endpoint,
            model: config.llm.model,
            apiKey: config.llm.apiKey,
            maxTokensPerRequest: 1024,
          },
        ];
      } else {
        endpoints = DEFAULT_ENDPOINTS;
      }
    }

    if (endpoints.length === 0) {
      return NextResponse.json(
        { error: "No inference endpoints configured." },
        { status: 400 }
      );
    }

    const targetTokens = body.targetTokens || config.llm.maxTotalTokens || 50000;
    const maxTokensPerRequest = body.maxTokensPerRequest || 1024;
    const temperature = body.temperature ?? 0.7;
    const parallel = body.parallel !== false;
    const shards = body.shards;

    const rotator = new InferenceRotator(endpoints);

    // Health-check all endpoints in parallel
    const healthyCount = await rotator.checkAllHealth();
    console.log(
      `[rotate] ${healthyCount}/${endpoints.length} endpoints healthy, ` +
      `target=${targetTokens} tokens, parallel=${parallel}` +
      (shards ? `, shards=${shards}` : "")
    );

    const result = await rotator.rotate({
      messages,
      targetTokens,
      maxTokensPerRequest,
      temperature,
      parallel,
      shards,
      onProgress: ({ rotation, tokensSoFar, target, node, chunk, phase }) => {
        console.log(
          `[rotate:${phase}] #${rotation} ${tokensSoFar}/${target} tok via ${node}: ${chunk.slice(0, 60)}...`
        );
      },
    });

    return NextResponse.json({
      ...result,
      endpointStats: rotator.getStats(),
      config: {
        targetTokens,
        maxTokensPerRequest,
        parallel,
        shards: shards || endpoints.length,
        endpointsCount: endpoints.length,
        healthyCount,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Rotation inference failed" },
      { status: 500 }
    );
  }
}
