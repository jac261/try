# 🏊‍♀️🚴‍♂️🏃‍♀️ Try

A Runna-style triathlon training app. It builds a personalised, periodised
swim/bike/run plan from your race, schedule and fitness — then lets you work
through it week by week and track progress.

**▶ Live demo:** https://jac261.github.io/try/

> **Naming:** the app is called **Try**, but the folder and `localStorage` keys are
> still prefixed `triflow` internally — kept deliberately so existing saved data
> survives the rename (see the `LS` helper in [`js/app.jsx`](js/app.jsx)).

---

## 1. What it does
- **Generates a full training plan** for a Sprint / Olympic / 70.3 / 140.6 race from
  your race date, days-per-week and experience level — periodised into
  Base → Build → Peak → Taper with recovery weeks and a race-day entry.
- **Structured workouts** with warm-up / main set / cool-down, target paces
  (run from your 5k, swim from CSS pace, bike power from FTP), and a one-line
  **"why this session"** coaching note. No numbers? Sessions are guided by effort
  (RPE / HR zones) with paces estimated from your level.
- **Editable after onboarding** — update your fitness (re-paces future sessions) or
  change race / date / training days (rebuilds the plan), keeping your progress.
- **Weekly calendar** with drag-free reschedule and an adaptive "catch-up" that
  spreads missed sessions onto free days.
