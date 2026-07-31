import { describe, it, expect } from 'vitest';
import { whyNotHarder } from './why-not-harder.js';
import { generatePlan } from './plan.js';

/* The why-not-harder fold: every line must be provable from the workout and
   its plan week at render time. Fixtures are real generated plans wherever
   the branch is reachable that way, so a generator change breaks a test
   rather than quietly stranding the copy. */

const profile = (over = {}) => ({
  name: 'P', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: '2026-06-01', raceDate: '2026-09-27', ...over,
});

const wnh = (w, plan) => whyNotHarder({ workout: w, plan });

describe('recovery and race weeks', () => {
  it('a recovery-week session explains the step back', () => {
    const plan = generatePlan(profile());
    const rec = plan.weeks.find(wk => wk.isRecovery);
    expect(rec, 'no recovery week generated').toBeTruthy();
    const w = rec.workouts.find(x => x.discipline !== 'rest' && !x.race);
    const out = wnh(w, plan);
    expect(out.lines[0]).toContain('This is a recovery week');
  });

  it('race-week demoted sessions name what they were drawn up as', () => {
    const plan = generatePlan(profile());
    const all = plan.weeks.flatMap(wk => wk.workouts);
    const sharpen = all.find(w => w.raceWeek === 'sharpen' && w.raceWeekFrom);
    expect(sharpen, 'no sharpen demotion generated').toBeTruthy();
    const out = wnh(sharpen, plan);
    expect(out.lines.join(' ')).toContain('drawn up as a ' + sharpen.raceWeekFrom);
    expect(out.lines.join(' ')).toContain('Arriving sharp beats arriving tired');
    const recover = all.find(w => w.raceWeek === 'recover' && w.raceWeekFrom);
    if (recover) {
      expect(wnh(recover, plan).lines.join(' ')).toContain('absorbing a race is training too');
    }
  });
});

describe('solo-only lines', () => {
  const solo = generatePlan(profile({ raceType: 'runhalf' }));
  const soloAll = solo.weeks.flatMap(wk => wk.workouts);

  it('a quality run in a two-quality solo week gets both solo lines, capped at 2', () => {
    const q = soloAll.find(w => {
      if (w.discipline !== 'run' || w.role !== 'quality' || w.race || w.test) return false;
      const wk = solo.weeks[w.week];
      return wk && !wk.isRecovery && wk.workouts.filter(s => s.discipline === 'run' && s.role === 'quality').length >= 2;
    });
    expect(q, 'no two-quality solo week generated').toBeTruthy();
    const out = wnh(q, solo);
    expect(out.lines.length).toBeLessThanOrEqual(2);
    expect(out.lines.join(' ')).toContain('a step apart in intensity');
    expect(out.lines.join(' ')).toContain('back-to-back');
    // direction-neutral by design: the rung can go either way when the
    // anchor clamps, so the copy must never claim "easier"
    expect(out.lines.join(' ')).not.toContain('easier');
  });

  it('the solo long run gets the spacing line without the second-quality line', () => {
    const long = soloAll.find(w => w.role === 'long' && !w.race && solo.weeks[w.week] && !solo.weeks[w.week].isRecovery);
    expect(long).toBeTruthy();
    const out = wnh(long, solo);
    expect(out.lines.join(' ')).toContain('back-to-back');
    expect(out.lines.join(' ')).not.toContain('a step apart');
  });

  it('TRI plans never claim spacing or run-only rules: no such rule exists for them', () => {
    const tri = generatePlan(profile());
    const all = tri.weeks.flatMap(wk => wk.workouts);
    for (const w of all.filter(x => !x.race && !x.test && x.discipline !== 'rest')) {
      const out = wnh(w, tri);
      if (!out) continue;
      const text = out.lines.join(' ');
      expect(text, w.id).not.toContain('back-to-back');
      expect(text, w.id).not.toContain('run-only');
      expect(text, w.id).not.toContain('a step apart');
    }
  });
});

describe('easy-slot composition', () => {
  it('an easy tri session names only the harder siblings that exist, deduped', () => {
    const plan = generatePlan(profile());
    const w = plan.weeks.flatMap(wk => wk.workouts).find(x => {
      if (x.role !== 'easy' || x.race) return false;
      const wk = plan.weeks[x.week];
      return wk && !wk.isRecovery && !x.raceWeek
        && wk.workouts.some(s => s.role === 'long' || s.role === 'quality' || s.discipline === 'brick');
    });
    expect(w, 'no easy session beside harder work').toBeTruthy();
    const out = wnh(w, plan);
    const text = out.lines.join(' ');
    expect(text).toContain('easy one by design');
    // every named item corresponds to a real sibling shape
    const wk = plan.weeks[w.week];
    if (text.includes('the long ride')) expect(wk.workouts.some(s => s.discipline === 'bike' && s.role === 'long')).toBe(true);
    if (text.includes('the brick session')) expect(wk.workouts.some(s => s.discipline === 'brick')).toBe(true);
    // no stutter from duplicate labels
    expect(text).not.toMatch(/(the quality \w+)[^.]*\1/);
  });
});

describe('safety and hygiene', () => {
  const plan = generatePlan(profile());

  it('races, tune-ups, tests, adhoc and custom sessions get nothing', () => {
    const all = plan.weeks.flatMap(wk => wk.workouts);
    const race = all.find(w => w.race);
    expect(wnh(race, plan)).toBe(null);
    expect(wnh({ id: 'adhoc-1', adhoc: true, discipline: 'run', durationMin: 40 }, plan)).toBe(null);
    expect(wnh({ id: 'c1', custom: true, discipline: 'run', week: 0, role: 'easy' }, plan)).toBe(null);
    expect(wnh({ id: 't1', test: true, discipline: 'run', week: 0 }, plan)).toBe(null);
    expect(wnh({ id: 'b1', bRace: true, discipline: 'run', week: 0 }, plan)).toBe(null);
  });

  it('an undefined or out-of-range week falls through to null, never a throw', () => {
    expect(wnh({ id: 'x', discipline: 'run', role: 'easy' }, plan)).toBe(null);
    expect(wnh({ id: 'x', discipline: 'run', role: 'easy', week: 999 }, plan)).toBe(null);
    expect(whyNotHarder({ workout: null, plan })).toBe(null);
    expect(whyNotHarder({ workout: { id: 'x', week: 0 }, plan: null })).toBe(null);
  });

  it('copy lint: no em dashes and no digits in any reachable line', () => {
    for (const p of [plan, generatePlan(profile({ raceType: 'runhalf' }))]) {
      for (const w of p.weeks.flatMap(wk => wk.workouts)) {
        const out = wnh(w, p);
        if (!out) continue;
        for (const line of out.lines) {
          expect(line).not.toContain('—');
          // the digit ban targets engine parameters; a type NAME like VO2
          // interpolated via raceWeekFrom is a label, not a leaked number
          expect(line.replace(/VO2/g, '')).not.toMatch(/\d/);
        }
      }
    }
  });
});
