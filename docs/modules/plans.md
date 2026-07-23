# Plans — generation, periodisation, race catalog

How a profile becomes a full periodised plan. The entry point is `generatePlan`
in `src/lib/plan.js`; the domain constants are in `src/lib/domain.js`.

## The race catalog (`RACES`)

| Key | Name | Legs | Taper | Build window |
|---|---|---|---|---|
| `sprint` | Sprint | 0.75 / 20 / 5 | 1 wk | 6–16 wk |
| `olympic` | Olympic | 1.5 / 40 / 10 | 1 wk | 8–24 wk |
| `half` | Half (70.3) | 1.9 / 90 / 21.1 | 2 wk | 12–32 wk |
| `t100` | T100 (100k) | 2 / 80 / 18 | 2 wk | 12–32 wk |
| `full` | Full (140.6) | 3.8 / 180 / 42.2 | 2 wk | 16–40 wk |
| `run5k` | 5k Run | run only, `solo:'run'` | 1 wk | 6–16 wk |
| `run10k` | 10k Run | run only | 1 wk | 6–20 wk |
| `runhalf` | Half Marathon | run only | 1 wk | 8–24 wk |
| `runmarathon` | Marathon | run only | 2 wk | 12–28 wk |
| `maintenance` | Maintenance | no race (`noRace`) | — | rolling 4–52 |
| `tracker` | Tracker | no plan at all | — | — |

Legs are swim / bike / run km. `minWeeks`/`maxWeeks` bound the build: under the
minimum the plan warns and becomes a sharpen-and-arrive; over the maximum the
plan opens with a Maintain lead-in until the build window begins.

## The `solo` flag

`solo: 'run'` on a race entry is the single-sport foundation. It means the plan
trains and races exactly one discipline, and it outranks both
`excludedDiscipline` (the injured-state flag) and a locked limiter swap. Because
it is a race property rather than a profile field it cannot go stale and it
round-trips the backend for free. Every single-sport behaviour keys on it, and
because triathlon entries lack it, triathlon output is byte-identical by
construction (proven by parity sweeps in the swim/run passes).

## Periodisation

`computePhases` splits the build into **Base → Build → Peak → Taper** (Base/
Build/Peak by percentage of the non-taper weeks, taper from the race entry). A
race beyond the ideal window gets Maintain lead-in weeks; a post-race recovery
week is appended (displayed as **Recovery**, stored as Maintain since the
backend phase catalog has no Recovery). A step-back recovery week lands every
`recoveryEvery` weeks per the athlete's level.

## Templates

Per-day-count session token lists (`TEMPLATES` for triathlon,
`TEMPLATES_NO_RUN` / `TEMPLATES_NO_SWIM` for injured state,
`TEMPLATES_RUN_ONLY` for solo run). Day assignment puts long/brick sessions on
the weekend or the athlete's chosen long day first, quality midweek. The
**limiter frequency swap** (`swapForLimiter`) donates one weekly slot from the
strongest sport to the weakest through Base and Build; it is inert on injured
and solo plans.

## Race day and tune-ups

Race day replaces that calendar day's session with a `RACE` block: three legs
for a triathlon (every leg always shown, with an untrained-leg caution for
injured plans), a single honest leg for a solo run race. **Tune-up (B) races**
(`B_RACES`) drop a real mid-plan event onto its day with a mini-taper around it,
at least 10 days clear of the goal race. Run tune-ups render a warm-up / race-it
/ cool-down block; a raced half eases an extra day out.

## Workout sizing and building

Each session's minutes come from level `factor` × phase load × any limiter bias,
then the discipline builder (`buildRun` / `buildBike` / `buildSwim` /
`buildBrick`) turns minutes into segments, fitting the chosen variant to exactly
the prescribed duration. See [../WORKOUT_SIZING_SPEC.md](../WORKOUT_SIZING_SPEC.md)
and [../WORKOUT_LIBRARY.md](../WORKOUT_LIBRARY.md).

## Experience levels

`FITNESS` carries per-level dials: `factor` (volume), `intensity` (ladder shift,
−1 beginner to +2 elite), `recoveryEvery` / `recoveryDepth`, and fallback pace
anchors. A blank fitness field falls back to the anchor: `est5k` for triathletes
(also the weakest-link ladder rungs), `runEst5k` for solo runners (a separate
field so the runner scale never disturbs the triathlete ladder). Full rationale
in [../EXPERIENCE_LEVELS.md](../EXPERIENCE_LEVELS.md).

## Plan lifecycle

`generatePlan` (fresh), `reshapePlan` (settings edit, preserves plan identity),
`retarget` (fitness change, holds the limiter swap steady), `rollMaintenance`
(post-race or horizon rollover), and the tracker sentinel (no plan). Identity
(`createdAt`) is preserved across reshapes so logged sessions and frozen coach
decisions stay attached. See [../ARCHITECTURE.md](../ARCHITECTURE.md).

## Key files

`src/lib/plan.js`, `src/lib/domain.js`, `src/lib/schedule.js`,
`src/features/onboarding/`, `src/features/settings/`, `src/features/plan/PlanView.jsx`.
