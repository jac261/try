# The adaptive engine

_How the readiness score and the PMC charts change the training plan. The charts are
sensors; this is the rulebook that turns their numbers into session changes._

Same epistemic discipline as [`READINESS_MODEL.md`](READINESS_MODEL.md): **every rule
has a stated threshold you can argue with**, every adaptation carries its *why*, and
the calibration dataset (readiness-vs-feel observations, collecting since day one)
eventually validates or retunes the rules.

## Principles

1. **Propose, don't silently rewrite.** The machine suggests, with a reason; one tap
   accepts; undo is always available. An athlete who finds their plan quietly changed
   stops trusting the plan.
2. **Documented rules, no magic.** Thresholds live in this file and as named
   constants in `src/lib/adapt.js` — one place to read, challenge, retune.
3. **Guardrails in the engine, not in the UI.** Some sessions are never touched (see
   below), regardless of what the sensors say.
4. **Adaptations sync.** An accepted adaptation is training state, like a log or a
   move — phone and laptop must agree on what today's session is.

## Guardrails (apply to every phase)

| # | Rule |
|---|---|
| G1 | **Race day is immutable.** No adaptation ever touches it. |
| G2 | **Fitness tests are never auto-adapted** — they recalibrate the paces everything else depends on. If readiness is red on a test day, the proposal is to *move* the test, not soften it. |
| G3 | A session already adapted today is not re-proposed (no stacking). |
| G4 | Completed sessions are history, never adapted. |
| G5 | At most **one** engine proposal is shown at a time — the most urgent. |

## Phase 1 — readiness-driven days *(this release)*

Acute, same-day adaptation from the readiness band. The signal: this morning's
score/band (HRV, sleep, resting HR, form — see `READINESS_MODEL.md`).

| # | Condition | Proposal | Why it's right |
|---|---|---|---|
| D1 | **Red** (score < 55) + any hard session today (Tempo / Threshold / VO2 / Sweet Spot / CSS / Race Pace) | Swap to easy aerobic at **65% volume** (floor 25 min) | Hard work on a suppressed nervous system digs the hole deeper and raises illness/injury odds; short easy work aids recovery more than rest for most athletes |
| D2 | **Amber** (55–74) + hard session | Same swap, softer framing — or ride the planned session with controlled effort (athlete's call; both options shown) | Amber is ambiguous by design; the athlete holds the tiebreak |
| D3 | **Green** (≥ 75) + a session eased *earlier today* and not yet completed | Propose **restoring** the original hard session | The morning read improved (e.g. re-synced data); don't leave training on the table |
| D4 | **Red** + today is a **test** | Propose moving the test to the next quality slot (G2 — never soften a test) | A red-day test produces false-low baselines that mis-calibrate every pace |

Mechanics: the swap is `easeWorkout` (same discipline, easy type, 65% volume, keeps
the workout id so logs/moves/sync still apply). The proposal renders on the readiness
card with the score and the driving signals as its reason.

## Phase 2 — ramp guardrail *(next)*

Chronic, week-level. Signal: the ramp-rate chart (weekly CTL change; zones per
`RAMP_ZONES`).

| # | Condition | Proposal |
|---|---|---|
| R1 | Ramp > **+5/wk** (Aggressive) for **2 consecutive weeks** | Trim next week's total volume **20%** (long sessions first, key flag preserved) |
| R2 | Ramp > **+8/wk** (Risky) for **1 week** | Trim next week **30%** + convert one quality session to easy |
| R3 | Ramp **negative during a Base/Build week** with ≥ 2 missed sessions | Offer the catch-up redistribution (existing `catchUpMoves`) framed as "your build has stalled" |

## Phase 3 — form-aware blocks

Block-level. Signal: the Form chart (TSB zones per `FORM_ZONES`).

| # | Condition | Proposal |
|---|---|---|
| F1 | Form in **High risk** (< −30) for **3+ consecutive days** | Pull the next recovery week forward to start now |
| F2 | Form stuck in **Grey zone** across a full Build week (never below −10) | Load isn't sufficient to drive adaptation → nudge next week's volume **+10%** |
| F3 | Form in **Transition** (> +25) mid-Base/Build | Fitness is leaking → propose restoring full sessions / flag missed volume |

## Phase 4 — race-day form targeting

Race-level. Project TSB forward from the remaining planned sessions and steer the
taper so the athlete **arrives in Fresh (+5…+25)** on race day.

Projection: standard impulse-response — `CTL' = CTL + (TSS − CTL)/42`,
`ATL' = ATL + (TSS − ATL)/7`, per planned day (session TSS estimated from duration ×
intensity factor of its zone). If projected race-day TSB falls outside **+5…+25**,
propose lengthening/shortening the taper by whole days until it lands.

## Sync contract (backend, for Jack)

Accepted day-adaptations become synced state, exactly like logs and moves:

- `PUT /api/workouts/{workoutId}/adjustment` — body `{ kind: "ease", easedFrom: "<original type>", at: "<ISO timestamp>" }`, upsert, one active adjustment per workout per user.
- `DELETE /api/workouts/{workoutId}/adjustment` — restore (hard delete; an adjustment is a decision, not a record — 204 / repeat 404).
- Returned inside `PlanResponse` per workout (like `log`/`move`), so hydrate rebuilds the eased state on any device.

The frontend ships **dormant-ready** (same pattern as wellness/integrations): it
pushes adjustments and falls back gracefully to local-only until the endpoint exists.

## Validation loop

Every completed session already records a calibration observation (readiness inputs +
band + `eased` flag + feel). Once enough accrue, the questions become answerable:
*did eased sessions on red days feel better? did un-eased amber days go badly?* — and
the thresholds above graduate from stated policy to fitted values, exactly as planned
for the readiness weights.
