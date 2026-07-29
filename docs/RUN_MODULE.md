# Run module

The run arc, nine phases plus one unplanned fix, written down after the fact.
Companion to [SWIM_MODULE.md](SWIM_MODULE.md) and [BIKE_MODULE.md](BIKE_MODULE.md).

The run started from a different place than the other two. Swim and bike were
built out from very little; the run already had two shipped tiers behind it,
so most phases found the feature already present and the real work was making
it explicit, checkable, and safe to extend. Five phases changed no generated
output at all.

That shape is worth stating plainly, because it is the opposite of what the
specs assumed. Every spec was written as though it were describing work to be
done. In practice most of it described work already done, and the value came
from checking which parts were true.

## The rules that govern all of it

**Minutes are canonical.** Every duration is authored, sized, capped, trimmed
and load-modelled in minutes. Distance is a presentation derived from the
athlete's pace anchor, never a second source of truth (phase 7).

**Generation and judging read one table.** A ladder that disagrees with a
judge is the failure that recurred four times across the swim and bike arcs.
The run's sizing lives in `run-sizing.js` and `buildRun` reads it; the rep
bands live in `review.js` and resolve through the same pace keys the card
prints from.

**An estimate may size training and may never become evidence.** A level-table
5 km guess sizes sessions, prints paces with a tilde, and is barred from race
projections, benchmark history, exact race-pace quoting and automatic
retargeting (phases 2 and 5).

**One session cannot retarget a plan.** A benchmark change needs three
comparable high-confidence sessions agreeing, with hill sessions excluded
because they carry no flat-pace truth (phase 8).

**Hills are prescribed by effort, never graded by pace.** Uphill pace reads
slower at the same effort, so grading a hill rep against a flat target calls a
well-run rep off target (phases 1 and 3).

**No scores.** Durability signals are cautions with a stated cause; race
readiness is eight components. A single number invites an athlete to read an
injury probability, or a probability of success, into arithmetic carrying
nothing of the sort (phases 6 and 8).

**Byte-identity is the contract.** An athlete who changes nothing sees nothing
change. Every phase was verified against a digest of ~139,800 generated
workouts, and the three phases that did change output changed only what they
intended to.

## What each phase delivered

### Phase 1: stabilise the shipped engine

`runschema.js` and a 33-test regression matrix. The spec's proposed rename
(`sport`, `durationMinutes`, `intervals`, lowercase `vo2`) was rejected for
the third time in three arcs: those fields are the shared cross-discipline
workout object, and the type strings are a backend closed set.

Enumerating what generation actually emits corrected the spec's type union
twice. `Test` is a real type it omitted; `race-pace` and `shakeout` are not
types at all.

Three of the spec's invariants did not survive contact with the code and are
pinned as the engine really behaves: two quality sessions hold in Build and
Peak from intermediate up rather than universally, and run count and the
one-Long rule hold up to race week.

### Phase 1b: race week stops at the race

Not in any spec. The audit found race week scaled its durations but never its
intensity ladder, and nothing ended the week at race day. Across the matrix
that was 300 Long rides and 80 bricks scheduled AFTER the goal race, plus
several hundred hard sessions inside the final 48 hours, including a bike VO2
session two days before an Olympic and a 65-minute Long ride with sweet-spot
blocks the morning after one.

Three windows now: the 48 hours before sharpen, the day after recovers, the
rest of the week is easy aerobic. Sessions three or more days before are
untouched, so an athlete racing Sunday still gets their Wednesday sharpener.
Sessions are demoted, never deleted, so a logged session still matches.

### Phase 2: the 5 km benchmark

`run-benchmark.js`. `run5k` was a first-class test kind, same rotation as
`bikeFtp` and `swimCss`, its own built session, and the only one of the three
with no provenance anywhere. The fitness editor branched on the other two,
onboarding wrote the other two, and the intervals.icu proposal retargeted a
bare `fivekSec`. So the app could not say when a 5 km was measured, how, or
whether to trust it, for the one anchor race projections extrapolate from.

The test now reaches the athlete: App matches the logged test to a recording,
reads its laps, and `eftpProposal` returns a retarget carrying `try-test`
provenance. Previously someone who ran the test still retyped their watch.

Three of the spec's seven guardrails need activity fields the backend does not
send, and are recorded as asks rather than written as guards that cannot fire.

### Phase 3: the workout library, hills and progression

`run-sizing.js`. The numbers were already in the engine, scattered as literals
across six branches of `buildRun` where nothing could read or check them.

And the fix: Threshold's hill circuit was gated on Build/Peak and not
beginner; **VO2's uphill repetitions were not gated at all**, so 5 to 10 × 75 s
uphill hard appeared in Taper weeks, 80 of them, sitting next to a correctly
gated Threshold circuit.

On progression, two of the spec's eight dimensions are not independent: rep
count is derived FROM duration, so growing the session IS the rep progression
and nothing else may add reps on top. The bike arc shipped exactly that rung
and it was a no-op.

### Phase 4: the standalone plan's architecture

Almost everything was already true and already pinned. The one real gap was
what §3 asked for literally: the spacing rules were explicit nowhere. They
held as emergent behaviour of `assignSoloMids`.

