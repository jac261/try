import { describe, it, expect } from 'vitest';
import { generatePlan, addCustomWorkout } from './plan.js';
import { workoutBlocks, ZONE_COLORS, ZONE_LEVEL } from './profile.js';

const profile = { name: 'T', raceType: 'olympic', fitness: 'intermediate', trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5, raceDate: '2026-09-23', startDate: '2026-07-01' };
const p = generatePlan(profile);
const custom = (type, dur, disc = 'run', dateISO = p.weeks[0].start) =>
  addCustomWorkout(p, { discipline: disc, type, durationMin: dur, dateISO }).workout;

describe('workoutBlocks (interval profile)', () => {
  it('expands an interval main set rep by rep, warm-up and cool-down included', () => {
    const w = custom('Threshold', 60); // week 0 → canonical 9-min reps
    const blocks = workoutBlocks(w);
    expect(blocks[0]).toEqual({ min: 15, zone: 'Z2' });                       // warm-up
    expect(blocks.filter(b => b.zone === 'Z4').map(b => b.min)).toEqual([9, 9, 9]); // 3 × 9 min
    expect(blocks[blocks.length - 1]).toEqual({ min: 10, zone: 'Z1' });      // cool-down
  });

  it('draws the pyramid fartlek sized to the session', () => {
    const work = dur => workoutBlocks(custom('Fartlek', dur, 'run', p.weeks[1].start)) // week 1 → pyramid variant
      .filter(b => b.zone === 'Z3').map(b => b.min);
    expect(work(55)).toEqual([1, 2, 3, 4, 3, 2, 1]); // room for the full pyramid
    expect(work(45)).toEqual([1, 2, 3, 3, 2, 1]);    // squeezed → shorter peak
  });

  it('block time adds up to roughly the session duration', () => {
    for (const [type, dur] of [['Threshold', 60], ['Tempo', 50], ['VO2 Intervals', 55], ['Easy', 40]]) {
      const w = custom(type, dur);
      const total = workoutBlocks(w).reduce((a, b) => a + b.min, 0);
      expect(Math.abs(total - dur), type).toBeLessThanOrEqual(6);
    }
  });

  it('hides rather than misleads: zoneless timed segments (old builds, strength) give no blocks', () => {
    expect(workoutBlocks(custom('Strength', 40, 'strength'))).toEqual([]);
    expect(workoutBlocks({ segments: [{ label: 'Steady', min: 40 }] })).toEqual([]);
    expect(workoutBlocks({ segments: [] })).toEqual([]);
  });

  it('every zone has a colour and a height', () => {
    ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'].forEach(z => {
      expect(ZONE_COLORS[z]).toBeTruthy();
      expect(ZONE_LEVEL[z]).toBeGreaterThan(0);
    });
  });
});

describe('swim blocks (CSS-anchored)', () => {
  it('draws CSS intervals as work/rest alternation timed from CSS pace', () => {
    const w = custom('CSS Intervals', 40, 'swim');
    const blocks = workoutBlocks(w);
    const work = blocks.filter(b => b.zone === 'Z4');
    expect(work.length).toBeGreaterThanOrEqual(6);
    // intermediate estimated CSS is 120 s/100m → each 100 m rep ≈ 2 min
    expect(work[0].min).toBeCloseTo(2, 1);
    expect(blocks.some(b => b.zone === 'Z1')).toBe(true); // rests drawn
  });

  it('times continuous swimming from the pace of its zone', () => {
    const w = custom('Endurance', 40, 'swim');
    const blocks = workoutBlocks(w);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    const total = blocks.reduce((a, b) => a + b.min, 0);
    expect(total).toBeGreaterThan(20); // a real session, not seconds
    expect(total).toBeLessThan(60);
  });

  it('leaves the swim fitness test without a profile', () => {
    const p2 = generatePlan(profile);
    const test = p2.weeks.flatMap(w => w.workouts).find(x => x.test && x.discipline === 'swim');
    if (test) expect(workoutBlocks(test)).toEqual([]);
  });
});
