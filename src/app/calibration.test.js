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

  it('stamps who authored the feel, and keeps the derivation reproducible', () => {
    // the athlete's own tap, no recording rpe known: provenance alone
    const tap = buildObservation({ workout, date: '2026-07-02', feel: 'hard', eased: false, wellnessRecs: recs, at: null, feelSource: 'athlete' });
    expect(tap.feelSource).toBe('athlete');
    expect('rpe' in tap).toBe(false);
    // machine-derived from the recording: provenance plus the raw input, so
    // the band stays re-derivable if feelFromRpe is ever re-cut
    const derived = buildObservation({ workout, date: '2026-07-02', feel: 'hard', eased: false, wellnessRecs: recs, at: null, feelSource: 'rpe', rpe: 9 });
    expect(derived.feelSource).toBe('rpe');
    expect(derived.rpe).toBe(9);
    expect(fromNote(toNote(derived))).toEqual(derived); // survives the synced note
    // a tap that replaces a derived row carries the recording's rpe forward,
    // so the corpus keeps whether the tap agreed with or overrode the band
    const overrode = buildObservation({ workout, date: '2026-07-02', feel: 'right', eased: false, wellnessRecs: recs, at: null, feelSource: 'athlete', rpe: 9 });
    expect(overrode.feelSource).toBe('athlete');
    expect(overrode.rpe).toBe(9);
  });

  it('unknown provenance stays unmarked — never guessed, never defaulted', () => {
    // legacy path: feel present, no source given
    const legacy = buildObservation({ workout, date: '2026-07-02', feel: 'easy', eased: false, wellnessRecs: recs, at: null });
    expect('feelSource' in legacy).toBe(false);
    // no feel at all: nothing to stamp, even if a caller passes strays
    const none = buildObservation({ workout, date: '2026-07-02', feel: null, eased: false, wellnessRecs: recs, at: null, feelSource: 'rpe', rpe: 6 });
    expect('feelSource' in none).toBe(false);
    expect('rpe' in none).toBe(false);
    // outside the FEEL_SOURCES fence: dropped, not written
    const junkSource = buildObservation({ workout, date: '2026-07-02', feel: 'easy', eased: false, wellnessRecs: recs, at: null, feelSource: 'banana', rpe: 6 });
    expect('feelSource' in junkSource).toBe(false);
    expect('rpe' in junkSource).toBe(false);
    // a non-finite rpe never reaches the corpus (NaN would serialise to null)
    const junkRpe = buildObservation({ workout, date: '2026-07-02', feel: 'right', eased: false, wellnessRecs: recs, at: null, feelSource: 'rpe', rpe: NaN });
    expect(junkRpe.feelSource).toBe('rpe');
    expect('rpe' in junkRpe).toBe(false);
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
