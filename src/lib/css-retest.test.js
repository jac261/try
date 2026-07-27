import { describe, it, expect } from 'vitest';
import { generatePlan, addCssTest, removeCustomWorkout } from './plan.js';
import { cssRetestRecommendation, RETEST_RULES, PERF_TYPES, prescribedSwim } from './css-retest.js';
import { tuneFields } from './tuning.js';
import { cssTestIssues, cssFromTestIntervals, cssTestProtocol, cssProposalDetails, eftpProposal } from './eftp.js';
import { iso, addDays, daysBetween } from './date.js';

/* Phase 3b: the retest recommendation (§5), the failure explanations (§7)
   and the proposal evidence (§6). The recommendation is a nudge with copy
   and a dismissal signature, never a threshold change. */

const base = {
  name: 'R', raceType: 'olympic', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 320, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-09-27',
};

// a "today" with no swimCss test swum recently or scheduled soon, so the
// suppression windows stay out of the way of the signal under test
const quietToday = plan => {
  const tests = plan.weeks.flatMap(w => w.workouts).filter(w => w.test && w.testKind === 'swimCss');
  const latest = tests.map(w => w.date).sort().pop() || plan.weeks[0].start;
  return iso(addDays(latest, 1));
};

describe('cssRetestRecommendation: metadata signals', () => {
  it('recommends a test when CSS is missing entirely', () => {
    const plan = generatePlan({ ...base, css100Sec: null });
    const r = cssRetestRecommendation({ plan, todayISO: quietToday(plan) });
    expect(r && r.reason).toBe('missing');
    expect(r.headline).toBeTruthy();
    expect(r.sig).toContain('missing');
  });

  it('recommends verification for a legacy hand entry with no date, but not for a dated fresh one', () => {
    const legacy = generatePlan(base); // no cssMeta at all
    const today = quietToday(legacy);
    expect(cssRetestRecommendation({ plan: legacy, todayISO: today }).reason).toBe('unverified');
    const fresh = generatePlan({ ...base, cssMeta: { source: 'manual', measuredAt: iso(addDays(today, -7)), confidence: 'medium' } });
    expect(cssRetestRecommendation({ plan: fresh, todayISO: today })).toBe(null);
  });

  it('a measured test needs no verifying, but goes stale after eight weeks', () => {
    const today = quietToday(generatePlan(base));
    const measured = at => generatePlan({ ...base, cssMeta: { source: 'try-test', measuredAt: at, confidence: 'high' } });
    expect(cssRetestRecommendation({ plan: measured(iso(addDays(today, -21))), todayISO: today })).toBe(null);
    const r = cssRetestRecommendation({ plan: measured(iso(addDays(today, -(RETEST_RULES.staleDays + 7)))), todayISO: today });
    expect(r && r.reason).toBe('stale');
    expect(r.why).toContain('weeks ago');
  });

  it('a materially different intervals.icu threshold asks for a test, close agreement does not', () => {
    const today = quietToday(generatePlan(base));
    const plan = generatePlan({ ...base, cssMeta: { source: 'manual', measuredAt: iso(addDays(today, -7)), confidence: 'medium' } });
    const far = cssRetestRecommendation({ plan, thresholds: { swimThresholdPace: 100 / 140 }, todayISO: today });
    expect(far && far.reason).toBe('icu');
    expect(cssRetestRecommendation({ plan, thresholds: { swimThresholdPace: 100 / 121 }, todayISO: today })).toBe(null);
  });

  it('never fires on tracker mode, a solo run plan, or a swim-excluded triathlete', () => {
    const solo = generatePlan({ ...base, raceType: 'run5k', css100Sec: null });
    expect(cssRetestRecommendation({ plan: solo, todayISO: quietToday(solo) })).toBe(null);
    const excl = generatePlan({ ...base, css100Sec: null, excludedDiscipline: 'swim' });
    expect(cssRetestRecommendation({ plan: excl, todayISO: quietToday(excl) })).toBe(null);
    expect(cssRetestRecommendation({ plan: { race: 'tracker', weeks: [] }, todayISO: '2026-07-01' })).toBe(null);
  });
});

describe('cssRetestRecommendation: test-window suppression', () => {
  it('stays quiet when a CSS test is scheduled within a fortnight or was swum within a month', () => {
    const plan = generatePlan({ ...base, css100Sec: null }); // missing would otherwise always fire
    const test = plan.weeks.flatMap(w => w.workouts).find(w => w.test && w.testKind === 'swimCss');
    expect(test).toBeTruthy();
    // a week out from the scheduled test: the plan already has it covered
    expect(cssRetestRecommendation({ plan, todayISO: iso(addDays(test.date, -7)) })).toBe(null);
    // a week after swimming it: give the proposal flow room to work
    expect(cssRetestRecommendation({ plan, log: { [test.id]: { done: true } }, todayISO: iso(addDays(test.date, 7)) })).toBe(null);
    // the same week after NOT swimming it: the nudge is back
    expect(cssRetestRecommendation({ plan, todayISO: iso(addDays(test.date, 7)) })).not.toBe(null);
  });
});

