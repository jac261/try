# Swim

The weakest leg at the start of the build-out, brought up to a credible
standalone-swim standard. Shipped 2026-07-18, with sizing refinements landed
2026-07-20.

## Workout library

Swim sessions are built by `buildSwim` in `src/lib/plan.js`. The intensity
ladder (`INTENSITY_LADDER.swim`) is:

```
Technique → Endurance → CSS Intervals → Race Pace
```

plus **Open Water** as the Peak-phase race-specific session (any non-easy swim
slot in Peak becomes Open Water; the easy slot keeps its technique work so two
swims in a week are never byte-identical). The **Long Swim** is a fourth
session type that only enters a week via the limiter frequency swap (see
[plans.md](plans.md)) — there is no base template that carries `swim:long`,
because a long swim is the coaching-correct third swim for a swim-limited
athlete, not a weekend anchor for everyone.

Every session sizes from its own prescribed minutes (`WORKOUT_SIZING_SPEC`),
carries a `role` (easy / quality / long) so a deep recovery week's two swims
differ, and has a degrade floor and coaching ceiling. The Long Swim caps at
`LONG_SWIM_CAP` (90 minutes) on every path including the F2 boost nudge —
pool sessions stop earning past ~90 minutes for the athletes Try serves.

## Drills and kit cues

A level-gated drill catalog attaches technique work with concrete kit cues
(the "salt" that varies a drill is derived from raw duration divided by five,
to dodge modular collisions with the session seed).

## CSS and auto-CSS

CSS (critical swim speed, pace per 100 m) is the swim's pace anchor:

- Entered by the athlete, or estimated from their level (`estCss`).
- **Auto-CSS** (`eftp.js` `cssFromTestIntervals` / `cssTestActivityFor`):
  when the athlete logs the app's 400/200 CSS test, the recorded lap times are
  read back and CSS is computed from them. Distances are normalised for yard
  pools, the read fails closed on bad data, and there is a dedicated recording
  finder because the generic activity-match window rejects a fast swimmer's
  ~21-minute test.
- The `eftpProposal` swim branch proposes a one-tap CSS retarget when a
  recorded test or a configured intervals.icu swim threshold drifts from the
  plan's CSS. On solo run plans this branch is gated off (nothing to retarget).

## Review

The Long Swim is graded through the per-interval rep table (`review.js`), not a
whole-session average, so a structured swim reads honestly.

## Deferred

- `TEMPLATES_NO_RUN` swim:long (interacts with Peak open-water forcing and
  `detectLimiterSwap`).
- Pool-length setting.
- SWOLF and stroke fields — the backend passthrough carries no stroke data yet
  (a standing ask in [../BACKEND_HANDOFF.md](../BACKEND_HANDOFF.md)).
- CSS zone-table rework.

## Key files

`src/lib/plan.js` (`buildSwim`, `LONG_SWIM_CAP`, the swim templates),
`src/lib/eftp.js` (auto-CSS), `src/lib/review.js`, `src/lib/domain.js`
(`estCss`, `INTENSITY_LADDER.swim`).
