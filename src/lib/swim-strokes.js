/* Try — phase 8: stroke metrics.
 *
 * The activity pipeline has carried the stroke fields since 2026-07-30;
 * the analysis stays behind STROKE_METRICS_FLAG because the fields arriving
 * is not the same as the fields being UNDERSTOOD — see the 2x note below.
 * Nothing here may change training. It reads defensively, so on a backend
 * without the fields every entry point returns "no data" rather than a
 * number.
 *
 * WHAT THE DATA ACTUALLY LOOKS LIKE (validated against real Garmin swims in
 * the athlete's own intervals.icu account, 2026-07-27, which is the
 * validation the spec asks for before any of this is trusted):
 *
 *   activity: pool_length, lengths, average_cadence, average_stride,
 *             device_name, source
 *   per lap:  average_cadence, average_stride, max_cadence, min_cadence,
 *             distance, moving_time
 *   ABSENT:   SWOLF, stroke TYPE, explicit stroke count
 *
 * The one that matters most: on a real lap, distance / stride gave 97
 * strokes while cadence x time gave 48 — exactly 2x apart, because one field
 * counts arm strokes and the other counts full cycles. Which is which is a
 * device convention, not a fact about the swim. So this module never reports
 * a single authoritative stroke count when the two disagree; it reports what
 * each says, flags the mismatch, and lets the caller show nothing. That is
 * the spec's "device-specific definitions visible or normalised", and it is
 * why a naive implementation of the given formulas would have been wrong.
 */

/* The spec's fields (§1). Kept as a list so the backend ask, the quality
   report and the tests all name the same things. */
export const STROKE_FIELDS = {
  activity: ['poolLengthM', 'lengths', 'averageCadence', 'averageStride', 'deviceName', 'deviceSource'],
  lap: ['averageCadence', 'averageStride', 'distance', 'movingTimeSec'],
};

/* A stroke count derived two ways must land on a RECOGNISED relationship
   before either is quoted. 2% absorbs rounding.

   The header above records the 2x gap as an unresolved device convention.
   Measured against real data (2026-08-04, two swims on two Garmin models,
   43 work laps), it is not unresolved: `(distance/stride) / (cadence x
   minutes)` is EXACTLY 2.0000 every time, stdev 0.000000, at lap and
   activity level. Measurements that genuinely disagree do not do that. It is
   a unit relationship — cadence counts full stroke CYCLES, stride is metres
   per single ARM stroke, and one cycle is two arm strokes. The sanity check
   agrees: 1.23 m/stroke in a 25 m pool is ~20 arm strokes per length.

   So two ratios are known and everything else is still refused. An
   unrecognised relationship is precisely the case the original refusal was
   written for, and it keeps it. */
export const STROKE_RULES = {
  agreeTol: 0.02,
  // 1 = both routes already count the same thing; 2 = the cycles/strokes pair
  knownRatios: [1, 2],
  minLapSec: 20,        // shorter than this is a wall touch, not a lap
  minLapM: 25,          // and a lap shorter than a length cannot be read
  drillPaceRatio: 1.35, // this much slower than the session's median = drill or kick
};

/* Which recognised relationship a lap's two derivations sit on, or null when
   it is on none of them. 'same' means they already agree; 'cycles' means the
   cadence route counted full cycles and the stride route counted arm strokes. */
export function strokeBasisFor(ratio) {
  if (!(ratio > 0)) return null;
  for (const r of STROKE_RULES.knownRatios) {
    if (Math.abs(ratio / r - 1) <= STROKE_RULES.agreeTol) return r === 1 ? 'same' : 'cycles';
  }
  return null;
}

/* §7 + §8: what is actually present, per activity. Every downstream function
   consults this, and 'none' is the expected answer on today's backend. */
export function strokeDataQuality({ activity, laps }) {
  const a = activity || {};
  const rows = Array.isArray(laps) ? laps : [];
  const work = rows.filter(l => l && l.type === 'WORK');
  const withCadence = work.filter(l => l.averageCadence > 0);
  const withStride = work.filter(l => l.averageStride > 0);
  const openWater = /OpenWater/i.test(a.type || '');
  const missing = [];
  if (!a.poolLengthM && !openWater) missing.push('pool length');
  if (!withCadence.length && !withStride.length) missing.push('stroke data');
  return {
    // the flag the whole phase hangs on: no analysis without real fields
    available: !openWater && !!a.poolLengthM && (withCadence.length > 0 || withStride.length > 0),
    openWater,
    poolLengthM: a.poolLengthM || null,
    device: a.deviceName || null,
    source: a.deviceSource || null,
    workLaps: work.length,
    lapsWithStroke: Math.max(withCadence.length, withStride.length),
    // partial data is usable but must be visible as partial
    partial: work.length > 0 && Math.max(withCadence.length, withStride.length) < work.length,
    missing,
    reason: openWater ? 'Open-water swims have no pool stroke metrics.'
      : missing.length ? 'Your recordings do not carry ' + missing.join(' or ') + ' yet.'
        : null,
  };
}

/* §2/§3: one lap. Returns null rather than a partial number when the lap
   cannot be read honestly. Nothing here is rounded into false precision. */
