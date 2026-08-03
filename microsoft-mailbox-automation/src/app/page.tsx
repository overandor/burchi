import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mailbox Automation — AI-Powered Scientific Email Analysis",
  description:
    "Non-local, cloud-ready Gmail and Microsoft 365 automation. Extract structured scientific data, generate wikitrees, mindmaps, and execution plans with LLMs.",
};

function IconMail(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}
function IconFileText(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />
    </svg>
  );
}
function IconBrain(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" /><path d="M17.599 6.5a3 3 0 0 0 .399-1.375" /><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" /><path d="M3.477 10.896a4 4 0 0 1 .585-.396" /><path d="M19.938 10.5a4 4 0 0 1 .585.396" /><path d="M6 18a4 4 0 0 1-1.967-.516" /><path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  );
}
function IconZap(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function IconArrowRight(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
    </svg>
  );
}
function IconCheck(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconSparkle(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3Z" />
    </svg>
  );
}
function IconTable(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" /><path d="M15 3v18" />
    </svg>
  );
}
function IconChart(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M3 3v18h18" /><path d="M7 16l4-4 4 4 5-5" />
    </svg>
  );
}
function IconGlobe(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

const products = [
  {
    id: "mail",
    icon: IconMail,
    label: "Mail",
    headline: "The most productive research inbox ever made",
    description: "Fly through Gmail and Microsoft 365 inboxes, never miss a follow-up, and turn every email into structured data.",
    points: [
      "Respond faster to what matters most",
      "Follow up on time, every time",
      "Classify and triage automatically",
    ],
    href: "/inbox",
    gradient: "from-blue-500 to-cyan-400",
  },
  {
    id: "docs",
    icon: IconFileText,
    label: "Docs",
    headline: "Documents that extract themselves",
    description: "Parse PDFs, CSVs, Excel files, and text attachments. Turn them into exportable spreadsheets and data tables.",
    points: [
      "Extract tables from any attachment",
      "Export to Excel or CSV instantly",
      "Link every row back to the source email",
    ],
    href: "/sheets",
    gradient: "from-violet-500 to-purple-400",
  },
  {
    id: "ai",
    icon: IconBrain,
    label: "AI",
    headline: "AI that understands your research",
    description: "Generate wikitrees, mindmaps, and execution plans from email content and attachments using any LLM endpoint.",
    points: [
      "OpenAI, Ollama, or custom endpoints",
      "Wikitree + mindmap generation",
      "Actionable execution plans",
    ],
    href: "/dashboard",
    gradient: "from-emerald-500 to-teal-400",
  },
  {
    id: "go",
    icon: IconZap,
    label: "Go",
    headline: "AI that works in every app you use",
    description: "Connect Gmail, Microsoft 365, and your favorite tools through a single MCP-style API and webhook layer.",
    points: [
      "MCP-compatible telemetry endpoint",
      "Gmail and Microsoft sync out of the box",
      "Works from any app, in any tab",
    ],
    href: "/telemetry",
    gradient: "from-amber-500 to-orange-400",
  },
];

const logos = ["OpenAI", "HubSpot", "Expensify", "Rivian", "Zoom", "Zapier"];

const stats = [
  { value: "4h", label: "Saved per week" },
  { value: "2x", label: "Faster inbox processing" },
  { value: "100%", label: "Automated data extraction" },
  { value: "0", label: "Local setup required" },
];

export default function LandingPage() {
  return (
    <div className="flex w-full flex-col items-center">
      {/* Hero — Dark with animated mesh */}
      <section className="relative w-full overflow-hidden bg-slate-950 px-6 pb-32 pt-20 text-center md:pt-32">
        {/* Animated mesh background */}
        <div className="pointer-events-none absolute inset-0 mesh-bg-dark animate-gradient" />
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="pointer-events-none absolute top-20 right-10 h-[300px] w-[300px] rounded-full bg-purple-600/15 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 left-10 h-[300px] w-[300px] rounded-full bg-blue-600/15 blur-[100px]" />

        <div className="relative mx-auto max-w-5xl">
          {/* Badge */}
          <div className="inline-flex animate-fade-in-up items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm font-medium text-white/90 backdrop-blur-xl">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Live demo — no signup required
          </div>

          {/* Headline */}
          <h1 className="mt-8 animate-fade-in-up text-5xl font-extrabold tracking-tight text-white delay-100 md:text-7xl">
            Intelligence,{" "}
            <span className="text-gradient-blue animate-gradient">everywhere</span>
            <br />
            you email
          </h1>

          <p className="mx-auto mt-6 max-w-2xl animate-fade-in-up text-lg text-slate-400 delay-200 md:text-xl">
            Mail, docs, and AI that turns every inbox into structured scientific data — no local setup, no changing endpoints.
          </p>

          {/* CTAs */}
          <div className="mt-10 flex animate-fade-in-up flex-col items-center justify-center gap-4 delay-300 sm:flex-row">
            <Link
              href="/dashboard"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-8 text-base font-semibold text-slate-950 shadow-2xl shadow-white/10 transition-all hover:shadow-white/30 hover:scale-105"
            >
              Try the demo
              <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/settings"
              className="inline-flex h-12 items-center justify-center rounded-full border border-white/20 bg-white/5 px-8 text-base font-semibold text-white backdrop-blur-xl transition-all hover:bg-white/10"
            >
              Configure
            </Link>
          </div>
          <p className="mt-4 animate-fade-in text-sm text-slate-500 delay-400">
            No Microsoft 365 or Gmail credentials required.
          </p>

          {/* App Preview Mockup */}
          <div className="mt-16 animate-fade-in-up delay-500">
            <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-slate-900/80 shadow-2xl backdrop-blur-xl">
              {/* Window chrome */}
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <div className="h-3 w-3 rounded-full bg-red-400/70" />
                <div className="h-3 w-3 rounded-full bg-amber-400/70" />
                <div className="h-3 w-3 rounded-full bg-emerald-400/70" />
                <div className="ml-4 flex-1 rounded-md bg-white/5 px-3 py-1 text-xs text-slate-400">
                  mailbox-sci-data.netlify.app/dashboard
                </div>
              </div>
              {/* Mock dashboard */}
              <div className="grid grid-cols-12 gap-3 p-4 text-left">
                {/* Sidebar */}
                <div className="col-span-3 space-y-2">
                  <div className="rounded-lg bg-white/5 p-3">
                    <div className="mb-2 h-3 w-20 rounded bg-white/20" />
                    <div className="space-y-1.5">
                      <div className="h-2 w-full rounded bg-white/10" />
                      <div className="h-2 w-3/4 rounded bg-white/10" />
                      <div className="h-2 w-5/6 rounded bg-white/10" />
                    </div>
                  </div>
                  <div className="rounded-lg bg-indigo-500/10 p-3 ring-1 ring-indigo-500/30">
                    <div className="mb-1.5 h-2 w-16 rounded bg-indigo-400/50" />
                    <div className="h-2 w-full rounded bg-white/10" />
                  </div>
                  <div className="rounded-lg bg-white/5 p-3">
                    <div className="mb-1.5 h-2 w-12 rounded bg-white/20" />
                    <div className="h-2 w-full rounded bg-white/10" />
                  </div>
                </div>
                {/* Main content */}
                <div className="col-span-9 space-y-3">
                  {/* Stat cards */}
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { v: "4", l: "Emails", c: "text-blue-400" },
                      { v: "4", l: "Processed", c: "text-emerald-400" },
                      { v: "12", l: "Fields", c: "text-violet-400" },
                      { v: "3", l: "Tables", c: "text-amber-400" },
                    ].map((s) => (
                      <div key={s.l} className="rounded-lg border border-white/10 bg-white/5 p-3">
                        <div className={`text-2xl font-bold ${s.c}`}>{s.v}</div>
                        <div className="text-xs text-slate-500">{s.l}</div>
                      </div>
                    ))}
                  </div>
                  {/* Analysis preview */}
                  <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="h-2 w-32 rounded bg-white/20" />
                      <div className="ml-auto flex gap-1">
                        <div className="h-5 w-16 rounded bg-indigo-500/30" />
                        <div className="h-5 w-16 rounded bg-white/10" />
                        <div className="h-5 w-16 rounded bg-white/10" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 rounded bg-blue-400/60" />
                        <div className="h-2 flex-1 rounded bg-white/10" />
                      </div>
                      <div className="ml-6 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded bg-emerald-400/50" />
                          <div className="h-2 w-3/4 rounded bg-white/10" />
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded bg-violet-400/50" />
                          <div className="h-2 w-2/3 rounded bg-white/10" />
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded bg-amber-400/50" />
                          <div className="h-2 w-4/5 rounded bg-white/10" />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 rounded bg-purple-400/60" />
                        <div className="h-2 flex-1 rounded bg-white/10" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="w-full border-b border-slate-200 bg-white px-6 py-12">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-8 md:grid-cols-4">
          {stats.map((s, i) => (
            <div key={s.label} className="text-center animate-fade-in-up" style={{ animationDelay: `${i * 100}ms` }}>
              <div className="text-4xl font-extrabold text-gradient-blue md:text-5xl">{s.value}</div>
              <div className="mt-2 text-sm font-medium text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Logos */}
      <section className="w-full bg-slate-50/60 px-6 py-12">
        <p className="text-center text-xs font-semibold uppercase tracking-wider text-slate-400">
          Trusted by the most innovative research teams
        </p>
        <div className="mx-auto mt-6 flex max-w-4xl flex-wrap items-center justify-center gap-6 md:gap-12">
          {logos.map((l, i) => (
            <span
              key={l}
              className="text-lg font-bold text-slate-300 transition-colors hover:text-slate-500 animate-fade-in"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              {l}
            </span>
          ))}
        </div>
      </section>

      {/* Suite — Bento Grid */}
      <section className="w-full px-6 py-20 md:py-28">
        <div className="mx-auto max-w-6xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-600 shadow-sm">
            <IconSparkle className="h-3.5 w-3.5 text-indigo-500" />
            Your AI suite
          </div>
          <h2 className="mt-6 text-3xl font-bold text-slate-900 md:text-5xl">
            Get the full stack
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
            Turn email into data, insight, and action — with four products that work together seamlessly.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-6xl gap-6 md:grid-cols-2">
          {products.map((p, i) => {
            const Icon = p.icon;
            return (
              <div
                key={p.id}
                className="group bento shine animate-fade-in-up"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                <div className="mb-6 flex items-center gap-4">
                  <div className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${p.gradient} text-white shadow-lg`}>
                    <Icon className="h-7 w-7" />
                  </div>
                  <div className="text-sm font-bold uppercase tracking-wider text-slate-400">{p.label}</div>
                </div>
                <h3 className="text-2xl font-bold text-slate-900">{p.headline}</h3>
                <p className="mt-3 text-slate-600">{p.description}</p>
                <ul className="mt-6 space-y-3">
                  {p.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-3 text-slate-700">
                      <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
                        <IconCheck className="h-3 w-3 text-emerald-600" />
                      </div>
                      <span className="text-sm">{pt}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={p.href}
                  className="mt-8 inline-flex items-center gap-2 font-semibold text-slate-900 transition-all group-hover:gap-3"
                >
                  Learn more
                  <IconArrowRight className="h-4 w-4" />
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      {/* Feature highlights */}
      <section className="w-full bg-slate-50/60 px-6 py-20 md:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold text-slate-900 md:text-4xl">
            Built for scientific data teams
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              { icon: IconTable, title: "Structured extraction", desc: "Pull fields, tables, and relationships from CSV, PDF, and text attachments automatically." },
              { icon: IconChart, title: "Visual analysis", desc: "Generate wikitrees, Mermaid mindmaps, and execution plans from any email thread." },
              { icon: IconGlobe, title: "Works everywhere", desc: "Deploy on Vercel, Netlify, or any serverless host. Connect Gmail, Microsoft 365, or any LLM." },
            ].map((f, i) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition-all hover:shadow-lg animate-fade-in-up"
                  style={{ animationDelay: `${i * 120}ms` }}
                >
                  <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">{f.title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Manifesto — Dark CTA */}
      <section className="relative w-full overflow-hidden bg-slate-950 px-6 py-24 text-center text-white md:py-32">
        <div className="pointer-events-none absolute inset-0 mesh-bg-dark" />
        <div className="pointer-events-none absolute top-0 left-1/2 h-[400px] w-[600px] -translate-x-1/2 rounded-full bg-indigo-600/15 blur-[120px]" />
        <div className="relative mx-auto max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm font-medium text-white/80 backdrop-blur-xl">
            <IconSparkle className="h-3.5 w-3.5 text-indigo-400" />
            Becoming autonomous
          </div>
          <h2 className="mt-8 text-4xl font-extrabold tracking-tight md:text-6xl">
            When AI works everywhere
            <br />
            <span className="text-gradient-blue">you work</span>
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-slate-400">
            It starts to change how you work. At first, you process email faster. Before you know it, you have the time to be more creative, strategic, and impactful — free to do what only you can do.
          </p>
          <div className="mt-10">
            <Link
              href="/dashboard"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-8 text-base font-semibold text-slate-950 shadow-2xl transition-all hover:scale-105"
            >
              Get started
              <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
