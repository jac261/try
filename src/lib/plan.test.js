import { describe, it, expect } from 'vitest';
import { generatePlan, easeWorkout, trimWorkout, boostWorkout, addCustomWorkout, removeCustomWorkout, upgradePlanSegments } from './plan.js';
import { iso, addDays } from './date.js';

const profile = (raceDate, startDate) => ({
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  raceDate, startDate,
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
