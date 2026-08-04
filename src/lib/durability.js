/* Try — durability: does the athlete hold output late in long sessions?
 * (Coach brain pass 2; docs/PROGRESSION_SPEC.md section 6.4.)
 *
 * A read compares the first and final thirds of a long session's lap rows:
 * output (watts for rides, pace for runs), heart rate, and efficiency
 * (output per heartbeat). Everything here is defensive because auto-laps
 * are messy real-world data (design panel verified against live recordings,
 * 2026-07-20):
 *
 * - Windows are cut by cumulative moving TIME, and every mean is
 *   time-weighted: power and heart rate are time-domain quantities, and
 *   distance-weighting overweights fast, easy laps, exactly backwards for a
 *   fatigue read. Run output per window is total distance over total time.
 * - An embedded stop contaminates a single auto-lap (verified: a mid-run
 *   break collapsed one lap to half speed); laps outside 60 to 160% of the
 *   session's median lap speed are excluded before windowing.
 * - A window dominated by one lap is too coarse to trust: any lap holding
 *   more than 40% of a window's time voids the read.
 * - Efficiency uses only laps carrying BOTH watts and heart rate, at least
 *   two per window, or it stays null: sensor dropout must not quietly move
 *   the metric onto a different lap subset than its siblings.
 * - A planned session whose own structure scripts a pace change late (fast
 *   finish, threshold on tired legs, an ease-home tail) would read as a
 *   durability signal in either direction while the athlete simply followed
 *   the card. Only steady-bodied planned sessions qualify; unplanned
 *   recordings qualify with the hedge (no card told them to surge).
 *
 * What this module cannot see, and the copy must keep saying so: terrain,
 * temperature, wind and fuelling. One read is never a claim; the pattern
 * over weeks is the product.
 */

import { iso, startOfWeekMonday } from './date.js';

// Bump when read logic or thresholds change: stored reads carry the version
// they were computed under.
export const DURABILITY_RULE_VERSION = 1;

// Session gates sit UNDER the sprint tier's own prescribed longs (run 55,
// ride 70, swim 40 minutes), so every race distance's long sessions can
// qualify.
//
// Swim reads flow through the same pace branch as runs, and the honesty
// gates below do the rest of the work unaided: a drill-heavy session loses
// its drill laps to the outlier filter and then fails minCoverage, so only
// a genuinely continuous swim ever produces a read. That is the intent —
// the question "how did this long swim end" is only meaningful when the
// swim was actually swum straight through. Pool HR is usually absent, which
// surfaces honestly as hrMissing rather than as a missing read.
export const DURABILITY_GATES = {
  bike: { minMovingSec: 65 * 60 },
  run: { minMovingSec: 50 * 60 },
  swim: { minMovingSec: 35 * 60 },
  minLaps: 6,
  minCoverage: 0.8,      // usable laps must span this share of the session
  outlierLo: 0.6,        // lap speed vs median lap speed
  outlierHi: 1.6,
  maxLapShare: 0.4,      // one lap may hold at most this share of a window
  minEfLapsPerWindow: 2,
};

/* What the athlete's own name for a session says about whether it is a long
   one. Two-sided by Jon's call (2026-08-04) after the rule was measured
   against 60 days of his real recordings.
 *
 * The duration gates above cannot separate a long run from an ordinary one:
 * they sit five minutes below the shortest long run Try prescribes, so a
 * 58-minute easy 10k clears them. Neither can the plan, because an athlete
 * following an externally-written plan records whatever that plan asked for
 * on the day Try scheduled a long session, and the matcher is happy to pair
 * them. The name is the only field that says what the session WAS.
 *
 * `refuses` alone would be too weak (nothing would ever be admitted against
 * the plan) and `admits` alone far too strong: measured on Jon's history,
 * requiring the word "long" kept 2 recordings out of 60 days and threw away
 * his 2h26 club ride and both his 20 km long runs, because Garmin named them
 * "Bristol Road Cycling" and "Afternoon Run". Most sessions say nothing
 * either way, and for those the role and longest-of-week rules still decide.
 *
 * ADMIT BEATS REFUSE, and that ordering is load-bearing: "Long run — 75min
 * easy (Z2, cornerstone)" is a real long run in Jon's history that a
 * refuse-first reading would discard. */
