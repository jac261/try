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
| G5 | At most **one** engine proposal per horizon at a time — one same-day (Phase 1, on the readiness card) and one week-level (Phase 2, as a banner). Within a horizon, the most urgent rule wins. |

## Phase 1 — readiness-driven days *(shipped)*

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

## Phase 2 — ramp guardrail *(this release)*

Chronic, week-level. Signal: the ramp-rate chart (weekly CTL change; zones per
`RAMP_ZONES`). Named thresholds: `RAMP_RULES` in `src/lib/adapt.js`.

| # | Condition | Proposal |
|---|---|---|
| R1 | Ramp > **+5/wk** (Aggressive) averaged across **2 consecutive weeks** | Trim next week's volume to **80%** (`trimWorkout`: same session type rebuilt shorter, key flag preserved) |
| R2 | Ramp > **+8/wk** (Risky) averaged across the trailing week | Trim next week to **70%** + take the biggest quality session easy |
| R3 | Ramp **negative during a Base/Build week** with ≥ 2 missed sessions | The catch-up redistribution (existing `catchUpMoves`) framed as "your build has stalled" |

Mechanics: `proposeWeek` renders as a banner on the Today tab; R2 outranks R1.
A week's ramp is the mean of its daily ramp readings, and a window with fewer
than 3 readings — or fitness data older than 3 days — never triggers (missing
data stays quiet, same principle as the readiness model). Recovery, Taper and
race weeks are never trimmed: their relief is already scheduled. Accepted trims
land in the same synced adjustment overlay as eased sessions (`kind: "trim"`),
so undo, calendar and cross-device sync all behave identically.

## Phase 3 — form-aware blocks *(this release)*

Block-level. Signal: the Form chart (TSB zones per `FORM_ZONES`). Named
thresholds: `FORM_RULES` in `src/lib/adapt.js`.

| # | Condition | Proposal |
|---|---|---|
| F1 | Form in **High risk** (< −30) for **3+ consecutive days** | Convert next week to a recovery week: volume to **60%**, every quality session taken easy ("pull the recovery week forward", through the same adjustment overlay) |
| F2 | Form stuck in the **Grey zone** for a full week (7 readings, never below −10) during Base/Build, with nothing missed | Load isn't sufficient to drive adaptation → **boost** next week's volume +10% (`boostWorkout`, `kind: "boost"`) |
| F3 | Form in **Transition** (> +25) mid-Base/Build | Fitness is leaking → restore any engine-adjusted upcoming sessions; with nothing to restore, surface the missed volume (catch-up) |

The weekly banner shows ONE structural proposal, most urgent first:
**F1 > R2 > R1 > F3 > F2 > R3**. F2 requires a clean week (no missed sessions) —
grey form caused by skipped training needs the catch-up, not a bigger plan.
The same guardrails as Phase 2 apply: fresh data only, recovery/taper/race
weeks untouched, no re-proposing an adjusted week.

## Phase 4 — race-day form targeting *(this release)*

Race-level. Project TSB forward from the remaining planned sessions and steer the
taper so the athlete **arrives in Fresh (+5…+25)** on race morning. Named
thresholds: `RACE_RULES` in `src/lib/adapt.js`.

Projection (`projectRaceForm`): standard impulse-response — `CTL' = CTL +
(TSS − CTL)/42`, `ATL' = ATL + (TSS − ATL)/7` — walked day by day from the last
fitness reading to the day before the race, feeding it each planned session on
its effective date with the adjustment overlay applied. Session TSS is estimated
as `hours × IF² × 100` from a per-type intensity-factor table (`TYPE_IF`) —
estimates, but the projection needs the shape of the taper, not watt-accurate
numbers.

Steering (`proposeRace`), active only inside the final **14 days**:

| Condition | Proposal |
|---|---|
| Projected race-morning TSB **< +5** (arriving heavy) | **Trim** sessions to 60%, closest to the race first — volume down, intensity kept (standard taper practice) — adding one at a time and re-projecting until the window is reached (or every candidate is used: best effort) |
| Projected race-morning TSB **> +25** (arriving flat) | **Boost** sessions 15%, earliest first — extra volume where it costs the least freshness |

The race proposal takes the single structural-banner slot ahead of the week
rules (inside the final fortnight the taper is the thing that matters); tests
and the race itself are never candidates, and stale fitness data stays quiet.

## The workout library

Every session type carries several classic formats of the same intensity
character (a threshold run is 9-minute reps one week, 5-minute cruise reps the
next, two 12-minute blocks the week after). Selection is deterministic: the
plan week index seeds the rotation, recovery weeks pin the canonical (gentlest)
format, and each workout stores its seed so the engine's rebuilds (ease, trim,
boost) reshape a session without changing its format. There is no randomness:
the same profile always generates the identical plan.

This is what gives the engine room to move. Trims and boosts land on a format
that scales its rep count with duration; eases swap to the discipline's easy
type in the same week's format; and the athlete never sees the same quality
session twice in a row.

The intensity ladders span five rungs per sport (run: Easy, Fartlek, Tempo,
Threshold, VO2; bike: Endurance, Tempo, Sweet Spot, Threshold, VO2; swim:
Technique, Endurance, CSS, Race Pace). Each phase anchors onto the ladder
(Base at the easy end, Build mid, Peak race-specific) and the athlete's level
shifts around the anchor, so beginners get structured play like fartlek before
hard reps and elites top out at VO2 in every sport. Bricks rotate through
single-transition, race-simulation and double-transition formats, with
recovery weeks always pinned to the gentlest shape.

## Sync contract (backend, for Jack)

Accepted day-adaptations become synced state, exactly like logs and moves:

- `PUT /api/workouts/{workoutId}/adjustment` — body `{ kind: "ease" | "trim" | "boost", easedFrom?: "<original type>", factor?: <number, trim/boost only>, at: "<ISO timestamp>" }`, upsert, one active adjustment per workout per user.
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
