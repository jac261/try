import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  powerCurve, curvePoint, curveAvailable, curveComparison, comparable,
  staleDurations, staleFtpSignal, CURVE_DURATIONS, CURVE_LABELS, POWER_CURVE_RULES, FTP_FROM_20MIN,
} from './bike-power-curve.js';
import { riderProfile, trainingImplications, durationSummary, CAPABILITIES, PROFILE_RULES } from './bike-profile.js';
import { ftpRetestRecommendation } from './ftp-retest.js';
import { generatePlan } from './plan.js';

const FTP = 250;
const TODAY = '2026-07-28';
// a rider whose curve is unremarkable against their own threshold
const balanced = (over = {}) => CURVE_DURATIONS.map(d => ({
  durationSec: d,
  watts: Math.round(FTP * { 5: 4.0, 15: 3.0, 30: 2.4, 60: 1.8, 180: 1.38, 300: 1.25, 720: 1.10, 1200: 1 / 0.95, 2400: 1.0, 3600: 0.97 }[d]),
  date: '2026-07-01', source: 'Assioma', bike: 'tt', indoor: false, quality: 'high', ...over,
}));

describe('§1/§7: the analysis stays disabled until the backend supports it', () => {
  it('has nothing to say without curve data, and infers nothing', () => {
    [null, undefined, [], {}, [{}], [{ durationSec: 7, watts: 300 }]].forEach(raw => {
      expect(curveAvailable(raw)).toBe(false);
      expect(powerCurve(raw)).toBe(null);
    });
    expect(riderProfile({ curve: null, ftpWatts: FTP })).toBe(null);
    expect(trainingImplications(null)).toEqual([]);
    expect(staleFtpSignal({ curve: null, ftpWatts: FTP, todayISO: TODAY })).toBe(null);
  });

  it('refuses points that are not on the declared duration grid', () => {
    // a curve assembled from arbitrary durations is not the curve the spec
    // names, and interpolating onto the grid would invent bests nobody set
    expect(curvePoint({ durationSec: 100, watts: 300 })).toBe(null);
    expect(curvePoint({ durationSec: 300, watts: 0 })).toBe(null);
    expect(curvePoint({ durationSec: 300, watts: 'lots' })).toBe(null);
  });
});

describe('§2: the declared durations', () => {
  it('covers exactly the ten the spec lists, in order, all labelled', () => {
    expect(CURVE_DURATIONS).toEqual([5, 15, 30, 60, 180, 300, 720, 1200, 2400, 3600]);
    CURVE_DURATIONS.forEach(d => expect(CURVE_LABELS[d], String(d)).toBeTruthy());
  });

  it('keeps the best watts at each duration when several are offered', () => {
    const c = powerCurve([
      { durationSec: 300, watts: 300, quality: 'high' },
      { durationSec: 300, watts: 320, quality: 'high', source: 'newer' },
      { durationSec: 60, watts: 500, quality: 'high' },
    ]);
    expect(c.points.length).toBe(2);
    expect(c.points.find(p => p.durationSec === 300).watts).toBe(320);
    expect(c.points.find(p => p.durationSec === 300).source).toBe('newer');
    expect(c.durations).toEqual([60, 300]);   // and stays in duration order
  });
});

describe('§7: every point carries source and date metadata', () => {
  it('normalises the fields the spec requires, and never invents them', () => {
    const c = powerCurve(balanced());
    c.points.forEach(p => {
      ['durationSec', 'watts', 'date', 'source', 'bike', 'indoor', 'quality'].forEach(k =>
        expect(k in p, k + ' missing from a curve point').toBe(true));
    });
    // a row with no metadata keeps nulls rather than defaults that look real
    const bare = curvePoint({ durationSec: 300, watts: 300 });
    expect(bare.source).toBe(null);
    expect(bare.indoor).toBe(null);
    // unknown is not bad: defaulting an absent confidence signal to 'low' was
    // a silent kill switch, since the profile filters to medium and above
    expect(bare.quality).toBe('medium');
    expect(bare.qualityKnown).toBe(false);
    expect(curvePoint({ durationSec: 300, watts: 300, quality: 'low' }).quality).toBe('low');
  });
});

