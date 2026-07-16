import { describe, it, expect } from 'vitest';
import { runLoadSignal, longRunJumpSignal, RUN_RAMP_RULES, LONG_RUN_RULES } from './runload.js';
import { iso, addDays } from './date.js';

const TODAY = '2026-07-09';
// A run-per-day plan from `startOff` days back through today, minutes chosen
// per day by fn(offset); everything logged unless skipped.
const mk = (startOff, minFor, { skipLog = [], extra = [] } = {}) => {
  const workouts = [];
  const log = {};
  for (let o = startOff; o <= 0; o++) {
    const id = 'h' + o;
    workouts.push({ id, week: 0, phase: 'Build', date: iso(addDays(TODAY, o)), discipline: 'run', type: 'Easy', title: 'Run', durationMin: minFor(o) });
    if (!skipLog.includes(o)) log[id] = { done: true };
  }
  extra.forEach(w => workouts.push(w));
  return { plan: { weeks: [{ index: 0, phase: 'Build', start: iso(addDays(TODAY, startOff)), workouts }] }, log };
};
const base = { moves: {}, adjust: {}, todayISO: TODAY };

describe('runLoadSignal (run mechanical load)', () => {
  it('acute vs uncoupled baseline: a huge current week never inflates its own denominator', () => {
    const { plan, log } = mk(-34, o => (o > -7 ? 120 : 60));
    const s = runLoadSignal({ ...base, plan, log });
    expect(s.acute7d).toBe(840);
    expect(s.baselineWeekly).toBe(420); // the four prior weeks only
    expect(s.rampPct).toBe(1);
  });

  it('thin history and thin baselines judge nothing', () => {
    const young = mk(-10, () => 60);
    expect(runLoadSignal({ ...base, ...young })).toBe(null); // < 2 complete baseline weeks
    const tiny = mk(-34, () => 5); // 35 min/week baseline < floor
    expect(runLoadSignal({ ...base, ...tiny })).toBe(null);
  });

  it('only what was run counts: skipped sessions lower the acute load', () => {
    const done = mk(-34, () => 60);
    const skipped = mk(-34, () => 60, { skipLog: [0, -1] });
    expect(runLoadSignal({ ...base, ...skipped }).acute7d)
      .toBe(runLoadSignal({ ...base, ...done }).acute7d - 120);
  });

  it('recorded time beats plan; adjustments apply when no recording; moves use effective dates', () => {
    const { plan, log } = mk(-34, () => 60);
    log['h0'] = { done: true, actualMin: 100 };
    expect(runLoadSignal({ ...base, plan, log }).acute7d).toBe(460);
    const adjusted = runLoadSignal({ ...base, plan, log: mk(-34, () => 60).log, adjust: { 'h0': { kind: 'ease' } } });
    expect(adjusted.acute7d).toBe(420 - 60 + 39); // eased run counts at 65%
    const moved = runLoadSignal({ ...base, plan, log: mk(-34, () => 60).log, moves: { 'h0': iso(addDays(TODAY, -20)) } });
    expect(moved.acute7d).toBe(360); // moved out of the acute window
  });

  it('gap weeks are skipped, not averaged: resuming normal running after a logging gap is not a ramp', () => {
    // Two zero weeks 3-5 weeks back (holiday, or just didn't log), then two
    // normal weeks, then a normal acute week. Averaging the zeros would halve
    // the baseline and read the plain resume as a 100% ramp.
    const gapDays = [];
    for (let o = -34; o <= -21; o++) gapDays.push(o);
    const { plan, log } = mk(-34, () => 60, { skipLog: gapDays });
    const s = runLoadSignal({ ...base, plan, log });
    expect(s.baselineWeekly).toBe(420); // the two logged weeks only
    expect(s.rampPct).toBe(0);
    // And with every baseline week a gap, there is no baseline: silence.
    const allGap = [];
    for (let o = -34; o <= -7; o++) allGap.push(o);
    const empty = mk(-34, () => 60, { skipLog: allGap });
    expect(runLoadSignal({ ...base, ...empty })).toBe(null);
  });

  it('rampPct is unrounded: a ramp just past a threshold still clears it', () => {
    // Baseline 100.5/wk, acute 151 → a true 50.25% ramp. Quantizing to 0.01
    // before the strict > compare would read this as exactly 0.50 and miss.
    const { plan, log } = mk(-20, o => (o > -7 ? 151 / 7 : 201 / 14));
    const s = runLoadSignal({ ...base, plan, log });
    expect(s.rampPct).toBeGreaterThan(RUN_RAMP_RULES.riskPct);
    expect(s.rampPct).toBeCloseTo(0.50249, 4);
  });

  it('bricks and strength never count; a test run is real pounding and does', () => {
    const extra = [
      { id: 'x-b', date: TODAY, discipline: 'brick', type: 'Brick', durationMin: 90 },
      { id: 'x-s', date: TODAY, discipline: 'strength', type: 'Strength', durationMin: 40 },
      { id: 'x-t', date: TODAY, discipline: 'run', type: 'Test', test: true, durationMin: 45 },
    ];
    const { plan, log } = mk(-34, () => 60, { extra });
    extra.forEach(w => { log[w.id] = { done: true }; });
    expect(runLoadSignal({ ...base, plan, log }).acute7d).toBe(465); // + the test only
  });
});


