import { describe, it, expect } from 'vitest';
import { generatePlan, easeWorkout, trimWorkout, boostWorkout, addCustomWorkout, removeCustomWorkout, upgradePlanSegments, buildTrackerPlan, applyTrackerFitness } from './plan.js';
import { RACES } from './domain.js';
import { estimateTss } from './adapt.js';
import { iso, addDays } from './date.js';

const profile = (raceDate, startDate) => ({
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  raceDate, startDate,
});

describe('buildTrackerPlan (the no-plan sentinel)', () => {
  it('keeps the profile, fitness history and paces, drops the weeks and race date', () => {
    const plan = generatePlan(profile('2026-09-23', '2026-07-01'));
    plan.profile.fitnessHistory = [{ date: '2026-01-01', fivekSec: 1200 }];
    const t = buildTrackerPlan(plan, '2026-07-13T10:00:00.000Z');
    expect(t.race).toBe('tracker');
    expect(t.weeks).toEqual([]);
    expect(t.totalWeeks).toBe(0);
    expect(t.profile.raceDate).toBe(null);         // no stray countdown
    expect(t.profile.raceType).toBe('olympic');    // retained so the next plan and fitness math work
    expect(t.profile.fitnessHistory).toEqual(plan.profile.fitnessHistory); // trend preserved
    expect(t.paces).toBe(plan.paces);
    expect(t.createdAt).toBe(plan.createdAt);
    expect(t.updatedAt).toBe('2026-07-13T10:00:00.000Z');
  });

  it('a tracker fitness update snapshots history and refreshes paces without a plan', () => {
    const real = generatePlan({ ...profile('2026-09-23', '2026-07-01'), fivekSec: 1500 });
    const t = buildTrackerPlan(real, '2026-07-13T10:00:00.000Z');
    const up = applyTrackerFitness(t, { fivekSec: 1320 }, '2026-08-01T09:00:00.000Z');
    // still the sentinel: no plan appears from a fitness update
    expect(up.race).toBe('tracker');
    expect(up.weeks).toEqual([]);
    expect(up.createdAt).toBe(real.createdAt);
    expect(up.updatedAt).toBe('2026-08-01T09:00:00.000Z');
    // the OLD baseline lands in history, the new one is live
    const snap = up.profile.fitnessHistory[up.profile.fitnessHistory.length - 1];
    expect(snap.fivekSec).toBe(1500);
    expect(snap.date).toBe('2026-08-01');
    expect(up.profile.fivekSec).toBe(1320);
    // paces recompute so recap/review verdicts judge against the new numbers
    expect(up.paces.run.easy).toBeLessThan(t.paces.run.easy);
    // the update stamps its own marker; mere tracker ENTRY must not (the
    // Settings "Fitness updated" note gates on this, not on plan.updatedAt)
    expect(up.profile.fitnessUpdatedAt).toBe('2026-08-01T09:00:00.000Z');
    expect(t.profile.fitnessUpdatedAt).toBeUndefined();
  });

  it('the tracker race is real but never a generatable/selectable race', () => {
    expect(RACES.tracker).toBeTruthy();
    expect(RACES.tracker.noRace).toBe(true);   // excluded from race pickers (they filter !noRace)
    expect(RACES.tracker.tracker).toBe(true);
    expect(Object.values(RACES).filter(r => !r.noRace).some(r => r.key === 'tracker')).toBe(false);
  });
});

