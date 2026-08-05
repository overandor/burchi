import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { processInput, toCSV, loadAllTemplates, ProcessResult } from "@/lib/etl/business-process";

const ProcessSchema = z.object({
  input: z.string().min(1),
  inputType: z.enum(["csv", "json", "unknown"]).default("csv"),
  enrich: z.boolean().optional().default(true),
  dedupe: z.boolean().optional().default(true),
  standardize: z.boolean().optional().default(true),
  outputFormat: z.enum(["json", "csv"]).optional().default("json"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ProcessSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { outputFormat, ...processOpts } = parsed.data;
    const result = processInput(parsed.data.input, parsed.data.inputType, {
      enrich: processOpts.enrich,
      dedupe: processOpts.dedupe,
      standardize: processOpts.standardize,
    });

    if (outputFormat === "csv") {
      const csv = toCSV(result.output);
      return NextResponse.json({
        ...result,
        output: undefined,
        csv,
      });
    }

    return NextResponse.json({ result }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const templates = loadAllTemplates();
    return NextResponse.json({ templates, count: templates.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
