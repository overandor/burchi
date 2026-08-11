import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { generatePipeline, savePipeline, loadPipeline, loadAllPipelines, advanceStep } from "@/lib/etl/pipeline-engine";

const GenerateSchema = z.object({
  emailId: z.string().min(1),
  sender: z.string(),
  subject: z.string(),
  body: z.string(),
  receivedAt: z.string().default(() => new Date().toISOString()),
  attachments: z.array(z.object({
    filename: z.string(),
    contentType: z.string(),
    size: z.number(),
  })).optional().default([]),
});

export async function GET() {
  try {
    const pipelines = loadAllPipelines();
    return NextResponse.json({ pipelines, count: pipelines.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = GenerateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const pipeline = generatePipeline(parsed.data);
    savePipeline(pipeline);
    return NextResponse.json({ pipeline }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
