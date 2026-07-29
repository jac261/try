# Bike

Taken from a workout ladder and an FTP number to a full power model in eight
phases, July 2026. This page is the overview; the deeper spec is
[../BIKE_MODULE.md](../BIKE_MODULE.md).

## Workout library and sizing

Bike sessions are built by `buildBike` in `src/lib/plan.js`. The ladder
(`INTENSITY_LADDER.bike`) is:

```
Endurance → Tempo → Sweet Spot → Threshold → VO2 Intervals
```

plus the **Long** ride. `Endurance` is the bike's easy type (there is no
separate `Easy` branch — falling through would hand it the Threshold
formatting), and the long ride caps against the maintenance-scale table during
far-out Maintain lead-in weeks so a distant Full does not schedule months of
three-hour "maintenance" rides.

`bike-sizing.js` gives every type a minimum, a standard band, a coaching
ceiling, fixed shoulders and a written degradation rule. `LEVEL_GATES` decide
what each experience level may be given: over-unders and cadence constraints
unlock at advanced. The progression ladder moves **one variable at a time**,
with repetitions as the variable and effort length sized to fill the time —
the reverse of the obvious arrangement, and deliberate, because deriving
repetitions from the fit makes any rung that adds one a no-op.

Advanced and elite riders on six or more days get a second Endurance ride
stacked on their quality day: an athlete who needs high volume for progression
should be able to have it.

## FTP, provenance, and the anchor

`bikePowerAnchor(profile)` returns a discriminated union — `real`,
`estimated`, or `none` — and everything gates on it:

- **Real** carries `ftpMeta`: a source (`manual`, `try-test`,
  `activity-model`, `intervals-icu`), a date and a confidence, written at all
  five places FTP can change.
- **Estimated** is `level estWkg × weight` (2.0 / 2.6 / 3.2 / 4.0 W/kg), fenced
  inside `computePaces` so it never writes `profile.ftp`.
- **None** when weight is unusable, rather than a nonsense projection.

An estimated FTP may display targets and may never judge a session. Weight
routes through `saneWeightKg` (30–250 kg).

`bike-zones.js` is the one band table; review reads its judging bands from it
via `judgeBandForType`, which returns the union of a type's variant cards so
the judge is never stricter than the card the athlete was given.

## Review

`bike-review.js` matches planned efforts to recorded intervals by duration, in
order, and reports completion, time in target, power adherence, rep fade,
recovery compliance and a confidence. Adherence means distance from the
prescription and is **zero anywhere inside it**. Outdoors the tolerance widens
on the low side only, because interruptions can only ever remove work from an
average.

`ftp-retest.js` recommends a test when several comparable sessions agree, or
when the threshold is stale, unverified or missing. `eftp.js` proposes a
one-tap retarget from recorded rides or intervals.icu. Both recommend; neither
applies.

## Distance and indoor handling

Bike distance is a zone-mix estimate (`ZONE_KMH` scaled by
`(bikeWkg / 2.6) ^ (1/3)`), derived on read with its assumptions attached, and
worn with a tilde. Indoor recordings (`VirtualRide`, via `isIndoor`) have their
derived speed **and distance** suppressed; duration and power still count. A
turbo's kilometres come from its wheel model, not the road.

Every ride carries an indoor and an outdoor execution variant with its own
instructions, and a target mode that follows the anchor: watts when measured,
perceived effort otherwise.

## Long rides, fuelling, bricks, position

Long rides rotate objectives (pure endurance, aerobic durability, late-ride
stability, race power, brick preparation) read off what the builder produced,
plus a rehearsal focus that cycles independently. Not every long ride becomes
harder — a property of the sequence, tested over generated plans.

`bike-fuelling.js` gives each session a carbohydrate and fluid target, capped
one step above what the athlete has logged managing, and compares it against
the fuel tap they already give. `brick.js` judges a ride by the run that
follows; only a *pattern* may say somebody's bike pacing is the problem.
`bike-position.js` accumulates aero tolerance from one-tap answers, guiding
progression and never diagnosing a bike fit.

## Dashboard and readiness

`bike-dashboard.js` answers one question — what is limiting my bike, and what
is the plan doing about it — and puts the limiter and the response first.
`bike-readiness.js` returns eight separate components and **no score**.

## Gated on the backend

`bike-load.js` (intensity factor, power TSS, variability) and
`bike-power-curve.js` / `bike-profile.js` are written, tested and gated: they
return null until the fields arrive. Per-ride and per-interval average power
**do** arrive today and the interval engine runs on them. See
[../BACKEND_HANDOFF.md](../BACKEND_HANDOFF.md) for the five open asks.

## Key files

`src/lib/plan.js` (`buildBike`), `bikeschema.js`, `bike-zones.js`,
`bike-sizing.js`, `bike-distance.js`, `bike-execution.js`, `bike-review.js`,
`bike-load.js`, `bike-long.js`, `bike-fuelling.js`, `bike-position.js`,
`brick.js`, `bike-power-curve.js`, `bike-profile.js`, `bike-dashboard.js`,
`bike-readiness.js`, `ftp-retest.js`, `eftp.js`; components
`BikeExecution.jsx`, `BikeLongPlan.jsx`, `PowerCurveCard.jsx`,
`features/progress/BikeDashboard.jsx`.
