# Bike module

The bike started as the least examined leg: a workout ladder, an FTP number,
and a distance estimate. It is now a power model that knows where its number
came from, a session library that progresses one variable at a time, an
interval-level review engine, a durability and fuelling system, a rider
profile waiting on data, and a dashboard that names one limiter and what the
plan does about it.

Built in eight phases from a spec per phase, July 2026. This page is the
deeper spec behind [modules/bike.md](modules/bike.md), and the companion to
[SWIM_MODULE.md](SWIM_MODULE.md).

## The rules that govern all of it

These are not style preferences. Each one was won by a bug — usually one the
review gauntlet demonstrated end to end — and most are enforced by a test
rather than by good intentions.

**An athlete who changes nothing sees nothing change.** Every phase after the
generation work was proven byte-identical against its parent across 17,832
workouts spanning race types, levels and day counts. Phases 4 through 8 add no
generation at all: they read what the engine already produced.

**A number says where it came from.** FTP carries a source, a date and a
confidence. The dashboard tags every metric as recorded, derived, reported,
estimated or missing. Missing is a real answer, not a zero.

**An estimated threshold may display targets and may never judge.** A rider
whose FTP was inferred from their level cannot be told they missed a number
that was itself a guess about their category.

**The judge is never stricter than the card.** Whatever watts a session
prints, an athlete who rides exactly that must be judged on target. This rule
was broken four separate times — by a band table that drifted from
generation, by an over-under card judged at a steady floor, by adherence
measured from a widened band's midpoint, and by an easy-ride ceiling set
below the most permissive endurance card — and each fix made the judging read
from the same table generation does.

**Guards fail closed.** A comparison that cannot prove two readings are
comparable refuses. Written as `a.x && b.x && a.x !== b.x`, a guard is open
whenever a field is missing; written as `a.x !== b.x`, it is closed.

**Absence yields to presence.** In a limiter ladder, things that are
happening outrank things that are unknown. A rider with a measured problem is
told about the problem, not about the data they have not supplied.

**One voice per session.** When a newer engine can read a session, the older
whole-ride average stands down rather than contradicting it on the same
screen.

**Nothing moves the plan on its own.** An FTP retest is recommended, never
applied. A curve may argue for a test; it may not change a threshold. The
strongest action any of this takes is putting a sentence in front of the
athlete.

## What each phase delivered

### Phase 1: stabilise the shipped engine

A regression matrix (`bikematrix.test.js`) over every level, race type, phase
and recovery state, plus `bikeschema.js` as the typed shape of what the
builder actually emits, and `bikePowerAnchor()` as the discriminated union
(`real` / `estimated` / `none`) every later phase gates on.

Three spec items came back as answers rather than changes. Ride frequency
tops out at two rides a week in the base templates; a third comes from being
bike-limited. Jon overruled the cap: **an athlete who needs high volume for
progression should be able to have it**, so advanced and elite riders on six
or more days now get a second Endurance ride stacked on the quality day. The
far-out Long-ride cap turned out to be on the *scale*, not the finished
minutes. And the builder's final `else` is Threshold, so any type that loses
its branch renders silently as Threshold — pinned by a test.

### Phase 2: FTP and the power anchor

`ftpMeta` gives FTP a source, a date and a confidence, written at all five
places FTP can change. `bike-zones.js` became the single band table, and
review now reads its judging bands from it.

This phase found the first card-versus-judge contradiction: generation
prescribed Tempo at 76–85% of threshold while review judged it at 83–90%, so
a rider at 195 W against a card reading "190–213 W" was told they came in
under. The fix is `judgeBandForType`, which returns the *union* of a type's
variant cards, because **the judge must be at least as permissive as the most
permissive card**.

### Phase 3: the workout library and progression

`bike-sizing.js` gives every session type a minimum, a standard band, a
ceiling, fixed shoulders and a written degradation rule; `LEVEL_GATES` gate
structures by experience (over-unders and cadence constraints unlock at
advanced); `PROGRESSION_STEPS` move one variable at a time.

The gauntlet found the ladder was largely decorative. Repetition count was
derived from the fit — `floor(mainMin / per)` is already the largest count
that fits — so a rung asking for one more repetition had it removed by the
very next line, and two of five rungs were byte-identical to the base rung at
all 2,754 legal inputs. The fix inverts the model: **repetitions are the
variable and the effort length fills the time.** That also made buildability
rung-independent, so progressing can no longer turn an interval session into
a continuous block, and a trim can no longer flip a session's format.

A second finding: the rung index is the week, and recovery weeks pin it to
zero, so a four-rung ladder against a four-week recovery cadence left one rung
unreachable for three of the four levels. **A ladder's length must be coprime
with every recovery cadence in use** — the shipped ladder is five rungs (base,
reps, duration, density, sharpen), coprime with both the three- and four-week
cadences, and a test asserts every rung is reachable at every level in real
generated plans rather than asserting the table.

