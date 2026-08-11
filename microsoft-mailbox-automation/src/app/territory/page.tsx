"use client";

import { useState, useEffect, useMemo } from "react";
import { TerritoryAccount, TerritoryOpportunityMap, HCPFunnelState, BarrierType, SpinoredAnalysis, ContentRecommendation } from "@/types";
import { generateSampleAccounts, generateOpportunityMap, calculatePriorityScore } from "@/lib/territory/scorer";

const FUNNEL_COLORS: Record<HCPFunnelState, string> = {
  eligible: "bg-slate-100 text-slate-700",
  relevant_population: "bg-blue-100 text-blue-700",
  info_gap: "bg-cyan-100 text-cyan-700",
  access_opportunity: "bg-teal-100 text-teal-700",
  engagement_attempted: "bg-indigo-100 text-indigo-700",
  meaningful_interaction: "bg-violet-100 text-violet-700",
  content_consumed: "bg-purple-100 text-purple-700",
  barrier_identified: "bg-amber-100 text-amber-700",
  barrier_addressed: "bg-yellow-100 text-yellow-700",
  treatment_consideration: "bg-orange-100 text-orange-700",
  patient_initiation: "bg-green-100 text-green-700",
  persistence: "bg-emerald-100 text-emerald-700",
};

const BARRIER_COLORS: Record<BarrierType, string> = {
  none: "text-slate-400",
  awareness: "text-slate-600",
  scientific_understanding: "text-blue-600",
  patient_eligibility: "text-cyan-600",
  formulary: "text-orange-600",
  diagnosis_testing: "text-purple-600",
  referral_pathway: "text-indigo-600",
  reimbursement: "text-red-600",
  office_workflow: "text-amber-600",
  treatment_initiation: "text-teal-600",
  persistence: "text-emerald-600",
  access: "text-rose-600",
};

const AUTONOMY_COLORS: Record<number, string> = {
  1: "bg-green-100 text-green-700 border-green-200",
  2: "bg-blue-100 text-blue-700 border-blue-200",
  3: "bg-orange-100 text-orange-700 border-orange-200",
  4: "bg-red-100 text-red-700 border-red-200",
};

const AUTONOMY_LABELS: Record<number, string> = {
  1: "Autonomous",
  2: "Approve First",
  3: "Escalate",
  4: "Prohibited",
};

