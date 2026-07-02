# Frontend status — for Jack

_Last updated: 2026-07-02. Repo: `jac261/try`. This is the frontend side of the
integration against your `try-backend` API._

## TL;DR

- The frontend was **restructured** — the old `window.TF` global + monolithic
  `main.jsx` are gone, replaced by ES modules under `app/ · lib/ · components/ ·
  features/`. **Your `docs/frontend-contract.md` is now stale** (it describes the
  `window.TF` / side-effect-import shape). Nothing about the *data* changed, just
  the file layout.
- I've added a **full API client** (`src/lib/api.js`) for your endpoints, with a
  mapper between our in-memory `{ plan, log, moves }` and your `PlanResponse`.
- The **Clerk auth gate** is ported onto the new structure and the signed-out gate
  renders. The **signed-in sync layer** (load on mount, push on change) is the next
  step and needs a live session to verify.

## What changed in the frontend structure

`src/main.jsx` (1,200 lines, `window.TF` global) → a layered tree:

```
app/        main.jsx (entry + ClerkProvider), App.jsx, AuthGate.jsx, ErrorBoundary.jsx, storage.js
lib/        date, units, domain, disciplines, plan, fit, wellness, schedule, tuning, ics, api, index
components/ Icon, charts, WorkoutRow, DetailSheet, DaySelector
features/   onboarding, today, calendar, plan, progress, settings, wellness, easter-egg
config/     env.js (Clerk key + base-url/redirect constants)
```

One-way dependency rule (`lib → components → features → app`) enforced by
`npm run lint:boundaries`; a Vitest slice covers `lib/{date,units,plan,wellness,api}`
(`npm test`). `generatePlan(profile)` still emits the exact object you receive on
`POST /api/plans` — no transform needed.

## API client — `src/lib/api.js`

Every call takes Clerk `getToken`, sends a Bearer JWT, and returns
`{ ok, status, body, message }` (never throws). Endpoint coverage:

| Our state | Endpoint(s) | Notes |
|---|---|---|
| plan (create) | `POST /api/plans` | body = our `generatePlan` output verbatim |
| plan (load) | `GET /api/plans/current` | 404 → `{ ok:true, body:null }`. `toClientState()` rebuilds `{plan, log, moves}` from the returned graph + embedded per-workout log/move |
| plan (retarget/reshape) | `PUT /api/plans/current` | |
| completion | `PUT` / `DELETE /api/workouts/{ref}/log` | body `{completed, completedAtUtc, feel, notes}`; keyed by `clientWorkoutRef` (`"0-0"`) |
| reschedule | `PUT` / `DELETE /api/workouts/{ref}/move` | body `{movedDate, reason}` |
| user / prefs | `GET /api/me`, `PUT /api/me/preferences` | |
| FIT files | `list/upload/get/download/delete /api/activity-files` | pairs with `lib/fit.js` |

`feel` values we send: `easy` / `right` / `hard`.

## Auth — ported, gate verified

`app/main.jsx` mounts `<AuthGate/>` inside `<ClerkProvider>` (publishable key from
`.env.local`, gitignored). Signed-out → a branded "Sign in to Try" gate; signed-in →
`App` runs with a **per-user localStorage cache** (`storageForUser(clerkId)` →
`try.user.<id>.*`). Onboarding pre-fills the name from the Clerk profile; Settings has
an account row + a "Test API connection" button (`GET /api/auth-test`).

## Done vs pending

**Done (branch `feat/clerk-and-api`, off `main`):**
- Architecture reorg (already merged to `main` + deployed).
- `lib/api.js` full client + `toClientState` mapper, unit-tested (mocked fetch).
- Clerk gate ported; signed-out gate renders; build/boundaries/tests green.

**Pending (needs a live session — backend + Postgres + a real browser sign-in):**
- The **sync layer in `App`**: `GET /api/plans/current` on mount → hydrate; push
  plan/log/move changes to the API (localStorage stays as the offline cache).
- End-to-end verification of the signed-in create → load → log → move round-trip.
  (Clerk's dev instance blocks headless sign-in, so this can't be automated — it
  needs Jon to sign in once with the stack running.)

## Notes / asks for Jack

- **`frontend-contract.md` is out of date** — happy to send an updated version
  reflecting the ES-module structure and the `api.js` mapping if useful.
- **No endpoint yet for the readiness/wellness layer** (`try.wellness` HRV/sleep
  records) or the readiness "ease today" overlay (`try.adjust`). Those stay
  client-side for now — consistent with the intervals.icu proxy coming later. Flag
  if you'd like them persisted server-side.
- Persistence keys differ by branch: `try.plan` on `main`, `try.user.<clerkId>.plan`
  on the auth branch. Once sync lands, these are just the offline cache.
