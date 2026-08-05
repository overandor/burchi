# SPINOR Production Task Ledger

Last updated: 2026-08-05T02:25:00-04:00
Branch: `feat/spinor-production-foundation`
Base commit: `1e21c3520f12fe3adfe4ef036bba542fa9c2c32a`

## Current objective

Move the existing `microsoft-mailbox-automation` application from a demo-heavy SPINOR prototype toward the production-development directive without replacing working mailbox, ETL, SPIN lifecycle, or Golden Node functionality.

## Repository audit summary

Observed stack:

- Next.js 14 App Router, React 18, TypeScript, Tailwind.
- Node test runner through `node --test --import tsx`.
- Mailbox, ETL, Golden Node, SPINOR-RL, SPIN lifecycle, and LLM fallback modules already exist.
- Recent commits claim clean TypeScript compilation and passing focused SPIN tests, but the latest commit has no published GitHub combined-status checks.
- Storage is a portable JSON/file-backed implementation with in-memory fallback rather than the directive's durable multi-tenant relational model.
- `src/lib/game/data.ts` and `src/lib/golden/seed.ts` contain production-looking static missions, employees, accounts, experiments, results, and Golden Nodes.
- `/api/spinor/organism` previously seeded fixture hypotheses and allocated a fixture employee on demand without a production/demo boundary.
- Authentication, organization isolation, versioned admissibility policy, and durable production storage remain unverified.

## Active tasks

### SPINOR-001 — Establish reproducible execution state

Status: VERIFIED
Risk: Low

Evidence:

- Isolated branch `feat/spinor-production-foundation` exists.
- `TASK_LEDGER.md`, `hyperflow/session_state.json`, and `hyperflow/next.md` exist on the branch.

### SPINOR-002 — Prevent demo records from masquerading as production evidence

Status: PATCHED
Risk: High

Implemented:

- Added `src/lib/spinor/demo-policy.ts`.
- Production now defaults to demo data disabled unless `SPINOR_DEMO_MODE` or legacy `NEXT_PUBLIC_DEMO` explicitly enables it.
- Added unit tests for production, development, explicit enable/disable, precedence, and accepted boolean forms.
- Updated `/api/spinor/organism` so production no longer seeds fixture hypotheses or silently allocates fixture employees.
- Production now requires an explicit `employeeId` and returns a useful empty state when no approved assignment exists.
- Organism responses identify `demoMode` and `dataOrigin`.

Remaining scope:

- Trace and gate the other `ensureGoldenSeeded()` call sites in Golden Node, health, hypothesis, LLM, allocation, and SPINOR-RL paths.
- Mark every fixture object with a durable origin field where the type model permits it.
- Update UI empty states to consume the explicit API empty-state contract.

Acceptance criteria:

- Demo fixtures carry an explicit `dataOrigin: "demo"` or equivalent marker.
- Production API/UI paths cannot return demo records unless demo mode is explicitly enabled.
- Empty production states explain which connector or action is required.
- Tests prove that demo records are excluded when demo mode is disabled.

Verification command:

```bash
npm test
npm run build
```

Verification state:

- PARTIALLY VERIFIED by static inspection.
- Runtime tests and production build have not yet been independently executed on this branch.

### SPINOR-003 — Verify current build and test surface

Status: BLOCKED
Risk: High

Acceptance criteria:

- Run `npm test` and `npm run build` against the branch.
- Record exact output and environment.
- Fix the first reproducible failure before broad feature work.

Blocker:

- The GitHub connector can inspect and modify repository files but does not expose a local shell, and the latest commit has no published combined-status checks.

Exact unblock action:

- Run the two verification commands in a checked-out workspace or attach a CI workflow to the branch.

### SPINOR-004 — Replace process-local persistence for production-critical records

Status: DISCOVERED
Risk: Critical

Evidence:

- README and current implementation describe filesystem/localStorage/in-memory behavior.
- Serverless process-local state cannot satisfy durable tenancy, audit, and recovery requirements.

Acceptance criteria:

- Define a storage interface for SPIN, evidence, hypotheses, experiments, admissibility, compliance, and contributions.
- Add a durable relational provider with migrations and organization scoping.
- Keep the JSON provider only for local development or explicit demo mode.

### SPINOR-005 — Authentication and organization isolation

Status: DISCOVERED
Risk: Critical

Acceptance criteria:

- Every production record has `organizationId` ownership.
- Unauthorized cross-organization reads and writes are rejected.
- Automated isolation tests pass.

### SPINOR-006 — Evidence admissibility engine

Status: DISCOVERED
Risk: High

Acceptance criteria:

- Deterministic classification for Observation, Internal Signal, Controlled Experiment, Valid Replication, and Golden-Node-Eligible Evidence.
- Rules are versioned, visible, configurable, and auditable.
- Weak evidence cannot promote a Golden Node.

## Priority order

1. SPINOR-003 — establish a verified baseline.
2. Finish SPINOR-002 across every seed call site.
3. SPINOR-005 — tenancy and authorization boundary.
4. SPINOR-004 — durable relational persistence.
5. SPINOR-006 — admissibility and promotion gates.
6. Expand Daily Seed, Activity Genome, Forge, Canopy, and signature UI only after the evidence spine is trustworthy.
