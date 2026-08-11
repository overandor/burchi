"use client";

import { useState, useEffect, useMemo } from "react";
import { TerritoryAccount, RouteOptimization, PreCallBrief, InteractionCapture, FollowUpAction } from "@/types";
import { generateSampleAccounts } from "@/lib/territory/scorer";
import { optimizeRoute, generatePreCallBrief, structureInteractionCapture, generateMorningBrief, generateEODReport } from "@/lib/field/optimizer";
import { generateFollowUps } from "@/lib/followup/executor";

type Tab = 1 | 2 | 3 | 4 | 5;

const TAB_LABELS: Record<Tab, string> = {
  1: "Morning Brief",
  2: "Next-Best Queue",
  3: "Pre-Call Brief",
  4: "Post-Call Capture",
  5: "EOD Report",
};

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-700",
  moderate: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  prohibited: "bg-red-100 text-red-700",
};

export default function FieldPage() {
  const [tab, setTab] = useState<Tab>(1);
  const [accounts] = useState<TerritoryAccount[]>(() => generateSampleAccounts());
  const [route] = useState<RouteOptimization>(() => optimizeRoute(generateSampleAccounts(), new Date().toISOString()));
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [preCallBrief, setPreCallBrief] = useState<PreCallBrief | null>(null);
  const [voiceInput, setVoiceInput] = useState("");
  const [interactionCapture, setInteractionCapture] = useState<InteractionCapture | null>(null);
  const [followUps, setFollowUps] = useState<FollowUpAction[]>([]);

  const morningBriefText = useMemo(() => generateMorningBrief(accounts), [accounts]);
  const eodReportText = useMemo(() => generateEODReport(accounts, route), [accounts, route]);

  useEffect(() => {
    if (selectedAccountId) {
      const acct = accounts.find((a) => a.id === selectedAccountId);
      if (acct) {
        setPreCallBrief(generatePreCallBrief(acct));
      }
    }
  }, [selectedAccountId, accounts]);

  const handleSelectAccount = (id: string) => {
    setSelectedAccountId(id);
    setTab(3);
  };

  const handleStructureCapture = () => {
    if (!voiceInput.trim() || !selectedAccountId) return;
    const acct = accounts.find((a) => a.id === selectedAccountId);
    if (!acct) return;
    const capture = structureInteractionCapture(voiceInput, acct.id, acct.hcpName);
    setInteractionCapture(capture);
    setFollowUps(generateFollowUps(capture, acct));
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto max-w-6xl px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Field Operations</h1>
          <p className="mt-1 text-sm text-slate-500">Five-screen daily experience — morning brief, next-best queue, pre-call, voice capture, end-of-day report</p>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6 flex gap-1 rounded-2xl border border-slate-200/60 bg-white p-1.5 shadow-sm">
          {([1, 2, 3, 4, 5] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-all ${
                tab === t
                  ? "bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md shadow-indigo-500/25"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span className="hidden sm:inline">{TAB_LABELS[t]}</span>
              <span className="sm:hidden">{t}</span>
            </button>
          ))}
        </div>

        {/* Tab 1: Morning Brief */}
        {tab === 1 && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-indigo-200/60 bg-gradient-to-br from-indigo-50 to-purple-50 p-5">
              <h2 className="mb-2 text-sm font-semibold text-indigo-900">Morning Territory Brief</h2>
              <pre className="whitespace-pre-wrap text-sm text-indigo-800 font-sans">{morningBriefText}</pre>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "High-value accounts changed", value: "3", color: "from-red-500 to-rose-500" },
                { label: "Formulary barriers removed", value: "1", color: "from-green-500 to-emerald-500" },
                { label: "Route time saved", value: "74 min", color: "from-indigo-500 to-purple-500" },
              ].map((s) => (
                <div key={s.label} className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
                  <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${s.color} text-white text-sm font-bold`}>{s.value}</div>
                  <p className="text-xs font-medium text-slate-500">{s.label}</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => setTab(2)}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:scale-[1.01]"
            >
              Start Day →
            </button>
          </div>
        )}

        {/* Tab 2: Next-Best Queue */}
        {tab === 2 && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Total Drive Time", value: `${Math.round(route.totalDriveTimeMin)}min` },
                { label: "Total Wait Time", value: `${Math.round(route.totalWaitTimeMin)}min` },
                { label: "Field Time", value: `${Math.round(route.totalFieldTimeMin / 60)}h ${Math.round(route.totalFieldTimeMin % 60)}m` },
                { label: "Time Saved", value: `${Math.round(route.timeSavedMin)}min` },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-slate-200/60 bg-white p-3 text-center shadow-sm">
                  <div className="text-lg font-bold text-slate-800">{s.value}</div>
                  <div className="text-[10px] text-slate-400">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Route Timeline */}
            <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Optimized Route</h3>
              <div className="space-y-2">
                {route.stops.filter((s) => !s.deferred).map((stop, i) => (
                  <button
                    key={stop.accountId}
                    onClick={() => handleSelectAccount(stop.accountId)}
                    className="flex w-full items-center gap-4 rounded-xl border border-slate-200 p-3 text-left hover:border-indigo-300 hover:bg-indigo-50/30 transition-all"
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800">{stop.hcpName}</div>
                      <div className="text-[10px] text-slate-400">
                        Arrive {stop.arrivalTime} · Travel {stop.travelTimeMin}min · Wait {stop.waitTimeMin}min
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-indigo-600">{stop.utilityScore.toFixed(1)}</div>
                      <div className="text-[9px] text-slate-400">utility</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Deferred */}
            {route.deferredCount > 0 && (
              <div className="rounded-2xl border border-amber-200/60 bg-amber-50 p-5">
                <h3 className="mb-2 text-sm font-semibold text-amber-800">Deferred Visits ({route.deferredCount})</h3>
                {route.stops.filter((s) => s.deferred).map((stop) => (
                  <div key={stop.accountId} className="flex items-center gap-3 py-1">
                    <span className="text-sm text-amber-700">{stop.hcpName}</span>
                    <span className="text-[10px] text-amber-500">— {stop.deferredReason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Pre-Call Brief */}
        {tab === 3 && (
          <div className="space-y-4">
            {preCallBrief ? (
              <>
                <div className="rounded-2xl border border-indigo-200/60 bg-gradient-to-br from-indigo-50 to-purple-50 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-indigo-900">{preCallBrief.hcpName}</h2>
                      <p className="text-xs text-indigo-600">{preCallBrief.whyPrioritized}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-indigo-700">{preCallBrief.prepTimeSeconds}s</div>
                      <div className="text-[10px] text-indigo-400">prep time</div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { title: "Last 3 Interactions", items: preCallBrief.lastThreeInteractions.map((i) => `${i.date}: ${i.summary} (${i.outcome})`) },
                    { title: "Unresolved Questions", items: preCallBrief.unresolvedQuestions },
                    { title: "Known Barriers", items: preCallBrief.knownBarriers },
                    { title: "Content Previously Shown", items: preCallBrief.contentPreviouslyShown },
                    { title: "Permitted Objectives", items: preCallBrief.permittedObjectives },
                    { title: "Likely Objections", items: preCallBrief.likelyObjections },
                    { title: "Commitments Made", items: preCallBrief.commitmentsMade },
                    { title: "Questions to Ask", items: preCallBrief.questionsToAsk },
                  ].map((section) => (
                    <div key={section.title} className="rounded-xl border border-slate-200/60 bg-white p-3 shadow-sm">
                      <h4 className="mb-1.5 text-xs font-semibold text-slate-600 uppercase tracking-wide">{section.title}</h4>
                      <ul className="space-y-1">
                        {section.items.length === 0 ? (
                          <li className="text-xs text-slate-400">None</li>
                        ) : (
                          section.items.map((item, i) => (
                            <li key={i} className="text-xs text-slate-600">• {item}</li>
                          ))
                        )}
                      </ul>
                    </div>
                  ))}
                </div>

                {/* Prohibited Topics */}
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <h4 className="mb-1 text-xs font-semibold text-red-700 uppercase tracking-wide">Prohibited Topics</h4>
                  <ul className="space-y-0.5">
                    {preCallBrief.prohibitedTopics.map((t, i) => (
                      <li key={i} className="text-xs text-red-600">✗ {t}</li>
                    ))}
                  </ul>
                </div>

                <button
                  onClick={() => setTab(4)}
                  className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:scale-[1.01]"
                >
                  Start Visit →
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <p className="text-sm">Select an account from the Next-Best Queue</p>
                <button onClick={() => setTab(2)} className="mt-3 rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600 hover:bg-slate-200">Go to Queue</button>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Post-Call Capture */}
        {tab === 4 && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Voice-Based Post-Call Capture</h3>
              <p className="mb-3 text-xs text-slate-500">Speak or type naturally after the meeting. The system will structure it into CRM updates.</p>
              <textarea
                value={voiceInput}
                onChange={(e) => setVoiceInput(e.target.value)}
                placeholder="Dr. Smith understands the efficacy data but the clinic lacks a testing workflow. She asked for reimbursement information and wants the nurse manager included next time."
                className="w-full rounded-xl border border-slate-200 p-3 text-sm text-slate-700 min-h-[100px] focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <button
                onClick={handleStructureCapture}
                disabled={!voiceInput.trim() || !selectedAccountId}
                className="mt-3 w-full rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:scale-[1.01] disabled:opacity-40 disabled:hover:scale-100"
              >
                Structure Capture
              </button>
            </div>

            {/* Structured Result */}
            {interactionCapture && (
              <div className="rounded-2xl border border-indigo-200/60 bg-indigo-50/50 p-5 space-y-3">
                <h3 className="text-sm font-semibold text-indigo-900">Structured Result</h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Knowledge State", value: interactionCapture.knowledgeState },
                    { label: "Primary Barrier", value: interactionCapture.primaryBarrier.replace(/_/g, " ") },
                    { label: "Secondary Barrier", value: interactionCapture.secondaryBarrier?.replace(/_/g, " ") || "—" },
                    { label: "Requested Follow-up", value: interactionCapture.requestedFollowUp || "—" },
                    { label: "New Stakeholder", value: interactionCapture.newStakeholder || "—" },
                    { label: "Next Best Action", value: interactionCapture.nextBestAction },
                  ].map((f) => (
                    <div key={f.label} className="rounded-lg bg-white p-2 border border-slate-200">
                      <div className="text-[10px] text-slate-400">{f.label}</div>
                      <div className="text-sm text-slate-700">{f.value}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500">Confidence:</span>
                    <span className="text-sm font-bold text-indigo-600">{(interactionCapture.confidence * 100).toFixed(0)}%</span>
                  </div>
                  {interactionCapture.humanConfirmationRequired && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">Human confirmation required</span>
                  )}
                </div>
              </div>
            )}

            {/* Follow-up Actions */}
            {followUps.length > 0 && (
              <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">Generated Follow-up Actions</h3>
                <div className="space-y-2">
                  {followUps.map((f, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-800">{f.type.replace(/_/g, " ")}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${RISK_COLORS[f.riskLevel]}`}>{f.riskLevel}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-600">{f.description}</p>
                        <p className="mt-0.5 text-[10px] text-slate-400">System: {f.systemBehavior.replace(/_/g, " ")}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {interactionCapture && (
              <button
                onClick={() => setTab(5)}
                className="w-full rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-green-500/25 transition-all hover:scale-[1.01]"
              >
                Submit & Complete →
              </button>
            )}
          </div>
        )}

        {/* Tab 5: EOD Report */}
        {tab === 5 && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-green-200/60 bg-gradient-to-br from-green-50 to-emerald-50 p-5">
              <h2 className="mb-2 text-sm font-semibold text-green-900">End-of-Day Learning Report</h2>
              <pre className="whitespace-pre-wrap text-sm text-green-800 font-sans">{eodReportText}</pre>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Field Time", value: "7.4h", color: "from-indigo-500 to-purple-500" },
                { label: "Admin Time Saved", value: "1.8h", color: "from-green-500 to-emerald-500" },
                { label: "Meaningful Engagements", value: "6", color: "from-blue-500 to-cyan-500" },
                { label: "Barriers Discovered", value: "4", color: "from-amber-500 to-orange-500" },
                { label: "Barriers Resolved", value: "2", color: "from-green-500 to-teal-500" },
                { label: "Low-Value Visits Avoided", value: "3", color: "from-slate-500 to-slate-600" },
                { label: "Recommendations Accepted", value: "81%", color: "from-violet-500 to-purple-500" },
                { label: "Incorrect Recommendations", value: "2", color: "from-red-500 to-rose-500" },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-slate-200/60 bg-white p-3 text-center shadow-sm">
                  <div className={`mb-1 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br ${s.color} text-white text-xs font-bold`}>{s.value}</div>
                  <div className="text-[10px] text-slate-500">{s.label}</div>
                </div>
              ))}
            </div>
            <button
              onClick={() => { setTab(1); setVoiceInput(""); setInteractionCapture(null); setFollowUps([]); setSelectedAccountId(null); }}
              className="w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600 transition-all hover:bg-slate-200"
            >
              Start New Day
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
