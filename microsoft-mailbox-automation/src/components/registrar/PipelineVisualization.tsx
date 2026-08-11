"use client";

import { PIPELINE_STAGES, PipelineStage } from "./types";

export type NodeState = "healthy" | "active" | "failed" | "waiting" | "idle";

interface Props {
  /** State for each stage, keyed by stage name. Unset = idle. */
  states?: Partial<Record<PipelineStage, NodeState>>;
  /** Compact mode for inline display. */
  compact?: boolean;
  /** Called when a stage node is clicked. */
  onStageClick?: (stage: PipelineStage) => void;
}

export function PipelineVisualization({ states = {}, compact = false, onStageClick }: Props) {
  return (
    <div className={`flex items-center gap-1 ${compact ? "flex-wrap" : "overflow-x-auto pb-2"}`}>
      {PIPELINE_STAGES.map((stage, i) => {
        const state = states[stage] || "idle";
        const nodeClass =
          state === "healthy" ? "pipe-node-healthy" :
          state === "active" ? "pipe-node-active" :
          state === "failed" ? "pipe-node-failed" :
          state === "waiting" ? "pipe-node-waiting" :
          "pipe-node-idle";

        const dotColor =
          state === "healthy" ? "bg-[hsl(var(--cockpit-healthy))]" :
          state === "active" ? "bg-[hsl(var(--cockpit-cyan))]" :
          state === "failed" ? "bg-[hsl(var(--cockpit-critical))]" :
          state === "waiting" ? "bg-[hsl(var(--cockpit-warning))]" :
          "bg-[hsl(var(--cockpit-text-dim) / 0.4)]";

        const symbol =
          state === "healthy" ? "✓" :
          state === "active" ? "●" :
          state === "failed" ? "✕" :
          state === "waiting" ? "◐" :
          "○";

        const symbolColor =
          state === "healthy" ? "text-[hsl(var(--cockpit-healthy))]" :
          state === "active" ? "text-[hsl(var(--cockpit-cyan))]" :
          state === "failed" ? "text-[hsl(var(--cockpit-critical))]" :
          state === "waiting" ? "text-[hsl(var(--cockpit-warning))]" :
          "text-[hsl(var(--cockpit-text-dim))]";

        return (
          <div key={stage} className="flex items-center">
            <button
              onClick={() => onStageClick?.(stage)}
              className={`pipe-node ${nodeClass} group flex flex-col items-center justify-center rounded-lg border px-3 py-2.5 ${compact ? "min-w-[72px]" : "min-w-[88px]"} cursor-pointer`}
              title={`${stage}: ${state}`}
            >
              <span className={`text-sm font-bold ${symbolColor}`}>{symbol}</span>
              <span className={`mt-1 text-[10px] font-mono-tech tracking-wider ${compact ? "hidden" : "block"} ${
                state === "idle" ? "cockpit-text-dim" : "cockpit-text"
              }`}>
                {stage}
              </span>
              {compact && (
                <span className={`text-[9px] font-mono-tech ${state === "idle" ? "cockpit-text-dim" : "cockpit-text"}`}>
                  {stage.slice(0, 4)}
                </span>
              )}
            </button>
            {i < PIPELINE_STAGES.length - 1 && (
              <div className={`h-px w-4 sm:w-6 ${state === "active" || state === "healthy" ? "pipe-connector-active" : "bg-[hsl(var(--cockpit-border))]"} ${compact ? "w-3" : ""}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
