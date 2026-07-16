import { describe, it, expect } from 'vitest';
import { whatIfSeed, missWeekCandidates, simulateMiss, simulateRaceMove, WHATIF_CAVEAT } from './whatif.js';
import { iso, addDays } from './date.js';

const TODAY = '2026-07-16';
const d = n => iso(addDays(TODAY, n));

// A plan: two build weeks of daily runs from 7 days back through 13 ahead,
// then an optional race. Seeded with a fresh wellness record.
const mkPlan = ({ race = null, taperLast = false } = {}) => {
  const wk = (index, phase, from, to) => ({
    index, phase, isRecovery: false, start: d(from),
    workouts: Array.from({ length: to - from + 1 }, (_, i) => ({
      id: index + '-' + i, date: d(from + i), discipline: 'run', type: 'Easy',
      title: 'Run ' + index + '-' + i, durationMin: 60,
    })),
  });
  const weeks = [wk(0, 'Build', -7, -1), wk(1, 'Build', 0, 6), wk(2, taperLast ? 'Taper' : 'Build', 7, 13)];
  if (race) weeks[2].workouts.push({ id: 'race', date: race, discipline: 'run', race: true, title: 'Race', durationMin: 0 });
  return { race: race ? 'olympic' : 'maintenance', weeks };
};
const wellness = [{ date: TODAY, ctl: 60, atl: 60, tsb: 0 }];
const doneLog = plan => Object.fromEntries(
  plan.weeks.flatMap(w => w.workouts).filter(w => w.date < TODAY).map(w => [w.id, { done: true }]));
const base = plan => ({ plan, log: doneLog(plan), moves: {}, adjust: {}, wellness, todayISO: TODAY });

describe('whatIfSeed', () => {
  it('takes the last reading on or before today, refuses stale and future ones', () => {
    expect(whatIfSeed(wellness, TODAY).date).toBe(TODAY);
    expect(whatIfSeed([{ date: d(-9), ctl: 60, atl: 60 }], TODAY)).toBe(null); // stale
    expect(whatIfSeed([{ date: d(2), ctl: 60, atl: 60 }], TODAY)).toBe(null);  // future-dated
    expect(whatIfSeed([], TODAY)).toBe(null);
  });
});

describe('missWeekCandidates', () => {
  it('offers only weeks with unlogged future sessions, never taper/recovery/race weeks', () => {
    const plan = mkPlan({ taperLast: true });
    const c = missWeekCandidates({ ...base(plan) });
    expect(c.map(x => x.index)).toEqual([1]); // week 0 fully logged, week 2 is Taper
    expect(c[0].label).toBe('Week 2 · Build');
    expect(c[0].ids.length).toBeGreaterThan(0);
  });
});