export const SESSION_NAME_RULES = {
  admits: /\blong\b/i,
  refuses: /\b(easy|recovery|technique|drills?|shake\s?out|spin|warm\s?up|cool\s?down)\b/i,
};

// true = a long session whatever else says; false = never a long session;
// null = no opinion, so the caller's own rules decide.
export function sessionNameVerdict(name) {
  const s = typeof name === 'string' ? name : '';
  if (SESSION_NAME_RULES.admits.test(s)) return true;
  if (SESSION_NAME_RULES.refuses.test(s)) return false;
  return null;
}

/* Reads chosen under the OLD rule, dropped once the new one exists.
 *
 * A selection rule that only applies going forward leaves yesterday's wrong
 * answers on screen, and the card cannot tell them apart from right ones —
 * the store keeps no name, only an activity id. So the feed is the judge:
 * an entry whose recording is still in it and whose name now refuses is
 * dropped, and an entry the feed no longer covers is kept, because "I cannot
 * check" is not the same as "it fails". Those age out through the 40-entry
 * cap on their own. */
export function purgeRefusedReads(entries, activities) {
  const feed = new Map((Array.isArray(activities) ? activities : []).map(a => [a.id, a]));
  return (entries || []).filter(e => {
    const a = e && feed.get(e.activityId);
    return !a || sessionNameVerdict(a.name) !== false;
  });
}

// Verdict bands, anchored to the aerobic-decoupling convention (roughly 5%
// meaningful, double for hard). Output fades slightly wider: modest late
// slowing is normal pacing, not collapse.
export const DURABILITY_BANDS = {
  output: { strong: 4, faded: 9 },
  drift: { strong: 5, faded: 10 },
};

// A fade the coach veto may trust: output AND the cardiac picture both past
// the hard band. Pure predicate over a stored read, so rule-version-1 reads
// qualify retroactively and DURABILITY_RULE_VERSION does not bump (no read
// output changes). hrMissing can never pass (drift is null and EF needs HR).
// Runs rest on drift alone (EF is bike-only): a hot day can still pass,
// which is why the coach caps the cost at one deferred call per event.
export function fadeChannels(read) {
  const drift = !!(read && read.hrDriftPct != null && read.hrDriftPct > DURABILITY_BANDS.drift.faded);
  const ef = !!(read && read.hrDriftPct != null && read.efDropPct != null && read.efDropPct > DURABILITY_BANDS.drift.faded);
  return {
    output: !!(read && read.outputDropPct > DURABILITY_BANDS.output.faded),
    cardiac: drift || ef,
    // which cardiac channel fired, so copy can tell the truth per case: an
    // EF-only trigger must never be narrated as a climbing heart rate
    drift,
  };
}
export function fadeCorroborated(read) {
  const c = fadeChannels(read);
  return c.output && c.cardiac;
}

// The planned session's body is steady when every non-warmup, non-cooldown
// segment shares one zone with no mixed-zone blocks. Fast-finish and
// tired-legs variants fail this and are skipped on purpose.
export function planBodySteady(workout, leg) {
  if (!workout || !Array.isArray(workout.segments)) return true; // unplanned: no card scripted a change
  const body = workout.segments.filter(s => {
    const l = (s.label || '').toLowerCase();
    if (l.includes('warm') || l.includes('cool') || l.includes('ease home')) return false;
    // a brick candidate is judged by the leg actually being read, never the
    // whole two-sport card (gauntlet catch 2026-07-20)
    if (leg === 'bike') return /^(bike|round \d+ .{0,3}bike)/i.test(s.label || '');
    return true;
  });
  if (!body.length) return false;
  const zones = new Set();
  for (const s of body) {
    if (s.zone) zones.add(s.zone);
    for (const b of s.blocks || []) if (b.zone) zones.add(b.zone);
  }
  return zones.size <= 1;
}

const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);

