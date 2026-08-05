import type { ConfidenceBreakdown, ConfidenceLevel } from "@/lib/done/types";

export function confidenceLabel(pct: number): ConfidenceLevel {
  if (pct >= 85) return "very_likely";
  if (pct >= 65) return "likely";
  if (pct >= 40) return "uncertain";
  return "blocked";
}

const labelMap: Record<ConfidenceLevel, { text: string; color: string }> = {
  very_likely: { text: "Very likely", color: "text-status-completed" },
  likely: { text: "Likely", color: "text-status-working" },
  uncertain: { text: "Uncertain", color: "text-status-needs" },
  blocked: { text: "Blocked", color: "text-status-blocked" },
};

export function ConfidenceDisplay({ confidence, p50, p90, deadline, primaryRisk }: {
  confidence: ConfidenceBreakdown;
  p50?: string;
  p90?: string;
  deadline?: string;
  primaryRisk?: string;
}) {
  const dimensions = [
    { label: "On-time probability", value: confidence.onTimeProbability },
    { label: "Data completeness", value: confidence.dataCompleteness },
    { label: "Automated QA coverage", value: confidence.automatedQACoverage },
    { label: "No-revision probability", value: confidence.noRevisionProbability },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {dimensions.map((dim) => {
          const lvl = confidenceLabel(dim.value);
          return (
            <div key={dim.label}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{dim.label}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${labelMap[lvl].color}`}>{labelMap[lvl].text}</span>
                  <span className="font-mono text-foreground/80">{dim.value}%</span>
                </div>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${
                    lvl === "very_likely" ? "bg-status-completed" :
                    lvl === "likely" ? "bg-status-working" :
                    lvl === "uncertain" ? "bg-status-needs" : "bg-status-blocked"
                  }`}
                  style={{ width: `${dim.value}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm">
        {p50 && (
          <div>
            <p className="done-section-label">P50 completion</p>
            <p className="mt-1 text-foreground/80">{p50}</p>
          </div>
        )}
        {p90 && (
          <div>
            <p className="done-section-label">P90 completion</p>
            <p className="mt-1 text-foreground/80">{p90}</p>
          </div>
        )}
        {deadline && (
          <div>
            <p className="done-section-label">Deadline</p>
            <p className="mt-1 text-foreground/80">{deadline}</p>
          </div>
        )}
      </div>

      {primaryRisk && (
        <div className="border-t border-border pt-4">
          <p className="done-section-label">Primary risk</p>
          <p className="mt-1 text-sm text-status-needs">{primaryRisk}</p>
        </div>
      )}
    </div>
  );
}
