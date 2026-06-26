# 🏊‍♀️🚴‍♂️🏃‍♀️ Try

A Runna-style triathlon training app. Generates a personalised, periodised
swim/bike/run plan from your race, schedule and current fitness — then lets you
work through it week by week and track progress.

**▶ Live demo:** https://jac261.github.io/try/

> **Naming:** the app is called **Try**. The folder and the `localStorage` key
> prefix are still `triflow` internally — kept deliberately so existing saved data
> isn't wiped by the rename (see the `LS` helper in [`js/app.jsx`](js/app.jsx)).

## Features
- **Plan generator** — pick Sprint / Olympic / 70.3 / 140.6, your race date,
  training days/week and experience. Produces a full Base → Build → Peak → Taper
  block with recovery weeks every 4th week and a race-day plan.
- **Weekly calendar** — every week laid out by discipline with key long & brick
  sessions on weekends; expand a week to see each day.
- **Structured workouts** — warm-up / main set / cool-down with target paces
  (from your 5k time), swim CSS pace, and bike power zones (from FTP). Falls back
  to heart-rate/RPE zones if you skip the numbers. Tap to mark complete.
- **Progress dashboard** — days to race, completion %, streak, weekly volume
  chart (planned vs completed) and discipline balance donut.

Data is saved in your browser (localStorage) — no account, no server.

## Run it
No build step — it's React loaded from a CDN. From this folder:

```bash
python3 -m http.server 8733
```

then open <http://localhost:8733>. (Any static file server works.)

> ⚠️ **Serve it over http — don't open `index.html` with `file://`.** Babel fetches
> `js/app.jsx` at runtime to transpile it, and browsers block that under `file://`.
> The dev server above (or GitHub Pages) handles this; double-clicking the file won't.

## Install it (PWA)
Try is a Progressive Web App: open the live site, then **Add to Home Screen**
(iOS Safari) or **Install** (Chrome/Edge) to run it full-screen like a native app.
After the first visit it works **offline** — a service worker (`sw.js`) caches the
app shell and the CDN libraries, so your plan is available with no signal.
Icons live in `icons/`, app metadata in `manifest.webmanifest`.

Data persists in the browser via `localStorage` under the keys `triflow.plan`,
`triflow.log` and `triflow.moves` — there is no backend or account.

## How it's built
- `index.html` — loads React + Babel from a CDN; registers a classic-JSX-runtime
  Babel preset so `.jsx` compiles to `React.createElement` against global React.
- `js/data.js` — races, disciplines, training zones, date/pace helpers.
- `js/plan.js` — the periodised plan generator and per-discipline workout builders.
- `js/app.jsx` — React UI: onboarding, Today, Calendar, Plan, Progress, Settings.
- `styles.css` — mobile-first styling.

### Moving to a real build (optional)
Once Node is installed you can drop this into a Vite app: `npm create vite@latest`
(React template), move `js/*` into `src/`, convert the `window.TF` globals into
ES module imports, and remove the CDN/Babel `<script>` tags from `index.html`.
