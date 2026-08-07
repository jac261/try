// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: () => {} }),
  useUser: () => ({ user: { imageUrl: null, fullName: 'T' } }),
  SignOutButton: ({ children }) => children || null,
}));
import { readFileSync } from 'node:fs';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { App } from '@/app/App.jsx';
import { storageForUser } from '@/app/storage.js';
import { generatePlan } from '@/lib/plan.js';
import { iso, addDays, startOfWeekMonday } from '@/lib/date.js';

/* The moves seam. mergeMoves (sync.js) was written for the 2026-07-12
   "workouts moved without me" report, imported, and never called: hydrate
   kept using mergeOverlay, which pushes ANY cached local-only move back up,
   and because workout ids are reused across regenerations a stale one lands
   cleanly on the wrong session. Symmetrically, pendingMoves had no producer
   at all, so the apparatus meant to carry an offline move to the server was
   consuming a map nothing ever wrote to (calendar audit, 2026-08-06).

   These drive the real App: a real hydrate over a mocked fetch, and a real
   reschedule through the detail sheet's day picker. */

const mon = iso(startOfWeekMonday(new Date()));
const profile = {
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: iso(addDays(mon, -28)), raceDate: iso(addDays(mon, 8 * 7)),
};

/* The two producer tests below reach through the UI: they open a session on
   the Today view and move it with the day picker. That needs today to HAVE a
   session, and the profile above trains five days a week — so the pair passed
   on the Thursday they were written and failed on the Friday, with no source
   change, because Friday is not in trainingDays. A plan that trains every day
   removes the calendar from the test; the seven tests that exercise hydrate
   and the merge keep the five-day profile, which is the realistic shape and
   the one their assertions are written against. */
const everyDay = { ...profile, trainingDays: [0, 1, 2, 3, 4, 5, 6], daysPerWeek: 7 };

const recordFetch = routes => {
  const calls = [];
  globalThis.fetch = (url, opts) => {
    let body = null;
    try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) { body = opts && opts.body; }
    calls.push({ method: (opts && opts.method) || 'GET', url: String(url), body });
    const r = routes(String(url), (opts && opts.method) || 'GET');
    return Promise.resolve(new Response(r !== undefined ? JSON.stringify(r) : 'null',
      { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
  return calls;
};
const moveCalls = calls => calls.filter(c => /\/move$/.test(c.url));

const serverPlanResponse = (plan, id, moves = []) => ({
  id,
  profile: plan.profile, race: plan.race, createdAt: plan.createdAt,
  updatedAt: plan.updatedAt || plan.createdAt, totalWeeks: plan.totalWeeks, paces: plan.paces,
  weeks: plan.weeks.map(w => ({
    index: w.index, phase: w.phase, isRecovery: w.isRecovery, start: w.start, totalMin: w.totalMin,
    workouts: w.workouts.map(wo => ({ ...wo, id: 'guid-' + wo.id, clientWorkoutRef: wo.id })),
  })),
  moves,
});

const PAST_SPLASH_HOLD_MS = 4600;
const mountApp = async storage => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<App storage={storage} getToken={async () => 'tok'} user={{ imageUrl: null }} />);
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(PAST_SPLASH_HOLD_MS); });
  if (el.querySelector('.splash')) throw new Error('splash still up');
  return { el, root, done: () => { root.unmount(); el.remove(); } };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  localStorage.clear();
  globalThis.confirm = () => true;
});
afterEach(() => { vi.useRealTimers(); });

