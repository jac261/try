# Try — Workout Library & .FIT Export

Try's plan is assembled from a library of structured workout types. Any single-discipline
session can be exported as a Garmin/ANT **`.FIT` workout file** (FIT type 5) and loaded onto
a watch to be followed step by step, with **personalised pace and power targets**.

- **Code:** [`../src/fit.js`](../src/fit.js) — the structured-step library + a from-scratch binary FIT encoder.
- **UI:** every supported session's detail sheet has a **"Send to watch (.FIT)"** button.
- **No backend:** the file is encoded in the browser from `plan.paces` and downloaded as a Blob.

---

## How targets are personalised

The library stores *structure* (steps, durations, repeats); the numeric targets are computed
per-athlete from the same `plan.paces` the app shows, so a faster athlete's file holds faster targets.

| Discipline | Target type | Derived from |
|---|---|---|
| **Run** | Speed (pace) | 5 km time → per-key paces; a step targets a ± window in m/s |
| **Swim** | Speed (pace) | Swim CSS → per-100 m paces → m/s |
| **Bike** | Power (watts) | FTP × the step's %FTP band → an absolute watt range |
| **Bike (no FTP set)** | Open / RPE | Falls back to a lap-button step (effort in the name) |
| **Time-trial test legs** | Open / RPE | All-out efforts are intentionally untargeted |

Pace windows widen by ±5 s (intervals/threshold) or ±8 s (easy/steady) per km. Power steps
use absolute watts (encoded as watts + 1000, per the FIT power-target convention).

---

## The library

Each session type below maps to an ordered list of FIT steps. `N ×` blocks become a real
repeat loop on the watch (a `repeat_until_steps_cmplt` step pointing back to the block start).

### Run (`sport = running`)
| Type | Structure |
|---|---|
| Easy / Long | single steady block @ easy / long pace |
| Tempo | warm-up · tempo block · cool-down |
| Threshold | warm-up · **N × (9 min threshold / 3 min easy)** · cool-down |
| VO2 Intervals | warm-up · **N × (3 min hard / 2 min easy)** · cool-down |

### Bike (`sport = cycling`)
| Type | Structure |
|---|---|
| Endurance | single steady block @ 60–75% FTP |
| Long | endurance block · **2 × (6 min tempo surge / 4 min easy)** |
| Sweet Spot | warm-up · **N × (12 min @ 84–90% / 5 min easy)** · cool-down |
| Threshold | warm-up · **N × (8 min @ 95–105% / 4 min easy)** · cool-down |

### Swim (`sport = swimming`, distance-based)
| Type | Structure |
|---|---|
| Technique | warm-up 300 m · drills · **N × 100 m steady** · cool-down 200 m |
| CSS Intervals | warm-up 400 m · **N × (100 m @ CSS / 15 s rest)** · cool-down 200 m |
| Open Water | warm-up · **4 × 200 m race effort** · skills · cool-down |
| Endurance / Race Pace | warm-up · continuous main set · cool-down |

### Benchmark tests
5 km run TT, 20-min bike FTP, and swim CSS (400 m + 200 m TT) — warm-up/cool-down are paced,
the time-trial legs are open (all-out).

---

## What is and isn't exported

**Exported:** all run, bike and swim sessions, including their benchmark tests.

**Not exported** (the button is hidden): **brick** and **race day** (these are multi-sport — a single
FIT workout is one sport; multisport export is a future addition), **strength** (not a watch-followable
cardio target), and **rest** days.

---

## Technical notes

- **Format:** 12-byte header (`.FIT`, protocol 2.0) → `file_id` (type 5 = workout) → `workout`
  (name, sport, `num_valid_steps`) → one `workout_step` per step → trailing **CRC-16**.
- **Validation:** the encoder's output has been round-tripped through an independent decoder —
  header, declared data size, CRC, and `num_valid_steps` all verify, and every one of the plan's
  single-discipline sessions encodes without error. See the targets/repeats decoded correctly
  (e.g. VO2 repeats loop back to the work step; bike threshold targets 238–263 W from a 250 W FTP).

> **Real-watch check:** files are spec-compliant, but device firmwares vary. Load one onto your
> Garmin to confirm it imports cleanly before relying on it for a key session — especially **swim**,
> where pool workouts can expect a pool length the watch may prompt for.

This is the on-device companion to the [backend roadmap](try-backend-ideas.md): export-to-watch
today, two-way auto-sync once there's a backend.
