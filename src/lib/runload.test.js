import { describe, it, expect } from 'vitest';
import { runLoadSignal, RUN_RAMP_RULES } from './runload.js';
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
