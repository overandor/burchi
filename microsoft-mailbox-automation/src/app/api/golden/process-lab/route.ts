import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { goldenEngine } from "@/lib/golden/engine";
import { listProcesses, getProcessesForEmployee, getProcessesForHypothesis, validateProcess, getProcessById } from "@/lib/golden/process-lab";

export const dynamic = "force-dynamic";

/** GET /api/golden/process-lab?employeeId=...&hypothesisId=...&id=...&validate=true */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");
    const hypothesisId = searchParams.get("hypothesisId");
    const id = searchParams.get("id");
    const doValidate = searchParams.get("validate") === "true";

    if (id) {
      const process = getProcessById(id);
      if (!process) return NextResponse.json({ error: "Process not found" }, { status: 404 });
      return NextResponse.json({ process, validation: doValidate ? validateProcess(process) : undefined });
    }
    const processes = employeeId
      ? getProcessesForEmployee(employeeId)
      : hypothesisId
        ? getProcessesForHypothesis(hypothesisId)
        : listProcesses();
    return NextResponse.json({ processes, count: processes.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

const StepSchema = z.object({
  type: z.enum(["trigger", "condition", "action", "wait", "measurement", "stop"]),
  label: z.string().min(1),
  waitHours: z.number().optional(),
  condition: z.string().optional(),
  measures: z.array(z.string()).optional(),
  nextStepIds: z.array(z.string()).default([]),
});

const CreateSchema = z.object({
  name: z.string().min(1),
  objective: z.string().min(1),
  ownerEmployeeId: z.string().min(1),
  hypothesisId: z.string().min(1),
  steps: z.array(StepSchema),
  eligibilityRules: z.array(z.string()),
  humanInterventionPoints: z.array(z.string()),
  measurementDesign: z.array(z.string()),
  complianceBoundary: z.string().min(1),
  parentProcessId: z.string().optional(),
});

/** POST /api/golden/process-lab — create a process in the System Builder. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const { process, compliance } = goldenEngine.createProcess(parsed.data);
    if (!compliance.allowed) return NextResponse.json({ error: "Compliance violations", compliance }, { status: 422 });
    return NextResponse.json({ process, compliance });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

const ModifySchema = z.object({
  processId: z.string().min(1),
  modification: z.record(z.any()),
});

/** PATCH /api/golden/process-lab — modify a process (creates a versioned derivative). */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ModifySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const result = goldenEngine.modifyProcess(parsed.data.processId, parsed.data.modification as any);
    if (!result) return NextResponse.json({ error: "Process not found" }, { status: 404 });
    if (!result.compliance.allowed) return NextResponse.json({ error: "Compliance violations", compliance: result.compliance }, { status: 422 });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
