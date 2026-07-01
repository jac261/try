# Frontend review & fixes — `~/try` (main)

_Code review of the live frontend (`src/data.js`, `src/plan.js`, `src/wellness.js`,
`src/main.jsx`), with every finding patched. Build green; each fix verified in a
running browser preview._

## Summary

Overall the app is in good shape: clean module separation via the `window.TF`
namespace, an immutable-plan + overlay pattern (`moves` / `adjust` / `log`) that's a
genuinely nice design, and a defensive persistence/migration layer. Six issues were
found and fixed — one correctness bug (invisible in the UK, real for users west of
UTC), a resilience gap, a validation gap, a systematic accessibility gap, some dead
code — plus a **bonus correctness bug uncovered during verification** that affected
the *default* onboarding.

## Findings & fixes

### 1. Timezone bug — date-only strings parsed as UTC, read as local ⚠️
`TF.iso`, `weeksBetween`, and `daysBetween` did `new Date(x)`. When `x` was a
date-only string like `"2026-09-20"` (which is exactly what `profile.raceDate` is —
it comes straight from `<input type="date">`), `new Date("2026-09-20")` parses as
**UTC midnight**, then `TF.iso` reads it back with local `getFullYear/Month/Date`.

For any user **west of UTC** this shifted the date back a day:
- `plan.js` `raceISO = T.iso(profile.raceDate)` placed the "RACE DAY" card on the
  wrong calendar day — or on a rest day that didn't match, so it wasn't marked.
- The "days to go" countdown and the race date shown in Settings were off by one.

Invisible in the UK (UTC/BST is at or ahead of UTC), so it never showed locally; it
bites US/Americas users specifically.

**Fix:** added `TF.toDate()`, which parses `"YYYY-MM-DD"` strings as **local**
midnight (`new Date(str + 'T00:00:00')`) and passes everything else through. Routed
`iso` / `addDays` / `startOfWeekMonday` / `weeksBetween` / `daysBetween` / `fmtDate`
through it. The fix is timezone-independent by construction: a date-only string with
no `Z` is parsed in local time per spec, so `getDate()` is stable everywhere.
_Verified: `iso('2026-09-20')` → `2026-09-20` holds; race day matches a workout day._

### 2. No error boundary / no plan-schema guard
`LS.load` only caught `JSON.parse` failures, not a *structurally* stale plan (saved
by an older build). A render-time throw white-screened the app, and because the bad
plan stayed in `localStorage`, reloading re-crashed.

**Fix:** added a top-level `ErrorBoundary` around `<App/>` with a friendly recovery
screen and a **Start a fresh plan** button that clears storage. It also bumps a keyed
`nonce` to force a remount, so it recovers even in environments where
`location.reload()` is a no-op.
_Verified: seeded a corrupt plan → recovery screen (not a white screen) → button
clears data and returns to onboarding._

### 3. Onboarding race-date had no `min`
The plan-edit view constrained the date but onboarding didn't, so a past/too-near
date was accepted.

**Fix:** added `min={+7 days}` to the onboarding date input.

### 4. Accessibility — clickable `<div>`s not keyboard-operable
The race/day/experience pickers, workout rows, action banners, the week accordion,
and the reset links were all `<div onClick>` / `<a onClick>` — not focusable, no
`role`/`aria`.

**Fix:** added a small `tap(handler)` helper (`role="button"`, `tabIndex={0}`,
Enter/Space activation) and spread it onto every interactive control. The secret
"Release ze Würm" trigger was **deliberately left inaccessible** so it stays secret.
_Verified: option cards now expose as `button` in the accessibility tree._

### 5. Dead code + unguarded loop
- Removed unused `isLast` and `slot`/`slot++` locals in `plan.js`.
- Added a guard counter to the `while (base < 1)` loop in `computePhases` — safe for
  today's constants but a latent infinite-loop risk if the durations change.

## Bonus — race day fell outside the plan (found during verification)

Not in the original review; surfaced while testing the default onboarding.

`totalWeeks = Math.round(weeksBetween(weekStart0, raceDate))` **truncated** a race
that landed more than half a week past the last Monday. The default onboarding (race
84 days out, mid-week start) computed 12.29 weeks → rounded to **12**, so the plan
ended three days *before* race day and the "RACE DAY" card silently never appeared.

**Fix:** `totalWeeks = Math.ceil((daysBetween(weekStart0, raceDate) + 1) / 7)` — whole
weeks *through* the race's own week, so race day always lands inside the plan.
_Verified: swept every race offset from 28 to 300 days — **0 failures** (previously
broken for the default). Plans are now e.g. 13 weeks with race day marked on the exact
date._

## Not changed (working as intended)

- `fitnessSeries` plots each fitness value at the date it *began* taking effect — the
  array-alignment looks off-by-one but is deliberate and correct.
- The retarget-vs-reshape split (preserve IDs on a pace change, prune `log`/`moves`
  on a structural rebuild) is right.
- `wellness.js` `hrvSd || 4` correctly guards the z-score against zero variance.

## Files touched

- `src/data.js` — `TF.toDate()` + routed date helpers through it.
- `src/plan.js` — `Math.ceil` week count; removed dead locals; loop guard.
- `src/main.jsx` — `ErrorBoundary`; `tap()` a11y helper applied throughout;
  onboarding date `min`.