/* The honesty gates, once. Extracted so the durability SHAPE selectors
   (durability-shape.js, the design's per-sport charts) run the session
   through the identical filter the read does — one implementation, so a card
   and the verdict above it can never disagree about which laps counted.
   Returns null on any gate failure, exactly as the read did inline. */
export function usableDurabilityLaps({ rows, discipline, movingTimeSec }) {
  const gate = DURABILITY_GATES[discipline];
  if (!gate || !Array.isArray(rows) || !movingTimeSec) return null;
  if (movingTimeSec < gate.minMovingSec) return null;

  const laps = rows.filter(r => r && r.type === 'WORK'
    && r.movingTimeSec > 0 && r.distance > 0 && r.averageSpeed > 0)
    // Never trust array order as time order: a reversed passthrough would
    // read real fatigue as improvement (gauntlet catch 2026-07-20, proven
    // by inverting a fixture). Rows without a start time keep their
    // relative order.
    .sort((a, b) => (a.startTimeSec ?? 0) - (b.startTimeSec ?? 0));
  if (laps.length < DURABILITY_GATES.minLaps) return null;

  // outlier filter: an embedded stop poisons one lap's averages. True
  // median (even-length arrays average the middle pair): the upper-middle
  // shortcut misread an out-and-back's slow half as outliers.
  const speeds = laps.map(l => l.averageSpeed).sort((a, b) => a - b);
  const mid = speeds.length / 2;
  const median = speeds.length % 2 ? speeds[Math.floor(mid)] : (speeds[mid - 1] + speeds[mid]) / 2;
  const usable = laps.filter(l =>
    l.averageSpeed >= median * DURABILITY_GATES.outlierLo
    && l.averageSpeed <= median * DURABILITY_GATES.outlierHi);
  if (usable.length < DURABILITY_GATES.minLaps) return null;
  const usedSec = sum(usable, l => l.movingTimeSec);
  if (usedSec < movingTimeSec * DURABILITY_GATES.minCoverage) return null;
  return { usable, usedSec };
}

// One long recording's lap rows → a read, or null whenever any honesty gate
// fails. rows are the intervals passthrough shape; discipline 'bike'|'run'.
export function durabilityRead({ rows, discipline, movingTimeSec }) {
  const gated = usableDurabilityLaps({ rows, discipline, movingTimeSec });
  if (!gated) return null;
  const { usable, usedSec } = gated;

  // thirds by cumulative moving time over the usable laps, in recorded order
  const third = usedSec / 3;
  const first = [], last = [];
  let acc = 0;
  for (const l of usable) {
    if (acc < third) first.push(l);
    if (acc + l.movingTimeSec > usedSec - third) last.push(l);
    acc += l.movingTimeSec;
  }
  const windowOk = w => w.length > 0
    && !w.some(l => l.movingTimeSec > sum(w, x => x.movingTimeSec) * DURABILITY_GATES.maxLapShare);
  if (!windowOk(first) || !windowOk(last)) return null;

  const timeMean = (w, f) => {
    const rows2 = w.filter(l => f(l) != null);
    const t = sum(rows2, l => l.movingTimeSec);
    return t > 0 ? sum(rows2, l => f(l) * l.movingTimeSec) / t : null;
  };
  // run output is total distance over total time, not a mean of lap speeds
  const output = w => discipline === 'bike'
    ? timeMean(w, l => l.averageWatts)
    : sum(w, l => l.distance) / sum(w, l => l.movingTimeSec);

  const o1 = output(first), o2 = output(last);
  if (o1 == null || o2 == null || o1 <= 0) return null;
  const outputDropPct = Math.round((1 - o2 / o1) * 1000) / 10;

  const h1 = timeMean(first, l => l.averageHeartrate);
  const h2 = timeMean(last, l => l.averageHeartrate);
  const hrDriftPct = h1 && h2 ? Math.round((h2 / h1 - 1) * 1000) / 10 : null;

  // efficiency: only laps carrying BOTH signals, enough of them per window
  let efDropPct = null;
  const both = w => w.filter(l => l.averageWatts != null && l.averageHeartrate != null);
  const eb1 = both(first), eb2 = both(last);
  if (discipline === 'bike'
    && eb1.length >= DURABILITY_GATES.minEfLapsPerWindow
    && eb2.length >= DURABILITY_GATES.minEfLapsPerWindow) {
    const ef = w => timeMean(w, l => l.averageWatts) / timeMean(w, l => l.averageHeartrate);
    const e1 = ef(eb1), e2 = ef(eb2);
    if (e1 > 0 && e2 > 0) efDropPct = Math.round((1 - e2 / e1) * 1000) / 10;
  }

  return {
    ruleVersion: DURABILITY_RULE_VERSION,
    outputDropPct, hrDriftPct, efDropPct,
    // The read says what it could NOT see as loudly as what it could: a
    // held-strong from output alone is a narrower claim, and the card must
    // say so (gauntlet catch: silence here read as optimism).
    hrMissing: hrDriftPct == null,
    band: bandFor(outputDropPct, hrDriftPct, efDropPct),
  };
}

