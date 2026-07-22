# What the experience levels mean

The four levels (Beginner / Intermediate / Advanced / Elite) do two jobs, and
they must stay consistent because both read the same constants:

1. **Onboarding estimates** (`FITNESS` in `src/lib/domain.js`): an athlete who
   picks a level without test results gets that level's baselines as their
   starting paces (`est5k`, `estCss`).
2. **The weakest-link scale** (`src/lib/weakest.js`): each sport's tested
   baseline is placed on the same ladder as a continuous index (0–3), so the
   three sports can be compared on one axis. The bike ladder is W/kg, which
   needs no per-level onboarding estimate (FTP is optional at onboarding) but
   must be documented here alongside the others.

## The bands

Levels are RANGES, not points (field decision 2026-07-12: "27:00 is not
intermediate" — right; 27:00 is the boundary where Intermediate *begins*).
The stored constants are the band edges; the index interpolates between them,
so a value just inside a band scores just inside it.

| Band (colour) | Run 5k | Swim CSS /100m | Bike W/kg | Reads as |
|---|---|---|---|---|
| Beginner (blue) | slower than 27:00 | slower than 2:00 | under 2.6 | New to multisport; finishing is the goal |
| Intermediate (teal) | 27:00–22:00 | 2:00–1:45 | 2.6–3.2 | A few seasons in, training consistently |
| Advanced (amber) | 22:00–18:30 | 1:45–1:30 | 3.2–4.0 | Experienced, chasing a result |
| Elite (pink) | 18:30 and under | 1:30 and under | 4.0+ | Front-of-pack age-grouper / semi-pro |

(Anchor constants: 34:00 / 27:00 / 22:00 / 18:30 for the run; 2:20 / 2:00 /
1:45 / 1:30 for the swim; 2.0 / 2.6 / 3.2 / 4.0 W/kg for the bike. A 20:18 5k
sits mid-Advanced at ~2.5.) A limiter is only declared when one sport sits
**0.5+ levels** below the best of the others.

**Bike data source:** W/kg needs a weight. The wellness passthrough does not
carry weight yet (backend nicety, not requested), so weight comes from the
fitness editor's optional field, and the latest synced weight is used
automatically if it ever appears in the records.

## Calibration notes (honest ones)

- **`est5k` is the triathlete scale; `runEst5k` is the runner scale.** Option
  (b) from the note below shipped on 2026-07-22 (design panel, anchors signed
  off by Jon). `est5k` stays triathlete-calibrated (beginner 34:00,
  intermediate 27:00, advanced 22:00, elite 18:30) because it also sets the
  `weakest.js` run ladder rungs, a triathlon-only limiter comparison. A second
  field `runEst5k` (beginner 36:00, intermediate 28:00, advanced 22:00, elite
  17:30) is the fallback 5k on solo run race plans (`RACES` `solo:'run'`),
  used only where the athlete leaves the 5k blank. The two scales diverge in
  opposite directions at the ends — a run beginner reads slower than a
  multisport beginner (newer to running, wide novice tail; slow errs safe),
  a run elite reads faster (18:30 is "fast club runner", a notch below front
  of pack) — so no single shift could serve both, which is why it is a
  separate field rather than a softened `est5k`. Volume and intensity are
  deliberately not runner-calibrated in that pass; it is pace-only.
- **W/kg** follows the widely used cycling convention for a sustained hour
  effort: ~2.0 recreational, ~2.6 regular trainee, ~3.2 strong club rider,
  ~4.0 racing sharp. It needs a recent synced weight; without one the bike
  sits out of the comparison rather than being guessed.
- **CSS** rungs mirror common masters/club swim lane groupings; pool CSS, not
  open water.
- **Race share** (the "roughly N% of your race" line) uses rough leg-time
  weights (swim 20 min/km, bike 1.8 min/km, run 5 min/km) and is only shown
  when the plan has a real race — a maintenance block has no race for the
  limiter to be a share of.
