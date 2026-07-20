# The Coach Brain (pass 1)

Try's adoption of the progression spec (docs/PROGRESSION_SPEC.md), folded
into the existing app rather than built beside it (Jon, 20 July 2026). This
document records what pass 1 ships, what was deliberately narrowed, and why.

## What ships

- **src/lib/coach.js**: one pure function, `decideWeek`, turning a reviewed
  week into an overall decision plus per-discipline lines, each with
  plain-language evidence and a rule version. Completion classification is
  derived from stored data plus the athlete's own one-tap missed-session
  answers; wellness never infers a reason.
- **The one-tap prompt**: a past session that did not happen shows four
  chips in its detail sheet (run down / life / niggle / on purpose). The
  answer is optional, stored per workout id, device-local.
- **The decision card** in the weekly digest quotes the FROZEN decision for
  the reviewed week: it is written once, at the digest's own boundary, by
  the first render that sees the week closed. A device with no stored
  decision shows no card; nothing is ever recomputed and presented as the
  original call.
- **The week-so-far rows** in Progress (inside the weakest-link card) show
  the open week live, labelled as in progress.

## The honest subset

The spec's seven decisions narrowed to five: `progress`, `hold`,
`reduce-volume`, `ease-intensity`, `recover`. REST is indistinguishable from
recover with no full-stand-down actuator; RESTRICT_DISCIPLINE has no
mid-plan injured-state flow to point at (the injury toggle is a future pass;
until then a repeated niggle answer feeds recovery copy and a
professional-opinion nudge, never an in-app restriction claim).

Discipline-scoped reductions exist only for the run, the one discipline with
its own mechanical strain signal. Aggregate ramp and form findings speak
only through the overall decision.

Tracker mode is honestly narrower: readiness-band recovery, the run diary's
own ramp read, and the limiter-named progression. No completion
classification and no per-discipline claims without a plan.

## Design rules that must survive future passes

1. coach.js consumes the adaptive engine's RETURNS (proposeWeek and
   friends), never its thresholds. That is what makes it structurally unable
   to contradict the engine cards that share its signals.
2. Hold is the default and a good outcome. Insufficient evidence is never
   progression. The repeat rule (REPEAT_WEEKS clean weeks for the limiter)
   is the only new threshold, documented in code.
3. The decision store is device-local (like the adjust journal). If a synced
   decision journal is ever wanted, it is a backend ask, not a silent
   assumption.
4. Missed reasons live in their own store, keyed by workout id. Never in the
   log (a bare log entry means done all over the codebase), never in the
   daily feels map (keyed by date for the morning check-in).

## Deferred, by name

Durability dashboard (needs stream and split data from the backend),
body-mass and fuelling domain, block objects and templates, a 1 to 10 RPE
scale (Try's three-point feel is a deliberate contract), calendar
write-back, illness detection (Try cannot distinguish a cold from
overreaching in the data and must not pretend to).
