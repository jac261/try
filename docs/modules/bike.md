# Bike

Mid-depth at the start, brought to honest power-and-distance handling. Shipped
2026-07-18.

## Workout library

Bike sessions are built by `buildBike` in `src/lib/plan.js`. The ladder
(`INTENSITY_LADDER.bike`) is:

```
Endurance → Tempo → Sweet Spot → Threshold → VO2 Intervals
```

plus the **Long** ride. `Endurance` is the bike's easy type (there is no
separate `Easy` builder branch — falling through would hand it the Threshold
formatting), and the long ride caps against the maintenance-scale table during
far-out Maintain lead-in weeks so a distant Full does not schedule months of
3-hour "maintenance" rides.

## FTP, W/kg, and the estimate

Bike intensity is anchored on FTP (functional threshold power, watts):

- Entered by the athlete, or **estimated** as `level estWkg × weight`
  (2.0 / 2.6 / 3.2 / 4.0 W/kg for the four levels) so a new rider sees target
  ranges instead of RPE-only text.
- The estimate is fenced: it lives only inside `computePaces` and never writes
  `profile.ftp`. `weakest.js`, `eftp.js`, `tuning.js` and the fitness-history
  trend all read `profile.ftp` directly, and a guessed FTP would corrupt each
  of them, so `profile.ftp` stays null until a real number arrives.
- Both existing bike power review verdicts require a **real** FTP; an estimated
  FTP never judges a session.
- Weight routes through the shared `saneWeightKg` guard (30–250 kg); an unusable
  weight yields no watt estimate rather than a nonsense projection.

## Distance

Bike distance is a zone-mix estimate (`ZONE_KMH` scaled by
`(bikeWkg / 2.6) ^ (1/3)`) rather than a flat 30 km/h, so a stronger rider's
ride reads longer. `bikeWkg` needs no weight (it is already a ratio), so even a
weightless plan gets speed differentiation. Estimated distances wear a tilde and
are derived again on hydrate because the plan DTO drops the field.

## Indoor handling

Indoor recordings (`VirtualRide`, `VirtualRun`, via `autolog.js` `INDOOR_TYPES`
/ `isIndoor`) are labelled as indoor and have their derived speed/distance
suppressed in both the recorded-activity rows and in `review.js` — a turbo's
"distance" is meaningless, but its raw duration and power still count.

## eFTP retarget

`eftpProposal` (`eftp.js`) proposes a one-tap FTP retarget when the athlete's
recorded rides or configured intervals.icu FTP drift from the plan's target.
Gated off on solo run plans.

## Deferred / backend asks

- Per-ride average and normalized power passthrough for real power-based TSS.
- A power-curve endpoint.
- ERG detection.

These are recorded in [../BACKEND_HANDOFF.md](../BACKEND_HANDOFF.md). Power-derived
load and the power curve are currently impossible client-side.

## Key files

`src/lib/plan.js` (`buildBike`), `src/lib/domain.js` (`estWkg`, `saneWeightKg`,
`INTENSITY_LADDER.bike`), `src/lib/eftp.js`, `src/lib/autolog.js`,
`src/lib/review.js`.
