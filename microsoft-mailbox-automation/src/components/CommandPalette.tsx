"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Award,
  BarChart3,
  Beaker,
  Bot,
  Calendar,
  Clock,
  FlaskConical,
  GitBranch,
  Inbox,
  Layers,
  Mic,
  RefreshCw,
  Search,
  Sparkles,
  Target,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface CmdItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  category: string;
}

const COMMANDS: CmdItem[] = [
  { id: "today", label: "Today", icon: Calendar, href: "/today", category: "Navigate" },
  { id: "inbox", label: "Inbox", icon: Inbox, href: "/inbox", category: "Navigate" },
  { id: "foundry", label: "Foundry", icon: FlaskConical, href: "/foundry", category: "Navigate" },
  { id: "experiment", label: "Experiment", icon: Beaker, href: "/experiment", category: "Navigate" },
  { id: "results", label: "Results", icon: BarChart3, href: "/results", category: "Navigate" },
  { id: "golden-nodes", label: "Golden Nodes", icon: Award, href: "/golden-nodes", category: "Navigate" },
  { id: "spin-lifecycle", label: "SPIN Lifecycle", icon: RefreshCw, href: "/spin-lifecycle", category: "Navigate" },
  { id: "spinor-rl", label: "SPINOR-RL", icon: GitBranch, href: "/spinor-rl", category: "Navigate" },
  { id: "voice", label: "Voice", icon: Mic, href: "/voice-demo", category: "Navigate" },
  { id: "autopilot", label: "Autopilot", icon: Bot, href: "/autopilot", category: "Navigate" },
  { id: "history", label: "History", icon: Clock, href: "/history", category: "Navigate" },
  { id: "allocate", label: "Plant Daily Seed", icon: Target, href: "/today?action=allocate", category: "Action" },
  { id: "research", label: "Run LLM Prior-Art Research", icon: Search, href: "/today?action=research", category: "Action" },
  { id: "record", label: "Record Experiment Outcome", icon: Sparkles, href: "/experiment/record", category: "Action" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const router = useRouter();

  const filtered = COMMANDS.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()) ||
    c.category.toLowerCase().includes(query.toLowerCase())
  );

  const handleSelect = useCallback((item: CmdItem) => {
    router.push(item.href);
    setOpen(false);
    setQuery("");
    setActive(0);
  }, [router]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
      if (open) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((a) => Math.min(a + 1, filtered.length - 1));
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((a) => Math.max(a - 1, 0));
        }
        if (e.key === "Enter" && filtered[active]) {
          e.preventDefault();
          handleSelect(filtered[active]);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, active, filtered, handleSelect]);

  if (!open) return null;

  const categories = [...new Set(filtered.map((c) => c.category))];

  return (
    <>
      <div className="cmdk-overlay" onClick={() => setOpen(false)} />
      <div className="cmdk-panel">
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            placeholder="Search commands, pages, actions…"
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded-md border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-2 scrollbar-thin">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No results for &quot;{query}&quot;</p>
          ) : (
            categories.map((cat) => (
              <div key={cat}>
                <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{cat}</p>
                {filtered.filter((c) => c.category === cat).map((item) => {
                  const idx = filtered.indexOf(item);
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.id}
                      className={`cmdk-item ${idx === active ? "cmdk-item-active" : ""}`}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setActive(idx)}
                    >
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1">{item.label}</span>
                      <span className="text-xs text-muted-foreground">↵</span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
