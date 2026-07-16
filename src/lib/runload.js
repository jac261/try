/* Try — run mechanical load: the per-discipline signal behind rule RUN1.
 *
 * Running injury risk tracks time-on-feet, not cardiovascular stress, so the
 * currency here is MINUTES of logged running — deliberately not estimateTss,
 * whose IF² weighting is cardio-metabolic (it rates a 60-minute sweet-spot
 * turbo above a 60-minute easy run, the inverse of mechanical truth). Minutes
 * come from the athlete's own log: the recorded moving time when a recording
 * matched, otherwise the planned duration with the adjustment overlay applied
 * the same way estimateTss applies it. Log-only by design — no wellness store,
 * no freshness gate — so it works identically for sensor-less athletes and
 * for intervals.icu users with a stale sync.
 *
 * The signal is a percent ramp: the acute 7-day run load against an UNCOUPLED
 * trailing baseline (the four complete weeks before the acute week, clipped
 * to the plan's history), so a big current week can never inflate its own
 * denominator. It is presented as a ramp percent with our own named
 * constants, never as an ACWR verdict — those sweet-spot/danger thresholds
 * are contested territory.
 */
import { iso, addDays } from './date.js';
import { DISCIPLINE } from './autolog.js';

// Percent, not absolute: run load is small and the aggregate ramp's CTL/week
// vocabulary does not translate. Deliberately looser than the folklore "10%
// rule": weekly run minutes are naturally jumpy (biweekly long runs, one
// missed session) and 10% would fire constantly — and the rule itself has
// weak direct trial support (graded 10% progression didn't reduce injuries
// in Buist et al.; Nielsen's work points at large ~30%+ jumps). These are
// conservative guardrails, not laws. The minWeeklyMin floor kills small-base
// noise AND divide-by-near-zero in one move; if field reports show
// over-firing, raise the floor before touching the percents.
export const RUN_RAMP_RULES = {
  buildPct: 0.30,      // sustained two-week ramp above this → propose easing
  riskPct: 0.50,       // single-week ramp above this → propose easing now
  minWeeklyMin: 60,    // baselines thinner than an hour a week judge nothing
  minBaselineWeeks: 2, // complete baseline weeks required before any verdict
  trimRun: 0.7,        // the proposed run trim, mirroring the aggregate rules
};

// The single-session sibling of the ramp rules: weekly volume can look calm
// while one scheduled long run leaps far past anything the legs have done
// lately — the classic overuse vector (Nielsen's work points at large
// single-step jumps, not gentle weekly drift). Same conservative-guardrail
// stance as RUN_RAMP_RULES: floors kill small-base noise, thin history stays
// silent, and the proposed cap steps the session up rather than gutting it.
export const LONG_RUN_RULES = {
  jumpPct: 0.4,       // an upcoming run this far above the recent longest fires
  capPct: 0.25,       // the proposed trim lands at longest recent + this step
  lookbackDays: 28,   // "recent longest" means the trailing four weeks
  minRuns: 2,         // fewer logged runs than this in the window judge nothing
  minLongestMin: 40,  // a longest run under this floor judges nothing
  minFactor: 0.6,     // never propose cutting a session below this share
};

// → { upcoming: {id, date, min, title}, longestMin, jumpPct } or null.
// Measurement only — week-phase policy (taper, recovery, race) lives with the
// rule in adapt.js. Candidates must be unlogged and unadjusted (an accepted
// adjustment is the athlete's call and is never re-proposed over, G3);
// history minutes prefer the recorded time exactly like runLoadSignal.
export function longRunJumpSignal({ plan, log, moves, adjust, todayISO }) {
  if (!plan || !Array.isArray(plan.weeks) || !plan.weeks.length) return null;
  const today = todayISO || iso(new Date());
  // The log is plan-scoped, so a young plan has no visibility of what the
  // legs did before it existed: an athlete who ran 90-minute longs for years
  // would read as jumping in week one. Until the lookback window fits fully
  // inside the plan's own history, the signal cannot judge and stays silent
  // (the generator's early progression is trusted by design).
  const planStart = plan.weeks[0].start;
  if (!planStart) return null;
  const from = iso(addDays(today, -LONG_RUN_RULES.lookbackDays));
  if (from < planStart) return null;
  const eff = w => (moves && moves[w.id]) || w.date;
  const runs = plan.weeks.flatMap(wk => wk.workouts)
    .filter(w => w.discipline === 'run' && !w.race);
  let longestMin = 0, logged = 0;
  runs.forEach(w => {
    const entry = (log || {})[w.id];
    if (!entry || !entry.done) return;
    const d = eff(w);
    if (d < from || d > today) return;
    logged++;
    let m = entry.actualMin != null ? entry.actualMin : (w.durationMin || 0);
    if (entry.actualMin == null) {
      const adj = (adjust || {})[w.id];
      if (adj) m *= adj.kind === 'ease' ? 0.65 : (adj.factor || 1);
    }
    if (m > longestMin) longestMin = m;
  });
  if (logged < LONG_RUN_RULES.minRuns || longestMin < LONG_RUN_RULES.minLongestMin) return null;

  const horizon = iso(addDays(today, 7));
  let upcoming = null;
  runs.forEach(w => {
    // Tests and tune-up races count as pounding in the history above, but
    // are never trim CANDIDATES: G2 says a test is moved, never softened,
    // and a scheduled race effort is the athlete's to run as planned.
    if (w.test || w.bRace) return;
    if ((log || {})[w.id] || (adjust || {})[w.id]) return;
    const d = eff(w);
    if (d < today || d > horizon) return;
    const m = w.durationMin || 0;
    if (!upcoming || m > upcoming.min) upcoming = { id: w.id, date: d, min: m, title: w.title || w.type };
  });
  if (!upcoming) return null;

  return {
    upcoming, longestMin: Math.round(longestMin),
    // unrounded, same reasoning as rampPct: thresholds compare on this live
    jumpPct: upcoming.min / longestMin - 1,
  };
}

