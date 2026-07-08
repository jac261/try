# How the readiness score works

_The logic behind the daily "Ready to roll / Ease into it / Recover today" number.
Implemented in [`src/lib/wellness.js`](../src/lib/wellness.js) and rendered in-app on
the profile page ("How your readiness works")._

## The shape of it

Every morning **starts at 100**. Each signal you have data for **adjusts it** — a
penalty as you drift from a healthy norm (bigger the further out), or a small bonus for
being better than normal. The result is clamped to 0–100 and banded:

| Score | Band | Meaning |
|---|---|---|
| **≥ 75** | 🟢 Ready to roll | recovered, train as planned |
| **55–74** | 🟠 Ease into it | a bit down — keep hard efforts controlled |
| **< 55** | 🔴 Recover today | signals point to rest / very easy |

Two principles run through it:

1. **Everything is relative to _you_.** HRV and resting HR are scored against your own
   **rolling 21-day baseline**, recomputed daily — so "good" and "bad" track your normal,
   and the model self-calibrates as your fitness shifts across a block.
2. **Missing data never punishes you.** A factor only contributes when its value is
   present, so a sparse day can score 100. That's exactly why the intervals.icu sync
   matters: full data, honest score.

## The point values are derived, not hand-picked

The obvious objection to any scoring model is: _why −26 and not −25?_ Here the magnitudes
aren't chosen — they're **computed from three stated decisions**, so "−26" is an output.

**1. The band cut-offs** (green ≥ 75, amber ≥ 55) — the only things with real meaning
(train / ease / recover).

**2. One policy that fixes the total budget:** _it takes two compromised signals to
declare "recover today"._ So the **two most important factors, both at their worst, land
exactly on the red line** — a 45-point drop (100 − 55). No single signal alone reaches
red. That one rule pins how many points are "on the table" in total.

**3. Importance as an ordinal tier** — the only ranking judgement:

| Factor | Importance | Why |
|---|---|---|
| **HRV** | 4 | Most direct read on autonomic recovery, self-calibrating. |
| **Sleep** | 3 | The primary recovery _input_. |
| **Resting HR** | 2 | Corroborates HRV, but noisier/laggier — and penalty-only. |
| **Form (TSB)** | 2 | Chronic training-load _context_, not today's acute state. |

Each factor's **max penalty** is then `(its importance ÷ total) × budget`. With the
"two-signal red" rule, the budget works out to ~71 points, and the weights fall out:

| Factor | Derivation | **Max penalty** |
|---|---|---|
| HRV | 4/11 × 71 | **26** |
| Sleep | 3/11 × 71 | **19** |
| Resting HR | 2/11 × 71 | **13** |
| Form | 2/11 × 71 | **13** |

So **"−26" means "HRV is 4/11 of the importance, and the budget is set so no lone signal
triggers red"** — not a number I liked the look of. Change the importance tiers or the
policy and every weight recomputes. The only remaining judgements are the tiers (4/3/2/2)
and the one behavioural rule — a handful of arguable decisions instead of ~20 magic
numbers. _(The genuinely rigorous next step is to fit even those to data — correlating
each morning's readiness against how that day's session felt via the `feel` log. Not
enough history yet, but the hooks are there.)_

## Within a factor: a smooth ramp over a describable range

Each factor states a **neutral** point (0 penalty) and a **worst** point (full penalty),
and the penalty ramps between them — so there are no cliff edges. Both endpoints are
meaningful quantities you can argue about, unlike a bare "−11".

### HRV — max 26 · neutral: baseline · worst: 2.5 sd below
| HRV vs baseline | Effect |
|---|---|
| ≥ 0.7 sd above | **+4** (bonus) |
| at baseline | 0 |
| 1 sd below | −7 |
| 1.5 sd below | −13 |
| 2.5+ sd below | −26 |

### Sleep — max 19 · neutral: 7h · worst: 4h (convex — debt compounds)
| Sleep | Effect |
|---|---|
| 7h or more | 0 |
| 6h | −3 |
| 5h | −10 |
| 4h or less | −19 |

_The ramp is convex, so the hour lost from 6→5 costs more than 7→6. **6.4h ≈ −1**:
you've met most of your need, so a token nudge, not a flat penalty._

### Resting HR — max 13 · neutral: +2 bpm · worst: +8 bpm
| Resting HR | Effect |
|---|---|
| within 2 bpm of baseline | 0 |
| +4 bpm | −4 |
| +8 bpm or more | −13 |

### Form (TSB) — max 13 · neutral: 0 · worst: −25
| Form | Effect |
|---|---|
| +12 or fresher | **+4** (bonus) |
| balanced | 0 |
| −10 | −5 |
| −25 or deeper | −13 |

## A worked example

A morning of **HRV 39** (~2.6 sd below a ~60 baseline → **−26**), **sleep 6.4h**
(**−1**), **resting HR ~+4** above baseline (**−4**), **Form fresh** (+12 or better →
**+2**):

> 100 − 26 − 1 − 4 + 2 = **71 → 🟠 Ease into it**

## Caveat

The importance tiers and the "two-signal red" policy are still design judgements — but
they are a small, stated, arguable set, and they live as a few named constants at the top
of `wellness.js`, not as scattered magic numbers. Change them in one place and the whole
model re-derives.
