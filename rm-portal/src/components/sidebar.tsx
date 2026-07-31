"use client"

import {
  LayoutDashboard, FlaskConical, Users, Activity, ScrollText, Settings, Zap,
  TrendingUp, Brain, FileText, DollarSign, Image, Calendar, Server, Shield,
  Cpu, Network, Radio, Gauge, Eye, Star, Newspaper, Mic, TestTube, Target,
  Boxes, Wifi, Swords, Terminal, MailCheck, Mail, Ban,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

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
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="flex h-screen w-60 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-orange-600">
          <Zap className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-bold text-white">RM OPERATOR</div>
          <div className="text-[10px] text-zinc-500">Autonomous Revenue Ops</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {navSections.map((section) => (
          <div key={section.title} className="mb-3">
            <div className="mb-1 px-3 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
              {section.title}
            </div>
            {section.items.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${active
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-400 hover:bg-zinc-900/60 hover:text-white"
                    }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-zinc-800 px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-zinc-500">System Online</span>
        </div>
      </div>
    </aside>
  )
}
