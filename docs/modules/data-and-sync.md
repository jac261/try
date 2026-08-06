# Data & sync

How training data gets in, how it is matched to the plan, and how state persists
across devices. Architecture overview in [../ARCHITECTURE.md](../ARCHITECTURE.md).

## Activity ingest (intervals.icu)

intervals.icu is the activity source, reached through the backend proxy. OAuth
setup is documented in [../INTERVALS_OAUTH.md](../INTERVALS_OAUTH.md). Recordings
arrive as activities with per-lap interval rows; the swim CSS test, the bike
power reads, and the durability lap analysis all read those rows.

## Matching (`autolog.js`)

`matchActivities` / `activityFor` attach a recorded activity to the planned
session it satisfies, within a match window (`MATCH_WINDOW`), keyed by
discipline and date. `brickPairFor` handles a brick's two legs. Indoor types
(`INDOOR_TYPES` / `isIndoor`) are recognised so their derived speed/distance can
be suppressed while their duration and power still count. `DISCIPLINE` maps
intervals.icu activity types onto Try's disciplines.

`recordingFor` is the one place that answers "which recording is this
session's": the brick pair folded into one via `brickRecording`, or the single
activity that matches. It takes the RAW FEED, never the display list, and
enforces that itself with a `!a.manual` filter — a hand-typed diary entry must
never become a session's recording, or a typed duration enters the log and the
calibration corpus and plan-relative verdicts get drawn against numbers nobody
measured. `brickRecording` reports a pair as measured only when BOTH legs
carried a load, and estimates the leg that did not.

`ownerFor` answers the reverse, and is not its inverse: it requires the
session to be TICKED. Anything counting work must build its ledger from the
recording side with `ownerFor` (see `calendar-load.js`), because `recordingFor`
has no tick requirement and would let an unticked session and an unclaimed
recording both claim the same ride.

## Load model (`loadmodel.js`)

`deriveLoadRecords` / `deriveActivityLoadRecords` / `withLogLoad` turn logged and
recorded sessions into training-load records for the fitness/fatigue trend.

## Persistence and sync

Per-user localStorage stores (keyed by Clerk user id) hold the plan, log, moves,
adjustments, and the append-only diaries (missed reasons, focus changes,
durability reads, fuel answers, coach decisions, calibration). The backend
(Jack's ASP.NET Core service) is the cross-device source of truth:

- **Plans** POST/PUT as exactly the `generatePlan` output; the profile rides as
  an opaque JSON blob, so new profile fields (mass goal, block focus, the mass
  goal stamp) are safe without a schema change.
- The backend enforces **closed sets** for race types, disciplines, workout
  types, roles, and phases — an unknown string 400s the save and trips the
  sync-failure banner, which is why new workout vocabulary is a backend ask.
- Phase 2 moved the plan-independent profile to its own `/api/me/profile`
  endpoint keyed by identity, so a fresh device recovers the athlete's baselines.

The client tolerates the backend lacking the newest typed fields (they survive
in the blob); the standing asks are tracked in
[../BACKEND_HANDOFF.md](../BACKEND_HANDOFF.md).

## The watch export (`watch.js`)

`buildWatchEvents` / `watchSteps` / `watchDescription` turn upcoming sessions
into structured, step-by-step calendar events (`WATCH_TYPES`, within
`WATCH_WINDOW_DAYS`) for a watch to follow — hill-work steps push open, recovery
steps keep their pace. `ics.js` and `src/features/calendar/` handle the calendar
surface.

## Review (`review.js`)

`reviewActivity` / `intervalRows` grade a completed session against its plan,
per-interval for structured work (the rep table) rather than a whole-session
average, and skip flat-pace grading of hill and indoor segments.

## Key files

`src/lib/api.js`, `src/lib/autolog.js`, `src/lib/loadmodel.js`,
`src/lib/watch.js`, `src/lib/review.js`, `src/lib/ics.js`, `src/app/` (storage,
sync, App), `src/features/calendar/`.
