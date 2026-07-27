import { describe, it, expect } from 'vitest';
import { generatePlan } from './plan.js';
import { ftpRetestRecommendation, prescribedWatts, FTP_RETEST_RULES, DRIFT_TYPES } from './ftp-retest.js';
import { ftpProposalDetails, eftpProposal } from './eftp.js';
import { iso, addDays } from './date.js';

/* Phase 2 §5 and §6. The swim equivalents needed three fixes after review;
   the same three are asserted here rather than left to be rediscovered. */

const base = {
  name: 'R', raceType: 'olympic', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 250, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-09-27',
};
// a today with no bike test recently ridden or scheduled soon
const quiet = plan => {
  const tests = plan.weeks.flatMap(w => w.workouts).filter(w => w.test && w.testKind === 'bikeFtp');
  const last = tests.map(w => w.date).sort().pop() || plan.weeks[0].start;
  return iso(addDays(last, 1));
};

describe('§6: when an FTP assessment is recommended', () => {
  it('recommends one when there is no measured FTP at all', () => {
    const p = generatePlan({ ...base, ftp: null, weightKg: 75 });
    const r = ftpRetestRecommendation({ plan: p, todayISO: quiet(p) });
    expect(r && r.reason).toBe('missing');
    // an estimate is not an FTP, so the estimate does not silence it
    expect(p.paces.ftp).toBeGreaterThan(0);
  });

  it('recommends verification for a legacy hand entry, but not a dated fresh one', () => {
    const legacy = generatePlan(base);                     // ftp, no ftpMeta
    const today = quiet(legacy);
    expect(ftpRetestRecommendation({ plan: legacy, todayISO: today }).reason).toBe('unverified');
    const fresh = generatePlan({ ...base, ftpMeta: { source: 'try-test', measuredAt: iso(addDays(today, -7)), confidence: 'high' } });
    expect(ftpRetestRecommendation({ plan: fresh, todayISO: today })).toBe(null);
  });

  it('goes stale after a training block, and a recent test does not', () => {
    const today = quiet(generatePlan(base));
    const at = d => generatePlan({ ...base, ftpMeta: { source: 'try-test', measuredAt: iso(addDays(today, d)), confidence: 'high' } });
    expect(ftpRetestRecommendation({ plan: at(-30), todayISO: today })).toBe(null);
    const r = ftpRetestRecommendation({ plan: at(-(FTP_RETEST_RULES.staleDays + 7)), todayISO: today });
    expect(r && r.reason).toBe('stale');
    expect(r.why).toContain('weeks ago');
  });

  it('flags a materially different intervals.icu threshold, and ignores close agreement', () => {
    const today = quiet(generatePlan(base));
    const p = generatePlan({ ...base, ftpMeta: { source: 'manual', measuredAt: iso(addDays(today, -7)) } });
    expect(ftpRetestRecommendation({ plan: p, thresholds: { bikeFtp: 290 }, todayISO: today }).reason).toBe('icu');
    expect(ftpRetestRecommendation({ plan: p, thresholds: { bikeFtp: 253 }, todayISO: today })).toBe(null);
  });

  it('re-anchors after a long interruption', () => {
    const today = quiet(generatePlan(base));
    const p = generatePlan({ ...base, ftpMeta: { source: 'try-test', measuredAt: iso(addDays(today, -14)), confidence: 'high' } });
    const stale = [{ id: 'r', type: 'Ride', date: iso(addDays(today, -(FTP_RETEST_RULES.gapDays + 7))), movingTimeSec: 3600, averageWatts: 200 }];
    expect(ftpRetestRecommendation({ plan: p, activities: stale, todayISO: today }).reason).toBe('returning');
    const recent = [{ id: 'r', type: 'Ride', date: iso(addDays(today, -3)), movingTimeSec: 3600, averageWatts: 200 }];
    expect(ftpRetestRecommendation({ plan: p, activities: recent, todayISO: today })).toBe(null);
  });

  it('stays quiet near a scheduled or recently ridden test', () => {
    const p = generatePlan({ ...base, ftp: null });        // missing would otherwise always fire
    const test = p.weeks.flatMap(w => w.workouts).find(w => w.test && w.testKind === 'bikeFtp');
    expect(test).toBeTruthy();
    expect(ftpRetestRecommendation({ plan: p, todayISO: iso(addDays(test.date, -7)) })).toBe(null);
    expect(ftpRetestRecommendation({ plan: p, log: { [test.id]: { done: true } }, todayISO: iso(addDays(test.date, 7)) })).toBe(null);
    expect(ftpRetestRecommendation({ plan: p, todayISO: iso(addDays(test.date, 7)) })).not.toBe(null);
  });

  it('never fires on tracker, a solo run plan, or a bike-excluded athlete', () => {
    const solo = generatePlan({ ...base, raceType: 'run5k', ftp: null });
    expect(ftpRetestRecommendation({ plan: solo, todayISO: quiet(solo) })).toBe(null);
    const excl = generatePlan({ ...base, ftp: null, excludedDiscipline: 'bike' });
    expect(ftpRetestRecommendation({ plan: excl, todayISO: quiet(excl) })).toBe(null);
    expect(ftpRetestRecommendation({ plan: { race: 'tracker', weeks: [] }, todayISO: '2026-07-01' })).toBe(null);
  });
});

