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
on its `RACES` entry — a race property (never a profile field, so it cannot go
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
triathlete-scaled `est5k`. See [plans.md](plans.md) and
[../EXPERIENCE_LEVELS.md](../EXPERIENCE_LEVELS.md). **Status: built on the
`runner-levels` branch, PR open, not yet merged at the time of writing.**

## Deferred

Duathlon and aquathlon; swim-only and bike-only races; run-only maintenance
blocks; a deterministic race-pace calendar (rehearsals currently follow the seed
walk); a dedicated midweek Race Pace workout type; distance-based prescriptions
(Try stays minutes-first with honest ~km).

## Key files

`src/lib/plan.js` (`buildRun`, `TEMPLATES_RUN_ONLY`, `LONG_RUN`/`_CAP`,
race-pace variants), `src/lib/runstats.js`, `src/lib/runload.js`,
`src/lib/domain.js`.
