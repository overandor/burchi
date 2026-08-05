"use client";

import { useState, useEffect, useCallback } from "react";

interface FairnessAudit { totalHighUpside: number; builderMissions: number; goldenNodeCredit: number; hoardingDetected: boolean; perEmployee: { employeeId: string; highUpside: number; builder: number; replications: number; usefulFailures: number; goldenNodeCredit: number; }[]; }
interface ResearchReliability { employeeId: string; level: string; metrics: { executionQuality: number; evidenceQuality: number; completionRate: number; confounderControl: number; derivativeRate: number; }; }
interface CompetitionRanking { employeeId: string; totalScore: number; categoryWins: Record<string, number>; }

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

  if (loading) return <div className="mx-auto max-w-4xl px-8 py-10"><p className="text-muted-foreground">Loading discovery ledger…</p></div>;
  if (error) return <div className="mx-auto max-w-4xl px-8 py-10"><div className="card p-6"><p className="text-status-blocked">{error}</p><button className="btn btn-primary mt-4" onClick={load}>Retry</button></div></div>;

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">History</h1>
      <p className="mt-2 text-muted-foreground">Discovery ledger, fairness audit, research reliability, and competition rankings.</p>
      {audit && (
        <div className="card mt-6 p-5">
          <p className="done-section-label">Fairness audit</p>
          <div className="mt-3 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div><p className="text-muted-foreground">High-upside total</p><p className="text-lg font-bold text-foreground">{audit.totalHighUpside}</p></div>
            <div><p className="text-muted-foreground">Builder missions</p><p className="text-lg font-bold text-foreground">{audit.builderMissions}</p></div>
            <div><p className="text-muted-foreground">Golden node credit</p><p className="text-lg font-bold text-foreground">{audit.goldenNodeCredit}</p></div>
            <div><p className="text-muted-foreground">Hoarding</p><p className={`text-lg font-bold ${audit.hoardingDetected ? "text-status-blocked" : "text-status-completed"}`}>{audit.hoardingDetected ? "Detected" : "None"}</p></div>
          </div>
          {audit.perEmployee.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-2">Employee</th><th className="pb-2">High-upside</th><th className="pb-2">Builder</th><th className="pb-2">Replications</th><th className="pb-2">Useful failures</th><th className="pb-2">GN credit</th></tr></thead>
              <tbody>
                {audit.perEmployee.map((e) => (<tr key={e.employeeId} className="border-t border-border"><td className="py-2 text-foreground">{e.employeeId}</td><td className="py-2 text-foreground/90">{e.highUpside}</td><td className="py-2 text-foreground/90">{e.builder}</td><td className="py-2 text-foreground/90">{e.replications}</td><td className="py-2 text-foreground/90">{e.usefulFailures}</td><td className="py-2 text-foreground/90">{e.goldenNodeCredit}</td></tr>))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <div className="card mt-4 p-5">
        <p className="done-section-label">Research reliability</p>
        {reliability.length === 0 ? (<p className="mt-3 text-sm text-muted-foreground">No reliability data yet.</p>) : (
          <div className="mt-3 space-y-3">
            {reliability.map((r) => (
              <div key={r.employeeId} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between"><p className="font-medium text-foreground">{r.employeeId}</p><span className="rounded-full bg-foreground/10 px-2.5 py-0.5 text-xs font-medium text-foreground">{r.level}</span></div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
                  {Object.entries(r.metrics).map(([k, v]) => (<div key={k}><p className="text-muted-foreground">{k.replace(/([A-Z])/g, " $1").trim()}</p><p className="font-medium text-foreground">{(v * 100).toFixed(0)}%</p></div>))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card mt-4 p-5">
        <p className="done-section-label">Research competition</p>
        {rankings.length === 0 ? (<p className="mt-3 text-sm text-muted-foreground">No rankings yet.</p>) : (
          <div className="mt-3 space-y-2">
            {rankings.map((r, i) => (
              <div key={r.employeeId} className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground/10 text-sm font-bold text-foreground">{i + 1}</span>
                  <div><p className="font-medium text-foreground">{r.employeeId}</p><div className="mt-0.5 flex flex-wrap gap-1">{Object.entries(r.categoryWins).filter(([, v]) => v > 0).map(([k, v]) => (<span key={k} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{k.replace(/_/g, " ")}: {v}</span>))}</div></div>
                </div>
                <p className="text-lg font-bold text-foreground">{r.totalScore.toFixed(1)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
