import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { generatePlan } from './plan.js';
import { isTrainingRide } from './bikeschema.js';
import { reviewActivity, intervalRows } from './review.js';
import {
  bikeReview, bikeReviewVerdict, bikeReviewEvidence, matchBikeIntervals,
  plannedBikeEfforts, bandForRep, BIKE_REVIEW_RULES, BIKE_EVIDENCE_RULES, TYPE_PRIORITIES,
  OUTCOME_SIGNALS, bikeReviewsFrom,
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

describe('the tables are load-bearing, not decorative', () => {
  it('every declared priority has a signal that can actually fire', () => {
    // TYPE_PRIORITIES used to be read for exactly one thing: which of two
    // sentences to print. The outcome logic hardcoded the types beside it, so
    // the table described a decision it did not make. Now the table IS the
    // order, and a priority with no signal behind it is a comment wearing a
    // const.
    Object.entries(TYPE_PRIORITIES).forEach(([type, names]) => {
      expect(names.length, type).toBeGreaterThan(0);
      names.forEach(n => expect(typeof OUTCOME_SIGNALS[n], type + ' declares ' + n + ' but nothing implements it').toBe('function'));
    });
  });

  it('no rule in the rules table is dead', () => {
    // restTol and cvSteady were both declared and never referenced, so §4's
    // recovery comparison was silently skipped while the constant for it sat
    // in plain sight looking implemented.
    const src = readFileSync(new URL('./bike-review.js', import.meta.url), 'utf8');
    Object.keys(BIKE_REVIEW_RULES).forEach(key => {
      const uses = src.split(key).length - 1;
      expect(uses, key + ' is declared but never used').toBeGreaterThan(1);
    });
  });
});

describe('§4: recovery is compared, not merely collected', () => {
  const w = rideOf('Threshold');
  // efforts placed back to back, so every recovery was skipped
  function cutRecoveries(workout, frac) {
    const eff = plannedBikeEfforts(workout);
    let t = 900;
    return eff.map(e => {
      const iv = { type: 'WORK', startTimeSec: t, movingTimeSec: e.min * 60, averageWatts: 250 * frac };
      t += e.min * 60;      // no gap at all
      return iv;
    });
  }
  it('notices when the recoveries were skipped, and says so', () => {
    const r = bikeReview({ workout: w, activity: act(w), intervals: cutRecoveries(w, 1.0), paces: REAL });
    expect(r.recoveryCompliance).toBe(0);
    expect(r.text).toMatch(/recovery|recoveries/i);
    expect(r.outcome).toBe('repeat');
  });
  it('is satisfied when the recoveries were taken', () => {
    const r = bikeReview({ workout: w, activity: act(w), intervals: rodeAsPlanned(w, 1.0), paces: REAL });
    expect(r.recoveryCompliance).toBe(100);
  });
  it('stays null rather than guessing when start times are missing', () => {
    const noTimes = rodeAsPlanned(w, 1.0).map(i => ({ ...i, startTimeSec: null }));
    expect(bikeReview({ workout: w, activity: act(w), intervals: noTimes, paces: REAL }).recoveryCompliance).toBe(null);
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


/* Gauntlet regressions. Each of these reproduces a defect the review agents
   demonstrated end to end, so the fix cannot quietly come undone. */
describe('gauntlet: adherence is distance from the PRESCRIPTION, not from a widened midpoint', () => {
  // the watts actually printed on the athlete's card
  const cardBand = w => {
    const seg = (w.segments || []).find(x => x.blocks);
    const m = seg && (seg.detail || '').match(/(\d+)\D+(\d+)\s*W/);
    return m ? [+m[1] / 250, +m[2] / 250] : null;
  };
  const atFrac = (w, frac) => {
    const eff = plannedBikeEfforts(w);
    let t = 900;
    return eff.map(e => {
      const iv = { type: 'WORK', startTimeSec: t, movingTimeSec: e.min * 60, averageWatts: 250 * frac };
      t += (e.min + (e.restMin || 0)) * 60;
      return iv;
    });
  };

  it('riding the top watt printed on the card scores zero, not "harder than asked"', () => {
    // The band used for in/out judging is deliberately a UNION, wider than
    // any single card. Measuring adherence from its midpoint made riding the
    // card exactly read as +8%, and returned "your threshold may have moved"
    // beside "100% of your effort time was in the target range".
    ['Threshold', 'Sweet Spot'].forEach(type => {
      const w = rides.find(x => x.type === type && (x.segments || []).some(sg => sg.blocks));
      const band = w && cardBand(w);
      if (!band) return;
      [band[0], (band[0] + band[1]) / 2, band[1]].forEach(frac => {
        const r = bikeReview({ workout: w, activity: act(w), intervals: atFrac(w, frac), paces: REAL });
        expect(r.powerAdherence, type + ' at ' + Math.round(frac * 250) + ' W').toBe(0);
        expect(r.outcome, type + ' at ' + Math.round(frac * 250) + ' W').not.toBe('retest-ftp');
      });
    });
  });

  it('three flawless sessions do not trip the rolling FTP evidence', () => {
    const w = rides.find(x => x.type === 'Sweet Spot' && (x.segments || []).some(sg => sg.blocks));
    const band = cardBand(w);
    const mid = (band[0] + band[1]) / 2;
    const three = [1, 2, 3].map(i => bikeReview({
      workout: w, activity: act(w, { date: '2026-07-0' + i }), intervals: atFrac(w, mid), paces: REAL,
    }));
    three.forEach(r => expect(r.powerAdherence).toBe(0));
    expect(bikeReviewEvidence(three)).toBe(null);
  });

  it('a session ridden BELOW its band is not called complete', () => {
    const w = rides.find(x => x.type === 'Threshold' && (x.segments || []).some(sg => sg.blocks));
    const r = bikeReview({ workout: w, activity: act(w), intervals: atFrac(w, 0.8), paces: REAL });
    expect(r.timeInTarget).toBe(0);
    expect(r.powerAdherence).toBeLessThan(0);      // under-riding is visible now
    expect(r.outcome).not.toBe('progress');
    expect(r.text).not.toMatch(/well controlled/);
  });

  it('a Long ride cannot claim a threshold move off its surges, nor praise them', () => {
    const w = rides.find(x => x.type === 'Long' && (x.segments || []).some(sg => sg.blocks));
    if (!w) return;
    const r = bikeReview({ workout: w, activity: act(w, { averageWatts: 160 }), intervals: atFrac(w, 1.14), paces: REAL });
    expect(r.outcome).not.toBe('retest-ftp');       // two surges are not a threshold test
    expect(r.timeInTarget).toBe(0);
    expect(r.text).not.toMatch(/well controlled/);  // not beside a 0% reading
  });
});

describe('gauntlet: sessions that were structurally unjudgeable', () => {
  it('judges a 30/30 VO2 card, whose efforts are shorter than the old lap floor', () => {
    const w = {
      discipline: 'bike', type: 'VO2 Intervals', durationMin: 75,
      segments: [
        { label: 'Warm-up', min: 15, zone: 'Z2' },
        { label: '3 x 12 x (30 s hard / 30 s easy)', min: 42, zone: 'Z5',
          blocks: Array.from({ length: 36 }).flatMap(() => [{ min: 0.5, zone: 'Z5' }, { min: 0.5, zone: 'Z1' }]) },
        { label: 'Cool-down', min: 18, zone: 'Z1' },
      ],
    };
    const eff = plannedBikeEfforts(w);
    expect(eff.length).toBe(36);
    let t = 900;
    const laps = eff.map(e => {
      const iv = { type: 'WORK', startTimeSec: t, movingTimeSec: e.min * 60, averageWatts: 250 * 1.12 };
      t += (e.min + (e.restMin || 0)) * 60;
      return iv;
    });
    const r = bikeReview({ workout: w, activity: act(w), intervals: laps, paces: REAL });
    expect(r.efforts, 'a flawless 30/30 recording must be judgeable').toBe(36);
    expect(r.outcome).not.toBe('insufficient-data');
  });

  it('gives a continuous quality card a verdict, at honest confidence', () => {
    const cont = rides.find(x => ['Sweet Spot', 'Tempo', 'Threshold'].includes(x.type)
      && !(x.segments || []).some(sg => sg.blocks));
    if (!cont) return;
    const r = bikeReview({ workout: cont, activity: act(cont, { averageWatts: 210 }), intervals: [], paces: REAL });
    expect(r.outcome).not.toBe('insufficient-data');
    // but not HIGH: the whole-ride average has the shoulders inside it, so it
    // cannot say whether the block itself was ridden right
    expect(r.confidence).toBe('medium');
    expect(r.text).toMatch(/no interval structure/);
  });
});

describe('gauntlet: the remaining honesty defects', () => {
  it('notices efforts cut short inside the pairing tolerance', () => {
    const w = rides.find(x => x.type === 'Threshold' && (x.segments || []).some(sg => sg.blocks));
    const eff = plannedBikeEfforts(w);
    let t = 900;
    const short = eff.map(e => {
      const iv = { type: 'WORK', startTimeSec: t, movingTimeSec: e.min * 60 * 0.82, averageWatts: 250 };
      t += (e.min + (e.restMin || 0)) * 60;
      return iv;
    });
    const r = bikeReview({ workout: w, activity: act(w), intervals: short, paces: REAL });
    expect(r.workCompletion).toBeLessThan(90);
    expect(r.outcome).toBe('repeat');
    expect(r.text).toMatch(/traded for recovery/);
  });

  it('does not claim a ride was outdoors when it has no environment evidence', () => {
    const w = rides.find(x => x.type === 'Threshold' && (x.segments || []).some(sg => sg.blocks));
    const eff = plannedBikeEfforts(w);
    const laps = eff.map((e, i) => ({ type: 'WORK', startTimeSec: 900 + i * 1000, movingTimeSec: e.min * 60, averageWatts: 250 * 0.86 }));
    const unknown = bikeReview({ workout: w, activity: { id: 'a', movingTimeSec: 3600, date: '2026-06-10' }, intervals: laps, paces: REAL });
    expect(unknown.environment).toBe('unknown');
    expect(unknown.text).not.toMatch(/outdoor allowance/);
    const out = bikeReview({ workout: w, activity: act(w), intervals: laps, paces: REAL });
    expect(out.environment).toBe('outdoor');
  });

  it('the rep table and the engine judge against the same band', () => {
    // they used to disagree for every Z3 type and render the disagreement in
    // one block of the workout sheet
    const w = rides.find(x => x.type === 'Sweet Spot' && (x.segments || []).some(sg => sg.blocks));
    const band = bandForRep('Sweet Spot', 'Z3');
    // a rep just inside the engine's band must not be 'under' in the table
    const watts = Math.round(250 * (band[0] + 0.01));
    const rows = intervalRows({
      workout: w, paces: REAL, activity: act(w, { type: 'VirtualRide' }),
      intervals: [{ type: 'WORK', movingTimeSec: 540, averageWatts: watts },
        { type: 'WORK', movingTimeSec: 540, averageWatts: watts }],
    });
    expect(rows.rows[0].tone).toBe('good');
  });

  it('the decline sentence does not argue with its own reason', () => {
    const w = rides.find(x => x.type === 'Threshold' && (x.segments || []).some(sg => sg.blocks));
    const eff = plannedBikeEfforts(w);
    const noPower = eff.map((e, i) => ({ type: 'WORK', startTimeSec: 900 + i * 1000, movingTimeSec: e.min * 60, averageWatts: null }));
    const r = bikeReview({ workout: w, activity: act(w), intervals: noPower, paces: REAL });
    expect(r.outcome).toBe('insufficient-data');
    expect(r.text).toMatch(/no power data/);
    // it used to print the MATCHER's affirmative verdict as the reason it
    // could not judge: "could not be matched (interval count matches)"
    expect(r.text).not.toMatch(/count matches/);
  });

  it('the load fields delegate to bikeLoad rather than being hardcoded null', () => {
    const w = rides.find(x => x.type === 'Threshold' && (x.segments || []).some(sg => sg.blocks));
    const eff = plannedBikeEfforts(w);
    const laps = eff.map((e, i) => ({ type: 'WORK', startTimeSec: 900 + i * 1000, movingTimeSec: e.min * 60, averageWatts: 250 }));
    // gated today
    expect(bikeReview({ workout: w, activity: act(w), intervals: laps, paces: REAL }).powerTss).toBe(null);
    // and live the moment the backend field arrives, with no other change
    const withNp = bikeReview({
      workout: w, paces: REAL, intervals: laps,
      activity: act(w, { normalizedWatts: 235, averageWatts: 230, movingTimeSec: 3600 }),
    });
    expect(withNp.normalizedPowerWatts).toBe(235);
    expect(withNp.intensityFactor).toBe(0.94);
    expect(withNp.powerTss).toBe(88);
    expect(withNp.variabilityIndex).toBe(1.02);
  });
});

/* The window recompute — what replaced the withdrawn `bikeReview` column.
 *
 * The dashboard, the FTP evidence and the outcome history all read this, and
 * before it they read a log field the API layer never mapped, so all three
 * said "not enough data yet" for every athlete however much they rode. */
describe('bikeReviewsFrom: a window rebuilt from cached laps', () => {
  const ridden = rides.filter(w => w.type === 'Threshold' && (w.segments || []).some(s => s.blocks)).slice(0, 2);
  const built = (over = {}) => {
    const activities = ridden.map((w, i) => act(w, { id: 'act' + i, date: w.date }));
    const lapsById = {};
    ridden.forEach((w, i) => { lapsById['act' + i] = rodeAsPlanned(w, 1.0); });
    const log = {};
    ridden.forEach(w => { log[w.id] = { done: true, at: w.date + 'T10:00:00Z' }; });
    return bikeReviewsFrom({ plan, log, moves: {}, activities, lapsById, paces: REAL, ...over });
  };

  it('reviews every completed ride whose laps are cached', () => {
    const out = built();
    expect(out.length).toBe(ridden.length);
    out.forEach(r => expect(r.outcome).not.toBe('insufficient-data'));
  });

  it('skips a ride whose laps are not cached rather than guessing from the average', () => {
    // the exact failure the engine exists to prevent: a whole-ride average
    // standing in for a review, recoveries and all
    expect(built({ lapsById: {} })).toEqual([]);
  });

  it('skips a ride with no log entry, and one with no matching recording', () => {
    expect(built({ log: {} })).toEqual([]);
    expect(built({ activities: [] })).toEqual([]);
  });

  it('dates each review by when the session was completed, newest first', () => {
    const out = built();
    expect(out.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date))).toBe(true);
    expect([...out].sort((a, b) => (a.date < b.date ? 1 : -1))).toEqual(out);
  });

  it('returns nothing rather than throwing when the caller has no cache yet', () => {
    expect(bikeReviewsFrom({ plan, log: {}, moves: {}, activities: [], lapsById: null, paces: REAL })).toEqual([]);
    expect(bikeReviewsFrom({ plan: null, lapsById: {} })).toEqual([]);
  });
});
