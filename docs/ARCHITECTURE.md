# Try — target architecture (proposed)

_A bulletproof-react–inspired reorganisation, adapted for Try's lean, no-heavy-deps
reality. It maps every current symbol to a new home and sequences the move so the
app keeps working (and stays deployed) at every step._

> **Status: implemented** on branch `refactor/lib-extraction` (Steps 1–7). The
> 1,213-line `main.jsx` is gone; the tree below is live. Enforcement uses a
> lightweight `scripts/check-boundaries.mjs` (`npm run lint:boundaries`) plus a
> Vitest slice over `lib/date`, `lib/units`, `lib/plan`, `lib/wellness`
> (`npm test`) — see the note under "What we adopt vs skip".

## Why

Today the app is four domain modules that attach to a global `window.TF`, plus one
1,200-line `src/main.jsx` holding **everything**: icons, four chart types, onboarding,
all five views, editors, persistence, `.ics` export, the easter egg, and the error
boundary. That was fine for the CDN-era origin and is manageable solo. It starts to
hurt as it grows and as Jack contributes: no clear feature seams, a load-order-
sensitive global, and one file nobody can hold in their head.

Two structural wins drive this reorg:

1. **`window.TF` → real ES modules.** The side-effect imports (`import './data.js'`
   for its global attachment) mean load order is load-bearing (`data` before `plan`
   before `main`). Real imports/exports remove that fragility, make things
   tree-shakeable and unit-testable, and let tooling follow the graph.
2. **Feature folders + a big-file split.** Group code by feature, not by "it's all UI",
   with a one-way dependency flow so features can't quietly entangle.

## Target layout

```
src/
  app/
    main.jsx              # entry: createRoot + <ErrorBoundary><App/></ErrorBoundary>
    App.jsx              # shell: state, view routing, handlers, providers
    ErrorBoundary.jsx
    storage.js           # NS, LS, the triflow.* → try.* migration

  lib/                    # framework-agnostic domain (was window.TF)
    date.js              # toDate, iso, addDays, startOfWeekMonday, weeks/daysBetween, fmtDate
    units.js             # fmtPace, fmtDuration, parseTimeToSec, clamp, round5, lerp
    domain.js            # RACES, ZONES, FITNESS, PHASE_INFO  (plan-domain constants)
    disciplines.js       # DISCIPLINES  (name/icon/gradient — UI-facing, shared)
    plan.js              # generatePlan, easeWorkout (+ internal builders)
    fit.js               # FIT encoder + workout library
    wellness.js          # readiness engine
    schedule.js          # effDate, weekRange, catchUpMoves
    tuning.js            # INTENSITY_TYPES, paceSuggestions, tuneFields
    ics.js               # icsEsc, buildICS, downloadICS

  components/             # shared, feature-agnostic UI
    Icon.jsx             # Icon + ICON_PATHS + ICON_BOLD
    charts/
      BarChart.jsx  Donut.jsx  Sparkline.jsx  TrendChart.jsx
    workout/
      WorkoutRow.jsx  DetailSheet.jsx   # used by both Today and Calendar

  features/
    onboarding/          Onboarding.jsx  DaySelector.jsx  BuildingPlan.jsx
    today/               TodayView.jsx
    calendar/            CalendarView.jsx
    plan/                PlanView.jsx
    progress/            ProgressView.jsx  fitnessSeries.js
    settings/            SettingsView.jsx  FitnessEditor.jsx  PlanSettingsEditor.jsx
    wellness/            ReadinessCard.jsx  ReadinessRing.jsx  WellnessEditor.jsx  WellnessTrends.jsx
    easter-egg/          WurmReveal.jsx  why.js   # the "to shreds you say" data

  utils/
    a11y.js              # tap()

  styles.css             # (unchanged for now; feature-scoped CSS is a later step)
```

## Migration map (current → new home)

Every top-level symbol in the current code:

| Current (file · symbol) | New home |
|---|---|
| `data.js` · date helpers (`toDate`, `iso`, `addDays`, `startOfWeekMonday`, `weeksBetween`, `daysBetween`, `fmtDate`) | `lib/date.js` |
| `data.js` · `fmtPace`, `fmtDuration`, `parseTimeToSec`, `clamp`, `round5`, `lerp` | `lib/units.js` |
| `data.js` · `RACES`, `ZONES`, `FITNESS`, `PHASE_INFO` | `lib/domain.js` |
| `data.js` · `DISCIPLINES` | `lib/disciplines.js` |
| `plan.js` · `generatePlan`, `easeWorkout` (+ builders) | `lib/plan.js` |
| `fit.js` · `FIT` | `lib/fit.js` |
| `wellness.js` · `wellness` | `lib/wellness.js` |
| `main.jsx` · `NS`, `LS`, migration loop | `app/storage.js` |
| `main.jsx` · `effDate`, `weekRange`, `catchUpMoves` | `lib/schedule.js` |
| `main.jsx` · `INTENSITY_TYPES`, `paceSuggestions`, `tuneFields` | `lib/tuning.js` |
| `main.jsx` · `icsEsc`, `buildICS`, `downloadICS` | `lib/ics.js` |
| `main.jsx` · `tap` | `utils/a11y.js` |
| `main.jsx` · `Icon`, `ICON_PATHS`, `ICON_BOLD` | `components/Icon.jsx` |
| `main.jsx` · `BarChart`, `Donut`, `Sparkline`, `TrendChart` | `components/charts/*` |
| `main.jsx` · `WorkoutRow`, `DetailSheet`, `WHY` | `components/workout/*` |
| `main.jsx` · `Onboarding`, `DaySelector`, `BuildingPlan` | `features/onboarding/*` |
| `main.jsx` · `TodayView` | `features/today/TodayView.jsx` |
| `main.jsx` · `CalendarView` | `features/calendar/CalendarView.jsx` |
| `main.jsx` · `PlanView` | `features/plan/PlanView.jsx` |
| `main.jsx` · `ProgressView`, `fitnessSeries` | `features/progress/*` |
| `main.jsx` · `SettingsView`, `FitnessEditor`, `PlanSettingsEditor` | `features/settings/*` |
| `main.jsx` · `ReadinessRing`, `ReadinessCard`, `WellnessEditor`, `WellnessTrends` | `features/wellness/*` |
| `main.jsx` · `WurmReveal` | `features/easter-egg/*` |
| `main.jsx` · `App` | `app/App.jsx` |
| `main.jsx` · `ErrorBoundary` | `app/ErrorBoundary.jsx` |
| `main.jsx` · `createRoot(...).render(...)` | `app/main.jsx` |

