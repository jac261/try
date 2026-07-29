# Run

Nearly competitive at the start, taken through two tiers: Tier 1 (run features
inside triathlon plans, shipped 2026-07-18) and Tier 2 (standalone run race
plans, shipped 2026-07-22).

## Workout library

Run sessions are built by `buildRun` in `src/lib/plan.js`. The ladder
(`INTENSITY_LADDER.run`) is:

```
Easy → Fartlek → Tempo → Threshold → VO2 Intervals
```

plus the **Long Run**. Hill work is built in: the Threshold session has a
sustained-climbs variant and VO2 has an uphill-reps variant, both behind a
Build/Peak and not-beginner durability gate; hill segments carry `terrain:'hill'`
and are prescribed by effort, not pace. `review.js` skips flat-pace grading of
hill segments (this fixed a pre-existing mis-grading of uphill VO2 work).

## Tier 1: run intelligence inside any plan (`runstats.js`, `runload.js`)

Available on every plan shape, triathlon or run:

- **Race projections** (`predictRaceTimes`): from a real 5k time only (never the
  level estimate). 10k and half via the Riegel exponent 1.06; the marathon as an
  optimistic-to-realistic range (1.06–1.15) with hedged copy, because a lone 5k
  says little about marathon endurance.
- **Weekly run volume** (`weeklyRunKm`): an 8-week bar chart of recorded
  kilometres, indoor runs included.
- **Run load guardrails** (`runload.js` `runLoadSignal`, `longRunJumpSignal`,
  `RUN_RAMP_RULES`, `LONG_RUN_RULES`): flag a run block ramping faster than the
  athlete's own recent normal, and a single long run jumping too far.

## Tier 2: standalone run race plans

Race types `run5k / run10k / runhalf / runmarathon`, each carrying `solo: 'run'`
on its `RACES` entry, a race property (never a profile field, so it cannot go
stale) that means the plan trains and races exactly one discipline. This one
flag drives the whole feature; the generation and coach details live in
[plans.md](plans.md) and [coach-brain.md](coach-brain.md). Highlights:

- A run-only template family (`TEMPLATES_RUN_ONLY`): one long run always, two
  spaced quality sessions from four days up, and seven training days means seven
  runs. Duplicate session tokens are differentiated by type rung and a duration
  ladder, with a week-level uniqueness pass guaranteeing no two byte-identical
  sessions.
- Distance-driven long runs: the marathon long floors at the full base for
  beginners (the distance does not shrink for a beginner even though their
  midweek runs do), caps at 3 hours, taper weeks cap at 90 minutes, and race
  week demotes the long to a shakeout.
- Race-pace long-run variants for the half and marathon in Build/Peak, quoting a
  single Riegel-derived pace only from a real 5k and speaking in effort
  otherwise.
- A single-leg race day with a fuelling cue on the marathon card.
- The whole run library needed no new workout types for single-sport plans.

## Experience-level calibration

Solo run plans estimate a blank 5k from `runEst5k` (runner-calibrated:
36:00 / 28:00 / 22:00 / 17:30 for the four levels) rather than the
triathlete-scaled `est5k`. Merged and shipped. See [plans.md](plans.md) and
[../EXPERIENCE_LEVELS.md](../EXPERIENCE_LEVELS.md).

An estimate may size training and may never become evidence. It prints paces
with a tilde and is barred from race projections, benchmark history, exact
race-pace quoting and automatic retargeting. That includes a 5k that arrived
by a feel-based tuning nudge, which is stored but stamped `estimated`
(`runAnchor` in `domain.js` is the one place that decides).

## Since Tier 2: the nine-phase build-out

The run arc formalised what was already shipped and added the rest. Full
account in [../RUN_MODULE.md](../RUN_MODULE.md); the short version:

- **Race pace is a calendar**, not a seed walk, with a dedicated midweek
  `Race Pace` type (`run-race-pace.js`).
- **Distance conversion** in kilometres or miles as an engine-layer
  capability (`run-units.js`): honest tilde-marked conversion and the unit
  preference table exist and are tested, but no UI surfaces them yet — cards
  render km only. Wiring them is a product decision (a unit preference needs
  a Settings control), not a missing import.
- **The 5 km benchmark** has provenance, history, and a test-to-proposal flow
  (`run-benchmark.js`).
- **Sizing, spacing, load and durability** each live in one readable table
  (`run-sizing.js`, `run-plans.js`, `run-durability.js`).
- **Review, fuelling and readiness** turn completed runs into evidence
  (`run-review.js`, `run-fuelling.js`, `run-readiness.js`): the review renders
  on every recorded run's sheet, long runs carry a fuelling plan and grade the
  athlete's fuel tap, and a failed or unmatched 5 km test explains itself in
  the same banner voice the swim uses. Rolling review EVIDENCE (several runs
  arguing together) is dormant until the backend stores a per-run review, the
  same ask the bike has open.
- **A dashboard** answering five questions (`run-dashboard.js`,
  `RunDashboard.jsx` in Progress).

## Still deferred

Duathlon and aquathlon; swim-only and bike-only races; run-only maintenance
blocks. All three need race-type strings the backend catalog does not yet
carry, so nothing is built client-side: a plan that generates correctly and
then fails to save is worse than no plan. `runpass9.test.js` pins their
absence with the reason. Duathlon and aquathlon additionally need product
design, a second run on bike-fatigued legs is not an ordinary run, and the
load guardrails model one run per session.

## Key files

`src/lib/plan.js` (`buildRun`, `TEMPLATES_RUN_ONLY`, `LONG_RUN`/`_CAP`),
`runschema.js`, `runstats.js`, `runload.js`, `run-benchmark.js`,
`run-sizing.js`, `run-plans.js`, `run-durability.js`, `run-race-pace.js`,
`run-units.js`, `run-review.js`, `run-fuelling.js`, `run-readiness.js`,
`run-dashboard.js`, `domain.js` (`runAnchor`).

Tests: `runpass1` through `runpass9`, plus `runpass`, `solopass`, `runload`.
