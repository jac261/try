import { describe, it, expect } from 'vitest';
import { whyNotHarder } from './why-not-harder.js';
import { generatePlan, easeWorkout } from './plan.js';
import { RUN_QUALITY_TYPES } from './runschema.js';

/* The why-not-harder fold: every line must be provable from the workout and
   its plan week at render time, keyed on CURRENT TYPE, never role alone
   (role survives every demotion — the gauntlet class this suite now pins).
   Fixtures are real generated plans wherever the branch is reachable that
   way, so a generator change breaks a test rather than stranding the copy. */

const profile = (over = {}) => ({
  name: 'P', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: '2026-06-01', raceDate: '2026-09-27', ...over,
});

const wnh = (w, plan) => whyNotHarder({ workout: w, plan });

describe('recovery and race weeks', () => {
  it('a recovery week says ONLY its own line: the collapse falsifies every other claim', () => {
    const plan = generatePlan(profile());
    const rec = plan.weeks.find(wk => wk.isRecovery);
    expect(rec, 'no recovery week generated').toBeTruthy();
    for (const w of rec.workouts.filter(x => x.discipline !== 'rest' && !x.race && !x.test)) {
      const out = wnh(w, plan);
      expect(out.lines.length, w.id).toBe(1);
      expect(out.lines[0]).toContain('This is a recovery week');
    }
  });

  it('the same holds on a SOLO recovery week: no two-quality claim over collapsed Easy runs', () => {
    const solo = generatePlan(profile({ raceType: 'runhalf' }));
    const rec = solo.weeks.find(wk => wk.isRecovery);
    expect(rec).toBeTruthy();
    for (const w of rec.workouts.filter(x => x.discipline !== 'rest' && !x.race && !x.test)) {
      const out = wnh(w, solo);
      expect(out.lines.join(' ')).not.toContain('quality runs');
    }
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

describe('the two-quality solo line, counted by current type', () => {
  const solo = generatePlan(profile({ raceType: 'runhalf' }));
  const soloAll = solo.weeks.flatMap(wk => wk.workouts);
  const isQ = w => w.discipline === 'run' && !w.test && RUN_QUALITY_TYPES.includes(w.type);

  it('fires only when BOTH runs wear engine quality types today', () => {
    const q = soloAll.find(w => {
      if (!isQ(w) || w.race || solo.weeks[w.week].isRecovery) return false;
      return solo.weeks[w.week].workouts.filter(isQ).length >= 2;
    });
    if (q) {
      const out = wnh(q, solo);
      expect(out.lines.join(' ')).toContain('a step apart in intensity');
      expect(out.lines.join(' ')).not.toContain('easier'); // direction-neutral
    }
    // and NEVER over a quality-role slot the ladder stepped down to Easy:
    // that jog is not a quality run, whatever its role says
    const demoted = soloAll.find(w => w.role === 'quality' && w.type === 'Easy'
      && !w.race && !w.test && !solo.weeks[w.week].isRecovery && !w.raceWeek);
    expect(demoted, 'no ladder step-down to Easy generated').toBeTruthy();
    const out = wnh(demoted, solo);
    expect(out ? out.lines.join(' ') : '').not.toContain('quality runs');
  });

  it('a test sibling never counts toward the pair', () => {
    for (const w of soloAll.filter(x => isQ(x) && !x.race && !solo.weeks[x.week].isRecovery)) {
      const wk = solo.weeks[w.week];
      const qCount = wk.workouts.filter(isQ).length;
      const out = wnh(w, solo);
      const claims = out && out.lines.join(' ').includes('two quality runs');
      if (claims) expect(qCount, w.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('the dropped spacing claim never appears anywhere on any plan', () => {
    /* The generator only spacing-enforces the SECOND solo quality placement
       within its week; the first can land beside the long run and weeks can
       abut across boundaries, so any "never back-to-back" universal is
       false in generated output (gauntlet 2026-08-01). The line is gone;
       this pins it gone. */
    for (const p of [solo, generatePlan(profile())]) {
      for (const w of p.weeks.flatMap(wk => wk.workouts)) {
        const out = wnh(w, p);
        if (!out) continue;
        expect(out.lines.join(' ')).not.toContain('back-to-back');
        expect(out.lines.join(' ')).not.toContain('run-only');
      }
    }
  });
});

describe('eased and trimmed sessions', () => {
  it('an eased session gets NO fold: the ease note is the true answer', () => {
    const solo = generatePlan(profile({ raceType: 'runhalf' }));
    const q = solo.weeks.flatMap(wk => wk.workouts)
      .find(w => w.role === 'quality' && RUN_QUALITY_TYPES.includes(w.type) && !w.race && !w.test);
    expect(q).toBeTruthy();
    const eased = easeWorkout(q, solo);
    expect(eased.eased).toBe(true);
    expect(wnh(eased, solo)).toBe(null);
    expect(wnh({ ...q, trimmed: true }, solo)).toBe(null);
  });
});

describe('easy-slot composition', () => {
  it('names only siblings that are hard TODAY, with the right nouns, deduped', () => {
    const plan = generatePlan(profile());
    const w = plan.weeks.flatMap(wk => wk.workouts).find(x => {
      if (x.role !== 'easy' || x.race || x.raceWeek) return false;
      const wk = plan.weeks[x.week];
      return wk && !wk.isRecovery
        && wk.workouts.some(s => s.role === 'long' || s.role === 'quality' || s.discipline === 'brick');
    });
    expect(w, 'no easy session beside harder work').toBeTruthy();
    const out = wnh(w, plan);
    const text = out.lines.join(' ');
    expect(text).toContain('easy one by design');
    // bike reads as ride in BOTH branches (the quality-bike stutter fix)
    expect(text).not.toContain('quality bike');
    const wk = plan.weeks[w.week];
    if (text.includes('the long ride')) expect(wk.workouts.some(s => s.discipline === 'bike' && s.role === 'long')).toBe(true);
    if (text.includes('the brick session')) expect(wk.workouts.some(s => s.discipline === 'brick')).toBe(true);
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
