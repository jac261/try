# Try — Backend Handoff (for Jack)

Hi Jack 👋 — this is the contract between the **Try** frontend (a static, client-side
Vite + React app on GitHub Pages) and the backend you're building. It explains what the
frontend **can't** do, the **one thing** it needs from you first (an intervals.icu proxy),
and the exact **JSON shape** to return so it drops straight in.

- App (live): https://jac261.github.io/try/ · Repo: https://github.com/jac261/try
- Bigger-picture roadmap: [try-backend-ideas.md](try-backend-ideas.md) — this doc is the concrete, do-this-first slice.

---

## TL;DR

The app already computes **daily readiness** (HRV / sleep / resting-HR / Form → a go-ease-recover
call) — that engine is **client-side and done**. What it can't do is *fetch the data*, because
the browser can't safely hold an API key or call intervals.icu directly (CORS).

**What I need from you:** a small server that holds the intervals.icu API key and exposes
**one endpoint** returning the last N days of wellness as JSON, with CORS open to the app origin.
That's Phase 2. Everything else (Strava, accounts, push) is later.

---

## Why the frontend can't do this itself

Try is a **static client-side app** — no server, the JS ships to the browser, and the repo is
**public**. So it structurally cannot:

| Can't | Why |
|---|---|
| **Hold the intervals.icu API key** | Anything in the client is visible (public repo + viewable JS). A key in the frontend is a leaked key. |
| **Call `intervals.icu/api/v1/...` from the browser** | intervals.icu doesn't send CORS headers for third-party origins, so `fetch()` from `jac261.github.io` is blocked by the browser. |
| **Run scheduled / background work** | No server process → no nightly pull, no webhook receiver (needed later for Strava push). |
| **Do OAuth that needs a client secret** | Strava/Garmin OAuth token exchange requires a server-side secret (later phases). |
| **Store data server-side / sync across devices** | State is `localStorage` only — single device, no shared store. |

The backend's job is to own exactly these things.

---

## What I need you to build (Phase 2: intervals.icu proxy)

A tiny service that:

1. **Holds the intervals.icu API key** as a server secret (env var) — never sent to the client.
2. **Fetches wellness** from intervals.icu for the configured athlete.
3. **Maps it** to the app's record shape (below) and returns it as JSON.
4. **Sets CORS** to allow the app origin so the browser can call it.

The frontend will call your endpoint, take the array you return, and store it as-is. **You do not
need to compute readiness** — the app does that from these records.

### The endpoint (proposed)

```
GET  {BACKEND}/wellness?days=30
→ 200 application/json
{
  "records": [ WellnessRecord, ... ],   // oldest → newest
  "athlete": { "ftpRide": 196, "ftpRun": 362 }  // optional, nice-to-have
}
```

### `WellnessRecord` — the exact shape the app expects

This is the contract. Field names and units matter — the app reads these verbatim
(see `src/wellness.js`, localStorage key `try.wellness`).

```jsonc
{
  "date":       "2026-06-29",  // ISO yyyy-MM-dd (intervals.icu calls this `id`)
  "hrv":        51,            // ms, overnight HRV (nullable)
  "rhr":        51,            // resting HR, bpm (nullable)
  "sleepH":     6.27,          // sleep HOURS as a decimal (intervals gives seconds — divide by 3600)
  "sleepScore": 71,            // 0–100 (nullable)
  "ctl":        60.0,          // Fitness
  "atl":        33.9,          // Fatigue
  "tsb":        26.1           // Form = ctl − atl  (compute it; intervals doesn't always send it)
}
```

Rules:
- One record per day, **sorted oldest → newest**.
- Use `null` for any missing metric (don't omit the key, don't send `0`). The engine skips null factors.
- `tsb` = `ctl - atl`. Please compute and send it.

### intervals.icu API specifics (what I confirmed)

- **Base:** `https://intervals.icu/api/v1`
- **Auth:** HTTP **Basic**, username = the literal string `API_KEY`, password = the athlete's API key.
  `Authorization: Basic base64("API_KEY:" + KEY)`
