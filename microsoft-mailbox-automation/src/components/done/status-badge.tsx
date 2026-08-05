import type { WorkStatus } from "@/lib/done/types";

const statusConfig: Record<WorkStatus, { label: string; color: string; bg: string; border: string; dot: string }> = {
  new: {
    label: "New",
    color: "text-muted-foreground",
    bg: "bg-muted/50",
    border: "border-border",
    dot: "bg-status-new",
  },
  working: {
    label: "Working",
    color: "text-status-working",
    bg: "bg-status-working/10",
    border: "border-status-working/30",
    dot: "bg-status-working",
  },
  needs: {
    label: "Needs you",
    color: "text-status-needs",
    bg: "bg-status-needs/10",
    border: "border-status-needs/30",
    dot: "bg-status-needs",
  },
  completed: {
    label: "Completed",
    color: "text-status-completed",
    bg: "bg-status-completed/10",
    border: "border-status-completed/30",
    dot: "bg-status-completed",
  },
  blocked: {
    label: "Blocked",
    color: "text-status-blocked",
    bg: "bg-status-blocked/10",
    border: "border-status-blocked/30",
    dot: "bg-status-blocked",
  },
};

export function StatusBadge({ status, size = "md" }: { status: WorkStatus; size?: "sm" | "md" }) {
  const cfg = statusConfig[status];
  const padding = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border ${cfg.border} ${cfg.bg} ${cfg.color} ${padding} font-semibold`}>
      <span className={`status-dot ${cfg.dot} ${status === "working" ? "animate-pulse-working" : ""}`} />
      {cfg.label}
    </span>
  );
}

export function StatusDot({ status }: { status: WorkStatus }) {
  const cfg = statusConfig[status];
  return <span className={`status-dot ${cfg.dot} ${status === "working" ? "animate-pulse-working" : ""}`} />;
}

export { statusConfig };