describe('§5: a new power meter is not a performance jump', () => {
  it('refuses to compare readings from different sources or environments', () => {
    const a = curvePoint({ durationSec: 300, watts: 300, source: 'Assioma', indoor: false });
    expect(comparable(a, curvePoint({ durationSec: 300, watts: 280, source: 'Assioma', indoor: false }))).toBe(true);
    expect(comparable(a, curvePoint({ durationSec: 300, watts: 280, source: 'Stages', indoor: false }))).toBe(false);
    expect(comparable(a, curvePoint({ durationSec: 300, watts: 280, source: 'Assioma', indoor: true }))).toBe(false);
    expect(comparable(a, curvePoint({ durationSec: 60, watts: 280, source: 'Assioma' }))).toBe(false);
  });

  it('reports a device change instead of a whole-curve improvement', () => {
    // the exact hazard: same legs, new meter reading 5% high
    const previous = powerCurve(balanced({ source: 'Stages' }));
    const current = powerCurve(balanced().map(p => ({ ...p, watts: Math.round(p.watts * 1.05), source: 'Assioma' })));
    const cmp = curveComparison({ current, previous });
    expect(cmp.sourceChanged).toBe(true);
    expect(cmp.improved).toEqual([]);        // nothing is claimed as a gain
    expect(cmp.incomparable.length).toBe(CURVE_DURATIONS.length);
    cmp.rows.forEach(r => expect(r.why).toMatch(/power meter/));
    // a uniform small shift is what a calibration difference looks like, and
    // saying so is more useful than refusing and leaving the athlete guessing
    expect(cmp.sourceShiftPct).toBeCloseTo(5, 0);
    expect(cmp.looksLikeCalibration).toBe(false);   // 5% is beyond the band
    const small = curveComparison({
      current: powerCurve(balanced().map(p => ({ ...p, watts: Math.round(p.watts * 1.02), source: 'Assioma' }))),
      previous: powerCurve(balanced({ source: 'Stages' })),
    });
    expect(small.looksLikeCalibration).toBe(true);
  });

  it('does report a real improvement on the same meter', () => {
    const previous = powerCurve(balanced());
    const current = powerCurve(balanced().map(p => ({ ...p, watts: Math.round(p.watts * 1.05) })));
    const cmp = curveComparison({ current, previous });
    expect(cmp.sourceChanged).toBe(false);
    expect(cmp.improved.length).toBe(CURVE_DURATIONS.length);
    expect(cmp.incomparable).toEqual([]);
  });
});

describe('§6: stale durations are surfaced, not hidden', () => {
  it('flags bests older than a training block, and undated ones', () => {
    const c = powerCurve(balanced().map(p => (p.durationSec === 5 ? { ...p, date: '2025-01-01' } : p)));
    expect(staleDurations(c, TODAY)).toContain(5);
    expect(staleDurations(c, TODAY)).not.toContain(300);
    const undated = powerCurve([{ durationSec: 300, watts: 300, quality: 'high' }]);
    expect(staleDurations(undated, TODAY)).toContain(300);
  });

  it('summarises a duration with everything needed to judge it', () => {
    const c = powerCurve(balanced());
    const d = durationSummary({ point: c.points[0], ftpWatts: FTP, stale: true });
    expect(d.label).toBe('5 sec');
    expect(d.pctOfFtp).toBeGreaterThan(100);
    expect(d.note).toMatch(/may not describe you now/);
  });
});

