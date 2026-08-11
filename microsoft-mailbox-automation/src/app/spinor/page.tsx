"use client";

import { useState, useMemo } from "react";
import { SpinorOpportunity, SpinorHypothesis, MissionContract, MissionResult, ShadowWorld, SpinorGoldenNode, DestructionMission, SpinorEmployee, EvidenceEconomyEntry, ProofState, CareerStage, CapabilityType } from "@/types";
import {
  generateOpportunities,
  generateHypotheses,
  generateMissionContract,
  executeMission,
  createShadowWorld,
  advanceProofState,
  createGoldenNode,
  generateDestructionMissions,
  calculateExperimentROI,
  generateEmployees,
  getProofStateLabel,
  getCareerStageLabel,
  getCapabilityLabel,
  generateSampleGoldenNodes,
  generateSampleDestructionMissions,
} from "@/lib/spinor/engine";

const PROOF_STATE_COLORS: Record<number, string> = {
  0: "bg-slate-100 text-slate-600",
  1: "bg-blue-100 text-blue-700",
  2: "bg-cyan-100 text-cyan-700",
  3: "bg-teal-100 text-teal-700",
  4: "bg-indigo-100 text-indigo-700",
  5: "bg-violet-100 text-violet-700",
  6: "bg-amber-100 text-amber-700",
  7: "bg-orange-100 text-orange-700",
  8: "bg-green-100 text-green-700",
  9: "bg-emerald-100 text-emerald-700",
};

const HYPOTHESIS_STATUS_COLORS: Record<string, string> = {
  untested: "bg-slate-100 text-slate-600",
  testing: "bg-blue-100 text-blue-700",
  supported: "bg-green-100 text-green-700",
  refuted: "bg-red-100 text-red-700",
  inconclusive: "bg-amber-100 text-amber-700",
};

const GOLDEN_NODE_STATUS_COLORS: Record<string, string> = {
  confirmed: "bg-green-100 text-green-700",
  narrowed: "bg-blue-100 text-blue-700",
  mutated: "bg-purple-100 text-purple-700",
  merged: "bg-indigo-100 text-indigo-700",
  downgraded: "bg-amber-100 text-amber-700",
  suspended: "bg-orange-100 text-orange-700",
  destroyed: "bg-red-100 text-red-700",
};

type Tab = "opportunities" | "hypotheses" | "missions" | "golden" | "destruction" | "employees" | "economy";