- **Athlete id:** like `i123456` (Jon will give you his + a key from intervals.icu → Settings → Developer).
- **Wellness:** `GET /api/v1/athlete/{athleteId}/wellness?oldest={yyyy-MM-dd}&newest={yyyy-MM-dd}`
  → array of daily objects. Field names you'll map from (these are the raw intervals.icu names):

  | intervals.icu | → app field | note |
  |---|---|---|
  | `id` | `date` | the date string |
  | `hrv` | `hrv` | |
  | `restingHR` | `rhr` | |
  | `sleepSecs` | `sleepH` | **÷ 3600** |
  | `sleepScore` | `sleepScore` | |
  | `ctl` | `ctl` | Fitness |
  | `atl` | `atl` | Fatigue |
  | (none) | `tsb` | compute `ctl - atl` |

  Everything CTL/ATL/Form-related is already in the wellness records, so you can serve the whole
  feature from this **one** endpoint — no separate "fitness trend" call needed.

> Please double-check paths/fields against the live API docs (intervals.icu → API, or the forum)
> before locking it in — I pulled these from real responses but the docs are authoritative.

### CORS (required, or the browser blocks it)

Respond to the app origin and handle the preflight:

```
Access-Control-Allow-Origin: https://jac261.github.io
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: authorization, content-type
```

(For local dev I run the app at `http://localhost:5173` and `http://localhost:8733` — happy to use
an allowlist or a `*` in a dev build, your call.)

### Security

- **API key stays server-side** (env/secret). Never returned to the client.
- **Lock the endpoint down** — it serves personal health data. Options, easiest → strongest:
  1. Cloudflare Access / an allowlist in front of the Worker, **or**
  2. a shared bearer token the app sends — but note the app is public, so a token shipped in the
     client isn't truly secret; treat it as obscurity, not auth, **or**
  3. real user auth (this is the bigger "accounts" item — see roadmap). For a single-user personal
     tool, (1) is a good pragmatic middle ground.
  Your call — flag what you pick so I wire the frontend to match.
- Don't log HRV/sleep/HR payloads.

### Hosting (your call — suggestions)

- **Cloudflare Workers** — great fit (free tier, secrets, fast, trivial CORS). Starter below.
- **Vercel / Netlify functions** or a tiny **Fly.io / Render** Node service — all fine.

---

## Starter — Cloudflare Worker (illustrative, ~30 lines)

