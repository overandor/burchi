"use client";

import { useState, useMemo } from "react";
import { CommitmentContract, AutonomyClass, CommitmentStatus } from "@/types";
import { generateSampleCommitments } from "@/lib/commitment/detector";

const AUTONOMY_BADGE: Record<AutonomyClass, { label: string; color: string }> = {
  1: { label: "Fully Autonomous", color: "bg-green-100 text-green-700 border-green-200" },
  2: { label: "Complete then Approve", color: "bg-blue-100 text-blue-700 border-blue-200" },
  3: { label: "Plan and Escalate", color: "bg-orange-100 text-orange-700 border-orange-200" },
  4: { label: "Prohibited", color: "bg-red-100 text-red-700 border-red-200" },
};

const STATUS_BADGE: Record<CommitmentStatus, string> = {
  detected: "bg-slate-100 text-slate-600",
  executing: "bg-blue-100 text-blue-700",
  awaiting_approval: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  escalated: "bg-purple-100 text-purple-700",
  declined: "bg-rose-100 text-rose-700",
};

const ROLE_COLORS: Record<string, string> = {
  field_representative: "bg-indigo-100 text-indigo-700",
  regional_manager: "bg-purple-100 text-purple-700",
  medical_affairs: "bg-teal-100 text-teal-700",
  market_access: "bg-orange-100 text-orange-700",
  compliance: "bg-red-100 text-red-700",
};

function getDaysUntil(deadline: string): { text: string; urgent: boolean } {
  const now = new Date();
  const dl = new Date(deadline);
  if (isNaN(dl.getTime())) return { text: "—", urgent: false };
  const diff = dl.getTime() - now.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, urgent: true };
  if (days === 0) return { text: `${hours}h remaining`, urgent: hours < 8 };
  return { text: `${days}d remaining`, urgent: days <= 1 };
}

