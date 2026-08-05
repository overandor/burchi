import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordOutcome, attributeOutcome, listOutcomes, listAttributions, getAttributionForOutcome } from "@/lib/strategy/attribution";

const OutcomeSchema = z.object({
  assignmentId: z.string().min(1),
  strategyId: z.string().min(1),
  employeeId: z.string().min(1),
  employeeRole: z.enum(["field_representative", "regional_manager", "medical_affairs", "market_access", "compliance"]),
  outcomeDescription: z.string().min(1),
  outcomeMetrics: z.array(
    z.object({
      metric: z.string(),
      value: z.number(),
      unit: z.string(),
      baseline: z.number(),
    })
  ),
  contextAtObservation: z
    .object({
      workloadLevel: z.string().optional(),
      externalFactors: z.array(z.string()).optional(),
      concurrentStrategies: z.array(z.string()).optional(),
    })
    .optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");
    const attribute = searchParams.get("attribute") === "true";

    let outcomes = listOutcomes();
    if (employeeId) {
      outcomes = outcomes.filter((o) => o.employeeId === employeeId);
    }

    if (attribute) {
      const results = [];
      for (const o of outcomes) {
        let attr = getAttributionForOutcome(o.id);
        if (!attr) {
          attr = attributeOutcome(o.id);
        }
        results.push({ outcome: o, attribution: attr });
      }
      return NextResponse.json({ results, count: results.length });
    }

    return NextResponse.json({ outcomes, count: outcomes.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = OutcomeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const event = recordOutcome({
      ...parsed.data,
      contextAtObservation: parsed.data.contextAtObservation || {},
    });

    // Auto-attribute
    const attribution = attributeOutcome(event.id);

    return NextResponse.json({ outcome: event, attribution });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
