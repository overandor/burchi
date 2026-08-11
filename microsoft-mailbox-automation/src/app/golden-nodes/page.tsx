"use client";

import { useState, useEffect, useCallback } from "react";
import { Award, Sparkles, Network } from "lucide-react";
import { useVoiceCommand } from "@/components/useVoiceCommand";
import { useVoicePage } from "@/components/VoiceContext";
import { useCurrentUser } from "@/lib/auth/use-current-user";

export default function GoldenNodesPage() {
  const { user } = useCurrentUser();
  const employeeId = user?.id || "gilead-rep-001";
  const [nodes, setNodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [lineage, setLineage] = useState<string | null>(null);
  const [lineageLoading, setLineageLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/golden/golden-nodes?employeeId=${employeeId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = data.goldenNodes || data.nodes || [];
      setNodes(list);
      if (list.length > 0 && !selectedNode) setSelectedNode(list[0]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  const explainLineage = useCallback(async (node: any) => {
    if (!node) return { success: false, speech: "No Golden Node selected." };
    setLineageLoading(true);
    setLineage(null);
    try {
      const res = await fetch("/api/llm/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are Foundry, explaining the research lineage of a Golden Node. Be concise and specific." },
            { role: "user", content: `Explain the research lineage of this Golden Node in 2-3 sentences:\nID: ${node.id}\nHypothesis: ${node.hypothesisId}\nStage: ${node.stage}\nReplications: ${node.replications}\nPortability: ${node.portability}\n\nHow was it discovered, validated, and promoted?` },
          ],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text = data.content || data.text || data.choices?.[0]?.message?.content || data.response || "Lineage unavailable.";
      setLineage(text);
      return { success: true, speech: text.slice(0, 200) };
    } catch (e: any) {
      setLineage(`Lineage explanation failed: ${e.message}`);
      return { success: false, speech: `Lineage explanation failed: ${e.message}` };
    } finally {
      setLineageLoading(false);
    }
  }, []);

  useVoiceCommand({
    explain_lineage: () => { if (selectedNode) explainLineage(selectedNode); },
  });

  useVoicePage({
    pageId: "golden-nodes",
    title: "Golden Nodes",
    summary: loading
      ? "Loading Golden Nodes..."
      : `${nodes.length} Golden Node${nodes.length !== 1 ? "s" : ""}.${selectedNode ? ` Selected: ${selectedNode.title || selectedNode.hypothesisId}.` : ""}`,
    actions: [
      {
        name: "explain_lineage",
        label: "explain lineage",
        available: !!selectedNode && !lineageLoading,
        handler: async () => {
          return await explainLineage(selectedNode);
        },
      },
    ],
  });

  if (loading) return (
    <div className="mx-auto max-w-4xl px-8 py-20 text-center page-enter">
      <div className="inline-flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
          <div className="llm-thinking-dots"><span /><span /><span /></div>
        </div>
        <p className="text-sm text-muted-foreground">Loading Golden Nodes…</p>
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
            <Award className="h-7 w-7 text-yellow-500" /> Golden Nodes
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Validated, replicable capabilities promoted through the SPIN lifecycle.</p>
        </div>
        <span className="badge badge-yellow">{nodes.length} total</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Node list */}
        <div className="space-y-3">
          {nodes.length === 0 ? (
            <div className="glass-card p-6 text-center">
              <p className="text-sm text-muted-foreground">No Golden Nodes yet. Complete the SPIN lifecycle to promote validated capabilities.</p>
            </div>
          ) : (
            nodes.map((node) => (
              <div
                key={node.id}
                className={`glass-card p-4 cursor-pointer transition-colors ${selectedNode?.id === node.id ? "border-yellow-500/40" : ""}`}
                onClick={() => { setSelectedNode(node); setLineage(null); }}
              >
                <p className="font-medium text-foreground/90">{node.title || node.hypothesisId}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Stage: {node.stage} · Replications: {node.replications} · Portability: {node.portability}
                </p>
              </div>
            ))
          )}
        </div>

        {/* Detail + lineage */}
        <div className="space-y-4">
          {selectedNode && (
            <div className="glass-card p-5">
              <h3 className="font-bold mb-3 flex items-center gap-2">
                <Network className="h-4 w-4 text-yellow-500" /> Lineage
              </h3>
              <div className="space-y-2 text-sm mb-4">
                <div><span className="text-muted-foreground">ID:</span> {selectedNode.id}</div>
                <div><span className="text-muted-foreground">Stage:</span> {selectedNode.stage}</div>
                <div><span className="text-muted-foreground">Replications:</span> {selectedNode.replications}</div>
                <div><span className="text-muted-foreground">Portability:</span> {selectedNode.portability}</div>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => explainLineage(selectedNode)}
                disabled={lineageLoading}
              >
                {lineageLoading ? <><Sparkles className="h-4 w-4 animate-spin mr-1" /> Explaining...</> : <><Network className="h-4 w-4 mr-1" /> Explain Lineage</>}
              </button>
              {lineage && (
                <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4 text-sm leading-relaxed fade-in">
                  {lineage}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
