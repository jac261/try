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
    expect(bare.quality).toBe('low');      // untrusted until told otherwise
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
    expect(sig.text).toMatch(/ramp test/);
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
