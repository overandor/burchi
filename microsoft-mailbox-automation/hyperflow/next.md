# Exact next action

Task: **SPINOR-002 — Prevent demo records from masquerading as production evidence**

1. Search the repository for every consumer of:
   - `src/lib/game/data.ts`
   - `todaysMission`
   - `goldenNodes`
   - `experiments`
   - `results`
   - `leaderboard`
2. Identify whether those fixtures are imported directly into pages, returned by APIs, or copied into persistent stores.
3. Add one explicit data-origin contract and one central demo-mode gate rather than scattering environment checks across pages.
4. Add tests proving:
   - demo enabled → fixture records are available and labeled;
   - demo disabled → fixture records are absent;
   - real empty state remains empty and never falls back silently to fixtures.
5. Run:

```bash
npm test
npm run build
```

6. Record the command output in a verification receipt before marking SPINOR-002 VERIFIED.
