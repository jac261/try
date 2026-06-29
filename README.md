# 🏊‍♀️🚴‍♂️🏃‍♀️ Try

A Runna-style triathlon training app. It builds a personalised, periodised
swim/bike/run plan from your race, schedule and fitness — then lets you work
through it week by week and track progress.

**▶ Live demo:** https://jac261.github.io/try/


---

## 1. What it does
- **Generates a full training plan** for a Sprint / Olympic / 70.3 / 140.6 race from
  your race date, days-per-week and experience level — periodised into
  Base → Build → Peak → Taper with recovery weeks and a race-day entry.
- **Structured workouts** with warm-up / main set / cool-down, target paces
  (run from your 5k, swim from CSS pace, bike power from FTP), and a one-line
  **"why this session"** coaching note. No numbers? Sessions are guided by effort
  (RPE / HR zones) with paces estimated from your level.
- **Varied session types** — easy / tempo / threshold / VO2 runs, endurance /
  sweet-spot / threshold rides, technique / CSS / open-water swims, strength
  sessions (Base/Build), and bricks that ramp from easy to race-pace by phase.
  Strength is a **two-a-day**, stacked on the hardest session day (so easy/rest days
  stay easy/rest).
- **Scheduling preferences** — choose exactly which weekdays you train (the rest are
  rest days) and which day hosts your long ride/run.
- **Editable after onboarding** — update your fitness (re-paces future sessions) or
  change race / date / schedule (rebuilds the plan), keeping your progress.
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
- **Send to watch** — export any run / bike / swim session as a Garmin **`.FIT`
  structured workout** with personalised pace (run/swim) or power (bike) targets, to
  follow step by step on a watch. See [docs/WORKOUT_LIBRARY.md](docs/WORKOUT_LIBRARY.md).
- **Calendar export** (`.ics`) and an **installable, offline-capable PWA**.

The app is gated by Clerk sign-in. Training state is still stored locally in the browser, scoped per Clerk user, while the backend is currently used only for the authenticated API connection test.