// Efficiency drift shares the drift thresholds: watts per heartbeat decaying
// is the same physiology the HR bands watch, seen from the other side.
function bandFor(outputDropPct, hrDriftPct, efDropPct) {
  const o = outputDropPct, h = hrDriftPct == null ? 0 : hrDriftPct;
  const e = efDropPct == null ? 0 : efDropPct;
  if (o > DURABILITY_BANDS.output.faded || h > DURABILITY_BANDS.drift.faded || e > DURABILITY_BANDS.drift.faded) return 'faded-hard';
  if (o > DURABILITY_BANDS.output.strong || h > DURABILITY_BANDS.drift.strong || e > DURABILITY_BANDS.drift.strong) return 'faded-a-little';
  return 'held-strong';
}

export const DURABILITY_BAND_LABELS = {
  'held-strong': 'held strong',
  'faded-a-little': 'faded a little',
  'faded-hard': 'faded hard',
};

/* Which sessions count as "the long one".
 *
 * Run and bike carry role === 'long' in every plan template, so a planned
 * week names its own long sessions and this helper is not needed there.
 * Two cases have no role to read: swim, whose templates carry a long slot
 * only when swim is the athlete's weakest discipline, and tracker mode,
 * which has no plan at all. For those, the week's longest session IS the
 * long one.
 *
 * "Above the gate" is the second half of the rule and it matters: without
 * it, a week holding nothing but short sessions would promote its least
 * short one and call a 30-minute jog a long run. A week with no genuinely
 * long session should yield nothing, which is what this does.
 *
 * items: [{ id, date, discipline, movingTimeSec }] in any order.
 * Returns a Set of qualifying ids.
 */
export function longestOfWeek(items) {
  const best = new Map();
  for (const it of items || []) {
    if (!it || !it.id || !it.date || !it.discipline) continue;
    const gate = DURABILITY_GATES[it.discipline];
    const sec = it.movingTimeSec || 0;
    if (!gate || sec < gate.minMovingSec) continue;
    const key = it.discipline + '@' + iso(startOfWeekMonday(it.date));
    const prev = best.get(key);
    // Ties break on the earlier date, then the id: two equal-length sessions
    // in one week must not pick differently between renders.
    if (!prev || sec > prev.movingTimeSec
      || (sec === prev.movingTimeSec
        && (it.date < prev.date || (it.date === prev.date && it.id < prev.id)))) {
      best.set(key, { id: it.id, date: it.date, movingTimeSec: sec });
    }
  }
  return new Set([...best.values()].map(b => b.id));
}

/* Which recordings deserve a durability read, newest-and-most-relevant
 * first. Pure: the caller supplies the clock and the store's contents.
 *
 * Extracted from App so the long-session rules above are exercised rather
 * than merely wired. Depends only on lower-level lib helpers, all injected
 * as `deps` to keep this module free of cross-imports it would not
 * otherwise need.
 *
 * plan: the plan, or null/tracker for the no-plan branch
 * have: Set of activity ids already read
 * floor: ISO date below which candidates are out of the window, or null
 */
