import { describe, it, expect } from 'vitest';
import { generatePlan } from './plan.js';
import { isTrainingRide } from './bikeschema.js';
import { reviewActivity } from './review.js';
import {
  bikeReview, bikeReviewVerdict, bikeReviewEvidence, matchBikeIntervals,
  plannedBikeEfforts, bandForRep, BIKE_REVIEW_RULES, BIKE_EVIDENCE_RULES, TYPE_PRIORITIES,
} from './bike-review.js';
import { BIKE_TYPES } from './bikeschema.js';

const base = {
  name: 'S', raceType: 'half', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 250, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-11-01',
};
const plan = generatePlan(base);
const rides = plan.weeks.flatMap(w => w.workouts).filter(isTrainingRide);
const rideOf = type => rides.find(w => w.type === type);
const REAL = { ...plan.paces, ftp: 250, ftpEstimated: false };
const ESTIMATED = { ...plan.paces, ftp: 250, ftpEstimated: true };

// A recording that rode the plan exactly: one WORK interval per planned
// effort, at `frac` of FTP.
function rodeAsPlanned(workout, frac, opts = {}) {
  const eff = plannedBikeEfforts(workout);
  let t = 900;
  return eff.map((e, i) => {
    const iv = {
      type: 'WORK', startTimeSec: t, movingTimeSec: e.min * 60,
      averageWatts: 250 * (typeof frac === 'function' ? frac(i, eff.length) : frac),
    };
    t += (e.min + (e.restMin || 0)) * 60;
    return iv;
  }).concat(opts.extra || []);
}
const act = (workout, over = {}) => ({
  id: 'a', type: 'Ride', date: '2026-06-10',
  movingTimeSec: (workout.durationMin || 60) * 60, averageWatts: 170, ...over,
});

describe('§3: an estimated FTP may display targets but never judges', () => {
  const w = rideOf('Threshold');
  it('refuses to judge, and says why', () => {
    const r = bikeReview({ workout: w, activity: act(w), intervals: rodeAsPlanned(w, 1.0), paces: ESTIMATED });
    expect(r.confidence).toBe('low');
    expect(r.outcome).toBe('insufficient-data');
    expect(r.timeInTarget).toBe(null);
    expect(r.powerAdherence).toBe(null);
    expect(r.text).toMatch(/estimated/i);
    expect(bikeReviewVerdict(r)).toBe(null);      // and says nothing on screen
  });
  it('judges the identical ride once the threshold is measured', () => {
    const r = bikeReview({ workout: w, activity: act(w), intervals: rodeAsPlanned(w, 1.0), paces: REAL });
    expect(r.confidence).toBe('high');
    expect(r.outcome).not.toBe('insufficient-data');
    expect(r.timeInTarget).toBeGreaterThan(0);
  });
});

describe('§2: the review carries the fields the model promises', () => {
  it('has every field, and the gated ones are absent rather than invented', () => {
    const w = rideOf('Threshold');
    const r = bikeReview({ workout: w, activity: act(w), intervals: rodeAsPlanned(w, 1.0), paces: REAL });
    ['completion', 'timeInTarget', 'powerAdherence', 'averagePowerWatts', 'intervalFadePercent',
      'normalizedPowerWatts', 'intensityFactor', 'powerTss', 'variabilityIndex',
      'confidence', 'outcome'].forEach(k => expect(k in r, k + ' missing').toBe(true));
    expect(['low', 'medium', 'high']).toContain(r.confidence);
    expect(['progress', 'repeat', 'reduce', 'retest-ftp', 'insufficient-data']).toContain(r.outcome);
    // §6 is gated on normalized power, which no ride carries today
    expect(r.normalizedPowerWatts).toBe(null);
    expect(r.intensityFactor).toBe(null);
    expect(r.powerTss).toBe(null);
    expect(r.variabilityIndex).toBe(null);
  });
});

