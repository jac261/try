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

- **These are triathlete scales, not single-sport scales.** "Elite" here means
  the front of a triathlon age-group field, in the context of training three
  sports at once. A sub-20 open 5k is roughly the top few percent of parkrun
  finishers and would be called elite in a running club; an 18:30 rung is
  deliberately stricter because the label also drives Elite-level onboarding
  estimates and plan intensity. If the rung feels too strict as a *scale*
  (field observation 2026-07-12: "a sub-20 5k is elite"), the honest options
  are (a) soften `est5k` for Elite to 1200 (20:00), which also softens the
  paces an Elite-onboarding athlete receives, or (b) split the two roles so
  the weakest-link ladder can be tuned without touching onboarding estimates.
  Both are one-line changes; neither has been made yet — the coupled constants
  are the current, deliberate state.
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
