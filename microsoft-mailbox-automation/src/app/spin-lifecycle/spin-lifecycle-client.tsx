"use client";

import { GenericDataPage } from "@/components/data-view";
import { RefreshCw } from "lucide-react";

export default function SpinLifecycleClient() {
  return (
    <GenericDataPage
      icon={RefreshCw}
      title="SPIN Lifecycle"
      subtitle="States and transitions for every SPIN in the system."
      endpoint="/api/spin/spins?summary=true"
      listKey="spins"
      listItemKey={(item) => item.spinId || item.id || JSON.stringify(item)}
      renderItem={(item) => (
        <div className="space-y-1">
          <p className="font-medium text-foreground/90">{item.claim || item.spinId}</p>
          <p className="text-xs text-muted-foreground">State: {item.state} · Owner: {item.employeeOwner} · {item.territory || "—"}</p>
        </div>
      )}
      stats={[{ label: "Total", path: "count" },{ label: "In DB", path: "totalInDb" }]}
    />
  );
}
