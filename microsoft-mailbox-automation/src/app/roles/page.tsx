"use client";

import { useState } from "react";
import { RoleTwin, RoleType } from "@/types";
import { ROLE_TWINS } from "@/lib/roles/twins";

const ROLE_ICONS: Record<RoleType, { icon: string; color: string; bg: string }> = {
  field_representative: { icon: "💼", color: "text-indigo-700", bg: "from-indigo-500 to-purple-500" },
  regional_manager: { icon: "📊", color: "text-purple-700", bg: "from-purple-500 to-pink-500" },
  medical_affairs: { icon: "🔬", color: "text-teal-700", bg: "from-teal-500 to-cyan-500" },
  market_access: { icon: "🛡️", color: "text-orange-700", bg: "from-orange-500 to-amber-500" },
  compliance: { icon: "✓", color: "text-red-700", bg: "from-red-500 to-rose-500" },
};

const IMPROVEMENT_PIPELINE = [
  "Observation",
  "Hypothesis",
  "Offline Simulation",
  "Compliance Validation",
  "Controlled Experiment",
  "Measured Outcome",
  "Human Approval",
  "Limited Deployment",
  "Rollback-Capable Release",
];

const FEATURE_COMPONENTS = [
  { name: "Sensor", desc: "Collects evidence", color: "bg-blue-500" },
  { name: "Model", desc: "Predicts state & risk", color: "bg-indigo-500" },
  { name: "Actor", desc: "Recommends or executes", color: "bg-purple-500" },
  { name: "Evaluator", desc: "Measures if it worked", color: "bg-violet-500" },
  { name: "Governor", desc: "Determines if permitted", color: "bg-rose-500" },
];

