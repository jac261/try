# How the readiness score works

_The logic behind the daily "Ready to roll / Ease into it / Recover today" number.
Implemented in [`src/lib/wellness.js`](../src/lib/wellness.js) and rendered in-app on
the profile page ("How your readiness works")._

## The shape of it

Every morning **starts at 100**. Each signal you have data for **subtracts points**
as you drift from a healthy norm — the further out, the bigger the penalty — and a
couple can add a small bonus. The result is clamped to 0–100 and banded:

| Score | Band | Meaning |
|---|---|---|
| **≥ 75** | 🟢 Ready to roll | recovered, train as planned |
| **55–74** | 🟠 Ease into it | a bit down — keep hard efforts controlled |
| **< 55** | 🔴 Recover today | signals point to rest / very easy |

Two principles run through the whole thing:

1. **Everything is relative to _you_.** HRV and resting HR are scored against your own
   **rolling 21-day baseline** (mean, and for HRV the standard deviation), recomputed
   daily. "Good" and "bad" track your normal, not a population average, so the model
   self-calibrates as your fitness shifts across a training block.
2. **Missing data never punishes you.** A factor only contributes when its value is
   present, so a day with only sleep logged can still score 100. The trade-off — a
   sparse day can look rosier than reality — is exactly why the intervals.icu sync
   matters: full data, honest score.

## Why these weights

A factor's **weight** is the most it can ever subtract. The weights rank how much a
morning number should trust each signal:

| Factor | Weight | Why it ranks there |
|---|---|---|
| **HRV** | 26 | The most direct read on autonomic (nervous-system) recovery, and z-scored to your own norm so it self-calibrates. Gets the heaviest single vote. |
| **Sleep** | 22 | The primary _input_ to recovery — near-equal to HRV. |
| **Resting HR** | 15 | Corroborates HRV, but noisier and laggier, so lower — and penalty-only (a low reading is normal, not "extra ready"). |
| **Form (TSB)** | 14 | Chronic training-load _context_, not today's acute physiological state — the lightest vote, and the only one besides HRV that can add a small freshness bonus. |

## No cliff edges — the penalty is a smooth curve

Each factor maps its input to a penalty by **piecewise-linear interpolation** between
documented anchor points, so there are no arbitrary tier boundaries: **6.4h of sleep
lands _between_ the 6h and 7h penalties (≈ −2), not on a flat −3.** The anchors are the
"why this number" for every factor.

### HRV — weight 26 · input: standard deviations from your 21-day HRV mean
| HRV vs baseline | Penalty |
|---|---|
| ≥ 0.7 sd above | **+4** (bonus) |
| at baseline | 0 |
| ~1 sd below (−0.7) | −11 |
| ~1.5 sd below | −18 |
| 2.6+ sd below | −26 |

_A z-score below −1 means your HRV is meaningfully suppressed vs your own normal — the
single best proxy for "your nervous system hasn't bounced back."_

### Sleep — weight 22 · input: hours slept
| Sleep | Penalty |
|---|---|
| ≥ 7h (adult need met) | 0 |
| 6h | −3 |
| 5h | −11 |
| ≤ 4h | −22 |

_7h is treated as meeting an adult's need. The penalty deepens **faster than linearly**
below that (−3 → −11 → −22) because sleep debt compounds: the hour lost from 6→5 costs
more than 7→6. **So 6.4h ≈ −2** — you're inside "slightly under," you've met most of
your need, and the design intent is: don't nag someone for being half an hour short,
but don't call it perfect either._

### Resting HR — weight 15 · input: bpm above your baseline
| Resting HR | Penalty |
|---|---|
| within 4 bpm of baseline | 0 |
| +4 bpm | −8 |
| +7 bpm or more | −15 |

_A raised morning resting HR is a classic sign of incomplete recovery, stress, or a bug
coming on. Within 4 bpm is normal daily variation → neutral. No bonus for a low reading._

### Form (TSB = Fitness − Fatigue) — weight 14 · input: TSB value
| Form | Penalty |
|---|---|
| +12 or fresher | **+4** (bonus) |
| balanced (0) | 0 |
| −10 (some fatigue) | −7 |
| −20 or deeper | −14 |

_Deeply negative Form means accumulated fatigue — often deliberate mid-build, but still
a readiness drag; positive means fresh, as in a taper._

## A worked example

A morning of **HRV 39** (vs a ~60 baseline, ~2.6 sd below → **−26**), **sleep 6.4h**
(**−2**), **resting HR 55** (vs ~51, +4 → **−8**), **Form +36** (fresher than +12 →
**+4**):

> 100 − 26 − 2 − 8 + 4 = **68 → 🟠 Ease into it**

which is why the card offered the one-tap "ease today" downgrade.

## Honest caveats

These thresholds and weights are a **considered heuristic calibrated against real
data**, not derived from peer-reviewed cut-offs — the widely-accepted anchors (7h sleep,
HRV-relative-to-baseline, elevated resting HR) are standard, but the exact point values
are a judgement call. They live as a single data table at the top of `wellness.js`, so
they're easy to read, challenge, and retune. If the score ever feels too twitchy or too
lenient in practice, that table is the one place to adjust.