describe('§6 drift: read from rides, and only rides that can speak', () => {
  // ride the quality sessions a fixed fraction off what they asked for
  const rig = driftPct => {
    const probe = generatePlan(base);
    const dates = probe.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline === 'bike' && DRIFT_TYPES.includes(w.type)).map(w => w.date).sort();
    let anchor = -1;
    for (let i = dates.length - 1; i >= 2; i--) {
      const span = (new Date(dates[i]) - new Date(dates[i - 2])) / 86400000;
      if (span <= FTP_RETEST_RULES.lookbackDays - 4) { anchor = i; break; }
    }
    expect(anchor).toBeGreaterThanOrEqual(2);
    const cluster = [dates[anchor - 2], dates[anchor - 1], dates[anchor]];
    const today = iso(addDays(cluster[2], 2));
    const plan = generatePlan({ ...base, ftpMeta: { source: 'try-test', measuredAt: iso(addDays(cluster[0], -1)), confidence: 'high' } });
    const log = {}; const activities = [];
    plan.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline === 'bike' && DRIFT_TYPES.includes(w.type) && cluster.includes(w.date))
      .slice(0, 3).forEach((w, i) => {
        log[w.id] = { done: true };
        const presc = prescribedWatts(w, plan.profile.ftp);
        expect(presc).toBeTruthy();
        activities.push({ id: 'a' + i, type: 'Ride', date: w.date,
          movingTimeSec: presc.minutes * 60, averageWatts: Math.round(presc.avgWatts * (1 + driftPct)) });
      });
    return { plan, log, activities, today };
  };

  it('three rides well above what they asked for suggests a retest upward', () => {
    const { plan, log, activities, today } = rig(0.10);
    expect(ftpRetestRecommendation({ plan, activities, log, todayISO: today }).reason).toBe('drift-up');
  });

  it('three rides well under suggests the targets may be too high', () => {
    const { plan, log, activities, today } = rig(-0.10);
    expect(ftpRetestRecommendation({ plan, activities, log, todayISO: today }).reason).toBe('drift-down');
  });

  it('rides on target say nothing', () => {
    const { plan, log, activities, today } = rig(0);
    expect(ftpRetestRecommendation({ plan, activities, log, todayISO: today })).toBe(null);
  });

  it('rides from before the current FTP was set cannot judge it', () => {
    // the swim version fired a contradicting nudge the moment a retarget was
    // accepted, because old rides were still in the window
    const { plan, log, activities, today } = rig(0.10);
    const justSet = generatePlan({ ...base, ftpMeta: { source: 'try-test', measuredAt: today, confidence: 'high' } });
    expect(ftpRetestRecommendation({ plan: justSet, activities, log, todayISO: today })).toBe(null);
  });

  it('one recording is never counted twice', () => {
    const { plan, log, activities, today } = rig(0.10);
    const one = [activities[0]];   // a single ride cannot make a pattern
    expect(ftpRetestRecommendation({ plan, activities: one, log, todayISO: today })).toBe(null);
  });
});

describe('§5: the proposal evidence payload', () => {
  const plan = generatePlan(base);
  const prop = eftpProposal({
    activities: [{ id: 'r', type: 'Ride', date: '2026-07-01', movingTimeSec: 3600, eftp: 280 }],
    plan, todayISO: '2026-07-02', thresholds: null,
  });

  it('lays out current, proposed, delta, percent and provenance', () => {
    const d = ftpProposalDetails({ proposal: prop, plan, todayISO: '2026-07-02' });
    expect(d.currentWatts).toBe(250);
    expect(d.proposedWatts).toBe(280);
    expect(d.deltaWatts).toBe(30);
    expect(d.pct).toBeCloseTo(12, 0);
    expect(d.up).toBe(true);
    expect(d.source).toBe('activity-model');
    expect(d.measuredAt).toBe('2026-07-01');
    expect(d.confidence).toBe('medium');
  });

  it('shows the effect on the athlete own next quality ride, in watts', () => {
    const d = ftpProposalDetails({ proposal: prop, plan, todayISO: '2026-06-15' });
    expect(d.example).toBeTruthy();
    expect(d.example.cur).toMatch(/\d+ to \d+ W/);
    expect(d.example.next).toMatch(/\d+ to \d+ W/);
    expect(d.example.cur).not.toBe(d.example.next);
  });

  it('refuses a non-bike proposal and an athlete with no real FTP', () => {
    expect(ftpProposalDetails({ proposal: { sport: 'swim', retarget: { css100Sec: 100 } }, plan, todayISO: '2026-07-02' })).toBe(null);
    const noFtp = generatePlan({ ...base, ftp: null });
    expect(ftpProposalDetails({ proposal: prop, plan: noFtp, todayISO: '2026-07-02' })).toBe(null);
  });
});
