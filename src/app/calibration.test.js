import { describe, it, expect } from 'vitest';
import { buildObservation, toNote, fromNote } from './calibration.js';
import { wellness } from '@/lib/wellness.js';

const recs = [
  // 21 baseline days around hrv 60 / rhr 50, then the session day
  ...Array.from({ length: 21 }, (_, i) => ({
    date: '2026-06-' + String(i + 9).padStart(2, '0'), hrv: 58 + (i % 5), rhr: 49 + (i % 3),
  })),
  { date: '2026-07-02', hrv: 39, rhr: 55, sleepH: 6.4, tsb: 36 },
];

const workout = { id: '0-3', discipline: 'bike', type: 'Sweet Spot', durationMin: 55, key: false };

describe('calibration observations', () => {
  it('binds the readiness snapshot for the session day to the outcome', () => {
    const obs = buildObservation({
      workout, date: '2026-07-02', feel: 'hard', eased: false,
      wellnessRecs: recs, at: '2026-07-02T10:00:00Z',
    });
    expect(obs.v).toBe(wellness.ENGINE_VERSION);
    expect(obs.date).toBe('2026-07-02');
    expect(obs.score).toBeLessThan(75);            // rough morning → not green
    expect(obs.inputs.hrv).toBe(39);
    expect(obs.inputs.hrvMean).toBeGreaterThan(55); // baseline from the prior 21 days
    expect(obs.inputs.sleepH).toBe(6.4);
    expect(obs.workout).toEqual({ id: '0-3', discipline: 'bike', type: 'Sweet Spot', durationMin: 55, key: false });
    expect(obs.feel).toBe('hard');
    expect(obs.eased).toBe(false);
  });

  it('still records the outcome when there is no wellness data for the day', () => {
    const obs = buildObservation({ workout, date: '2026-08-01', feel: 'easy', eased: true, wellnessRecs: [], at: null });
    expect(obs.score).toBe(null);
    expect(obs.inputs).toBe(null);
    expect(obs.feel).toBe('easy');
    expect(obs.eased).toBe(true);
  });

  it('round-trips through the log-notes encoding and fits the backend limit', () => {
    const obs = buildObservation({
      workout, date: '2026-07-02', feel: 'right', eased: false,
      wellnessRecs: recs, at: '2026-07-02T10:00:00Z',
    });
    const note = toNote(obs);
    expect(note.startsWith('cal:')).toBe(true);
    expect(note.length).toBeLessThan(2000);         // workout_logs.notes validation cap
    expect(fromNote(note)).toEqual(obs);
    expect(fromNote('just a human note')).toBe(null);
    expect(fromNote(null)).toBe(null);
  });
});
