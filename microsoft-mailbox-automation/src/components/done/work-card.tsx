import Link from "next/link";
import type { WorkItem } from "@/lib/done/types";
import { StatusBadge } from "./status-badge";

export function WorkCard({ item }: { item: WorkItem }) {
  return (
    <Link href={`/work/${item.id}`} className="block">
      <div className="card p-5 transition-all hover:border-muted-foreground/30">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-foreground">{item.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>Requested by: <span className="text-foreground/80">{item.requester}</span></span>
              <span>Deadline: <span className="text-foreground/80">{item.deadline}</span></span>
            </div>
          </div>
          <StatusBadge status={item.status} />
        </div>

        {item.status === "completed" && item.deliverables && (
          <div className="mt-4">
            <p className="done-section-label mb-2">Delivered</p>
            <ul className="space-y-1">
              {item.deliverables.map((d) => (
                <li key={d.name} className="flex items-center gap-2 text-sm text-foreground/80">
                  <svg className="h-4 w-4 flex-shrink-0 text-status-completed" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {d.name}
                  {d.recommended && <span className="badge border-status-completed/30 bg-status-completed/10 text-status-completed ml-1">Recommended</span>}
                </li>
              ))}
            </ul>
            {item.dataCoverage != null && item.recommendationConfidence != null && (
              <div className="mt-3 flex gap-6 text-sm text-muted-foreground">
                <span>Data coverage: <span className="font-mono text-foreground/80">{item.dataCoverage}%</span></span>
                <span>Recommendation confidence: <span className="font-mono text-foreground/80">{item.recommendationConfidence}%</span></span>
              </div>
            )}
          </div>
        )}

        {item.status === "working" && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{item.title}</span>
              <span className="font-mono text-foreground/80">{item.progress}% complete</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-status-working transition-all" style={{ width: `${item.progress}%` }} />
            </div>
            {item.p90Completion && (
              <p className="mt-2 text-sm text-muted-foreground">P90 completion: <span className="text-foreground/80">{item.p90Completion}</span></p>
            )}
          </div>
        )}

        {item.status === "needs" && (
          <div className="mt-4">
            <p className="text-sm text-status-needs">Approval required — external organizational commitment</p>
            <span className="mt-2 inline-flex text-sm font-medium text-status-needs">Review now →</span>
          </div>
        )}

        {item.status === "blocked" && (
          <div className="mt-4">
            <p className="text-sm text-status-blocked">{item.primaryRisk}</p>
            {item.dependencies.map((dep) => (
              <p key={dep.description} className="mt-1 text-sm text-muted-foreground">
                Blocked by: <span className="text-foreground/80">{dep.description}</span>
              </p>
            ))}
          </div>
        )}

        {item.status === "new" && (
          <div className="mt-4">
            <p className="text-sm text-muted-foreground">
              {item.mandatoryOutputs.length} required outputs detected. Execution will start automatically.
            </p>
          </div>
        )}
      </div>
    </Link>
  );
}
