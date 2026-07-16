# The no-plan (tracker) workflow

Status: design spec, agreed direction pending Jon's open questions (end of doc).
Written 2026-07-13 after the tracker sentinel shipped and hit the backend
validator. Both ends of the system were built around an active plan existing;
this doc defines what the product IS when there is no plan, and the path from
the shipped workaround to an honest architecture.

## Where we are

Shipped today: tracker mode is a client-side sentinel plan (`race: 'tracker'`,
zero weeks, profile carried, raceDate null). The frontend treats it as
client-first (silent push, keep-local-over-stale on hydrate) because the
backend validator rejects it; backend PR #17 (open) teaches the validator to
accept it. The sentinel exists for exactly one reason: the athlete profile
(name, fitness level, baselines, weight, fitnessHistory, training dials) lives
INSIDE the plan object, and `plan = null` routes to full onboarding, wiping it.

Verified gaps the sentinel does not fix:

- A sensor-less athlete in tracker mode can log nothing (manual sessions are
  plan workouts; the add button is hidden). Dead app.
- The activities feed is fetched live with `days = 10` while the tracker
  calendar browses six months. We store no activity history ourselves.
- Session history (log/moves/adjust) has always been pruned on every plan
  replace; the app has never had cross-plan history. Tracker exposed this.
- The engine learns nothing from the tracker period: the next plan starts with
  a cold run-load baseline and stale baselines go unchallenged.
- The Today banner copy ("I am logging every session I spot") is false for a
  sensor-less user — an honest-data violation.
- Watch-sync landmine: the planned-events push effect gates on `plan` truthy.
  The truthy sentinel pushes an empty window (clears the watch — correct, if
  accidental); a future `plan = null` model never runs the effect, so ending a
  plan must explicitly push one final empty window or the watch keeps showing
  workouts from a dead plan.

## Who is between plans, and what they need

Every athlete, between every pair of plans — potentially a third of the year.
Personas: post-race break (1–3 weeks), injured (2–12 weeks, partial training),
off-season (1–4 months, real unstructured volume), undecided between races
(indefinite), lapsed (opens monthly; must never be greeted by a lie or an
onboarding wipe).

### Sensor-connected journey (intervals.icu linked — both current users)

- Enter: end plan deliberately (confirm dialog). Overlays wipe — correct,
  they are plan annotations.