### Phase 4: distance, indoor, and the execution model

The zone-mix distance model moves to `bike-distance.js` with its assumptions
attached — a distance is the output of a model under stated inputs, not a
measurement, and the card now says so. It is derived on read rather than
stored, because the plan DTO drops fields it does not type.

`bike-execution.js` gives every ride an indoor and an outdoor variant with its
own instructions, and a target mode that follows the power anchor: watts when
the threshold was measured, perceived effort otherwise.

The outdoor review guardrail is one-sided on purpose. Interruptions can only
ever *remove* work from an average, so the tolerance widens on the low side
and not the high side. And a real leak surfaced: review suppressed derived
*speed* indoors while printing "Distance 30 km" one line above the comment
explaining why that number cannot be trusted.

### Phase 5: interval-level review

`bike-review.js` matches planned efforts to recorded intervals by duration, in
order, and reports completion, time in target, adherence, fade, recovery
compliance and a confidence. An average cannot judge an interval session: the
recoveries are inside it, so a session ridden exactly right reads soft.

The spec claimed the client lacked per-ride average power. It did not —
`averageWatts` arrives per ride and per interval — so the interval engine
needed no backend field at all. What is genuinely missing is normalized
power, and `bike-load.js` holds the intensity-factor, TSS and variability
maths behind that gate. It is deliberately **not** approximated from interval
averages: that approximation sees variability between efforts and none within
them, so a ragged effort and a metronomic one of the same average score
identically, which is the single distinction the metric exists to make.

The gauntlet's headline here: adherence was measured from the *union* band's
midpoint, so riding the top watt printed on a Threshold card returned "your
threshold may have moved" beside "100% of your effort time was in the target
range", and three flawless sessions tripped the rolling FTP evidence.
Adherence now means distance from the prescription, and zero anywhere inside
it.

### Phase 6: long-ride durability, fuelling, bricks and position

Long rides gained rotating objectives, read off the session the builder
already produced. `bike-fuelling.js` gives each session a carbohydrate and
fluid target; `brick.js` judges a ride by the run that follows it;
`bike-position.js` tracks aero tolerance as a one-tap self-report, since no
position data exists.

Two things worth carrying forward. Gut training is a **constraint**: the
carbohydrate target is capped one step above what the athlete has logged
managing, because prescribing race rates to someone who has never held them
is how a long ride becomes a gastrointestinal event. And the first cut
inverted that cap — an athlete with no history got the largest dose in the
system while one who had proven 60 g/h got 90 — with a test that asserted the
inversion as intended behaviour.

Also from the gauntlet: brick training sessions only appear at four training
days, so a sweep run at six concluded they did not exist and all three new
modules excluded them on discipline.

### Phase 7: the power curve and the rider profile

Written, tested against known values, and gated: Try has no power-curve
endpoint, and a curve cannot be assembled from activity averages because a
best is not in a mean.

Section 5 shaped the data model rather than being a footnote. A new power
meter reads several per cent apart from an old one, so a rider who changes one
appears to get stronger at every duration overnight. A point therefore carries
source, date, bike, environment and quality, and comparisons **refuse** across
a device change rather than reporting hardware as fitness.

`bike-profile.js` returns five capability scores and **no label**. Phenotype
labels are sticky in a way numbers are not — an athlete told they are a diesel
stops sprinting — so a test asserts no field of the returned object could be
used as one. Scores are normalised against the rider's own mean, because a
uniform FTP error would otherwise move all five together and manufacture a
whole profile out of a mis-set threshold.

### Phase 8: the dashboard and race readiness

A pure read over everything phases 1 to 7 built, and the first time they all
had to compose. The limiter and the plan's response come first on the page,
because they are the only two things anybody has to act on.

Race readiness is eight components and **no score**. Eight things measured
with eight different confidences do not average: a rider with good fitness, no
fuelling data and an untested position would get a number dominated by
whichever components happen to be measurable. Terrain keeps an honest
`unknown` rather than being dropped, because a missing row is
indistinguishable from a passing one.

The gauntlet's two worst finds here were both wrong-but-not-broken. The
dashboard rendered the **swim** CSS retest under its "Next FTP
recommendation" heading — both objects are `{headline, why, sig}`, so nothing
threw. And four of the eight plan responses described engine behaviour no
phase ever built.

## After the arc

Two things landed after the eight phases and change what a rider sees.

**A post-merge audit** of swim and bike together — the first look at the merged
whole, since every phase gauntlet reviewed a diff. Its thesis was that defect
classes fixed in bike phases survived in the older swim code, because the
generalised guards only covered bike files, and that held: swim recovery was
collected and never compared, the stroke gate had no door, the swim limiter
gave day one an all-clear. On the bike side it found the curve's missing-source
refusal was labelled an environment change and never raised the device banner.
The guards now cover both modules.

