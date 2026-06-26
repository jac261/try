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
  training days/week and experience (Beginner → Elite). Produces a full
  Base → Build → Peak → Taper block with recovery weeks and a race-day plan.
- **Experience levels that matter** — each level changes volume, workout intensity,
  and recovery-week frequency, not just total hours.
- **Structured workouts** — warm-up / main set / cool-down with target paces
  (from your 5k time), swim CSS pace, and bike power zones (from FTP). New to the
  sport? Skip the numbers and every session is guided by effort (RPE / HR zones),
  with ballpark paces estimated from your level.
- **Weekly calendar** with reschedule + adaptive "catch-up" for missed sessions.
- **Progress dashboard** — days to race, completion %, streak, weekly-volume chart
  and discipline-balance donut.
- **Calendar export** (`.ics`) and an **installable, offline-capable PWA**.

Data is saved in your browser (localStorage) — no account, no server.

## Tech Stack
- **UI:** [React 18](https://react.dev/) (UMD build from a CDN — no bundler)
- **JSX:** [Babel Standalone](https://babeljs.io/docs/babel-standalone) transpiles
  `js/app.jsx` in the browser at load time (classic runtime → `React.createElement`)
- **Styling:** hand-written CSS with custom properties (dark, Runna-inspired theme);
  [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) via Google Fonts
- **Charts & icons:** hand-rolled inline SVG (no chart/icon library)
- **State / persistence:** plain `window.TF.*` globals + `localStorage` (no backend)
- **PWA:** `manifest.webmanifest` + a service worker (`sw.js`) for offline use
- **Hosting:** static files on **GitHub Pages**
- **Tooling:** none required to run. Local dev uses any static file server
  (examples use Python's `http.server`). Icons were generated with Python + Pillow.

There is **no build step, no `package.json`, and no `node_modules`** — the source
files *are* what ships.

## Prerequisites
- A modern web browser.
- Any static file server, so the app is served over **http** (see the `file://`
  note in Quick Start). Common options:
  - **Python 3** — `python3 -m http.server` (used in the examples below)
  - **Node** — `npx serve`
  - any other (PHP, `caddy file-server`, the VS Code "Live Server" extension, …)
- **No Node.js, npm, or build toolchain is needed.**
- *Optional:* `git` + a GitHub Pages-enabled repo to deploy; Python + `Pillow`
  only if you want to regenerate the icons.

## Quick Start
```bash
# 1. Get the code
git clone https://github.com/jac261/try.git
cd try

# 2. Serve it over http (pick any static server)
python3 -m http.server 8733      # or: npx serve

# 3. Open it
#    http://localhost:8733
```

> ⚠️ **Serve over http — don't open `index.html` with `file://`.** Babel fetches
> `js/app.jsx` at runtime to transpile it, and browsers block that under `file://`.
> A dev server (or GitHub Pages) handles this; double-clicking the file won't.

## Project Structure
```
try/
├── index.html            # entry point: loads React + Babel (CDN), registers the service worker
├── styles.css            # all styling — CSS variables, dark Runna-style theme
├── js/
│   ├── data.js           # races, disciplines, training zones, fitness levels, date/pace helpers (window.TF)
│   ├── plan.js           # periodised plan generator + per-discipline workout builders
│   └── app.jsx           # React UI: onboarding, Today, Calendar, Plan, Progress, Settings, SVG icons & charts
├── manifest.webmanifest  # PWA metadata (name, icons, theme, display mode)
├── sw.js                 # service worker — offline caching (network-first for app files, cache-first for CDN)
├── icons/                # app / PWA icons (PNG sizes + maskable + apple-touch + SVG favicon)
├── .nojekyll             # tell GitHub Pages to serve files as-is
├── .gitignore
└── README.md
```

Scripts load in order — `data.js` → `plan.js` (both plain JS, attaching to a global
`window.TF` namespace) → `app.jsx` (JSX, transpiled by Babel). `index.html` registers
a `react-classic` Babel preset so JSX compiles against the global React rather than
emitting an ESM `import`.

## Install it (PWA)
Open the live site, then **Add to Home Screen** (iOS Safari) or **Install**
(Chrome/Edge) to run it full-screen like a native app. After the first visit it
works **offline** — the service worker caches the app shell and CDN libraries, so
your plan is available with no signal.

State persists in `localStorage` under `triflow.plan`, `triflow.log` and
`triflow.moves`.

## Deploying
It's static, so any static host works. This repo deploys to **GitHub Pages** from
the `main` branch (root) — every push redeploys automatically in ~1 minute. The
relative paths in `index.html` and `manifest.webmanifest` keep it working under a
project subpath like `/try/`.

## Moving to a real build (optional)
Once Node is installed you can migrate to [Vite](https://vitejs.dev/):
`npm create vite@latest` (React template), move `js/*` into `src/`, convert the
`window.TF` globals into ES module imports, and remove the CDN/Babel `<script>`
tags from `index.html`. This gets you fast HMR, real npm dependencies (e.g. a
Strava SDK) and a minified production bundle — at the cost of a build step.