describe('simulateMiss', () => {
  it('a skipped week reads fresher but less fit, in the chart words', () => {
    const plan = mkPlan();
    const ids = plan.weeks[1].workouts.map(w => w.id);
    const r = simulateMiss({ ...base(plan), skipIds: ids, skipLabel: 'Week 2' });
    expect(r.ok).toBe(true);
    expect(r.numbers.scenario.endCtl).toBeLessThan(r.numbers.planned.endCtl); // fitness costs
    // freshness gain shows at the end of the skipped window; by the far
    // horizon the fitter planned line is fresher too (higher CTL dominates
    // once acute fatigue decays) — the model is honest about both
    expect(r.numbers.scenario.windowTsb).toBeGreaterThan(r.numbers.planned.windowTsb);
    expect(r.verdict).toContain('Skipping Week 2');
    expect(r.verdict).toMatch(/Fresh|Optimal|Grey zone|Transition/); // zone words verbatim
    expect(r.series.scenario.length).toBe(r.series.planned.length);
  });

  it('with a race ahead the verdict reports race-morning form and walks to race day', () => {
    const plan = mkPlan({ race: d(13) });
    const ids = plan.weeks[1].workouts.filter(w => w.date >= TODAY).map(w => w.id);
    const r = simulateMiss({ ...base(plan), skipIds: ids, skipLabel: 'this week' });
    expect(r.ok).toBe(true);
    expect(r.verdict).toContain('race-morning');
  });

  it('refuses honestly: tracker mode, stale data, empty skip set', () => {
    expect(simulateMiss({ ...base({ race: 'tracker', weeks: [] }), skipIds: ['x'] }).ok).toBe(false);
    const plan = mkPlan();
    expect(simulateMiss({ ...base(plan), wellness: [{ date: d(-9), ctl: 60, atl: 60 }], skipIds: ['1-1'] }).ok).toBe(false);
    expect(simulateMiss({ ...base(plan), skipIds: [] }).ok).toBe(false);
  });

  it('a past unlogged session refuses instead of producing a zero-cost verdict', () => {
    const plan = mkPlan();
    const pastId = plan.weeks[1].workouts[0].id; // dated today... use week 0
    const r = simulateMiss({ ...base(plan), log: {}, skipIds: [plan.weeks[0].workouts[2].id] });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('behind you');
  });

  it('a post-race session can still be skipped honestly: the horizon covers its window', () => {
    const plan = mkPlan({ race: d(9) });
    // a recovery session after race day, reachable via the per-session doorway
    plan.weeks[2].workouts.push({ id: 'rec-1', date: d(11), discipline: 'run', type: 'Easy', title: 'Recovery Run', durationMin: 30 });
    const r = simulateMiss({ ...base(plan), skipIds: ['rec-1'], skipLabel: 'Recovery Run' });
    expect(r.ok).toBe(true);
    // the scenario differs from planned somewhere: the skip actually registered
    const differs = r.series.scenario.some((v, i) => v !== r.series.planned[i]);
    expect(differs).toBe(true);
  });

  it('a tiny skip says "barely dent", never "about 0 points"', () => {
    const plan = mkPlan();
    // one 30-second-equivalent session: shrink a single future run
    plan.weeks[1].workouts[6].durationMin = 5;
    const r = simulateMiss({ ...base(plan), skipIds: [plan.weeks[1].workouts[6].id], skipLabel: 'a short run' });
    expect(r.ok).toBe(true);
    expect(r.verdict).not.toContain('about 0 point');
    if (Math.abs(r.numbers.ctlCost) < 0.5) expect(r.verdict).toContain('barely dent');
  });

  it('weeks holding a tune-up race are not offered for missing, like race weeks', () => {
    const plan = mkPlan({ taperLast: false });
    plan.weeks[1].workouts.push({ id: 'brace', date: d(4), discipline: 'run', bRace: true, title: 'Tune-up 5k', durationMin: 20 });
    const c = missWeekCandidates({ ...base(plan) });
    expect(c.map(x => x.index)).not.toContain(1);
  });

  it('the caveat inherits the derived flag from the seed', () => {
    const plan = mkPlan();
    const ids = [plan.weeks[1].workouts[3].id];
    const measured = simulateMiss({ ...base(plan), skipIds: ids });
    const derived = simulateMiss({ ...base(plan), wellness: [{ date: TODAY, ctl: 60, atl: 60, derived: true }], skipIds: ids });
    expect(measured.caveatDerived).toBe(false);
    expect(derived.caveatDerived).toBe(true);
    expect(WHATIF_CAVEAT).toContain('estimate');
  });
});

describe('simulateRaceMove', () => {
  it('projects the moved date and states the no-retaper assumption', () => {
    const plan = mkPlan({ race: d(13) });
    const r = simulateRaceMove({ ...base(plan), newRaceDate: d(9) });
    expect(r.ok).toBe(true);
    expect(r.verdict).toContain('Moving race day');
    expect(r.assumption).toContain('does not re-taper');
    expect(r.numbers.moved.raceDate).toBe(d(9));
  });

  it('refuses beyond the plan\'s scheduled data instead of inventing training', () => {
    const plan = mkPlan({ race: d(10) });
    const r = simulateRaceMove({ ...base(plan), newRaceDate: d(20) });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('scheduled sessions through');
  });

  it('refuses without a race, and in the past', () => {
    expect(simulateRaceMove({ ...base(mkPlan()), newRaceDate: d(5) }).ok).toBe(false);
    const plan = mkPlan({ race: d(13) });
    expect(simulateRaceMove({ ...base(plan), newRaceDate: d(0) }).ok).toBe(false);
  });
});
