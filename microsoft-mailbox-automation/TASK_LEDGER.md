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
- The latest commits claim clean TypeScript compilation and passing focused SPIN tests, but the latest commit has no published GitHub combined-status checks.
- Storage is a portable JSON/file-backed implementation with in-memory fallback rather than the directive's durable multi-tenant relational model.
- `src/lib/game/data.ts` contains production-looking static missions, experiments, results, leaderboards, and Golden Nodes. These records are useful fixtures, but they must be explicitly isolated from production data paths.
- Authentication, organization isolation, versioned admissibility policy, and production-safe demo-data boundaries remain unverified.

## Active tasks

### SPINOR-001 — Establish reproducible execution state

Status: IN_PROGRESS
Risk: Low

Acceptance criteria:

- Persistent task ledger exists.
- Machine-readable session state exists.
- Exact next action is recorded.
- Branch is isolated from `main`.

Verification:

- Confirm all state files exist on `feat/spinor-production-foundation`.

### SPINOR-002 — Prevent demo records from masquerading as production evidence

Status: SPECIFIED
Risk: High

Evidence:

- `src/lib/game/data.ts` exports static 2026 missions, results, Golden Nodes, and leaderboard metrics.
- The production directive prohibits blending fixtures with real records.

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

Exact next action:

- Trace every import and API consumer of `src/lib/game/data.ts` and identify the smallest central boundary where demo-mode gating can be enforced.

### SPINOR-003 — Verify current build and test surface

Status: DISCOVERED
Risk: High

Acceptance criteria:

- Run `npm test` and `npm run build` against the branch.
- Record exact output and environment.
- Fix the first reproducible failure before broad feature work.

Blocker:

- The current GitHub connector can inspect and modify files but does not provide a local shell. Verification requires an available CI workflow or a checked-out workspace.

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

1. SPINOR-003 — establish verified baseline.
2. SPINOR-002 — isolate demo data from production evidence.
3. SPINOR-005 — tenancy and authorization boundary.
4. SPINOR-004 — durable relational persistence.
5. SPINOR-006 — admissibility and promotion gates.
6. Expand Daily Seed, Activity Genome, Forge, Canopy, and signature UI only after the evidence spine is trustworthy.
