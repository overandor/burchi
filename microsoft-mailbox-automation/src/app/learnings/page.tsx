"use client";

import { GenericDataPage } from "@/components/data-view";
import { Lightbulb } from "lucide-react";

export default function LearningsPage() {
  return (
    <GenericDataPage
      icon={Lightbulb}
      title="Learnings"
      subtitle="Derivative hypotheses and proven strategy permutations."
      endpoint="/api/golden/derivatives"
      listKey="derivatives"
      listItemKey={(d) => d.id}
      renderItem={(d) => (
        <div className="space-y-1">
          <p className="font-medium text-foreground/90">{d.claim}</p>
          <p className="text-xs text-muted-foreground">
            {d.modifiedDimension?.replace(/_/g, " ")} · {d.status} · {d.origin}
          </p>
        </div>
      )}
      stats={[
        { label: "Total", path: "count" },
      ]}
    />
  );
}
