import { describe, it, expect } from 'vitest';
import { SWIM_TYPES, SWIM_ROLES, isSwimSegment, isSwimWorkout, swimWorkoutIssues, isTrainingSwim } from './swimschema.js';
import { generatePlan } from './plan.js';

/* Phase 1: the swim schema is a written-down version of the shape the
   generator already produces. These tests pin the validators; the matrix
   sweep in swimpass.test.js proves every real generated swim conforms. */

const swimProfile = {
  name: 'S', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 130, ftp: 250, weightKg: 75,
  daysPerWeek: 6, trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5,
  startDate: '2026-06-01', raceDate: '2026-09-27',
};

describe('the swim schema constants', () => {
  it('name the backend WorkoutTypes spellings exactly, never lowercase slugs', () => {
    expect(SWIM_TYPES).toEqual(['Technique', 'Endurance', 'CSS Intervals', 'Open Water', 'Race Pace', 'Long']);
    expect(SWIM_ROLES).toEqual(['easy', 'quality', 'long']);
    // the collision that made the literal schema unsafe: these must stay
    // capitalised and spaced, or the plan save 400s
    SWIM_TYPES.forEach(t => expect(t).not.toBe(t.toLowerCase()));
  });
});

describe('isSwimSegment', () => {
  it('accepts a plain segment and a rep segment', () => {
    expect(isSwimSegment({ label: 'Warm-up', min: 8, detail: 'easy', zone: 'Z1' })).toBe(true);
    expect(isSwimSegment({ label: '4 × 100 m', min: 12, detail: 'p', zone: 'Z3', blocks: [{ min: 2, zone: 'Z3' }] })).toBe(true);
  });
  it('rejects a missing label, a bad duration, or malformed optional fields', () => {
    expect(isSwimSegment({ min: 8 })).toBe(false);
    expect(isSwimSegment({ label: 'x', min: -1 })).toBe(false);
    expect(isSwimSegment({ label: 'x', min: 'ten' })).toBe(false);
    expect(isSwimSegment({ label: 'x', min: 8, blocks: 'nope' })).toBe(false);
    expect(isSwimSegment(null)).toBe(false);
  });
});

describe('isSwimWorkout / swimWorkoutIssues', () => {
  const plan = generatePlan(swimProfile);
  const realSwim = plan.weeks.flatMap(w => w.workouts).find(isTrainingSwim);

  it('accepts a real generated swim training session', () => {
    expect(realSwim).toBeTruthy();
    expect(swimWorkoutIssues(realSwim)).toEqual([]);
    expect(isSwimWorkout(realSwim)).toBe(true);
  });

  it('rejects the wrong discipline, a slug type, a bad role, and non-array segments', () => {
    const run = plan.weeks.flatMap(w => w.workouts).find(x => x.discipline === 'run' && !x.race);
    expect(isSwimWorkout(run)).toBe(false);
    expect(swimWorkoutIssues({ ...realSwim, type: 'css' })).toContain('type is not a swim training type: css');
    expect(swimWorkoutIssues({ ...realSwim, role: 'sprint' })[0]).toMatch(/role is not/);
    expect(swimWorkoutIssues({ ...realSwim, segments: null })).toContain('segments is not an array');
    expect(swimWorkoutIssues({ ...realSwim, durationMin: -5 })[0]).toMatch(/durationMin/);
  });

  it('flags a malformed segment by index', () => {
    const bad = { ...realSwim, segments: [...realSwim.segments, { min: 5 }] };
    expect(swimWorkoutIssues(bad).some(m => /segment \d+ is malformed/.test(m))).toBe(true);
  });

  it('isTrainingSwim excludes the CSS test, race day and rest', () => {
    expect(isTrainingSwim(realSwim)).toBe(true);
    expect(isTrainingSwim({ discipline: 'swim', test: true, type: 'Test' })).toBe(false);
    expect(isTrainingSwim({ discipline: 'swim', type: 'Rest' })).toBe(false);
    expect(isTrainingSwim({ discipline: 'run', type: 'Easy' })).toBe(false);
  });
});
