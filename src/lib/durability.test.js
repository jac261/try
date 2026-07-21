// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { durabilityRead, durabilityTrend, planBodySteady, DURABILITY_GATES, DURABILITY_BAND_LABELS } from './durability.js';
import { decideWeek } from './coach.js';
import { generatePlan } from './plan.js';
import { storageForUser } from '@/app/storage.js';
import { iso } from './date.js';

/* Durability, coach brain pass 2: every fixture pins a design-panel catch
   verified against real recordings (time weighting, embedded stops,
   scripted finishes). */

// A steady 3-hour ride: 12 laps, 900s each, ~200W, HR climbing gently.
const steadyRide = (n = 12, mut = () => ({})) => Array.from({ length: n }, (_, i) => ({
  type: 'WORK', movingTimeSec: 900, distance: 7500, averageSpeed: 8.33,
  averageWatts: 200, averageHeartrate: 140 + i * 0.5, ...mut(i),
}));

describe('durabilityRead gates', () => {
  it('needs a long session, enough laps, enough coverage', () => {
    expect(durabilityRead({ rows: steadyRide(), discipline: 'bike', movingTimeSec: 40 * 60 })).toBe(null);
    expect(durabilityRead({ rows: steadyRide(4), discipline: 'bike', movingTimeSec: 3 * 3600 })).toBe(null);
    // 12 laps of 900s = 3h of laps, but claim a 5h session: coverage fails
    expect(durabilityRead({ rows: steadyRide(), discipline: 'bike', movingTimeSec: 5 * 3600 })).toBe(null);
    expect(durabilityRead({ rows: steadyRide(), discipline: 'bike', movingTimeSec: 3 * 3600 })).toBeTruthy();
  });

  it('the sprint tier\'s own long sessions clear the gates', () => {
    // sprint long run 55min, long ride 70min: both must be readable
    expect(DURABILITY_GATES.run.minMovingSec).toBeLessThanOrEqual(55 * 60);
    expect(DURABILITY_GATES.bike.minMovingSec).toBeLessThanOrEqual(70 * 60);
  });
});

describe('the metrics', () => {
  it('a steady ride reads held strong with gentle drift', () => {
    const r = durabilityRead({ rows: steadyRide(), discipline: 'bike', movingTimeSec: 3 * 3600 });
    expect(r.band).toBe('held-strong');
    expect(Math.abs(r.outputDropPct)).toBeLessThan(1);
    expect(r.hrDriftPct).toBeGreaterThan(0);
    expect(r.efDropPct).not.toBe(null);
  });

  it('a fading ride reads its drop through time-weighted windows', () => {
    // final third at 170W vs 200W: ~15% drop -> faded hard
    const rows = steadyRide(12, i => (i >= 8 ? { averageWatts: 170 } : {}));
    const r = durabilityRead({ rows, discipline: 'bike', movingTimeSec: 3 * 3600 });
    expect(r.outputDropPct).toBeGreaterThan(10);
    expect(r.band).toBe('faded-hard');
  });

  it('an embedded stop lap is filtered out instead of poisoning a window (verified live pattern)', () => {
    // lap 9 collapses to half speed (a mid-session stop inside one auto-lap)
    const rows = steadyRide(12, i => (i === 9 ? { averageSpeed: 4.0, distance: 3600, averageHeartrate: 120 } : {}));
    const clean = durabilityRead({ rows: steadyRide(), discipline: 'bike', movingTimeSec: 3 * 3600 });
    const dirty = durabilityRead({ rows, discipline: 'bike', movingTimeSec: 3 * 3600 });
    expect(dirty).toBeTruthy();
    expect(dirty.band).toBe(clean.band); // the stop must not change the verdict
  });

  it('run output is distance over time per window, and a fading run reads honestly', () => {
    const runLap = (speed, i) => ({ type: 'WORK', movingTimeSec: 300, distance: speed * 300, averageSpeed: speed, averageHeartrate: 150 + i });
    const rows = Array.from({ length: 12 }, (_, i) => runLap(i >= 8 ? 2.7 : 3.0, i));
    const r = durabilityRead({ rows, discipline: 'run', movingTimeSec: 60 * 60 });
    expect(r.outputDropPct).toBeGreaterThan(5);
    expect(['faded-a-little', 'faded-hard']).toContain(r.band);
  });

  it('efficiency needs both signals on the same laps, enough of them per window', () => {
    // HR present only on two early laps: EF must stay null, siblings still read
    const rows = steadyRide(12, i => (i > 1 ? { averageHeartrate: null } : {}));
    const r = durabilityRead({ rows, discipline: 'bike', movingTimeSec: 3 * 3600 });
    expect(r).toBeTruthy();
    expect(r.efDropPct).toBe(null);
  });

  it('a window dominated by one lap voids the read', () => {
    const rows = steadyRide(6).concat([{ type: 'WORK', movingTimeSec: 5400, distance: 45000, averageSpeed: 8.33, averageWatts: 195, averageHeartrate: 150 }]);
    expect(durabilityRead({ rows, discipline: 'bike', movingTimeSec: 3 * 3600 })).toBe(null);
  });
});

