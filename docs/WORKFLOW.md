# How Try gets built: the multi-agent workflow

Standing process from 2026-07-12 (Jon: use ultracode going forward, and always
check for security holes, logical bugs and naming conventions). This document
is the contract for how substantive changes move from idea to production.
docs/CODE_AUDIT.md remains the deep-audit companion; this is the per-change
pipeline that makes those audits find less.

## When it applies

- **Full pipeline:** new features, engine changes, sync/data-shape changes,
  backend PRs, investigations, and anything touching money-equivalent data
  (health data, credentials, the athlete's log).
- **Solo fast-path:** copy tweaks, one-line fixes, doc edits, conversational
  work. Orchestration is for surface area, not one-liners — but even the
  fast-path gets the review gauntlet below when it touches logic.

## The pipeline

**1. Design (parallel perspectives, features only).** Independent takes on the
approach (athlete-first, engine-first, simplest-thing) compared before code is
written. Output: the chosen shape and what was rejected, in one paragraph.

**2. Implement.** One context builds it, tests-first where the engine is
involved. House rules apply: determinism, missing-data-stays-quiet,
concept-level user copy (the proprietary line), no silent server writes.

**3. The review gauntlet (ALWAYS, before any push).** Parallel reviewers,
each with one job and no other loyalties:

- **Security:** secrets or health data headed for the public repo; third-party
  strings reaching dangerous sinks; injection into intervals.icu payloads
  (the `- ` step-line rule); anything weakening the write-only credential
  posture or the Clerk boundary; new localStorage data more sensitive than
  what already lives there.
- **Logic:** off-by-direction comparisons (faster pace = lower seconds), null
  and NaN propagation, date/timezone edges, state races, the imperfect-use
  timelines from docs/CODE_AUDIT.md (wandering pointers, mid-flow navigation,
  stale PWA bundles, data sources that stop).
- **Conventions:** frontend, the repo's own idiom; backend, Jack's rules end
  to end, not the nearest similar file — every migration registers itself in
  `schema_migrations`, full-word C# names (client models mirror intervals.icu
  JSON exactly), unit-suffixed columns (`weight_kg`), bounded quantities as
  `numeric(p,s)` with CHECK constraints. This reviewer exists because copying
  nearby code shipped `AvgHr` and an unregistered migration.
- **Honest-data:** does anything estimated masquerade as measured, guess when
  data is missing, or claim precision the inputs cannot support.

**4. Adversarial verification.** Every finding from stage 3 gets an
independent skeptic trying to refute it before it reaches Jon or becomes a
fix. Auditors inflate; verified severity decides what blocks the ship.
False positives get named, not silently dropped.

**5. Ship and verify.** Tests green, build clean, push, watch the deploy by
commit hash, verify a minification-surviving marker in the live bundle (one
re-dispatch on a cancelled Pages run). Backend PRs: build + full test suite +
the conventions pass before the PR opens.

**6. Learn.** Field reports and review catches become permanent cases in
docs/CODE_AUDIT.md and standing rules in memory, so the same class of miss
cannot recur quietly.

## Periodic deep audit

The full four-dimension audit (docs/CODE_AUDIT.md) still runs after feature
clusters — the gauntlet reviews each change; the audit reviews what the
changes add up to.
