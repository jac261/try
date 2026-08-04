// @vitest-environment happy-dom
/* The durability backfill through a MOUNTED App, guards and all (hydrated,
   fetchesSettled, busy, done). This seam went uncrossed from #53 to #56:
   every unit test imported durability-shape.js directly, the harness charts
   are hand-set fixtures, and `import * as T` turns a missing barrel export
   into a silent undefined whose throw dies as an unhandled rejection inside
   the effect's async body. The result was a feature whose engine never
   reached a shipped bundle, found only when Jon's charts refused to appear
   for the third time (2026-08-04). If this fails with "durabilityShape is
   not a function", the barrel lost the durability-shape line. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: () => {} }),
  useUser: () => ({ user: { imageUrl: null, fullName: 'T' } }),
  SignOutButton: ({ children }) => children || null,
}));
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { App } from '@/app/App.jsx';
import { storageForUser } from '@/app/storage.js';
import { generatePlan } from '@/lib/plan.js';

const profile = {
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: '2026-06-01', raceDate: '2026-08-30',
};

const recordFetch = routes => {
  const calls = [];
  globalThis.fetch = (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    calls.push({ method, url: String(url) });
    const r = routes(String(url), method);
    return Promise.resolve(new Response(r !== undefined ? JSON.stringify(r) : 'null', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
  return calls;
};

const serverPlanResponse = (plan, id) => ({
  id,
  profile: plan.profile, race: plan.race, createdAt: plan.createdAt,
  updatedAt: plan.updatedAt || plan.createdAt, totalWeeks: plan.totalWeeks, paces: plan.paces,
  weeks: plan.weeks.map(w => ({
    index: w.index, phase: w.phase, isRecovery: w.isRecovery, start: w.start, totalMin: w.totalMin,
    workouts: w.workouts.map(wo => ({ ...wo, id: 'guid-' + wo.id, clientWorkoutRef: wo.id })),
  })),
});

// WORK laps in the api.js compact row shape. Run: the 4 Aug run's rhythm at
// 58 min. Bike: 12 x 8 min with sagging watts, clearing the 65-min bike gate
// (a short bike refuses its READ, and a shape may not outlive its read).
const RUN_LAPS = Array.from({ length: 10 }, (_, i) => ({
  type: 'WORK', movingTimeSec: 340 + i * 2, distance: 1000,
  averageSpeed: 2.95 - i * 0.02, averageHeartrate: 145 + i, averageWatts: 300 - i * 3,
}));
const BIKE_LAPS = Array.from({ length: 12 }, (_, i) => ({
  type: 'WORK', movingTimeSec: 480, distance: 4000,
  averageSpeed: 8.3 - i * 0.05, averageHeartrate: 138 + i, averageWatts: 240 - i * 4,
}));

beforeEach(() => { localStorage.clear(); globalThis.confirm = () => true; });

describe('the sweep in a mounted App', () => {
  it('attaches shapes to stored pre-shape records, even ones outside plan and feed', async () => {
    const p = generatePlan(profile);
    const calls = recordFetch((u, m) => {
      if (u.endsWith('/api/plans/current') && m === 'GET') return serverPlanResponse(p, 'guid-SW');
      // the feed holds NEITHER pending activity: the unreachable class
      if (/intervals-icu\/activities\?/.test(u)) return [];
      if (/intervals-icu\/activities\/act-old-ride\/intervals/.test(u)) return BIKE_LAPS;
      if (/intervals-icu\/activities\/act-old-run\/intervals/.test(u)) return RUN_LAPS;
      return {};
    });
    const storage = storageForUser('sweeper');
    // records read under an EARLIER plan: verdict held, shape key absent;
    // plus one refusal that must remain final
    localStorage.setItem('try.user.sweeper.durability', JSON.stringify([
      { activityId: 'act-old-ride', date: '2026-05-10', discipline: 'bike', durationMin: 96, read: { band: 'held-strong' } },
      { activityId: 'act-refused', date: '2026-05-12', discipline: 'run', durationMin: 60, read: { band: 'held-strong' }, shape: null },
      { activityId: 'act-old-run', date: '2026-05-17', discipline: 'run', durationMin: 58, read: { band: 'faded' } },
    ]));

    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(<App storage={storage} getToken={async () => 'tok'} user={{ imageUrl: null }} />);
    });
    await act(async () => { await new Promise(r => setTimeout(r, 4600)); });
    await act(async () => { await new Promise(r => setTimeout(r, 400)); });

    const store = storage.loadDurability();
    const byId = Object.fromEntries(store.map(e => [e.activityId, e]));
    // both pending records were fetched and shaped
    expect(calls.filter(c => /act-old-(ride|run)\/intervals/.test(c.url)).length).toBe(2);
    expect('shape' in byId['act-old-ride']).toBe(true);
    expect('shape' in byId['act-old-run']).toBe(true);
    expect(byId['act-old-ride'].shape && byId['act-old-ride'].shape.points ? 'built' : 'refused').toBe('built');
    // verdicts preserved verbatim
    expect(byId['act-old-ride'].read.band).toBe('held-strong');
    expect(byId['act-old-run'].read.band).toBe('faded');
    // the refusal was never refetched
    expect(calls.some(c => /act-refused\/intervals/.test(c.url))).toBe(false);
    expect(byId['act-refused'].shape).toBe(null);
    root.unmount(); el.remove();
  }, 25000);
});
