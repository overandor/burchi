"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Award,
  BarChart3,
  Beaker,
  BookOpen,
  Bot,
  Calendar,
  Clock,
  FlaskConical,
  GitBranch,
  Globe,
  Inbox,
  Layers,
  Mail,
  Mic,
  RefreshCw,
  Route,
  Search,
  Settings2,
  Telescope,
  Workflow,
  Zap,
} from "lucide-react";

const navGroups = [
  {
    label: "Now",
    items: [
      { href: "/today", label: "Today", icon: Calendar },
      { href: "/inbox", label: "Signal Stream", icon: Inbox },
    ],
  },
  {
    label: "Discover",
    items: [
      { href: "/frontrunner", label: "Frontrunner", icon: Telescope },
      { href: "/leaders", label: "Leaders", icon: Globe },
    ],
  },
  {
    label: "Lab",
    items: [
      { href: "/foundry", label: "Foundry", icon: FlaskConical },
      { href: "/experiment", label: "Experiment", icon: Beaker },
      { href: "/process-lab", label: "Process", icon: Workflow },
      { href: "/email-lab", label: "Email Lab", icon: Mail },
    ],
  },
  {
    label: "Evolve",
    items: [
      { href: "/spin-lifecycle", label: "Lifecycle", icon: RefreshCw },
      { href: "/spinor-rl", label: "SPINOR-RL", icon: GitBranch },
      { href: "/golden-nodes", label: "Golden Nodes", icon: Award },
    ],
  },
  {
    label: "Operate",
    items: [
      { href: "/results", label: "Results", icon: BarChart3 },
      { href: "/autopilot", label: "Autopilot", icon: Bot },
      { href: "/voice-demo", label: "Voice", icon: Mic },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/diary", label: "Diary", icon: BookOpen },
      { href: "/history", label: "History", icon: Clock },
      { href: "/learnings", label: "Learnings", icon: Route },
      { href: "/discovery-ledger", label: "Ledger", icon: BarChart3 },
    ],
  },
];

export function GameNav() {
  const pathname = usePathname() ?? "";
  const [llmStatus, setLlmStatus] = useState<"live" | "offline" | "checking">("checking");
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const statusDot =
    llmStatus === "live" ? "bg-emerald-400" : llmStatus === "offline" ? "bg-red-400" : "bg-amber-400";
  const statusText = llmStatus === "live" ? "Live" : llmStatus === "offline" ? "Offline" : "Checking";

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        {/* Logo */}
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary shadow-[0_0_20px_-5px_hsl(var(--primary)/0.45)]">
            <Layers className="h-5 w-5" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-sm font-bold tracking-tight text-foreground">Advantage Foundry</h1>
            <p className="text-[10px] font-medium text-muted-foreground">Interaction Discovery Engine</p>
          </div>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden items-center gap-6 lg:flex">
          {navGroups.map((group) => (
            <div key={group.label} className="relative group/nav">
              <button className="flex items-center gap-1 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
                {group.label}
                <span className="text-[10px] opacity-50">▾</span>
              </button>
              <div className="invisible absolute left-0 top-full z-50 min-w-[10rem] translate-y-1 rounded-xl border border-border/50 bg-card/95 p-1.5 opacity-0 shadow-xl backdrop-blur-xl transition-all group-hover/nav:visible group-hover/nav:translate-y-2 group-hover/nav:opacity-100">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* Search trigger */}
          <button
            onClick={() => document.dispatchEvent(new CustomEvent("open-command-palette"))}
            className="hidden sm:flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Find</span>
            <kbd className="ml-1 rounded border border-border/50 bg-background px-1 text-[10px]">⌘K</kbd>
          </button>

          {/* Voice trigger */}
          <button
            onClick={() => document.dispatchEvent(new CustomEvent("toggle-voice"))}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 bg-muted/30 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            aria-label="Toggle voice"
          >
            <Mic className="h-3.5 w-3.5" />
          </button>

          {/* Settings */}
          <Link
            href="/settings"
            className={`flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 transition-colors ${
              isActive("/settings") ? "bg-primary/10 text-primary" : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </Link>

          {/* LLM status */}
          <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/20 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
            {statusText}
          </div>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 bg-muted/30 text-muted-foreground lg:hidden"
          >
            <span className="text-base">☰</span>
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div className="border-t border-border/40 bg-background/95 px-4 pb-4 pt-2 lg:hidden">
          <div className="grid grid-cols-2 gap-2">
            {navGroups.flatMap((g) => g.items).map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}
