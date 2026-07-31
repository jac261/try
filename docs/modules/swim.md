# Swim

The weakest leg at the start, now the most developed part of Try. Brought to a
credible standalone-swim standard 2026-07-18, then rebuilt across eight phases
in July 2026 into a full module: a threshold model with provenance, pool-aware
everything, a per-session review engine, focus-driven drills, open water, and a
swim dashboard.

Full detail in [../SWIM_MODULE.md](../SWIM_MODULE.md). This page is the tour.

## Workout library

Swim sessions are built by `buildSwim` in `src/lib/plan.js`. The intensity
ladder (`INTENSITY_LADDER.swim`) is:

```
Technique → Endurance → CSS Intervals → Race Pace
```

plus **Open Water** as the Peak-phase race-specific session (only the quality
slot becomes Open Water; the easy slot keeps its technique work, so two swims
in a week are never identical). The **Long Swim** is a fourth type that only
enters a week via the limiter frequency swap (see [plans.md](plans.md)): a long
swim is the coaching-correct third swim for a swim-limited athlete, not a
weekend anchor for everyone.

Every session sizes from its own prescribed minutes
([../WORKOUT_SIZING_SPEC.md](../WORKOUT_SIZING_SPEC.md)), carries a `role` so a
deep recovery week's two swims differ, and has a degrade floor and coaching
ceiling. The Long Swim caps at `LONG_SWIM_CAP` (90 minutes) on every path.

Swim segments carry their minutes in `blocks: [{min, zone}]`, not a top-level
`min` like run and bike, plus `swim: {distM, pct}`. `segMinutes()` is the
canonical accessor, and `swimschema.js` validates the shape.

## Pool profile

`profile.pool = {length, unit}`: 25 m, 50 m and 25 yd presets plus a custom
length. `swim-units.js` rounds prescribed distances to whole pool lengths and
labels in the pool's unit. CSS stays canonical in seconds per 100 m; the pool
changes how work is written and displayed, never the athlete's fitness.

## CSS: zones, provenance, testing

`swim-zones.js` holds the six pace zones as offsets from CSS, and is the only
place those numbers live. `domain.swimThreshold()` reports where the athlete's
CSS came from: source, date, confidence.

Auto-CSS (`eftp.js`) reads the app's 400/200 test back from recorded laps,
normalised for yard pools and failing closed on bad data. `css-retest.js`
recommends a retest when CSS is missing, stale, unverified, contradicted by
intervals.icu, or when quality swims run repeatedly off target. A
recommendation is never an automatic change: a swim retarget opens an evidence
sheet the athlete accepts or declines.

## Review

`swim-review.js` judges structured swims rep by rep rather than by a
whole-session average, producing completion, adherence, consistency, fade,
confidence and one coaching outcome. Technique and open water are never judged
primarily by pace. One session can never argue for a CSS change on its own.

## Drills and technique focus

`swim-drills.js` holds a level-gated catalogue with focus, kit, difficulty and
purpose metadata. An athlete can declare up to two focus areas and their kit;
selection then leads with that work without filling the session with it, and
only prescribes drills they own the equipment for. Declaring nothing leaves
sessions exactly as they were.

`swim-kit.js` (phase 6) aggregates the session's drill gear into the detail
sheet's one Bring line. It resolves drills by label suffix against the closed
catalogues (drillSegs builds labels as reps, length, then the drill name), a
contract pinned by a per-drill coupling test plus the invariant that no drill
name is a suffix of another; open-water wetsuit rehearsals add the wetsuit.
The line only ever names kit the prescription actually uses, and a session
that needs nothing shows nothing.

## Open water

`swim-open-water.js`: five race-specific categories, ten skills each with a
cue and a pool equivalent, and safety wording on every session that also
travels to the calendar export. Every open-water session has a pool version on
the card, so the water can be swapped without skipping the session.

## Dashboard

`swim-dashboard.js` answers what is holding the swim back and what the plan is
doing about it, with evidence beneath. Every metric is tagged recorded,
derived, reported, estimated or missing. Distance estimates are gated on
evidence the athlete has produced and quoted as ranges.

## Deferred

- **Stroke metrics** are written and tested but gated off (`swim-strokes.js`)
  until the activity feed carries the fields. Backend branch pushed.
- **Stored reviews and technique feedback** need typed log fields; until then
  the dashboard's quality card and the cue question stay dark.
- Stateful drill progressions, recovery-week swim mains, and coaching use of
  stroke data. See [../SWIM_MODULE.md](../SWIM_MODULE.md).

## Key files

`src/lib/plan.js` (`buildSwim`, `pickDrills`, the open-water branch),
`swimschema.js`, `swim-units.js`, `swim-zones.js`, `css-retest.js`,
`swim-review.js`, `swim-drills.js`, `swim-open-water.js`, `swim-dashboard.js`,
`swim-strokes.js`, `eftp.js` (auto-CSS and the retarget proposal),
`domain.js` (`swimThreshold`, `estCss`, `INTENSITY_LADDER.swim`).
