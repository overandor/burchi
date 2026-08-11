"use client";

import { useState, useMemo } from "react";
import { VentureCandidate, VentureGenome } from "@/types";
import { generateSampleVentures, getVentureProgressionStages, getVentureCriteria } from "@/lib/ventureforge/factory";

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-700",
  moderate: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
};

const STAGE_COLORS: Record<string, string> = {
  one_task: "bg-slate-100 text-slate-600",
  reusable_workflow: "bg-blue-100 text-blue-700",
  skill_genome: "bg-cyan-100 text-cyan-700",
  validated_experiment: "bg-teal-100 text-teal-700",
  internal_system: "bg-indigo-100 text-indigo-700",
  cross_team_service: "bg-violet-100 text-violet-700",
  externalizable_product: "bg-purple-100 text-purple-700",
  independent_business: "bg-emerald-100 text-emerald-700",
};

export default function VenturesPage() {
  const [ventures] = useState<VentureCandidate[]>(() => generateSampleVentures());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const stages = useMemo(() => getVentureProgressionStages(), []);
  const criteria = useMemo(() => getVentureCriteria(), []);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto max-w-7xl px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">VENTUREFORGE</h1>
          <p className="mt-1 text-sm text-slate-500">Converts proven workflows into systems, products, and independent business channels</p>
        </div>

        {/* Venture Progression */}
        <div className="mb-6 rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Venture Progression Pipeline</h3>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {stages.map((s, i) => (
              <div key={s.stage} className="flex items-center gap-1 flex-shrink-0">
                <div className="text-center">
                  <div className={`rounded-lg px-3 py-1.5 text-[10px] font-medium ${STAGE_COLORS[s.stage] || "bg-slate-100"}`}>
                    {s.stage.replace(/_/g, " ")}
                  </div>
                  <div className="mt-1 max-w-[120px] text-[9px] text-slate-400">{s.description}</div>
                </div>
                {i < stages.length - 1 && <span className="text-slate-300 text-lg">→</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Venture Cards */}
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900">Venture Candidates</h2>
          {ventures.map((vc) => {
            const isExpanded = expandedId === vc.id;
            return (
              <div key={vc.id} className="rounded-2xl border border-slate-200/60 bg-white shadow-sm overflow-hidden">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : vc.id)}
                  className="w-full p-4 text-left hover:bg-slate-50/50 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-slate-900">{vc.name}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STAGE_COLORS[vc.progressionStage] || "bg-slate-100"}`}>
                          {vc.progressionStage.replace(/_/g, " ")}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${RISK_COLORS[vc.riskLevel]}`}>{vc.riskLevel} risk</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{vc.description}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">Origin: {vc.originWorkflow}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-lg font-bold text-indigo-600">${(vc.estimatedMarketSize / 1_000_000).toFixed(1)}M</div>
                      <div className="text-[9px] text-slate-400">market size</div>
                    </div>
                    <svg className={`h-5 w-5 flex-shrink-0 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 p-4 bg-slate-50/30 space-y-4">
                    {/* Evidence */}
                    <div>
                      <h4 className="mb-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">Evidence</h4>
                      <ul className="space-y-1">
                        {vc.evidence.map((e, i) => (
                          <li key={i} className="text-xs text-slate-600">• {e}</li>
                        ))}
                      </ul>
                    </div>

                    {/* Metrics */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg bg-white p-2 border border-slate-200 text-center">
                        <div className="text-sm font-bold text-slate-700">${(vc.estimatedMarketSize / 1_000_000).toFixed(1)}M</div>
                        <div className="text-[10px] text-slate-400">Est. Market Size</div>
                      </div>
                      <div className="rounded-lg bg-white p-2 border border-slate-200 text-center">
                        <div className="text-sm font-bold text-slate-700">{vc.estimatedTimeToMarket} months</div>
                        <div className="text-[10px] text-slate-400">Time to Market</div>
                      </div>
                      <div className="rounded-lg bg-white p-2 border border-slate-200 text-center">
                        <div className={`text-sm font-bold ${vc.riskLevel === "low" ? "text-green-600" : vc.riskLevel === "moderate" ? "text-blue-600" : "text-orange-600"}`}>{vc.riskLevel}</div>
                        <div className="text-[10px] text-slate-400">Risk Level</div>
                      </div>
                    </div>

                    {/* Recommendation */}
                    <div className="rounded-xl border border-indigo-200/60 bg-indigo-50/50 p-3">
                      <h4 className="text-xs font-semibold text-indigo-900 mb-1">Recommendation</h4>
                      <p className="text-sm text-indigo-700">{vc.recommendation}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Venture Criteria */}
        <div className="mt-8 rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Venture Genome Criteria</h3>
          <div className="grid grid-cols-2 gap-3">
            {criteria.map((c) => (
              <div key={c.criterion} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700">{c.criterion}</span>
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-600">{(c.weight * 100).toFixed(0)}%</span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{c.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Palindromic Invariant */}
        <div className="mt-4 rounded-2xl border border-purple-200/60 bg-gradient-to-br from-purple-50 to-indigo-50 p-5">
          <h3 className="mb-2 text-sm font-semibold text-purple-900">The Palindromic Invariant</h3>
          <p className="text-xs text-purple-700 mb-2">
            Every request must remain traceable to evidence, every execution to authority, every output to verification, every improvement to an experiment, and every potential business to a reproducible operating mechanism.
          </p>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {["Evidence", "Authority", "Task", "Pipeline", "Output", "Outcome", "Skill", "Experiment", "System", "Venture", "System", "Experiment", "Skill", "Outcome", "Output", "Pipeline", "Task", "Authority", "Evidence"].map((stage, i) => (
              <div key={i} className="flex items-center gap-1 flex-shrink-0">
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${i < 9 ? "bg-purple-100 text-purple-700" : "bg-indigo-100 text-indigo-700"}`}>{stage}</span>
                {i < 18 && <span className="text-slate-300 text-[8px]">→</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
