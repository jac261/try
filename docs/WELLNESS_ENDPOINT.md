# Wellness / readiness endpoint — for Jack

_The frontend side is **built and merged-ready** (branch `feat/wellness-sync`): `lib/api.js`
has `getWellness`/`putWellness`/`deleteWellness`, and `app/sync.js` + `App` sync the
readiness records exactly like plan/log/moves (optimistic local + best-effort push,
localStorage as the offline cache). It no-ops gracefully until this endpoint exists —
so shipping the endpoint below flips wellness sync on with no further frontend change._

## Why

The readiness engine (`src/lib/wellness.js`) is **client-side and done** — it turns a
day's HRV / sleep / resting-HR / Form into a go-ease-recover call. Today those records
live only in the browser (`try.user.<clerkId>.wellness`), so they don't sync across
devices. This endpoint gives them the same server-backed treatment the training plan
just got.

## The records

Daily records keyed by **date** (`"YYYY-MM-DD"`), intervals.icu-shaped:

```json
{
  "date": "2026-07-02",
  "hrv": 62,          // ms, morning HRV (nullable)
  "rhr": 48,          // bpm, resting HR (nullable)
  "sleepH": 7.5,      // hours slept (nullable)
  "sleepScore": 82,   // 0-100 (nullable, optional)
  "ctl": 55,          // Fitness (nullable)
  "atl": 48,          // Fatigue (nullable)
  "tsb": 7            // Form = ctl - atl (nullable)
}
```

All metric fields are optional/nullable — the engine scores whatever's present.

## Endpoints (auth: Clerk JWT, same as the rest)

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/wellness` | — | `200` → **array** of the records above (ideally last ~60 days, ascending by date). Empty array if none. |
| `PUT` | `/api/wellness/{date}` | one record (see above) | `200`/`201` → the stored record. **Upsert** on `(user, date)`. |
| `DELETE` | `/api/wellness/{date}` | — | `204` |

`GET` with no records → `200 []` (the frontend treats a non-array/΄error as "offline,
keep cache", so an empty list is important — don't 404). `401` without a token, like
everything else. CORS: same allow-list as the other routes.

## Two ways to implement — the frontend consumes the same `GET` either way

- **(A) Storage** (recommended first, mirrors plan/log/move): a `wellness` table keyed
  by `(user_id, date)` with a filtered-unique active index, `PUT` upserts, `GET` lists.
  Straightforward and matches the existing `Npgsql*` repo pattern.
- **(B) intervals.icu proxy** (the roadmap item in `BACKEND_HANDOFF.md`): `GET` fetches
  the last N days from intervals.icu server-side (holding the API key) and returns the
  same shape. `PUT`/`DELETE` can be no-ops or 405 in this mode.

They compose: build **A** now for cross-device manual entry; when the proxy lands, it
can write intervals.icu data **into the same store**, so `GET` stays identical and the
frontend never changes.

## Suggested schema (option A)

```sql
CREATE TABLE wellness (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id),
  date          date NOT NULL,
  hrv           real, rhr real, sleep_h real, sleep_score real,
  ctl real, atl real, tsb real,
  created_at_utc timestamptz NOT NULL,
  updated_at_utc timestamptz NOT NULL,
  deleted_at_utc timestamptz
);
CREATE UNIQUE INDEX ux_wellness_user_date_active
  ON wellness (user_id, date) WHERE deleted_at_utc IS NULL;
```

## Frontend behavior once it's live

- On sign-in: `GET /api/wellness` → merged with any local records (server wins per
  date), local-only days migrated up via `PUT`. Readiness "just works" across devices.
- On manual entry (the readiness sheet): `PUT /api/wellness/{date}` in the background.
- No endpoint yet → the calls fail silently and the app keeps using localStorage, so
  there's zero rush and zero breakage in the meantime.
