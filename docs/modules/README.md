# Try — module map

A feature-oriented tour of what Try is built out of and how far each piece has
been taken. Where a module has a deeper spec already, this page links it rather
than repeating it. For the design philosophy that governs all of them (plan as
hypothesis, propose-never-impose, honest numbers, one thing by default) see
[../PHILOSOPHY.md](../PHILOSOPHY.md).

Snapshot: React 18 + Vite 6 PWA, plain JS, Clerk-gated, per-user localStorage
with a backend sync (Jack's ASP.NET Core service). intervals.icu is the
activity source. 1,440 tests across 77 files at the time of writing.

## The disciplines

Each leg is meant to stand up against a dedicated single-sport app, not just be
"present". Build order was swim → bike → run, weakest first. Swim and bike have
each had a full eight-phase build-out, and the run a nine-phase one (plus an
audit round). All three are built out.

| Module | What it covers | Doc |
|---|---|---|
| Swim | The swim library, the pool profile, CSS with provenance and testing, per-session review, technique focus, open water, the swim dashboard | [swim.md](swim.md), deeper in [../SWIM_MODULE.md](../SWIM_MODULE.md) |
| Bike | The bike library and its sizing, FTP with provenance, honest distance, indoor handling, interval-level review, durability and fuelling, bricks, the power curve, the bike dashboard | [bike.md](bike.md), deeper in [../BIKE_MODULE.md](../BIKE_MODULE.md) |
| Run | The run library and its sizing, the 5 km benchmark with provenance, hill work, the race-pace calendar, distance in km or miles, load and durability, review and fuelling, race readiness, the run dashboard | [run.md](run.md), deeper in [../RUN_MODULE.md](../RUN_MODULE.md) |

### Across all three: the performance spider

`spider.js` places an athlete's paces on a radar chart against **Try's own
named level rings** (Beginner to Elite), not a population percentile — we hold
no population, and a percentage against an invented one is a fabricated
statistic with an axis label. `SPIDER_SOURCES.population` is the seam for the
day the backend can aggregate consenting users.

Each discipline projects across its axes only from evidence the athlete
produced: the swim from the two points its 400/200 test yields (the
critical-speed model), the run from its 5 km anchor with any recorded race
overriding the projection as a measured point, the bike from its power curve
on its own shape rings rather than level rings, because those scores are
deviations from the rider's own mean. An estimated anchor draws no polygon at
all: it would sit on a ring by construction, so the app would be grading its
own guess. Rendered by `SpiderChart.jsx` on all three dashboards.

## The systems that turn disciplines into a plan and a coach

| Module | What it covers | Doc |
|---|---|---|
| Plans | Plan generation, periodisation, the race catalog, templates, race day, tune-ups, experience levels, and where a plan starts from | [plans.md](plans.md) |
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
[BACKEND_HANDOFF.md](../BACKEND_HANDOFF.md), [STYLE_GUIDE.md](../STYLE_GUIDE.md),
and the three discipline build-outs [SWIM_MODULE.md](../SWIM_MODULE.md),
[BIKE_MODULE.md](../BIKE_MODULE.md) and [RUN_MODULE.md](../RUN_MODULE.md).
