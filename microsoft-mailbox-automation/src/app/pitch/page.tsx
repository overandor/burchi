import Link from "next/link";
import { ArrowRight, Mic, Brain, Target, TrendingUp, Shield, DollarSign, Building2, CheckCircle2, Activity, Zap, Globe, Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default function PitchDeckPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ─── Slide 1: Title ─── */}
      <section className="relative overflow-hidden px-6 pt-20 pb-32">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/2 h-96 w-[600px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
          <div className="absolute top-20 right-10 h-72 w-72 rounded-full bg-accent/15 blur-[100px]" />
        </div>
        <div className="relative mx-auto max-w-5xl text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary">
            <DollarSign className="h-3 w-3" />
            Confidential — Acquisition Discussion Materials
          </div>
          <h1 className="bg-gradient-to-br from-foreground via-foreground to-foreground/60 bg-clip-text text-5xl font-bold tracking-tight text-transparent sm:text-6xl md:text-7xl">
            Advantage Foundry
          </h1>
          <p className="mt-4 text-2xl font-medium text-primary">
            $20M Strategic Acquisition Proposal
          </p>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            The Evidence-Governed Implementation Science Network that enables
            Gilead to become the pharmaceutical company that learns fastest
            about how scientific innovation is implemented safely, equitably,
            and efficiently in the real world.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/gilead" className="btn btn-primary px-8 py-3 text-base">
              Try Live Demo
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link href="/today" className="btn btn-outline px-8 py-3 text-base">
              Enter Product
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Slide 2: The Problem ─── */}
      <section className="border-t border-border/50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight">The Problem</h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              Gilead invests heavily in field execution, but operational knowledge
              about why implementation stalls, which barriers matter, and which
              interventions resolve them is lost. Experiments on approved operational
              methods are never run, and best practices stay trapped in individual reps.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {[
              { stat: ">50%", label: "of SG&A spent on field execution", source: "Gilead internal acknowledgment" },
              { stat: "30%+", label: "of accounts operationally stalled despite approved info", source: "Implementation science literature" },
              { stat: "$0", label: "of operational knowledge captured as structured evidence", source: "Industry baseline" },
            ].map((s, i) => (
              <div key={i} className="glass-card p-6 text-center">
                <p className="text-4xl font-bold text-primary">{s.stat}</p>
                <p className="mt-2 text-sm text-foreground/80">{s.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{s.source}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Slide 3: The Solution ─── */}
      <section className="border-t border-border/50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight">The Solution</h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              Advantage Foundry is the missing implementation-science layer in Gilead's
              commercial tech stack — structured operational experimentation that
              complements Veeva Vault CRM and the Gilead-DnA platform.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="glass-card p-6">
              <Mic className="h-8 w-8 text-primary" />
              <h3 className="mt-4 text-lg font-semibold">Evidence Capture</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Field reps capture operational observations — barriers, workflow
                owners, handoff quality, site readiness. LLM extracts structured
                evidence. No forms. No typing. Pharma compliance built-in.
              </p>
            </div>
            <div className="glass-card p-6">
              <Brain className="h-8 w-8 text-primary" />
              <h3 className="mt-4 text-lg font-semibold">Barrier Genome & Pathway Twins</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Every stalled account gets a structured barrier signature. Every
                site gets an evolving operational twin tracking 10 readiness
                dimensions. The system learns which interventions resolve which
                barriers, for which account types, at what cost.
              </p>
            </div>
            <div className="glass-card p-6">
              <Target className="h-8 w-8 text-primary" />
              <h3 className="mt-4 text-lg font-semibold">Palindromic Golden Nodes</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Every success produces two processes: forward into deployment,
                then backward through falsification, isolation, and testing in
                new territories. Competitors can copy a playbook — they cannot
                copy its complete falsification history.
              </p>
            </div>
            <div className="glass-card p-6">
              <Shield className="h-8 w-8 text-primary" />
              <h3 className="mt-4 text-lg font-semibold">Compliance as Architecture</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                An editable experiment grammar with locked clinical claims,
                safety information, and fair balance. Compliance becomes an
                architectural boundary, not a final review bottleneck. A Daily
                Seed cannot be generated outside the allowed grammar.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Slide 4: Gilead Strategic Fit ─── */}
      <section className="border-t border-border/50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight">Gilead Strategic Fit</h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              Advantage Foundry fills the gap between Gilead's data infrastructure
              (Gilead-DnA) and CRM platform (Veeva Vault CRM) — the
              implementation-science experimentation layer that neither provides.
            </p>
          </div>
          <div className="mt-12 rounded-2xl border border-border bg-muted/5 p-8">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
              <div className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/5">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <p className="mt-3 text-sm font-medium">Gilead-DnA</p>
                <p className="text-xs text-muted-foreground">Data platform</p>
              </div>
              <div className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/5">
                  <Activity className="h-6 w-6 text-primary" />
                </div>
                <p className="mt-3 text-sm font-medium">Advantage Foundry</p>
                <p className="text-xs text-primary">Implementation layer</p>
              </div>
              <div className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/5">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <p className="mt-3 text-sm font-medium">Veeva Vault CRM</p>
                <p className="text-xs text-muted-foreground">CRM platform</p>
              </div>
              <div className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/5">
                  <Zap className="h-6 w-6 text-primary" />
                </div>
                <p className="mt-3 text-sm font-medium">Cognizant AI</p>
                <p className="text-xs text-muted-foreground">AI services</p>
              </div>
            </div>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Advantage Foundry sits between data and CRM — designing, running,
              and attributing operational experiments that feed both systems.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
            {[
              "Stalled-Workflow Resolution: Identify workflow owners and resolve administrative barriers for operationally stalled accounts",
              "Launch Readiness: Structured site-readiness assessments with gap-closure plans before new program launches",
              "Access Pathway Optimization: Prior-authorization preparation kits and referral-pathway handoff protocols",
              "Cross-Franchise Mechanism Transfer: Test whether operational mechanisms (not clinical content) transfer across therapeutic areas",
              "Equity-Constrained Experimentation: Ensure interventions do not widen disparities and are tested across diverse account types",
              "Golden Pipelines: Living, evolving validated discoveries with complete falsification history",
            ].map((useCase, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border border-border/50 bg-muted/5 p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                <span className="text-sm text-foreground/80">{useCase}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Slide 5: Market Opportunity ─── */}
      <section className="border-t border-border/50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight">Market Opportunity</h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              The pharma implementation-science software market is emerging.
              No existing vendor provides compliance-native operational
              experimentation with barrier classification and pathway twins.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-4">
            {[
              { market: "Implementation Science", current: "Emerging", forecast: "$2B+ by 2033", cagr: "N/A" },
              { market: "Commercial Analytics", current: "$4.8B", forecast: "$14.1B by 2035", cagr: "12.7%" },
              { market: "AI Sales Enablement", current: "$3.8B", forecast: "$14.2B by 2034", cagr: "15.8%" },
              { market: "Pharma CRM", current: "$4.7B", forecast: "$13.8B by 2034", cagr: "17.6%" },
            ].map((m, i) => (
              <div key={i} className="glass-card p-5 text-center">
                <p className="text-xs font-medium text-muted-foreground">{m.market}</p>
                <p className="mt-2 text-2xl font-bold text-primary">{m.current}</p>
                <p className="text-xs text-foreground/70">{m.forecast}</p>
                <p className="mt-1 text-xs text-primary">CAGR {m.cagr}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 rounded-xl border border-border bg-muted/5 p-6">
            <h3 className="text-sm font-semibold text-foreground">Competitive Gap</h3>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-border/50 p-4">
                <p className="text-xs font-medium text-foreground">Veeva / IQVIA / ZS</p>
                <p className="mt-1 text-xs text-muted-foreground">Provide recommendations and analytics. Don't design or run controlled operational experiments on implementation methods.</p>
              </div>
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                <p className="text-xs font-medium text-primary">Advantage Foundry</p>
                <p className="mt-1 text-xs text-foreground/70">Designs, runs, and attributes operational experiments. Tests implementation methods with barrier classification, pathway twins, and palindromic validation.</p>
              </div>
              <div className="rounded-lg border border-border/50 p-4">
                <p className="text-xs font-medium text-foreground">Axtria / Tiger Analytics</p>
                <p className="mt-1 text-xs text-muted-foreground">Provide analytics infrastructure. Don't provide experimentation infrastructure.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Slide 6: ROI ─── */}
      <section className="border-t border-border/50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight">The ROI Case</h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              $20M acquisition pays back in &lt;12 months through field force
              optimization across Gilead's 3,933 sales &amp; marketing employees.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="glass-card p-6">
              <TrendingUp className="h-8 w-8 text-primary" />
              <h3 className="mt-4 text-lg font-semibold">Revenue Retention</h3>
              <div className="mt-4 space-y-3">
                <div className="flex justify-between border-b border-border/30 pb-2">
                  <span className="text-sm text-muted-foreground">P&T formulary wins (+20%)</span>
                  <span className="text-sm font-medium text-primary">$8.2M/yr</span>
                </div>
                <div className="flex justify-between border-b border-border/30 pb-2">
                  <span className="text-sm text-muted-foreground">Trodelvy retention (+30%)</span>
                  <span className="text-sm font-medium text-primary">$4.8M/yr</span>
                </div>
                <div className="flex justify-between border-b border-border/30 pb-2">
                  <span className="text-sm text-muted-foreground">Livdelzi adherence (+50%)</span>
                  <span className="text-sm font-medium text-primary">$3.6M/yr</span>
                </div>
                <div className="flex justify-between pb-2">
                  <span className="text-sm font-medium text-foreground">Total annual impact</span>
                  <span className="text-sm font-bold text-primary">$16.6M/yr</span>
                </div>
              </div>
            </div>
            <div className="glass-card p-6">
              <Zap className="h-8 w-8 text-primary" />
              <h3 className="mt-4 text-lg font-semibold">Cost Optimization</h3>
              <div className="mt-4 space-y-3">
                <div className="flex justify-between border-b border-border/30 pb-2">
                  <span className="text-sm text-muted-foreground">Digital channel shift (-40% rep time)</span>
                  <span className="text-sm font-medium text-primary">$6.4M/yr</span>
                </div>
                <div className="flex justify-between border-b border-border/30 pb-2">
                  <span className="text-sm text-muted-foreground">CAR-T delay reduction (-25%)</span>
                  <span className="text-sm font-medium text-primary">$2.1M/yr</span>
                </div>
                <div className="flex justify-between border-b border-border/30 pb-2">
                  <span className="text-sm text-muted-foreground">Post-merger field optimization</span>
                  <span className="text-sm font-medium text-primary">$3.2M/yr</span>
                </div>
                <div className="flex justify-between pb-2">
                  <span className="text-sm font-medium text-foreground">Total annual savings</span>
                  <span className="text-sm font-bold text-primary">$11.7M/yr</span>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-8 rounded-xl border border-primary/30 bg-primary/5 p-6 text-center">
            <p className="text-sm text-muted-foreground">Total annual value</p>
            <p className="text-4xl font-bold text-primary">$28.3M/year</p>
            <p className="mt-2 text-sm text-foreground/70">
              Payback period: <span className="font-medium text-primary">8.5 months</span> on $20M acquisition
            </p>
          </div>
        </div>
      </section>

      {/* ─── Slide 7: Technology ─── */}
      <section className="border-t border-border/50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight">Technology &amp; IP</h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              Production-grade Next.js application with SQLite persistence,
              multi-tenant architecture, and 12+ LLM-powered API endpoints.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              { value: "239", label: "Source files" },
              { value: "173", label: "Passing tests" },
              { value: "12+", label: "API endpoints" },
              { value: "9", label: "LLM engines" },
              { value: "10", label: "Mission classes" },
              { value: "18", label: "Voice states" },
              { value: "8", label: "Palindrome stages" },
              { value: "5", label: "Evolution levels" },
            ].map((s, i) => (
              <div key={i} className="glass-card p-4 text-center">
                <p className="text-2xl font-bold text-primary">{s.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 rounded-xl border border-border bg-muted/5 p-6">
            <h3 className="text-sm font-semibold text-foreground">Architecture</h3>
            <div className="mt-4 space-y-2 text-sm text-muted-foreground">
              <div><span className="font-medium text-foreground">Framework:</span> Next.js 14 (App Router, standalone output)</div>
              <div><span className="font-medium text-foreground">Persistence:</span> SQLite (better-sqlite3) with WAL mode, multi-tenant schema</div>
              <div><span className="font-medium text-foreground">Auth:</span> Session-based with org isolation, HTTP-only cookies</div>
              <div><span className="font-medium text-foreground">LLM:</span> OpenAI-compatible with multi-provider fallback (configured → LLM7 → Pollinations)</div>
              <div><span className="font-medium text-foreground">Voice:</span> Browser Web Speech API with 18-state deterministic state machine</div>
              <div><span className="font-medium text-foreground">Deployment:</span> Fly.io (Docker), Vercel, Netlify, Hugging Face Spaces</div>
              <div><span className="font-medium text-foreground">Compliance:</span> Pharma-specific compliance flags, audit logging, anti-gaming controls</div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Slide 8: Deal Structure ─── */}
      <section className="border-t border-border/50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight">Deal Structure</h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              $20M technology tuck-in acquisition. Comparable to Gilead's $35M
              Genesis Therapeutics collaboration — but for commercial operations
              instead of R&amp;D.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="glass-card p-6 text-center">
              <p className="text-xs font-medium text-muted-foreground">Option A</p>
              <h3 className="mt-2 text-lg font-semibold">Acquisition</h3>
              <p className="mt-4 text-3xl font-bold text-primary">$20M</p>
              <p className="mt-2 text-xs text-muted-foreground">Cash, technology + IP</p>
              <p className="mt-4 text-sm text-foreground/70">Full technology transfer, source code, and integration support</p>
            </div>
            <div className="glass-card p-6 text-center border-primary/30">
              <p className="text-xs font-medium text-primary">Option B</p>
              <h3 className="mt-2 text-lg font-semibold">Pilot-to-Acquire</h3>
              <p className="mt-4 text-3xl font-bold text-primary">$2M → $20M</p>
              <p className="mt-2 text-xs text-muted-foreground">6-month pilot, then acquisition</p>
              <p className="mt-4 text-sm text-foreground/70">Paid pilot in one therapeutic area, acquisition triggered by proven ROI</p>
            </div>
            <div className="glass-card p-6 text-center">
              <p className="text-xs font-medium text-muted-foreground">Option C</p>
              <h3 className="mt-2 text-lg font-semibold">Strategic Partnership</h3>
              <p className="mt-4 text-3xl font-bold text-primary">$5M + milestones</p>
              <p className="mt-2 text-xs text-muted-foreground">Lower upfront, milestone-based</p>
              <p className="mt-4 text-sm text-foreground/70">Similar to Genesis model: upfront + contingent milestones</p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Slide 9: Key Stakeholders ─── */}
      <section className="border-t border-border/50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight">Alignment with Gilead Leadership</h2>
          </div>
          <div className="mt-12 space-y-4">
            {[
              { name: "Johanna Mercier", role: "Chief Commercial & Corporate Affairs Officer", fit: "Owns the field force that Advantage Foundry optimizes. Direct ROI accountability." },
              { name: "Anna Åsberg", role: "Global CIO", fit: "Led Veeva Vault CRM decision. Advantage Foundry integrates natively with Veeva and Gilead-DnA." },
              { name: "Joydeep Ganguly", role: "SVP Corporate Operations & Interim CIO", fit: "Manages Cognizant partnership. Advantage Foundry complements AI-driven commercial solutions." },
              { name: "Daniel O'Day", role: "CEO", fit: "Pipeline quality 'never stronger'. Advantage Foundry optimizes launch execution for new assets." },
            ].map((s, i) => (
              <div key={i} className="flex items-start gap-4 rounded-lg border border-border/50 bg-muted/5 p-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/5">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.role}</p>
                  <p className="mt-1 text-sm text-foreground/70">{s.fit}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Slide 10: Next Steps ─── */}
      <section className="border-t border-border/50 px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Next Steps</h2>
          <div className="mt-12 space-y-4">
            {[
              { step: "1", title: "Live Demo", desc: "Experience the voice-first evidence capture and SPINOR-RL dashboard with Gilead-specific data", action: "Try Live Demo", href: "/gilead" },
              { step: "2", title: "Technical Review", desc: "Architecture walkthrough, security review, and integration planning with Gilead-DnA and Veeva teams" },
              { step: "3", title: "Pilot Proposal", desc: "6-month pilot in one therapeutic area (HIV or Oncology) with defined success metrics" },
              { step: "4", title: "Acquisition Terms", desc: "Structure and close the $20M acquisition with technology transfer and integration support" },
            ].map((s, i) => (
              <div key={i} className="flex items-start gap-4 rounded-lg border border-border/50 bg-muted/5 p-4 text-left">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {s.step}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{s.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
                  {s.action && s.href && (
                    <Link href={s.href} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      {s.action} <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-border/50 px-6 py-12">
        <div className="mx-auto max-w-5xl text-center">
          <p className="text-sm text-muted-foreground">
            Advantage Foundry — Field Experimentation OS for Pharma
          </p>
          <p className="mt-2 text-xs text-muted-foreground/60">
            Confidential acquisition discussion materials. Not for distribution.
          </p>
          <div className="mt-6 flex justify-center gap-4">
            <Link href="/gilead" className="btn btn-primary">
              Try Live Demo
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link href="/" className="btn btn-ghost text-muted-foreground">
              Back to Home
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