describe('longRunJumpSignal (single-session jump)', () => {
  // history: a run every day for 28 days at `daily` minutes, all logged;
  // `up` = one unlogged run scheduled in `inDays` days at `upMin` minutes.
  const jumpCase = (daily, upMin, { inDays = 3, over = {}, logOver = {} } = {}) => {
    const { plan, log } = mk(-28, () => daily);
    plan.weeks[0].workouts.push({ id: 'up', week: 0, phase: 'Build',
      date: iso(addDays(TODAY, inDays)), discipline: 'run', type: 'Long', title: 'Long Run', durationMin: upMin, ...over });
    Object.assign(log, logOver);
    return { plan, log };
  };

  it('measures the logged longest against the biggest scheduled run in the next 7 days', () => {
    const s = longRunJumpSignal({ ...base, ...jumpCase(60, 100) });
    expect(s.longestMin).toBe(60);
    expect(s.upcoming).toEqual({ id: 'up', date: iso(addDays(TODAY, 3)), min: 100, title: 'Long Run' });
    expect(s.jumpPct).toBeCloseTo(100 / 60 - 1, 5);
  });

  it('a recorded time beats the planned duration in the history side', () => {
    // plan said 60 daily but yesterday actually ran 95 → longest is 95
    const c = jumpCase(60, 100);
    c.log['h-1'] = { done: true, actualMin: 95 };
    expect(longRunJumpSignal({ ...base, ...c }).longestMin).toBe(95);
  });

  it('stays silent on thin history or a tiny base', () => {
    // one logged run only
    const one = jumpCase(60, 100);
    Object.keys(one.log).forEach((k, n) => { if (n > 0) delete one.log[k]; });
    expect(longRunJumpSignal({ ...base, ...one })).toBe(null);
    // longest under the floor
    expect(longRunJumpSignal({ ...base, ...jumpCase(LONG_RUN_RULES.minLongestMin - 5, 100) })).toBe(null);
  });

  it('logged, adjusted, raced and out-of-window sessions are never candidates', () => {
    // already logged → not a candidate
    expect(longRunJumpSignal({ ...base, ...jumpCase(60, 100, { logOver: { up: { done: true } } }) })).toBe(null);
    // already adjusted (G3) → not a candidate
    expect(longRunJumpSignal({ ...jumpCase(60, 100), moves: {}, adjust: { up: { kind: 'ease', at: 'x' } }, todayISO: TODAY })).toBe(null);
    // a race is not a candidate
    expect(longRunJumpSignal({ ...base, ...jumpCase(60, 100, { over: { race: true } }) })).toBe(null);
    // beyond the 7-day horizon
    expect(longRunJumpSignal({ ...base, ...jumpCase(60, 100, { inDays: 9 }) })).toBe(null);
  });

  it('tests and tune-up races are pounding in history but never candidates', () => {
    // the upcoming big run is a fitness test → not a candidate, no signal
    expect(longRunJumpSignal({ ...base, ...jumpCase(60, 100, { over: { test: true } }) })).toBe(null);
    expect(longRunJumpSignal({ ...base, ...jumpCase(60, 100, { over: { bRace: true } }) })).toBe(null);
    // a logged test in HISTORY counts as pounding: longest becomes 95
    const c = jumpCase(60, 100);
    c.plan.weeks[0].workouts.push({ id: 't', week: 0, phase: 'Build', date: iso(addDays(TODAY, -4)), discipline: 'run', type: 'Test', test: true, title: '5k Test', durationMin: 95 });
    c.log['t'] = { done: true };
    expect(longRunJumpSignal({ ...base, ...c }).longestMin).toBe(95);
  });

  it('a plan younger than the lookback stays silent: the log cannot see pre-plan running', () => {
    const c = jumpCase(60, 100);
    // shift the plan start to 20 days ago (window would reach before it)
    c.plan.weeks[0].start = iso(addDays(TODAY, -20));
    expect(longRunJumpSignal({ ...base, ...c })).toBe(null);
  });

  it('a move into the window makes it a candidate', () => {
    const c = jumpCase(60, 100, { inDays: 12 });
    const s = longRunJumpSignal({ ...c, moves: { up: iso(addDays(TODAY, 2)) }, adjust: {}, todayISO: TODAY });
    expect(s.upcoming.id).toBe('up');
  });
});
