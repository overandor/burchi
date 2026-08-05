import { CommitmentConfidenceBreakdown, CommitmentMetrics } from "@/types";

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function rate(success: number, total: number, priorAlpha: number, priorBeta: number): number {
  if (!Number.isFinite(success) || !Number.isFinite(total)) return clamp01(priorAlpha / (priorAlpha + priorBeta));
  const s = Math.max(0, success);
  const t = Math.max(0, total);
  const denom = t + priorAlpha + priorBeta;
  if (denom <= 0) return 0;
  return clamp01((s + priorAlpha) / denom);
}

/**
 * Convert historical outcomes into a calibrated probability breakdown.
 *
 * This is intentionally simple and fully auditable:
 * - each component is an empirical success rate
 * - overall is multiplicative, matching the spec
 */
export function computeConfidenceBreakdown(metrics: CommitmentMetrics): CommitmentConfidenceBreakdown {
  const capability = rate(metrics.capability.success, metrics.capability.total, 9, 1);
  const inputsAvailable = rate(metrics.inputsAvailable.success, metrics.inputsAvailable.total, 9, 1);
  const toolCompletion = rate(metrics.toolCompletion.success, metrics.toolCompletion.total, 9, 1);
  const qualityApproval = rate(metrics.qualityApproval.success, metrics.qualityApproval.total, 9, 1);
  const acceptedWithoutRevision = rate(
    metrics.acceptedWithoutRevision.success,
    metrics.acceptedWithoutRevision.total,
    7,
    3,
  );

  const overall = clamp01(
    capability *
      inputsAvailable *
      toolCompletion *
      qualityApproval *
      acceptedWithoutRevision,
  );

  return {
    capability,
    inputsAvailable,
    toolCompletion,
    qualityApproval,
    acceptedWithoutRevision,
    overall,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const weight = idx - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

export function estimateCompletionTimes(metrics: CommitmentMetrics): {
  p50Ms: number | null;
  p90Ms: number | null;
} {
  const durations = Array.isArray(metrics.durationsMs) ? metrics.durationsMs.filter((d) => d > 0) : [];
  if (durations.length < 5) {
    return { p50Ms: null, p90Ms: null };
  }

  const sorted = [...durations].sort((a, b) => a - b);
  return {
    p50Ms: Math.round(percentile(sorted, 0.5)),
    p90Ms: Math.round(percentile(sorted, 0.9)),
  };
}