**Start-volume anchors.** Session minutes are sized from the race, so a
full-distance plan at advanced level opened week one with a 4.3 km long swim.
Onboarding now asks four optional questions about where the athlete currently
is, and long sessions start there and grow at a safe rate until the race-driven
curve takes over. Blank answers keep the previous behaviour byte-identically.
See [modules/plans.md](modules/plans.md).

## Files

| File | What it holds |
|---|---|
| `src/lib/bikeschema.js` | The typed shape of a bike workout, and its validators |
| `src/lib/bike-zones.js` | The one zone and band table; `judgeBandForType` |
| `src/lib/bike-sizing.js` | Session sizing, level gates, the progression ladder |
| `src/lib/bike-distance.js` | The zone-mix distance model and its assumptions |
| `src/lib/bike-execution.js` | Indoor and outdoor variants, target mode |
| `src/lib/bike-review.js` | Interval matching, the review model, rolling evidence |
| `src/lib/bike-load.js` | IF, power TSS, variability — gated on normalized power |
| `src/lib/bike-long.js` | Long-ride objectives and rehearsal focuses |
| `src/lib/bike-fuelling.js` | Carbohydrate and fluid targets, planned versus consumed |
| `src/lib/bike-position.js` | Aero tolerance from the athlete's own answers |
| `src/lib/brick.js` | Whether the bike leg left a run in the legs |
| `src/lib/bike-power-curve.js` | The curve model and its comparability rules — gated |
| `src/lib/bike-profile.js` | Five capability scores, no label |
| `src/lib/bike-dashboard.js` | The dashboard model and the limiter |
| `src/lib/bike-readiness.js` | Eight readiness components, no score |
| `src/lib/ftp-retest.js` | When to recommend a test, and why |
| `src/lib/eftp.js` | The eFTP proposal and its guardrails |
| `src/components/BikeExecution.jsx` | Where to ride it |
| `src/components/BikeLongPlan.jsx` | Long-ride objective, fuelling, position tap |
| `src/components/PowerCurveCard.jsx` | The curve, silent until data exists |
| `src/features/progress/BikeDashboard.jsx` | The dashboard |

## What the backend gives it, and what is still missing

The five fields this module was built to wait for have all landed. The list
that used to sit here described them as pending, which stopped being true on
30 July 2026 and misread the module's own state for anyone who read it after.
[BACKEND_HANDOFF.md](BACKEND_HANDOFF.md) stays the authoritative list; this is
what the bike in particular got, and what it still wants.

**Landed and in service.** `startedAt` orders bricks and measures transitions.
`elapsedTimeSec` separates a stop from a bad day, so an outdoor ride is judged
on what the rider did. `normalizedWatts` unblocked intensity factor, power TSS
and variability index. `bikeReview` gave per-session reviews somewhere to
live, which is what turned the dashboard's quality section from "not enough
data yet" into an actual answer. The power-curve endpoint unblocked the rider
profile.

**Landed but not yet in service.** `totalElevationGain` and
`totalElevationLoss` merged in JackGilham/try-backend#25. They are the run's
ask rather than the bike's, but they matter here because the same release
carries the `run_review` migration: nothing from that merge reaches an athlete
until the migration-only stage runs and the API is promoted behind it.

**Still missing, and it is a judgement rather than a field.** The power-curve
endpoint serves `quality: null` on every point. The client reads absent as
usable on purpose, because defaulting an unknown to `low` would empty the
rider profile for everyone, so only an explicit `low` can protect an athlete
from a bad point. That leaves the one error an athlete cannot catch for
themselves wide open: a dropout, a spike or a new power meter reads as a
sudden fitness gain at every duration at once, and the curve is exactly the
surface where that looks like progress. `source` is the field that makes it
detectable, and it is already there; what is missing is anyone's verdict on
whether a point is trustworthy.

The other open bike-adjacent ask is the anonymised percentile breakpoints,
which would turn the rider profile's spider rings from a comparison against
Try's own level table into one against other athletes. It needs a conversation
about consent and k-anonymity more than it needs an endpoint.

A power *stream* would have subsumed elapsed time, normalized watts and the
curve together, and still would, if it is ever easier to expose than the
separate computed fields.

## Deliberately not built

**A single race-readiness score.** Section 7 of the phase 8 spec forbids it
and the reasoning holds: whatever single number exists is the only thing
anybody reads.

**A rider phenotype label.** Same reasoning one level down, and a test
enforces the absence.

**Normalized power approximated from interval averages.** A wrong number with
a right name is worse than a missing one, because nothing downstream can tell.

**Stroke-style ERG detection.** Recorded as a named field in the handoff so it
has a name if the data ever arrives; nothing in the client turns on it.

**Automatic FTP changes from anything.** Not from the curve, not from review
evidence, not from a single strong ride. Every path ends at a recommendation.
