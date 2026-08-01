/* Try — the performance spider: paces across distances, placed against a
 * reference (2026-07-30, Jon's ask).
 *
 * WHAT THE RINGS ARE, AND WHAT THEY ARE NOT. The reference today is Try's own
 * level ladder — the same est5k / runEst5k / estCss / estWkg anchors that
 * size every plan. So the chart's radial rings ARE the four levels, named,
 * and the athlete's polygon sits between named rings. Nothing here claims a
 * population percentile, because we do not hold population data and a
 * percentage against an invented population is a fabricated statistic with
 * an axis label. When the app can compare its users against each other
 * (backend ask: anonymised aggregate percentiles), that arrives as a SECOND
 * source through the same seam, and only then does percentile wording become
 * honest. SPIDER_SOURCES is that seam: every consumer carries source so the
 * copy can say which comparison it is making.
 *
 * THE ESTIMATE RULE HOLDS HERE (phase 5). An athlete whose anchor is a
 * level-table guess sits ON a ring by construction — plotting that as "where
 * you sit" would be the app grading its own guess. So each discipline's
 * spider requires a REAL anchor and returns null with the reason otherwise;
 * the dashboard renders the same "a test would unlock this" line it already
 * uses for projections.
 *
 * WHY THE RUN AXES ARE NOT ALL ONE NUMBER. Projecting the user AND the rings
 * through the same Riegel exponent makes every axis the same ratio — a flat
 * polygon dressed as insight. The projection is only the floor: any recorded
 * activity that covers an axis distance overrides it as a MEASURED point
 * (marked, like distEst), so distance-specific strengths appear exactly when
 * there is evidence of them and never before.
 *
 * WHY THE SWIM CAN PROJECT ACROSS DISTANCES AT ALL. One CSS number cannot
 * say how pace changes with distance. But the 400/200 test the app already
 * prescribes yields two points, which is the two-parameter critical-speed
 * model: CS (sustainable speed) and D' (the finite anaerobic distance above
 * it). t(d) = (d − D′) / CS. Both come from the athlete's own swum test —
 * nothing invented — and the test's splits are persisted on cssMeta for
 * exactly this (they used to be computed and thrown away). Without stored
 * splits the swim polygon is flat at CSS and marked approximate, which is
 * the honest statement that we know their threshold and not their range.
 */

import { FITNESS, RACES, runAnchor, swimThreshold } from './domain.js';
import { RIEGEL_EXP } from './runstats.js';
import { riderProfile, CAPABILITIES, PROFILE_RULES } from './bike-profile.js';
import { bikePowerAnchor } from './domain.js';
import { DISCIPLINE } from './autolog.js';

export const SPIDER_SOURCES = {
  'try-levels': {
    label: 'vs Try levels',
    blurb: 'Placed against the same level calibration that sizes every plan.',
  },
  // Reserved for the backend aggregate (see the handoff ask). Until an
  // endpoint exists nothing constructs a spider with this source; it is
  // named now so the seam is real rather than a comment.
  population: {
    label: 'vs Try athletes',
    blurb: 'Placed against anonymised results from other athletes on Try.',
  },
  // The bike's scores are deviations from the rider's own mean shape; the
  // caption must say so rather than implying a comparison with anyone else.
  'own-shape': {
    label: 'vs your own shape',
    blurb: 'Each capability relative to your own average across the curve.',
  },
};

export const LEVEL_ORDER = ['beginner', 'intermediate', 'advanced', 'elite'];
// Ring radii, inner to outer. Beginner is not zero: the centre is reserved
// for "off the bottom of the ladder", which is a real state, not a floor.
export const LEVEL_RINGS = [0.25, 0.5, 0.75, 1.0];
const POS_MIN = 0.08;   // visibly inside the beginner ring, never at the origin
const POS_MAX = 1.08;   // visibly past elite, never off the chart

/* Where a value sits on the ladder, as a continuous ring position.
   `anchors` are the four level values for this axis, in LEVEL_ORDER order.
   lowerIsBetter is true for times and paces, false for watts per kilo. */
