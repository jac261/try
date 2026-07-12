# How Try gets built: the multi-agent workflow

Standing process since 2026-07-12. Every substantive change runs the
multi-agent pipeline below (Jon calls it "ultracode"): parallel design, then
review for security holes, logical bugs and naming conventions before any
push. docs/CODE_AUDIT.md remains the deep-audit companion: the audit runs
after feature clusters and reviews what the changes add up to; the gauntlet
here runs per change, so those audits find less.

## Routing: full pipeline or fast path

Take the **full pipeline** whenever a change edits code in `lib/` or `app/`,
touches any backend PR, alters a data shape or storage key, or changes
user-facing copy about how the engine reasons. Take the **fast path** only
when it touches none of those (pure styling, typo or doc edits, chat). If in
doubt, take the full pipeline. Even skipping orchestration, a fast-path change
still needs the test suite green and a build check before it ships.

## The pipeline

**1. Design (parallel perspectives, features only).** Independent takes on the
approach (athlete-first, engine-first, simplest-thing) compared before code is
written. Output: the chosen shape and what was rejected, in one paragraph.

**2. Implement.** One context builds it, tests-first where the engine is
involved, and before building against any intervals.icu or backend field,
probe the live response for every sport that can produce it — never assume a
field's units or presence from a single sport (the 359 W running-power
incident). House rules apply: determinism, missing-data-stays-quiet, no
silent server writes, and concept-level user copy only — never expose engine
internals or parameters in user-facing text or commit messages (the
proprietary line).

**3. The review gauntlet (ALWAYS, before any push).** Parallel reviewers,
each with one job and no other loyalties (fan out one read-only subagent per
reviewer, as in docs/CODE_AUDIT.md — do not self-review all four lenses in
one pass):

- **Security:** secrets or health data headed for the public repo;
  third-party strings reaching dangerous sinks; injection into intervals.icu
  payloads (a pushed description line must not start with `- `, which the API
  parses as a structured step); anything weakening the write-only credential
  posture (the server holds the athlete's intervals.icu key and never echoes
  it) or the Clerk boundary; new localStorage data more sensitive than what
  already lives there.
- **Logic:** off-by-direction comparisons (faster pace = lower seconds), null
  and NaN propagation, date/timezone edges, state races, the imperfect-use
  timelines from docs/CODE_AUDIT.md (wandering pointers, mid-flow navigation,
  stale PWA bundles, data sources that stop).
- **Conventions:** frontend, the repo's own idiom; backend, Jack's rules end
  to end, not the nearest similar file — every migration registers itself in
  `schema_migrations`, full-word C# names (client models mirror intervals.icu
  JSON exactly), unit-suffixed columns (`weight_kg`), bounded quantities as
  `numeric(p,s)` with CHECK constraints. This reviewer exists because copying
  nearby code shipped `AvgHr` and an unregistered migration. That list is the
  known-recurring subset, not the whole ruleset: when a backend convention is
  unclear, check the JackGilham/try-backend repo or ask Jack rather than
  infer from a nearby file.
- **Honest-data:** does anything estimated masquerade as measured, guess when
  data is missing, or claim precision the inputs cannot support.

**4. Adversarial verification.** Every finding from stage 3 gets an
independent skeptic trying to refute it before it reaches Jon or becomes a
fix. Auditors inflate; verified severity decides what blocks the ship:
critical blocks the push until fixed; high is fixed the same day or logged as
a tracked follow-up before pushing; medium and low ship and go in the report
(same grades as docs/CODE_AUDIT.md). False positives get named, not silently
dropped. A reviewer reporting no findings is a prompt to spot-check that
dimension by hand, not a pass — the manually-entered-TSB clobber was caught
only after the sync reviewer came back clean.

**5. Ship and verify.** Before a frontend change ships, any new workout type,
role, discipline or adjustment kind must already have its matching
PlanCatalog allow-list entry merged in the backend — catalog drift silently
rejects every plan write for affected accounts (the 2026-07-08 Fartlek
incident). Then: tests green, build clean, push, watch the deploy by commit
hash, verify a minification-surviving marker in the live bundle (one
re-dispatch on a cancelled Pages run). Backend PRs: build + full test suite +
the conventions pass before the PR opens.

**6. Learn.** Field reports and review catches become permanent cases in
docs/CODE_AUDIT.md and standing rules in memory — and, where the code path is
testable, a regression test that fails without the fix, so "tests green" in
stage 5 actually covers the class of miss.