describe('cssRetestRecommendation: performance signals', () => {
  // log the most recent quality swims and fabricate matched recordings a
  // fixed drift off the prescribed average pace
  const rig = driftPct => {
    // date the measurement fresh relative to the window under test, so the
    // stale signal cannot shadow the performance one; generation is
    // deterministic, so probing dates first then regenerating is safe
    const probe = generatePlan(base);
    const dates = probe.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline === 'swim' && !w.test && PERF_TYPES.includes(w.type))
      .map(w => w.date).sort();
    // anchor on three quality swims close enough together that all sit
    // inside the lookback window; the test must never pass vacuously
    let anchor = -1;
    for (let i = dates.length - 1; i >= 2; i--) {
      if (daysBetween(dates[i - 2], dates[i]) <= RETEST_RULES.lookbackDays - 4) { anchor = i; break; }
    }
    expect(anchor).toBeGreaterThanOrEqual(2);
    const cluster = [dates[anchor - 2], dates[anchor - 1], dates[anchor]];
    const today = iso(addDays(cluster[2], 2));
    // measured just before the cluster: fresh enough that stale cannot fire,
    // and early enough that every cluster swim postdates it (sinceISO)
    const plan = generatePlan({ ...base, cssMeta: { source: 'try-test', measuredAt: iso(addDays(cluster[0], -1)), confidence: 'high' } });
    const picked = plan.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline === 'swim' && !w.test && PERF_TYPES.includes(w.type))
      .filter(w => cluster.includes(w.date))
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(0, 3);
    expect(picked.length).toBe(3);
    const log = {}; const activities = [];
    picked.forEach((w, i) => {
      log[w.id] = { done: true };
      // swim the whole session at the prescribed pure-swim pace, drifted
      const { distM, sec } = prescribedSwim(w);
      expect(distM).toBeGreaterThan(0);
      activities.push({ id: 'a' + i, type: 'Swim', date: w.date, distance: distM, movingTimeSec: Math.round(sec * (1 - driftPct)) });
    });
    return { plan, log, activities, today };
  };

  it('three quality swims well faster than prescribed recommend a retest upward', () => {
    const { plan, log, activities, today } = rig(0.06);
    const r = cssRetestRecommendation({ plan, activities, log, todayISO: today });
    // the freshly measured CSS raises no metadata signal, so the nudge IS the pattern
    expect(r && r.reason).toBe('perf-fast');
    // the same recordings on pace raise nothing
    const flat = rig(0);
    expect(cssRetestRecommendation({ plan: flat.plan, activities: flat.activities, log: flat.log, todayISO: flat.today })).toBe(null);
  });

  it('three quality swims well slower than prescribed recommend a check the other way', () => {
    const { plan, log, activities, today } = rig(-0.06);
    const r = cssRetestRecommendation({ plan, activities, log, todayISO: today });
    expect(r && r.reason).toBe('perf-slow');
  });

  it('open water recordings never count towards the pattern', () => {
    const { plan, log, activities, today } = rig(0.06);
    const ow = activities.map(a => ({ ...a, type: 'OpenWaterSwim' }));
    expect(cssRetestRecommendation({ plan, activities: ow, log, todayISO: today })).toBe(null);
  });
});

describe('cssTestIssues explains exactly what cssFromTestIntervals rejects (§7)', () => {
  const lap = (distance, movingTimeSec) => ({ type: 'WORK', distance, movingTimeSec });
  const good = [lap(400, 400), lap(200, 190)];
  const cases = [
    { name: 'valid test', rows: good, ok: true },
    { name: 'empty', rows: [], ok: false },
    { name: 'no 400', rows: [lap(200, 190)], ok: false },
    { name: 'two 400s', rows: [lap(400, 400), lap(410, 415), lap(200, 190)], ok: false },
    { name: 'no 200', rows: [lap(400, 400)], ok: false },
    { name: 'ratio off', rows: [lap(400, 400), lap(240, 220)], ok: false },
    { name: '200 slower than 400', rows: [lap(400, 400), lap(200, 220)], ok: false },
    { name: 'implausible css', rows: [lap(400, 1200), lap(200, 200)], ok: false },
  ];
  cases.forEach(c => it(c.name + (c.ok ? ' parses with no issue' : ' fails closed with a reason'), () => {
    const parsed = cssFromTestIntervals(c.rows);
    const issue = cssTestIssues(c.rows);
    if (c.ok) {
      expect(parsed).not.toBe(null);
      expect(issue).toBe(null);
    } else {
      expect(parsed).toBe(null);
      expect(typeof issue).toBe('string');
      expect(issue.length).toBeGreaterThan(10);
    }
  }));
});