export function levelPosition(value, anchors, lowerIsBetter) {
  if (value == null || !anchors || anchors.length !== 4 || anchors.some(a => a == null)) return null;
  // Normalise so bigger is better, then interpolate between ring radii.
  const v = lowerIsBetter ? -value : value;
  const a = anchors.map(x => (lowerIsBetter ? -x : x));
  if (v <= a[0]) {
    // below beginner: fall toward the centre at the beginner-intermediate
    // gradient, floored so the point stays drawable
    const gap = a[1] - a[0] || 1;
    return Math.max(POS_MIN, LEVEL_RINGS[0] + ((v - a[0]) / gap) * (LEVEL_RINGS[1] - LEVEL_RINGS[0]));
  }
  for (let i = 0; i < 3; i++) {
    if (v <= a[i + 1]) {
      const gap = a[i + 1] - a[i] || 1;
      return LEVEL_RINGS[i] + ((v - a[i]) / gap) * (LEVEL_RINGS[i + 1] - LEVEL_RINGS[i]);
    }
  }
  // above elite: keep climbing at the advanced-elite gradient, capped
  const gap = a[3] - a[2] || 1;
  return Math.min(POS_MAX, LEVEL_RINGS[3] + ((v - a[3]) / gap) * (LEVEL_RINGS[3] - LEVEL_RINGS[2]));
}

const levelRings = () => LEVEL_ORDER.map((l, i) => ({ radius: LEVEL_RINGS[i], label: FITNESS[l].name }));

/* ---- swim: paces over race distances ----------------------------------- */

export const SWIM_SPIDER_DISTANCES = [100, 200, 400, 800, 1500];

// CS and D' from the stored 400/200 test splits, or null. Distances ride
// along because a yard-pool test records 366 m and 183 m, and assuming 400
// and 200 would corrupt D' for exactly those athletes.
export function criticalSpeed(meta) {
  const m = meta || {};
  if (!m.t400Sec || !m.t200Sec) return null;
  const d400 = m.d400 || 400, d200 = m.d200 || 200;
  const dt = m.t400Sec - m.t200Sec;
  if (dt <= 0) return null;
  const cs = (d400 - d200) / dt;                    // m/s
  const dPrime = d400 - cs * m.t400Sec;             // metres
  // Outside the plausible swimming range the TEST is suspect, and a model
  // built on a suspect test must not quietly shape a chart: fall back to
  // flat CSS rather than projecting nonsense.
  if (!(cs > 0.4 && cs < 2.2) || !(dPrime >= 0 && dPrime <= 60)) return null;
  return { cs, dPrime };
}

export function swimSpider(profile) {
  const th = swimThreshold(profile);
  if (!th.cssSecondsPer100m || th.source === 'estimated') {
    return { discipline: 'swim', axes: null, reason: 'A 400/200 swim test would unlock this chart.' };
  }
  const model = criticalSpeed(profile && profile.cssMeta);
  const axes = SWIM_SPIDER_DISTANCES.map(d => {
    // pace per 100 m at this distance: the athlete's own two-point model
    // where the test splits are stored, flat CSS where they are not
    const pace = model ? ((d - model.dPrime) / model.cs) / (d / 100) : th.cssSecondsPer100m;
    // Rings: the ladder defines levels by CSS alone, so the reference is
    // deliberately flat across distances — that IS Try's swim model, and
    // pretending the ladder knows how each level's pace decays with
    // distance would be inventing data.
    return {
      key: String(d), label: d + ' m',
      value: Math.round(pace * 10) / 10,
      unit: 's/100m', lowerIsBetter: true,
      measured: !!model,
      position: levelPosition(pace, LEVEL_ORDER.map(l => FITNESS[l].estCss), true),
    };
  });
  return { discipline: 'swim', source: 'try-levels', axes, model: model ? 'cs-dprime' : 'flat-css', rings: levelRings() };
}

/* ---- run: paces over race distances ------------------------------------ */

export const RUN_SPIDER_AXES = [
  { key: '5k', label: '5 km', km: 5 },
  { key: '10k', label: '10 km', km: 10 },
  { key: 'half', label: 'Half', km: 21.0975 },
  { key: 'marathon', label: 'Marathon', km: 42.195 },
];
// A recorded run covers an axis when its distance is within this window:
// far enough past the mark to contain it, close enough that the whole-run
// average pace is still about that distance and not a longer day out.
const RUN_BAND = { lo: 1.0, hi: 1.08 };

const riegel = (sec5k, km) => sec5k * Math.pow(km / 5, RIEGEL_EXP);

/* Best recorded effort per axis from the merged activity list. Whole
   activities only: without per-km streams a best-5k-inside-a-long-run is
   not extractable, and guessing it would mark fiction as measured. */
