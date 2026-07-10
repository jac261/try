import { describe, it, expect } from 'vitest';
import { deriveLoadRecords, withLogLoad } from './loadmodel.js';
import { estimateTss } from './adapt.js';
import { generatePlan } from './plan.js';
import { iso, addDays } from './date.js';

const START = '2026-07-06'; // a Monday
const wo = (id, day, type, dur) => ({ id, date: iso(addDays(START, day)), type, durationMin: dur, discipline: 'bike' });
const mkPlan = workouts => ({
  profile: { startDate: START },
  weeks: [{ index: 0, start: START, workouts }],
});

describe('loadmodel.deriveLoadRecords (log-derived CTL/ATL/TSB)', () => {
  it('seeds from week-1 planned load, balanced, and decays with nothing logged', () => {
    const plan = mkPlan([wo('0-0', 0, 'Endurance', 70), wo('0-1', 3, 'Threshold', 60)]);
    const seed = (estimateTss(plan.weeks[0].workouts[0]) + estimateTss(plan.weeks[0].workouts[1])) / 7;
    const out = deriveLoadRecords({ plan, log: {}, moves: {}, adjust: {}, todayISO: iso(addDays(START, 13)) });
    expect(out.length).toBe(14); // start..today inclusive
    expect(out[0].ctl).toBeCloseTo(seed * 41 / 42, 1);
    expect(out[0].atl).toBeCloseTo(seed * 6 / 7, 1);
    // fatigue decays faster than fitness, so an idle stretch reads fresh then fades
    expect(out[0].tsb).toBeGreaterThan(0);
    expect(out[13].ctl).toBeLessThan(out[0].ctl);
    out.forEach(r => expect(r.derived).toBe(true));
  });

  it('a logged hard session spikes fatigue past fitness (negative form)', () => {
    const plan = mkPlan([wo('0-0', 0, 'Easy', 40), wo('0-1', 2, 'Threshold', 180)]);
    const out = deriveLoadRecords({ plan, log: { '0-1': { done: true } }, moves: {}, adjust: {}, todayISO: iso(addDays(START, 6)) });
    expect(out[1].tsb).toBeGreaterThan(0);  // day before: idle decay
    expect(out[2].tsb).toBeLessThan(0);     // the session lands
    expect(out[2].atl).toBeGreaterThan(out[1].atl);
  });

  it('unlogged sessions add nothing — only what the athlete actually did counts', () => {
    const plan = mkPlan([wo('0-0', 2, 'Threshold', 180)]);
    const idle = deriveLoadRecords({ plan, log: {}, moves: {}, adjust: {}, todayISO: iso(addDays(START, 6)) });
    const done = deriveLoadRecords({ plan, log: { '0-0': { done: true } }, moves: {}, adjust: {}, todayISO: iso(addDays(START, 6)) });
    expect(done[6].atl).toBeGreaterThan(idle[6].atl);
    expect(idle[2].atl).toBeCloseTo(idle[1].atl * 6 / 7, 1); // pure decay, no impulse
  });

  it('moved sessions count on their effective date; adjustments shrink the impulse', () => {
    const plan = mkPlan([wo('0-0', 1, 'Threshold', 90)]);
    const base = { plan, log: { '0-0': { done: true } }, adjust: {}, todayISO: iso(addDays(START, 6)) };
    const here = deriveLoadRecords({ ...base, moves: {} });
    const moved = deriveLoadRecords({ ...base, moves: { '0-0': iso(addDays(START, 4)) } });
    expect(moved[1].atl).toBeLessThan(here[1].atl);   // nothing on the original day
    expect(moved[4].atl).toBeGreaterThan(here[4].atl); // impulse lands on the new day
    const eased = deriveLoadRecords({ ...base, moves: {}, adjust: { '0-0': { kind: 'ease' } } });
    expect(eased[1].atl).toBeLessThan(here[1].atl);
  });

  it('returns nothing without a plan or before the plan starts', () => {
    expect(deriveLoadRecords({ plan: null, log: {}, todayISO: START })).toEqual([]);
    const plan = mkPlan([wo('0-0', 0, 'Easy', 40)]);
    expect(deriveLoadRecords({ plan, log: {}, moves: {}, adjust: {}, todayISO: '2026-07-01' })).toEqual([]);
  });

  it('a real generated plan, fully logged, grows fitness week on week', () => {
    const plan = generatePlan({
      name: 'J', raceType: 'olympic', fitness: 'intermediate',
      trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
      startDate: START, raceDate: iso(addDays(START, 77)),
    });
    const log = {};
    plan.weeks.slice(0, 3).flatMap(w => w.workouts)
      .filter(x => x.discipline !== 'rest' && !x.race).forEach(x => { log[x.id] = { done: true }; });
    const out = deriveLoadRecords({ plan, log, moves: {}, adjust: {}, todayISO: iso(addDays(START, 20)) });
    expect(out[20].ctl).toBeGreaterThan(out[6].ctl);
  });
});