describe('hydrate: the server owns the moves', () => {
  it('drops a cached move the server does not have, and does not push it back', async () => {
    /* THE regression test. mergeOverlay kept every cached local-only move and
       pushed it; after a plan replace on another device those ids point at
       different sessions, so the athlete finds a session moved they never
       touched. The strict rule: no pending entry, no claim. */
    const plan = generatePlan(profile);
    const w = plan.weeks[0].workouts.find(x => x.discipline !== 'rest' && !x.race);
    const storage = storageForUser('mv-drop');
    storage.save('plan', plan);
    storage.save('moves', { [w.id]: iso(addDays(w.date, 2)) });   // cached, never synced

    const calls = recordFetch((u, m) => {
      if (u.endsWith('/api/plans/current') && m === 'GET') return serverPlanResponse(plan, 'guid-A');
      return {};
    });
    const app = await mountApp(storage);
    expect(storage.load('moves', null)).toEqual({});
    expect(moveCalls(calls)).toHaveLength(0);
    app.done();
  }, 20000);

  it('keeps a move the server does have', async () => {
    // the other half: strictness must not mean amnesia
    const plan = generatePlan(profile);
    const w = plan.weeks[0].workouts.find(x => x.discipline !== 'rest' && !x.race);
    const moved = iso(addDays(w.date, 1));
    const storage = storageForUser('mv-keep');
    storage.save('plan', plan);
    recordFetch((u, m) => {
      if (u.endsWith('/api/plans/current') && m === 'GET') {
        return serverPlanResponse(plan, 'guid-A', [{ clientWorkoutRef: w.id, movedDate: moved }]);
      }
      return {};
    });
    const app = await mountApp(storage);
    expect(storage.load('moves', null)[w.id]).toBe(moved);
    app.done();
  }, 20000);

  it('re-pushes a pending move the server has not seen, and forks an un-move to DELETE', async () => {
    /* The producer's whole point: a write made offline or while a plan push
       was in flight survives to the next hydrate. The un-move must route to
       DELETE — mergeOverlay's single-shape callback would PUT a null date. */
    const plan = generatePlan(profile);
    const ws = plan.weeks[0].workouts.filter(x => x.discipline !== 'rest' && !x.race);
    const target = iso(addDays(ws[0].date, 1));
    const storage = storageForUser('mv-pend');
    storage.save('plan', plan);
    storage.save('pendingMoves', {
      [ws[0].id]: { date: target, base: ws[0].date },
      [ws[1].id]: { date: null, base: ws[1].date },
    });
    // the server still holds the move the athlete undid offline
    const calls = recordFetch((u, m) => {
      if (u.endsWith('/api/plans/current') && m === 'GET') {
        return serverPlanResponse(plan, 'guid-A', [{ clientWorkoutRef: ws[1].id, movedDate: iso(addDays(ws[1].date, 3)) }]);
      }
      return {};
    });
    const app = await mountApp(storage);
    const puts = moveCalls(calls).filter(c => c.method === 'PUT');
    const dels = moveCalls(calls).filter(c => c.method === 'DELETE');
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toContain('guid-' + ws[0].id);
    expect(puts[0].body.movedDate).toBe(target);
    expect(dels).toHaveLength(1);
    expect(dels[0].url).toContain('guid-' + ws[1].id);
    // and the un-move won locally
    expect(storage.load('moves', null)[ws[1].id]).toBeUndefined();
    app.done();
  }, 20000);

  it('drops a pending move whose workout has moved off its recorded base date', async () => {
    /* The base guard, checked against the ADOPTED plan: the structure changed
       under this write (possibly on another device), so the move must not
       cross onto whatever now holds that id. Checking the CACHED plan instead
       would compare the move to the world it was already made in. */
    const plan = generatePlan(profile);
    const w = plan.weeks[0].workouts.find(x => x.discipline !== 'rest' && !x.race);
    const storage = storageForUser('mv-base');
    storage.save('plan', plan);
    storage.save('pendingMoves', { [w.id]: { date: iso(addDays(w.date, 2)), base: w.date } });

    // the server's copy of that workout sits on a different day now
    const reshaped = JSON.parse(JSON.stringify(plan));
    const rw = reshaped.weeks[0].workouts.find(x => x.id === w.id);
    rw.date = iso(addDays(w.date, 1));
    const calls = recordFetch((u, m) => {
      if (u.endsWith('/api/plans/current') && m === 'GET') return serverPlanResponse(reshaped, 'guid-A');
      return {};
    });
    const app = await mountApp(storage);
    expect(moveCalls(calls)).toHaveLength(0);
    expect(storage.load('moves', null)).toEqual({});
    app.done();
  }, 20000);
});

