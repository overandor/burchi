"use client"

import {
  LayoutDashboard, FlaskConical, Users, Activity, ScrollText, Settings, Zap,
  TrendingUp, Brain, FileText, DollarSign, Image, Calendar, Server, Shield,
  Cpu, Network, Radio, Gauge, Eye, Star, Newspaper, Mic, TestTube, Target,
  Boxes, Wifi, Swords, Terminal, MailCheck, Mail, Ban, Wand2, Globe, Code, Radar,
  Database, Rocket, Building2,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

interface NavSection {
  title: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    title: "Overview",
    items: [
      { href: "/", label: "Mission Control", icon: LayoutDashboard },
      { href: "/flagship", label: "Flagship Terminal", icon: Zap },
    ],
  },
  {
    title: "AI & Decisions",
    items: [
      { href: "/ai-operator", label: "AI Operator", icon: Brain },
      { href: "/autonomous", label: "Autonomous Loop", icon: Zap },
      { href: "/decisions", label: "Decisions", icon: Shield },
      { href: "/approvals", label: "Approval Queue", icon: Shield },
    ],
  },
  {
    title: "Experiments",
    items: [
      { href: "/experiments", label: "Experiment Center", icon: FlaskConical },
      { href: "/experiments/arena", label: "Variant Arena", icon: FlaskConical },
      { href: "/experiments/winners", label: "Winner Board", icon: FlaskConical },
      { href: "/experiments/timeline", label: "Timeline", icon: Activity },
      { href: "/experiments/rewards", label: "Reward Explorer", icon: TrendingUp },
    ],
  },
  {
    title: "Visitors & CRM",
    items: [
      { href: "/visitors", label: "Visitor Feed", icon: Users },
      { href: "/visitors/high-intent", label: "High-Intent Queue", icon: Users },
      { href: "/visitors/repeat", label: "Repeat Visitors", icon: Users },
      { href: "/visitors/intent", label: "Intent Scoring", icon: Activity },
      { href: "/engagement", label: "Engagement Analytics", icon: Activity },
    ],
  },
  {
    title: "Content Factory",
    items: [
      { href: "/content", label: "Content Studio", icon: FileText },
      { href: "/content/bio", label: "Bio Workshop", icon: FileText },
      { href: "/content/calendar", label: "Content Calendar", icon: Calendar },
      { href: "/content/performance", label: "Content Performance", icon: TrendingUp },
    ],
  },
  {
    title: "Revenue",
    items: [
      { href: "/kpis", label: "KPI Dashboard", icon: TrendingUp },
      { href: "/funnel", label: "Revenue Funnel", icon: DollarSign },
      { href: "/attribution", label: "Attribution", icon: DollarSign },
    ],
  },
  {
    title: "Profile & Control",
    items: [
      { href: "/profile", label: "Profile State", icon: Settings },
      { href: "/profile/photos", label: "Photo Manager", icon: Image },
      { href: "/profile/pricing", label: "Pricing Manager", icon: DollarSign },
      { href: "/control", label: "Control Center", icon: Shield },
    ],
  },
  {
    title: "Infrastructure",
    items: [
      { href: "/events", label: "Live Event Stream", icon: Activity },
      { href: "/agents", label: "Agent Health", icon: Server },
      { href: "/telemetry", label: "Telemetry Explorer", icon: Activity },
      { href: "/evidence", label: "Evidence & Receipts", icon: ScrollText },
      { href: "/settings", label: "System Settings", icon: Settings },
    ],
  },
  {
    title: "Consent Engagement",
    items: [
      { href: "/consent", label: "Overview", icon: MailCheck },
      { href: "/consent/contacts", label: "Contacts", icon: Users },
      { href: "/consent/consent", label: "Consent Records", icon: Shield },
      { href: "/consent/messages", label: "Drafts & Approvals", icon: Mail },
      { href: "/consent/suppression", label: "Suppression List", icon: Ban },
      { href: "/consent/audit", label: "Audit Trail", icon: ScrollText },
      { href: "/consent/experiments", label: "Experiments", icon: FlaskConical },
      { href: "/consent/outcomes", label: "Outcomes", icon: TrendingUp },
      { href: "/consent/bridge", label: "RevOps Bridge", icon: Network },
      { href: "/crm", label: "CRM Sync", icon: Building2 },
    ],
  },
  {
    title: "Market Intelligence",
    items: [
      { href: "/hf/competitors", label: "Competitor Profiles", icon: Eye },
      { href: "/hf/visitors", label: "Visitor Log", icon: Users },
      { href: "/hf/reviews", label: "Reviews", icon: Star },
      { href: "/hf/bios", label: "Generated Bios", icon: FileText },
      { href: "/hf/blogs", label: "Blog Posts", icon: Newspaper },
      { href: "/hf/interviews", label: "Interview Sets", icon: Mic },
      { href: "/hf/abtests", label: "Bio A/B Tests", icon: TestTube },
      { href: "/hf/strategies", label: "Bio Strategies", icon: Target },
      { href: "/hf/clients", label: "Client CRM", icon: Users },
      { href: "/hf/kpis", label: "Hourly KPIs", icon: TrendingUp },
      { href: "/hf/intel", label: "Auto-Ingest Pipeline", icon: Radar },
      { href: "/ingestion", label: "Cross-Platform Ingest", icon: Database },
    ],
  },
  {
    title: "GGUF Inference Network",
    items: [
      { href: "/gguf/models", label: "Model Registry", icon: Boxes },
      { href: "/gguf/nodes", label: "Inference Nodes", icon: Network },
      { href: "/gguf/inference", label: "Run Inference", icon: Terminal },
      { href: "/gguf/analytics", label: "Network Analytics", icon: Gauge },
      { href: "/gguf/p2p", label: "P2P Swarm", icon: Wifi },
      { href: "/gguf/racing", label: "Competitive Racing", icon: Swords },
      { href: "/gguf/marketplace", label: "Node Marketplace", icon: DollarSign },
    ],
  },
  {
    title: "HF Model Compiler",
    items: [
      { href: "/compiler", label: "Compile Model", icon: Wand2 },
      { href: "/compiler/registry", label: "Compiled Models", icon: Boxes },
      { href: "/compiler/playground", label: "Universal Playground", icon: Terminal },
      { href: "/compiler/api", label: "API Reference", icon: Code },
      { href: "/finetune", label: "Fine-Tuning Lab", icon: Brain },
      { href: "/deployments", label: "Deployments", icon: Rocket },
    ],
  },
  {
    title: "Platform",
    items: [
      { href: "/tenants", label: "Tenants & Billing", icon: Users },
      { href: "/settings", label: "System Settings", icon: Settings },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside className={`flex h-screen flex-col border-r border-border bg-sidebar transition-all duration-300 ${collapsed ? "w-16" : "w-60"}`}>
      {/* Logo / Brand */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 glow-primary transition-transform hover:scale-105"
        >
          <Zap className="h-5 w-5 text-primary-foreground" />
        </button>
        {!collapsed && (
          <div className="overflow-hidden">
            <div className="text-sm font-semibold tracking-tight text-foreground">Unified Platform</div>
            <div className="text-[10px] text-muted-foreground">Revenue Operations v2.0</div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {navSections.map((section) => (
          <div key={section.title} className="mb-4">
            {!collapsed && (
              <div className="mb-1.5 px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                {section.title}
              </div>
            )}
            {section.items.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all ${
                    active
                      ? "bg-primary/15 text-primary font-medium"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  } ${collapsed ? "justify-center" : ""}`}
                >
                  <item.icon className={`h-4 w-4 shrink-0 transition-transform group-hover:scale-110 ${active ? "text-primary" : ""}`} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {active && !collapsed && <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Status Footer */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className="h-2 w-2 rounded-full bg-emerald-400" />
            <div className="absolute inset-0 h-2 w-2 rounded-full bg-emerald-400 animate-pulse-live" />
          </div>
          {!collapsed && <span className="text-[10px] text-muted-foreground">System Online</span>}
        </div>
      </div>
    </aside>
  )
}