describe('generatePlan', () => {
  it('produces weeks, paces and a clamped week count', () => {
    const p = generatePlan(profile('2026-09-23', '2026-07-01'));
    expect(Array.isArray(p.weeks)).toBe(true);
    expect(p.weeks.length).toBe(p.totalWeeks);
    expect(p.totalWeeks).toBeGreaterThanOrEqual(4);
    expect(p.totalWeeks).toBeLessThanOrEqual(40);
    expect(p.paces).toBeTruthy();
  });

  it('marks race day on the EXACT race date across every offset (regression: ceil week count)', () => {
    const start = '2026-07-01';
    for (let d = 28; d <= 200; d += 1) {
      const raceDate = iso(addDays(start, d));
      const p = generatePlan(profile(raceDate, start));
      if (p.totalWeeks >= 40) continue; // beyond the clamp the race is unreachable by design
      const raceDay = p.weeks.flatMap(w => w.workouts).find(w => w.race);
      expect(raceDay, `offset ${d} days`).toBeTruthy();
      expect(raceDay.date, `offset ${d} days`).toBe(raceDate);
    }
  });

  it('clamps very short and very long horizons', () => {
    const short = generatePlan(profile(iso(addDays('2026-07-01', 10)), '2026-07-01'));
    expect(short.totalWeeks).toBe(4);
    const long = generatePlan(profile(iso(addDays('2026-07-01', 500)), '2026-07-01'));
    expect(long.totalWeeks).toBe(52); // a year+ of runway caps at 52 (onboarding blocks beyond)
  });

  it('lead-in long sessions hold at maintenance scale, not race scale', () => {
    const far = { ...profile(iso(addDays('2026-07-01', 45 * 7)), '2026-07-01'), raceType: 'full' }; // 45w for a 40w-max full
    const p = generatePlan(far);
    expect(p.leadIn).toBeGreaterThan(0);
    const leadLongs = p.weeks.slice(0, p.leadIn).flatMap(w => w.workouts).filter(w => w.type === 'Long' && w.discipline === 'bike');
    leadLongs.forEach(w => expect(w.durationMin, w.id).toBeLessThanOrEqual(100)); // maintenance long-bike scale
    const buildLongs = p.weeks.slice(p.leadIn + 4).flatMap(w => w.workouts).filter(w => w.type === 'Long' && w.discipline === 'bike' && !w.race);
    expect(Math.max(...buildLongs.map(w => w.durationMin))).toBeGreaterThan(150); // the build still reaches full scale
  });

  it('opens with a Maintain lead-in when the race is beyond the build window', () => {
    const p = generatePlan(profile(iso(addDays('2026-07-01', 30 * 7)), '2026-07-01')); // 30 weeks, olympic max 24
    expect(p.leadIn).toBe(p.totalWeeks - 24);
    p.weeks.slice(0, p.leadIn).forEach(w => expect(w.phase).toBe('Maintain'));
    expect(p.weeks[p.leadIn].phase).toBe('Base'); // the build starts after
    const raceDay = p.weeks.flatMap(w => w.workouts).find(w => w.race);
    expect(raceDay).toBeTruthy(); // race day reachable even beyond the window
  });

  it('flags a short runway instead of blocking', () => {
    const p = generatePlan({ ...profile(iso(addDays('2026-07-01', 6 * 7)), '2026-07-01'), raceType: 'half' }); // 6 weeks for a 12-min half
    expect(p.shortRunway).toBe(true);
    expect(p.weeks.flatMap(w => w.workouts).some(w => w.race)).toBe(true);
  });

  it('generates a t100 plan with its race-day distances', () => {
    const p = generatePlan({ ...profile('2026-10-14', '2026-07-01'), raceType: 't100' });
    const raceDay = p.weeks.flatMap(w => w.workouts).find(w => w.race);
    expect(raceDay.segments.map(s => s.label).join(' ')).toContain('80');
    expect(p.shortRunway).toBe(undefined);
  });

  it('builds a maintenance block: all Maintain, no race day, recovery cadence, tests included', () => {
    const p = generatePlan({ ...profile('2026-09-23', '2026-07-01'), raceType: 'maintenance', horizonWeeks: 12, postRace: true });
    expect(p.totalWeeks).toBe(12);
    p.weeks.forEach(w => expect(w.phase).toBe('Maintain'));
    expect(p.weeks[0].isRecovery).toBe(true); // post-race conversion starts easy
    expect(p.weeks.flatMap(w => w.workouts).some(w => w.race)).toBe(false);
    expect(p.weeks.flatMap(w => w.workouts).some(w => w.test)).toBe(true);
    expect(p.weeks.some(w => w.isRecovery && w.index > 0)).toBe(true);
  });
});

describe('easeWorkout', () => {
  it('downgrades a run to easy aerobic at reduced volume', () => {
    const p = generatePlan(profile('2026-09-23', '2026-07-01'));
    const run = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'run' && w.durationMin > 0);
    const eased = easeWorkout(run, p);
    expect(eased.eased).toBe(true);
    expect(eased.type).toBe('Easy');
    expect(eased.durationMin).toBeLessThanOrEqual(run.durationMin);
    expect(eased.easedFrom).toBe(run.type);
  });

  it('leaves non-swim/bike/run sessions untouched', () => {
    const p = generatePlan(profile('2026-09-23', '2026-07-01'));
    const strength = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'strength');
    if (strength) expect(easeWorkout(strength, p)).toBe(strength);
  });
});