describe('moveWorkout: the producer nobody had', () => {
  const openFirstSession = el => {
    const row = [...el.querySelectorAll('.wk')].find(r => r.querySelector('.t') && !r.textContent.includes('Rest day'));
    act(() => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    return el.querySelector('.days');
  };

  it('records the move with the workout SCHEDULED date as its base', async () => {
    /* base is w.date, never the effective date: both consumers compare
       against baseDates' map, so a base that travelled with the overlay
       would void its own entry at the first check. */
    const plan = generatePlan(everyDay);
    const storage = storageForUser('mv-prod');
    storage.save('plan', plan);
    const calls = recordFetch((u, m) => {
      if (u.endsWith('/api/plans/current') && m === 'GET') return serverPlanResponse(plan, 'guid-A');
      return {};
    });
    const app = await mountApp(storage);

    const days = openFirstSession(app.el);
    expect(days).not.toBe(null);
    const cells = [...days.querySelectorAll('.d')].filter(c => !c.classList.contains('on') && !c.classList.contains('off'));
    await act(async () => { cells[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    const pending = storage.load('pendingMoves', {});
    const ids = Object.keys(pending);
    expect(ids).toHaveLength(1);
    const entry = pending[ids[0]];
    const w = plan.weeks.flatMap(k => k.workouts).find(x => x.id === ids[0]);
    expect(entry.base).toBe(w.date);              // scheduled, not effective
    expect(entry.date).toBe(storage.load('moves', {})[ids[0]]);
    // and the optimistic push still went, unchanged by the producer
    const puts = moveCalls(calls).filter(c => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].body.movedDate).toBe(entry.date);
    app.done();
  }, 20000);
  it('keeps the base fixed when a session is moved a second time', async () => {
    /* The mutation the single-move case cannot see: base must stay the
       SCHEDULED date across re-moves. Take it from the overlay instead and
       the second entry records the first move's date, which the base guard
       then compares against the plan and drops — the write is silently
       voided at the next hydrate. */
    const plan = generatePlan(everyDay);
    const storage = storageForUser('mv-twice');
    storage.save('plan', plan);
    recordFetch((u, m) => {
      if (u.endsWith('/api/plans/current') && m === 'GET') return serverPlanResponse(plan, 'guid-A');
      return {};
    });
    const app = await mountApp(storage);

    const days = openFirstSession(app.el);
    const free = () => [...app.el.querySelectorAll('.days .d')].filter(c => !c.classList.contains('on'));
    await act(async () => { free()[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const id = Object.keys(storage.load('pendingMoves', {}))[0];
    const w = plan.weeks.flatMap(k => k.workouts).find(x => x.id === id);
    const firstDate = storage.load('pendingMoves', {})[id].date;

    // and again, to a different day
    const next = free().find(c => Number(c.textContent.replace(/\D/g, '')) !== Number(firstDate.slice(8)));
    await act(async () => { next.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    const entry = storage.load('pendingMoves', {})[id];
    expect(entry.date).not.toBe(firstDate);      // it really did move again
    expect(entry.base).toBe(w.date);             // and the base never moved
    app.done();
  }, 20000);
});

describe('the clear sites', () => {
  /* Source-walked, the repo's idiom for load-bearing wiring: driving a
     reshape end to end through a mounted App costs far more than the thing
     it would prove, and the risk here is a line quietly going missing. */
  const app = readFileSync('src/app/App.jsx', 'utf8');
  const between = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));

  it('hydrate uses the strict merge, not the overlay', () => {
    expect(app).toMatch(/mergeMoves\(result\.moves/);
    expect(app).not.toMatch(/mergeOverlay\(result\.moves/);
  });

  it('a reshape and a removed workout take their pending writes with them', () => {
    expect(between('const reshapePlan = ', 'setRefToId({})')).toContain('setPendingMoves({})');
    expect(between('const removeWorkout = ', 'sync.replacePlan')).toContain('setPendingMoves(');
  });

  it('starting over resets pending moves in state, as its own comment demands', () => {
    expect(between('storage.clear();', 'setPlan(null)')).toContain('setPendingMoves({})');
  });
});
