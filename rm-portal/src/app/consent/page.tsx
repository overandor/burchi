"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Users, Shield, Ban, Mail, FlaskConical, TrendingUp, MailCheck, AlertCircle } from "lucide-react"
import { useApi } from "@/lib/api"
import { consentApi, type ConsentOverview } from "@/lib/consent"
import { LoadingState, PageHeader, StatCard } from "@/components/ui-helpers"
import Link from "next/link"

export default function ConsentOverviewPage() {
  const { data, loading } = useApi<ConsentOverview>(() => consentApi.getOverview(), [], 15000)

  if (loading || !data) return <LoadingState label="Loading consent overview..." />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Consent Engagement"
        subtitle="Opt-in contact pipeline: consented input → eligibility → generation → approval → send → measure → audit"
      />

      {/* Pipeline flow */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader>
          <CardTitle className="text-base text-white">Pipeline Flow</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {[
              { label: "Consented Input", href: "/consent/contacts", color: "text-emerald-400" },
              { label: "Eligibility Check", href: "/consent/consent", color: "text-blue-400" },
              { label: "Message Generation", href: "/consent/messages", color: "text-purple-400" },
              { label: "Approval Gate", href: "/consent/messages", color: "text-amber-400" },
              { label: "Send", href: "/consent/messages", color: "text-cyan-400" },
              { label: "Measure", href: "/consent/outcomes", color: "text-pink-400" },
              { label: "Audit", href: "/consent/audit", color: "text-zinc-400" },
            ].map((step, i, arr) => (
              <div key={step.label} className="flex items-center gap-2">
                <Link href={step.href} className={`rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-medium ${step.color} hover:bg-zinc-800`}>
                  {step.label}
                </Link>
                {i < arr.length - 1 && <span className="text-zinc-600">→</span>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Users} value={data.total_contacts} label="Total Contacts" color="text-blue-400" />
        <StatCard icon={Shield} value={data.active_consent} label="Active Consent" color="text-emerald-400" />
        <StatCard icon={Ban} value={data.suppressed} label="Suppressed" color="text-red-400" />
        <StatCard icon={MailCheck} value={data.pending_approval} label="Pending Approval" color="text-amber-400" />
        <StatCard icon={Mail} value={data.sent_messages} label="Sent Messages" color="text-cyan-400" />
        <StatCard icon={FlaskConical} value={data.active_experiments} label="Active Experiments" color="text-purple-400" />
        <StatCard icon={TrendingUp} value={data.recent_outcomes} label="Recent Outcomes (30d)" color="text-pink-400" />
        <StatCard icon={AlertCircle} value={data.revoked_consent} label="Revoked Consent" color="text-orange-400" />
      </div>

      {/* Guardrails */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader>
          <CardTitle className="text-base text-white">Guardrails</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            "Only contacts with verifiable opt-in or first-party relationship may be messaged",
            "Page visits, scraped profiles, inferred interest, or public info are NOT consent",
            "Every message requires human approval unless recipient opted into that specific class",
            "Suppression and unsubscribe lists are enforced at the send boundary",
            "Experiments run only on consenting audiences",
            "Optimization targets: helpfulness, CSAT, booking-after-inquiry, retention, support time",
            "Immutable audit trail shows why each recipient was eligible",
            "Recipients whose consent cannot be established are rejected",
          ].map((rule, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-zinc-400">
              <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span>{rule}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
