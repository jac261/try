import { describe, it, expect } from 'vitest';
import { proposeToday } from './adapt.js';

const hard = { id: '0-1', title: 'Threshold Run', type: 'Threshold', discipline: 'run', durationMin: 50 };
const easy = { id: '0-2', title: 'Easy Run', type: 'Easy', discipline: 'run', durationMin: 40 };
const test = { id: '0-3', title: 'Fitness Test · 5k Run', type: 'Test', test: true, discipline: 'run', durationMin: 45 };
const race = { id: '9-0', title: 'RACE DAY', type: 'RACE', race: true, discipline: 'brick', durationMin: 0 };
const easedSession = { id: '0-1', title: 'Easy Run', type: 'Easy', eased: true, easedFrom: 'Threshold', discipline: 'run', durationMin: 35 };

describe('adaptive engine — Phase 1 (readiness-driven days)', () => {
  it('D1: red + hard session → propose the ease swap with volume in the why', () => {
    const p = proposeToday({ band: 'red', score: 48, todays: [easy, hard] });
    expect(p.kind).toBe('ease');
    expect(p.action).toBe('easeToday');
    expect(p.workout.id).toBe('0-1');
    expect(p.why).toMatch(/48/);
    expect(p.why).toMatch(/35 min/); // 50 × 0.65 → round5
  });

  it('D2: amber + hard session → softer framing, athlete holds the tiebreak', () => {
    const p = proposeToday({ band: 'amber', score: 63, todays: [hard] });
    expect(p.kind).toBe('ease');
    expect(p.why).toMatch(/your call/i);
  });

  it('D3: green + a session eased earlier today → propose restoring it', () => {
    const p = proposeToday({ band: 'green', score: 82, todays: [easedSession] });
    expect(p.kind).toBe('restore');
    expect(p.action).toBe('restoreToday');
    expect(p.headline).toMatch(/Threshold/);
  });

  it('D4: red + test day → propose MOVING the test, never softening it (G2), and it outranks the hard session', () => {
    const p = proposeToday({ band: 'red', score: 40, todays: [hard, test] });
    expect(p.kind).toBe('move-test');
    expect(p.workout.id).toBe('0-3');
    expect(p.why).toMatch(/false-low/i);
  });

  it('guardrails: race day immutable (G1), completed sessions untouched (G4)', () => {
    expect(proposeToday({ band: 'red', score: 40, todays: [race] })).toBe(null);
    expect(proposeToday({ band: 'red', score: 40, todays: [{ ...hard, done: true }] })).toBe(null);
  });

  it('no stacking (G3): an already-eased session is not re-proposed on amber/red', () => {
    expect(proposeToday({ band: 'amber', score: 60, todays: [easedSession] })).toBe(null);
    expect(proposeToday({ band: 'red', score: 45, todays: [easedSession] })).toBe(null);
  });

  it('green with nothing eased, or easy-only days → no proposal (G5: quiet by default)', () => {
    expect(proposeToday({ band: 'green', score: 90, todays: [hard] })).toBe(null);
    expect(proposeToday({ band: 'red', score: 40, todays: [easy] })).toBe(null);
    expect(proposeToday({ band: 'amber', score: 60, todays: [] })).toBe(null);
  });
});