describe('§3: the reference shape is not asserted against itself', () => {
  /* The fixture above is built from the module's OWN reference ratios, so
     every test using it is circular: a wrong reference table would produce a
     wrong profile and a passing test. This one builds a rider from an
     INDEPENDENT source — the definition of FTP, plus typical trained values
     at the short end — and requires them to read as unremarkable. */
  const INDEPENDENT = {
    5: 4.0, 15: 3.0, 30: 2.4, 60: 1.8, 180: 1.38,
    300: 1.25, 720: 1.10, 1200: 1 / 0.95, 2400: 1.0, 3600: 0.97,
  };

  it('a rider matching a definition-derived reference reads as even, not strong', () => {
    const raw = CURVE_DURATIONS.map(d => ({
      durationSec: d, watts: Math.round(FTP * INDEPENDENT[d]),
      date: '2026-07-01', source: 'A', indoor: false, quality: 'high',
    }));
    const p = riderProfile({ curve: powerCurve(raw), ftpWatts: FTP });
    expect(p.even).toBe(true);
    p.ranked.forEach(s =>
      expect(Math.abs(s.pct), s.label + ' reads ' + s.pct + '% for a rider who is average by construction')
        .toBeLessThan(1.5));
  });

  it('the reference shape agrees with the threshold conversion it shares', () => {
    // if these drift, a rider whose 20-minute power exactly implies their own
    // FTP reads above shape, and durability and VO2 rank top for everybody
    const raw = CURVE_DURATIONS.map(d => ({
      durationSec: d, watts: Math.round(FTP * (d === 1200 ? 1 / FTP_FROM_20MIN : 1)),
      date: '2026-07-01', source: 'A', indoor: false, quality: 'high',
    }));
    const p = riderProfile({ curve: powerCurve(raw), ftpWatts: FTP });
    // the 20-minute point is exactly on shape, so threshold's deviation comes
    // only from its other duration rather than from a mismatched constant
    expect(p.scores.threshold.pct).toBeGreaterThan(-15);
    const twenty = powerCurve(raw).points.find(x => x.durationSec === 1200);
    expect(Math.round(twenty.watts * FTP_FROM_20MIN)).toBe(FTP);
  });
});

describe('§3: the athlete is never reduced to one phenotype', () => {
  const profile = riderProfile({ curve: powerCurve(balanced()), ftpWatts: FTP });

  it('returns a spectrum of five capabilities, not a label', () => {
    expect(Object.keys(profile.scores).sort()).toEqual(Object.keys(CAPABILITIES).sort());
    profile.ranked.forEach(s => expect(typeof s.pct).toBe('number'));
  });

  it('EXPOSES NO FIELD THAT COULD BE USED AS A PHENOTYPE', () => {
    /* §3's one instruction, asserted structurally rather than trusted to
       copy. Labels like "sprinter" or "diesel" are sticky in a way numbers
       are not: an athlete told they are a diesel stops sprinting, and the
       label makes itself true. If a future change adds one, this fails. */
    ['phenotype', 'type', 'category', 'archetype', 'riderType', 'label', 'primary'].forEach(k =>
      expect(k in profile, 'riderProfile exposes a "' + k + '" field, which will be used as a label').toBe(false));
    // and the copy never says "you are a"
    expect(profile.text).not.toMatch(/you are an? \w+ rider/i);
  });

  it('calls an even rider even, rather than forcing a standout', () => {
    expect(profile.even).toBe(true);
    expect(profile.strengths).toEqual([]);
    expect(profile.limiters).toEqual([]);
    expect(profile.text).toMatch(/even across the range/);
    expect(trainingImplications(profile)[0].kind).toBe('even');
  });

  it('names strengths and limiters relative to the athlete THEMSELVES', () => {
    const sprinter = riderProfile({
      curve: powerCurve(balanced().map(p => (p.durationSec <= 15 ? { ...p, watts: Math.round(p.watts * 1.3) } : p))),
      ftpWatts: FTP,
    });
    expect(sprinter.strengths).toContain('sprint');
    expect(sprinter.even).toBe(false);
    // every reading is framed against their own threshold, which is the only
    // thing a curve over FTP can honestly mean
    expect(sprinter.text).toMatch(/your own threshold/);
  });

  it('says when a capability was read from only half its evidence', () => {
    const partial = riderProfile({
      curve: powerCurve(balanced().filter(p => p.durationSec !== 15)), ftpWatts: FTP,
    });
    expect(partial.scores.sprint.confidence).toBe('low');
    expect(partial.scores.vo2.confidence).toBe('medium');
  });

  it('declines to profile a curve too sparse or too untrusted to read', () => {
    expect(riderProfile({ curve: powerCurve(balanced().slice(0, 3)), ftpWatts: FTP })).toBe(null);
    const untrusted = powerCurve(balanced({ quality: 'low' }));
    expect(riderProfile({ curve: untrusted, ftpWatts: FTP })).toBe(null);
    expect(riderProfile({ curve: powerCurve(balanced()), ftpWatts: 0 })).toBe(null);
  });
});