describe('trimWorkout (ramp guardrail)', () => {
  const p = generatePlan(profile('2026-09-23', '2026-07-01'));
  const run = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'run' && w.durationMin >= 40);

  it('reduces volume but keeps the session type and key flag', () => {
    const t = trimWorkout(run, p, 0.8);
    expect(t.trimmed).toBe(true);
    expect(t.trimmedFrom).toBe(run.durationMin);
    expect(t.durationMin).toBeLessThan(run.durationMin);
    expect(t.type).toBe(run.type);
    expect(t.key).toBe(run.key);
  });

  it('never lengthens: at the 20-minute floor the session comes back unchanged', () => {
    const short = { ...run, durationMin: 20 };
    expect(trimWorkout(short, p, 0.9)).toBe(short);
  });

  it('leaves non-swim/bike/run sessions untouched', () => {
    const strength = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'strength');
    if (strength) expect(trimWorkout(strength, p, 0.8)).toBe(strength);
  });
});

describe('boostWorkout (build nudge)', () => {
  const p = generatePlan(profile('2026-09-23', '2026-07-01'));
  const run = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'run' && w.durationMin >= 40);

  it('grows volume but keeps the session type', () => {
    const b = boostWorkout(run, p, 1.1);
    expect(b.boosted).toBe(true);
    expect(b.boostedFrom).toBe(run.durationMin);
    expect(b.durationMin).toBeGreaterThan(run.durationMin);
    expect(b.type).toBe(run.type);
  });

  it('never shrinks: a factor that rounds back down returns the session unchanged', () => {
    expect(boostWorkout(run, p, 1.0)).toBe(run);
  });

  it('leaves non-swim/bike/run sessions untouched', () => {
    const strength = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'strength');
    if (strength) expect(boostWorkout(strength, p, 1.1)).toBe(strength);
  });
});

describe('workout library variants', () => {
  const p = generatePlan(profile('2026-09-23', '2026-07-01'));

  it('is deterministic: the same profile always generates the identical plan', () => {
    const p2 = generatePlan(profile('2026-09-23', '2026-07-01'));
    const labels = pl => pl.weeks.flatMap(w => w.workouts).map(w => w.segments.map(x => x.label).join('|')).join('~');
    expect(labels(p2)).toBe(labels(p));
  });

  it('rotates session formats across weeks', () => {
    const longRuns = p.weeks.flatMap(w => w.workouts).filter(w => w.discipline === 'run' && w.type === 'Long');
    const shapes = new Set(longRuns.map(w => w.segments.length));
    expect(shapes.size).toBeGreaterThan(1); // steady weeks alternate with fast-finish weeks
  });

  it('selects the format from the week seed, wrapping deterministically', () => {
    const wk = seed => ({ discipline: 'run', type: 'Threshold', durationMin: 60, week: seed, phase: 'Build', id: seed + '-1' });
    const main = w => trimWorkout(w, p, 0.9).segments[1].label;
    expect(main(wk(0))).toContain('9 min threshold');
    expect(main(wk(1))).toContain('5 min threshold');
    expect(main(wk(2))).toContain('12 min cruise');
    expect(main(wk(3))).toContain('9 min threshold'); // wraps around
  });

  it('engine rebuilds keep the session in its week format', () => {
    const runs = p.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline === 'run' && w.durationMin >= 40 && !w.race && !w.test);
    const shape = w => w.segments.map(x => x.label.replace(/\d+/g, 'N')).join('|');
    runs.forEach(run => {
      expect(shape(trimWorkout(run, p, 0.8)), run.id).toBe(shape(run));
      expect(shape(boostWorkout(run, p, 1.15)), run.id).toBe(shape(run));
    });
  });
});

