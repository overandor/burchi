"use client";

import { useState, useEffect, useCallback } from "react";
import { Scale, Trophy, Users, AlertTriangle, CheckCircle2 } from "lucide-react";
import { PageHeader, PageSection, Stat, EmptyState, Loading, ErrorState } from "@/components/page-shell";

interface FairnessAudit {
  totalHighUpside: number;
  builderMissions: number;
  goldenNodeCredit: number;
  hoardingDetected: boolean;
  perEmployee: {
    employeeId: string;
    highUpside: number;
    builder: number;
    replications: number;
    usefulFailures: number;
    goldenNodeCredit: number;
  }[];
}

interface ResearchReliability {
  employeeId: string;
  level: string;
  metrics: {
    executionQuality: number;
    evidenceQuality: number;
    completionRate: number;
    confounderControl: number;
    derivativeRate: number;
  };
}

interface CompetitionRanking {
  employeeId: string;
  totalScore: number;
  categoryWins: Record<string, number>;
}

export default function DiscoveryLedgerPage() {
  const [audit, setAudit] = useState<FairnessAudit | null>(null);
  const [reliability, setReliability] = useState<ResearchReliability[]>([]);
  const [rankings, setRankings] = useState<CompetitionRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [aRes, rRes, cRes] = await Promise.all([
        fetch("/api/golden/discovery-ledger?audit=true"),
        fetch("/api/golden/research-reliability"),
        fetch("/api/golden/competition?rank=true"),
      ]);
      const aData = await aRes.json();
      const rData = await rRes.json();
      const cData = await cRes.json();
      setAudit(aData.audit || null);
      setReliability(rData.reliability || []);
      setRankings(cData.rankings || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading message="Loading discovery ledger…" />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 page-enter">
      <PageHeader
        icon={Scale}
        title="Discovery Ledger"
        subtitle="Fairness audit, research reliability, and competition rankings."
      />

      {audit && (
        <PageSection title="Fairness audit" className="mt-6" actions={
          audit.hoardingDetected ? (
            <span className="badge border-destructive/30 bg-destructive/10 text-destructive">Hoarding detected</span>
          ) : (
            <span className="badge border-spinor-green/30 bg-spinor-green/10 text-foreground">No hoarding</span>
          )
        }>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="High-upside total" value={audit.totalHighUpside} />
            <Stat label="Builder missions" value={audit.builderMissions} />
            <Stat label="Golden node credit" value={audit.goldenNodeCredit} />
            <Stat label="Hoarding" value={audit.hoardingDetected ? "Detected" : "None"} tone={audit.hoardingDetected ? "red" : "green"} />
          </div>
          {audit.perEmployee.length > 0 && (
            <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-muted/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="p-3">Employee</th>
                    <th className="p-3">High-upside</th>
                    <th className="p-3">Builder</th>
                    <th className="p-3">Replications</th>
                    <th className="p-3">Useful failures</th>
                    <th className="p-3">GN credit</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.perEmployee.map((e) => (
                    <tr key={e.employeeId} className="border-t border-border">
                      <td className="p-3 text-foreground">{e.employeeId}</td>
                      <td className="p-3 text-foreground/90">{e.highUpside}</td>
                      <td className="p-3 text-foreground/90">{e.builder}</td>
                      <td className="p-3 text-foreground/90">{e.replications}</td>
                      <td className="p-3 text-foreground/90">{e.usefulFailures}</td>
                      <td className="p-3 text-foreground/90">{e.goldenNodeCredit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PageSection>
      )}

      <PageSection title="Research reliability" className="mt-6" actions={
        <span className="text-xs text-muted-foreground">{reliability.length} employees</span>
      }>
        {reliability.length === 0 ? (
          <EmptyState icon={Users} title="No reliability data" description="Experiment outcomes and confounder controls build reliability scores." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {reliability.map((r) => (
              <div key={r.employeeId} className="card p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-foreground">{r.employeeId}</p>
                  <span className="badge border-primary/30 bg-primary/10 text-primary">{r.level}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  {Object.entries(r.metrics || {}).map(([k, v]) => (
                    <div key={k}>
                      <p className="text-muted-foreground">{k.replace(/([A-Z])/g, " $1").trim()}</p>
                      <p className="font-medium text-foreground">{((v as number) * 100).toFixed(0)}%</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection title="Competition rankings" className="mt-6" actions={
        <Trophy className="h-4 w-4 text-muted-foreground" />
      }>
        {rankings.length === 0 ? (
          <EmptyState icon={Trophy} title="No rankings" description="Rankings appear as experiments accumulate and are attributed." />
        ) : (
          <div className="space-y-2">
            {rankings.sort((a, b) => b.totalScore - a.totalScore).map((r, i) => (
              <div key={r.employeeId} className="card p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-medium text-foreground">{r.employeeId}</p>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {Object.entries(r.categoryWins || {}).filter(([, v]) => (v as number) > 0).map(([k, v]) => (
                          <span key={k} className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground text-[10px]">
                            {k.replace(/_/g, " ")}: {v}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="text-lg font-bold text-foreground">{r.totalScore.toFixed(1)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageSection>
    </div>
  );
}
