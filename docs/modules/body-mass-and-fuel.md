# Body mass & fuelling

Weight tracking, body-mass goals, and long-session fuelling capture. All of it
is safety-sensitive and was designed under a safety-led panel; the governing
rules live in the `src/lib/bodymass.js` header and must survive future passes.

## The doctrine (non-negotiable)

- The app **never prescribes intake**.
- With **no declared goal**, weight is tracked and never judged: the Progress
  card is a number and a chart with zero judging words and no signed rate line,
  and it stays byte-identically silent whatever the trend does. That silence is
  the protection for the athlete who chose "No goal" to escape commentary.
- Mass status **never** enters a frozen coach decision, the digest, or a
  notification.
- No goal chooser in onboarding; direction only, never a target weight.
- Banned vocabulary: cut, deficit, calorie, fat, race weight, burn, streaks, and
  any unprompted illness or diagnosis words.

## Body-mass goals

Set behind a closed disclosure in the fitness editor (an athlete who never opens
it never meets weight-goal language). The chooser opens already expanded when a
goal is active, so the "No goal" escape hatch is always one visible tap.

| Goal | Status | Behaviour |
|---|---|---|
| No goal | default | tracked, never judged |
| Gaining on purpose | shipped (pass 3) | weekly rate judged against a gradual gain band (`GAIN_BAND`, a fraction of bodyweight per week), two-week persistence before any off-target wording; a genuine fall during a build names fuelling |
| Holding steady | shipped (pass 6) | weekly rate against staying level (`HOLD_BAND`); "little change" in band, drift states need two weeks, fast unintended loss escalates to an amber warning that points at "someone qualified", never a chart |
| Losing | **deliberately not shipped** | see below |

### Why lose does not ship

The safety panel returned a no-ship verdict with recorded reopening conditions.
The app never prescribes intake, so a lose goal would judge a rate whose only
discoverable lever is restriction, during endurance training, in the population
where RED-S and disordered eating concentrate — and every guardrail that would
make it tolerable (age, height, a defensible minimum-weight floor) is honestly
uncomputable from what Try collects. Reopening requires an **external
ED-informed review of the full copy set**; never reopening is an acceptable end
state. A "no-goal rapid-loss note" was also killed in panel: conditional
commentary to someone who declined commentary is judging by definition.

### The maths

`massTrend` runs a 28-day OLS over weigh-ins (gates: ≥8 points, ≥14-day span),
Monday-anchored weekly evaluations, one displayed-and-judged rate
(`judgedRateKg`) so the pill and figure never disagree. A **settling gate**
(`massGoalSetAt`, stamped only on a real goal change) withholds judgment until a
full window postdates the goal change, so a changed goal is never judged against
the trend the old goal shaped. Rates render in signed grams (`fmtRateGrams`).

## Fuelling capture

On a completed long or brick session with a matched recording, four one-tap fuel
chips (`FUEL_LEVELS`: Nothing / A bit / Solid / Race level, with a carbs-per-hour
caption). Stored keyed by the recording's activity id (survives a data clear),
they annotate the durability rows, and the athlete's own low-fuel answer disarms
the durability progression veto (a fade they already explained is fuelling, not
fitness). Tracker-mode capture is deferred.

## Key files

`src/lib/bodymass.js`, `src/features/progress/ProgressView.jsx`,
`src/features/settings/FitnessEditor.jsx`, `src/features/wellness/WellnessEditor.jsx`.
