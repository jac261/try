import { describe, it, expect } from 'vitest';
import { generatePlan, easeWorkout, trimWorkout, boostWorkout } from './plan.js';
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
    expect(long.totalWeeks).toBe(40);
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