export default function CommitmentsPage() {
  const [commitments, setCommitments] = useState<CommitmentContract[]>(() => generateSampleCommitments());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const stats = useMemo(() => ({
    total: commitments.length,
    executing: commitments.filter((c) => c.status === "executing").length,
    awaiting: commitments.filter((c) => c.status === "awaiting_approval").length,
    completed: commitments.filter((c) => c.status === "completed").length,
  }), [commitments]);

  const simulateExecution = (id: string) => {
    setCommitments((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const next: CommitmentStatus =
          c.status === "detected" ? "executing" :
          c.status === "executing" ? "awaiting_approval" :
          c.status === "awaiting_approval" ? "completed" :
          c.status;
        const event = { timestamp: new Date().toISOString(), event: `status_changed`, detail: `${c.status} → ${next}` };
        return {
          ...c,
          status: next,
          executedAt: c.status === "detected" ? new Date().toISOString() : c.executedAt,
          completedAt: next === "completed" ? new Date().toISOString() : c.completedAt,
          auditEvents: [...c.auditEvents, event],
        };
      })
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto max-w-7xl px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Commitment Execution Engine</h1>
          <p className="mt-1 text-sm text-slate-500">Role-aware autonomous workmail — receive work, complete it, verify it, return deliverables before the deadline</p>
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-4 gap-4">
          {[
            { label: "Total Commitments", value: stats.total, color: "from-slate-500 to-slate-600" },
            { label: "Executing", value: stats.executing, color: "from-blue-500 to-indigo-500" },
            { label: "Awaiting Approval", value: stats.awaiting, color: "from-amber-500 to-orange-500" },
            { label: "Completed", value: stats.completed, color: "from-green-500 to-emerald-500" },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
              <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${s.color} text-white text-sm font-bold`}>{s.value}</div>
              <p className="text-xs font-medium text-slate-500">{s.label}</p>
            </div>
          ))}
        </div>

        {/* No Questions Protocol */}
        <div className="mb-6 rounded-2xl border border-indigo-200/60 bg-gradient-to-br from-indigo-50 to-purple-50 p-4">
          <h3 className="text-sm font-semibold text-indigo-900">"No Questions" Completion Protocol</h3>
          <p className="mt-1 text-xs text-indigo-700">The system generally does not stop because a request is imperfectly specified. It infers from context, selects reasonable defaults, records assumptions, and continues unless ambiguity creates material risk.</p>
        </div>

        {/* Commitment Cards */}
        <div className="space-y-3">
          {commitments.map((c) => {
            const isExpanded = expandedId === c.id;
            const deadline = getDaysUntil(c.deadline);
            const autonomy = AUTONOMY_BADGE[c.autonomyClass];
            return (
              <div key={c.id} className="rounded-2xl border border-slate-200/60 bg-white shadow-sm overflow-hidden">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                  className="w-full p-4 text-left hover:bg-slate-50/50 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-slate-900 truncate">{c.emailSubject}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[c.status]}`}>{c.status.replace(/_/g, " ")}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${autonomy.color}`}>Class {c.autonomyClass}: {autonomy.label}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-slate-500">From: {c.requester}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ROLE_COLORS[c.recipientRole] || "bg-slate-100 text-slate-600"}`}>{c.recipientRole.replace(/_/g, " ")}</span>
                        <span className={`text-[10px] font-medium ${c.authorityVerified ? "text-green-600" : "text-red-500"}`}>
                          {c.authorityVerified ? "✓ Authority verified" : "✗ Authority unverified"}
                        </span>
                        <span className={`text-[10px] font-medium ${deadline.urgent ? "text-red-600" : "text-slate-400"}`}>⏱ {deadline.text}</span>
                      </div>
                    </div>
                    {/* Completion Probability */}
                    <div className="flex-shrink-0 text-center">
                      <div className="relative h-12 w-12">
                        <svg className="h-12 w-12 -rotate-90" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                          <circle cx="18" cy="18" r="15" fill="none" stroke="#6366f1" strokeWidth="3" strokeDasharray={`${c.completionProbability * 94.2} 94.2`} strokeLinecap="round" />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-700">{(c.completionProbability * 100).toFixed(0)}%</span>
                      </div>
                      <span className="text-[9px] text-slate-400">completion</span>
                    </div>
                    <svg className={`h-5 w-5 flex-shrink-0 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 p-4 bg-slate-50/30 space-y-4">
                    {/* Requested Outcome */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Requested Outcome</h4>
                      <p className="text-sm text-slate-700">{c.requestedOutcome}</p>
                    </div>

                    {/* Mandatory Outputs */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Mandatory Outputs</h4>
                      <ul className="space-y-1">
                        {c.mandatoryOutputs.map((o, i) => (
                          <li key={i} className="flex items-center gap-2 text-xs text-slate-600">
                            <span className={`h-3 w-3 rounded border ${c.status === "completed" ? "bg-green-500 border-green-500" : "border-slate-300"}`} />
                            {o}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Inferred Outputs */}
                    {c.inferredOutputs.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Inferred Outputs (Overdelivery)</h4>
                        <div className="flex flex-wrap gap-1.5">
                          {c.inferredOutputs.map((o, i) => (
                            <span key={i} className="rounded bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-600">{o}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Permitted Tools */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Permitted Tools</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {c.permittedTools.map((t, i) => (
                          <span key={i} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-600">{t}</span>
                        ))}
                      </div>
                    </div>

                    {/* Dependencies */}
                    {c.dependencies.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Dependencies</h4>
                        {c.dependencies.map((d, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-slate-600">
                            <span>⚠ {d.description}</span>
                            <span className="text-red-500 font-mono">{(d.blocksProbability * 100).toFixed(0)}% block risk</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Assumptions */}
                    {c.assumptions.length > 0 && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                        <h4 className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Recorded Assumptions</h4>
                        {c.assumptions.map((a, i) => (
                          <p key={i} className="text-xs text-amber-600">• {a}</p>
                        ))}
                      </div>
                    )}

                    {/* P50/P90 */}
                    {(c.p50Completion || c.p90Completion) && (
                      <div className="grid grid-cols-2 gap-3">
                        {c.p50Completion && (
                          <div className="rounded-lg bg-slate-100 p-2 text-center">
                            <div className="text-[10px] text-slate-400">P50 Completion</div>
                            <div className="text-sm font-semibold text-slate-700">{c.p50Completion}</div>
                          </div>
                        )}
                        {c.p90Completion && (
                          <div className="rounded-lg bg-slate-100 p-2 text-center">
                            <div className="text-[10px] text-slate-400">P90 Completion</div>
                            <div className="text-sm font-semibold text-slate-700">{c.p90Completion}</div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Audit Events */}
                    {c.auditEvents.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Audit Trail</h4>
                        <div className="space-y-1">
                          {c.auditEvents.map((e, i) => (
                            <div key={i} className="flex items-center gap-2 text-[10px] text-slate-400">
                              <span className="font-mono">{new Date(e.timestamp).toLocaleTimeString()}</span>
                              <span>{e.detail}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Button */}
                    {c.status !== "completed" && c.status !== "declined" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); simulateExecution(c.id); }}
                        className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:scale-[1.02]"
                      >
                        {c.status === "detected" ? "Start Execution" : c.status === "executing" ? "Submit for Approval" : "Approve & Complete"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Autonomy Class Legend */}
        <div className="mt-8 rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Autonomy Classes</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { cls: 1, name: "Fully Autonomous", desc: "Safe, reversible, internally verifiable. System completes and places result in thread." },
              { cls: 2, name: "Complete then Approve", desc: "System performs all work, requires one-click approval before external actions." },
              { cls: 3, name: "Plan and Escalate", desc: "Preparatory work done, escalated as nearly-completed package for human judgment." },
              { cls: 4, name: "Prohibited", desc: "System refuses, records reason, provides permitted alternative." },
            ].map((a) => (
              <div key={a.cls} className={`rounded-xl border p-3 ${AUTONOMY_BADGE[a.cls as AutonomyClass].color}`}>
                <div className="text-sm font-semibold">Class {a.cls}: {a.name}</div>
                <p className="mt-0.5 text-xs opacity-80">{a.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Constructive Overdelivery */}
        <div className="mt-4 rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Constructive Overdelivery</h3>
          <div className="grid grid-cols-3 gap-3">
            {[
              { layer: "Layer 1", name: "Exact Fulfillment", desc: "Complete exactly what was requested.", color: "border-green-200 bg-green-50" },
              { layer: "Layer 2", name: "Decision Enhancement", desc: "Add analysis that helps the recipient understand or use the result.", color: "border-blue-200 bg-blue-50" },
              { layer: "Layer 3", name: "Execution Acceleration", desc: "Prepare the next actions that would otherwise become another round of email.", color: "border-purple-200 bg-purple-50" },
            ].map((l) => (
              <div key={l.layer} className={`rounded-xl border p-3 ${l.color}`}>
                <div className="text-xs font-semibold text-slate-700">{l.layer} — {l.name}</div>
                <p className="mt-0.5 text-xs text-slate-500">{l.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
