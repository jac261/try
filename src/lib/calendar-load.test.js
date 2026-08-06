import { describe, it, expect } from 'vitest';
import { weekLoad, dayLedger, loadOf } from './calendar-load.js';
import { estimateTss } from './adapt.js';

/* The week's ledger. Every case here is a way of counting one ride twice, or
   of pricing a session off the wrong thing — the two failure modes the
   calendar had before this existed. */

const MON = '2026-07-06';
const DATES = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12'];

const sess = (id, over = {}) => ({ id, date: MON, discipline: 'bike', type: 'Endurance', title: 'Endurance Ride', durationMin: 60, ...over });
const act = (id, over = {}) => ({ id, date: MON, type: 'Ride', name: 'Ride', movingTimeSec: 3600, trainingLoad: 70, ...over });
const week = over => weekLoad({ dates: DATES, byDate: {}, activities: [], log: {}, moves: {}, easedOf: w => w, ...over });
const on = (date, arr) => ({ [date]: arr });

describe('a session claimed by its recording', () => {
  it('counts the recording once, not the recording plus the plan estimate', () => {
    const w = sess('w1');
    const r = week({ byDate: on(MON, [w]), activities: [act('a1')], log: { w1: { done: true } } });
    expect(r.doneTss).toBe(70);                       // not 70 + 49
    expect(r.days[MON].sessions[0].measured).toBe(true);
    expect(r.days[MON].sessions[0].tss).toBe(70);
    expect(r.days[MON].unclaimed).toEqual([]);
    expect(r.plannedTss).toBe(Math.round(estimateTss(w)));
  });

  it('takes its minutes from the recording, not from the plan', () => {
    const r = week({ byDate: on(MON, [sess('w1')]), activities: [act('a1', { movingTimeSec: 5400 })], log: { w1: { done: true } } });
    expect(r.doneMin).toBe(90);
    expect(r.plannedMin).toBe(60);
  });
});

describe('a session nobody has ticked', () => {
  it('leaves the recording unclaimed and keeps its own planned number', () => {
    /* THE central double-count. ownerFor requires a tick, so an unticked
       session must not take the recording's number — ask recordingFor
       instead (no tick requirement) and the week bills you twice: once as
       the session, once as unclaimed work. */
    const w = sess('w1');
    const r = week({ byDate: on(MON, [w]), activities: [act('a1')], log: {} });
    expect(r.doneTss).toBe(70);                       // the recording alone
    expect(r.days[MON].unclaimed).toHaveLength(1);
    expect(r.days[MON].sessions[0].measured).toBe(false);
    expect(r.days[MON].sessions[0].tss).toBe(Math.round(estimateTss(w)));
  });
});

describe('two rides inside one session window', () => {
  it('counts both, once each, and the session shows the one that claimed it', () => {
    const r = week({
      byDate: on(MON, [sess('w1')]),
      activities: [act('a1', { movingTimeSec: 3600, trainingLoad: 70 }), act('a2', { movingTimeSec: 3300, trainingLoad: 50 })],
      log: { w1: { done: true } },
    });
    // nearest duration wins the claim; the other is its own work
    expect(r.days[MON].sessions[0].tss).toBe(70);
    expect(r.days[MON].unclaimed.map(u => u.activity.id)).toEqual(['a2']);
    expect(r.doneTss).toBe(120);
  });
});

describe('a brick', () => {
  const brick = sess('b1', { discipline: 'brick', durationMin: 90 });
  const legs = [
    act('r1', { movingTimeSec: 3600, trainingLoad: 60, startedAt: '2026-07-06T08:00:00Z', deviceName: 'w' }),
    act('r2', { type: 'Run', movingTimeSec: 1800, trainingLoad: 30, startedAt: '2026-07-06T09:10:00Z', deviceName: 'w' }),
  ];

  it('counts its two legs once, as one session', () => {
    const r = week({ byDate: on(MON, [brick]), activities: legs, log: { b1: { done: true } } });
    expect(r.doneTss).toBe(90);
    expect(r.days[MON].unclaimed).toEqual([]);
    expect(r.days[MON].sessions[0].measured).toBe(true);
  });

  it('will not take a hand-typed entry as one of its legs', () => {
    /* brickPairFor is fed the FEED, not the display list. A typed run beside
       a recorded ride would otherwise fold a number nobody measured into a
       pair presented as one session, and the typed entry would vanish from
       the day it was entered on. */
    const typedRun = act('m1', { type: 'Run', movingTimeSec: 1800, trainingLoad: 30, manual: true, estimated: true });
    const r = week({ byDate: on(MON, [brick]), activities: [legs[0], typedRun], log: { b1: { done: true } } });
    expect(r.days[MON].sessions[0].recording).toBe(null);
    // and with no pair to be had, the lone ride is its own work too
    expect(r.days[MON].unclaimed.map(u => u.activity.id).sort()).toEqual(['m1', 'r1']);
  });

  it('claims its legs before any other session can', () => {
    /* Ordering, not luck: a ticked ride session on the same day would
       otherwise re-claim the ride half and the day would bill it twice. */
    const ride = sess('w2', { durationMin: 60 });
    const r = week({ byDate: on(MON, [brick, ride]), activities: legs, log: { b1: { done: true }, w2: { done: true } } });
    expect(r.doneTss).toBe(90 + Math.round(estimateTss(ride)));   // the ride session falls back to its estimate
    expect(r.days[MON].unclaimed).toEqual([]);
  });
});

