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

## Pass 4: block objectives

Blocks are the plan's contiguous phase groups, now shared as one exported
definition (phaseGroups, including the recovery-week relabel) rather than
two drifting reimplementations. Each block wears a focus clause with a
phase-gated verb: building in Base and Build, sharpening in Peak, silent
through Taper and Recovery, because a focus line that claims building
during a taper would be a lie.

The focus is display-and-coach-only, by firm panel verdict. The limiter
machinery keeps actuating exactly as before: a declared focus never feeds
the volume bias or the frequency swap (it would bypass the noise gates the
limiter board exists for), never renames the progression variable when it
diverges from the limiter (that text describes what the plan really does
next), and changing it is a single-field patch that never regenerates the
plan or snapshots fitness history. Where a declared focus disagrees with
the derived limiter, the surfaces say both plainly: your call, and the
plan's own extra work, named side by side.

The block review derives from frozen decisions alone. The boundary fires
when the first decision of a new phase freezes (a phase change between
consecutive stored decisions); the cadence fallback, every fourth reviewed
week where no boundaries exist (maintenance, tracker), is phase-filtered
and capped at the last four weeks. The live plan layout is never consulted
because a settings-edit reshape regenerates every week while keeping the
plan identity; the phase stamped at freeze time is the only trustworthy
record of the block as trained, and the terminal post-race week freezes as
Recovery via the same weekPhaseLabel the display uses. Coverage is Monday
gap math over the stored run, a lower bound stated honestly. The summary
is two sentences and one optional one-tap question: keep the focus, change
it, or not sure. Never the spec's seven-question form. Known residual: a
boundary review lapses with its digest week like everything else in the
digest, so a week the athlete never opens loses that block's review.

Focus changes journal in their own store: the engine journal is scanned by
the decision layer for accepted proposals, and a focus entry there would
be quoted as an engine call.


## Tier 2: solo plans and the degenerate limiter

Standalone run race plans (run5k, run10k, runhalf, runmarathon; `solo: 'run'`
on the RACES entry) generalise the progression contract rather than special
casing it: on a plan that trains exactly one discipline, that discipline is
the limiter outright. decideWeek forces the weakest-link verdict null for
solo plans at its own call site (weakest.js is untouched beyond silencing
the race-share line for zeroed races) so a stale triathlon baseline can
never name an untrained sport, and the progression variable becomes the solo
discipline directly. Eligibility rules (two clean weeks, plan-identity
adjacency, strain resets, hold default) are unchanged. Solo copy drops the
word limiter, which would be a lie with one discipline. The focus feature
collapses: resolveFocus returns the solo discipline with no divergence, the
choosers hide, and the block review keeps its clean tally with zero new
strings. eftp retarget proposals gate by the plan's discipline scope, so a
leftover intervals.icu swim setting proposes nothing on a run plan.

Known residuals, stated rather than hidden: an advanced or elite marathon
long run sits at the 3 hour ceiling from mid-plan, so a progress decision's
'extending the long run' promise has nothing left to extend there (the cap
is the design; recovery weeks still step below it). Race-pace long run
rehearsals follow the seed walk, so their spacing across Build and Peak is
irregular rather than scheduled; a deterministic race-pace calendar is
future work alongside the long-run curve. A reshape preserves plan identity
by design, so a frozen decision from the week before a tri to run switch is
quoted verbatim on the run plan (it is the honest record of that week) and
a clean prior week carries into the progression count across the switch
(run fitness is continuous through the switch; the engine agrees).