describe('cssTestProtocol matches the built test on any pool', () => {
  it('presets keep 400/200 and a custom pool rounds to whole lengths with an exact divisor', () => {
    expect(cssTestProtocol({ pool: { length: 25, unit: 'metres' } })).toEqual({ d1: 400, d2: 200, unit: 'm', divisor: 2 });
    expect(cssTestProtocol({ pool: { length: 25, unit: 'yards' } })).toEqual({ d1: 400, d2: 200, unit: 'yd', divisor: 2 });
    expect(cssTestProtocol({ pool: { length: 33, unit: 'metres' } })).toEqual({ d1: 396, d2: 198, unit: 'm', divisor: 1.98 });
    expect(cssTestProtocol({})).toEqual({ d1: 400, d2: 200, unit: 'm', divisor: 2 });
  });
});

describe('cssProposalDetails: the evidence sheet payload (§6)', () => {
  const plan = generatePlan(base); // css 120
  const prop = eftpProposal({
    activities: [], plan, todayISO: '2026-06-10', thresholds: null,
    cssTest: { actId: 'a1', date: '2026-06-10', test: { css100Sec: 112, t400Sec: 420, t200Sec: 196, d400: 400, d200: 200 } },
  });

  it('lays out current, proposed, delta, percent, provenance and the example session', () => {
    const d = cssProposalDetails({ proposal: prop, plan, todayISO: '2026-06-10' });
    expect(d.curLabel).toContain('2:00');
    expect(d.nextLabel).toContain('1:52');
    expect(d.deltaDisp).toBe(-8);
    expect(d.unit).toBe('m');
    expect(d.pct).toBeCloseTo(6.7, 1);
    expect(d.faster).toBe(true);
    expect(d.source).toBe('try-test');
    expect(d.measuredAt).toBe('2026-06-10');
    expect(d.confidence).toBe('high');
    // the example quotes the next CSS Intervals session with the 3a target band
    if (d.example) {
      expect(d.example.date >= '2026-06-10').toBe(true);
      expect(d.example.band).toMatch(/to/);
    }
  });

  it('returns null for non-swim proposals and delta in yard seconds on a yard pool', () => {
    expect(cssProposalDetails({ proposal: { sport: 'bike', retarget: { ftp: 300 } }, plan, todayISO: '2026-06-10' })).toBe(null);
    const yplan = generatePlan({ ...base, pool: { length: 25, unit: 'yards' } });
    const yd = cssProposalDetails({ proposal: prop, plan: yplan, todayISO: '2026-06-10' });
    expect(yd.unit).toBe('yd');
    expect(yd.deltaDisp).toBe(-7); // 8 metre-seconds shrink in yard display
  });
});

describe('addCssTest: the nudge can schedule the real benchmark', () => {
  it('adds a removable custom workout that the auto-CSS reader will recognise', () => {
    const plan = generatePlan(base);
    const day = plan.weeks[2].start;
    const { plan: np, workout } = addCssTest(plan, day);
    expect(workout.test).toBe(true);
    expect(workout.testKind).toBe('swimCss');
    expect(workout.type).toBe('Test');
    expect(workout.discipline).toBe('swim');
    expect(workout.custom).toBe(true);
    expect(workout.date).toBe(day);
    expect(workout.segments.some(s => /time trial/.test(s.label))).toBe(true);
    const wk = np.weeks[2];
    expect(wk.workouts.some(w => w.id === workout.id)).toBe(true);
    expect(wk.totalMin).toBe(plan.weeks[2].totalMin + workout.durationMin);
    // and it comes out again cleanly
    const removed = removeCustomWorkout(np, workout.id);
    expect(removed.weeks[2].workouts.some(w => w.id === workout.id)).toBe(false);
    expect(removed.weeks[2].totalMin).toBe(plan.weeks[2].totalMin);
  });
});

