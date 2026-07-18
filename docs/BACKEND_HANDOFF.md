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