function ScoreBar({ value, max = 100, color = "indigo" }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="h-2 w-full rounded-full bg-slate-100">
      <div className={`h-2 rounded-full bg-${color}-500 transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ScoreComponent({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-mono text-slate-400 w-6">{label}</span>
      <div className="flex-1">
        <ScoreBar value={value} max={1} color={color} />
      </div>
      <span className="text-[10px] font-mono text-slate-500 w-8 text-right">{value.toFixed(2)}</span>
    </div>
  );
}

export default function TerritoryPage() {
  const [accounts, setAccounts] = useState<TerritoryAccount[]>([]);
  const [opportunityMap, setOpportunityMap] = useState<TerritoryOpportunityMap | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [spinoredCache, setSpinoredCache] = useState<Record<string, SpinoredAnalysis>>({});
  const [contentCache, setContentCache] = useState<Record<string, ContentRecommendation[]>>({});

  useEffect(() => {
    const accts = generateSampleAccounts();
    setAccounts(accts);
    setOpportunityMap(generateOpportunityMap(accts));
    setSpinoredCache({});
    setContentCache({});
  }, []);

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!spinoredCache[id]) {
      const acct = accounts.find((a) => a.id === id);
      if (acct) {
        try {
          const res = await fetch("/api/territory/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account: acct }),
          });
          if (!res.ok) throw new Error(`Analyze failed: ${res.status}`);
          const { spinored, recommendations } = await res.json();
          setSpinoredCache((prev) => ({ ...prev, [id]: spinored }));
          setContentCache((prev) => ({ ...prev, [id]: Array.isArray(recommendations) ? recommendations : [] }));
        } catch (e) {
          // Fallback to empty / cached values if the API is unavailable.
          setSpinoredCache((prev) => ({ ...prev, [id]: null as any }));
          setContentCache((prev) => ({ ...prev, [id]: [] }));
        }
      }
    }
  };

  const handleRefresh = () => {
    const accts = generateSampleAccounts();
    setAccounts(accts);
    setOpportunityMap(generateOpportunityMap(accts));
    setSpinoredCache({});
    setContentCache({});
    setExpandedId(null);
  };

  if (!opportunityMap) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-500" />
      </div>
    );
  }

  const coverageTotal = opportunityMap.recommendedCoverage.inPerson + opportunityMap.recommendedCoverage.remote + opportunityMap.recommendedCoverage.defer;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto max-w-7xl px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Territory Intelligence Spine</h1>
            <p className="mt-1 text-sm text-slate-500">Dynamic territory opportunity decomposition — who to engage, about what, through which channel, at what time</p>
          </div>
          <button
            onClick={handleRefresh}
            className="rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:scale-105"
          >
            Refresh Data
          </button>
        </div>

        {/* Summary Stats */}
        <div className="mb-6 grid grid-cols-4 gap-4">
          {[
            { label: "Total Accounts", value: opportunityMap.totalAccounts, color: "from-slate-500 to-slate-600" },
            { label: "Stalled Accounts", value: opportunityMap.stalledAccounts, color: "from-amber-500 to-orange-500" },
            { label: "High-Priority", value: opportunityMap.highPriorityAccounts, color: "from-red-500 to-rose-500" },
            { label: "In-Person Visits", value: opportunityMap.recommendedCoverage.inPerson, color: "from-indigo-500 to-purple-500" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
              <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${stat.color} text-white text-sm font-bold`}>
                {stat.value}
              </div>
              <p className="text-xs font-medium text-slate-500">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Territory Summary */}
        <div className="mb-6 rounded-2xl border border-indigo-200/60 bg-gradient-to-br from-indigo-50 to-purple-50 p-5">
          <h2 className="mb-1 text-sm font-semibold text-indigo-900">Territory Summary</h2>
          <p className="text-sm text-indigo-700">{opportunityMap.territorySummary}</p>
        </div>

        {/* Top Barriers + Coverage */}
        <div className="mb-6 grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Top Barriers</h3>
            <div className="flex flex-wrap gap-2">
              {opportunityMap.topBarriers.map((b) => (
                <span key={b.barrier} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${BARRIER_COLORS[b.barrier]} bg-slate-50 border border-slate-200`}>
                  {b.barrier.replace(/_/g, " ")} <span className="font-bold">{b.count}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Coverage Recommendation</h3>
            <div className="space-y-2">
              {[
                { label: "In-Person", count: opportunityMap.recommendedCoverage.inPerson, color: "bg-indigo-500" },
                { label: "Remote", count: opportunityMap.recommendedCoverage.remote, color: "bg-blue-400" },
                { label: "Defer", count: opportunityMap.recommendedCoverage.defer, color: "bg-slate-300" },
              ].map((c) => (
                <div key={c.label} className="flex items-center gap-3">
                  <span className="w-20 text-xs font-medium text-slate-600">{c.label}</span>
                  <div className="flex-1">
                    <div className="h-4 rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-4 ${c.color} transition-all`} style={{ width: `${coverageTotal > 0 ? (c.count / coverageTotal) * 100 : 0}%` }} />
                    </div>
                  </div>
                  <span className="w-8 text-right text-xs font-bold text-slate-700">{c.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Account List */}
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900">Account Opportunity Map</h2>
          {accounts
            .slice()
            .sort((a, b) => b.priorityScore - a.priorityScore)
            .map((account) => {
              const isExpanded = expandedId === account.id;
              const spinored = spinoredCache[account.id];
              const content = contentCache[account.id];
              return (
                <div key={account.id} className="rounded-2xl border border-slate-200/60 bg-white shadow-sm overflow-hidden transition-all">
                  {/* Account Header Row */}
                  <button
                    onClick={() => handleExpand(account.id)}
                    className="w-full p-4 text-left hover:bg-slate-50/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      {/* Priority Score */}
                      <div className="flex-shrink-0 text-center">
                        <div className={`text-2xl font-bold ${account.priorityScore >= 50 ? "text-red-600" : account.priorityScore >= 25 ? "text-amber-600" : "text-slate-400"}`}>
                          {account.priorityScore.toFixed(1)}
                        </div>
                        <div className="text-[10px] text-slate-400">PRIORITY</div>
                      </div>

                      {/* Account Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-slate-900 truncate">{account.hcpName}</h3>
                          <span className="text-xs text-slate-400">{account.specialty}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${FUNNEL_COLORS[account.funnelState]}`}>
                            {account.funnelState.replace(/_/g, " ")}
                          </span>
                          <span className={`text-[10px] font-medium ${BARRIER_COLORS[account.barrier]}`}>
                            Barrier: {account.barrier.replace(/_/g, " ")}
                          </span>
                          {account.channelPreference && (
                            <span className="text-[10px] text-slate-400">via {account.channelPreference}</span>
                          )}
                        </div>
                      </div>

                      {/* Next Best Action */}
                      {account.recommendedAction && (
                        <div className="hidden md:block flex-shrink-0 max-w-xs">
                          <p className="text-xs text-slate-600 truncate">{account.recommendedAction.action}</p>
                          <span className={`inline-flex mt-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${AUTONOMY_COLORS[account.recommendedAction.autonomyClass]}`}>
                            {AUTONOMY_LABELS[account.recommendedAction.autonomyClass]}
                          </span>
                        </div>
                      )}

                      {/* Expand Icon */}
                      <svg className={`h-5 w-5 flex-shrink-0 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Expanded Section */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 p-4 bg-slate-50/30 space-y-4">
                      {/* Score Components */}
                      <div>
                        <h4 className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Score Components (P_i = E×N×A×R×C / T+F+U)</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
                          <ScoreComponent label="E_i" value={account.eligiblePatientOpportunity} color="indigo" />
                          <ScoreComponent label="N_i" value={account.unmetInfoNeed} color="blue" />
                          <ScoreComponent label="A_i" value={account.accessProbability} color="cyan" />
                          <ScoreComponent label="R_i" value={account.expectedResponsiveness} color="teal" />
                          <ScoreComponent label="C_i" value={account.evidenceConfidence} color="violet" />
                          <ScoreComponent label="T_i" value={account.fieldTimeRequired} color="amber" />
                          <ScoreComponent label="F_i" value={account.operationalFriction} color="orange" />
                          <ScoreComponent label="U_i" value={account.uncertaintyRisk} color="red" />
                        </div>
                      </div>

                      {/* Reason Codes */}
                      {account.reasonCodes.length > 0 && (
                        <div>
                          <h4 className="mb-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">Reason Codes</h4>
                          <div className="flex flex-wrap gap-1.5">
                            {account.reasonCodes.map((code, i) => (
                              <span key={i} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{code}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Next Best Action Detail */}
                      {account.recommendedAction && (
                        <div className="rounded-xl border border-indigo-200/60 bg-indigo-50/50 p-3">
                          <h4 className="mb-1 text-xs font-semibold text-indigo-900">Next Best Action</h4>
                          <p className="text-sm text-indigo-800">{account.recommendedAction.action}</p>
                          <p className="mt-1 text-xs text-indigo-600">{account.recommendedAction.rationale}</p>
                          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-indigo-500">
                            <span>Role: {account.recommendedAction.fieldRole}</span>
                            <span>Channel: {account.recommendedAction.permittedChannel}</span>
                            <span>Time: {account.recommendedAction.estimatedTimeMin}min</span>
                            <span>Confidence: {(account.recommendedAction.confidenceLevel * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                      )}

                      {/* Content Recommendations */}
                      {content && content.length > 0 && (
                        <div>
                          <h4 className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Approved Content Recommendations</h4>
                          <div className="space-y-2">
                            {content.map((rec, i) => (
                              <div key={i} className="rounded-lg border border-slate-200 bg-white p-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-slate-800">{rec.contentName}</span>
                                  {rec.slideReference && <span className="text-xs text-slate-400">{rec.slideReference}</span>}
                                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                    rec.riskLevel === "low" ? "bg-green-100 text-green-700" :
                                    rec.riskLevel === "moderate" ? "bg-blue-100 text-blue-700" :
                                    "bg-orange-100 text-orange-700"
                                  }`}>{rec.riskLevel}</span>
                                </div>
                                <p className="mt-1 text-xs text-slate-600">{rec.reasonForSelection}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Spinored Analysis */}
                      {spinored && (
                        <div>
                          <h4 className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Spine-Ordered Analysis (Spinored)</h4>
                          <div className="space-y-2">
                            {/* Layer 1: Reality */}
                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-700 text-[10px] font-bold text-white">1</span>
                                <span className="text-xs font-semibold text-slate-700">Reality</span>
                              </div>
                              <div className="ml-7 space-y-1">
                                {spinored.layer1_reality.events.slice(0, 4).map((ev, i) => (
                                  <div key={i} className="text-[11px] text-slate-500">
                                    <span className="font-mono text-slate-400">{ev.date}</span> — {ev.type}: {ev.detail}
                                  </div>
                                ))}
                              </div>
                            </div>
                            {/* Layer 2: State */}
                            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="flex h-5 w-5 items-center justify-center rounded bg-blue-600 text-[10px] font-bold text-white">2</span>
                                <span className="text-xs font-semibold text-blue-800">State</span>
                              </div>
                              <p className="ml-7 text-xs text-blue-700">{spinored.layer2_state.currentState}</p>
                            </div>
                            {/* Layer 3: Cause */}
                            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="flex h-5 w-5 items-center justify-center rounded bg-amber-600 text-[10px] font-bold text-white">3</span>
                                <span className="text-xs font-semibold text-amber-800">Cause</span>
                              </div>
                              <p className="ml-7 text-xs text-amber-700">{spinored.layer3_cause.rootCause}</p>
                            </div>
                            {/* Layer 4: Intervention */}
                            <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="flex h-5 w-5 items-center justify-center rounded bg-indigo-600 text-[10px] font-bold text-white">4</span>
                                <span className="text-xs font-semibold text-indigo-800">Intervention</span>
                              </div>
                              <p className="ml-7 text-xs text-indigo-700">{spinored.layer4_intervention.smallestAction}</p>
                              <p className="ml-7 mt-0.5 text-[10px] text-indigo-500">Permitted: {spinored.layer4_intervention.permitted ? "Yes" : "No"}</p>
                            </div>
                            {/* Layer 5: Expected Value */}
                            <div className="rounded-lg border border-green-200 bg-green-50/50 p-3">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="flex h-5 w-5 items-center justify-center rounded bg-green-600 text-[10px] font-bold text-white">5</span>
                                <span className="text-xs font-semibold text-green-800">Expected Value</span>
                              </div>
                              <p className="ml-7 text-xs text-green-700">
                                Worth field time: {spinored.layer5_expectedValue.worthFieldTime ? "Yes" : "No"} — {spinored.layer5_expectedValue.vsAlternatives}
                              </p>
                            </div>
                            {/* Layer 6: Learning */}
                            <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-3">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="flex h-5 w-5 items-center justify-center rounded bg-purple-600 text-[10px] font-bold text-white">6</span>
                                <span className="text-xs font-semibold text-purple-800">Learning</span>
                              </div>
                              <p className="ml-7 text-xs text-purple-700">{spinored.layer6_learning.whatWeLearned}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
