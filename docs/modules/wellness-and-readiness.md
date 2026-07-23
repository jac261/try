# Wellness & readiness

The daily-state layer that lets the plan respond to how the athlete actually is,
without overreacting to noise. Deeper model in
[../READINESS_MODEL.md](../READINESS_MODEL.md) and
[../ADAPTIVE_ENGINE.md](../ADAPTIVE_ENGINE.md).

## Readiness

`wellness.js` folds the daily inputs (HRV, resting HR, sleep, subjective feel)
into a banded readiness signal (green / amber / red) with its own history. The
band, not the raw numbers, drives adaptation, and a single bad day is treated as
noise — the engine reacts to patterns.

## The athlete-state strip

`src/features/wellness/AthleteStateStrip.jsx` (`athleteState.js`) is the
four-tile summary on the Today and Progress views: fitness, fatigue, recovery,
and run load. Tiles are discipline-agnostic except the run-load tile, which
reads "Run paused for now" instead of "Not enough runs yet" when running is
excluded — and real logged runs always outrank the schedule.

## Adaptation (`adapt.js`)

The propose-never-impose engine. It produces:

- `proposeToday` — a readiness-driven downgrade or nudge for today's session,
  always a tap-to-accept proposal that the athlete can decline and undo.
- `proposeWeek` — a trim-week or boost-week call (the coach brain reads this to
  narrate the week; it never re-derives the thresholds).
- `proposeRace` / `projectRaceForm` and `projectRecovery` — form and recovery
  projections around race day.

Guardrails (`RAMP_RULES`, `FORM_RULES`, `RACE_RULES`, `RECOVERY_RULES`) keep the
build honest; the ramp guardrail is the main defence against a too-fast build.

## Injured / excluded state

`profile.excludedDiscipline` (set at onboarding: null / run / swim, never bike)
removes a discipline from the plan: it selects the `TEMPLATES_NO_RUN` /
`TEMPLATES_NO_SWIM` family, drops that discipline's benchmark test, turns off the
limiter frequency swap, and removes the sport from the weakest-link comparison.
Race day still shows all three legs with an untrained-leg caution, because the
race is the real event. Injury and illness words only ever originate from the
athlete's own answers.

## The what-if sheet

`src/features/wellness/WhatIfSheet.jsx` (`whatif.js`) lets the athlete preview
how a readiness change would reshape the week before committing.

## Weakest link

`weakest.js` places the athlete's trained disciplines on one experience scale
(the `est5k` / `estCss` / `estWkg` ladders) and, when one sits clearly behind the
others by more than the gap threshold, names it the limiter and biases the plan
toward it. It needs two comparable disciplines, so it never fires on a solo plan
(where the coach brain treats the one discipline as the limiter outright), and a
stale off-plan baseline is prevented from naming an untrained sport.

## Key files

`src/lib/wellness.js`, `src/lib/adapt.js`, `src/lib/weakest.js`,
`src/lib/whatif.js`, `src/features/wellness/`.
