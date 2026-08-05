"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/today", label: "TODAY", icon: "◉" },
  { href: "/inbox", label: "INBOX", icon: "✉" },
  { href: "/foundry", label: "FOUNDRY", icon: "◈" },
  { href: "/experiment", label: "EXPERIMENT", icon: "⚗" },
  { href: "/results", label: "RESULTS", icon: "📊" },
  { href: "/golden-nodes", label: "GOLDEN NODES", icon: "✦" },
  { href: "/spinor-rl", label: "SPINOR-RL", icon: "↔" },
  { href: "/history", label: "HISTORY", icon: "📜" },
];

export function GameNav() {
  const pathname = usePathname() ?? "";
  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-3 transition-transform hover:scale-105">
          <div className="relative flex h-9 w-9 items-center justify-center">
            <div className="absolute inset-0 organic-border bg-gradient-to-br from-primary/80 to-accent/60 animate-glow-pulse" />
            <span className="relative text-xs font-bold text-background">AF</span>
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">Advantage Foundry</h1>
            <p className="text-[10px] font-medium text-muted-foreground">Perpetual Scientific-Work Game</p>
          </div>
        </Link>
        <nav className="hidden items-center gap-1 lg:flex">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-card/50 hover:text-foreground"
                }`}
              >
                <span className="text-sm">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1">
            <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-working" />
            <span className="text-xs font-medium text-primary">Live</span>
          </div>
        </div>
      </div>
      {/* Mobile nav */}
      <div className="flex items-center gap-1 overflow-x-auto px-4 pb-2 lg:hidden scrollbar-thin">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all ${
                active ? "bg-primary/10 text-primary" : "text-muted-foreground"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}

const contributionRoles = [
  { key: "originator", label: "Originator", icon: "◈", desc: "First proposed the hypothesis" },
  { key: "mutator", label: "Mutator", icon: "🧬", desc: "Modified an existing strategy" },
  { key: "executor", label: "Executor", icon: "⚡", desc: "Ran the experiment in real work" },
  { key: "validator", label: "Validator", icon: "✓", desc: "Confirmed replication" },
  { key: "replicator", label: "Replicator", icon: "⟳", desc: "Reproduced across contexts" },
  { key: "automator", label: "Automator", icon: "⚙", desc: "Systematized the method" },
  { key: "channel_architect", label: "Channel Architect", icon: "🏛", desc: "Promoted to business channel" },
];

export { contributionRoles };