describe('§4/§7: the curve recommends and never rewrites', () => {
  it('every implication names the capability it came from', () => {
    const sprinter = riderProfile({
      curve: powerCurve(balanced().map(p => (p.durationSec <= 15 ? { ...p, watts: Math.round(p.watts * 1.3) } : p))),
      ftpWatts: FTP,
    });
    const out = trainingImplications(sprinter);
    expect(out.length).toBeGreaterThan(0);
    out.forEach(im => {
      expect(['strength', 'limiter', 'even']).toContain(im.kind);
      if (im.kind !== 'even') expect(CAPABILITIES[im.capability], im.capability).toBeTruthy();
      expect(im.text.length).toBeGreaterThan(40);
    });
  });

  it('a high twenty-minute best asks for a test, and never moves FTP', () => {
    const strong = powerCurve(balanced().map(p => (p.durationSec === 1200 ? { ...p, watts: Math.round(FTP * 1.2) } : p)));
    const sig = staleFtpSignal({ curve: strong, ftpWatts: FTP, todayISO: TODAY });
    expect(sig.impliedFtp).toBeGreaterThan(FTP);
    // the plan's bike test is a twenty-minute time trial, not a ramp
    expect(sig.text).toMatch(/twenty-minute test/);
    // §7: it reports, it does not assign. Nothing about the input changed.
    expect(sig.ftpWatts).toBe(FTP);
  });

  it('will not argue from a stale or untrusted twenty-minute best', () => {
    const old = powerCurve(balanced().map(p => (p.durationSec === 1200
      ? { ...p, watts: Math.round(FTP * 1.2), date: '2025-01-01' } : p)));
    expect(staleFtpSignal({ curve: old, ftpWatts: FTP, todayISO: TODAY })).toBe(null);
    const untrusted = powerCurve(balanced().map(p => (p.durationSec === 1200
      ? { ...p, watts: Math.round(FTP * 1.2), quality: 'low' } : p)));
    expect(staleFtpSignal({ curve: untrusted, ftpWatts: FTP, todayISO: TODAY })).toBe(null);
    // and an ordinary curve says nothing at all
    expect(staleFtpSignal({ curve: powerCurve(balanced()), ftpWatts: FTP, todayISO: TODAY })).toBe(null);
  });

  it('reaches the athlete through the retest nudge, not through the plan', () => {
    const plan = generatePlan({
      name: 'S', raceType: 'half', fitness: 'intermediate', fivekSec: 1200, css100Sec: 120,
      ftp: FTP, weightKg: 75, daysPerWeek: 6, trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5,
      startDate: '2026-06-01', raceDate: '2026-11-01',
    });
    plan.profile.ftpMeta = { source: 'try-test', measuredAt: '2026-05-01', confidence: 'high' };
    /* A date with no ramp test scheduled near it. The plan books one for
       2026-07-29, and a test already in the diary correctly silences the
       whole recommendation — which is why the first version of this test
       failed, and is behaviour worth keeping rather than working around. */
    const day = '2026-06-15';
    const strong = powerCurve(balanced().map(p => (p.durationSec === 1200
      ? { ...p, watts: Math.round(FTP * 1.2), date: '2026-06-10' } : { ...p, date: '2026-06-10' })));
    const rec = ftpRetestRecommendation({
      plan, activities: [], thresholds: null, log: {}, moves: {}, todayISO: day, powerCurve: strong,
    });
    expect(rec, 'the curve signal never reaches the athlete').toBeTruthy();
    expect(rec.reason).toBe('curve-high');
    // and the plan is untouched: a recommendation, not an edit
    expect(plan.profile.ftp).toBe(FTP);
  });
});