`run-plans.js` states the contract and checks it, deliberately a checker, not
a second placer, so there is one implementation rather than two that can
drift. Measured across 2,448 solo weeks: zero adjacent qualities, zero either
side of a long run.

### Phase 5: experience-level calibration

The four anchors were already correct and merged. What was not done was the
separation rule, and one path broke it four ways.

`tuneFields` wrote a `fivekSec` derived from the level table when the athlete
had no real 5 km, and stamped nothing, while the swim and bike branches
immediately below it both stamped provenance. So one feel-based nudge on a
blank-5k plan turned a 28:00 guess into a real benchmark, produced a
**4h23 to 5h19 marathon prediction from a time never run**, entered benchmark
history, made the long run quote an exact race pace, and had Settings label it
as measured.

Fixed the way the swim fixed its own fifth write point. The number stays on
the profile and still sizes the plan; it simply stops being evidence.

### Phase 6: run load, the long run and durability

`run-durability.js`. The rotation rule already held: hard long runs are 12.5%
of all long runs against a 25% ceiling. What was missing is that nothing could
say so, and that the load model tracked two dimensions when a ramp is made of
four: a week can hold its minutes exactly and still change completely by
adding a fourth run or moving ten minutes from easy into threshold.

Quality share reads the PLAN, not the pace of the recording: a hard session
run badly is still a hard session.

### Phase 7: race pace on a calendar, and distance

The first phase that added features rather than formalising them.

Race-pace exposure was one entry in a seed-picked menu, producing two
identical blocks in an 18-week plan with none in Build for a beginner. It is
now a table keyed on race, phase and phase-week. Sizing it took two
corrections: a first draft drove the hard-long share to 41%, and a first draft
also gated beginners out, which a shipped test caught, because the modulo
trap that once made race pace unreachable for beginners was fixed
deliberately.

`Race Pace` joined as a midweek type, spelled as the backend already stores it
(the swim has carried that exact string for months). This forced the ladder
and the quality CATEGORY apart: Race Pace is quality, but it is prescribed by
a calendar rather than climbed toward.

`run-units.js` added miles, which the app had nowhere.

### Phase 8: review, fuelling and race readiness

Three modules, each re-guarding a hazard the bike arc paid for. `runReview`
takes `intervalRows` output rather than deriving a second opinion, so a review
can never disagree with the splits table printed above it. Fuelling stops at
the top of the scale the athlete can answer on, and the no-history case is the
most conservative rather than the most generous. Readiness is eight
components, and an athlete with no data reads `unknown` on every one.

### Phase 9: the dashboard

`run-dashboard.js`, computing nothing of its own. Projections are absent
rather than approximate when the anchor is not real.

## After the arc

Five defects were found and fixed that no spec asked about: race week never
stopping at the race, ungated VO2 hill repetitions in taper, a feel-nudge
laundering a guess into a benchmark, `run5k` having no provenance anywhere,
and a midweek race-pace block sized from its slot rather than the calendar.

Every one was found by measuring generated output rather than reading code.
The pattern held for nine phases: read the spec, generate the matrix, count
what actually comes out.

## Files

| File | What it owns |
|---|---|
| `runschema.js` | the workout shape, the closed type set, the ladder and the quality category |
| `runstats.js` | Riegel race projections and their metadata, weekly kilometres |
| `runload.js` | the shipped ramp and long-run-jump guardrails |
| `run-benchmark.js` | the 5 km benchmark, its provenance, history, and the test-to-proposal flow |
| `run-sizing.js` | warm-ups, cool-downs, main sets, rep counts, the hill gate |
| `run-plans.js` | the solo plan's spacing and structural contract |
| `run-durability.js` | the volume model, durability cautions, long-run objectives |
| `run-race-pace.js` | the race-pace calendar and the midweek session spec |
| `run-units.js` | kilometres, miles, distance conversion, the unit preference |
| `run-review.js` | per-session review, confidence, and the evidence window |
| `run-fuelling.js` | long-run fuelling targets and the gut cap |
| `run-readiness.js` | eight race-readiness components, no score |
| `run-dashboard.js` | the five questions, assembled from the modules above |

Tests: `runpass1` through `runpass9`, plus the pre-existing `runpass`,
`solopass` and `runload` suites.

## Waiting on the backend

| Ask | Unblocks |
|---|---|
| `elapsedTimeSec` | rejecting a heavily interrupted 5 km test |
| `totalElevationGain` / `Loss` | rejecting a downhill-assisted 5 km test |
| `runmaintenance` race type | run-only maintenance blocks, a real gap today |
| `duathlon` / `aquathlon` race types | the multisport extensions, which also need product design |

## Deliberately not built

**Duathlon and aquathlon plans.** Blocked on the catalog, but not only on it.
A duathlon's second run happens on bike-fatigued legs and the run-load
guardrails model one run per session; an aquathlon's run follows a swim, which
is not the brick model and for which no data exists. See the handoff.

**A durability score, a readiness score, or any single number.** Named here so
that adding one later is a decision rather than a drift.

**The spec's field renames.** `sport`, `durationMinutes`, `intervals` and
lowercase type names were proposed in phase 1 and rejected, as they were for
swim and bike.