describe('loadmodel.withLogLoad (read-time merge)', () => {
  const plan = mkPlan([wo('0-0', 0, 'Endurance', 70)]);
  const inputs = { plan, log: {}, moves: {}, adjust: {}, todayISO: iso(addDays(START, 2)) };

  it('fresh measured CTL means the derived model stays out entirely', () => {
    const records = [{ date: START, ctl: 55, atl: 40, tsb: 15 }];
    expect(withLogLoad(records, inputs)).toBe(records); // START is within the freshness window of START+2
  });

  it('stale measured CTL seeds a continuation from the last measured values, not a re-seed', () => {
    // The intervals.icu account went quiet 10 days ago; the athlete kept logging.
    // The series must continue from the measured 55/40 (decaying, plus logged
    // sessions), never jump back to the tiny week-1 seed — no seam in the chart.
    const later = iso(addDays(START, 10));
    const records = [{ date: START, ctl: 55, atl: 40, tsb: 15 }];
    const out = withLogLoad(records, { plan, log: {}, moves: {}, adjust: {}, todayISO: later });
    expect(out.length).toBe(11); // the measured day + 10 continued days
    const first = out.find(r => r.date === iso(addDays(START, 1)));
    expect(first.derived).toBe(true);
    expect(first.ctl).toBeCloseTo(55 * 41 / 42, 1); // continues the measured value
    expect(out[0]).toBe(records[0]); // the measured record itself is untouched
    // and the stale day itself keeps its measured numbers, no overwrite
    expect(out[0].ctl).toBe(55);
  });

  it('an estimate never overwrites a user-entered value on the same day', () => {
    // Manual TSB from the wellness editor (ctl null, so the derived model runs):
    // the athlete's own number must survive the merge; only the gaps fill in.
    const records = [{ date: iso(addDays(START, 1)), tsb: 12, hrv: 60 }];
    const out = withLogLoad(records, inputs);
    const d1 = out.find(r => r.date === iso(addDays(START, 1)));
    expect(d1.tsb).toBe(12);            // user's assertion wins
    expect(d1.ctl).toBeGreaterThan(0);  // estimate fills the genuinely missing fields
    expect(d1.hrv).toBe(60);
  });

  it('fills sensor-less records in place and invents the missing days, all flagged derived', () => {
    const records = [{ date: iso(addDays(START, 1)), hrv: 60, feel: 'rough' }];
    const out = withLogLoad(records, inputs);
    expect(out.length).toBe(3);
    const d1 = out.find(r => r.date === iso(addDays(START, 1)));
    expect(d1.hrv).toBe(60);           // existing fields survive
    expect(d1.feel).toBe('rough');
    expect(d1.ctl).toBeGreaterThan(0); // gains the derived load
    expect(d1.derived).toBe(true);
    expect(out.map(r => r.date)).toEqual([START, iso(addDays(START, 1)), iso(addDays(START, 2))]);
  });

  it('with no plan the records pass through untouched', () => {
    const records = [{ date: START, hrv: 60 }];
    expect(withLogLoad(records, { plan: null })).toBe(records);
  });
});