describe('intensity ladders (widened)', () => {
  const forFitness = fitness => generatePlan({ ...profile('2026-09-23', '2026-07-01'), fitness });
  const quality = (p, disc) => p.weeks.filter(w => !w.isRecovery).flatMap(w => w.workouts)
    .filter(x => x.discipline === disc && x.role === 'quality' && !x.test);

  it('keeps the intermediate arc unchanged: Base easy end, Build mid, Peak race-specific', () => {
    const p = forFitness('intermediate');
    const runs = quality(p, 'run');
    expect(runs.filter(x => x.phase === 'Base').every(x => x.type === 'Easy')).toBe(true);
    expect(runs.filter(x => x.phase === 'Build').every(x => x.type === 'Tempo')).toBe(true);
    expect(runs.filter(x => x.phase === 'Peak').every(x => x.type === 'Threshold')).toBe(true);
  });

  it('gives beginners structured play in Build instead of a jump to hard reps', () => {
    const p = forFitness('beginner');
    const buildRuns = quality(p, 'run').filter(x => x.phase === 'Build');
    expect(buildRuns.length).toBeGreaterThan(0);
    expect(buildRuns.every(x => x.type === 'Fartlek')).toBe(true);
    const buildBikes = quality(p, 'bike').filter(x => x.phase === 'Build');
    expect(buildBikes.every(x => x.type === 'Tempo')).toBe(true);
  });

  it('lets elites top out at VO2 on the bike', () => {
    const p = forFitness('elite');
    expect(new Set(quality(p, 'bike').map(x => x.type)).has('VO2 Intervals')).toBe(true);
  });
});

