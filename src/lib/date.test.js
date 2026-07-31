import { describe, it, expect, vi, afterEach } from 'vitest';
import { toDate, iso, addDays, daysBetween, weeksBetween, startOfWeekMonday } from './date.js';

describe('date helpers', () => {
  it('parses a date-only string as LOCAL midnight (no UTC shift)', () => {
    const d = toDate('2026-09-20');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // September (0-indexed)
    expect(d.getDate()).toBe(20);
    expect(d.getHours()).toBe(0);
  });

  it('iso round-trips a date-only string in any timezone (regression: UTC-parse bug)', () => {
    expect(iso('2026-09-20')).toBe('2026-09-20');
    expect(iso('2026-01-01')).toBe('2026-01-01');
    expect(iso('2026-12-31')).toBe('2026-12-31');
  });

  it('iso agrees between a Date object and its string form', () => {
    expect(iso(new Date(2026, 8, 20))).toBe('2026-09-20');
  });

  it('addDays crosses month and year boundaries', () => {
    expect(iso(addDays('2026-09-20', 1))).toBe('2026-09-21');
    expect(iso(addDays('2026-12-31', 1))).toBe('2027-01-01');
    expect(iso(addDays('2026-03-01', -1))).toBe('2026-02-28');
  });

  it('daysBetween counts whole days', () => {
    expect(daysBetween('2026-09-20', '2026-09-27')).toBe(7);
    expect(daysBetween('2026-09-20', '2026-09-20')).toBe(0);
  });

  it('weeksBetween returns fractional weeks', () => {
    expect(weeksBetween('2026-09-20', '2026-10-18')).toBeCloseTo(4, 5);
  });

  it('startOfWeekMonday returns the Monday of the containing week', () => {
    expect(iso(startOfWeekMonday('2026-09-20'))).toBe('2026-09-14'); // Sunday → prior Monday
    expect(iso(startOfWeekMonday('2026-09-14'))).toBe('2026-09-14'); // Monday → itself
  });
});

describe('weeksBetween across DST (sim catch 2026-07-17)', () => {
  it('counts calendar weeks, not raw milliseconds', () => {
    expect(weeksBetween('2026-01-05', '2026-04-06')).toBe(13); // spans spring-forward
    expect(weeksBetween('2026-10-05', '2026-11-02')).toBe(4);  // spans fall-back
  });
});

/* daysBetween used to round an instant against local midnight, so a bare
   `new Date()` start came out one day short from ~noon onward (race-chip
   catch 2026-07-30). It now pins both ends to local midnight internally, so
   the iso() form and the raw-Date form agree on the calendar answer at any
   time of day — these pin that agreement under an afternoon clock, the exact
   condition the original miscount needed. */
describe('daysBetween under an afternoon clock (race-chip catch 2026-07-30)', () => {
  afterEach(() => vi.useRealTimers());

  it('race-eve afternoon: 1 day to go, iso() start or raw Date alike', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 19, 15, 30)); // eve of a 2026-09-20 race
    expect(daysBetween(iso(new Date()), '2026-09-20')).toBe(1);
    expect(daysBetween(new Date(), '2026-09-20')).toBe(1); // the closed trap
  });

  it('race-day afternoon: 0 either way (mid-race is not post-race)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 20, 14, 0));
    expect(daysBetween(iso(new Date()), '2026-09-20')).toBe(0);
    expect(daysBetween(new Date(), '2026-09-20')).toBe(0); // the closed trap
  });

  it('mornings agree either way — why the original miscount hid in testing', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 19, 9, 0));
    expect(daysBetween(iso(new Date()), '2026-09-20')).toBe(1);
    expect(daysBetween(new Date(), '2026-09-20')).toBe(1);
  });

  it('raw clock instants at BOTH ends now count calendar days (23:45 vs 00:10 is one day)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 19, 23, 45));
    expect(daysBetween(new Date(), new Date(2026, 8, 20, 0, 10))).toBe(1);
  });
});
