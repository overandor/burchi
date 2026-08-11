"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Target, ArrowLeft, DollarSign, Users, AlertTriangle, TrendingUp } from "lucide-react";

interface VentureCapsule {
  id: string;
  name: string;
  problemSolved: string;
  targetUsers: string[];
  commercializationHypothesis: string;
  status: string;
  unitEconomics: {
    operatingCost: number;
    revenuePotential: number;
    margin: number;
    breakEvenUnits: number;
    notes: string;
  };
  requiredIntegrations: string[];
  complianceRequirements: string[];
  outcomeEvidence: string[];
  replicationEvidence: string[];
  marketAlternatives: string[];
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  identified: "bg-blue-500/10 text-blue-500",
  validated: "bg-green-500/10 text-green-500",
  packaged: "bg-purple-500/10 text-purple-500",
  deployed: "bg-amber-500/10 text-amber-500",
  retired: "bg-gray-500/10 text-gray-500",
};

export default function VentureCapsulesPage() {
  const [ventures, setVentures] = useState<VentureCapsule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchVentures = useCallback(async () => {
    try {
      const res = await fetch("/api/workteleport/ventures");
      if (res.ok) {
        const data = await res.json();
        setVentures(data.ventures || []);
      }
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVentures();
  }, [fetchVentures]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-4">
          <Link href="/workteleport" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Target className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Venture Capsules</h1>
            <p className="text-xs text-muted-foreground">Golden Nodes → deployable business channels</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-500">
            <AlertTriangle className="h-4 w-4" /> Governance Boundary
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            The system may identify and package opportunities. It must NOT autonomously create legal entities,
            enter contracts, spend capital, or commercialize regulated data without authorized human governance.
          </p>
        </div>

        {loading ? (
          <div className="text-muted-foreground">Loading venture capsules...</div>
        ) : ventures.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <Target className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No venture capsules yet. Ventures are formed when Golden Nodes demonstrate value beyond their original department.</p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {ventures.map((v) => (
              <div key={v.id} className="rounded-xl border border-border bg-card p-6">
                <div className="mb-3 flex items-start justify-between">
                  <h2 className="text-lg font-bold">{v.name}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[v.status] || ""}`}>
                    {v.status}
                  </span>
                </div>

                <p className="mb-4 text-sm text-muted-foreground">{v.problemSolved}</p>

                {/* Unit Economics */}
                <div className="mb-4 rounded-lg border border-border/50 bg-background p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                    <DollarSign className="h-3 w-3 text-green-500" /> Unit Economics
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                    <div>
                      <div className="text-muted-foreground">Cost</div>
                      <div className="font-semibold">${v.unitEconomics.operatingCost}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Revenue</div>
                      <div className="font-semibold">${v.unitEconomics.revenuePotential}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Margin</div>
                      <div className="font-semibold text-green-500">{(v.unitEconomics.margin * 100).toFixed(0)}%</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Break-even</div>
                      <div className="font-semibold">{v.unitEconomics.breakEvenUnits} units</div>
                    </div>
                  </div>
                  {v.unitEconomics.notes && (
                    <p className="mt-2 text-xs text-muted-foreground">{v.unitEconomics.notes}</p>
                  )}
                </div>

                {/* Target Users */}
                {v.targetUsers.length > 0 && (
                  <div className="mb-3">
                    <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
                      <Users className="h-3 w-3 text-blue-500" /> Target Users
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {v.targetUsers.map((u) => (
                        <span key={u} className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-500">{u}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Commercialization Hypothesis */}
                <div className="mb-3">
                  <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
                    <TrendingUp className="h-3 w-3 text-purple-500" /> Commercialization
                  </div>
                  <p className="text-xs text-muted-foreground">{v.commercializationHypothesis}</p>
                </div>

                {/* Compliance */}
                {v.complianceRequirements.length > 0 && (
                  <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2">
                    <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-amber-500">
                      <AlertTriangle className="h-3 w-3" /> Compliance Requirements
                    </div>
                    <ul className="text-xs text-muted-foreground">
                      {v.complianceRequirements.map((c, i) => (
                        <li key={i}>• {c}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Evidence */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Outcome evidence:</span> {v.outcomeEvidence.length}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Replication evidence:</span> {v.replicationEvidence.length}
                  </div>
                </div>

                <div className="mt-3 text-xs text-muted-foreground">
                  Created {new Date(v.createdAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
