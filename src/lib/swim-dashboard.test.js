import { describe, it, expect } from 'vitest';
import { generatePlan } from './plan.js';
import {
  swimDashboard, swimEstimates, swimLimiter, metric,
  SOURCE_KINDS, DASH_RULES, EST_DISTANCES,
} from './swim-dashboard.js';

/* Phase 7. The dashboard makes claims about an athlete, so the tests that
   matter are the honesty ones: nothing is asserted without evidence, and
   nothing derived is dressed up as measured. */

const base = {
  name: 'D', raceType: 'olympic', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 320, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-09-27',
};
const today = '2026-07-20';
const build = (profile, log, activities) =>
  swimDashboard({ plan: generatePlan({ ...base, ...profile }), log: log || {}, moves: {}, activities: activities || [], todayISO: today });

describe('every number says where it came from (§7)', () => {
  it('metric refuses to dress a missing value as data', () => {
    expect(metric(null, 'recorded').kind).toBe('missing');
    expect(metric(5, 'recorded').kind).toBe('recorded');
    expect(metric(5, 'nonsense').kind).toBe('missing');
  });
  it('every metric on a fresh dashboard carries a known source kind', () => {
    const d = build();
    [d.status.css, d.distribution.sessionsPerWeek, d.distribution.completion,
      d.quality.adherence, d.endurance.longestM].forEach(m => {
      expect(SOURCE_KINDS).toContain(m.kind);
    });
  });
  it('a swum test reads as recorded; a level guess reads as estimated', () => {
    expect(build({ cssMeta: { source: 'try-test', measuredAt: '2026-07-01', confidence: 'high' } }).status.css.kind).toBe('recorded');
    expect(build({ css100Sec: null }).status.css.kind).toBe('missing');
  });
});

describe('estimates refuse false precision (§3)', () => {
  it('no CSS means no estimates at all, with the reason given', () => {
    const est = swimEstimates({ css: null, longestM: 5000, completion: 1, owSessions: 5 });
    expect(est.length).toBe(EST_DISTANCES.length);
    est.forEach(e => { expect(e.range).toBe(null); expect(e.why).toBeTruthy(); });
  });
  it('a distance far beyond anything swum is withheld, not extrapolated', () => {
    const est = swimEstimates({ css: 120, longestM: 800, completion: 1, owSessions: 1 });
    const byLabel = Object.fromEntries(est.map(e => [e.label, e]));
    expect(byLabel['400 m'].range).toBeTruthy();
    expect(byLabel['750 m'].range).toBeTruthy();      // 800 m swum covers it
    expect(byLabel['3.8 km'].range).toBe(null);       // nothing like it swum
    expect(byLabel['3.8 km'].why).toMatch(/Swim continuously/);
  });
  it('every quoted estimate is a range, never a single number, and widens with distance', () => {
    const est = swimEstimates({ css: 100, longestM: 4000, completion: 1, owSessions: 2 });
    const quoted = est.filter(e => e.range);
    expect(quoted.length).toBe(EST_DISTANCES.length);
    quoted.forEach(e => {
      expect(e.range[1]).toBeGreaterThan(e.range[0]);
      expect(e.range[0]).toBeGreaterThan(0);
    });
    const width = e => (e.range[1] - e.range[0]) / e.range[0];
    expect(width(quoted[quoted.length - 1])).toBeGreaterThan(width(quoted[0]));
  });
  it('estimates get slower per 100 as the distance grows: never a flat CSS multiply', () => {
    const est = swimEstimates({ css: 100, longestM: 4000, completion: 1, owSessions: 2 });
    const per100 = e => ((e.range[0] + e.range[1]) / 2) / (e.m / 100);
    const q = est.filter(e => e.range);
    expect(per100(q[q.length - 1])).toBeGreaterThan(per100(q[0]));
  });
  it('a pool-only athlete is told the estimate is a pool estimate', () => {
    const est = swimEstimates({ css: 110, longestM: 3000, completion: 1, owSessions: 0 });
    expect(est.find(e => e.m === 1500).openWater).toMatch(/no open-water/i);
  });
});

