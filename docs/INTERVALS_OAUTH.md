# intervals.icu OAuth: spec for the backend

Replaces the paste-your-API-key ritual with a one-tap "Connect intervals.icu"
button. Same integration surface as today (Jack's passthrough stays the single
door to intervals data); only the credential and how we obtain it change.
Written 2026-07-11; the frontend half is ready to build against this contract.

## Why

- Onboarding: normal users will not find and paste an API key. One tap, a
  consent screen on intervals.icu, done.
- Consent and revocation: the athlete sees exactly what Try can touch and can
  revoke from their intervals.icu settings at any time.
- Scoped access: an API key is all-or-nothing; OAuth grants only the scopes we
  use.

## Registration (one-time, Jack)

intervals.icu OAuth clients are granted on request by the maintainer (David
Tinker) rather than self-service: ask via the intervals.icu forum (the "OAuth
applications" thread) for a client for Try. Provide the app name, a logo if we
have one, and the redirect URI below. Store the issued `client_id` and
`client_secret` in Railway env vars (`INTERVALS_OAUTH_CLIENT_ID`,
`INTERVALS_OAUTH_CLIENT_SECRET`).

NOTE: endpoint paths and scope names below follow the intervals.icu forum
documentation as best known; verify them against the current official thread
when registering. They are the only to-verify items in this spec.

- Authorize: `https://intervals.icu/oauth/authorize`
- Token exchange: `https://intervals.icu/api/oauth/token`
- Scopes we need, mapped to the passthrough endpoints we already serve:
  - wellness read (GET wellness / readiness sync)
  - activity read (activities passthrough, fitness watcher, review averages)
  - settings read (sport settings for the thresholds endpoint)
  - calendar write (planned-events reconcile, workouts-to-watch)
- Tokens are long-lived bearer tokens (no refresh flow, per the forum docs);
  handle 401 as "revoked" and mark the connection disconnected.

## Backend endpoints (new)

1. `GET /api/integrations/intervals-icu/oauth/start` (Clerk-authed)
   - Generates `state`: an opaque signed value binding the Clerk user id and a
     timestamp (HMAC with an existing server secret; 10-minute validity).
   - 302 to the authorize URL with `client_id`, `redirect_uri`, `scope`,
     `state`.

2. `GET /api/integrations/intervals-icu/oauth/callback?code=&state=`
   - Unauthenticated route (the browser arrives from intervals.icu), so the
     signed `state` is the authentication: verify signature and freshness,
     recover the user id. Reject anything else.
   - Exchange `code` at the token endpoint (client id + secret, server side).
   - Store the access token and the athlete id (from the token response, or
     one `GET /api/v1/athlete` call with the new token) against the user,
     exactly where the API key lives today: write-only, never echoed.
   - 302 back to the app (`https://jac261.github.io/try/?intervals=connected`
     on success, `?intervals=error` on failure). The redirect target should be
     a config value so the future custom domain is one env change.

3. `DELETE /api/integrations/intervals-icu` (exists or extend): also clears
   the OAuth token.

## Credential model and migration

- Add a nullable `oauth_token` alongside the existing `api_key` on the
  intervals connection record.
- The client picks per request: OAuth bearer when present, else the legacy
  API key (`Authorization: Bearer <token>` vs the current basic auth). Prefer
  OAuth when both exist.
- No breaking change: Jon's existing API-key connection keeps working
  untouched. The connection-status response gains `method: "oauth" | "apikey"`
  so the frontend can offer an upgrade nudge later.

## Security notes

- `state` is mandatory and signed; never accept a callback without it (CSRF).
- Token stored server-side only, same write-only posture as the API key.
- The callback must only redirect to the allow-listed app origin, never to a
  URL taken from the request.
- 401 from intervals.icu with an OAuth token means revoked: mark disconnected
  and surface it in the status endpoint rather than retrying forever.

## Frontend half (Try, ready once the endpoints exist)

- Settings connection card: "Connect intervals.icu" button opens
  `/oauth/start` (full-page redirect). On return, `?intervals=connected`
  triggers the existing status refetch and wellness sync; the API-key field
  remains as an "advanced" fallback until OAuth is proven.
- No frontend secrets, no token handling in the browser at any point.

## Test checklist (backend)

- start: 302 carries all params; state validates and expires.
- callback: bad state 400s; happy path stores token and redirects; token
  exchange failure redirects with `?intervals=error` and stores nothing.
- passthrough endpoints work identically through either credential.
- disconnect clears both credential kinds.