describe('planBodySteady', () => {
  const p = generatePlan({
    name: 'D', raceType: 'half', fitness: 'intermediate',
    fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
    daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 5,
    startDate: '2026-06-01', raceDate: '2026-11-15',
  });
  const longs = p.weeks.flatMap(w => w.workouts).filter(x => x.role === 'long' && x.discipline === 'run');

  it('steady long runs qualify; scripted fast finishes and tired-legs variants never do', () => {
    const steady = longs.filter(x => planBodySteady(x));
    const scripted = longs.filter(x => !planBodySteady(x));
    expect(steady.length).toBeGreaterThan(0);
    // the durability/fast-finish variants exist in Build/Peak and are excluded
    expect(scripted.length).toBeGreaterThan(0);
    scripted.forEach(x => {
      const zones = new Set();
      x.segments.forEach(s => { if (s.zone) zones.add(s.zone); (s.blocks || []).forEach(b => zones.add(b.zone)); });
      expect(zones.size).toBeGreaterThan(1);
    });
  });

  it('an unplanned recording qualifies by default (no card scripted a change)', () => {
    expect(planBodySteady(null)).toBe(true);
  });
});

describe('trend and labels', () => {
  const e = band => ({ read: { band } });
  it('speaks only with four or more reads, so one session cannot flip it', () => {
    expect(durabilityTrend([e('held-strong'), e('held-strong'), e('faded-hard')])).toBe(null);
    expect(durabilityTrend([e('held-strong'), e('held-strong'), e('faded-hard'), e('faded-hard')])).toMatch(/holding together better/);
    expect(durabilityTrend([e('faded-hard'), e('faded-hard'), e('held-strong'), e('held-strong')])).toMatch(/fading earlier/);
    expect(durabilityTrend([e('faded-a-little'), e('faded-a-little'), e('faded-a-little'), e('faded-a-little')])).toMatch(/steady pattern/);
  });

  it('band labels pass the copy rules', () => {
    Object.values(DURABILITY_BAND_LABELS).forEach(s => {
      expect(s).not.toMatch(/—/);
      expect(s).not.toMatch(/\b[A-Z]{3,}\b/);
    });
  });
});

describe('the coach evidence line never changes a decision', () => {
  const profile = {
    name: 'C', raceType: 'olympic', fitness: 'intermediate',
    fivekSec: 1500, css100Sec: 145, ftp: 300, weightKg: 75,
    daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 5,
    startDate: '2026-06-01', raceDate: '2026-09-27',
  };
  const plan = generatePlan(profile);
  const wk = plan.weeks.find(w => !w.isRecovery && w.index >= 2);
  const log = Object.fromEntries(wk.workouts.filter(x => x.discipline !== 'rest' && !x.race).map(x => [x.id, { done: true }]));
  const args = {
    plan, log, moves: {}, adjust: {}, adjustLog: [], wellness: [], activities: [], missedReasons: {},
    todayISO: iso(new Date(new Date(wk.start + 'T00:00:00Z').getTime() + 8 * 864e5)), weekMonday: wk.start, prevWeeks: [],
  };
  it('adds the line as evidence only', () => {
    const withoutRead = decideWeek(args);
    const withRead = decideWeek({ ...args, durabilityByDiscipline: { run: { read: { band: 'faded-hard' } } } });
    expect(withRead.disciplines.run.decision).toBe(withoutRead.disciplines.run.decision);
    expect(withRead.overall.decision).toBe(withoutRead.overall.decision);
    expect(withRead.disciplines.run.evidence.some(e => e.signal === 'late-session durability')).toBe(true);
    expect(withoutRead.disciplines.run.evidence.some(e => e.signal === 'late-session durability')).toBe(false);
  });
});

