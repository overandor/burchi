# SPINOR Evidence Spine — Foundation

This document records the first production-safe SPINOR implementation slice inside the existing Mailbox Scientific Data application. It does not claim that the complete SPINOR product or its eight primary screens are finished.

## Implemented

### Domain core

`src/lib/spinor/core.mjs` provides deterministic, provider-independent functions for:

- absolute and relative effect calculation;
- uncertainty ranges for differences in proportions when sample sizes are supplied;
- confounder-adjusted confidence;
- evidence admissibility classification;
- Golden Node eligibility gating;
- compliance-state transition validation;
- versioned SPIN creation;
- immutable hypothesis revisions and parent lineage;
- Activity Genome conceptual-similarity checks;
- mailbox evidence normalization and provenance hashing.

The implementation deliberately separates a single-record evidence class from aggregate Golden Node promotion. A strong initial result cannot promote itself.

### Append-only repository boundary

`src/lib/spinor/repository.ts` exposes one repository contract with two providers:

1. `RemoteSpinorRepository` for production, configured through `SPINOR_STORE_URL` and optional `SPINOR_STORE_TOKEN`.
2. `LocalJsonlSpinorRepository` for development, writing an append-only hash-linked JSONL ledger.

Production fails closed when no remote store is configured. Local storage in production requires the explicit `SPINOR_ALLOW_LOCAL_STORE=true` override and must be treated as ephemeral.

The remote provider contract is:

- `POST /events` with one organization-scoped event;
- `GET /events?organizationId=<id>&type=<optional>&limit=<optional>`;
- append responses containing `eventId`, `receiptHash`, and `storedAt`.

### Mailbox adapter

`src/lib/spinor/mailbox-adapter.ts` converts existing `ProcessedEmailRecord` objects into Observation evidence while retaining:

- organization ID;
- mailbox provider;
- source record and message identifiers;
- source timestamp and ingestion timestamp;
- extraction confidence;
- structured fields and tables;
- analysis output;
- pipeline version;
- a deterministic source-content hash.

### APIs

`GET /api/spinor/evidence` previews normalized evidence without writing it.

Required query parameter:

- `organizationId`

Optional query parameters:

- `provider`
- `mailbox`
- `limit`

`POST /api/spinor/evidence` imports selected or all processed mailbox records and returns append receipts.

Required body fields:

- `organizationId`
- `actorId`
- `provider`

Optional body fields:

- `mailbox`
- `recordIds`
- `limit`

`POST /api/spinor/evaluate` evaluates supplied real inputs. It does not generate synthetic outcomes. Supported sections are:

- `effect`
- `attribution`
- `evidence`
- `goldenNode`
- `activityGenome`
- `complianceTransition`
- optional configurable `thresholds`

### Verification

`tests/spinor-core.test.mjs` uses the built-in Node test runner and covers:

- 10% to 13% as +3 percentage points and +30% relative;
- zero-baseline handling;
- confounder penalties;
- Observation/Internal Signal/Controlled Experiment/Valid Replication distinctions;
- replication-gated Golden Node eligibility;
- blocked compliance transitions;
- Activity Genome repetition;
- complete SPIN requirements;
- immutable hypothesis lineage;
- stable mailbox provenance hashes.

`.github/workflows/mailbox-spinor-ci.yml` runs the domain tests, TypeScript check, and production build for relevant changes.

## Not yet implemented

The following requirements remain open and must not be represented as working:

- authenticated organization membership and row-level tenancy enforcement;
- a deployed durable SPINOR event store matching the repository contract;
- database migrations and relational projections over the event ledger;
- the complete Daily Seed schema, allocator, fairness debt, and portfolio scheduler;
- prior-art retrieval and Research Gauntlet model functions;
- live experiment execution, cohorts, deviations, outcome capture, and attribution persistence;
- independent replication workflow and governed promotion UI;
- pharma approved-content locking, adverse-event escalation, jurisdiction policy hooks, and immutable compliance review history;
- contribution ledgers and bounded contribution scoring;
- automation-candidate progression;
- all eight primary SPINOR screens and their accessible visual organisms;
- end-to-end authentication, organization isolation, mobile, and reduced-motion tests;
- Advantage Foundry and Attribution Oracle service adapters.

## Next critical implementation sequence

1. Deploy a durable organization-scoped event store and verify append receipts.
2. Add authentication and enforce organization membership at every SPINOR API boundary.
3. Add relational projections and migrations for hypotheses, versions, SPINs, experiments, observations, replications, compliance records, and contributions.
4. Implement Daily Seed generation and allocation against stored evidence.
5. Implement experiment execution and the replication-gated promotion end-to-end test.
6. Build the eight screens only against verified stored records.

No screen should display a Golden Node, effect, attribution estimate, mission assignment, or compliance approval that cannot be traced to stored records and receipts.