describe('brick variants', () => {
  const p = generatePlan({ ...profile('2026-09-23', '2026-07-01'), daysPerWeek: 4, trainingDays: [1, 3, 5, 6] });
  const bricks = p.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'brick' && !x.race);

  it('rotates brick formats across weeks', () => {
    expect(bricks.length).toBeGreaterThan(2);
    const shapes = new Set(bricks.map(x => x.segments.map(s => s.label.replace(/\d+/g, 'N')).join('|')));
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('pins recovery-week bricks to the canonical single-transition shape', () => {
    const rec = p.weeks.find(w => w.isRecovery);
    const recBrick = rec && rec.workouts.find(x => x.discipline === 'brick' && !x.race);
    if (recBrick) expect(recBrick.segments.some(s => s.label.includes('Round'))).toBe(false);
  });
});

describe('durability long sessions', () => {
  const p = generatePlan(profile('2026-09-23', '2026-07-01'));
  const longs = disc => p.weeks.flatMap(w => w.workouts).filter(x => x.discipline === disc && x.type === 'Long');
  const hasIntervals = x => x.segments.some(s => s.label.includes('on tired legs'));

  it('finishes some Build/Peak long sessions with intervals', () => {
    expect(longs('run').filter(x => (x.phase === 'Build' || x.phase === 'Peak') && hasIntervals(x)).length).toBeGreaterThan(0);
    expect(longs('bike').filter(x => (x.phase === 'Build' || x.phase === 'Peak') && hasIntervals(x)).length).toBeGreaterThan(0);
  });

  it('never puts interval finishes in Base, Taper or recovery weeks', () => {
    const recWeeks = new Set(p.weeks.filter(w => w.isRecovery).map(w => w.index));
    const offLimits = [...longs('run'), ...longs('bike')]
      .filter(x => x.phase === 'Base' || x.phase === 'Taper' || recWeeks.has(x.week));
    expect(offLimits.length).toBeGreaterThan(0);
    expect(offLimits.some(hasIntervals)).toBe(false);
  });
});

describe('custom workouts (user-added sessions)', () => {
  const p = generatePlan(profile('2026-09-23', '2026-07-01'));
  const someDate = p.weeks[1].start; // a Monday inside the plan

  it('builds from the library, flags custom and lands in the owning week', () => {
    const { plan: np, workout } = addCustomWorkout(p, { discipline: 'run', type: 'Tempo', durationMin: 40, dateISO: someDate });
    expect(workout.custom).toBe(true);
    expect(workout.week).toBe(1);
    expect(workout.title).toBe('Tempo Run');
    expect(workout.durationMin).toBe(40);
    expect(workout.segments.length).toBeGreaterThan(0);
    expect(np.weeks[1].workouts).toContain(workout);
    expect(np.weeks[1].totalMin).toBe(p.weeks[1].totalMin + 40);
    expect(p.weeks[1].workouts).not.toContain(workout); // original untouched
  });

  it('never reuses an id, even after a remove', () => {
    const a = addCustomWorkout(p, { discipline: 'bike', type: 'Endurance', durationMin: 60, dateISO: someDate });
    const b = addCustomWorkout(a.plan, { discipline: 'swim', type: 'Technique', durationMin: 30, dateISO: someDate });
    expect(b.workout.id).not.toBe(a.workout.id);
    const removed = removeCustomWorkout(b.plan, a.workout.id);
    const c = addCustomWorkout(removed, { discipline: 'run', type: 'Easy', durationMin: 30, dateISO: someDate });
    expect(c.workout.id).not.toBe(b.workout.id);
  });

  it('remove takes out only custom sessions and restores the weekly total', () => {
    const { plan: np, workout } = addCustomWorkout(p, { discipline: 'run', type: 'Easy', durationMin: 30, dateISO: someDate });
    const back = removeCustomWorkout(np, workout.id);
    expect(back.weeks[1].workouts.find(x => x.id === workout.id)).toBe(undefined);
    expect(back.weeks[1].totalMin).toBe(p.weeks[1].totalMin);
    const planned = p.weeks[1].workouts.find(x => x.discipline !== 'rest');
    expect(removeCustomWorkout(p, planned.id).weeks[1].workouts.length).toBe(p.weeks[1].workouts.length);
  });

  it('strength fixes its own duration', () => {
    const { workout } = addCustomWorkout(p, { discipline: 'strength', type: 'Strength', durationMin: 90, dateISO: someDate });
    expect(workout.durationMin).toBeLessThan(90);
  });
});

describe('upgradePlanSegments (schema migration for cached plans)', () => {
  const p = generatePlan(profile('2026-09-23', '2026-07-01'));
  // simulate cached plans from two past eras: post-variant/pre-profile keeps
  // its seed and just lacks zone/blocks; pre-variant lacks the seed too.
  const strip = (pl, dropSeed) => ({ ...pl, weeks: pl.weeks.map(w => ({ ...w, workouts: w.workouts.map(x => ({
    ...x, seed: dropSeed ? undefined : x.seed,
    segments: x.segments.map(({ zone, blocks, ...rest }) => rest),
  })) })) });

  it('restores profile data without changing any session shape (seeded plans)', () => {
    const old = strip(p, false);
    const up = upgradePlanSegments(old);
    const shape = pl => pl.weeks.flatMap(w => w.workouts).map(x => x.id + '|' + x.title + '|' + x.durationMin + '|' + x.segments.map(s => s.label).join(';')).join('~');
    expect(shape(up)).toBe(shape(old)); // identical labels and durations
    const runs = up.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'run' && !x.race && !x.test && x.durationMin);
    expect(runs.length).toBeGreaterThan(0);
    runs.forEach(x => expect(x.segments.some(s => s.zone || s.blocks), x.id).toBe(true));
  });

  it('pins pre-variant plans (no seed) to the canonical format their sessions had', () => {
    const up = upgradePlanSegments(strip(p, true));
    const thresholds = up.weeks.flatMap(w => w.workouts).filter(x => x.type === 'Threshold' && x.discipline === 'run' && !x.test);
    thresholds.forEach(x => expect(x.segments[1].label, x.id).toContain('9 min threshold')); // v0, never the week's rotation
  });

  it('leaves race day, tests and current plans alone', () => {
    const old = strip(p, false);
    const up = upgradePlanSegments(old);
    const pick = (pl, f) => pl.weeks.flatMap(w => w.workouts).find(f);
    expect(pick(up, x => x.race)).toBe(pick(old, x => x.race));
    expect(pick(up, x => x.test)).toBe(pick(old, x => x.test));
    expect(upgradePlanSegments(p)).toBe(p); // already current → same reference
    expect(upgradePlanSegments(null)).toBe(null);
  });
});