- **Adapts as you get fitter** — auto-schedules benchmark tests (5k TT, bike FTP,
  swim CSS); re-targets every upcoming session's paces when you log a result or
  update your fitness; and nudges paces from how your *hard* sessions felt (a quick
  Easy / Just-right / Hard tap after each workout — easy and long sessions are
  ignored, since they're meant to feel easy).
- **Progress dashboard** — countdown, completion %, streak, weekly-volume chart,
  discipline-balance donut, and a **fitness-progression** view (5k pace / swim CSS /
  bike FTP trending over the season).
- **Calendar export** (`.ics`) and an **installable, offline-capable PWA**.

Everything is stored locally in the browser — **no account, no server.**

## 2. How it works
Try is a **zero-build static web app**. There is no bundler, no `package.json`, and
no `node_modules` — the source files *are* what ships.

- **`index.html`** loads React 18 and Babel from a CDN, then loads the app scripts.
- **JSX is transpiled in the browser** by Babel Standalone at page load. `index.html`
  registers a `react-classic` Babel preset so JSX compiles to `React.createElement`
  against the global `React` (rather than emitting an ESM `import`, which a plain
  `<script>` can't use).
- **Scripts load in order and share a `window.TF` namespace:**
  `data.js` (domain data + helpers) → `plan.js` (plan generator) → `app.jsx` (React UI).
- **The plan generator** (`plan.js`) is pure functions: `generatePlan(profile)` returns
  weeks → workouts → segments. Given a profile it computes the phase split, weekly
  volume ramp, per-session intensity and target paces. The UI just renders that object.
- **State lives in `localStorage`** (`triflow.plan`, `triflow.log`, `triflow.moves`) and
  is layered: the generated plan is immutable; completion + per-session feel (`log`)
  and reschedules (`moves`) are overlays applied at render time.
- **Adaptive re-targeting:** changing your fitness re-runs `generatePlan` from the
  updated profile. Because level / days / race are unchanged, the week/day IDs stay
  identical — so the `log` and `moves` overlays remain valid and only the target
  paces change. Each change appends a `fitnessHistory` snapshot to the profile (which
  powers the progression view), and consistent feedback on *hard* sessions can nudge
  a discipline's paces ~2% between the formal tests.
- **PWA:** `manifest.webmanifest` + a service worker (`sw.js`) cache the app shell and
  CDN libs so it installs to a home screen and works offline.

**Tech stack:** React 18 (CDN UMD) · Babel Standalone (in-browser JSX) · hand-written
CSS with custom properties + Plus Jakarta Sans · hand-rolled inline-SVG charts & icons ·
`localStorage` · service-worker PWA · hosted on GitHub Pages.

### Project structure
```
try/
├── index.html              # entry point: CDN React+Babel, classic-JSX preset, SW registration
├── styles.css              # all styling — CSS variables, dark Runna-style theme
├── js/
│   ├── data.js             # races, disciplines, zones, fitness levels, date/pace helpers (window.TF)
│   ├── plan.js             # periodised plan generator + per-discipline workout builders
│   └── app.jsx             # React UI: onboarding, Today, Calendar, Plan, Progress, Settings, icons, charts
├── manifest.webmanifest    # PWA metadata (name, icons, theme, display)
├── sw.js                   # service worker — offline caching
├── icons/                  # PWA icons (PNG sizes + maskable + apple-touch + SVG favicon)
├── .github/workflows/
│   └── deploy.yml          # GitHub Actions: auto-deploy to Pages on push to main
├── .nojekyll               # serve files as-is on Pages
└── README.md
```

## 3. Getting started (development)
**Prerequisites:** a modern browser and any static file server (so the app is served
over **http**). No Node, npm, or build toolchain required.

```bash
# 1. Clone
git clone https://github.com/jac261/try.git
cd try

# 2. Serve over http (any static server works)
python3 -m http.server 8733       # or: npx serve

# 3. Open
#    http://localhost:8733
```

> ⚠️ **Serve over http — don't open `index.html` with `file://`.** Babel fetches
> `js/app.jsx` at runtime to transpile it, and browsers block that under `file://`.

**Dev loop:** edit a file → refresh the browser. Logic lives in `js/plan.js`
(plan generation) and `js/data.js` (the tunable constants below); UI lives in
`js/app.jsx`; styling in `styles.css`.

> 🧹 **Service-worker caching during dev:** the SW serves cached assets, which can
> mask edits. If a change doesn't appear, hard-refresh, or in DevTools →
> Application → Service Workers tick **"Update on reload"** (or Unregister). The SW
> is network-first for the app's own files, so a normal reload while online usually
> picks up changes on the second load.

*Optional:* regenerating the icons needs Python with `Pillow` (the only dev-time
dependency, used once to produce `icons/`).

## 4. Building
**There is no build step.** The browser runs the source directly (JSX is transpiled
on the fly by Babel). To ship, you deploy the files as-is.

If you later want a conventional build (fast HMR, npm packages like a Strava SDK, a
minified bundle), migrate to [Vite](https://vitejs.dev/): `npm create vite@latest`
(React template), move `js/*` into `src/`, convert the `window.TF` globals to ES
module imports, and drop the CDN/Babel `<script>` tags from `index.html`.

## 5. Deploying
The app is static, so any static host works. This repo deploys to **GitHub Pages**.

**Automatic (GitHub Actions):** [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
runs on every push to `main` (or manually via *Actions → Run workflow*). It uploads
the repo root and deploys to Pages — no build, ~1 minute.

> **One-time setup:** in the repo, go to **Settings → Pages → Build and deployment →
> Source** and select **"GitHub Actions"**. (If it's on "Deploy from a branch", the
> workflow can't publish.) After that, pushes deploy automatically and appear in the
> **Actions** tab.

Relative paths in `index.html` and `manifest.webmanifest` keep everything working
under a project subpath like `/try/`.

## 6. Configuration & tuning knobs
There are no runtime feature toggles; behaviour is driven by a handful of plain-data
constants you can edit directly. The most useful:

| Knob | File | What it controls |
|---|---|---|
| `TF.RACES` | `js/data.js` | Race types and their swim/bike/run distances + `taperWeeks`. Add a race by adding an entry. |
| `TF.FITNESS` | `js/data.js` | Per experience level: `factor` (volume ×), `intensity` (shifts quality sessions along the ladder), `recoveryEvery` (recovery week every N weeks), `recoveryDepth` (how much volume drops then), `est5k`/`estCss` (fallback paces when fields are blank). |
| `TF.DISCIPLINES` | `js/data.js` | Per discipline: `color`, `grad` (icon gradient), `icon` (icon-set name). |
| `TF.ZONES` | `js/data.js` | Training zones Z1–Z5 (names + RPE strings). |
| `TEMPLATES` | `js/plan.js` | Weekly session composition for 3–7 days/week (tokens like `swim:quality`, `bike:long`). |
| `INTENSITY_LADDER` | `js/plan.js` | Per-discipline easy→hard workout progression; the chosen rung = phase position + level `intensity`. |
| `LONG_RUN` / `LONG_BIKE` / `LONG_BRICK` | `js/plan.js` | Base long-session durations (minutes) per race type. |
| `loadFactor()` | `js/plan.js` | Within-phase volume ramp (e.g. Base 0.82→1.0, Build 1.0→1.12, Peak 1.12→1.18, Taper drop). |
| `computePhases()` | `js/plan.js` | Base/Build/Peak/Taper split (Peak ≈20%, Build ≈40%, Base = remainder; taper from the race). |
| `WEEKDAY_ORDER` / `WEEKEND` | `js/plan.js` | Which weekdays sessions land on (long/brick → weekend). |
| `buildTest` / `TEST_ROTATION` | `js/plan.js` | Benchmark-test protocols (5k run TT, 20-min bike FTP, swim CSS) and the discipline rotation; up to 3 are auto-scheduled across the Base/Build weeks. |
| `INTENSITY_TYPES` | `js/app.jsx` | Which workout *types* (Tempo / Threshold / VO2 / Sweet Spot / CSS / Race Pace) let post-session feedback tune paces — easy / long / recovery sessions are excluded. |
| `paceSuggestions` / `tuneFields` | `js/app.jsx` | The feedback rule: ≥3 same-direction "feel" ratings on a discipline's hard sessions → a ~2% pace nudge. |
| `WHY` | `js/app.jsx` | The per-workout-type "why this session" coaching notes shown in the detail sheet. Edit the copy here. |
| `reshapePlan` / `PlanSettingsEditor` | `js/app.jsx` | Edit race / date / days after onboarding; rebuilds the plan and prunes `log`/`moves` to surviving workout IDs. |
| `CACHE` | `sw.js` | Service-worker cache name (`try-vN`). **Bump it** when you change cached assets to force clients to re-cache. |
| `localStorage` keys | `js/app.jsx` (`LS`) | `triflow.plan` (generated plan, incl. `profile.fitnessHistory`), `triflow.log` (completed sessions + per-session `feel`), `triflow.moves` (reschedules). |
| `react-classic` preset | `index.html` | Forces Babel's classic JSX runtime so JSX uses global React. Don't remove it. |
| PWA config | `manifest.webmanifest` | App name, icons, `theme_color`, `display: standalone`, etc. |

**Example — make Beginners even gentler:** in `TF.FITNESS.beginner` lower `factor`
(less volume) or `intensity` (easier sessions), or set `recoveryEvery: 3` (more rest).
The change flows through the next generated plan automatically.
