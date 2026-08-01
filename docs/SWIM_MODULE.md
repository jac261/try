# Swim module

The swim was the weakest leg when the build-out started. It is now the most
developed part of Try: a threshold model that knows where its own number came
from, a drill catalogue that responds to what the athlete is working on, an
open-water module, a per-session review engine, and a dashboard that answers
one question rather than showing every number it can.

Built in eight phases from a spec per phase, July 2026. This page is the
deeper spec behind [modules/swim.md](modules/swim.md).

## The rules that govern all of it

These are not style preferences. Each one was won by a bug, and most are
enforced by a test rather than by good intentions.

**An athlete who changes nothing sees nothing change.** Every phase that
touched generation was proven byte-identical against its parent before it
shipped, across a sweep of levels, race types, pool sizes and week shapes.
Two phases changed output on purpose: cool-downs moved to the Recovery zone
(phase 3a) and the open-water session became five categories (phase 6). Both
were signed off first, and both were measured: the open-water change moved 55
workouts across 20 plan configurations and nothing else.

**A number says where it came from.** CSS carries a source, a date and a
confidence. The dashboard tags every metric as recorded, derived, reported,
estimated or missing. Missing is a real answer, not a zero.

**Nothing is claimed without evidence.** Distance estimates are withheld
until the athlete has swum something within reach of them, and quoted as
ranges when they are. A stroke count is not reported when two derivations of
it disagree. A review says insufficient data rather than guessing.

**One voice per session.** When a newer engine can read a session, the older
whole-session average stands down rather than contradicting it on the same
screen.

**Nothing moves the plan on its own.** A CSS retest is recommended, never
applied. A proposal is accepted by the athlete. Stroke metrics may not change
training at all.

## What each phase delivered

### Phase 1: stabilise

`swimschema.js`: a JSDoc typedef of the real swim workout shape plus
structural validators, and a matrix sweep proving every swim type, phase and
role is covered.

The spec proposed a unified schema that renamed shared cross-discipline
fields and lowercased the type strings. That was not implemented: those names
are read across 41 files, and the lowercase types would have 400d against the
backend's closed `WorkoutTypes` set. Formalising the real shape was the
useful half.

One shape fact that matters everywhere downstream: swim segments carry their
minutes in `blocks: [{min, zone}]`, not in a top-level `min` like run and
bike, plus a `swim: {distM, pct}` metadata field. `segMinutes()` is the
canonical accessor.

### Phase 2: the pool profile

`profile.pool = {length, unit}` with 25 m, 50 m and 25 yd presets plus a
custom length. `swim-units.js` rounds every prescribed distance to whole pool
lengths, labels in the pool's own unit, and converts CSS for display without
ever changing the stored value.

CSS stays canonical in seconds per 100 m. The pool changes how work is
written and shown, never the athlete's fitness.

Yard pools were where this got interesting. Rep counts re-derive from actual
metres so a yard session keeps its duration instead of coming up short, and
one shared `swimPaceLabel` helper feeds all seven surfaces that display a
swim pace. The seventh was found by grepping for the old literal after the
review had already listed six.

### Phase 3a: CSS zones and the threshold model

`swim-zones.js` is the single source of the pace offsets: six zones expressed
as seconds from CSS, with `targetPaceForZone()` returning a range for display
and review to share. `computePaces` sources from it, keeping the old key
names as aliases so no consumer changed.

`domain.swimThreshold()` gives CSS provenance: source, measured date,
confidence. `css100Sec` stays the number everything reads.

The one deliberate output change: cool-downs moved from the easy offset to
Recovery, so they are genuinely easy.

### Phase 3b: the CSS test workflow

Provenance is written at all five points a CSS can change: a swum test, an
intervals.icu threshold, a manual edit, onboarding, and a feel-based pace
tune. The fifth was missed on the first pass and found in review, which is
the point of enumerating write points rather than assuming.

`css-retest.js` recommends a retest when CSS is missing, when quality swims
run repeatedly off target, when the measurement is stale, when intervals.icu
materially disagrees, or when the value has never been verified. A
recommendation is not an update.

Accepting a swim retarget opens an evidence sheet: current, proposed, the
change in the athlete's own pool units, the source, the date, the confidence,
and what it does to their next CSS session. Bike and run keep their one-tap
flow.

### Phase 4: the review engine

`swim-review.js` extends the Long-swim principle to every structured swim.
`matchSwimIntervals` pairs the planned set with recorded laps by distance,
count and order, and reports how much to trust the pairing. `swimReview`
produces completion, pace adherence, consistency, fade, effort, confidence,
an outcome and a plain-language explanation.

Session intent decides the rules. Technique and open water are never judged
primarily by pace. Low confidence always resolves to insufficient data. One
session can never answer retest-css on its own: that outcome exists only when
`swimReviewEvidence` finds three comparable sessions, at least two of them
high confidence, all pointing the same way.

### Phase 5: technique development

`swim-drills.js` holds the catalogue with structured metadata: focus areas,
required kit, difficulty, progression group and a purpose line. The original
twelve drills keep their order, because selection indexes into a filtered
slice and a reorder would re-deal every athlete's sessions.