- Daily: readiness card from synced wellness (works); yesterday's recording on
  Today and the calendar day; tap into the ad-hoc recap deck (works — this is
  tracker's best feature today).
- Weekly: fitness trend; weight rides in via wellness sync (works).
- Monthly: retest (a parkrun IS a 5k test) and record it via a tracker-safe
  fitness update that snapshots into fitnessHistory WITHOUT generating a plan.
  Currently impossible — Update fitness is hidden in tracker Settings because
  it calls generatePlan. Must be built: this is the benchmark window.
- Ongoing: calendar shows the full browsed window (fetch depth must match).
- Exit: start next plan prefilled from profile; the engine receives a load
  seed computed from the last ~4–6 weeks of detected training so the run-ramp
  guardrail is live from day one; a staleness nudge fires if baselines predate
  the break.

### Sensor-less journey (target state; today: dead app)

- Daily: quick-log a done session (discipline, duration, optional distance /
  RPE / notes, defaults to today) landing on Today, the calendar day, and
  weekly volume.
- Wellness: manual editor gains a weight field.
- Everything else matches the connected journey minus recordings.
- Until this exists, no surface may imply logging is possible.

### Per tab in tracker mode

- Today: readiness card; recorded (and later manually logged) sessions; one
  quiet start-your-next-plan card (shipped); later a log-a-session action.
  Banner copy must be honest per connection state. Connected: "You are in
  tracker mode. Sessions from your watch show below and on your calendar."
  Sensor-less: must not mention spotting.
- Calendar: a true diary — recorded plus manual sessions across the whole
  browsable window; empty-day copy states real capability.
- Plan: shipped version is right — honest no-plan state, start a plan, start
  a maintenance block.
- Progress: wellness trends and fitness progression (work); the progression
  becomes writable via the tracker-safe fitness update; later weekly volume
  and discipline mix computed from activities plus manual log, never from
  plan.weeks; weakest-link stays hidden (it keys on the retained raceType).
- Settings: restore Update fitness via the tracker-safe path; watch sync
  correctly moot.

### What carries into the next plan

Carries already: profile, baselines, fitnessHistory, dials. To add: a
run-load baseline seed from tracker-period weekly minutes per discipline
(computed client-side from feed + manual log at plan-generation time — the
engine-relevant unit is weekly minutes, not per-session fidelity); benchmark
updates recorded mid-tracker; a fitnessHistory snapshot at tracker exit; a
soft staleness check at plan creation. Never carries: workout logs keyed to
dead GUIDs (correctly pruned; do not bend them into durable history).

## Target data model

The athlete profile becomes a first-class user-level resource; plans become
optional attachments; the sentinel is a transitional wire format, not the
contract.

- Profile lives on `/api/me` as a sub-resource, mirroring the existing
  UserPreferencesService GetOrCreate/PUT pattern (the cheapest new resource
  for Jack): one migration (`user_profiles`: user_id unique, profile_json
  jsonb, updated_at_utc), MeResponse gains a Profile field, new
  `PUT /api/me/profile`. Contents: name, fitness, fivekSec, css100Sec, ftp,
  weightKg, trainingDays, longDay, fitnessHistory.
- Plans embed a profile snapshot at creation for reproducibility; the live
  profile is the source of truth between plans.
- Frontend: `plan === null` means tracker mode; `profile === null` means
  onboarding. This deletes the reason the sentinel exists.
- Durable session history in three tiers: (1) now, live-fetch with a days
  window matching the browsed calendar (backend already caps at 365; zero
  backend work); (2) next, a plan-independent `/api/sessions` resource
  `{date, discipline, durationMin, distance?, rpe?, notes?, source:
  manual|detected|file, externalId?}` for manual logs and athlete-confirmed
  detected sessions — one resource fixing sensor-less logging, diary depth,
  first cross-plan history, and next-plan seeding; store what the athlete
  logs or confirms, do not mirror the whole intervals feed; (3) later, wire
  the orphaned `/api/activity-files` store (full CRUD deployed, zero call
  sites) in as the FIT ingest path feeding sessions.
- Workout log/move/adjust stay plan annotations, pruned on replace, as now.

## Endpoint disposition in the no-plan state (verified against controllers)

| Endpoint | Disposition |
|---|---|
| POST /api/plans | Works. Under the sentinel its 409-on-active guard is permanently subverted (client falls back to PUT); under the target model it is the natural restart verb again. |
| GET /api/plans/current | Works; post-PR-17 returns the sentinel. Target model: 404 honestly means no plan. |
| PUT /api/plans/current | Works; how the sentinel syncs post-merge; moot in true no-plan. |
| PATCH /api/plans/{id} | 501 stub, unchanged. |
| DELETE /api/plans/{id} | 501 stub today. The ONE new verb needed: implement as end/archive (status ended, soft-delete graph via existing SoftDeletePlanGraphAsync); GET current 404s after. The state transition the API currently lacks entirely. |
| /api/workouts/{guid} log / move / adjustment | Moot with no plan — correctly. Never bend into durable history. |
| /api/wellness (all + sync) | Works unchanged. Tracker's backbone; weight already flows. |
| intervals-icu GET activities | Works; needs only a larger client `days`. |
| intervals-icu activities/{id}/intervals | Works; arguably more important in tracker. |
| intervals-icu thresholds | Works; later feeds the fitness-update flow instead of a plan retarget. |
| intervals-icu PUT planned-events | Moot with no plan, but see the watch landmine above: ending a plan must push one final empty window. |
| intervals-icu PUT / DELETE integration | Works. |
| /api/activity-files (all) | Works, plan-independent, orphaned. Future FIT ingest; no change now. |
| /api/me GET | Needs the Profile field. |
| /api/me PUT preferences | Works; new sibling PUT /api/me/profile. |
| /api/me DELETE data | Stub, unchanged. |
| /api/export | 501 stub. When built: profile, plans, wellness, sessions; must not fabricate a plan. |
| /api/sessions | New, later (Phase 3). |

## PR #17 verdict: merge now, as a declared bridge

Not permanent, not withdrawn. Reasoning (forwardable to Jack):

1. The unmerged state has a real failure mode beyond one device: the server
   still holds the dead pre-tracker plan, so any second device, reinstall, or
   cleared cache hydrates the dead plan back — stale race countdown and, with
   watch sync on, dead workouts re-pushed to the watch. Merging makes the
   server agree with reality within one page load.
2. The merge is nearly free and the unwind is bounded: 36 source lines plus
   76 test lines; unwinding means reverting the carve-out and migrating on
   the order of two users' sentinel rows. The tests document the exact
   no-plan payloads the profile migration must honour.
3. Withdrawing does not buy the better model faster; it leaves tracker state
   unpersisted anywhere until two new backend PRs plus a frontend migration
   all land. Riskiest path for near-zero savings.
4. Conditions riding with the merge: (a) a PR comment stating tracker is a
   transitional race type slated for removal once the profile resource lands;
   (b) no new feature may branch on race='tracker' server-side. The PR's own
   zero-weeks validation already forbids the contract growing.
5. The proof of temporariness is scheduled: after the frontend migrates,
   'tracker' is removed from RaceTypes and the carve-out reverted, gated on a
   check that no tracker rows remain in the DB.

## Phased plan

Phase 0 — this week (Jack ~0.5 day, Jon ~1–2 days). MUST, in order:
1. Merge and deploy PR #17 with the transitional note (Jack).
2. Fix the Today banner lie with honest copy per connection state (Jon).
3. Make the calendar window and fetch depth agree (Jon).
4. Tracker-safe fitness update: snapshot old baselines into fitnessHistory
   and update values without generatePlan (Jon).
5. Truthful empty states everywhere in tracker (Jon).

Phase 1 — after this spec is agreed (Jack ~2–2.5 days, two small PRs):
6. PR A: user_profiles migration, Profile on MeResponse, PUT /api/me/profile.
7. PR B: implement DELETE /api/plans/{id} as end/archive; GET current 404s
   after. Independent of PR A.

Phase 2 — frontend migration (Jon ~2–3 days):
8. Standalone profile store hydrated from /api/me; onboarding routes on
   profile-null; FitnessEditor writes profile (and plan mirror while a plan
   exists).
9. enterTracker becomes: snapshot profile up, push one final empty
   planned-events window, DELETE current plan, set plan null locally.
10. One-time idempotent sentinel migration on hydrate (PUT profile, drop the
    plan; PUT idempotent, repeat-DELETE 404 tolerated). Then delete
    buildTrackerPlan, the hydrate special case, and flip the six
    race==='tracker' predicates to plan===null.

Phase 3 — the sessions layer (both). LATER, first in the queue, and a MUST
before any sensor-less user is real:
11. /api/sessions (Jack ~1 day) + manual quick-log UI (Jon 1–2 days); persist
    athlete-confirmed detected sessions; Progress volume/mix cards from
    sessions plus feed.
12. Next-plan seeding: client computes trailing ~4–6 week weekly minutes per
    discipline from feed + sessions and passes it into the plan request;
    fitnessHistory snapshot at tracker exit; stale-baseline nudge.

Phase 4 — cleanup and polish. LATER:
13. Remove 'tracker' from RaceTypes; revert the PR #17 carve-out after a DB
    check shows no tracker rows (the proof the bridge was a bridge).
14. Weight on the manual wellness editor; thresholds surfaced as a
    fitness-update suggestion; activity-files FIT ingest into sessions;
    /api/export; optional plan history (needs replace-semantics rework);
    updatedAt concurrency guard on profile.

## Decisions (Jon, 2026-07-16)

The six open questions are settled; only Q7 remains, and it is Jack's.

1. **Sensor-less athlete: placeholder for now.** Manual session logging
   stays in Phase 3, built when a real sensor-less user exists or Jon wants
   quick-logging himself.
2. **Next-plan seeding: seed from tracker-period training, equal weight.**
   The engine treats tracked training as real training regardless of how it
   was recorded; a manual quick-log counts the same as a detected activity.
   Fixes the /api/sessions field set: no per-source confidence field needed.
3. **Mid-tracker benchmarks update baselines immediately** through the
   tracker-safe fitness update. No proposal queue; the profile stays current
   and the next plan is built from it.
4. **Plan-creation profile snapshots are immutable.** A plan records the
   fitness it was built from and never rewrites history; mid-plan retargets
   append a new fitnessHistory entry. The live profile is the between-plans
   source of truth.
5. **No plan history yet.** Replace keeps reusing the row; the weekly digest
   and fitness history carry the training story. Revisit only if the lack is
   actually felt (then it joins the Phase 4 list, where it already sits as
   optional).
6. **Lapsed return: a light welcome-back.** One quiet, dismissible card
   naming what the feed saw during the gap (sessions landed, fitness drift)
   and offering the next step. Never guilt-toned, shown once per return.

7. (For Jack, still open) Profile as /api/me/profile (recommended) vs a
   standalone /api/profile; and profile_json on user_preferences vs a new
   user_profiles table. Either satisfies the model.