/* Which stored durability records still need their SHAPE. A record with a
   verdict and NO shape key was read before charts existed (never attempted);
   `shape: null` means attempted and refused, never retried, exactly as
   `read: null` is never retried. So a session is re-read at most once and a
   refusal is final — the one-shot contract from 2026-08-04.

   Shared by the App's sweep and the card's "charts are on their way" note,
   so the promise on screen and the work actually queued cannot drift. */
export function pendingShapeEntries(entries) {
  return (entries || []).filter(e => e && e.read && !('shape' in e));
}

/* The sweep's fetch specs, straight from the store. This deliberately does
   NOT go through durabilityCandidates: that pipeline answers a coaching
   question — which new sessions deserve a verdict — and constrains itself to
   the current plan's logged, matched workouts. A re-read is not that
   question; the stored record already names its recording, and routing it
   through candidate discovery made sessions from earlier plans permanently
   un-re-readable while the note promised otherwise (Jon's 2026-08-04
   "migration slowed" report).

   The activities feed, when it still holds the session, supplies the exact
   movingTimeSec and the swim's pool length. The fallback is durationMin in
   seconds — within 30 s of the truth, harmless against gates with minutes of
   slack at session scale. Pool length has no fallback: a swim outside the
   feed refuses its shape, and that refusal is stored as the honest null. */
export function reshapeQueue(entries, activities) {
  const feed = new Map((Array.isArray(activities) ? activities : []).map(a => [a.id, a]));
  return pendingShapeEntries(entries).map(e => {
    const a = feed.get(e.activityId);
    return {
      activityId: e.activityId,
      discipline: e.discipline,
      movingTimeSec: (a && a.movingTimeSec) || (e.durationMin || 0) * 60,
      poolLengthM: a ? a.poolLengthM : undefined,
    };
  });
}