// → { acute7d, baselineWeekly, rampPct } or null when history is too thin.
// acute7d is deliberately display-ready: it is the future injury-risk tile's
// input on the athlete state strip.
export function runLoadSignal({ plan, log, moves, adjust, todayISO }) {
  if (!plan || !Array.isArray(plan.weeks) || !plan.weeks.length) return null;
  const today = todayISO || iso(new Date());
  const planStart = plan.weeks[0].start;
  if (!planStart) return null;

  const minutesOf = w => {
    const entry = (log || {})[w.id];
    if (!entry || !entry.done) return 0; // only what was actually run counts
    if (entry.actualMin != null) return entry.actualMin;
    let m = w.durationMin || 0;
    const adj = (adjust || {})[w.id];
    if (adj) m *= adj.kind === 'ease' ? 0.65 : (adj.factor || 1);
    return m;
  };
  const eff = w => (moves && moves[w.id]) || w.date;
  // Tests are real pounding and count; brick legs are excluded (the log holds
  // one whole-session time with no run split — attributing planned splits
  // against actual times would be dishonest, and the undercount fails toward
  // silence, the safe direction). A raced tune-up run is pounding too.
  const runs = plan.weeks.flatMap(wk => wk.workouts)
    .filter(w => w.discipline === 'run' && !w.race);
  const sum = (from, to) => runs.reduce((s, w) => {
    const d = eff(w);
    return d > from && d <= to ? s + minutesOf(w) : s;
  }, 0);

  const acuteRaw = sum(iso(addDays(today, -7)), today);

  // Baseline: complete 7-day blocks inside (today-35, today-7], clipped to
  // the plan's own history. Uncoupled from the acute week by construction.
  // A block with ZERO logged run minutes is skipped, not averaged in: an
  // unlogged week is indistinguishable from an unrun one (holiday, forgot
  // the app), and averaging zeros deflates the baseline so a plain return
  // to normal running reads as a dangerous ramp. Gaps fail toward silence.
  let blocks = 0, total = 0;
  for (let b = 1; b <= 4; b++) {
    const to = iso(addDays(today, -7 * b));
    const from = iso(addDays(today, -7 * (b + 1)));
    if (iso(addDays(today, -7 * (b + 1) + 1)) < planStart) break; // incomplete block
    const wk = sum(from, to);
    if (wk === 0) continue; // gap week
    blocks++;
    total += wk;
  }
  if (blocks < RUN_RAMP_RULES.minBaselineWeeks) return null;
  const baselineWeekly = total / blocks;
  if (baselineWeekly < RUN_RAMP_RULES.minWeeklyMin) return null;

  return {
    acute7d: Math.round(acuteRaw),
    baselineWeekly: Math.round(baselineWeekly),
    // Unrounded on purpose: the threshold compares live on this value, and
    // quantizing before a strict > would quietly shift the effective
    // thresholds above their stated ones. Round at display, not here.
    rampPct: acuteRaw / baselineWeekly - 1,
  };
}

// The tracker-mode sibling of runLoadSignal: with no plan weeks the diary
// (feed recordings and manual entries alike) carries the run history, so the
// same acute-vs-uncoupled-baseline ramp reads straight off activity minutes.
// Same currency (minutes, not TSS), same floors, same unrounded rampPct.
// → { acute7d, baselineWeekly, rampPct } or null when history is too thin.
export function runLoadFromActivities({ activities, todayISO }) {
  const today = todayISO || iso(new Date());
  const runs = (activities || []).filter(a => a && a.date && a.movingTimeSec && DISCIPLINE[a.type] === 'run');
  if (!runs.length) return null;
  const sum = (from, to) => runs.reduce((s, a) => (a.date > from && a.date <= to ? s + a.movingTimeSec / 60 : s), 0);
  const acuteRaw = sum(iso(addDays(today, -7)), today);
  // Baseline: the four complete weeks before the acute week, skipping empty
  // ones (a holiday week judges nothing) — uncoupled, like runLoadSignal.
  let blocks = 0, total = 0;
  for (let b = 1; b <= 4; b++) {
    const to = iso(addDays(today, -7 * b)), from = iso(addDays(today, -7 * (b + 1)));
    const wk = sum(from, to);
    if (wk === 0) continue;
    blocks++; total += wk;
  }
  if (blocks < RUN_RAMP_RULES.minBaselineWeeks) return null;
  const baselineWeekly = total / blocks;
  if (baselineWeekly < RUN_RAMP_RULES.minWeeklyMin) return null;
  return {
    acute7d: Math.round(acuteRaw),
    baselineWeekly: Math.round(baselineWeekly),
    rampPct: acuteRaw / baselineWeekly - 1,
  };
}
