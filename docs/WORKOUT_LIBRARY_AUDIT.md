# Workout library audit

Run 2026-07-13 by the review gauntlet (3 audit lenses on Opus, adversarial
verify on Sonnet). 16 findings confirmed, 2 refuted. This is an audit of
EXISTING behaviour in src/lib/plan.js (the builders), src/lib/adapt.js
(estimateTss), and src/lib/watch.js (the watch push) — nothing here regressed
recently; these are latent. Deduped to six issues, most consequential first.

## A. Segments do not sum to durationMin (HIGH, correctness)

The root defect, and it shows up seven ways. Every interval builder sizes its
main block as `clamp(round((dur - 25) / N), lo, hi)` with a fixed warm-up
(12-15) and cool-down (10). So the segments almost never total `durationMin`,
and three consumers then disagree about how long one session is:

- the card and the load model (estimateTss) read `durationMin`;
- the watch push (watch.js) sums the actual block minutes.

Verified: an advanced Build Threshold run, `durationMin = 65`, seed→variant 2
builds `15 + 3×(12+4) + 10 = 73` min. The card shows 65, TSS is charged at 65,
the watch is told 73. Five of six Threshold runs in one generated plan drifted.

Two sharper consequences:

1. **Trim / ease / recovery-week do not actually reduce the session.** Because
   the builders floor the work portion (`clamp` lo, `max(15, …)`, `min 20/45`
   continuous), a trimmed session rebuilds near full size. A Tempo run trimmed
   to `durationMin = 20` rebuilds `12 + 15 + 10 = 37` min of prescribed work —
   nearly double the number the card and the load model believe. The adaptive
   engine's whole point (lighten the load when readiness or ramp demands) is
   silently defeated for quality sessions.
2. **Degenerate / negative segments at short durations.** The Long Ride
   durability variant opens `{ min: dur - 32 }` and the Long Run variant
   `{ min: dur - 25 }`, unclamped. A beginner's custom 30-min "Long" bike, or a
   small-base Long Ride the engine trims, yields a `-2` min steady segment.

Fix is a real design decision (it changes TSS values, weekly totals, and what
the watch receives): builders should fit their segments to exactly `dur`
(main = dur − warm-up − cool-down, reps sized to fit; scale or drop the
warm-up/cool-down and fall back to a single continuous block when `dur` is too
small), OR `durationMin` is derived from the built segments AND trim rebuilds
to a genuinely smaller shape. Recommend a design pass before touching this.

## B. Bike over-unders deliver Z3↔Z5, not the Z4 they claim (HIGH, physiology)

Bike Threshold variant 1's segment detail says `0.92–1.06 FTP · Z4 Threshold`,
but the expanded blocks tag the under legs `Z3` (76-90% FTP) and the over legs
`Z5` (106-120%). The watch (bare bike power zones) receives a tempo-to-VO2
swing, a different and harder stimulus than the around-threshold over-under the
card promises and the workout is named for. Root cause: the Z3/Z5 split was a
visual choice (make the profile bar chart show spikes) later reused verbatim as
the literal watch DSL targets. Fix: retag the legs to hug threshold (under high
tempo/sweet-spot, over threshold+) so the delivered intensity matches the card.
Contained.

## C. Block labels contradict the recoveries actually pushed (MEDIUM, correctness)

Human labels overstate the rest the structured blocks encode. Long Ride
variant 1 reads "2 × 10 min sweet spot / 5 min easy" but pushes
`rep(2, 10, Z3, 2.5, Z1)` — a 2.5 min recovery. The card says 5:00, the wrist
does 2:30. Several labels are out of step with their blocks. Fix: make the
label text match the blocks (or vice versa). Contained.

## D. Peak brick run-off-bike is threshold regardless of race distance (MEDIUM, physiology)

buildBrick variant 0 at Peak prescribes the transition run at
`threshold · Z4` labelled "race pace". Defensible for sprint/olympic; for
70.3, t100 and full-distance athletes, race run pace is Z2-low-Z3, and Z4 off
the bike on a long-course peak brick is materially hotter than race pace and an
over-fatigue/injury risk. Fix: scale the brick run anchor to race distance.

## E. Durability finish gated only by phase, so beginners get Z4 on tired legs (MEDIUM, physiology)

`durability = phase === 'Build' || 'Peak'` with no level gate. A beginner
still reaches Build/Peak, and on any seed→variant 2 week their long run ends
with `4 × (3 min threshold / 2 min easy) on tired legs` (Z4) — identical reps
to an elite, no scaling. Threshold work on already-fatigued legs for a novice
is a poor risk/reward. Fix: gate durability on level (≥ intermediate), or scale
the reps/intensity down for lower levels.

## F. Distances shown precise from a coarse easy-pace anchor (LOW, honesty)

`dist = dur * 60 / pc.run.easy` anchors every run type on easy pace, so
quality runs are under-stated and long runs (run at the slower long pace)
over-stated, and the figure carries no `~` flag even when the paces themselves
are level estimates (runDetail already flags estimated paces). Swim distance
uses a flat 900 m overhead that does not match the per-variant warm-up/drills
(a CSS session's real overhead is ~600 m). Fix: anchor the distance to the
session's actual pace mix and flag it estimated when the paces are.

## Refuted (not defects)

- Easy-run "steady" second half slower than the "relaxed" first half — the
  arithmetic is real but this is a normal progression-run prescription, not a
  bug.
- Threshold run pace `p + 12` "too fast" — within a defensible lactate-
  threshold band off 5k pace.

## Recommended sequencing

- **Tranche 1 (contained, unambiguous):** B, C, E, F, and the degenerate/
  negative-segment guard from A. Small blast radius, clearly correct, shippable
  behind the usual gauntlet.
- **Tranche 2 (design pass first):** the core "segments equal durationMin" and
  "trim genuinely reduces work" refactor (the rest of A). It changes TSS
  values, weekly load totals, and the watch payload, and it restores the
  adaptive engine's intended effect — so it deserves a design panel and a
  product decision on how sessions should size, not a unilateral rewrite.
