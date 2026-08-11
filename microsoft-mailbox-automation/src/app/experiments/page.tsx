"use client";

import { GenericDataPage } from "@/components/data-view";
import { FlaskConical } from "lucide-react";
import { useCurrentUser } from "@/lib/auth/use-current-user";

export default function ExperimentsPage() {
  const { user, loading } = useCurrentUser();
  const employeeId = user?.id;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <FlaskConical className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const endpoint = employeeId
    ? `/api/spinor/email-engine?action=experiments&employeeId=${employeeId}`
    : "/api/spinor/email-engine?action=experiments";

  return (
    <GenericDataPage
      icon={FlaskConical}
      title="Experiments"
      subtitle="All active and completed email experiments from the SPINOR lab."
      endpoint={endpoint}
      listKey="experiments"
      listItemKey={(item) => item.id}
      renderItem={(item) => (
        <div className="space-y-1">
          <p className="font-medium text-foreground/90">
            {item.subjectLine || "Untitled experiment"} · {item.dimension?.replace(/_/g, " ")} · {item.status}
          </p>
          <p className="text-xs text-muted-foreground">
            {item.accountName || item.accountId || "Unknown account"}
            {item.causalLift != null ? ` · lift ${item.causalLift > 0 ? "+" : ""}${item.causalLift.toFixed(2)}` : ""}
            {item.outcome ? ` · outcome: ${item.outcome.replace(/_/g, " ")}` : ""}
          </p>
        </div>
      )}
      stats={[{ label: "Total", path: "count" }]}
    />
  );
}
