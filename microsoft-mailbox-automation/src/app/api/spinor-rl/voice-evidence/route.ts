import { NextRequest, NextResponse } from "next/server";
import { callLLM, extractJSON, ChatMessage } from "@/lib/golden/llm-client";
import { withFoundryVoice } from "@/lib/foundry-voice";
import { nanoid } from "nanoid";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/spinor-rl/voice-evidence
 * Body: { spokenText: string, missionId: string, employeeId: string }
 *
 * The employee speaks their experiment observations into TTS.
 * This endpoint extracts all evidence artifacts from the spoken text
 * using LLM and returns structured evidence ready for the palindrome engine.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { spokenText, missionId, employeeId, hypothesisId } = body;

    if (!spokenText || !employeeId) {
      return NextResponse.json({ error: "spokenText and employeeId required" }, { status: 400 });
    }

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: withFoundryVoice("default", `You are the voice evidence extraction engine for SPINOR-RL.
The employee just spoke their experiment observations into a voice interface.
Extract ALL evidence artifacts from the spoken text and return structured evidence.

Return ONLY valid JSON with this structure:
{
  "outcomeDescription": "What happened in the experiment",
  "successKind": "performance" | "efficiency" | "discovery" | "boundary" | "system" | "channel" | "falsification",
  "falsified": boolean,
  "falsificationEvidence": "If falsified, what evidence disproved it (or null)",
  "metrics": [
    {
      "metric": "Metric name",
      "value": number,
      "unit": "unit",
      "baseline": number,
      "higherIsBetter": boolean
    }
  ],
  "observedMechanism": "What mechanism appears to explain the result",
  "alternativeExplanations": ["alternative1", "alternative2"],
  "confounders": ["confounder1"],
  "externalFactors": ["factor1"],
  "employeeModification": "What the employee changed from the original hypothesis (or null)",
  "complianceNotes": "Any compliance concerns (or null)",
  "nextStepRecommendation": "What the employee should do next",
  "derivativeIdea": "A potential derivative hypothesis based on this result (or null)",
  "confidenceLevel": "low" | "medium" | "high",
  "evidenceQuality": "observation" | "signal" | "provisional" | "validated"
}

Be conservative. If the employee didn't mention a metric, don't fabricate one.
If the result is ambiguous, set confidenceLevel to "low" and evidenceQuality to "observation".
If the employee describes a clear improvement with numbers, set evidenceQuality to "signal" or "provisional".`),
      },
      {
        role: "user",
        content: `Employee: ${employeeId}
Mission ID: ${missionId || "N/A"}
Hypothesis ID: ${hypothesisId || "N/A"}

Spoken observations (transcribed from voice):
"""
${spokenText}
"""

Extract all evidence artifacts from these spoken observations.`,
      },
    ];

    const llm = await callLLM(messages, { temperature: 0.3, maxTokens: 2048 });
    let llmUsed = false;
    let llmError: string | undefined;
    let evidence: any = null;

    if (llm.used) {
      evidence = extractJSON(llm.content);
      if (evidence) {
        llmUsed = true;
      } else {
        llmError = "LLM returned unparseable JSON";
      }
    } else {
      llmError = llm.error;
    }

    // Deterministic fallback: basic extraction from spoken text
    if (!evidence) {
      const lowerText = spokenText.toLowerCase();
      const falsified = lowerText.includes("didn't work") || lowerText.includes("failed") ||
        lowerText.includes("no difference") || lowerText.includes("didn't improve") ||
        lowerText.includes("not effective") || lowerText.includes("falsified");

      // Try to extract numbers from the text
      const numberMatches = spokenText.match(/(\d+(?:\.\d+)?)\s*(percent|%|x|times|hours?|minutes?|days?|responses?|meetings?|conversions?)/gi) || [];

      const metrics = numberMatches.slice(0, 5).map((match: string) => {
        const num = parseFloat(match);
        const unit = match.replace(/[\d.\s]/g, "").toLowerCase();
        return {
          metric: `Observed ${unit}`,
          value: num,
          unit: unit.replace(/s$/, ""),
          baseline: 0,
          higherIsBetter: true,
        };
      });

      evidence = {
        outcomeDescription: spokenText.slice(0, 500),
        successKind: falsified ? "falsification" : "performance",
        falsified,
        falsificationEvidence: falsified ? "Employee reported negative result" : null,
        metrics,
        observedMechanism: "Not specified in spoken text",
        alternativeExplanations: ["Territory differences", "Timing effects"],
        confounders: [],
        externalFactors: [],
        employeeModification: null,
        complianceNotes: null,
        nextStepRecommendation: falsified ? "Consider derivative hypotheses or segment testing" : "Replicate in another territory to confirm",
        derivativeIdea: null,
        confidenceLevel: metrics.length > 0 ? "medium" : "low",
        evidenceQuality: metrics.length > 0 ? "signal" : "observation",
      };
    }

    // Add metadata
    evidence.id = `evidence_${nanoid(8)}`;
    evidence.missionId = missionId || null;
    evidence.employeeId = employeeId;
    evidence.hypothesisId = hypothesisId || null;
    evidence.spokenText = spokenText;
    evidence.llmUsed = llmUsed;
    evidence.extractedAt = new Date().toISOString();

    return NextResponse.json({
      evidence,
      llmUsed,
      llmError,
    });
  } catch (e: any) {
    console.error("[/api/spinor-rl/voice-evidence] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
