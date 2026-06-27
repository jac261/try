# Try — Backend & Integrations Roadmap

*Backend-dependent features: device sync and readiness-driven adaptive coaching*

Prepared for engineering review · 26 June 2026 · App: **Try** ([jac261/try](https://github.com/jac261/try), [jac261.github.io/try](https://jac261.github.io/try))

---

## 1. Context & why a backend is needed

Try is currently a zero-build, fully client-side web app (React via CDN, in-browser
Babel, state in `localStorage`, installable PWA, hosted on GitHub Pages). It has no
server and no accounts.

It already contains a capable, client-side adaptive engine:

- **Manual fitness updates** — entering a 5k time / FTP / swim CSS re-targets every future session's paces.
- **Auto-scheduled benchmark tests** — the plan inserts 5k / FTP / CSS tests to recalibrate fitness.
- **Post-session feedback** — an Easy / Just-right / Hard tap on hard sessions nudges paces ~2%.
- **Progression tracking** — pace / power trends from a stored fitness history.

The features in this document require a backend (OAuth client secrets, secure token
storage, third-party API access, and user accounts). Conceptually, they **automate
the inputs the athlete enters by hand today** — turning Try from a self-reported
planner into a sensor-driven adaptive coach.

---

## 2. Feature — Connect to Strava / Garmin (auto-import activities)

### Goal
Pull completed workouts automatically so users never manually tick a session or guess
how it felt — objective data does it for them.

### Data to ingest
- Activity type, date/time, duration, distance.
- GPS route, pace/speed, heart rate, power, cadence, elevation.
- Per-lap/interval splits; device-reported perceived effort where available.

### How it feeds Try
- **Auto-complete sessions** — match an imported activity to the planned session by date + discipline and tick it.
- **Objective effort** — replace the manual Easy/Hard tap with actual vs target pace/power/HR (e.g. "threshold run hit 4:28/km vs 4:36 target").
- **Automatic fitness updates** — derive new paces/FTP from real best efforts; a parkrun PB silently re-targets run paces — no manual "Update fitness".
- **Honest catch-up** — unmatched/extra sessions and missed sessions become accurate, not self-reported.

### Technical requirements
- **Strava** — OAuth 2.0 (client secret must live server-side); webhook subscription for new-activity push; respect API rate limits; store + refresh per-user tokens.
- **Garmin** — Garmin Connect / Health API needs partner-program approval and is more gated. Pragmatic shortcut: ingest Garmin via Strava or via intervals.icu (both already aggregate Garmin).
- **Apple Health** — HealthKit data requires a native app wrapper — out of scope for a web PWA.

---

## 3. Feature — Connect to intervals.icu (readiness & load-driven coaching)

### Goal
Make Try respond to the athlete's real fitness, fatigue and recovery — adjusting
today's session and the whole progression the way a coach would, rather than
following a fixed template.

intervals.icu already ingests Strava/Garmin and computes the load metrics, and
exposes an API (per-athlete API key, or OAuth). A single intervals.icu connection
may therefore be the **simplest, highest-value integration** — one hookup yields both
activities and wellness.

### Data to pull
- **Fitness chart (PMC)** — CTL = Fitness, ATL = Fatigue, TSB/Form = Fitness − Fatigue.
- **Wellness** — HRV, resting HR, sleep duration/quality, weight, soreness, mood, readiness.
- **Activity stream** — same completed-workout data as the Strava route.

### Dynamic responses (the valuable part)
- **Daily readiness adjustment** — each morning, score readiness from HRV + sleep + resting HR + Form. Poor → downgrade today's session (hard → easy, or insert recovery); great → green-light the key session. Always show the "why" (e.g. "HRV down 15% & poor sleep — swapping VO2 intervals for an easy spin").
- **Form-gated hard sessions** — only keep/schedule hard work when fatigue (Form/TSB) allows; protect against overreaching.
- **CTL-targeted progression** — set a race-day Fitness (CTL) target by distance and ramp toward it at a safe rate (e.g. CTL +3–7/week), letting actual load — not a fixed template — drive volume. Taper to positive Form for race day.
- **Auto-recalibrated thresholds** — derive threshold pace / FTP / CSS from recent data, retiring the manual benchmark tests.

### Technical requirements
- intervals.icu API auth (API key or OAuth); store credentials server-side.
- Daily wellness pull + activity sync (webhook or scheduled poll); nightly recompute of readiness & progression.
- Mapping layer from intervals.icu metrics into Try's plan model (sessions, paces, phases).

---

## 4. Shared backend & architecture

- **Accounts / auth** — user identity to store tokens and sync across devices (today it is `localStorage`-only, single-device).
- **Token storage & security** — OAuth client secrets and per-user tokens held server-side and encrypted; automatic refresh.
- **Sync service** — a small API that pulls, normalises and stores external data, and serves it to the Try frontend.
- **Background jobs** — Strava webhook handlers, scheduled wellness pulls, nightly readiness/progression recompute.
- **Push notifications** — morning readiness summary and session reminders (builds on the existing PWA service worker).
- **Privacy** — HRV/sleep are sensitive health data — explicit consent, data minimisation, easy export and deletion.

---

## 5. Stack implications

The current no-build CDN setup cannot hold secrets or use npm SDKs, so these features require:

- **Vite migration** — move to a real build (npm packages, env vars, minified bundle). Frontend can remain a static SPA.
- **A backend** — e.g. a small Node/serverless API (Cloudflare Workers / Vercel / Fastify) with a managed database (Postgres / SQLite) and an auth provider (Auth.js / Clerk) — or a BaaS such as Supabase to move quickly.
- **Hosting** — keep the static frontend cheap (Pages/CDN); host the dynamic backend separately.

---

## 6. Suggested phasing

| Phase | What | Why / value |
|---|---|---|
| **0 — Foundation** | Vite migration + accounts/auth | Prerequisite for any integration; enables secrets, SDKs, cross-device sync. |
| **1 — Read-only data** | intervals.icu connect; show Fitness/Form chart + wellness in Try | Lowest friction (one integration, rich data); immediately useful with no behaviour change. |
| **2 — Readiness** | Daily session adjustment from HRV/sleep/Form | The headline "smart coach" moment; high perceived value. |
| **3 — Device sync** | Strava/Garmin direct: auto-complete sessions, auto fitness updates | Removes manual logging; objective effort feeds the adaptive engine. |
| **4 — Load model** | CTL-targeted progression + push notifications | Principled, load-based periodisation and proactive nudges. |

---

## 7. Open questions & decisions

- **Integration order** — go direct to Strava/Garmin, or route everything through intervals.icu (simpler, one connection)? **Recommendation: start with intervals.icu.**
- **Autonomy** — how aggressive should auto-adjustment be — suggest-and-confirm (like today's pace nudge) vs auto-apply? Recommend keeping the user in control.
- **Account model** — email/password, social login, or magic link? Data residency for health data?
- **Cost** — hosting, database, and third-party API rate limits at scale.

---

## Appendix — glossary

- **CTL (Fitness)** — Chronic Training Load — a ~42-day weighted average of training stress; rises slowly as you build fitness.
- **ATL (Fatigue)** — Acute Training Load — a ~7-day weighted average; rises and falls quickly with recent load.
- **TSB / Form** — Training Stress Balance = CTL − ATL. Positive = fresh/tapered; deeply negative = fatigued/overreaching.
- **HRV** — Heart-rate variability — a recovery/readiness marker; a notable drop signals the body needs an easier day.
- **PMC** — Performance Management Chart — the CTL/ATL/TSB plot intervals.icu (and TrainingPeaks) produce.