describe('work that was never in the plan', () => {
  it('counts, with the number the provider measured', () => {
    const r = week({ byDate: {}, activities: [act('a1', { trainingLoad: 103 })] });
    expect(r.doneTss).toBe(103);
    expect(r.plannedTss).toBe(0);
    expect(r.days[MON].unclaimed[0].measured).toBe(true);
    expect(r.estimated).toBe(false);
  });

  it('falls back to a duration estimate when the provider sent no load, and says so', () => {
    const r = week({ byDate: {}, activities: [act('a1', { trainingLoad: null, movingTimeSec: 3600 })] });
    expect(r.doneTss).toBe(Math.round(estimateTss({ durationMin: 60 })));   // 49, discipline-blind
    expect(r.estimated).toBe(true);
    expect(r.days[MON].unclaimed[0].measured).toBe(false);
  });

  it('a hand-typed diary entry stands only for itself, always as an estimate', () => {
    const typed = act('m1', { manual: true, estimated: true, trainingLoad: 45 });
    const r = week({ byDate: on(MON, [sess('w1')]), activities: [typed], log: { w1: { done: true } } });
    expect(r.days[MON].sessions[0].measured).toBe(false);            // never claimed by the session
    expect(r.days[MON].unclaimed.map(u => u.activity.id)).toEqual(['m1']);
    expect(r.estimated).toBe(true);
  });

  it('ignores what the calendar itself would not render', () => {
    // an unmapped type or a zero-duration file appears on no row, so it may
    // not appear in a total either
    const r = week({ byDate: {}, activities: [act('a1', { type: 'Walk' }), act('a2', { movingTimeSec: 0 })] });
    expect(r.doneTss).toBe(0);
    expect(r.days[MON].unclaimed).toEqual([]);
  });
});

describe('the totals', () => {
  it('price the plan through the eased overlay, exactly once', () => {
    /* The calendar eases the workout it hands in, the way it eases the row it
       draws. Passing adj as well would apply 0.65 twice. */
    const w = sess('w1');
    const eased = { ...w, durationMin: 39, type: 'Easy', eased: true };
    const r = week({ byDate: on(MON, [w]), easedOf: () => eased });
    expect(r.plannedTss).toBe(Math.round(estimateTss(eased)));
    expect(r.plannedMin).toBe(39);
  });

  it('let done exceed planned without comment', () => {
    // an ordinary week: two extra rides is not an error state
    const r = week({
      byDate: on(MON, [sess('w1', { durationMin: 30 })]),
      activities: [act('a1', { trainingLoad: 100 }), act('a2', { trainingLoad: 100 })],
      log: {},
    });
    expect(r.doneTss).toBeGreaterThan(r.plannedTss);
    expect(r.doneTss).toBe(200);
  });

  it('equal the sum of the rows beneath them, on a mixed week', () => {
    /* The net that pays for its fixture: matched-and-ticked, unticked with a
       recording, unplanned, and a manual entry, all in one week. */
    const r = weekLoad({
      dates: DATES,
      byDate: {
        '2026-07-06': [sess('w1')],
        '2026-07-07': [sess('w2', { date: '2026-07-07' })],
        '2026-07-08': [sess('w3', { date: '2026-07-08' })],
      },
      activities: [
        act('a1'),                                                        // claims w1 (ticked)
        act('a2', { date: '2026-07-07' }),                                // w2 unticked → unclaimed
        act('a3', { date: '2026-07-09', trainingLoad: 33 }),              // unplanned
        act('m1', { date: '2026-07-10', manual: true, estimated: true, trainingLoad: 20 }),
      ],
      log: { w1: { done: true }, w3: { done: true } },                    // w3 ticked, no recording
      moves: {}, easedOf: w => w,
    });
    const rowSum = DATES.reduce((s, d) => s
      + r.days[d].sessions.filter(x => x.done).reduce((t, x) => t + x.tss, 0)
      + r.days[d].unclaimed.reduce((t, x) => t + x.tss, 0), 0);
    expect(r.doneTss).toBe(rowSum);
    expect(r.plannedTss).toBe(DATES.reduce((s, d) => s + r.days[d].sessions.reduce((t, x) => t + Math.round(estimateTss(x.shown)), 0), 0));
  });
});

describe('dayLedger and loadOf', () => {
  it('a day with no recordings still returns every session', () => {
    const { rows, unclaimed } = dayLedger({ date: MON, sessions: [sess('w1')], activities: [], log: {}, moves: {} });
    expect(rows).toHaveLength(1);
    expect(rows[0].recording).toBe(null);
    expect(unclaimed).toEqual([]);
  });

  it('an estimated provider load is not a measurement', () => {
    expect(loadOf({ trainingLoad: 40, estimated: true }).measured).toBe(false);
    expect(loadOf({ trainingLoad: 40 }).measured).toBe(true);
    expect(loadOf(null).tss).toBe(0);
  });
});
