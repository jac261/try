import { describe, it, expect } from 'vitest';
import { buildWatchEvents, watchDescription } from './watch.js';

const TODAY = '2026-07-09';
const wk = (id, discipline, type, date, durationMin, extra = {}) => ({
  id, discipline, type, title: type + ' ' + discipline, date, durationMin,
  segments: [{ label: 'Main', min: durationMin, detail: 'steady' }], ...extra,
});
const plan = { weeks: [{ index: 0, workouts: [
  wk('0-0', 'run', 'Easy', '2026-07-09', 50),
  wk('0-1', 'bike', 'Endurance', '2026-07-10', 60),
  wk('0-2', 'rest', 'Rest', '2026-07-11', 0),
  wk('0-3', 'strength', 'Strength', '2026-07-12', 40),
  wk('0-4', 'swim', 'Technique', '2026-07-08', 35),            // yesterday → outside
  wk('9-0', 'brick', 'RACE', '2026-07-20', 120, { race: true }), // race day → skipped
] }] };

describe('buildWatchEvents (workouts-to-watch)', () => {
  it('maps upcoming sessions to calendar events inside the window', () => {
    const { oldest, newest, events } = buildWatchEvents({ plan, moves: {}, todayISO: TODAY });
    expect(oldest).toBe(TODAY);
    expect(newest).toBe('2026-07-15'); // a rolling week inclusive of today
    expect(events.map(e => [e.ref, e.date, e.type])).toEqual([
      ['0-0', '2026-07-09', 'Run'],
      ['0-1', '2026-07-10', 'Ride'],
      ['0-3', '2026-07-12', 'WeightTraining'],
    ]);
    expect(events[0].name).toBe('Easy run');
    expect(events[0].movingTimeSec).toBe(3000);
    expect(events[0].description).toBe('• Main · 50m · steady');
  });

  it('uses effective dates for moved sessions and adjusted volume via easedOf', () => {
    const easedOf = w => (w.id === '0-1' ? { ...w, durationMin: 45, trimmed: true } : w);
    const { events } = buildWatchEvents({ plan, moves: { '0-4': '2026-07-15' }, easedOf, todayISO: TODAY });
    expect(events.find(e => e.ref === '0-4').date).toBe('2026-07-15'); // moved back inside
    const bike = events.find(e => e.ref === '0-1');
    expect(bike.movingTimeSec).toBe(2700);
    expect(bike.description).toContain('• Trimmed by the adaptive engine');
  });

  it('is quiet without a plan', () => {
    expect(buildWatchEvents({ plan: null, moves: {}, todayISO: TODAY }).events).toEqual([]);
  });
});

describe('watchDescription', () => {
  it('renders segments as bullet lines, never the "- " step syntax intervals.icu would parse', () => {
    const d = watchDescription({ segments: [
      { label: 'Warm-up', min: 12, detail: 'Z2 5:40/km' },
      { label: 'Drills', detail: 'form focus' }, // no minutes
    ] });
    expect(d).toBe('• Warm-up · 12m · Z2 5:40/km\n• Drills · form focus');
  });

  it('notes engine adjustments and returns null when empty', () => {
    expect(watchDescription({ segments: [], eased: true, easedFrom: 'Threshold' }))
      .toBe('• Eased by the adaptive engine (was Threshold)');
    expect(watchDescription({ segments: [] })).toBe(null);
  });
});