Selection applies the level gate, then the athlete's kit, then unlocks
focus-only drills including the sighting work a pool catalogue never had.
Declaring a focus leads the session with that work without filling it: the
block takes a majority of slots and never the whole block, so the window
slides week to week. Before that cap, declaring a focus produced fewer
distinct drills than declaring nothing.

Seven focus areas shipped, not the spec's nine. Poor pacing and low stroke
efficiency were dropped because drills do not fix them and offering them in a
drill picker would promise something the feature cannot deliver.

### Phase 6: open water

Five race-specific categories (skills, race pace, starts and surges, long
continuous, and swim to bike), each a shape of blocks that the builder turns
into real reps at the athlete's paces. Ten skills, each with a cue and a pool
equivalent.

Every session carries safety wording, worded so nothing reads as permission:
the water outranks the session. It travels to the calendar export too, since
that is what an athlete reads at the lakeside.

Every session has a pool equivalent derived from its own skills, always on
the card. The athlete swaps the water, not the session, so nothing is stored
and there is never a reason to skip.

Peak substitution is unchanged: only the quality swim becomes open water, the
easy slot keeps its technique work, and a week's two swims are never
identical. Early open-water skills are opt-in and land on alternate Build
weeks so half the block still trains threshold.

### Phase 7: the dashboard

`swim-dashboard.js` answers what is holding the swim back and what the plan
is doing about it, with the evidence below the answer. The limiter is chosen
most-actionable first: a plan that is not being completed cannot be
out-trained, and a threshold nobody has measured cannot be coached around.

Estimates for 400 m through 3.8 km are gated on evidence and quoted as
ranges. CSS describes a pace holdable for roughly 1500 m, so that is the
anchor: shorter is estimated faster than CSS, longer slower. Anchoring at
400 m, as the first cut did, guaranteed a 400 estimate slower than the one
the app's own retest card prints.

### Phase 8: stroke metrics, gated off

The spec blocks itself until the pipeline carries the fields, so what shipped
is the computation and data-quality layer, tested and wired to nothing.

The validation was done against real Garmin pool swims rather than
assumptions, and it changed the design. On a real lap, distance divided by
stride gives 97 strokes while cadence multiplied by time gives 48: exactly a
factor of two, because one field counts arm strokes and the other counts full
cycles, and which is which is a device convention. So a count is quoted only
when both derivations agree, and SWOLF is derived per length and labelled as
ours because devices define it differently.

## Files

| File | What it owns |
|---|---|
| `swimschema.js` | The real swim workout shape and its validators |
| `swim-units.js` | Pool maths, rounding to whole lengths, pace display |
| `swim-zones.js` | The six pace zones as offsets from CSS |
| `css-retest.js` | When to recommend a CSS test, and why |
| `swim-review.js` | Per-session review, matching, and rolling evidence |
| `swim-drills.js` | The drill catalogue and focus-aware selection |
| `swim-open-water.js` | Open-water skills, categories, safety, exposure |
| `swim-dashboard.js` | The dashboard model and the limiter |
| `swim-strokes.js` | Stroke metrics, gated off until the data exists |

Generation lives in `plan.js` (`buildSwim`, `pickDrills`, the open-water
branch); auto-CSS and the retarget proposal live in `eftp.js`; the threshold
model is in `domain.js`.

UI: `PoolControl`, `CssProposalSheet`, `CssRetestSheet`, `TechniqueEditor`,
`SwimDashboard`, plus the swim sections of `DetailSheet` and `SettingsView`.

## What the backend gives it, and what is still missing

This section listed three pending asks. All three have since been answered in
whole or in part, so it described the swim as blocked on fields it has been
using for a week. [BACKEND_HANDOFF.md](BACKEND_HANDOFF.md) stays the
authoritative list.

**Landed and in service.** `swimReview` and `techniqueCue` on the workout log
are what let the dashboard's quality card and the technique question light up,
and they are what two of the limiters fire on. Stroke and pool fields arrive
on the activity feed, and `poolLengthM` is what the pool-mismatch check reads.
`cssMeta` carries the threshold's provenance on the typed profile, so a fresh
device knows whether CSS was measured or estimated.

**Landed but deliberately switched off.** The stroke-rate analysis built on
cadence and stride stays behind `STROKE_METRICS_FLAG = false` even though the
fields arrive. The module's own validation found `distance / stride` and
`cadence x time` disagreeing by exactly two on a real lap, because one counts
arm strokes and the other full cycles, and which is which is a device
convention. Turning it on needs per-device validation, which could only begin
once the data flowed. The gate is the honest position, not an unfinished one.

**Still missing.** The typed profile subset does not carry `pool` or
`technique`. Both ride the opaque blob, so nothing fails today and the client
falls back to 25 m, but a fresh device still loses the athlete's own pool and
their technique focus. It is the smallest remaining swim ask and the one whose
absence is invisible until someone reinstalls.

## Deliberately not built

- **Lose as a body-mass goal.** Unrelated to swim, but the same principle:
  ruled out on a safety verdict.
- **Poor pacing and stroke efficiency as drill focuses.** Drills do not fix
  them.
- **Stateful drill progressions.** Needs per-drill exposure history.
- **Recovery-week swim mains at Recovery pace.** Noted, not shipped.
- **Coaching use of stroke data.** Requires validation across devices first.