export function durabilityCandidates({ plan, activities, log, moves, have, floor, todayISO, hour, deps }) {
  if (!Array.isArray(activities)) return [];
  const { DISCIPLINE, planBodySteady, brickPairFor, activityFor, reviewedWeekMonday } = deps;
  const seen = have || new Set();
  const out = [];

  if (plan && plan.race !== 'tracker' && Array.isArray(plan.weeks) && plan.weeks.length) {
    /* Swim has no long role to read: 'swim:long' reaches a template only
       when swim is the athlete's weakest discipline, so keying on role
       would give a card that never fills. The week's longest planned swim
       is the long one instead, judged on PLANNED minutes so the choice
       cannot move when a recording is matched or re-matched. The read's
       own gate still decides whether the recording supports a verdict.
       Run and bike keep their roles untouched. */
    const swimLongIds = longestOfWeek(plan.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline === 'swim' && !w.race && !w.bRace)
      .map(w => ({ id: w.id, date: w.date, discipline: 'swim', movingTimeSec: (w.durationMin || 0) * 60 })));

    plan.weeks.flatMap(w => w.workouts)
      /* Raced sessions are refused EXPLICITLY (design panel 2026-07-30):
         the durability read measures drift under a steady intent, and a
         raced split is pacing by choice, not fatigue resistance. The
         planBodySteady gate below cannot make this call — race cards carry
         no zones, so it would pass them vacuously rather than by
         judgement. This is a PLAN-branch guarantee only: the tracker
         branch below reads raw activities, which carry no race flag, so a
         race ridden in tracker mode is indistinguishable there and its
         read persists across plans (the store spans plans by design). */
      .filter(w => !w.race && !w.bRace
        && ((w.role === 'long' && (w.discipline === 'run' || w.discipline === 'bike'))
          || w.discipline === 'brick' || swimLongIds.has(w.id)) && log[w.id])
      .forEach(w => {
        if (w.discipline === 'brick') {
          // the BIKE leg only, judged by ITS OWN segments: a brick's run
          // leg starts pre-fatigued by design and is deferred
          if (!planBodySteady(w, 'bike')) return;
          const pair = brickPairFor({ workout: w, activities, moves });
          if (pair && !seen.has(pair.ride.id)) out.push({ activity: pair.ride, discipline: 'bike' });
        } else {
          if (!planBodySteady(w)) return;
          const a = activityFor({ workout: w, activities, moves });
          /* The plan says a long run was scheduled; the RECORDING says what
             was actually done. activityFor pairs on discipline, date and a
             0.5x-1.7x duration window, so an easy 10k on the long run's day
             lands inside it and used to be read as the long run. The name
             is the only thing that catches that. */
          if (a && sessionNameVerdict(a.name) === false) return;
          if (a && !seen.has(a.id)) out.push({ activity: a, discipline: w.discipline });
        }
      });

    /* A session whose own name says "long" qualifies whatever the plan
       scheduled. An athlete following someone else's plan carries that
       plan's names, and their long ride may sit on a day Try left open —
       without this the plan branch could only ever see what it scheduled
       itself. The duration gate still applies; the name is not a bypass. */
    activities.forEach(a => {
      const disc = DISCIPLINE[a.type];
      if (disc !== 'run' && disc !== 'bike' && disc !== 'swim') return;
      if (a.manual || seen.has(a.id) || sessionNameVerdict(a.name) !== true) return;
      if ((a.movingTimeSec || 0) < DURABILITY_GATES[disc].minMovingSec) return;
      if (out.some(c => c.activity.id === a.id)) return;
      out.push({ activity: a, discipline: disc });
    });
  } else if (!plan || plan.race === 'tracker') {
    /* No plan, so nothing is named "long" — the week's longest per
       discipline is, provided it clears the gate too. Taking every
       qualifying session instead fills the card with ordinary midweek work
       and calls all of it durability. */
    const eligible = activities.filter(a => {
      const d = DISCIPLINE[a.type];
      /* The refusal is applied BEFORE longest-of-week, not after, so a week
         whose longest recording is an easy session promotes the next one
         down instead of yielding nothing. Filtering afterwards would let one
         long easy run hide the real long run behind it. */
      return (d === 'run' || d === 'bike' || d === 'swim') && !a.manual
        && sessionNameVerdict(a.name) !== false;
    });
    const longIds = longestOfWeek(eligible.map(a => ({
      id: a.id, date: a.date, discipline: DISCIPLINE[a.type], movingTimeSec: a.movingTimeSec || 0,
    })));
    eligible.forEach(a => {
      const disc = DISCIPLINE[a.type];
      // named long, or the week's longest; either way it clears the gate,
      // which longestOfWeek applies for its own path
      const named = sessionNameVerdict(a.name) === true
        && (a.movingTimeSec || 0) >= DURABILITY_GATES[disc].minMovingSec;
      if ((longIds.has(a.id) || named) && !seen.has(a.id)) out.push({ activity: a, discipline: disc });
    });
  }

  const bounded = floor ? out.filter(c => c.activity.date >= floor) : out;
  const wm = iso(startOfWeekMonday(todayISO));
  const reviewed = reviewedWeekMonday(todayISO, hour);
  const inReviewed = c => reviewed && c.activity.date >= reviewed && c.activity.date < wm;
  return bounded.sort((a, b) =>
    (inReviewed(b) ? 1 : 0) - (inReviewed(a) ? 1 : 0)
    || (a.activity.date < b.activity.date ? 1 : -1));
}

// Trend over a discipline's recent reads (newest first): only speaks with
// three or more comparable reads, and only in coarse, honest strokes.
// Callers must pass ONE discipline's reads: mixing run and ride reads lets a
// mix-shift masquerade as a fitness trend (gauntlet catch 2026-07-20). Four
// reads minimum, so no single session can swing the sentence.
export function durabilityTrend(reads) {
  const rs = (reads || []).filter(r => r && r.read);
  if (rs.length < 4) return null;
  const score = r => r.read.band === 'held-strong' ? 2 : r.read.band === 'faded-a-little' ? 1 : 0;
  const recent = rs.slice(0, Math.ceil(rs.length / 2));
  const older = rs.slice(Math.ceil(rs.length / 2));
  const avg = xs => sum(xs, score) / xs.length;
  const d = avg(recent) - avg(older);
  if (d > 0.34) return 'Your long sessions are holding together better than they were.';
  if (d < -0.34) return 'Your long sessions have been fading earlier than they were.';
  return 'Your long sessions are holding a steady pattern.';
}