**Judgement calls to confirm during the move:**
- `WorkoutRow` / `DetailSheet` are shared by Today **and** Calendar → they live in
  `components/workout/`, not inside a feature. (`WHY` — the detail-sheet copy — rides
  along with `DetailSheet`.)
- The **wellness** UI spans Today (`ReadinessCard`) and Progress (`WellnessTrends`),
  so it's its own `features/wellness/` that both consume, rather than nesting under one.
- `DISCIPLINES` is split from the other constants because it's UI-facing (icon key +
  gradient) and imported widely; the rest of `domain.js` is pure plan config.

## Dependency rule

One direction only:

```
utils / lib  →  components  →  features  →  app
```

- `lib/` and `utils/` know nothing about React components.
- `components/` may use `lib`/`utils` but not `features` or `app`.
- `features/` may use `components`, `lib`, `utils` — **never another feature**.
  (Shared need → promote it to `components/` or `lib/`.)
- `app/` wires features together and owns cross-cutting state.

Enforced by `scripts/check-boundaries.mjs` (run via `npm run lint:boundaries`), a
zero-dependency import-graph checker that fails on any illegal upward or
feature→feature import. A `@/` path alias in `vite.config.js` + `jsconfig.json` lets
imports read `@/lib/date` instead of `../../../lib/date`. (The checker can be swapped
for an ESLint `import/no-restricted-paths` rule later if we want editor integration.)

## What we adopt vs skip from bulletproof-react

**Adopt:** feature-based folders, one-way dependency flow + import-boundary lint, the
`app`/`components`/`lib`/`features`/`utils` skeleton, absolute imports/aliases,
colocating each feature's own components.

**Skip (for now — adds infra we don't have):** React Query / a server-cache layer (no
backend yet; state is `localStorage`), a global store like Zustand (a single `App`
`useState` tree is fine at this size), the full testing harness (add targeted tests for
`lib/plan`, `lib/wellness`, `lib/date` first — they're pure and high-value), and
per-feature route modules (the app is tab-switched, not routed).

## Incremental migration (each step: build green + verified in preview, then commit)

The order minimises churn — leaf-most, lowest-risk first — and keeps `main.jsx` a
working shim (re-exporting from new locations) until the very end.

1. **Scaffold + aliases.** Create the folders; add the `@/` alias to `vite.config.js`
   + `jsconfig.json`. No code moves. Build still green.
2. **`lib/` extraction (the big one).** Move the four domain modules and the pure
   helpers from `main.jsx` into `lib/*` as real `export`s. Replace `window.TF.x`
   call-sites with imports. Delete the `window.TF` global and the side-effect imports.
   _This removes the load-order fragility._
3. **`app/storage.js`.** Pull `NS`/`LS`/migration out of `main.jsx`.
4. **Shared components.** `Icon`, `charts/*`, `workout/*` → `components/`.
5. **Features.** Move view/editor components into `features/*`, one feature per commit,
   verifying each tab in the preview as it lands.
6. **App shell.** `App` → `app/App.jsx`, `ErrorBoundary` → `app/ErrorBoundary.jsx`,
   entry → `app/main.jsx`; update `index.html`'s script src. Retire the old `main.jsx`.
7. **Boundary check + a first test slice.** `scripts/check-boundaries.mjs` enforces the
   dependency rule; a Vitest slice covers `lib/date`, `lib/units`, `lib/plan`,
   `lib/wellness` (incl. the timezone and race-day regressions). `npm run check`
   runs boundaries → tests → build.

## Invariants — do NOT break during the reorg

- **`localStorage` keys stay `try.plan` / `try.log` / `try.moves` / `try.adjust`** and
  the `triflow.*` → `try.*` migration stays — real user data lives there.
- **Vite `base: '/try/'`**, the multi-page style-guide input, and the **PWA** config
  must survive the entry-point move.
- **GitHub Pages deploys from `main`** via Actions building `dist/` — every step must
  leave `npm run build` green, because a push publishes.
- Keep the **secret easter-egg trigger inaccessible** (no `role=button`) when
  `WurmReveal`/its trigger move.
- No behaviour changes in this reorg — it's a pure move/rename. Correctness fixes and
  features are separate commits.
```
