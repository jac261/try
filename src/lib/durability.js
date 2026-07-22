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

// Bump when read logic or thresholds change: stored reads carry the version
// they were computed under.
export const DURABILITY_RULE_VERSION = 1;

// Session gates sit UNDER the sprint tier's own prescribed longs (run 55,
// ride 70 minutes), so every race distance's long sessions can qualify.
export const DURABILITY_GATES = {
  bike: { minMovingSec: 65 * 60 },
  run: { minMovingSec: 50 * 60 },
  minLaps: 6,
  minCoverage: 0.8,      // usable laps must span this share of the session
  outlierLo: 0.6,        // lap speed vs median lap speed
  outlierHi: 1.6,
  maxLapShare: 0.4,      // one lap may hold at most this share of a window
  minEfLapsPerWindow: 2,
};

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

// One long recording's lap rows → a read, or null whenever any honesty gate
// fails. rows are the intervals passthrough shape; discipline 'bike'|'run'.
export function durabilityRead({ rows, discipline, movingTimeSec }) {
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
