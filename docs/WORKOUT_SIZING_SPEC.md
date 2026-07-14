# Tranche 2: workout sizing refactor (segments == durationMin)

Design-panel spec, 2026-07-13. Fixes the headline finding of
docs/WORKOUT_LIBRARY_AUDIT.md (item A): a session's segments do not sum to its
`durationMin`, so the card, the load model and the watch disagree, and a
"trim" does not actually reduce a quality session. Also folds in the two
smaller deferred items: D (brick race-pace scaling) and F (honest distances).

STATUS: awaiting Jon's approval. No code written yet.

## The safety contract (why this is safe on a live plan)

`durationMin` stays exactly `round5(baseDuration * load * weakBias)` and is NOT
changed. Every training-load consumer reads `durationMin`, not the segments:
estimateTss, projectRaceForm, runLoadSignal, week.totalMin, the log model, the
Progress weekly-load bars. Only `watch.js` sums the segment minutes. So fitting
the segments to `durationMin` fixes the watch and the card breakdown while
moving ZERO load numbers. TSS, weekly totals, and the race-day projection are
unchanged for Jon's current plan.

## The model: fit segments to durationMin

A shared pure helper `fitToDur(segs, dur, opts)`, called as the last step in
buildRun/buildBike/buildSwim before return (buildBrick is a dur split, already
sums):

1. **Canonicalise:** for any segment with `blocks`, set `seg.min = sum(block
   minutes)`. This alone repairs the per-segment card-vs-watch drift (Tempo-run
   v1, VO2 30/30 sets), and makes the minutes the helper and watch.js both sum
   agree by construction.
2. **Classify** each format's segments (via an explicit per-template flag, NOT
   label-string matching): warm-up, cool-down/ease, the main quality segment(s),
   and exactly ONE *flexible* aerobic segment (the steady lead-in for
   Long/Endurance, the cool-down for warm-up+main+cool interval formats, the
   middle steady block for continuous variants).
3. **Size the main by filling:** `reps = clamp(round((dur − warmNom − coolNom) /
   cycle), lo, hi)`; regenerate the blocks AND the count-parameterised label from
   `reps` so the label always matches what is pushed. The flexible segment
   absorbs the residual: `flex = dur − warmNom − mainReal − otherFixed`, so the
   segments sum to `dur` exactly (within <1 min only where 30s blocks leave a
   sub-minute remainder).
4. **Degrade ladder** when the flexible segment would fall below ~3 min (dur too
   small): drop a rep and recompute → drop the fast-finish/durability block →
   fall back to a single continuous block of length `dur`. This structurally
   replaces the Tranche-1 `Math.max(5, …)` clamps and removes every
   degenerate/negative case.
5. **Continuous mains:** drop the `clamp(20,40/45)` upper caps that break the
   sum; flex = dur − warmNom − coolNom; collapse to one continuous block below
   the floor.

Determinism and the rebuild-keeps-format invariant are preserved: variant
selection stays `seed % menuSize`, menu size gated on phase+level (never dur);
fitToDur only moves minutes/rep-counts *within* the selected variant.

**Why trim now genuinely reduces:** re-deriving at a trimmed `durationMin`
produces a genuinely smaller fitted shape instead of the floored near-full one
(a Tempo run trimmed to 20 min today prescribes ~37 min of work; after this it
prescribes 20). The migration repairs any already-defeated trims.

Accepted edge: when reps hit the physiological cap and dur is large, the
flexible aerobic tail grows (a 95-min threshold run → a long cool-down). We do
NOT raise the rep cap to fill (that would prescribe unsafe quality volume);
rare at realistic quality durations. Flagged, not a blocker.

## D — brick run-off-bike race scaling (MEDIUM)

Thread `raceType` through buildWorkout → buildBrick (as Tranche 1 threaded
intensity), sourced from `race.key` at generation and `plan.profile.raceType`
at the rebuild sites. Apply only to the Peak run-off-bike leg:

```
RACE_RUN_ANCHOR = {
  sprint: {key:'threshold', zone:'Z4'},  olympic: {key:'threshold', zone:'Z4'},
  half:   {key:'tempo',     zone:'Z3'},  t100:    {key:'tempo',     zone:'Z3'},
  full:   {key:'long',      zone:'Z2'},  maintenance: {key:'tempo', zone:'Z3'},
}
```

