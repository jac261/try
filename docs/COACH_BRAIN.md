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

## Pass 2: durability (shipped alongside this doc's update)

src/lib/durability.js reads a long session's recorded laps and compares its
first and final thirds: output, heart rate, and efficiency where both
signals exist. Every mean is time-weighted (power and heart rate live in
the time domain; distance weighting favours fast easy laps, backwards for a
fatigue read), embedded-stop laps are filtered against the session's median
speed, a window dominated by one lap voids the read, and a planned session
whose own card scripts a late pace change never qualifies: the athlete
following a fast-finish instruction is not fading.

Reads are cached per activity id, device-local, surviving plan changes (a
read is a fact about a past recording). The backfill fetches at most two
recordings per app load, the reviewed week's sessions first, sharing one
memoised intervals fetch with the rep table and auto-CSS.

The Progress card leads with the pattern and hedges the rest: laps cannot
see hills, heat, wind or fuelling, so one read is never a claim. The coach
brain gains a durability EVIDENCE line only; using the read as a decision
input needs its own design panel first.

Excluded on purpose: a brick's run leg (it starts pre-fatigued by design;
reserved for the deferred brick comparison), swim durability (pool laps
confound drift with prescribed rest).

## Pass 3: body mass and fuelling

The safety rule outranks everything: without a declared goal the app
tracks weight and never judges it. No status, no gain or loss language, no
advice, and an athlete who never opens the optional goal disclosure never
meets weight-goal language anywhere. Pass 3 ships exactly one goal, gaining
on purpose; losing and holding each need their own band design and safety
review before they exist.

The weekly rate is a least-squares slope over a 28-day window of every
weigh-in, because the design panel did the arithmetic: scale noise near
half a kilogram per reading cannot resolve a sixty-gram-wide target band
through window-mean differences. Judgments additionally need two
consecutive scoreable Monday-anchored weeks; an unscoreable week resets
the count. The gain band scales with body weight, calibrated to reproduce
the spec's absolute figures at its author's 64 kg; that linearity is a
documented product simplification, not physiology.

Capture: the morning readiness sheet gains an optional weight field, and
the sheet now MERGES onto the day's existing record instead of replacing
it, fixing a live bug where a manual save silently wiped synced fields.
Fuelling is four one-tap chips on done long sessions with a matched
recording, subordinate to the feel chips, keyed by activity id only (the
store spans plans like durability and the calibration diary).

Mass status renders live on its Progress card only: it is never baked into
frozen weekly decisions, so clearing the goal removes every judgment
everywhere at once. Fuel answers annotate durability rows.

Deferred, said plainly: fuel capture for tracker-mode recordings (their
long sessions have durability rows but no plan detail sheet; the capture
surface there is the recap or the manual entry sheet, its own design).

Backend asks: massGoal as a profile field (device-local until then; the
plan's profile JSON round-trips it, so only a fresh-device recovery via
the subset profile loses it), and a fuel field on a future sessions
endpoint.