describe('§4: interval-level matching', () => {
  const w = rideOf('Threshold');
  it('pairs planned efforts with recorded ones and reports high confidence', () => {
    const m = matchBikeIntervals({ workout: w, intervals: rodeAsPlanned(w, 1.0) });
    expect(m.planned.length).toBeGreaterThan(1);
    expect(m.pairs.length).toBe(m.planned.length);
    expect(m.confidence).toBe('high');
  });
  it('drops confidence when the recording does not cover the session', () => {
    const all = rodeAsPlanned(w, 1.0);
    const m = matchBikeIntervals({ workout: w, intervals: all.slice(0, 1) });
    expect(m.confidence).toBe('low');
    expect(bikeReview({ workout: w, activity: act(w), intervals: all.slice(0, 1), paces: REAL }).outcome)
      .toBe('insufficient-data');
  });
  it('will not pair efforts of the wrong length', () => {
    const wrong = rodeAsPlanned(w, 1.0).map(i => ({ ...i, movingTimeSec: 30 }));
    const m = matchBikeIntervals({ workout: w, intervals: wrong });
    expect(m.pairs.length).toBe(0);       // and sub-minute slivers are dropped entirely
  });
  it('reads a steady ride as splits rather than refusing it', () => {
    const e = rideOf('Endurance');
    const m = matchBikeIntervals({ workout: e, intervals: [{ type: 'WORK', movingTimeSec: 2400, averageWatts: 160 }] });
    expect(m.splits).toBe(true);
    expect(m.confidence).toBe('medium');
  });
  it('judges the same ride differently indoors and outdoors', () => {
    // an effort that sits just below the band: outdoors the road is in the
    // average, indoors nothing is
    const low = rodeAsPlanned(w, 0.85);   // below the band, within the outdoor allowance
    const outdoor = bikeReview({ workout: w, activity: act(w), intervals: low, paces: REAL });
    const indoor = bikeReview({ workout: w, activity: act(w, { type: 'VirtualRide' }), intervals: low, paces: REAL });
    expect(outdoor.timeInTarget).toBeGreaterThan(indoor.timeInTarget);
    expect(outdoor.indoor).toBe(false);
    expect(indoor.indoor).toBe(true);
  });
});

describe('§5: each session type is judged on what it exists to train', () => {
  it('every bike type declares its priorities', () => {
    BIKE_TYPES.forEach(t => expect(TYPE_PRIORITIES[t], t).toBeTruthy());
  });
  it('an easy ride ridden hard is called out, and one ridden easy is not', () => {
    const e = rideOf('Endurance');
    const hard = bikeReview({ workout: e, activity: act(e, { averageWatts: 250 * 0.85 }), intervals: [], paces: REAL });
    expect(hard.outcome).toBe('repeat');
    expect(hard.text).toMatch(/harder than it asked/i);
    const easy = bikeReview({ workout: e, activity: act(e, { averageWatts: 250 * 0.65 }), intervals: [], paces: REAL });
    expect(easy.outcome).toBe('progress');
  });
  it('a session that broke down at the end is told to back off', () => {
    const w2 = rideOf('Threshold');
    // final effort well below the body of the session
    const fading = rodeAsPlanned(w2, (i, n) => (i === n - 1 ? 0.82 : 1.0));
    const r = bikeReview({ workout: w2, activity: act(w2), intervals: fading, paces: REAL });
    expect(r.intervalFadePercent).toBeGreaterThanOrEqual(BIKE_REVIEW_RULES.fadeHardPct);
    expect(r.outcome).toBe('reduce');
  });
});

describe('§4: the band a rep is judged against', () => {
  it("judges a Long ride's tempo surges as tempo, not as endurance", () => {
    const surge = bandForRep('Long', 'Z3');
    const steady = bandForRep('Long', 'Z2');
    expect(surge[0]).toBeGreaterThan(steady[1]);   // genuinely different targets
  });
  it('is at least as permissive as the card, never stricter', () => {
    // phase 2's rule: a rider who does what the card said is never told they missed
    const thr = bandForRep('Threshold', 'Z4');
    expect(thr[0]).toBeLessThanOrEqual(0.95);
    expect(thr[1]).toBeGreaterThanOrEqual(1.05);
  });
});