describe('nothing here is a model without a caller', () => {
  it('every exported function is reachable from the app', () => {
    /* The same guard phase 6 needed, extended. A fully gated module is the
       easiest place in the world to ship something nothing calls, because
       nothing renders either way and no test notices. */
    const MODULES = ['bike-power-curve.js', 'bike-profile.js'];
    const srcFiles = [];
    const walk = dir => readdirSync(dir, { withFileTypes: true }).forEach(e => {
      const full = dir + '/' + e.name;
      if (e.isDirectory()) walk(full);
      else if (/\.jsx?$/.test(e.name) && !/\.test\./.test(e.name)) srcFiles.push(full);
    });
    walk(new URL('..', import.meta.url).pathname.replace(/\/$/, ''));
    const prodUses = name => srcFiles.filter(f => !/\/(bike-power-curve|bike-profile)\.js$/.test(f)
      && !f.endsWith('/index.js')
      && new RegExp('\\b' + name + '\\b').test(readFileSync(f, 'utf8'))).length;

    MODULES.forEach(mod => {
      const src = readFileSync(new URL('./' + mod, import.meta.url), 'utf8');
      const exported = [...src.matchAll(/export function (\w+)/g)].map(m => m[1]);
      expect(exported.length, mod + ' exports no functions').toBeGreaterThan(0);
      expect(exported.some(n => prodUses(n) > 0),
        mod + ' has no export the app actually calls: it is a model with no caller').toBe(true);
      exported.forEach(name => {
        // a bare reference counts: raw.map(curvePoint) is a call site
        const internal = new RegExp('\\b' + name + '\\b').test(
          src.replace(new RegExp('export function ' + name + '[^]*?\\n}', 'm'), ''));
        expect(prodUses(name) > 0 || internal,
          mod + ' exports ' + name + ', which nothing in the app and nothing in its own module calls').toBe(true);
      });
    });
  });

  it('every rule in the tables is actually used', () => {
    const src = readFileSync(new URL('./bike-power-curve.js', import.meta.url), 'utf8')
      + readFileSync(new URL('./bike-profile.js', import.meta.url), 'utf8');
    Object.keys(POWER_CURVE_RULES).forEach(k =>
      expect(src.split(k).length - 1, 'POWER_CURVE_RULES.' + k + ' is declared but never used').toBeGreaterThan(1));
    Object.keys(PROFILE_RULES).forEach(k =>
      expect(src.split(k).length - 1, 'PROFILE_RULES.' + k + ' is declared but never used').toBeGreaterThan(1));
  });
});


/* Gauntlet regressions. Each reproduces a defect the review agents
   demonstrated end to end. */
const pt = over => curvePoint({ durationSec: 1200, watts: 263, source: 'A', bike: 'tt', indoor: false, quality: 'high', ...over });

describe('gauntlet: comparability fails CLOSED', () => {
  it('an unknown source is not a matching source', () => {
    /* The guard required BOTH sides to name a source before refusing, so a
       point with no source compared equal to a point from any meter on earth
       — and one older curve stored before the field existed switched the
       whole §5 protection off. */
    expect(comparable(pt(), pt({ source: null }))).toBe(false);
    expect(comparable(pt({ source: null }), pt({ source: null }))).toBe(true);
  });

  it('checks the bike and the environment, which §5 also requires', () => {
    expect(comparable(pt(), pt({ bike: 'road' }))).toBe(false);
    expect(comparable(pt(), pt({ indoor: true }))).toBe(false);
    expect(comparable(pt(), pt({ indoor: null }))).toBe(false);
  });

  it('a curve with no sources at all is not silently improved', () => {
    const strip = p => ({ ...p, source: undefined });
    const previous = powerCurve(balanced().map(strip));
    const current = powerCurve(balanced().map(p => ({ ...strip(p), watts: Math.round(p.watts * 1.05), source: 'NewMeter' })));
    const cmp = curveComparison({ current, previous });
    expect(cmp.improved, 'a meter change was reported as a gain at every duration').toEqual([]);
    expect(cmp.incomparable.length).toBe(CURVE_DURATIONS.length);
  });
});