```js
// env: INTERVALS_KEY (secret), ATHLETE_ID (e.g. "i123456")
const ORIGIN = "https://jac261.github.io";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(req.url);
    if (!url.pathname.endsWith("/wellness")) return new Response("Not found", { status: 404, headers: cors });

    const days = Math.min(Number(url.searchParams.get("days")) || 30, 120);
    const newest = new Date(); const oldest = new Date(Date.now() - days * 864e5);
    const iso = d => d.toISOString().slice(0, 10);

    const auth = "Basic " + btoa("API_KEY:" + env.INTERVALS_KEY);
    const r = await fetch(
      `https://intervals.icu/api/v1/athlete/${env.ATHLETE_ID}/wellness` +
      `?oldest=${iso(oldest)}&newest=${iso(newest)}`,
      { headers: { Authorization: auth } }
    );
    if (!r.ok) return new Response("Upstream " + r.status, { status: 502, headers: cors });

    const raw = await r.json();
    const records = raw.map(w => ({
      date: w.id,
      hrv: w.hrv ?? null,
      rhr: w.restingHR ?? null,
      sleepH: w.sleepSecs != null ? +(w.sleepSecs / 3600).toFixed(2) : null,
      sleepScore: w.sleepScore ?? null,
      ctl: w.ctl ?? null,
      atl: w.atl ?? null,
      tsb: (w.ctl != null && w.atl != null) ? +(w.ctl - w.atl).toFixed(1) : null,
    })).sort((a, b) => (a.date < b.date ? -1 : 1));

    return new Response(JSON.stringify({ records }), {
      headers: { ...cors, "content-type": "application/json", "cache-control": "max-age=900" },
    });
  },
};
```

---

## What I'll do on the frontend once your endpoint is live

Small and contained — you don't need to touch the React app:

1. Add a sync that calls `GET {BACKEND}/wellness?days=30`, then `TF.wellness.save(records)` (already exists in `src/wellness.js`).
2. Replace/keep the manual-entry sheet (it stays as a fallback).
3. Trigger sync on load + a "Sync now" button; the readiness card already renders whatever's in the store.

**One handshake I need from you:** the **base URL** of the deployed backend. I'll put it in a Vite
env var (`VITE_BACKEND_URL`) so it's configurable per environment — just send me the URL when it's up.

---

## Later phases (not now — for context)

From the [roadmap](try-backend-ideas.md), once the proxy pattern works:
- **Accounts / auth + token storage** (the real fix for "lock down the endpoint" and multi-device).
- **Strava / Garmin**: OAuth (needs your server secret) + a **webhook receiver** to auto-complete sessions — both things only the backend can host.
- **Scheduled jobs**: nightly wellness pull + recompute; **push notifications** (morning readiness).

---

## Open questions for you

1. Hosting choice (Workers / Vercel / other)?
2. How do you want to protect the endpoint (Cloudflare Access / token / full auth)?
3. Are you comfortable starting with intervals.icu only (recommended), or do you want to scaffold accounts first?
4. Send me the **backend base URL** + the **auth scheme** you pick, and I'll wire the frontend.

Thanks! Ping Jon (or drop it in the repo) with questions. — the Try frontend

---

## Asks — 18 July 2026 (additive fields on endpoints you already built)

These are all **additive fields on live endpoints**, not new integrations. The
intervals.icu passthrough already works and the frontend consumes it today:
`GET /api/integrations/intervals-icu/activities`,
`.../activities/{id}/intervals`, `.../thresholds`.

1. **Per-ride power on the activities list.** The compact activity shape
   currently carries `{ id, date, type, name, movingTimeSec, distance,
   trainingLoad, rpe, feel, eftp }`. Adding **`averageWatts`** and
   **`normalizedWatts`** (intervals.icu exposes both on the activity) would let
   the app compute genuine power-derived training load for rides instead of the
   duration-times-a-constant estimate it uses for all three sports today. This
   is the single highest-value field for cycling credibility.
2. **A power-curve endpoint** (or best-efforts array): best average watts for
   5 s, 1 min, 5 min, 20 min, 60 min over a date range. Every serious cycling
   app charts this and we cannot derive it client-side from the compact feed.
3. **Swim stroke fields** on the interval rows: stroke count and SWOLF where
   the watch recorded them. The swim pass shipped without any stroke-efficiency
   metric purely because the data does not reach the client.
4. **Conditional DELETE on plans** (repeat of the Phase 2 ask, still open):
   `DELETE /api/plans/{id}` currently matches on id and status only, and
   `ReplaceCurrentPlanAsync` reuses the same row id, so a delete decided on one
   device can land on a plan another device created a moment later. Either a
   version/updatedAt guard on the delete, or handing back a fresh row id on
   replace, closes the last cross-device race.

Item 1 unblocks the most user-visible work; 2 and 3 are chart and metric
features that can follow. No rush on any of them, and nothing is blocked
today — the app degrades honestly when a field is missing.

---

## Ask — 18 July 2026 (evening): PlanCatalog race types for single-sport plans

**Landed**: PR #23 merged to main on 20 July 2026; the four race types ship client-side in the Tier 2 pass.

The next frontend milestone is standalone running race plans (5k, 10k, half
marathon, marathon). `PlanCatalog.RaceTypes` is a closed set and rejects
unknown strings with a 400, which trips the client's sync-failure banner, so
nothing can ship client-side until the catalog grows. The ask is one line:

```csharp
// add to RaceTypes:
"run5k", "run10k", "runhalf", "runmarathon"
```

Two notes on the strings, so we never repaint them:

1. They are deliberately `run`-prefixed. The bare words `half` and `full`
   already mean the 70.3 and 140.6 triathlons in both catalogs, and a bare
   `"half"` for a half marathon would VALIDATE fine and then silently resolve
   to the triathlon's distances in every client lookup. The prefix matches the
   client's existing `B_RACES.run5k` / `run10k` precedent.
2. No new workout types are needed for this milestone: the run library's
   existing type strings cover single-sport plans.

Duathlon and aquathlon are a later conversation; not batching them in until
the product design exists.


---

## Ask — 20 July 2026: per-lap fields for the durability dashboard

The durability surface ships computing from the interval rows you already
pass through. Four small additive fields on the per-interval DTO would make
it meaningfully better, all already present in intervals.icu's raw lap
payload (verified live):

1. **`average_gradient`** (or `total_elevation_gain`): the one confounder we
   could actually gate on. A final third that is a real climb currently
   reads as fading, and copy hedging is the only defence.
2. **`decoupling`**: intervals.icu's own per-lap Pw:Hr decoupling, the
   vetted native version of the drift metric we derive; a cross-check and
   eventual replacement.
3. **`average_cadence`**: late-session cadence decay is a durability signal
   we currently cannot see at all.
4. **`average_temp`**: heat is the other big confounder worth hedging with
   data instead of words.

Note: the per-ride `NormalizedWatts` from PR #23 is the whole-activity
number; the durability windows would additionally benefit from per-interval
normalized power if intervals.icu exposes it per lap, but that is a
nice-to-have behind the four above.


## Ask - 22 July 2026: mass-goal fields

`profile.massGoal` gains the value `'hold'` beside `'gain'` and null, and a
new nullable ISO string `profile.massGoalSetAt` stamps when the goal last
changed (the settling gate reads it). Both ride the opaque profile blob, so
nothing 400s today; the ask is only that the typed UserProfileResponse
subset eventually carries them so fresh-device recovery keeps the stamp.
There is deliberately no `'lose'` value: the safety panel's no-ship verdict
and its reopening conditions are recorded in src/lib/bodymass.js.

## Ask - 22 July 2026: pool profile field

`profile.pool = { length: number, unit: 'metres' | 'yards' }` is a new
athlete setting (swim build-out phase 2). It rides the opaque profile blob, so
nothing 400s today; the ask is only that the typed UserProfileResponse subset
eventually carry it so a fresh device keeps the athlete's pool. Absent or
malformed, the client falls back to 25 m (the default that reproduces current
output). It is display-and-construction only: CSS stays canonical in seconds
per 100 m and the pool never changes it.

## Ask - 23 July 2026: recorded pool length on the activity DTO

For swim build-out phase 2b, the review can flag when a recorded swim looks
like it was done in a different pool than the athlete's setting (so the
distance-derived pace is not trusted blindly). That needs the recorded pool
length on the activity DTO, e.g. `poolLengthM` (metres) from intervals.icu's
`pool_length`. The client already reads `a.poolLengthM` defensively: absent, it
is a silent no-op; present and mismatched, it lowers review confidence and
never silently reinterprets the distance. Additive, no closed set involved.

## Ask - 27 July 2026: typed swim-review field on the workout log DTO

Swim build-out phase 4 computes a deterministic per-session review for
structured swims (completion, pace adherence, consistency, fade, confidence,
coaching outcome). Jon's call is to persist it as a typed field rather than a
device-local cache or a notes-channel hack, so the multi-session evidence
(three comparable quality sessions arguing together before a CSS retest is
suggested) works across devices.

Ask: an optional `swimReview` JSON object (or opaque JSON string) on the
workout log DTO, write-through on PUT and echoed on GET. Shape today:

  { completion, paceAdherence, consistency, fadePercent, perceivedEffort,
    repsDone, repsPlanned, failedReps, confidence, outcome, type, text }

The client already reads it defensively (absent = undefined, nothing
breaks) and sends NOTHING until the field exists - the write path stays
untouched so current log PUTs cannot 400. Once the field lands we wire the
write side and the stored reviews start feeding the retest recommendation.

### Extension - 27 July 2026: technique cue on the same log field

Swim build-out phase 5 adds one post-session question on technique swims
("which cue helped most today?"). The answer is intended to bias future
drill selection.

Note the field alone is not sufficient, and the client does not pretend
otherwise. Plan generation reads the athlete PROFILE, never the log, so a
cue answer stored on a log entry cannot reach drill selection by itself.
The client side of that is already in place: `saneTechnique` accepts a
derived `technique.bias` (an ordered focus list) and `focusOrder` uses it to
order drills behind a declared focus. Once `techniqueCue` round-trips, the
app derives that bias from recent answers and stores it on the profile. So
this ask unblocks the loop; it does not close it on its own.
It wants the same treatment as `swimReview` above: an optional
`techniqueCue` string on the workout log DTO (one of the technique focus
ids, or "none"), write-through on PUT and echoed on GET.

The athlete's own settings need nothing from you: the technique focus and
equipment profile ride the opaque profile blob as `profile.technique =
{ focus: string[], kit?: string[], updatedAt }`, the same additive-safe
route `pool` and `cssMeta` took. As with those, a typed passthrough on
UserProfileResponse would be welcome eventually so a fresh device keeps the
setting, but nothing 400s without it.

## Ask - 27 July 2026: swim stroke fields (phase 8, validated against real data)

Swim build-out phase 8 (stroke metrics) is written and tested but wired to
nothing, because the fields do not reach the client. Before asking, the
upstream data was checked against real Garmin pool swims in the athlete's
own intervals.icu account, so this ask names fields that are known to exist
rather than fields we hope exist.

What intervals.icu already returns and the passthrough currently drops:

  activity:  pool_length      (metres, e.g. 25.0)  -> poolLengthM
             lengths          (e.g. 75)            -> lengths
             average_cadence  (stroke rate)        -> averageCadence
             average_stride   (distance per stroke)-> averageStride
             device_name      (e.g. Garmin fenix 7 Pro) -> deviceName
             source           (e.g. GARMIN_CONNECT)     -> deviceSource

  per lap (the intervals endpoint, alongside the existing distance and
  movingTimeSec):
             average_cadence  -> averageCadence
             average_stride   -> averageStride
             max_cadence, min_cadence -> optional, useful for fatigue

Note pool_length also satisfies the 23 July ask above, which asked for the
same value under the same client name.

NOT available upstream, so the client does not ask for them and does not
compute them as if they were measured: SWOLF, stroke TYPE, and an explicit
stroke count. SWOLF is derived client-side per length and labelled as our
figure, because device SWOLF definitions differ.

One finding worth passing on. On a real lap (100 m in 114 s), distance
divided by average_stride gives 97 strokes while average_cadence multiplied
by time gives 48 - a factor of two, because one field counts arm strokes and
the other counts full cycles. Which is which is a device convention, not a
property of the swim. Please pass BOTH fields through unmodified rather than
normalising one into the other: the client cross-checks them, and where they
disagree it reports no stroke count at all. Preserving the raw values is
also what lets the analysis be recalculated later if a convention is pinned
down.

Nothing here changes any existing response. The client reads all of it
defensively and the analysis stays behind a flag until the fields arrive.

## 28 July — bike ride execution: elapsed time, and trainer control state

Two asks, both additive, both for the same purpose: judging an outdoor ride
by what the rider did rather than by what the road did to their averages.

### 1. `elapsed_time` on the activity (the one that matters)

We currently receive `movingTimeSec` and averages. Nothing else. That means
we cannot tell a rider who stopped at four junctions from a rider who had a
bad day: both arrive as one number that is lower than the session asked for.

Outdoor rides are currently given a wider allowance on the low side of a
prescribed band, because interruptions can only ever remove work from an
average. That is the honest thing to do without evidence, but it is blunt: it
forgives the bad day too.

`elapsed_time` is already on the upstream activity and needs no computation
from you. With it and `moving_time` we can measure the stopped fraction
directly, and say "your efforts were right, the road cost you eight minutes"
instead of widening a tolerance and hoping.

Requested as `elapsedTimeSec` alongside the existing `movingTimeSec`, raw and
unmodified. Where the two are equal we will treat the ride as uninterrupted
rather than assuming the field is missing, so please send it even when it
matches.

### 2. Trainer control state, when it is available (`erg`)

Deferred, and stays deferred until the data exist — nothing in the client
turns on this. Recording it here so the field has a name if it ever becomes
available upstream.

A smooth power trace means one thing under trainer control and something
quite different under the rider's own pacing, and the difference changes what
a review can honestly say: whether the rider held the effort, or whether a
trainer held it for them.

If the upstream activity ever exposes a trainer-control flag, please pass it
through as `erg` (boolean, absent when unknown). Absent must mean unknown and
not false: we would rather say nothing than credit a rider's pacing to a
trainer, or a trainer's to the rider.

To be explicit about scope: this would only ever change how an execution is
EXPLAINED. It would not change the session, the targets or the verdict
thresholds.

Neither ask changes any existing response, and both are read defensively.

## 28 July — normalized power (the one field bike load is waiting on)

A correction to our own earlier framing first, because it changes what is
actually needed. We had this recorded as "the client lacks per-ride average
power". That is not true and has not been for some time: `averageWatts`
arrives both per ride and per interval, and the review, eFTP and durability
code all read it. Interval-level bike review now ships on that data alone and
needs nothing new from you.

What is genuinely missing is **normalized power**, and it is the one field
that unblocks intensity factor, power-based TSS and variability index.

We cannot compute it. Normalized power is a thirty-second rolling average
raised to the fourth power, averaged, then rooted: it is a statement about the
SHAPE of a ride, and shape is exactly what an average discards. We could
approximate it from per-interval averages, and deliberately do not, because
the approximation fails in the least useful way possible — it sees variability
BETWEEN efforts and none within them, so a ragged effort and a metronomic one
of the same average would score identically, which is the single distinction
normalized power exists to make. That number would then flow into TSS, into
fitness and fatigue, into readiness, and into every recommendation built on
them, with nothing downstream able to tell it was invented.

Requested as `normalizedWatts` on the activity, raw, absent when upstream does
not provide it. Absent must mean absent: we render nothing rather than
substituting an average, and every formula is already written, tested against
known values and gated behind the field's presence, so this is a wiring change
on our side rather than a maths one.

If a power STREAM is easier to expose than a computed normalized power, that
works too and is strictly better — we can compute normalized power from a
stream correctly, and a stream would also settle the outdoor-interruption
question in the 28 July note above (stopped time, coasting, and the zero-power
fraction inside an effort).

Priority between the two open bike asks, if it helps: `elapsedTimeSec` is the
cheaper one and improves review verdicts for every outdoor rider today.
`normalizedWatts` unblocks a whole feature but affects only riders with a
power meter and a measured FTP.

Neither changes any existing response.

## 28 July — brick transitions: activity start time

Small ask, and the last of the timing ones.

Bike sessions are now reviewed partly on the run that follows them, because a
bike leg that repeatedly wrecks the run is not good triathlon pacing however
good the ride looked on its own. Most of that works from what already
arrives: the run's pace against the athlete's own fresh pace, their heart
rate, their rated effort, and their logged fuelling on the bike.

The one signal we cannot compute is TRANSITION DURATION. Activities carry a
`date` but no time of day, so the gap between the ride ending and the run
starting is not recoverable, and a brick run started four minutes after the
bike is indistinguishable from one started ninety minutes later. The second is
not a brick at all, and we currently score both the same way.

Requested as a start timestamp on the activity — `startedAt` (ISO 8601, with
offset or UTC) — raw and unmodified. Any equivalent naming upstream already
uses is fine; we only need the instant the recording began.

This would also let us stop pairing bricks purely by calendar date, which is
the other place the missing time of day costs us: two rides and a run on the
same day currently cannot be ordered.

This ask does not change an existing response. For the current list of open
bike asks see **Open bike asks** at the end of this document — it supersedes
the partial lists that were written alongside each individual ask.

## 28 July — a power-curve endpoint

This is the largest of the open bike asks and the only one that unblocks a
whole feature rather than improving an existing one. Everything client-side is
written, tested and gated: nothing renders today, and the day the endpoint
lands it becomes a fetch rather than a feature build.

### Why we cannot do it ourselves

A power curve is best power by duration, and a best is not recoverable from
what we receive. We get per-ride and per-interval averages; the best twenty
minutes inside a four-hour ride is not in there, and neither is a five-second
peak. Deriving a curve from averages would produce a curve-shaped object whose
every point was wrong in the same optimistic direction.

### What we need

Best power for each of these durations, in seconds:

    5, 15, 30, 60, 180, 300, 720, 1200, 2400, 3600

For every point, please include:

- `watts` (integer)
- `durationSec`
- `date` — the day the effort was set
- `source` — the power meter that recorded it, however it is identified
  upstream. A stable identifier matters more than a pretty name.
- `bike` — where available
- `indoor` — boolean, since a trainer and a road are not the same measurement
- `quality` — `low` | `medium` | `high`, or whatever confidence signal exists
  upstream. Absent is read as UNKNOWN and treated as usable, because a backend
  saying nothing is not the same as a backend saying the reading is bad. Only
  an explicit `low` marks a point as shown-but-never-judged. (We had this the
  other way round at first, which made an omitted field a silent kill switch
  for the whole profile.)

Optionally, a freshness window parameter on the query (for example "best in
the last 90 days"), so the client can ask for a current curve rather than an
all-time one. This belongs in the query rather than in our code — the window
decides which rides are considered when the curve is built, and nothing on our
side can apply it after the fact.

### `source` is the field that stops us lying to people

It is the one we would most regret not having. A new power meter can read
several per cent apart from an old one, so a rider who changes one appears to
get stronger at every duration on the same legs, overnight. Without a source
identifier we cannot tell that from training, and neither can they — it is the
one error an athlete has no way to catch for themselves.

With it, we refuse the comparison and say why. The client already computes
whether a whole-curve shift is uniform enough to look like a calibration
difference rather than like fitness, and tells the athlete that instead of
showing them a fake gain. If only one field from this section is cheap to
provide, make it this one.

### What we will NOT do with it

The curve will not move anyone's FTP. It can raise a recommendation to go and
ride a ramp test, and that is the strongest action available to it. Threshold
is what a rider can hold repeatedly; a curve point is what they did once,
possibly downhill, and the two are not interchangeable.

A power STREAM would subsume this ask, the elapsed-time ask and the
normalized-power ask together, if that is ever easier to expose than three
separate computed fields. See **Open bike asks** at the end of this document
for the current list.

## 28 July — a `bikeReview` column on the log entry

Small, and the same shape as the `swimReview` column already asked for, so if
that one gets done this should ride along with it.

The bike now has a per-session review engine: it matches the efforts an
athlete actually rode against the ones their card prescribed, and returns
power adherence, rep-to-rep fade, completion and a confidence. It is computed
client-side from the workout, the recording and its intervals.

The problem is that it is computed and then lost. Intervals are fetched per
workout on demand, so the review exists only while that sheet is open. The
bike dashboard therefore cannot show adherence, fade or review outcomes over a
six-week window, because five of those six weeks are not in memory. It
currently says so plainly rather than substituting a whole-ride average, which
is exactly the thing the review engine exists to avoid — but saying so is not
the same as answering the question.

Requested as `bikeReview` on the workout log entry, a JSON blob, opaque to
you: write back whatever the client sends and return it unchanged. The client
already reads `swimReview` from the same place in the same way.

It is worth noting what this unblocks, because it is more than one number:
the dashboard's whole quality section, the rolling multi-session evidence that
decides whether an FTP retest is worth recommending, and the review outcome
history. All three currently render as "not enough data yet" for every athlete
regardless of how much they ride.

See **Open bike asks** below.


See **Open bike asks** below.

## 29 July — four start-anchor fields on the athlete profile

Onboarding now asks four optional questions about where the athlete is
starting from, and the plan's first weeks build up from those answers
instead of opening at race-sized volume:

- `weeklyHours` (number, hours)
- `longestSwimM` (number, metres)
- `longestRideMin` (number, minutes)
- `longestRunMin` (number, minutes)

They ride the plan POST inside `profile` today, so a plan carries its own
anchors and regenerates identically. The gap is the profile PUT/GET: the
typed UserProfileResponse ignores fields it does not know, so on a fresh
device with no local store the recovered profile loses the anchors and the
next regeneration silently reverts to race-sized first weeks — the exact
behaviour the athlete answered the questions to avoid.

Requested: carry these four columns on the athlete profile, nullable, raw.
Absent means the athlete never answered, which the client treats as
"size from the race and level alone". All four are read defensively and
clamped client-side, so no validation is needed beyond the types.

## Open bike asks — the current list

**This section supersedes every partial list written alongside an individual
ask above.** Cheapest first. All additive, all nullable, all read defensively:
absent means the client renders nothing rather than guessing, so shipping any
subset is safe and shipping none breaks nothing.

| # | Field | Where | Unblocks |
|---|---|---|---|
| 1 | `startedAt` (ISO 8601) | activity | Ordering bricks; measuring transition duration |
| 2 | `bikeReview` (JSON blob, opaque) | workout log entry | The dashboard's whole quality section, the rolling FTP evidence, review outcome history. Pairs with the existing `swimReview` ask — if that one gets done, this should ride with it |
| 3 | `elapsedTimeSec` | activity | Separating a stop from a bad day, so outdoor rides are judged on what the rider did |
| 4 | `normalizedWatts` | activity | Intensity factor, power-based TSS, variability index |
| 5 | Best power by duration | new endpoint | The rider profile entirely — see the power-curve section for the required per-point metadata |
| 6 | `weeklyHours`, `longestSwimM`, `longestRideMin`, `longestRunMin` | athlete profile | Start anchors surviving a fresh-device recovery; without them a reinstalled athlete silently reverts to race-sized first weeks |

A power **stream** would subsume 3, 4 and 5 together, if that is ever easier
to expose than three separate computed fields. Ask 6 is the only one that is
not about activities: it is four nullable columns on the athlete profile.

Two notes on what these cost us today. Ask 2 is the one whose absence is most
visible: without it the bike dashboard's quality section reads "not enough
data yet" for every athlete however much they ride, because per-session
reviews are computed when a workout sheet is opened and then lost. And in ask
5, `source` (the power meter identifier) is the single most valuable field —
without it a new power meter reads as a sudden fitness gain at every duration,
which is the one error an athlete has no way to catch for themselves.

