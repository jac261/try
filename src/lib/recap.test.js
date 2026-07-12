import { describe, it, expect } from 'vitest';
import { buildRecap } from './recap.js';

const paces = { run: { easy: 360, long: 340, tempo: 300, threshold: 285, interval: 265 },
  swim: { easy: 132, steady: 126, css: 120, fast: 114 }, ftp: 222 };
const act = (over = {}) => ({ id: 'i1', date: '2026-07-12', movingTimeSec: 3000, distance: 8000, trainingLoad: 45, rpe: 3, ...over });
const iv = (over = {}) => ({ type: 'WORK', movingTimeSec: 540, distance: 2000, averageSpeed: 3.51, averageHeartrate: 165, ...over });
const plan = { paces, weeks: [{ index: 0, workouts: [
  { id: '0-0', discipline: 'run', type: 'Easy', title: 'Easy Run', date: '2026-07-12', durationMin: 50 },
  { id: '0-1', discipline: 'bike', type: 'Endurance', title: 'Endurance Ride', date: '2026-07-13', durationMin: 75 },
] }] };

describe('buildRecap (session recap slides)', () => {
  const base = { workout: plan.weeks[0].workouts[0], activity: act(), paces, plan, log: {}, moves: {}, todayISO: '2026-07-12' };

  it('always opens with the headline and closes with tomorrow', () => {
    const s = buildRecap(base);
    expect(s[0].kind).toBe('headline');
    expect(s[0].big).toBe('50 min');
    expect(s[s.length - 1].kind).toBe('takeaway');
    expect(s[s.length - 1].big).toBe('Endurance Ride'); // tomorrow's session by effective date
  });

  it('tomorrow with nothing planned says rest, honestly framed', () => {
    const s = buildRecap({ ...base, todayISO: '2026-07-13' });
    expect(s[s.length - 1].big).toBe('Rest day');
  });

  it('slides only exist when their data does: no HR slide without averageHeartrate, no dose without load', () => {
    const bare = buildRecap({ ...base, activity: act({ trainingLoad: null, rpe: null }) });
    expect(bare.some(x => x.kind === 'hr')).toBe(false);
    expect(bare.some(x => x.kind === 'effort')).toBe(false);
    const rich = buildRecap({ ...base, activity: act({ averageHeartrate: 154, maxHeartrate: 171 }) });
    const hr = rich.find(x => x.kind === 'hr');
    expect(hr.big).toBe('154 bpm');
    expect(hr.lines[0]).toContain('171');
  });

  it('interval rows become the splits slide with tones and relative bars', () => {
    const s = buildRecap({ ...base,
      workout: { ...base.workout, type: 'Threshold', title: 'Threshold Run' },
      intervals: [iv(), iv({ averageSpeed: 3.3 })] });
    const splits = s.find(x => x.kind === 'splits');
    expect(splits.big).toMatch(/of 2 reps on target/);
    expect(splits.rows.length).toBe(2);
    expect(splits.rows[0].frac).toBeGreaterThan(splits.rows[1].frac); // faster rep, longer bar
  });

  it('returns null without a recording — no recap for a bare tick', () => {
    expect(buildRecap({ ...base, activity: null })).toBe(null);
  });

  it('an unplanned recording still builds a deck from an ad-hoc workout', () => {
    // What App synthesises when you tap an unmatched row in the Recorded card.
    const w = { id: 'adhoc-i9', adhoc: true, discipline: 'bike', title: 'Morning Ride', durationMin: 50 };
    const s = buildRecap({ ...base, workout: w,
      activity: act({ id: 'i9', averageHeartrate: 148, trainingLoad: 60 }) });
    expect(s[0].kind).toBe('headline');
    expect(s[0].big).toBe('50 min');
    expect(s[0].lines).not.toContain('Interval session'); // no plan-relative noise
    expect(s.some(x => x.kind === 'hr')).toBe(true);       // still surfaces HR + load
    expect(s[s.length - 1].kind).toBe('takeaway');
  });
});