## 2. How it works
Try is a **[Vite](https://vitejs.dev/) + React single-page app**. Vite handles JSX,
bundling, the dev server (HMR), and the production build.

- **`index.html`** is the Vite entry — a `<div id="root">` and a single
  `<script type="module" src="/src/main.jsx">`. Vite injects the hashed bundle and the
  PWA manifest/registration at build time.
- **`src/main.jsx`** is the app entry. It imports the domain modules for their side
  effects, then mounts React. The domain modules still share a single **`window.TF`**
  namespace and load in order: `data.js` (domain data + helpers) → `plan.js` (plan
  generator) → `fit.js` (.FIT export) → the UI. (Keeping `window.TF` made the migration
  from the original no-build version a thin change; the modules can be converted to
  explicit `export`/`import` later without touching their internals.)
- **The plan generator** (`plan.js`) is pure functions: `generatePlan(profile)` returns
  weeks → workouts → segments. Given a profile it computes the phase split, weekly
  volume ramp, per-session intensity and target paces. The UI just renders that object.
- **Clerk gates the app** before onboarding, plan views, logging, exporting, or settings render.
- **State lives in per-user `localStorage`** (`try.user.<clerkUserId>.plan`,
  `.log`, `.moves`, `.wellness`) and is layered: the generated plan is immutable;
  completion + per-session feel (`log`) and reschedules (`moves`) are overlays
  applied at render time.
- **Backend API connection test:** Settings can call the Try backend
  `GET /api/auth-test` endpoint with the current Clerk token. This does not sync
  plan state to the backend.
- **Adaptive re-targeting:** changing your fitness re-runs `generatePlan` from the
  updated profile. Because level / days / race are unchanged, the week/day IDs stay
  identical — so the `log` and `moves` overlays remain valid and only the target
  paces change. Each change appends a `fitnessHistory` snapshot to the profile (which
  powers the progression view), and consistent feedback on *hard* sessions can nudge
  a discipline's paces ~2% between the formal tests.
- **PWA:** [`vite-plugin-pwa`](https://vite-pwa-org.netlify.app/) generates the manifest
  and a Workbox service worker that precaches the hashed build, so it installs to a home
  screen and works offline. Configured in `vite.config.js`.

**Tech stack:** Vite 6 · React 18 · `@clerk/react` · `@vitejs/plugin-react` · `vite-plugin-pwa` (Workbox) ·
hand-written CSS with custom properties + Plus Jakarta Sans · hand-rolled inline-SVG
charts & icons · `localStorage` · hosted on GitHub Pages (built in CI).

### Project structure
```
try/
├── index.html              # Vite entry: #root + module script; PWA tags injected at build
├── package.json            # scripts (dev/build/preview) + dependencies
├── vite.config.js          # base '/try/', React plugin, PWA (manifest + service worker)
├── src/
│   ├── main.jsx            # app entry: imports domain modules, mounts React; the whole UI
│   ├── api.js              # backend API helpers, currently auth-test only
│   ├── data.js             # races, disciplines, zones, fitness levels, date/pace helpers (window.TF)
│   ├── plan.js             # periodised plan generator + per-discipline workout builders
│   ├── fit.js              # structured-workout library + in-browser .FIT (Garmin) encoder
│   └── styles.css          # all styling — CSS variables, dark Runna-style theme
├── public/                 # copied verbatim into the build
│   ├── icons/              # PWA icons (PNG sizes + maskable + apple-touch + SVG favicon)
│   └── .nojekyll           # serve files as-is on Pages
├── .github/workflows/
│   └── deploy.yml          # GitHub Actions: build with Vite, deploy dist/ to Pages
└── README.md
```
*(`dist/` and `node_modules/` are build artefacts and are git-ignored.)*

## 3. Getting started (development)
**Prerequisites:** [Node.js](https://nodejs.org/) 18+ and npm.

```bash
# 1. Clone & install
git clone https://github.com/jac261/try.git
cd try
npm install
```

Create `.env.local` for local development. The file is ignored by git.

```text
VITE_CLERK_PUBLISHABLE_KEY=<Clerk publishable key>
VITE_API_BASE_URL=http://localhost:5032
```

```bash
# 2. Start the dev server (hot-reloading)
npm run dev          # → http://localhost:5173/try/

# 3. Build for production / preview the build
npm run build        # → dist/
npm run preview      # serve dist/ locally at the /try/ base
```

**Dev loop:** edit a file → Vite hot-reloads instantly. Logic lives in `src/plan.js`
(plan generation), `src/data.js` (the tunable constants below) and `src/fit.js`
(.FIT export); UI lives in `src/main.jsx`; styling in `src/styles.css`.

> 💡 The dev server serves under the `/try/` base (matching production). To serve from
> the root locally instead, run `npm run dev -- --base /`.

*Optional:* regenerating the icons in `public/icons/` needs Python with `Pillow`.

### Auth-Gated Local Smoke Test

This checks that the Vite app requires Clerk sign-in, can obtain a session token, and can call the backend `GET /api/auth-test` endpoint. It does not sync plan data.

Use two PowerShell windows.

Backend window:

```powershell
cd C:\Users\jackg\vscode-repos\try-backend
$env:APP_ALLOWED_ORIGINS = "http://localhost:5173,https://jac261.github.io"
$env:CLERK_ISSUER = "https://mint-wahoo-90.clerk.accounts.dev"
$env:CLERK_AUTHORIZED_PARTIES = "http://localhost:5173,https://jac261.github.io"
dotnet run --project src/TryBackend.Api
```

Frontend window:

```powershell
cd C:\Users\jackg\vscode-repos\try
npm install
npm run dev
```

Then open `http://localhost:5173/try/`. Signed-out users should see only the sign-in gate. After signing in, create or use a local plan, go to Settings, and use Sync & export -> Account & API. Click `Test API connection` and expect a success message with the backend-authenticated Clerk `user_...` subject.

If the app says Clerk is not configured, update `.env.local` with the real publishable key and restart `npm run dev`. If sign-in lands on Vite's `/try/` base warning, update Clerk's Account Portal/User redirects so after sign-up fallback, after sign-in fallback, and after logo click use `$DEVHOST` + `/try/`, not `/health`. The app also passes explicit Clerk React redirect props for sign-in, sign-up, and sign-out; these dashboard redirects are still needed as Clerk fallbacks. If the API call fails with CORS or unauthorized, re-check the backend environment variables and Clerk redirect URL `http://localhost:5173/try/`.

To shut the local test down, press `Ctrl+C` in the frontend PowerShell window running `npm run dev`, then press `Ctrl+C` in the backend PowerShell window running `dotnet run`. Both commands should return to a normal prompt. If a port still appears busy, close the terminal that started that server and start it again.

## 4. Building
`npm run build` runs Vite, which bundles and minifies into **`dist/`** (hashed JS/CSS,
copied `public/` assets, and the generated PWA manifest + service worker). `base` is set
to `/try/` in `vite.config.js` so asset URLs resolve under the GitHub Pages subpath; for
a root deploy, change `base` to `'/'`.

## 5. Deploying
This repo deploys to **GitHub Pages**, built in CI.

**Automatic (GitHub Actions):** [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
runs on every push to `main` (or manually via *Actions → Run workflow*). It installs
deps (`npm ci`), runs `npm run build`, and deploys the **`dist/`** artifact to Pages
(~1–2 minutes).

> **One-time setup:** in the repo, go to **Settings → Pages → Build and deployment →
> Source** and select **"GitHub Actions"**. (If it's on "Deploy from a branch", the
> workflow can't publish.) After that, pushes deploy automatically and appear in the
> **Actions** tab.

The Vite `base` of `/try/` makes every asset resolve correctly under the project subpath.

The Pages build reads these GitHub repository variables:

- `VITE_CLERK_PUBLISHABLE_KEY` - Clerk publishable key for the frontend; required for the gated app.
- `VITE_API_BASE_URL` - deployed Try backend URL, for example `https://api-production-2931.up.railway.app`.

Without `VITE_CLERK_PUBLISHABLE_KEY`, the app still builds but shows a configuration error instead of the training UI.

## 6. Configuration & tuning knobs
There are no runtime feature toggles; behaviour is driven by a handful of plain-data
constants you can edit directly. The most useful:

| Knob | File | What it controls |
|---|---|---|
| `TF.RACES` | `src/data.js` | Race types and their swim/bike/run distances + `taperWeeks`. Add a race by adding an entry. |
| `TF.FITNESS` | `src/data.js` | Per experience level: `factor` (volume ×), `intensity` (shifts quality sessions along the ladder), `recoveryEvery` (recovery week every N weeks), `recoveryDepth` (how much volume drops then), `est5k`/`estCss` (fallback paces when fields are blank). |
| `TF.DISCIPLINES` | `src/data.js` | Per discipline: `color`, `grad` (icon gradient), `icon` (icon-set name). |
| `TF.ZONES` | `src/data.js` | Training zones Z1–Z5 (names + RPE strings). |
| `TEMPLATES` | `src/plan.js` | Weekly session composition for 3–7 days/week (tokens like `swim:quality`, `bike:long`). |
| `INTENSITY_LADDER` | `src/plan.js` | Per-discipline easy→hard workout progression; the chosen rung = phase position + level `intensity`. |
| `runLib` / `bikeLib` / `swimLib` | `src/fit.js` | Structured-step library per session type for `.FIT` export (durations, repeats, pace/power targets). Mirror a `plan.js` builder here when you add a session type. |
| `LONG_RUN` / `LONG_BIKE` / `LONG_BRICK` | `src/plan.js` | Base long-session durations (minutes) per race type. |
| `loadFactor()` | `src/plan.js` | Within-phase volume ramp (e.g. Base 0.82→1.0, Build 1.0→1.12, Peak 1.12→1.18, Taper drop). |
| `computePhases()` | `src/plan.js` | Base/Build/Peak/Taper split (Peak ≈20%, Build ≈40%, Base = remainder; taper from the race). |
| `WEEKDAY_ORDER` / `WEEKEND` | `src/plan.js` | Legacy fixed weekday layout, used when a profile has no `trainingDays`. |
| `profile.trainingDays` / `longDay` | set in `src/main.jsx` (`DaySelector`) | Chosen training weekdays (0=Mon..6=Sun) + the long-session day. The generator schedules around these. |
| `DEFAULT_DAYS` | `src/main.jsx` | Default training-day sets per count, used to seed the day picker. |
| `buildTest` / `TEST_ROTATION` | `src/plan.js` | Benchmark-test protocols (5k run TT, 20-min bike FTP, swim CSS) and the discipline rotation; up to 3 are auto-scheduled across the Base/Build weeks. |
| `INTENSITY_TYPES` | `src/main.jsx` | Which workout *types* (Tempo / Threshold / VO2 / Sweet Spot / CSS / Race Pace) let post-session feedback tune paces — easy / long / recovery sessions are excluded. |
| `paceSuggestions` / `tuneFields` | `src/main.jsx` | The feedback rule: ≥3 same-direction "feel" ratings on a discipline's hard sessions → a ~2% pace nudge. |
| `WHY` | `src/main.jsx` | The per-workout-type "why this session" coaching notes shown in the detail sheet. Edit the copy here. |
| `reshapePlan` / `PlanSettingsEditor` | `src/main.jsx` | Edit race / date / days after onboarding; rebuilds the plan and prunes `log`/`moves` to surviving workout IDs. |
| `CACHE` | `sw.js` | Service-worker cache name (`try-vN`). **Bump it** when you change cached assets to force clients to re-cache. |
| `localStorage` keys | `src/main.jsx` (`storageForUser`) | `try.user.<clerkUserId>.plan` (generated plan, incl. `profile.fitnessHistory`), `.log` (completed sessions + per-session `feel`), `.moves` (reschedules), and `.wellness` (readiness records). Old anonymous keys are not auto-imported into signed-in workspaces. |
| `react-classic` preset | `index.html` | Forces Babel's classic JSX runtime so JSX uses global React. Don't remove it. |
| PWA config | `manifest.webmanifest` | App name, icons, `theme_color`, `display: standalone`, etc. |

**Example — make Beginners even gentler:** in `TF.FITNESS.beginner` lower `factor`
(less volume) or `intensity` (easier sessions), or set `recoveryEvery: 3` (more rest).
The change flows through the next generated plan automatically.
