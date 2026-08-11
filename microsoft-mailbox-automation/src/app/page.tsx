import Link from "next/link";
import { Mic, Brain, Target, GitBranch, Shield, Zap, TrendingUp, ArrowRight, Volume2, Sparkles, CheckCircle2, Activity, Layers, Workflow, Lock, FlaskConical } from "lucide-react";

export const dynamic = "force-dynamic";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden px-6 pt-20 pb-32">
        {/* Aurora background */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/2 h-96 w-[600px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
          <div className="absolute top-20 right-10 h-72 w-72 rounded-full bg-accent/15 blur-[100px]" />
          <div className="absolute bottom-0 left-10 h-72 w-72 rounded-full bg-primary/10 blur-[100px]" />
        </div>

        <div className="relative mx-auto max-w-5xl text-center">
          {/* Badge */}
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary">
            <Sparkles className="h-3 w-3" />
            Advantage Foundry — Field Experimentation OS
          </div>

          <h1 className="text-5xl font-bold tracking-tighter text-foreground sm:text-6xl md:text-7xl lg:text-8xl">
            The mailbox became
            <br />
            a{" "}
            <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
              sensor.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            An autonomous HCP interaction-discovery engine that continuously originates, tests,
            falsifies, attributes, mutates, and operationalizes new outreach techniques from
            communication telemetry. Outreach became an experiment. Employees became distributed
            researchers. SPINOR became the lineage. The product is the evolving behavioral intelligence — not the email.
          </p>

          {/* CTAs */}
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/gilead" className="btn btn-primary group px-8 py-3 text-base">
              <Mic className="mr-2 h-5 w-5" />
              Gilead Demo
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link href="/pitch" className="btn btn-outline px-8 py-3 text-base">
              <Target className="mr-2 h-5 w-5" />
              $20M Pitch Deck
            </Link>
            <Link href="/today" className="btn btn-ghost px-6 py-3 text-base text-muted-foreground">
              Enter App
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Mission Classes", value: "10" },
              { label: "Coined Terms", value: "40" },
              { label: "Compiler Stages", value: "7" },
              { label: "Palindrome Stages", value: "8" },
            ].map((s) => (
              <div key={s.label} className="glass-card card-hover p-4 text-center">
                <p className="bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-3xl font-bold text-transparent">{s.value}</p>
                <p className="mt-1 text-xs font-medium text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Voice Demo Feature ─── */}
      <section className="border-t border-border/50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-1 gap-12 md:grid-cols-2 md:items-center">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
                <Volume2 className="h-3 w-3" />
                Voice-First Execution
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-foreground">
                The employee only speaks.
              </h2>
              <p className="mt-4 text-muted-foreground">
                The system generates a research mission, reads it aloud in your selected voice,
                then you speak your observations. All evidence — metrics, mechanisms, confounders,
                derivatives — is extracted automatically. No forms. No typing. No friction.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  { icon: Mic, text: "Mission read aloud via text-to-speech with 3 voice personas" },
                  { icon: Activity, text: "Live transcript with real-time evidence keyword detection" },
                  { icon: Brain, text: "LLM extracts structured evidence from spoken observations" },
                  { icon: Zap, text: "One-tap submission to the full palindromic learning pipeline" },
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <f.icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                    <span className="text-sm text-foreground/80">{f.text}</span>
                  </li>
                ))}
              </ul>
              <Link href="/voice-demo" className="btn btn-primary mt-8 group">
                <Mic className="mr-2 h-4 w-4" />
                Start Voice Demo
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>

            {/* Visual mockup */}
            <div className="glass-card overflow-hidden p-0 border-white/[0.08]">
              <div className="flex items-center justify-between border-b border-white/[0.06] bg-gradient-to-r from-primary/15 to-accent/10 px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
                  <span className="text-sm font-medium text-primary">Commander speaking…</span>
                </div>
                <span className="text-xs text-muted-foreground">Mission read aloud</span>
              </div>
              <div className="p-5">
                <div className="rounded-xl border border-border bg-muted/10 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mission</p>
                  <p className="mt-1 text-sm font-medium text-foreground">Cadence Sync to P&amp;T Milestones</p>
                  <p className="mt-2 text-xs text-foreground/70">
                    Physicians who align outreach to P&amp;T committee milestones may engage more
                    productively than those following standard cadence…
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-primary/30 bg-primary/5">
                    <Mic className="h-7 w-7 text-primary" />
                  </div>
                </div>
                <p className="mt-3 text-center text-xs text-muted-foreground">Tap to speak your observations</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── WORKTELEPORT-RL ─── */}
      <section className="border-t border-border/50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
              <Workflow className="h-3 w-3" />
              WORKTELEPORT-RL
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              Email becomes authorized, durable work.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              Every incoming request passes through a seven-stage compiler: understanding,
              decomposition, role contract, Task IR, capability planning, durable execution,
              and commit verification. Nothing is executed without proof of authorization.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {[
              {
                icon: Workflow,
                title: "Evidence Envelope",
                desc: "Every input is preserved with content hash, provenance, and confidentiality classification. Original content is never modified by LLM interpretation.",
              },
              {
                icon: Shield,
                title: "Capability Graph",
                desc: "Each tool declares what it can read, create, modify, delete, who may use it, and which approvals are required. Least-privilege with separation of duties.",
              },
              {
                icon: Lock,
                title: "Commit Gate",
                desc: "Before any durable external action: recheck authorization, verify target unchanged, confirm data integrity, validate policy compliance, confirm human approval.",
              },
              {
                icon: GitBranch,
                title: "Skill Genome",
                desc: "Repeated successful workflows crystallize into reusable executable representations. Maturity progresses: manual → model-assisted → workflow → deterministic.",
              },
              {
                icon: FlaskConical,
                title: "Experiment Twin",
                desc: "Every operational workflow gets an experimental counterpart testing improvements. The operational workflow protects continuity. The twin attacks stagnation.",
              },
              {
                icon: Target,
                title: "Venture Capsule",
                desc: "Validated discoveries are packaged with unit economics, compliance requirements, and commercialization hypotheses. Human governance required for deployment.",
              },
            ].map((f, i) => (
              <div key={i} className="glass-card card-hover p-6">
                <f.icon className="h-6 w-6 text-primary" />
                <h3 className="mt-3 text-lg font-semibold text-foreground">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 text-center">
            <Link href="/workteleport" className="btn btn-primary group">
              <Workflow className="mr-2 h-4 w-4" />
              Explore WORKTELEPORT-RL
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* ─── The Palindrome ─── */}
      <section className="border-t border-border/50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              The Palindromic Research Game
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              Every discovered advantage travels forward into deployment, then backward through
              falsification, redistribution, and renewed research. Nothing becomes permanent
              merely because it worked once.
            </p>
          </div>

          {/* Palindrome flow */}
          <div className="mt-12 rounded-2xl border border-border bg-muted/5 p-8">
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-medium">
              {["Research", "Hypothesis", "Mission", "Experiment", "Evidence", "Strategy", "System", "Channel"].map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-primary">{step}</span>
                  {i < 7 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 text-xs font-medium">
              <span className="text-muted-foreground">↻ reverse:</span>
              {["Channel", "System", "Strategy", "Evidence", "Experiment", "Mission", "Hypothesis", "Research"].map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-1.5 text-accent">{step}</span>
                  {i < 7 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                </div>
              ))}
            </div>
          </div>

          {/* Feature grid */}
          <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: Target, title: "10 Mission Classes", desc: "Scout, Field, Builder, Replication, Saboteur, Mutation, Translator, Recovery, Channel, Palindrome — each changes the available mission space." },
              { icon: Brain, title: "9 LLM Engines", desc: "Mission generation, physician adaptation, palindromic learning, RL allocation, email sensor, anti-stagnation, sprouting, diffusion, evidence extraction." },
              { icon: TrendingUp, title: "5 Evolution Levels", desc: "Observation → Hypothesis → Validated tactic → Owned system → Business channel. Employees can become channel founders." },
              { icon: GitBranch, title: "Sprouting Trees", desc: "Derivative hypotheses with credit tracking. Employees earn research credit for useful descendants even when others validate them." },
              { icon: Shield, title: "Anti-Gaming Controls", desc: "Pre-registered conditions, holdout testing, duplicate detection, selective reporting penalties. Activity ≠ effort ≠ evidence ≠ causality." },
              { icon: Layers, title: "Staged Diffusion", desc: "Discovery → replication → mechanism isolation → segment testing → adversarial challenge → controlled diffusion → standard → retesting." },
            ].map((f, i) => (
              <div key={i} className="glass-card glass-card-hover p-6 group">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-[0_0_16px_-4px_hsl(var(--primary)/0.35)] transition-transform group-hover:scale-110">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold tracking-tight text-foreground">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── API Endpoints ─── */}
      <section className="border-t border-border/50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-bold tracking-tight text-foreground">
            Every endpoint is live
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            All APIs are deployed and LLM-enhanced. No mock data — every call produces real evidence.
          </p>

          <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { method: "POST", path: "/api/spinor-rl/mission", desc: "Generate mission card" },
              { method: "POST", path: "/api/spinor-rl/physician", desc: "Physician adaptation" },
              { method: "POST", path: "/api/spinor-rl/palindrome", desc: "Forward + reverse pass" },
              { method: "POST", path: "/api/spinor-rl/rl", desc: "RL action selection" },
              { method: "POST", path: "/api/spinor-rl/email-sensor", desc: "Email evidence stream" },
              { method: "POST", path: "/api/spinor-rl/stagnation", desc: "Anti-stagnation protocol" },
              { method: "POST", path: "/api/spinor-rl/sprout", desc: "Derivative hypothesis" },
              { method: "POST", path: "/api/spinor-rl/diffusion", desc: "Staged diffusion" },
              { method: "GET", path: "/api/spinor-rl/trajectory", desc: "Career trajectory" },
              { method: "POST", path: "/api/spinor-rl/voice-evidence", desc: "Voice evidence extraction" },
              { method: "GET", path: "/api/spinor-rl/state", desc: "Full state snapshot" },
              { method: "GET", path: "/api/health", desc: "System health check" },
            ].map((api, i) => (
              <div key={i} className="card card-hover flex items-center gap-3 p-3">
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold shadow-sm ${api.method === "GET" ? "bg-primary/15 text-primary" : "bg-accent/15 text-accent"}`}>
                  {api.method}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-mono text-foreground/90">{api.path}</p>
                  <p className="text-[10px] text-muted-foreground">{api.desc}</p>
                </div>
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-primary" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="border-t border-border/50 px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <div className="glass-card relative overflow-hidden p-10">
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-[60px]" />
            <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-3xl shadow-[0_0_30px_-6px_hsl(var(--primary)/0.4)]">🎙️</div>
            <h2 className="relative text-3xl font-bold tracking-tight text-foreground">Ready to speak your first mission?</h2>
            <p className="relative mt-3 max-w-lg mx-auto text-sm text-muted-foreground">
              The system will generate a personalized research mission, read it aloud,
              and capture your observations — all through voice.
            </p>
            <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/voice-demo" className="btn btn-primary px-8 py-3 text-base group">
                <Mic className="mr-2 h-5 w-5" />
                Start Voice Demo
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link href="/spinor-rl" className="btn btn-outline px-8 py-3 text-base">
                <Brain className="mr-2 h-5 w-5" />
                SPINOR-RL Dashboard
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-border/50 px-6 py-8">
        <div className="mx-auto max-w-5xl text-center">
          <p className="text-xs text-muted-foreground">
            Advantage Foundry — A distributed organizational experimentation operating system.
            Not another sales gamification dashboard.
          </p>
        </div>
      </footer>
    </div>
  );
}