Sprint/olympic keep Z4 (their race run is near threshold); half/t100 drop to
tempo; full drops to aerobic (an Ironman race run IS aerobic — Z4 off the bike
on a long-course peak brick is the injury risk the audit flags). The label
"race pace" becomes literally true at every distance.

## F — honest distances (LOW), computed after the fit

- **Run:** replace `dist = dur*60/pc.run.easy` (anchors every run on easy pace)
  with a pace-mix sum over the fitted blocks (zone → pace key). Quality runs
  read slightly longer, long runs slightly shorter — honest either way. Flag
  `~` when `runEstimated`.
- **Swim:** sum the actually-prescribed metres the segments carry (exact, since
  metres are prescribed not paced) instead of the flat 900 m overhead. No `~`
  flag (the estimate is in the pace-minutes, not the metres).
- **Bike:** keep the ~30 km/h guess but always flag `~` (pure guess, no FTP
  link). UI prefixes `~` when `w.distEst`. Distance is display-only (no load
  consumer), so F's blast radius is just the card text.

## Migration: one reshape, idempotent

Extend `upgradePlanSegments` with a **staleness signal** (no schema field):
also re-derive a workout when `effectiveMinutes(segments) !== durationMin`
within tolerance. This targets only genuinely-drifted sessions (continuous/Long
sessions that already sum are left alone), needs no new stored field, and is
self-idempotent (after re-derive they sum). The re-derive runs buildWorkout at
the STORED durationMin/seed/phase/type/intensity/raceType, so it is a pure
segment refresh that also produces the honest distances (F) and corrected brick
anchor (D) in the SAME pass — Jon's plan reshapes exactly once. Preserve
durationMin, type, seed, key, custom, eased/trimmed/boosted flags, log linkage,
moves.

## What a current user sees change (all display/wrist; none load-bearing)

- Watch moving-times line up with the cards (a one-time re-push of this week's
  events on next sync).
- The card-total vs segment-breakdown inconsistency disappears.
- Warm-up/cool-down minutes flex with duration instead of being fixed.
- Run/swim distances change and gain `~` flags where estimated.
- UNCHANGED (assert as guardrails): every durationMin consumer (TSS, weekly
  totals, race projection, run-load), variant selection, recovery-week pinning,
  the set of engine proposals.

## Test strategy (pure-fn)

1. Master sum-fit: segments sum to durationMin within ~1 min for every
   type × variant × duration (write red first, make green builder-by-builder).
2. Canonicalisation: seg.min == sum(blocks).
3. Watch parity: watchSteps total == durationMin*60.
4. Trim/ease strictly reduce summed work (incl. the Tempo-20 regression).
5. No degenerate/negative segment at any reachable short duration.
6. Determinism: same profile → same plan.
7. Format invariant: variant INDEX is dur-independent (fingerprint, not label).
8. Migration: staleness signal re-derives drifted sessions, idempotent.
9. Load-immovability guard: durationMin/TSS/week.totalMin unchanged by the
   refactor for a fixed fixture.
10. D: brick peak run anchor by race distance.
11. F: run pace-mix distance, swim summed-metres distance, estimated flags.

## Sequencing (ship as ONE release behind the full gauntlet)

Step 1 fitToDur + canonical effMin shared with watch.js → Step 2 convert
builders (continuous first, then interval, then swim; remove the Tranche-1
clamps/caps as each flexible segment subsumes them) → Step 3 degrade ladder →
Step 4 D → Step 5 F → Step 6 migration. F-run must land with/after Step 1-3
(computing distance over drifted segments would change it twice).

## Rejected

- Derive durationMin from segments — moves every load number off the
  periodization grid and does not even fix trim (floors regrow it).
- Proportional block scaling — fractional rep geometry, lying labels, ugly DSL.
- Bloat both bookends for overhead — absurd warm-ups at the rep cap; fill the
  main first, flex only the cool-down.
- Raise the rep cap to fill long durations — prescribes unsafe quality volume.
- A libVersion schema field — heavier than the self-targeting staleness signal.
- Flag swim distance estimated — it is exact from prescribed metres.
- Deferred and untouched: TYPE_IF / estimateTss / the durationMin formula
  (freezing them is what keeps load numbers still). Re-tuning TYPE_IF because
  trims now deliver genuinely less is a SEPARATE product decision for later.
