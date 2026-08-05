import { nanoid } from "nanoid";
import {
  ProcessDefinition,
  ProcessStep,
  ProcessStepType,
  HypothesisAssignment,
} from "@/types";
import { loadProcesses, saveProcesses, loadHypothesisAssignments, saveHypothesisAssignments } from "@/lib/config";
import { checkProcess } from "./compliance";

const now = () => new Date().toISOString();

export function listProcesses(): ProcessDefinition[] {
  return loadProcesses();
}

export function getProcessById(id: string): ProcessDefinition | undefined {
  return loadProcesses().find((p) => p.id === id);
}

export function getProcessesForEmployee(employeeId: string): ProcessDefinition[] {
  return loadProcesses().filter((p) => p.ownerEmployeeId === employeeId);
}

export function getProcessesForHypothesis(hypothesisId: string): ProcessDefinition[] {
  return loadProcesses().filter((p) => p.hypothesisId === hypothesisId);
}

function upsertProcess(p: ProcessDefinition): void {
  const all = loadProcesses();
  const idx = all.findIndex((x) => x.id === p.id);
  if (idx >= 0) all[idx] = p;
  else all.push(p);
  saveProcesses(all);
}

export interface ProcessInput {
  name: string;
  objective: string;
  ownerEmployeeId: string;
  hypothesisId: string;
  steps: Omit<ProcessStep, "id">[];
  eligibilityRules: string[];
  humanInterventionPoints: string[];
  measurementDesign: string[];
  complianceBoundary: string;
  parentProcessId?: string;
}

/** Create a new process in the System Builder laboratory.
 *  Every modification creates a testable derivative. (GOLDEN NODE §5, §6) */
export function createProcess(input: ProcessInput): {
  process: ProcessDefinition;
  compliance: ReturnType<typeof checkProcess>;
} {
  const steps: ProcessStep[] = input.steps.map((s) => ({ ...s, id: `step_${nanoid(6)}` }));
  const process: ProcessDefinition = {
    id: `proc_${nanoid(8)}`,
    name: input.name,
    objective: input.objective,
    ownerEmployeeId: input.ownerEmployeeId,
    hypothesisId: input.hypothesisId,
    steps,
    eligibilityRules: input.eligibilityRules,
    humanInterventionPoints: input.humanInterventionPoints,
    measurementDesign: input.measurementDesign,
    complianceBoundary: input.complianceBoundary,
    version: 1,
    parentProcessId: input.parentProcessId,
    createdAt: now(),
    updatedAt: now(),
  };
  const compliance = checkProcess(process);
  if (compliance.allowed) {
    upsertProcess(process);
  }
  return { process, compliance };
}

/** Modify a process step. Each modification creates a new versioned derivative. */
export function modifyProcess(
  processId: string,
  modification: ProcessModification
): { process: ProcessDefinition; compliance: ReturnType<typeof checkProcess> } | undefined {
  const parent = getProcessById(processId);
  if (!parent) return undefined;

  // Preserve existing step ids so modification references resolve; only new steps get fresh ids.
  const newSteps = parent.steps.map((s) => ({ ...s, nextStepIds: [...s.nextStepIds] }));
  applyModification(newSteps, modification);

  const derivative: ProcessDefinition = {
    ...parent,
    id: `proc_${nanoid(8)}`,
    steps: newSteps,
    version: parent.version + 1,
    parentProcessId: parent.id,
    updatedAt: now(),
  };
  const compliance = checkProcess(derivative);
  if (compliance.allowed) {
    upsertProcess(derivative);
  }
  return { process: derivative, compliance };
}

export type ProcessModification =
  | { type: "add_step"; afterStepId: string | null; step: Omit<ProcessStep, "id"> }
  | { type: "remove_step"; stepId: string }
  | { type: "reorder"; stepIds: string[] }
  | { type: "change_timing"; stepId: string; waitHours: number }
  | { type: "add_automation"; stepId: string; label: string }
  | { type: "add_human_checkpoint"; afterStepId: string; label: string }
  | { type: "add_stop_condition"; stepId: string; condition: string };

function applyModification(steps: ProcessStep[], mod: ProcessModification): void {
  switch (mod.type) {
    case "add_step": {
      const newStep: ProcessStep = { ...mod.step, id: `step_${nanoid(6)}` };
      if (mod.afterStepId === null) {
        steps.unshift(newStep);
      } else {
        const idx = steps.findIndex((s) => s.id === mod.afterStepId);
        if (idx >= 0) steps.splice(idx + 1, 0, newStep);
      }
      break;
    }
    case "remove_step": {
      const idx = steps.findIndex((s) => s.id === mod.stepId);
      if (idx >= 0) steps.splice(idx, 1);
      break;
    }
    case "reorder": {
      const map = new Map(steps.map((s) => [s.id, s]));
      const reordered = mod.stepIds.map((id) => map.get(id)!).filter(Boolean);
      steps.length = 0;
      steps.push(...reordered);
      break;
    }
    case "change_timing": {
      const step = steps.find((s) => s.id === mod.stepId);
      if (step) step.waitHours = mod.waitHours;
      break;
    }
    case "add_automation": {
      const step = steps.find((s) => s.id === mod.stepId);
      if (step) step.label = `${step.label} (automated: ${mod.label})`;
      break;
    }
    case "add_human_checkpoint": {
      const newStep: ProcessStep = {
        id: `step_${nanoid(6)}`,
        type: "condition",
        label: `Human checkpoint: ${mod.label}`,
        condition: "human_approval_required",
        nextStepIds: [],
      };
      const idx = steps.findIndex((s) => s.id === mod.afterStepId);
      if (idx >= 0) steps.splice(idx + 1, 0, newStep);
      break;
    }
    case "add_stop_condition": {
      const step = steps.find((s) => s.id === mod.stepId);
      if (step) {
        step.condition = mod.condition;
        step.type = "stop";
      }
      break;
    }
  }
}

/** Validate a process structure: must have a trigger and a measurement. */
export interface ProcessValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateProcess(p: ProcessDefinition): ProcessValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!p.steps.some((s) => s.type === "trigger")) errors.push("Process must have a trigger step");
  if (!p.steps.some((s) => s.type === "measurement")) warnings.push("Process should have a measurement step");
  if (!p.steps.some((s) => s.type === "action")) errors.push("Process must have at least one action step");
  if (p.steps.some((s) => s.type === "wait" && (!s.waitHours || s.waitHours <= 0))) {
    warnings.push("Wait steps should specify positive hours");
  }
  return { valid: errors.length === 0, errors, warnings };
}

/** Link a process to a builder assignment. */
export function attachProcessToAssignment(processId: string, assignmentId: string): void {
  const all = loadHypothesisAssignments();
  const idx = all.findIndex((a) => a.id === assignmentId);
  if (idx >= 0) {
    all[idx].processOwnershipId = processId;
    saveHypothesisAssignments(all);
  }
}

/** Get the assignment a process is attached to. */
export function getAssignmentForProcess(processId: string): HypothesisAssignment | undefined {
  return loadHypothesisAssignments().find((a) => a.processOwnershipId === processId);
}

/** Step type labels for the UI. */
export const STEP_TYPE_LABELS: Record<ProcessStepType, string> = {
  trigger: "Trigger",
  condition: "Condition",
  action: "Action",
  wait: "Wait",
  measurement: "Measurement",
  stop: "Stop condition",
};
