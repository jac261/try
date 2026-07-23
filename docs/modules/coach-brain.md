# Coach brain

The decision layer that reviews each week and says what to do next, in plain
language, with its reasoning shown. Folded into Try from an external
"decision-layer over intervals.icu" spec. The engine is `decideWeek` in
`src/lib/coach.js`; this page is the current-state overview, and
[../COACH_BRAIN.md](../COACH_BRAIN.md) carries the per-pass detail and the
standing rules.

## The weekly decision

`decideWeek` consumes the *returns* of the existing engines (`adapt.js`,
`runload.js`, `weakest.js`, `eftp.js` trends, `wellness.js`, `durability.js`) —
it never re-derives their thresholds. It produces one overall call plus a row
per trained discipline, each an evidence list.

The five honest decisions (`DECISION_LABELS`):

```
Progress · Hold steady · Pull back · Ease the intensity · Recovery
```

**Hold is the default and a valid positive outcome.** Progression is earned, not
assumed: it requires the athlete's limiter (or, on a solo plan, the one
discipline they train) plus two consecutive clean weeks (`REPEAT_WEEKS`), with
the prior week checked for literal calendar adjacency and plan identity so a
clean flag from months ago or another plan can never unlock it.

Decisions **freeze** once per week at the digest boundary and are quoted
verbatim afterwards — the app never recomputes a past call and presents it as
the original. Completion is classified (`classifyCompletion`) from logged data:
a session missed to travel is not a session missed to fatigue, and a one-tap
missed-reason prompt (`MISSED_REASONS`) captures the difference without a
1–10 RPE (Try keeps its 3-point feel by design).

## The six passes

| Pass | What it added |
|---|---|
| 1 — Decision engine | `decideWeek`, the honest five-decision subset, the frozen weekly decision, one-tap missed reasons, per-discipline evidence in Progress |
| 2 — Durability dashboard | Late-session fade reads from long-session laps (see [wellness-and-readiness.md](wellness-and-readiness.md) and durability below), surfaced as evidence |
| 3 — Body mass & fuel | Weight tracking, the gain goal, long-session fuel capture — see [body-mass-and-fuel.md](body-mass-and-fuel.md) |
| 4 — Block objectives | Named phase blocks, a declared focus (display-and-coach-only), the digest block review |
| 5 — Durability veto | A corroborated late fade may delay an earned progression by one week, once, never more (below) |
| 6 — Hold mass goal | The holding-steady body-mass goal; lose deliberately not shipped — see [body-mass-and-fuel.md](body-mass-and-fuel.md) |

## Block objectives (pass 4)

Blocks are the plan's contiguous phase groups, defined once (`phaseGroups` /
`weekPhaseLabel` in `plan.js`) and shared by the Plan tab, the frozen phase
stamp, and the block review. A declared **focus** (swim / bike / run / general,
`FOCUS_OPTIONS` / `resolveFocus` / `focusClause`) labels blocks but never
actuates: the limiter keeps driving progression, and where a declared focus
diverges from the derived limiter the Plan tab says both plainly. On a solo plan
the focus collapses to the one discipline. The **block review** fires in the
digest when a reviewed week closes a block (derived from frozen decisions only,
never the live plan layout, so a settings-edit reshape cannot fabricate
boundaries), or on a four-week cadence where no boundaries exist.

## Durability as a decision input (pass 5)

`durability.js` reads a long session's first vs final third (output, HR drift,
efficiency) and bands it held-strong / faded-a-little / faded-hard. Pass 5 gave
it exactly one decision effect: when a discipline has otherwise fully earned
progression, a **corroborated hard fade** (`fadeCorroborated`: output *and* the
cardiac picture both past the hard band) converts that week to a hold, once per
progression event (the cap is a `durabilityVeto` flag on the frozen decision;
the next clean week progresses regardless). It can never fire on a missing HR
strap or a drift-only heat signature, the athlete's own low-fuel answer disarms
it, and it can only ever slow progression by a week, never stop it or start a
pullback.

## The design pipeline behind every pass

Each pass ran the full loop: a three-lens design panel with adversarial
red-team *before* implementation, build in an isolated worktree, a four-lens
adversarial gauntlet with per-finding verification, fix, a focused re-verify
pass that distrusts its own fixes, then ship. The gauntlet caught real defects
in every pass.

## Key files

`src/lib/coach.js`, `src/lib/digest.js`, `src/lib/durability.js`,
`src/lib/adapt.js`, `src/lib/weakest.js`, `src/features/today/WeeklyDigest.jsx`,
`src/features/progress/ProgressView.jsx`.