describe('the durability store', () => {
  it('upserts by activity id, caps at 40, sorted by date', () => {
    localStorage.clear();
    const st = storageForUser('du-test');
    for (let i = 0; i < 45; i++) {
      st.saveDurabilityRead({ activityId: 'a' + i, date: '2026-01-' + String((i % 28) + 1).padStart(2, '0'), discipline: 'run', durationMin: 60, read: null });
    }
    const list = st.loadDurability();
    expect(list.length).toBe(40);
    // upsert replaces, never duplicates
    st.saveDurabilityRead({ activityId: 'a44', date: '2026-02-01', discipline: 'run', durationMin: 61, read: null });
    expect(st.loadDurability().filter(e => e.activityId === 'a44').length).toBe(1);
    // survives clear(): a read is a fact about a past recording, not plan state
    st.clear();
    expect(st.loadDurability().length).toBe(40);
  });
});

describe('gauntlet fixes', () => {
  const ride = (n = 12, mut = () => ({})) => Array.from({ length: n }, (_, i) => ({
    type: 'WORK', movingTimeSec: 900, distance: 7500, averageSpeed: 8.33,
    averageWatts: 200, averageHeartrate: 140 + i * 0.5, startTimeSec: i * 920, ...mut(i),
  }));

  it('a reversed lap array reads identically: time order comes from startTimeSec', () => {
    const fading = ride(12, i => (i >= 8 ? { averageWatts: 170 } : {}));
    const forward = durabilityRead({ rows: fading, discipline: 'bike', movingTimeSec: 3 * 3600 });
    const reversed = durabilityRead({ rows: [...fading].reverse(), discipline: 'bike', movingTimeSec: 3 * 3600 });
    expect(forward.band).toBe('faded-hard');
    expect(reversed.band).toBe(forward.band);
    expect(reversed.outputDropPct).toBe(forward.outputDropPct);
  });

  it('an out-and-back with a slow half survives the true median', () => {
    // 6 climbing laps at 5.5 and 6 descending at 10: all legitimate riding
    const rows = Array.from({ length: 12 }, (_, i) => ({
      type: 'WORK', movingTimeSec: 900, distance: (i < 6 ? 5.5 : 10) * 900,
      averageSpeed: i < 6 ? 5.5 : 10, averageWatts: 200, averageHeartrate: 145, startTimeSec: i * 920,
    }));
    expect(durabilityRead({ rows, discipline: 'bike', movingTimeSec: 3 * 3600 })).not.toBe(null);
  });

  it('a read without heart rate says so instead of quietly reading strong', () => {
    const rows = ride(12, () => ({ averageHeartrate: null }));
    const r = durabilityRead({ rows, discipline: 'bike', movingTimeSec: 3 * 3600 });
    expect(r.hrMissing).toBe(true);
    expect(r.hrDriftPct).toBe(null);
  });

  it('efficiency decay alone can move the band', () => {
    // watts held level, HR climbing 12%: EF drops even though output holds
    const rows = ride(12, i => ({ averageHeartrate: 140 + (i >= 8 ? 17 : 0) }));
    const r = durabilityRead({ rows, discipline: 'bike', movingTimeSec: 3 * 3600 });
    expect(r.efDropPct).toBeGreaterThan(5);
    expect(r.band).not.toBe('held-strong');
  });

  it('a brick is judged by its bike leg, not the whole two-sport card', () => {
    const brick = { segments: [
      { label: 'Bike — steady', zone: 'Z2' },
      { label: 'T2 — quick transition' },
      { label: 'Run off the bike — negative split', zone: 'Z3' },
    ] };
    expect(planBodySteady(brick)).toBe(false);        // whole card mixes zones
    expect(planBodySteady(brick, 'bike')).toBe(true); // the leg being read is steady
  });
});
