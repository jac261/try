# Plans — generation, periodisation, race catalog

How a profile becomes a full periodised plan. The entry point is `generatePlan`
in `src/lib/plan.js`; the domain constants are in `src/lib/domain.js` and the
athlete's starting point in `src/lib/start-volume.js`.

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

## Where the plan starts (`start-volume.js`)

Session minutes above are sized from the **race**, so before this existed the
first week of a full-distance plan at advanced level opened with a 4.3 km long
swim: the level factor makes advanced *bigger*, and nothing anywhere asked
where the athlete currently is.

Onboarding now asks four optional questions — training hours in a typical
recent week, and the longest recent swim (metres), ride and run (minutes) —
editable afterwards in Update fitness. They are **anchors, not targets**:

- Long sessions start at the athlete's current longest and grow about ten per
  cent per completed training week until the race-driven curve is lower, which
  then takes over unchanged. Anchors only ever *lower* a session, so peaks are
  untouched and high volume stays possible.
- Recovery weeks hold the growth clock rather than advancing it, and carry the
  engine's own step-back so a binding cap cannot hand a recovery week a higher
  ceiling than the training week before it.
- The weekly-hours anchor is applied to the fully built week. The cut falls on
  everything without its own discipline anchor — never tests, races, strength
  or the volume double — and each shrunk session is rebuilt through the same
  builder with the same seed, so cards still sum and a retarget regenerates
  them identically.
- A brick rides the bike anchor.

Blank answers mean the previous behaviour exactly: generation is byte-identical
across the full config sweep for a profile with no anchors, and an answer
outside the sane ranges is ignored rather than obeyed.

`startVolumeShortfall(profile)` compares the anchored plan's peak long sessions
against the same plan without anchors. When the gap is material the athlete
gets a dismissible note saying so — the growth curve will not ramp faster than
is safe, so the honest fixes it names are more weeks or a shorter race, never
"train harder".

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

## The Today briefing (phase 5)

`src/lib/today-briefing.js` is a pure read over the generated plan answering
the daily-briefing questions on the Today screen: the context line (phase and
week, with recovery, maintenance and race-week variants), the day's priority
(ranked strictly by the generator's own flags: race, tune-up, test, key,
quality; a stacked double is never primary while its host is present), the
dependency line (copy exists ONLY for relationships the generator encodes:
the strength double, the volume double, an easy secondary beside the primary;
athlete-assembled days get no line, and nothing ever claims an intra-day
order because the engine encodes none), and preparation cues (fuelling and
long-ride focus from the exact helpers the detail sheet calls, same eased
workout and fuelLog, so the numbers one tap deeper always agree).

The week label is composed from structured fields rather than shared with
TodayView/WeeklyDigest/PlanView's three hand-built strings: those are
differently shaped from different sources, and an options-API helper would
save nothing (named decision, phase 5).

Deferred, with reasons: a swim kit cue (equipment is flattened into segment
prose at generation and does not survive onto workouts; a real cue needs a
builder change); intra-day ordering advice (nothing encodes an order);
conditions in cues (the app has no weather input).

## Key files

`src/lib/plan.js`, `src/lib/domain.js`, `src/lib/start-volume.js`,
`src/lib/schedule.js`, `src/lib/today-briefing.js`,
`src/features/onboarding/`, `src/features/settings/`,
`src/features/plan/PlanView.jsx`.