describe('gauntlet: the stale-FTP signal obeys the detector the module built', () => {
  it('says nothing when the best came from a different meter than the last curve', () => {
    const previous = powerCurve(balanced({ source: 'Old' }));
    const current = powerCurve(balanced({ source: 'New' }).map(p => (p.durationSec === 1200
      ? { ...p, watts: Math.round(FTP * 1.2) } : p)));
    // without the previous curve it fires; with it, the meter change silences it
    expect(staleFtpSignal({ curve: current, ftpWatts: FTP, todayISO: TODAY })).toBeTruthy();
    expect(staleFtpSignal({ curve: current, previous, ftpWatts: FTP, todayISO: TODAY })).toBe(null);
  });

  it('says nothing when the threshold was set on a different device', () => {
    const curve = powerCurve(balanced({ source: 'New' }).map(p => (p.durationSec === 1200
      ? { ...p, watts: Math.round(FTP * 1.2) } : p)));
    expect(staleFtpSignal({ curve, ftpWatts: FTP, todayISO: TODAY, ftpSource: 'Old' })).toBe(null);
    expect(staleFtpSignal({ curve, ftpWatts: FTP, todayISO: TODAY, ftpSource: 'New' })).toBeTruthy();
  });
});

describe('gauntlet: a non-finite reading is not a reading', () => {
  it('rejects Infinity rather than rendering it', () => {
    expect(curvePoint({ durationSec: 1200, watts: Infinity })).toBe(null);
    expect(curvePoint({ durationSec: 1200, watts: -Infinity })).toBe(null);
    expect(curvePoint({ durationSec: 1200, watts: NaN })).toBe(null);
    expect(powerCurve([{ durationSec: 1200, watts: Infinity, quality: 'high' }])).toBe(null);
  });
});

describe('gauntlet: the shift estimate describes the DEVICE change only', () => {
  it('does not average in rows that differ for other reasons', () => {
    const previous = powerCurve(balanced({ source: 'Old' }));
    // one duration changed meter by 2%; the rest merely moved indoors
    const current = powerCurve(balanced().map(p => (p.durationSec === 1200
      ? { ...p, source: 'New', watts: Math.round(p.watts * 1.02) }
      : { ...p, source: 'Old', indoor: true, watts: Math.round(p.watts * 1.4) })));
    const cmp = curveComparison({ current, previous });
    expect(cmp.sourceChanged).toBe(true);
    // the 40% indoor rows must not dilute the calibration estimate
    expect(cmp.sourceShiftPct).toBeCloseTo(2, 0);
    expect(cmp.looksLikeCalibration).toBe(true);
  });
});

describe('gauntlet: a duration that disappeared is a case, not a silence', () => {
  it('buckets durations present before and absent now', () => {
    const previous = powerCurve(balanced());
    const current = powerCurve(balanced().filter(p => p.durationSec !== 5));
    const cmp = curveComparison({ current, previous });
    expect(cmp.gone).toEqual([5]);
    expect(cmp.rows.find(r => r.durationSec === 5).status).toBe('gone');
  });
});

describe('gauntlet: the profile describes a shape, not a threshold', () => {
  it('a uniformly wrong FTP does not manufacture five strengths', () => {
    /* Every raw score is relative to ftpWatts, so a stale or
       differently-measured threshold moved all five capabilities together —
       and the spread between a ramp-test FTP and a 20-minute-test FTP is
       wider than the strength band, so it could invent a whole profile. */
    const curve = powerCurve(balanced());
    const right = riderProfile({ curve, ftpWatts: FTP });
    const stale = riderProfile({ curve, ftpWatts: Math.round(FTP * 0.88) });
    expect(stale.strengths, 'a stale FTP invented strengths').toEqual(right.strengths);
    expect(stale.limiters).toEqual(right.limiters);
    stale.ranked.forEach(sc => expect(Math.abs(sc.pct - right.scores[sc.key].pct)).toBeLessThan(0.5));
    // but the level shift is still reported, because it is the real finding
    expect(stale.levelPct).toBeGreaterThan(right.levelPct + 5);
  });

  it('does not call a rider even having seen one end of their range', () => {
    const shortOnly = powerCurve(balanced().filter(p => p.durationSec <= 180));
    const p = riderProfile({ curve: shortOnly, ftpWatts: FTP });
    expect(p.even).toBe(false);
    expect(p.covered).toBeLessThan(p.capabilities);
    expect(p.text).toMatch(/partial picture/);
  });
});

