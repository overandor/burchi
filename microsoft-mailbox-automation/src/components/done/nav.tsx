"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDoneStore } from "@/lib/done/store";

const navItems = [
  { href: "/today", label: "Today", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { href: "/inbox", label: "Inbox", icon: "M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm0 4l-8 5-8-5" },
  { href: "/foundry", label: "Foundry", icon: "M12 2C8 6 6 10 12 14c6-4 4-8 0-12zM12 14c-3 3-3 6 0 8 3-2 3-5 0-8zM12 14c3-3 6-3 8 0-2 3-5 3-8 0zM12 14c-3 0-6-3-8 0 2 3 5 3 8 0z" },
  { href: "/experiments", label: "Experiment", icon: "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 01-3.86-3.86l-.477-2.387a2 2 0 00-.547-1.022L9.172 4.172a4 4 0 00-5.656 5.656l1.06 1.06a2 2 0 001.022.547l2.387.477a6 6 0 013.86 3.86l.477 2.387a2 2 0 00.547 1.022l1.06 1.06a4 4 0 005.656-5.656l-1.06-1.06z" },
  { href: "/results", label: "Results", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  { href: "/golden-nodes", label: "Golden Nodes", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  { href: "/discovery-ledger", label: "History", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
];

function NavIcon({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={d} />
    </svg>
  );
}

export function DoneNav() {
  const pathname = usePathname() ?? "";
  const { approvals, workItems, personalityMode, togglePersonality } = useDoneStore();

  const pendingApprovals = approvals.filter((a) => a.status === "pending").length;
  const needsCount = workItems.filter((w) => w.status === "needs").length;
  const badgeCount = pendingApprovals + needsCount;

  return (
    <nav className="flex h-full w-56 flex-col border-r border-border bg-card">
      <Link href="/today" className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background font-bold text-sm">
          A
        </div>
        <span className="text-sm font-bold tracking-tight text-foreground">ADVANTAGE FOUNDRY</span>
      </Link>

      <div className="flex-1 space-y-0.5 px-3">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (!["/today", "/foundry"].includes(item.href) && pathname.startsWith(item.href));
          const showBadge = item.href === "/approvals" && badgeCount > 0;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                isActive
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              }`}
            >
              <NavIcon d={item.icon} className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{item.label}</span>
              {showBadge && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-status-needs px-1.5 text-[11px] font-bold text-background">
                  {badgeCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="border-t border-border p-3">
        <button
          onClick={togglePersonality}
          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-all ${
            personalityMode
              ? "bg-status-needs/10 text-status-needs"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          }`}
        >
          <span>Personality mode</span>
          <span className={`relative h-4 w-7 rounded-full transition-all ${personalityMode ? "bg-status-needs" : "bg-muted"}`}>
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-background transition-all ${personalityMode ? "left-3.5" : "left-0.5"}`} />
          </span>
        </button>
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
            J
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">Joseph</p>
            <p className="truncate text-[11px] text-muted-foreground">Territory Rep — NE Manhattan</p>
          </div>
        </div>
      </div>
    </nav>
  );
}
