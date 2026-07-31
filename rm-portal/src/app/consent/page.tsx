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

      {/* Hard Constraints */}
      <Card className="border-emerald-900/50 bg-emerald-950/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <Shield className="h-4 w-4 text-emerald-400" />
            Hard Constraints — Enforced Technically
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            { rule: "Recipients must be opted in — affirmative, recorded communication permission required", constraint: "C1" },
            { rule: "No unsolicited outbound messaging — non-consenting contacts are analytics-only", constraint: "C2" },
            { rule: "Consent is explicit in the data model: source, timestamp, scope, channel, withdrawal status", constraint: "C3" },
            { rule: "Human approval controls what gets sent; recipient consent controls who may receive anything", constraint: "C4" },
            { rule: "A/B testing operates only on opted-in interactions or first-party surfaces", constraint: "C5" },
            { rule: "Reward signal: response quality, CSAT, booking completion, retention, helpfulness — not persuasion", constraint: "C6" },
            { rule: "Send path rejects any recipient lacking valid consent — enforced in code, not policy text", constraint: "C7" },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-zinc-300">
              <Badge variant="outline" className="mt-0.5 shrink-0 border-emerald-700 bg-emerald-900/30 text-[10px] font-mono text-emerald-400">
                {item.constraint}
              </Badge>
              <span>{item.rule}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Rejected Consent Bases */}
      <Card className="border-red-900/50 bg-red-950/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <Ban className="h-4 w-4 text-red-400" />
            Rejected Consent Bases — Will Never Be Accepted
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {[
              "page_visit", "scraped_profile", "public_info", "inferred_interest",
              "third_party_list", "implicit_visit_behavior", "browser_history",
              "social_media_public", "directory_listing", "analytics_inferred",
            ].map((basis) => (
              <Badge key={basis} variant="outline" className="border-red-800 bg-red-900/20 font-mono text-[10px] text-red-400">
                <Ban className="mr-1 h-2.5 w-2.5" />{basis}
              </Badge>
            ))}
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            These sources are rejected at the API layer (400) and database layer (CHECK constraint).
            Any attempt to create a contact with one of these as consent_source returns a descriptive error.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
