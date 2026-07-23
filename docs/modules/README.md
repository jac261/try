# Try — module map

A feature-oriented tour of what Try is built out of and how far each piece has
been taken. Where a module has a deeper spec already, this page links it rather
than repeating it. For the design philosophy that governs all of them (plan as
hypothesis, propose-never-impose, honest numbers, one thing by default) see
[../PHILOSOPHY.md](../PHILOSOPHY.md).

Snapshot: React 18 + Vite 6 PWA, plain JS, Clerk-gated, per-user localStorage
with a backend sync (Jack's ASP.NET Core service). intervals.icu is the
activity source. 685 tests across 39 files at the time of writing.

## The disciplines

Each leg is meant to stand up against a dedicated single-sport app, not just be
"present". Build order was swim → bike → run, weakest first.

| Module | What it covers | Doc |
|---|---|---|
| Swim | The swim workout library, CSS and auto-CSS, the limiter-granted long swim, drills | [swim.md](swim.md) |
| Bike | The bike library, FTP estimation and W/kg, honest distance, indoor handling | [bike.md](bike.md) |
| Run | The run library, hill work, race projections, weekly volume, and standalone run race plans (Tier 2) | [run.md](run.md) |

## The systems that turn disciplines into a plan and a coach

| Module | What it covers | Doc |
|---|---|---|
| Plans | Plan generation, periodisation, the race catalog, templates, race day, tune-ups, experience levels | [plans.md](plans.md) |
| Coach brain | The weekly decision engine and its six passes (decisions, durability, body mass, blocks, the durability veto, mass goals) | [coach-brain.md](coach-brain.md), deeper in [../COACH_BRAIN.md](../COACH_BRAIN.md) |
| Body mass & fuel | Weight tracking, the gain and hold goals (lose deliberately unshipped), long-session fuelling capture | [body-mass-and-fuel.md](body-mass-and-fuel.md) |
| Wellness & readiness | Daily readiness, the athlete-state strip, the what-if sheet, injury/illness handling | [wellness-and-readiness.md](wellness-and-readiness.md) |
| Data & sync | intervals.icu ingest, activity matching, the backend contract, storage, the watch export | [data-and-sync.md](data-and-sync.md) |

## The shared domain vocabulary

These constants live in `src/lib/domain.js` and `src/lib/disciplines.js` and are
referenced by every module above:

- **Disciplines**: swim, bike, run, brick, strength, rest (each with a display
  colour and icon).
- **Race types** (`RACES`): triathlon `sprint / olympic / half / t100 / full`,
  standalone run `run5k / run10k / runhalf / runmarathon` (each `solo: 'run'`),
  plus the no-race states `maintenance` and `tracker`.
- **Phases** (`PHASE_INFO`): Base → Build → Peak → Taper, plus Maintain (the
  no-race block and lead-ins) and Recovery (display label for the post-race
  week).
- **Experience levels** (`FITNESS`): Beginner / Intermediate / Advanced / Elite,
  each carrying a volume `factor`, an `intensity` dial, a recovery cadence, and
  fallback pace anchors (`est5k` for triathletes, `runEst5k` for solo runners,
  `estCss`, `estWkg`).

## Existing deeper docs

Module docs here are the current-state overview. The reference specs are:
[ARCHITECTURE.md](../ARCHITECTURE.md), [PROGRESSION_SPEC.md](../PROGRESSION_SPEC.md),
[ADAPTIVE_ENGINE.md](../ADAPTIVE_ENGINE.md), [WORKOUT_LIBRARY.md](../WORKOUT_LIBRARY.md),
[WORKOUT_SIZING_SPEC.md](../WORKOUT_SIZING_SPEC.md), [READINESS_MODEL.md](../READINESS_MODEL.md),
[EXPERIENCE_LEVELS.md](../EXPERIENCE_LEVELS.md), [COACH_BRAIN.md](../COACH_BRAIN.md),
[BACKEND_HANDOFF.md](../BACKEND_HANDOFF.md), [STYLE_GUIDE.md](../STYLE_GUIDE.md).
