"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Network, RefreshCw, Send, Zap, ArrowRight, CheckCircle2 } from "lucide-react"
import { api, useApi } from "@/lib/api"
import { PageHeader, StatCard, SectionCard } from "@/components/ui-helpers"

export default function ConsentBridgePage() {
  const { data: status, loading } = useApi<any>(() => api.consentBridgeStatus(), [], 30000)
  const [syncResult, setSyncResult] = useState<any>(null)
  const [followupResult, setFollowupResult] = useState<any>(null)
  const [syncing, setSyncing] = useState(false)
  const [generating, setGenerating] = useState(false)

  // Sync form state
  const [contactEmail, setContactEmail] = useState("")
  const [contactName, setContactName] = useState("")
  const [consentSource, setConsentSource] = useState("signup_form")
  const [consentScope, setConsentScope] = useState("marketing")

  // Followup form state
  const [inquiryText, setInquiryText] = useState("")
  const [inquiryContactId, setInquiryContactId] = useState("")

  async function handleSync() {
    setSyncing(true)
    const contactId = `contact-${Date.now()}`
    const result = await api.consentBridgeSyncContact({
      contact_id: contactId,
      email: contactEmail,
      name: contactName,
      consent_source: consentSource,
      consent_scope: consentScope,
      consented_at: new Date().toISOString(),
    })
    setSyncResult(result)
    setSyncing(false)
  }

  async function handleFollowup() {
    setGenerating(true)
    const result = await api.consentBridgeAutoFollowup({
      contact_id: inquiryContactId || `inquiry-${Date.now()}`,
      inquiry_text: inquiryText,
      consent_scope: "support",
    })
    setFollowupResult(result)
    setGenerating(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground">Loading bridge status...</div>
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Consent → RevOps Bridge"
        subtitle="Connects consented contacts to the revenue operations pipeline — visitor intelligence, RL reward loop, and AI-generated follow-ups"
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          icon={Network}
          value={status?.status === "active" ? "Active" : "Unknown"}
          label="Bridge Status"
          color="text-emerald-400"
        />
        <StatCard
          icon={Zap}
          value={status?.endpoints?.length || 0}
          label="Endpoints"
          color="text-blue-400"
        />
        <StatCard
          icon={ArrowRight}
          value="3"
          label="Bridge Functions"
          color="text-purple-400"
        />
      </div>

      {/* Sync Contact → Visitor */}
      <SectionCard title="Sync Consent Contact → Visitor Intelligence">
        <p className="text-sm text-muted-foreground mb-4">
          When a contact gives explicit consent, they become a tracked visitor in the RevOps backend.
          This enables engagement scoring, lifecycle stage tracking, and AI-driven follow-up.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Contact Email</label>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="client@example.com"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Contact Name</label>
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Consent Source</label>
            <input
              value={consentSource}
              onChange={(e) => setConsentSource(e.target.value)}
              placeholder="signup_form"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Consent Scope</label>
            <input
              value={consentScope}
              onChange={(e) => setConsentScope(e.target.value)}
              placeholder="marketing"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>
        <Button onClick={handleSync} disabled={syncing || !contactEmail} className="mt-4">
          {syncing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
          Sync to Visitor Pipeline
        </Button>
        {syncResult && (
          <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-medium">Contact Synced</span>
            </div>
            <pre className="text-xs text-muted-foreground overflow-auto">
              {JSON.stringify(syncResult, null, 2)}
            </pre>
          </div>
        )}
      </SectionCard>

      {/* Auto Follow-up */}
      <SectionCard title="AI Auto Follow-up (Consent-Verified)">
        <p className="text-sm text-muted-foreground mb-4">
          Generates a contextually relevant follow-up response using the AI engine (Qwen2.5-0.5B via llama.cpp).
          Only works for contacts with active consent.
        </p>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Contact ID (optional)</label>
            <input
              value={inquiryContactId}
              onChange={(e) => setInquiryContactId(e.target.value)}
              placeholder="contact-abc123"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Inquiry Text</label>
            <textarea
              value={inquiryText}
              onChange={(e) => setInquiryText(e.target.value)}
              placeholder="Hi, I'm interested in booking a session. What are your rates?"
              className="w-full min-h-[100px] rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <Button onClick={handleFollowup} disabled={generating || !inquiryText}>
            {generating ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Generate Follow-up
          </Button>
          {followupResult && (
            <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-medium">AI-Generated Follow-up</span>
                {followupResult?.model_used && (
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {followupResult.model_used}
                  </Badge>
                )}
              </div>
              <div className="rounded-md bg-background/50 p-3 text-sm text-foreground">
                {followupResult?.generated_message || "No response generated"}
              </div>
              {followupResult?.inference_meta && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Runtime: {followupResult.inference_meta.runtime} | Latency: {followupResult.inference_meta.latency_ms}ms
                </div>
              )}
            </div>
          )}
        </div>
      </SectionCard>

      {/* Bridge Architecture */}
      <SectionCard title="Bridge Architecture">
        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 text-xs font-bold">1</div>
            <div>
              <div className="font-medium text-foreground">Contact Sync</div>
              <div className="text-muted-foreground">
                POST /api/consent-bridge/sync-contact — Consent contacts become tracked visitors with engagement scores
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-500/20 text-purple-400 text-xs font-bold">2</div>
            <div>
              <div className="font-medium text-foreground">Reward Signal</div>
              <div className="text-muted-foreground">
                POST /api/consent-bridge/reward-signal — Consent experiment rewards feed into the RL decision loop
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold">3</div>
            <div>
              <div className="font-medium text-foreground">Auto Follow-up</div>
              <div className="text-muted-foreground">
                POST /api/consent-bridge/auto-followup — AI generates follow-up responses for consented inquiries
              </div>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