export default function RolesPage() {
  const [selectedRole, setSelectedRole] = useState<RoleType>("field_representative");
  const twin: RoleTwin = ROLE_TWINS[selectedRole];
  const icon = ROLE_ICONS[selectedRole];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto max-w-6xl px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Role Execution Twins</h1>
          <p className="mt-1 text-sm text-slate-500">Every employee receives a role-conditioned AI twin with job descriptions, authority limits, and permitted actions</p>
        </div>

        {/* Role Selector */}
        <div className="mb-6 grid grid-cols-5 gap-3">
          {(Object.keys(ROLE_TWINS) as RoleType[]).map((role) => {
            const r = ROLE_TWINS[role];
            const ri = ROLE_ICONS[role];
            const isActive = selectedRole === role;
            return (
              <button
                key={role}
                onClick={() => setSelectedRole(role)}
                className={`rounded-2xl border p-4 text-center transition-all ${
                  isActive
                    ? `border-transparent bg-gradient-to-br ${ri.bg} text-white shadow-lg scale-105`
                    : "border-slate-200/60 bg-white text-slate-600 hover:border-slate-300 hover:shadow-sm"
                }`}
              >
                <div className="text-2xl mb-1">{ri.icon}</div>
                <div className="text-xs font-semibold">{r.title}</div>
              </button>
            );
          })}
        </div>

        {/* Role Detail */}
        <div className="space-y-4">
          {/* Job Description */}
          <div className={`rounded-2xl border bg-gradient-to-br p-5 ${selectedRole === "field_representative" ? "border-indigo-200 from-indigo-50 to-purple-50" : selectedRole === "regional_manager" ? "border-purple-200 from-purple-50 to-pink-50" : selectedRole === "medical_affairs" ? "border-teal-200 from-teal-50 to-cyan-50" : selectedRole === "market_access" ? "border-orange-200 from-orange-50 to-amber-50" : "border-red-200 from-red-50 to-rose-50"}`}>
            <h2 className="text-lg font-bold text-slate-900">{twin.title}</h2>
            <p className="mt-1 text-sm text-slate-700">{twin.jobDescription}</p>
            {twin.territoryScope && <p className="mt-1 text-xs text-slate-500">Scope: {twin.territoryScope}</p>}
            {twin.reportingStructure && <p className="text-xs text-slate-500">Reports: {twin.reportingStructure}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Permitted Systems */}
            <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Permitted Systems</h3>
              <div className="flex flex-wrap gap-1.5">
                {twin.permittedSystems.map((s) => {
                  const isWrite = s.includes("WRITE");
                  return (
                    <span key={s} className={`rounded px-2 py-0.5 text-[10px] font-mono ${isWrite ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                      {s}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Authority Limits */}
            <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Authority Limits</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Send External Email", value: twin.authorityLimits.canSendExternalEmail },
                  { label: "Modify CRM", value: twin.authorityLimits.canModifyCRM },
                  { label: "Schedule Meetings", value: twin.authorityLimits.canScheduleExternalMeeting },
                  { label: "Contact HCP", value: twin.authorityLimits.canContactHCP },
                  { label: "Approve Content", value: twin.authorityLimits.canApproveContent },
                ].map((a) => (
                  <div key={a.label} className="flex items-center gap-2">
                    <span className={`h-4 w-4 rounded-full ${a.value ? "bg-green-500" : "bg-slate-300"}`} />
                    <span className="text-xs text-slate-600">{a.label}</span>
                  </div>
                ))}
                {twin.authorityLimits.financialApprovalLimit !== undefined && (
                  <div className="col-span-2 text-xs text-slate-600">
                    Financial Limit: <span className="font-semibold">${twin.authorityLimits.financialApprovalLimit.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Approved Actions */}
            <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold text-green-700">Approved Actions</h3>
              <ul className="space-y-1">
                {twin.approvedActions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                    <span className="text-green-500 mt-0.5">✓</span> {a}
                  </li>
                ))}
              </ul>
            </div>

            {/* Prohibited Actions */}
            <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold text-red-700">Prohibited Actions</h3>
              <ul className="space-y-1">
                {twin.prohibitedActions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                    <span className="text-red-500 mt-0.5">✗</span> {a}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Recurring Deliverables */}
            <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Recurring Deliverables</h3>
              <ul className="space-y-1">
                {twin.recurringDeliverables.map((d, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="text-slate-400">📅</span> {d}
                  </li>
                ))}
              </ul>
            </div>

            {/* Domain Vocabulary */}
            <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Domain Vocabulary</h3>
              <div className="flex flex-wrap gap-1.5">
                {twin.domainVocabulary.map((v) => (
                  <span key={v} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{v}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Overdelivery Standard */}
          <div className="rounded-2xl border border-indigo-200/60 bg-indigo-50 p-4">
            <h3 className="text-xs font-semibold text-indigo-900 uppercase tracking-wide">Overdelivery Standard</h3>
            <p className="mt-1 text-sm text-indigo-700">{twin.overdeliveryStandard}</p>
          </div>
        </div>

        {/* Authority Comparison Matrix */}
        <div className="mt-8 rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm overflow-x-auto">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Authority Comparison Matrix</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 px-3 font-medium text-slate-500">Permission</th>
                {(Object.keys(ROLE_TWINS) as RoleType[]).map((r) => (
                  <th key={r} className="text-center py-2 px-3 font-medium text-slate-500">{ROLE_ICONS[r].icon}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Send External Email", key: "canSendExternalEmail" as const },
                { label: "Modify CRM", key: "canModifyCRM" as const },
                { label: "Schedule Meetings", key: "canScheduleExternalMeeting" as const },
                { label: "Contact HCP", key: "canContactHCP" as const },
                { label: "Approve Content", key: "canApproveContent" as const },
              ].map((perm) => (
                <tr key={perm.key} className="border-b border-slate-100">
                  <td className="py-2 px-3 text-slate-600">{perm.label}</td>
                  {(Object.keys(ROLE_TWINS) as RoleType[]).map((r) => (
                    <td key={r} className="text-center py-2 px-3">
                      {ROLE_TWINS[r].authorityLimits[perm.key] ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Self-Improvement Pipeline */}
        <div className="mt-8 rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-slate-700">Bounded Self-Improvement Loop</h3>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {IMPROVEMENT_PIPELINE.map((stage, i) => (
              <div key={stage} className="flex items-center gap-1 flex-shrink-0">
                <div className={`rounded-lg px-3 py-1.5 text-[10px] font-medium ${
                  i === 0 ? "bg-blue-100 text-blue-700" :
                  i < 3 ? "bg-indigo-100 text-indigo-700" :
                  i < 6 ? "bg-purple-100 text-purple-700" :
                  "bg-green-100 text-green-700"
                }`}>
                  {i + 1}. {stage}
                </div>
                {i < IMPROVEMENT_PIPELINE.length - 1 && <span className="text-slate-300">→</span>}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">The platform may recommend its own upgrades, but it cannot autonomously loosen promotional, legal, privacy, or medical boundaries.</p>
        </div>

        {/* Feature Architecture */}
        <div className="mt-4 rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-slate-700">Self-Improving Feature Architecture</h3>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {FEATURE_COMPONENTS.map((c, i) => (
              <div key={c.name} className="flex items-center gap-2">
                <div className="text-center">
                  <div className={`mx-auto mb-1 flex h-10 w-10 items-center justify-center rounded-xl ${c.color} text-white text-xs font-bold`}>
                    {c.name[0]}
                  </div>
                  <div className="text-xs font-semibold text-slate-700">{c.name}</div>
                  <div className="text-[10px] text-slate-400">{c.desc}</div>
                </div>
                {i < FEATURE_COMPONENTS.length - 1 && <span className="text-slate-300 text-lg">→</span>}
              </div>
            ))}
            <span className="text-slate-300 text-lg">↻</span>
          </div>
        </div>
      </div>
    </div>
  );
}
