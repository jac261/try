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

## Sync layer — built (`app/sync.js`)

`App` now syncs plan/log/moves with the API. Optimistic: local state + the per-user
cache update immediately; the push runs best-effort in the background (a failure just
warns — localStorage is the offline fallback until the next hydrate).
- **hydrate on mount:** `GET /api/plans/current` → `toClientState` → set plan/log/moves.
  404 (or empty) → onboarding; a pre-backend local plan is migrated up on first
  signed-in load; offline keeps the cache. Brief "Loading your plan…" gate meanwhile.
- **pushes:** onboarding-create → `POST /api/plans` (409 → `PUT`); retarget/reshape →
  `PUT /api/plans/current`; toggle/feel → log; move/catch-up → move.

**One contract note (found smoke-testing the running backend):** the log/move routes
are `api/workouts/{workoutId:guid}/…` — they need the **server workout GUID**, not our
client ref (`"0-0"`; a ref 404s at routing). Every plan response carries each
workout's `id` (GUID) + `clientWorkoutRef`, so the frontend keeps a `ref → GUID` map
(`toClientState().refToId`) from hydrate/create/replace and resolves it before each
log/move push. Works fine — just noting it in case you'd ever prefer to accept
`clientWorkoutRef` in the route (would drop the frontend's map step). No change needed.

## Done vs pending

**Done (branch `feat/clerk-and-api`, off `main`):**
- Architecture reorg (merged to `main` + deployed).
- `lib/api.js` client + `toClientState`/`refToId` mapper; `app/sync.js` orchestration.
  Unit-tested (mocked fetch + mocked-api slices), 40 tests green.
- Clerk gate ported; signed-out gate renders in-browser, clean console.
- **Backend smoke-tested** (fresh DB): both migrations apply (11-table plan graph),
  app boots, `/health` 200, authed endpoints 401, CORS allows the dev origin.

**Pending — the live signed-in round-trip.** Everything static is verified; the one
thing left is exercising create → load → log → move against the API while signed in.
Clerk's dev instance blocks headless sign-in, so it needs a real browser session (see
below).

## Local end-to-end test (for Jon)

```bash
# 1. Postgres + migrations (fresh DB)
~/anaconda3/envs/trypg/bin/pg_ctl -D ~/try-pgdata -o "-p 5432" -l ~/try-pgdata/server.log start
createdb -h localhost -p 5432 -U postgres try_dev   # once
for m in ~/try-backend/db/migrations/*.sql; do psql "postgresql://postgres@localhost:5432/try_dev" -f "$m"; done

# 2. Backend (holds the real endpoints)
cd ~/try-backend
export PATH="$HOME/.dotnet:$PATH" DOTNET_ROOT="$HOME/.dotnet" ASPNETCORE_URLS=http://localhost:5032 \
  DATABASE_URL=postgresql://postgres@localhost:5432/try_dev \
  CLERK_ISSUER=https://mint-wahoo-90.clerk.accounts.dev \
  CLERK_AUTHORIZED_PARTIES=http://localhost:5173 APP_ALLOWED_ORIGINS=http://localhost:5173
dotnet run --project src/TryBackend.Api

# 3. Frontend (this branch), then sign in at http://localhost:5173/try/
cd ~/try && git checkout feat/clerk-and-api && npm install && npm run dev
```
Then: onboard → check `training_plans`/`workouts` populate; tick a session → row in
`workout_logs`; reschedule → row in `workout_moves`; reload → state comes back from the
server. The Settings "Test API connection" button should report authenticated.

## Notes / asks for Jack

- **`frontend-contract.md` is out of date** — happy to send an updated version
  reflecting the ES-module structure and the `api.js` mapping if useful.
- **No endpoint yet for the readiness/wellness layer** (`try.wellness` HRV/sleep
  records) or the readiness "ease today" overlay (`try.adjust`). Those stay
  client-side for now — consistent with the intervals.icu proxy coming later. Flag
  if you'd like them persisted server-side.
- Persistence keys are per-user cache on this branch (`try.user.<clerkId>.*`); with
  the backend as source of truth they're just the offline cache.