describe('Phase 3b gauntlet fixes', () => {
  it('a swim feel-tune stamps estimated provenance instead of leaving a swum-test claim on the tuned value', () => {
    const profile = { fitness: 'intermediate', css100Sec: 120, fivekSec: 1200, ftp: 300 };
    const fields = tuneFields(profile, [{ discipline: 'swim', direction: 'faster' }]);
    expect(fields.css100Sec).toBe(118);
    expect(fields.cssMeta.source).toBe('estimated');
    expect(fields.cssMeta.confidence).toBe('low');
    expect(fields.cssMeta.measuredAt).toBeTruthy();
    // a run-only tune must not touch swim provenance
    const runOnly = tuneFields(profile, [{ discipline: 'run', direction: 'faster' }]);
    expect('cssMeta' in runOnly).toBe(false);
  });

  it('swims from before the current CSS was set cannot judge it (no perf nudge right after a retarget)', () => {
    // same fast recordings as the perf-fast case, but the CSS was set AFTER
    // they were swum: the plan regenerated at the new paces, so those swims
    // executed a prescription that no longer exists
    const probe = generatePlan(base);
    const dates = probe.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline === 'swim' && !w.test && PERF_TYPES.includes(w.type))
      .map(w => w.date).sort();
    let anchor = -1;
    for (let i = dates.length - 1; i >= 2; i--) {
      if (daysBetween(dates[i - 2], dates[i]) <= RETEST_RULES.lookbackDays - 4) { anchor = i; break; }
    }
    const cluster = [dates[anchor - 2], dates[anchor - 1], dates[anchor]];
    const today = iso(addDays(cluster[2], 2));
    const plan = generatePlan({ ...base, cssMeta: { source: 'intervals-icu', measuredAt: iso(addDays(cluster[2], 1)), confidence: 'medium' } });
    const log = {}; const activities = [];
    plan.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline === 'swim' && !w.test && PERF_TYPES.includes(w.type) && cluster.includes(w.date))
      .slice(0, 3).forEach((w, i) => {
        log[w.id] = { done: true };
        const { distM, sec } = prescribedSwim(w);
        activities.push({ id: 'a' + i, type: 'Swim', date: w.date, distance: distM, movingTimeSec: Math.round(sec * 0.94) });
      });
    expect(cssRetestRecommendation({ plan, activities, log, todayISO: today })).toBe(null);
  });

  it('one recording never supplies two drift reads when two quality swims share a day', () => {
    const probe = generatePlan(base);
    const longs = probe.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline === 'swim' && !w.test && w.type === 'Long')
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    // two Long swims moved onto one day, plus a third quality swim nearby:
    // without claim bookkeeping the shared recording would count twice and
    // 2 real swims could fake the 3-read pattern
    const trio = [];
    for (let i = 0; i + 1 < longs.length && trio.length === 0; i++) {
      const near = longs.filter(w => w !== longs[i] && Math.abs(daysBetween(longs[i].date, w.date)) <= RETEST_RULES.lookbackDays - 6);
      if (near.length >= 2) trio.push(longs[i], near[0], near[1]);
    }
    expect(trio.length).toBe(3);
    const [A, B, C] = trio;
    const moves = { [B.id]: A.date }; // B rides A's day, no recording of its own
    const today = iso(addDays([A, B, C].map(w => w.date).sort().pop(), 2));
    // measured just before the window so neither stale nor sinceISO interferes
    const fresh = generatePlan({ ...base, cssMeta: { source: 'try-test', measuredAt: iso(addDays(today, -1 - RETEST_RULES.lookbackDays)), confidence: 'high' } });
    const log = { [A.id]: { done: true }, [B.id]: { done: true }, [C.id]: { done: true } };
    const pA = prescribedSwim(A), pC = prescribedSwim(C);
    // preconditions that make the double-count reachable: the shared
    // recording sits inside B's duration and distance guards too
    const pB = prescribedSwim(B);
    expect(pA.distM).toBeGreaterThanOrEqual(pB.distM * 0.75);
    expect(pA.distM).toBeLessThanOrEqual(pB.distM * 1.25);
    const activities = [
      { id: 'one', type: 'Swim', date: A.date, distance: pA.distM, movingTimeSec: Math.round(pA.sec * 0.94) },
      { id: 'two', type: 'Swim', date: C.date, distance: pC.distM, movingTimeSec: Math.round(pC.sec * 0.94) },
    ];
    // two genuine fast reads are not a pattern; a doubled read would fake one
    expect(cssRetestRecommendation({ plan: fresh, activities, log, moves, todayISO: today })).toBe(null);
  });

  it('a swum test that resolved to nothing does not buy four weeks of silence', () => {
    const plan = generatePlan({ ...base, css100Sec: null });
    const test = plan.weeks.flatMap(w => w.workouts).find(w => w.test && w.testKind === 'swimCss');
    const args = { plan, log: { [test.id]: { done: true } }, todayISO: iso(addDays(test.date, 7)) };
    expect(cssRetestRecommendation(args)).toBe(null); // resolved or unknown: quiet
    expect(cssRetestRecommendation({ ...args, unresolvedTest: true })).not.toBe(null);
  });
});
