"use client";

import { useState, useEffect, useCallback } from "react";
import { Clock, ShieldCheck, Sparkles } from "lucide-react";
import { useVoiceCommand } from "@/components/useVoiceCommand";
import { useVoicePage } from "@/components/VoiceContext";
import { useCurrentUser } from "@/lib/auth/use-current-user";

export default function HistoryPage() {
  const { user } = useCurrentUser();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const employeeId = user?.id || "gilead-rep-001";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/golden/assignments?employeeId=${employeeId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAssignments(data.assignments || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  const auditFairness = useCallback(async () => {
    setAuditLoading(true);
    setAudit(null);
    try {
      const summary = assignments.map((a) => ({
        kind: a.kind,
        state: a.state,
        trial: a.trialNumber,
        role: a.employeeRole,
        reason: a.assignmentReason,
      }));
      const res = await fetch("/api/llm/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are Foundry, auditing assignment fairness. Check for equal opportunity, systematic bias, and preferential treatment. Be specific." },
            { role: "user", content: `Audit the fairness of these ${assignments.length} assignment distributions. Check for:\n1. Equal opportunity across employees\n2. No systematic bias in assignment reasons\n3. Fair trial distribution\n4. No pattern of preferential treatment\n\nAssignments:\n${JSON.stringify(summary, null, 2)}\n\nRespond with a fairness assessment in 3-4 sentences.` },
          ],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text = data.content || data.text || data.choices?.[0]?.message?.content || data.response || "Audit unavailable.";
      setAudit(text);
      return { success: true, speech: text.slice(0, 200) };
    } catch (e: any) {
      setAudit(`Fairness audit failed: ${e.message}`);
      return { success: false, speech: `Fairness audit failed: ${e.message}` };
    } finally {
      setAuditLoading(false);
    }
  }, [assignments]);

  useVoiceCommand({
    audit_fairness: () => auditFairness(),
  });

  useVoicePage({
    pageId: "history",
    title: "History",
    summary: loading
      ? "Loading assignment history..."
      : `${assignments.length} past assignment${assignments.length !== 1 ? "s" : ""}. States: ${[...new Set(assignments.map((a) => a.state))].join(", ")}.`,
    actions: [
      {
        name: "audit_fairness",
        label: "audit fairness",
        available: assignments.length > 0 && !auditLoading,
        handler: async () => auditFairness(),
      },
    ],
  });

  if (loading) return (
    <div className="mx-auto max-w-4xl px-8 py-20 text-center page-enter">
      <div className="inline-flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
          <div className="llm-thinking-dots"><span /><span /><span /></div>
        </div>
        <p className="text-sm text-muted-foreground">Loading history…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="mx-auto max-w-4xl px-8 py-10 page-enter">
      <div className="glass-card p-6 border-destructive/20">
        <p className="text-sm text-destructive">{error}</p>
        <button className="btn btn-primary mt-4" onClick={load}>Retry</button>
      </div>
    </div>
  );

  return (
    <div className="page-enter mx-auto max-w-5xl px-8 py-10">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Clock className="h-7 w-7 text-primary" /> History
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Past assignments, outcomes, and state transitions.</p>
        </div>
        <button className="btn btn-primary" onClick={auditFairness} disabled={auditLoading || assignments.length === 0}>
          {auditLoading ? <><Sparkles className="h-4 w-4 animate-spin mr-1" /> Auditing...</> : <><ShieldCheck className="h-4 w-4 mr-1" /> Audit Fairness</>}
        </button>
      </div>

      {audit && (
        <div className="glass-card p-5 mb-6 fade-in">
          <h3 className="font-bold mb-2 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-400" /> Fairness Audit</h3>
          <p className="text-sm leading-relaxed">{audit}</p>
        </div>
      )}

      <div className="space-y-3">
        {assignments.length === 0 ? (
          <div className="glass-card p-6 text-center">
            <p className="text-sm text-muted-foreground">No assignment history yet.</p>
          </div>
        ) : (
          assignments.map((item) => (
            <div key={item.id} className="glass-card p-4">
              <p className="font-medium text-foreground/90">
                {item.assignmentReason?.replace(/_/g, " ")} · {item.kind} · {item.state}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Trial {item.trialNumber} · {item.employeeRole?.replace(/_/g, " ")} · {item.assignedAt ? new Date(item.assignedAt).toLocaleDateString() : "—"}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