export function runBestEfforts(activities) {
  const best = {};
  (activities || []).forEach(a => {
    if (!a || DISCIPLINE[a.type] !== 'run' || !a.movingTimeSec || !a.distance) return;
    RUN_SPIDER_AXES.forEach(ax => {
      const m = ax.km * 1000;
      if (a.distance < m * RUN_BAND.lo || a.distance > m * RUN_BAND.hi) return;
      // normalise the recorded time to the axis distance through the same
      // power law everything else uses — a 3% correction, marked measured
      // because the effort was
      const t = a.movingTimeSec * Math.pow(m / a.distance, RIEGEL_EXP);
      if (!best[ax.key] || t < best[ax.key]) best[ax.key] = Math.round(t);
    });
  });
  return best;
}

export function runSpider(profile, activities) {
  const anchor = runAnchor(profile);
  if (anchor.kind !== 'real') {
    return { discipline: 'run', axes: null, reason: 'A 5 km test would unlock this chart.' };
  }
  const soloRun = (RACES[(profile || {}).raceType] || {}).solo === 'run';
  const anchorKey = soloRun ? 'runEst5k' : 'est5k';
  const bests = runBestEfforts(activities);
  const axes = RUN_SPIDER_AXES.map(ax => {
    const projected = riegel(anchor.timeSec, ax.km);
    const measured = bests[ax.key] != null && bests[ax.key] < projected * 1.5 ? bests[ax.key] : null;
    const sec = measured != null ? measured : projected;
    return {
      key: ax.key, label: ax.label,
      value: Math.round(sec), unit: 'sec', lowerIsBetter: true,
      measured: measured != null,
      position: levelPosition(sec, LEVEL_ORDER.map(l => riegel(FITNESS[l][anchorKey], ax.km)), true),
    };
  });
  return { discipline: 'run', source: 'try-levels', axes, rings: levelRings() };
}

/* ---- bike: the power-profile capabilities ------------------------------ */

/* Five axes, one per capability, populated by the SAME bikeProfile that
   already refuses phenotype labels — this chart inherits that refusal by
   construction, because a shape drawn from five scores is not a name.

   Dormant by decision (Jon, 2026-07-30): the axes exist now and light up
   when the power-curve endpoint lands. Until then the chart explains what
   would populate it rather than improvising three axes from FTP alone. */
/* The bike's rings are NOT the level ladder. riderProfile scores are
   deviations from the rider's OWN mean shape, centred on zero with the
   ±6-point strength/limiter bands — a deliberately self-relative measure,
   built that way so a mis-set FTP cannot manufacture five strengths at once.
   Forcing those onto Beginner..Elite rings would claim exactly the
   cross-athlete comparison the profile module refuses to make. So this
   spider carries its own ring set (limiter / your shape / strength) and the
   component draws whatever rings a spider brings. */
export const BIKE_RING_RADII = { limiter: 0.35, even: 0.625, strength: 0.9 };
const bikeRadius = pct => Math.max(POS_MIN, Math.min(POS_MAX,
  BIKE_RING_RADII.even + (pct / PROFILE_RULES.strongPct) * (BIKE_RING_RADII.strength - BIKE_RING_RADII.even)));

export function bikeSpider(profile, powerCurve) {
  const anchor = bikePowerAnchor(profile || {});
  const prof = anchor.kind === 'real'
    ? riderProfile({ curve: powerCurve, ftpWatts: anchor.ftpWatts }) : null;
  if (!prof) {
    return {
      discipline: 'bike', axes: null,
      reason: anchor.kind !== 'real'
        ? 'A real FTP would unlock this chart.'
        : 'This chart reads your power curve, which needs ride power data the backend does not pass through yet.',
    };
  }
  const axes = Object.keys(CAPABILITIES).map(k => {
    const s = prof.scores[k];
    return {
      /* The SHORT name on the chart: "Long-duration durability" ran off both
         edges of a 240px radar (labels sit at 1.26 x radius, so the left and
         right axes centre their text at x ~= 12 and ~= 228). The full names
         still carry the definitions wherever they are listed. */
      key: k, label: CAPABILITIES[k].short || CAPABILITIES[k].label,
      value: s ? s.pct : null, unit: 'vs own shape', lowerIsBetter: false,
      measured: !!s,
      position: s ? bikeRadius(s.pct) : null,
    };
  });
  return {
    discipline: 'bike', source: 'own-shape', axes,
    rings: [
      { radius: BIKE_RING_RADII.limiter, label: 'Limiter' },
      { radius: BIKE_RING_RADII.even, label: 'Your shape' },
      { radius: BIKE_RING_RADII.strength, label: 'Strength' },
    ],
  };
}