describe('generatePlan — tune-up (B) races', () => {
  // Base profile: Olympic on 2026-09-23, weeks run Monday 2026-06-29 onward,
  // training days Mon/Tue/Thu/Sat/Sun. The tune-up lands on Saturday 2026-07-25.
  const B_DATE = '2026-07-25';
  const withB = kind => generatePlan({ ...profile('2026-09-23', '2026-07-01'), bRaces: [{ kind, date: B_DATE }] });
  const flat = p => p.weeks.flatMap(w => w.workouts);
  const at = (p, d) => flat(p).filter(x => x.date === d);

  it('drops the race onto its day, replacing the planned session, and keeps the id', () => {
    const base = generatePlan(profile('2026-09-23', '2026-07-01'));
    const p = withB('sprint');
    const day = at(p, B_DATE);
    expect(day.length).toBe(1); // any strength double is dropped — racing is the session
    const b = day[0];
    expect(b.bRace).toBe(true);
    expect(b.type).toBe('RACE');
    expect(b.title).toMatch(/TUNE-UP — Sprint Triathlon/);
    expect(b.discipline).toBe('brick');
    expect(b.key).toBe(true);
    expect(b.id).toBe(at(base, B_DATE)[0].id); // stable id → logs/moves survive reshape
    expect(b.segments.length).toBe(3); // swim/bike/run legs for a tri tune-up
    // the goal race is untouched
    expect(flat(p).filter(x => x.race).length).toBe(1);
    // week totals reflect the replacement
    const wk = p.weeks.find(w => w.workouts.some(x => x.date === B_DATE));
    expect(wk.totalMin).toBe(wk.workouts.reduce((a, x) => a + (x.durationMin || 0), 0));
  });

  it('eases the two days before and the day after (mini-taper in, recovery out)', () => {
    const base = generatePlan(profile('2026-09-23', '2026-07-01'));
    const p = withB('run10k');
    ['2026-07-23', '2026-07-26'].forEach(d => { // trained Thu before, Sun after
      const eased = at(p, d).filter(x => x.discipline !== 'rest' && x.discipline !== 'strength' && !x.test);
      const orig = at(base, d).filter(x => x.discipline !== 'rest' && x.discipline !== 'strength' && !x.test);
      eased.forEach((x, i) => expect(x.durationMin, d).toBeLessThan(orig[i].durationMin));
    });
    // a run race day carries warm-up / race / cool-down guidance
    expect(at(p, B_DATE)[0].segments[1].label).toMatch(/race it/i);
  });

  it('protects the goal-race taper and the plan bounds: invalid tune-ups are ignored', () => {
    const taper = generatePlan({ ...profile('2026-09-23', '2026-07-01'), bRaces: [{ kind: 'sprint', date: '2026-09-18' }] }); // 5 days out
    expect(flat(taper).some(x => x.bRace)).toBe(false);
    const outside = generatePlan({ ...profile('2026-09-23', '2026-07-01'), bRaces: [{ kind: 'sprint', date: '2026-11-01' }] });
    expect(flat(outside).some(x => x.bRace)).toBe(false);
    const junk = generatePlan({ ...profile('2026-09-23', '2026-07-01'), bRaces: [{ kind: 'marathon', date: B_DATE }, null] });
    expect(flat(junk).some(x => x.bRace)).toBe(false);
  });

  it('a tune-up on a rest day just becomes the race day', () => {
    const p = generatePlan({ ...profile('2026-09-23', '2026-07-01'), bRaces: [{ kind: 'run5k', date: '2026-07-24' }] }); // Friday, untrained
    const day = at(p, '2026-07-24');
    expect(day.length).toBe(1);
    expect(day[0].bRace).toBe(true);
    expect(day[0].discipline).toBe('run');
  });
});

describe('generatePlan — weekly load reads test weeks honestly (the week-6 report)', () => {
  const realSess = w => w.workouts.filter(x => x.discipline !== 'rest' && !x.race);
  const weekMins = w => realSess(w).reduce((s, x) => s + x.durationMin, 0);
  const weekLoad = w => realSess(w).reduce((s, x) => s + estimateTss(x), 0);

  it('a non-recovery benchmark-test week can have fewer minutes than the week before yet more load', () => {
    // A benchmark test is short but taxing; it replaces a longer endurance/quality
    // session, so raw minutes dipped even though the week is harder. This is exactly
    // why the progress chart plots training load, not time.
    const p = generatePlan({
      name: 'J', raceType: 'olympic', fitness: 'advanced',
      trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
      startDate: '2026-07-06', raceDate: iso(addDays('2026-07-06', 77)),
    });
    // The reported case: a non-recovery test week whose previous (also non-recovery)
    // week has at least as many minutes — the minutes look like a step back.
    const i = p.weeks.findIndex((w, k) => k > 0 && !w.isRecovery && !p.weeks[k - 1].isRecovery
      && w.workouts.some(x => x.test) && weekMins(w) <= weekMins(p.weeks[k - 1]));
    expect(i).toBeGreaterThan(0);
    expect(weekLoad(p.weeks[i])).toBeGreaterThan(weekLoad(p.weeks[i - 1])); // load tells the truth
  });
});