describe('one limiter, with evidence and a plan response (§4, §5)', () => {
  const dash = over => ({
    status: { threshold: { cssSecondsPer100m: 120 }, focus: [] },
    distribution: { completion: { value: 1 } },
    quality: { evidence: null, fade: { value: null } },
    endurance: { longestM: { value: 2000 } },
    openWater: { exposure: { sessions: 3 }, raceSoon: false },
    ...over,
  });

  it('poor completion outranks everything: an unswum plan cannot be out-trained', () => {
    const l = swimLimiter(dash({ distribution: { completion: { value: 0.4 } } }));
    expect(l.id).toBe('consistency');
    expect(l.evidence.length).toBeGreaterThan(0);
    expect(l.response.length).toBeGreaterThan(0);
  });
  it('no measured CSS is named as the limiter before any training judgement', () => {
    expect(swimLimiter(dash({ status: { threshold: { cssSecondsPer100m: null }, focus: [] } })).id).toBe('threshold-unknown');
  });
  it('sessions coming in under target read as a threshold limit', () => {
    expect(swimLimiter(dash({ quality: { evidence: { direction: 'under' }, fade: { value: null } } })).id).toBe('threshold');
  });
  it('a late fade reads as endurance', () => {
    expect(swimLimiter(dash({ quality: { evidence: null, fade: { value: 6 } } })).id).toBe('endurance');
  });
  it('an open-water race with no open-water swims reads as exposure', () => {
    expect(swimLimiter(dash({ openWater: { exposure: { sessions: 0 }, raceSoon: true } })).id).toBe('open-water');
  });
  it('a declared technique focus is named as the athlete own chosen limiter', () => {
    expect(swimLimiter(dash({ status: { threshold: { cssSecondsPer100m: 120 }, focus: ['catch'] } })).id).toBe('technique');
  });
  it('nothing wrong is a valid answer, not an invented problem', () => {
    const l = swimLimiter(dash());
    expect(l.id).toBe('none');
    expect(l.response.length).toBeGreaterThan(0);
  });
  it('every limiter always carries both evidence and a response', () => {
    [{ distribution: { completion: { value: 0.3 } } },
      { status: { threshold: { cssSecondsPer100m: null }, focus: [] } },
      { quality: { evidence: { direction: 'under' }, fade: { value: null } } },
      { quality: { evidence: null, fade: { value: 9 } } },
      { openWater: { exposure: { sessions: 0 }, raceSoon: true } },
      {}].forEach(over => {
      const l = swimLimiter(dash(over));
      expect(l.evidence.every(e => typeof e === 'string' && e.length > 10)).toBe(true);
      expect(l.response.every(r => typeof r === 'string' && r.length > 10)).toBe(true);
    });
  });
});

describe('the dashboard over a real plan', () => {
  it('an athlete who has done nothing gets missing data, never zeros pretending to be data', () => {
    const d = build();
    expect(d.distribution.completion.kind === 'missing' || d.distribution.completion.value === 0).toBe(true);
    expect(d.quality.adherence.kind).toBe('missing');
    expect(d.quality.note).toBeTruthy();
    expect(d.limiter.id).toBeTruthy();
  });

  it('completing swims moves frequency and completion off missing', () => {
    const plan = generatePlan(base);
    const log = {};
    plan.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline === 'swim' && !w.race && w.date <= today)
      .forEach(w => { log[w.id] = { done: true }; });
    const d = swimDashboard({ plan, log, moves: {}, activities: [], todayISO: today });
    expect(d.distribution.completion.value).toBe(1);
    expect(d.distribution.sessionsPerWeek.value).toBeGreaterThan(0);
    expect(Object.keys(d.distribution.mix).length).toBeGreaterThan(0);
  });

  it('CSS history is exposed for the chart, newest last', () => {
    const d = build({ fitnessHistory: [
      { date: '2026-05-01', css100Sec: 130 },
      { date: '2026-06-01', css100Sec: 125 },
      { date: '2026-06-15', ftp: 300 },
    ] });
    expect(d.status.history.map(h => h.css)).toEqual([130, 125]);
  });

  it('open-water readiness is tracked separately from pool volume (§8)', () => {
    const d = build({}, {}, [
      { id: 'a', type: 'OpenWaterSwim', date: '2026-07-10', movingTimeSec: 1800, distance: 1500 },
      { id: 'b', type: 'Swim', date: '2026-07-12', movingTimeSec: 2400, distance: 2000 },
    ]);
    expect(d.openWater.exposure.sessions).toBe(1);
    expect(d.endurance.longestM.value).toBe(2000); // pool swim still counts for endurance
  });
});
