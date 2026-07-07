# Code audit guideline

A repeatable audit for Try, run after major changes. First run: 2026-07-08
(four parallel auditors + a verification pass; findings summarised at the
bottom).

## When to run

Run a full audit after any of these, before calling the work done:

- A feature touching the **adaptive engine** (lib/adapt.js, wellness.js) or
  **plan generation** (lib/plan.js schema, builders, migrations).
- A change to the **sync layer or data shapes** (app/sync.js, lib/api.js,
  App.jsx state flows, storage keys) — anything that could lose or corrupt a
  user's log.
- A **new integration surface** (intervals.icu endpoints, watch push, new
  backend contract) — before asking Jack to merge the backend PR.
- A **restructure of a main tab** or a new interactive component.

For small changes (copy, styles, a single banner), the test suite and a
preview check are enough.

## How to run

Fan out **four parallel read-only auditors** (Claude subagents), one per
dimension below, then **verify before believing**: every critical/high
finding gets confirmed against the actual code by the coordinator before it
reaches the report. The first run produced both a false positive (a "stale
timeout" that had a cleanup two lines down) and an overly clean report
(zero engine findings), so:

- Tell each auditor to confirm findings by reading the code path, cite
  file:line, give a concrete failure scenario, and state clean areas
  explicitly. Cap findings so they prioritise.
- Treat "no findings" as a prompt to spot-check that dimension yourself.
- Re-grade severities yourself; auditors inflate.

## The four dimensions

### 1. Engine and plan correctness (lib/)
- Date handling: local-time `iso()`, Monday week boundaries, window edges.
- Maths: NaN/null propagation (missing ftp/css/5k), clamps, sparse wellness.
- Purity: builders and proposal functions must not mutate plan/workouts.
- Determinism: same profile → identical plan; variant seeds (`w.seed ?? 0`);
  no `Date.now()`/`Math.random()` in generation.
- Schema evolution: every consumer of `segments` must tolerate old cached
  shapes (missing `zone`/`blocks`/`min`); `upgradePlanSegments` must never
  change a session's shape.
- `TYPE_IF` covers every type the builders can produce.

### 2. Sync and data integrity (app/, lib/api.js)
- The invariant: **a user's log must never be silently lost.** Trace every
  mutation → server path and every hydrate → local path.
- `refToId` staleness: anything logged before savePlan/replacePlan resolves.
- Wholesale state replacement on hydrate vs merge; multi-device conflicts.
- Optimistic `fire()` calls: which failures self-heal, which diverge forever.
- localStorage: per-user namespacing, quota failures, what `clear()` spares.
- Rapid successive replacePlan calls; failure mid-flight.

### 3. Security and privacy
- Public repo: no secrets, tokens, health data, or personal identifiers in
  tracked files, fixtures, or docs. (`pk_test_` publishable Clerk key in
  .env.production is deliberate and fine.)
- Third-party strings (intervals.icu activity names, server responses) must
  never reach `dangerouslySetInnerHTML`; Icon.jsx's static SVG map must stay
  static.
- Watch-push descriptions: no interpolated value may introduce a line
  starting `- ` (intervals.icu parses those as structured power steps).
- Service worker: static assets only, never API responses.
- Health data lives unencrypted in localStorage by design — nothing more
  sensitive may join it.

### 4. UI robustness, performance, accessibility
- Crash safety on old cached data shapes and empty states (no wellness, no
  activities, empty weeks).
- React: hook order (App.jsx has early returns — effects go above them),
  effect cleanups, stale closures, keys.
- No interactive element inside another (`tap()` inside `tap()` creates
  button-in-button; inner pointer-only targets are `aria-hidden` with the
  accessible path elsewhere — document which).
- Tap targets ≥ 44px effective; sheets need focus management; information
  must not be colour-only.
- Performance honestly assessed at real scale (~150 workouts) — flag, don't
  gold-plate.

## Output and follow-through

- Findings ranked by verified severity, false positives named as such.
- Critical fixes land before the feature ships; high fixes land or become
  tracked follow-up tasks the same day; medium/low go in the report.
- Summarise the audit (date, scope, counts, what was fixed vs deferred) in
  the commit message or below.

## Audit log

### 2026-07-08 — full app audit (first run)
- 4 auditors (engine, sync, security, UI), 37 raw findings, verified down to:
  1 real data-loss race (unsynced log entries wiped by hydrate's wholesale
  `setLog` — tracked as a follow-up fix), 2 nested-button a11y violations
  (fixed), 1 watch-description sanitisation gap (fixed), a set of valid
  medium a11y items (focus traps, colour-only week dots, aria-labels —
  tracked as a follow-up bundle), and honest low notes (quota errors
  swallowed silently, `parseJson` treating a garbage 200 as "no plan",
  wellness re-push chatter on every load).
- Notable false positive: watch-push "stale timeout" (the effect cleanup
  clears it). Notable clean areas: no secrets or health data in the public
  repo, service worker caches static assets only, engine determinism and
  `TYPE_IF` coverage confirmed.