describe('gauntlet: the curve never outranks or contradicts recent evidence', () => {
  const planFor = () => {
    const pl = generatePlan({
      name: 'S', raceType: 'half', fitness: 'intermediate', fivekSec: 1200, css100Sec: 120,
      ftp: FTP, weightKg: 75, daysPerWeek: 6, trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5,
      startDate: '2026-06-01', raceDate: '2026-11-01',
    });
    pl.profile.ftpMeta = { source: 'try-test', measuredAt: '2026-05-01', confidence: 'high' };
    return pl;
  };
  const strongCurve = powerCurve(balanced().map(p => (p.durationSec === 1200
    ? { ...p, watts: Math.round(FTP * 1.2), date: '2026-06-10' } : { ...p, date: '2026-06-10' })));
  const under = { type: 'Threshold', powerAdherence: -8, confidence: 'high', completion: 100, date: '2026-06-12' };

  it('stands down when the last few sessions argue the opposite way', () => {
    const rec = ftpRetestRecommendation({
      plan: planFor(), activities: [], thresholds: null, log: {}, moves: {}, todayISO: '2026-06-15',
      powerCurve: strongCurve, reviews: [under, under, under],
    });
    expect(rec.reason, 'told the threshold moved UP beside three sessions that came in UNDER').toBe('reps-under');
    expect(rec.reasons).not.toContain('curve-high');
  });

  it('stands down for a rider who has not ridden in months', () => {
    const rec = ftpRetestRecommendation({
      plan: planFor(), thresholds: null, log: {}, moves: {}, todayISO: '2026-06-15',
      powerCurve: strongCurve,
      activities: [{ id: 'a', type: 'Ride', date: '2026-03-20', movingTimeSec: 3600 }],
    });
    expect(rec.reason).toBe('returning');
    expect(rec.reasons).not.toContain('curve-high');
  });

  it('but still speaks when nothing else does', () => {
    const rec = ftpRetestRecommendation({
      plan: planFor(), activities: [], thresholds: null, log: {}, moves: {}, todayISO: '2026-06-15',
      powerCurve: strongCurve,
    });
    expect(rec.reason).toBe('curve-high');
  });
});

describe('gauntlet: the WIRING is asserted, not just the function', () => {
  it('App actually hands the curve to the retest', () => {
    /* The previous test in this file called ftpRetestRecommendation directly
       with a powerCurve and passed, while App omitted the argument entirely —
       so the one behavioural application of the whole phase was dead and a
       green test said otherwise. Testing a function proves a function. */
    const app = readFileSync(new URL('../app/App.jsx', import.meta.url), 'utf8');
    const call = app.match(/T\.ftpRetestRecommendation\(\{[^}]*\}\)/);
    expect(call, 'no retest call site found in App').toBeTruthy();
    expect(call[0], 'App does not pass powerCurve to the retest').toMatch(/powerCurve/);
  });

  it('the curve card is rendered by something, not merely defined', () => {
    // the no-caller guard counts references across src files, and a component
    // referencing the lib satisfies it whether or not anything renders the
    // component
    const pv = readFileSync(new URL('../features/progress/ProgressView.jsx', import.meta.url), 'utf8');
    expect(pv).toMatch(/<PowerCurveCard/);
    const app = readFileSync(new URL('../app/App.jsx', import.meta.url), 'utf8');
    expect(app).toMatch(/previousPowerCurve=\{prevPowerCurve\}/);
    expect(app).toMatch(/loadPowerCurve/);
  });
});