export function lapStrokeMetrics(lap, { poolLengthM } = {}) {
  const l = lap || {};
  if (l.type !== 'WORK') return null;
  const dist = l.distance || 0, sec = l.movingTimeSec || 0;
  if (dist < STROKE_RULES.minLapM || sec < STROKE_RULES.minLapSec) return null;

  const perStroke = l.averageStride > 0 ? l.averageStride : null;
  const cadence = l.averageCadence > 0 ? l.averageCadence : null;
  // two independent routes to a stroke count; see the header note
  const fromStride = perStroke ? dist / perStroke : null;
  const fromCadence = cadence ? cadence * (sec / 60) : null;
  let strokes = null, mismatch = null, strokeBasis = null;
  if (fromStride && fromCadence) {
    const ratio = fromStride / fromCadence;
    strokeBasis = strokeBasisFor(ratio);
    /* ALWAYS the stride route when a basis is recognised: it counts arm
       strokes either way, which is what a swimmer means by "strokes" and what
       makes strokes-per-length a number they recognise. On 'cycles' the
       cadence route is the same swim counted in cycles, so taking it would
       silently halve the answer. */
    if (strokeBasis) strokes = Math.round(fromStride);
    else mismatch = { fromStride: Math.round(fromStride), fromCadence: Math.round(fromCadence), ratio: Math.round(ratio * 100) / 100 };
  } else if (fromStride) { strokes = Math.round(fromStride); strokeBasis = 'stride-only'; }
  else if (fromCadence) { strokes = Math.round(fromCadence); strokeBasis = 'cadence-only'; }

  // SWOLF is per LENGTH by definition, and watches differ on how they count
  // it, so this is only ever OUR derived figure and says so. Without a pool
  // length there is no length to compute it over, so there is no SWOLF.
  let swolf = null;
  if (poolLengthM && strokes) {
    const lengths = dist / poolLengthM;
    if (lengths >= 1) swolf = Math.round((sec / lengths) + (strokes / lengths));
  }
  return {
    distance: dist,
    seconds: sec,
    pace100: Math.round(sec / (dist / 100) * 10) / 10,
    strokeRate: cadence,                                   // as the device reports it
    distancePerStroke: perStroke ? Math.round(perStroke * 1000) / 1000 : null,
    strokes,                        // ARM strokes; null on an unrecognised ratio
    strokesPerLength: strokes && poolLengthM ? Math.round(strokes / (dist / poolLengthM) * 10) / 10 : null,
    swolf,                                                 // derived, never the device's
    swolfDerived: swolf != null,
    strokeBasis,                    // which relationship the two routes sat on
    mismatch,
  };
}

/* §5: the descriptive first release. Ranges and drift, at comparable pace,
   with no verdict attached. It deliberately returns no judgement of better
   or worse: a lower SWOLF from slower swimming is not an improvement, and a
   higher stroke count is not automatically worse. */
export function strokeSessionSummary({ activity, laps, poolLengthM }) {
  const quality = strokeDataQuality({ activity, laps });
  if (!quality.available) return { quality, readable: 0, metrics: [], summary: null };
  const pool = poolLengthM || quality.poolLengthM;
  const metrics = (laps || []).map(l => lapStrokeMetrics(l, { poolLengthM: pool })).filter(Boolean);
  if (!metrics.length) return { quality, readable: 0, metrics: [], summary: null };

  // §4/§7: a drill or kick lap is swum at a pace that makes its stroke
  // metrics incomparable, so it is excluded from the ranges rather than
  // dragging them. It is still counted, so nothing silently disappears.
  const paces = metrics.map(m => m.pace100).sort((a, b) => a - b);
  const median = paces[Math.floor(paces.length / 2)];
  const normal = metrics.filter(m => m.pace100 <= median * STROKE_RULES.drillPaceRatio);
  const excluded = metrics.length - normal.length;

  const vals = k => normal.map(m => m[k]).filter(v => v != null);
  const range = k => {
    const v = vals(k);
    if (!v.length) return null;
    return { min: Math.min(...v), max: Math.max(...v), n: v.length };
  };
  // §2 drift: first half against last half, at comparable pace only
  const drift = (() => {
    const withStrokes = normal.filter(m => m.strokesPerLength != null);
    if (withStrokes.length < 4) return null;
    const half = Math.floor(withStrokes.length / 2);
    const mean = xs => xs.reduce((t, x) => t + x, 0) / xs.length;
    const early = mean(withStrokes.slice(0, half).map(m => m.strokesPerLength));
    const late = mean(withStrokes.slice(-half).map(m => m.strokesPerLength));
    return { early: Math.round(early * 10) / 10, late: Math.round(late * 10) / 10, deltaPct: Math.round((late - early) / early * 1000) / 10 };
  })();

  return {
    quality,
    readable: metrics.length,
    metrics,
    summary: {
      strokeRate: range('strokeRate'),
      distancePerStroke: range('distancePerStroke'),
      strokesPerLength: range('strokesPerLength'),
      swolf: range('swolf'),
      swolfDerived: true,
      pace100: range('pace100'),
      drift,
      excludedLaps: excluded,           // drills and kick sets, named not hidden
      mismatchedLaps: metrics.filter(m => m.mismatch).length,
    },
  };
}

/* The gate itself (§8, and the spec's own Dependency note). Analysis stays
   off until the backend carries the fields AND the caller opts in, so this
   cannot start speaking on its own the day a field appears. */
/* The gate's own state. There was no flag constant anywhere: `enabled` was a
   parameter no caller ever supplied, which is how the whole feature shipped
   with a gate and no door. Flip this to true when the backend passes the
   stroke fields through; everything downstream is already written and
   tested. */
export const STROKE_METRICS_FLAG = false;

export function strokeMetricsEnabled({ activity, laps, enabled }) {
  if (!enabled) return false;
  return strokeDataQuality({ activity, laps }).available;
}
