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

**Simulate imperfect use, not ideal use.** Every field report becomes a
permanent simulated case for future audits and verifications:

- Pointers WANDER: drags pass over padding cells, gaps, invalid targets and
  other UI on the way to their destination — test the journey, not just the
  destination (2026-07-08: blank calendar cells lit up as drop targets
  because a null-vs-null comparison only showed while hovering somewhere
  invalid).
- Users NAVIGATE MID-FLOW: change month/tab/view while a panel, drag or
  sheet is open, and check what stale state survives (2026-07-08: the
  selected day panel outlived its month).
- Devices are STALE: an installed PWA runs one service-worker generation
  behind — reproduce reports against the previous bundle too, and remember
  a "does nothing" report can be a silently failing server write rather
  than a dead handler (the catalog-drift incident).
- Third-party fields have PER-SPORT semantics: probe intervals.icu values
  for each sport that can produce them, not just one (the 359 W running
  power vs bike FTP incident).
- Data sources STOP: when a feed disconnects or goes stale, every consumer
  needs a recovery path — "stands down when real data exists" must not mean
  "stands down forever once real data existed" (2026-07-10: one measured CTL
  in the store would have disabled the log-derived model permanently, framing
  the engine dormant and the Progress tab frozen for a lapsed intervals user).
- Estimates never overwrite USER-ENTERED values: any read-time overlay must
  fill only the fields that are genuinely missing (2026-07-10: a manually
  entered TSB was silently replaced by the derived estimate).

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
- **Catalog parity**: any new workout type, role, discipline or adjustment
  kind on the frontend needs a matching PlanCatalog allow-list entry in the
  backend BEFORE shipping — drift rejects every plan write for affected
  accounts, silently (the 2026-07-08 Fartlek incident).

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

### 2026-07-10 — focused audit: sensor-less tier (readiness v3/v4, check-in, log-derived load)
- 4 auditors (engine/model, sync/data-integrity, UI/a11y, imperfect-use
  timelines), 15 raw findings, verified to 4 real fixes landed same-day:
  stale-intervals dead end (derived model now CONTINUES from the last measured
  CTL/ATL when the feed is stale, instead of standing down forever — no scale
  seam, gaps self-heal), manually entered TSB clobbered by the estimate (the
  merge now fills only null fields; found by the coordinator's spot-check after
  the sync auditor reported clean — the process's "no findings → spot-check"
  rule earning its keep), check-in tap targets ~29px (now ≥44px effective),
  and the derived-series recomputation memoised.
- False positives named: midnight "duplicate" check-in (a new calendar day
  correctly gets a new check-in), the onFeel render-nothing guard (established
  isolated-mount convention), multi-device feel divergence (documented cost of
  a device-local store), day-1 empty-banner unreachable for plan holders
  (intended — manual entry stays reachable via the card's Update link). One
  auditor misread deriveLoadRecords as emitting only logged days; it emits
  every day (decay), which invalidated their day-1 mechanics.
- Honest deferrals: whyOpen toggle survives a midnight rollover (cosmetic),
  coach-line tone during a return from a long break ("drifting down" reads
  post-recovery), calibration feel-vs-evening-ATL temporal offset (accepted:
  that pairing is what the model should learn from).

### 2026-07-08 — focused audit: Calendar/Plan restructure
- 2 auditors (DnD/date logic; UI/mobile/a11y), 17 raw findings, verified to:
  2 real logic bugs fixed same-day (a second finger mid-drag overwrote the
  active drag state; dropping a session back on its planned date wrote a
  redundant move and left a phantom Moved tag — now clears the move), and 4
  cheap UI fixes (done-dots gain the week strip's ✓ mark, grip widened to
  40×48, aria-current on the selected day, -webkit-touch-callout suppressed).
- False positives verified as such: "iOS scrolls during drag" (touch-action:
  none on the grip prevents pan for pointers starting there), "addMonths
  anchor drift" (the grid renders whole months; day-of-month is irrelevant),
  "tests/custom shouldn't be draggable" (moves are allowed by the guardrails).
- Honest deferrals: per-pointermove re-renders (~35 cells at 60Hz — fine at
  this scale), grid density on <360px phones, verbose day-cell labels.

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