export default function SpinorPage() {
  const [tab, setTab] = useState<Tab>("opportunities");
  const [opportunities] = useState<SpinorOpportunity[]>(() => generateOpportunities());
  const [hypotheses] = useState<SpinorHypothesis[]>(() => generateHypotheses(generateOpportunities()));
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null);
  const [missions, setMissions] = useState<MissionContract[]>([]);
  const [results, setResults] = useState<Record<string, { result: MissionResult; shadow: ShadowWorld; proofState: ProofState; roi: EvidenceEconomyEntry }>>({});
  const [goldenNodes] = useState<SpinorGoldenNode[]>(() => generateSampleGoldenNodes());
  const [destructionMissions] = useState<DestructionMission[]>(() => generateSampleDestructionMissions());
  const [employees] = useState<SpinorEmployee[]>(() => generateEmployees());

  const filteredHypotheses = useMemo(() => {
    if (!selectedOppId) return hypotheses;
    return hypotheses.filter((h) => h.opportunityId === selectedOppId);
  }, [hypotheses, selectedOppId]);

  const handleRunMission = (hyp: SpinorHypothesis) => {
    const contract = generateMissionContract(hyp, "Field Rep Alpha");
    const result = executeMission(contract);
    const shadow = createShadowWorld(contract, result);
    const proofState = advanceProofState(hyp, result, shadow);
    const roi = calculateExperimentROI(result, shadow);
    setMissions((prev) => [...prev, contract]);
    setResults((prev) => ({ ...prev, [contract.id]: { result, shadow, proofState, roi } }));
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "opportunities", label: "Opportunity Market", count: opportunities.length },
    { id: "hypotheses", label: "Hypothesis Tournament", count: hypotheses.length },
    { id: "missions", label: "Mission Contracts", count: missions.length },
    { id: "golden", label: "Golden Nodes", count: goldenNodes.length },
    { id: "destruction", label: "Destruction Engine", count: destructionMissions.length },
    { id: "employees", label: "Capability Exchange", count: employees.length },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto max-w-7xl px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">SPINOR GODMODE</h1>
          <p className="mt-1 text-sm text-slate-500">A governed organizational advantage engine that prices uncertainty, generates competing hypotheses, allocates controlled experiments, and promotes replicated discoveries into executable systems</p>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6 flex gap-1 rounded-2xl border border-slate-200/60 bg-white p-1.5 shadow-sm overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                tab === t.id
                  ? "bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.label}
              {t.count !== undefined && (
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${tab === t.id ? "bg-white/20" : "bg-slate-200"}`}>{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Opportunities Tab */}
        {tab === "opportunities" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-indigo-200/60 bg-indigo-50 p-3 mb-4">
              <p className="text-xs text-indigo-700">
                <strong>Opportunity Value</strong> = expected impact × uncertainty reduction × portability × strategic importance × time sensitivity − execution cost − compliance risk − customer burden
              </p>
            </div>
            {opportunities
              .slice()
              .sort((a, b) => b.valueScore - a.valueScore)
              .map((opp) => (
                <div
                  key={opp.id}
                  className={`rounded-2xl border p-4 shadow-sm cursor-pointer transition-all ${
                    selectedOppId === opp.id ? "border-indigo-400 bg-indigo-50/50" : "border-slate-200/60 bg-white hover:border-slate-300"
                  }`}
                  onClick={() => { setSelectedOppId(selectedOppId === opp.id ? null : opp.id); setTab("hypotheses"); }}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 text-center">
                      <div className="text-2xl font-bold text-indigo-600">{opp.valueScore.toFixed(1)}</div>
                      <div className="text-[9px] text-slate-400">VALUE</div>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-slate-900">{opp.question}</h3>
                      <p className="mt-0.5 text-xs text-slate-500">{opp.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${opp.status === "open" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>{opp.status}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">Impact: {opp.expectedBusinessImpact.toFixed(1)}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">Uncertainty: {opp.uncertaintyReduction.toFixed(1)}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">Portability: {opp.portability.toFixed(1)}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">Strategic: {opp.strategicImportance.toFixed(1)}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">Time: {opp.timeSensitivity.toFixed(1)}</span>
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] text-red-500">Cost: {opp.executionCost.toFixed(1)}</span>
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] text-red-500">Compliance Risk: {opp.complianceRisk.toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Hypotheses Tab */}
        {tab === "hypotheses" && (
          <div className="space-y-4">
            {selectedOppId && (
              <div className="rounded-xl border border-indigo-200/60 bg-indigo-50 p-3">
                <p className="text-xs text-indigo-700">
                  Filtered to: <strong>{opportunities.find((o) => o.id === selectedOppId)?.question}</strong>
                  <button onClick={() => setSelectedOppId(null)} className="ml-2 text-indigo-400 hover:text-indigo-600">✕ clear</button>
                </p>
              </div>
            )}
            {filteredHypotheses.map((hyp) => {
              const opp = opportunities.find((o) => o.id === hyp.opportunityId);
              return (
                <div key={hyp.id} className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${HYPOTHESIS_STATUS_COLORS[hyp.status]}`}>{hyp.status}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${PROOF_STATE_COLORS[hyp.proofState]}`}>
                          {hyp.proofState}: {getProofStateLabel(hyp.proofState)}
                        </span>
                      </div>
                      <h3 className="mt-1.5 text-sm font-semibold text-slate-900">{hyp.statement}</h3>
                      <p className="mt-0.5 text-xs text-slate-500">{hyp.rationale}</p>
                      {opp && <p className="mt-1 text-[10px] text-slate-400">Opportunity: {opp.question}</p>}
                      {hyp.competingHypothesisIds.length > 0 && (
                        <p className="mt-1 text-[10px] text-slate-400">Competing with {hyp.competingHypothesisIds.length} other hypotheses</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRunMission(hyp)}
                      className="flex-shrink-0 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:scale-105"
                    >
                      Run Mission
                    </button>
                  </div>
                  {results[missions.find((m) => m.hypothesisId === hyp.id)?.id || ""] && (
                    <div className="mt-3 rounded-xl bg-slate-50 p-3 border border-slate-200">
                      {(() => {
                        const mission = missions.find((m) => m.hypothesisId === hyp.id);
                        if (!mission) return null;
                        const r = results[mission.id];
                        return (
                          <div className="space-y-2">
                            <div className="grid grid-cols-4 gap-2 text-xs">
                              <div><span className="text-slate-400">Observed:</span> <span className="font-semibold text-slate-700">{(r.result.observedOutcome * 100).toFixed(1)}%</span></div>
                              <div><span className="text-slate-400">Expected:</span> <span className="font-semibold text-slate-700">{(r.result.expectedOutcome * 100).toFixed(1)}%</span></div>
                              <div><span className="text-slate-400">Abs Lift:</span> <span className={`font-semibold ${r.result.absoluteLift > 0 ? "text-green-600" : "text-red-500"}`}>{(r.result.absoluteLift * 100).toFixed(1)}pp</span></div>
                              <div><span className="text-slate-400">Sample:</span> <span className="font-semibold text-slate-700">{r.result.sampleSize}</span></div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-400">New Proof State:</span>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${PROOF_STATE_COLORS[r.proofState]}`}>{r.proofState}: {getProofStateLabel(r.proofState)}</span>
                              <span className="text-xs text-slate-400">Confidence: {r.result.confidence}</span>
                              <span className={`text-xs font-semibold ${r.roi.experimentROI > 1 ? "text-green-600" : "text-amber-600"}`}>ROI: {r.roi.experimentROI.toFixed(2)}x</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Missions Tab */}
        {tab === "missions" && (
          <div className="space-y-3">
            {missions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <p className="text-sm">No missions executed yet.</p>
                <button onClick={() => setTab("hypotheses")} className="mt-3 rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600 hover:bg-slate-200">Go to Hypotheses</button>
              </div>
            ) : (
              missions.map((m) => {
                const r = results[m.id];
                return (
                  <div key={m.id} className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${m.status === "completed" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>{m.status}</span>
                      <span className="text-xs text-slate-400">Owner: {m.owner}</span>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900">{m.objective}</h3>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-slate-400">Population:</span> <span className="text-slate-600">{m.population}</span></div>
                      <div><span className="text-slate-400">Intervention:</span> <span className="text-slate-600">{m.intervention}</span></div>
                      <div><span className="text-slate-400">Comparison:</span> <span className="text-slate-600">{m.comparison}</span></div>
                      <div><span className="text-slate-400">Primary Outcome:</span> <span className="text-slate-600">{m.primaryOutcome}</span></div>
                    </div>
                    {r && (
                      <div className="mt-3 rounded-xl bg-slate-50 p-3 border border-slate-200">
                        <div className="grid grid-cols-5 gap-2 text-xs">
                          <div className="text-center"><div className="text-slate-400 text-[10px]">Observed</div><div className="font-bold text-slate-700">{(r.result.observedOutcome * 100).toFixed(1)}%</div></div>
                          <div className="text-center"><div className="text-slate-400 text-[10px]">Expected</div><div className="font-bold text-slate-700">{(r.result.expectedOutcome * 100).toFixed(1)}%</div></div>
                          <div className="text-center"><div className="text-slate-400 text-[10px]">Abs Lift</div><div className={`font-bold ${r.result.absoluteLift > 0 ? "text-green-600" : "text-red-500"}`}>{(r.result.absoluteLift * 100).toFixed(1)}pp</div></div>
                          <div className="text-center"><div className="text-slate-400 text-[10px]">Rel Lift</div><div className={`font-bold ${r.result.relativeLift > 0 ? "text-green-600" : "text-red-500"}`}>{(r.result.relativeLift * 100).toFixed(1)}%</div></div>
                          <div className="text-center"><div className="text-slate-400 text-[10px]">Sample</div><div className="font-bold text-slate-700">{r.result.sampleSize}</div></div>
                        </div>
                        <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-500">
                          <span>CI: [{(r.result.uncertaintyInterval.lower * 100).toFixed(1)}%, {(r.result.uncertaintyInterval.upper * 100).toFixed(1)}%]</span>
                          <span>Confidence: {r.result.confidence}</span>
                          <span>Confounders: {r.result.confounders.length}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Golden Nodes Tab */}
        {tab === "golden" && (
          <div className="space-y-3">
            {goldenNodes.map((gn) => (
              <div key={gn.id} className="rounded-2xl border border-amber-200/60 bg-gradient-to-br from-amber-50 to-yellow-50 p-5 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-yellow-500 text-white font-bold shadow-lg">
                    #{gn.number}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-amber-900">Golden Node</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${GOLDEN_NODE_STATUS_COLORS[gn.status] || "bg-slate-100"}`}>{gn.status}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${PROOF_STATE_COLORS[gn.proofState]}`}>{getProofStateLabel(gn.proofState)}</span>
                    </div>
                    <p className="mt-1 text-sm text-amber-800">{gn.opportunity}</p>
                    <p className="mt-1 text-xs text-amber-700"><strong>Strategy:</strong> {gn.validatedStrategy}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-amber-500">Failure Boundary:</span> <span className="text-amber-700">{gn.failureBoundary}</span></div>
                      <div><span className="text-amber-500">Execution Cost:</span> <span className="text-amber-700">{gn.executionCost}</span></div>
                      <div><span className="text-amber-500">Compliance:</span> <span className="text-amber-700">{gn.complianceState}</span></div>
                      <div><span className="text-amber-500">Rollback:</span> <span className="text-amber-700">{gn.rollbackTrigger}</span></div>
                    </div>
                    <div className="mt-2">
                      <span className="text-[10px] text-amber-500">Applicable Contexts:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {gn.applicableContexts.map((c, i) => (
                          <span key={i} className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">{c}</span>
                        ))}
                      </div>
                    </div>
                    <div className="mt-2">
                      <span className="text-[10px] text-amber-500">Contributors:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {gn.humanContributors.map((c, i) => (
                          <span key={i} className="rounded bg-white px-1.5 py-0.5 text-[10px] text-amber-700 border border-amber-200">{c}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Destruction Engine Tab */}
        {tab === "destruction" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-red-200/60 bg-red-50 p-3 mb-4">
              <p className="text-xs text-red-700">Every promoted method is automatically attacked. The system rewards employees who kill bad strategies before the company scales them.</p>
            </div>
            {destructionMissions.map((dm) => (
              <div key={dm.id} className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-red-500 text-white text-xs">⚔</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${dm.status === "completed" ? "bg-slate-100 text-slate-600" : "bg-blue-100 text-blue-700"}`}>{dm.status}</span>
                      <span className="text-[10px] text-slate-400">Attack: {dm.attackType.replace(/_/g, " ")}</span>
                      {dm.result && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${GOLDEN_NODE_STATUS_COLORS[dm.result] || "bg-slate-100"}`}>{dm.result}</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{dm.description}</p>
                    {dm.evidence && <p className="mt-0.5 text-xs text-slate-500">Evidence: {dm.evidence}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Employees / Capability Exchange Tab */}
        {tab === "employees" && (
          <div className="space-y-3">
            {employees.map((emp) => (
              <div key={emp.id} className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-white text-sm font-bold">
                    {emp.name.split(" ").map((n) => n[0]).join("")}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">{emp.name}</h3>
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">{getCareerStageLabel(emp.careerStage)}</span>
                    </div>
                    <p className="text-xs text-slate-500">{emp.role}</p>
                    <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                      <div><span className="text-slate-400">Experiments:</span> <span className="font-semibold text-slate-700">{emp.experimentsRun}</span></div>
                      <div><span className="text-slate-400">Honest Negatives:</span> <span className="font-semibold text-slate-700">{emp.honestNegatives}</span></div>
                      <div><span className="text-slate-400">Golden Nodes:</span> <span className="font-semibold text-slate-700">{emp.goldenNodesContributed.length}</span></div>
                      <div><span className="text-slate-400">Success Prob:</span> <span className="font-semibold text-slate-700">{(emp.opportunityBalanceSheet.successProbability * 100).toFixed(0)}%</span></div>
                    </div>
                    <div className="mt-2">
                      <span className="text-[10px] text-slate-400">Capabilities:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {emp.capabilities.map((cap) => (
                          <span key={cap.type} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                            {getCapabilityLabel(cap.type)} L{cap.level}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Proof Ladder (always visible at bottom) */}
        <div className="mt-8 rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">The Proof Ladder</h3>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {Array.from({ length: 10 }, (_, i) => i as ProofState).map((state, i) => (
              <div key={state} className="flex items-center gap-1 flex-shrink-0">
                <div className={`rounded-lg px-2 py-1 text-[10px] font-medium ${PROOF_STATE_COLORS[state]}`}>
                  {state}: {getProofStateLabel(state)}
                </div>
                {i < 9 && <span className="text-slate-300">→</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
