"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Award,
  BarChart3,
  Beaker,
  Calendar,
  Clock,
  FlaskConical,
  GitBranch,
  Inbox,
  Layers,
  Mic,
  RefreshCw,
  Workflow,
} from "lucide-react";

const navItems = [
  { href: "/today", label: "Today", icon: Calendar },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/foundry", label: "Foundry", icon: FlaskConical },
  { href: "/experiment", label: "Experiment", icon: Beaker },
  { href: "/results", label: "Results", icon: BarChart3 },
  { href: "/golden-nodes", label: "Golden Nodes", icon: Award },
  { href: "/spin-lifecycle", label: "SPIN", icon: RefreshCw },
  { href: "/etl", label: "ETL", icon: Workflow },
  { href: "/spinor-rl", label: "SPINOR-RL", icon: GitBranch },
  { href: "/voice-demo", label: "Voice", icon: Mic },
  { href: "/history", label: "History", icon: Clock },
];

export function GameNav() {
  const pathname = usePathname();
  const [llmStatus, setLlmStatus] = useState<"live" | "offline" | "checking">("checking");

  useEffect(() => {
    let cancelled = false;
    async function checkLLM() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = await res.json();
        const llmOk = data.checks?.config?.ok || data.checks?.analysis?.ok;
        if (!cancelled) setLlmStatus(llmOk ? "live" : "offline");
      } catch {
        if (!cancelled) setLlmStatus("offline");
      }
    }
    checkLLM();
    const interval = setInterval(checkLLM, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const statusConfig = {
    live: { dot: "bg-emerald-400 animate-pulse", text: "Live", className: "llm-badge-live" },
    offline: { dot: "bg-muted-foreground", text: "Offline", className: "llm-badge-offline" },
    checking: { dot: "bg-violet-400 animate-pulse", text: "Checking", className: "llm-badge-thinking" },
  } as const;

  const status = statusConfig[llmStatus];

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        {/* Logo */}
        <Link href="/today" className="flex items-center gap-3 transition-transform hover:scale-105">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary shadow-sm">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-foreground">Advantage Foundry</h1>
            <p className="text-[10px] font-medium text-muted-foreground">Field Experimentation OS</p>
          </div>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden items-center gap-1 lg:flex">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  active
                    ? "bg-primary/10 text-primary shadow-sm"
                    : "text-muted-foreground hover:bg-card/50 hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* LLM Status */}
        <div className={`llm-badge ${status.className}`}>
          <div className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          {status.text}
        </div>
      </div>

      {/* Mobile Nav */}
      <div className="flex items-center gap-1 overflow-x-auto px-4 pb-2 lg:hidden scrollbar-thin">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all ${
                active ? "bg-primary/10 text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="h-3 w-3" />
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