describe('§7: one ride cannot retarget anything', () => {
  const r = (over, conf = 'high') => ({
    type: 'Threshold', powerAdherence: over, confidence: conf, completion: 100, date: '2026-06-1' + (over > 0 ? '1' : '2'),
  });
  it('a single strong ride produces no direction', () => {
    expect(bikeReviewEvidence([r(8)])).toBe(null);
    expect(bikeReviewEvidence([r(8), r(8)])).toBe(null);
  });
  it('three consistent, well-matched, completed rides do', () => {
    const e = bikeReviewEvidence([r(8), r(8), r(8)]);
    expect(e.direction).toBe('over');
    expect(e.sessions).toBe(BIKE_EVIDENCE_RULES.window);
  });
  it('mixed directions produce nothing', () => {
    expect(bikeReviewEvidence([r(8), r(-8), r(8)])).toBe(null);
  });
  it('low-confidence rides never contribute', () => {
    expect(bikeReviewEvidence([r(8, 'low'), r(8, 'low'), r(8, 'low')])).toBe(null);
    // and a window of mediums alone is not enough either
    expect(bikeReviewEvidence([r(8, 'medium'), r(8, 'medium'), r(8, 'medium')])).toBe(null);
  });
  it('an incomplete session never contributes', () => {
    const short = { type: 'Threshold', powerAdherence: 8, confidence: 'high', completion: 50 };
    expect(bikeReviewEvidence([short, short, short])).toBe(null);
  });
});

describe('§8: the engine is the single voice, and fails safely', () => {
  it('the whole-ride notes yield to it rather than contradicting it', () => {
    const e = rideOf('Endurance');
    const a = act(e, { averageWatts: 250 * 0.85 });
    const br = bikeReview({ workout: e, activity: a, intervals: [], paces: REAL });
    const withEngine = reviewActivity({ workout: e, activity: a, paces: REAL, bikeReview: br });
    const without = reviewActivity({ workout: e, activity: a, paces: REAL });
    // without the engine the old easy-intent line speaks; with it, it does not
    expect(without.verdicts.some(v => /meant to be easy/.test(v.text))).toBe(true);
    expect(withEngine.verdicts.some(v => /meant to be easy/.test(v.text))).toBe(false);
    expect(withEngine.verdicts.some(v => /harder than it asked/i.test(v.text))).toBe(true);
  });

  it('survives every kind of missing input without throwing', () => {
    const w = rideOf('Threshold');
    expect(bikeReview({ workout: null, activity: act(w), intervals: [], paces: REAL })).toBe(null);
    expect(bikeReview({ workout: w, activity: null, intervals: [], paces: REAL })).toBe(null);
    expect(bikeReview({ workout: w, activity: act(w), intervals: null, paces: REAL }).outcome).toBeTruthy();
    expect(bikeReview({ workout: w, activity: act(w), intervals: [], paces: {} }).outcome).toBe('insufficient-data');
    const swim = plan.weeks.flatMap(x => x.workouts).find(x => x.discipline === 'swim');
    expect(bikeReview({ workout: swim, activity: act(w), intervals: [], paces: REAL })).toBe(null);
  });

  it('matched efforts with no power recorded cannot be judged', () => {
    const w = rideOf('Threshold');
    const noPower = rodeAsPlanned(w, 1.0).map(i => ({ ...i, averageWatts: null }));
    const r = bikeReview({ workout: w, activity: act(w), intervals: noPower, paces: REAL });
    expect(r.confidence).toBe('low');
    expect(r.outcome).toBe('insufficient-data');
  });
});
