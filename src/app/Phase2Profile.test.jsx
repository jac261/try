// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// SettingsView pulls Clerk hooks; the harness has no ClerkProvider, so give
// it inert stand-ins (the tests never assert on auth UI).
vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: () => {} }),
  useUser: () => ({ user: { imageUrl: null, fullName: 'T' } }),
  SignOutButton: ({ children }) => children || null,
}));
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { App } from '@/app/App.jsx';
import { storageForUser } from '@/app/storage.js';
import { generatePlan, buildTrackerPlan, trackerFromProfile } from '@/lib/plan.js';
import { iso, addDays } from '@/lib/date.js';

/* Phase 2 of docs/NO_PLAN_WORKFLOW.md, rebuilt around PLAN IDENTITY: the
   server GUID lives ON the plan (plan.serverId), deletes only ever target an
   id this device decided to end, and a server plan with any other id is
   always adopted. Every test here encodes one of the 2026-07-17 gauntlet
   hazards so none can quietly return. */

const profile = {
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: '2026-06-01', raceDate: '2026-08-30',
};
// the server's plan-independent SUBSET: no raceType/raceDate/startDate
const serverProfile = {
  name: 'T', fitness: 'intermediate', fivekSec: 1620, css100Sec: 120,
  ftp: 200, weightKg: 70, trainingDays: [0, 1, 3, 5, 6], longDay: 5,
  fitnessHistory: [],
};

// Record every request so assertions can inspect method, url AND body — a
// sentinel push is a body carrying race 'tracker' or weeks [], whatever the
// verb (gauntlet catch: a verb-only check missed POSTs).
const recordFetch = routes => {
  const calls = [];
  globalThis.fetch = (url, opts) => {
    let body = null;
    try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) { body = opts && opts.body; }
    const method = (opts && opts.method) || 'GET';
    calls.push({ method, url: String(url), body });
    const r = routes(String(url), method);
    if (r && r.__status) return Promise.resolve(new Response(JSON.stringify(r.body ?? null), { status: r.__status, headers: { 'Content-Type': 'application/json' } }));
    return Promise.resolve(new Response(r !== undefined ? JSON.stringify(r) : 'null', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
  return calls;
};
const pushedSentinel = calls => calls.some(c =>
  (c.method === 'POST' || c.method === 'PUT') && /\/api\/plans/.test(c.url)
  && c.body && (c.body.race === 'tracker' || (Array.isArray(c.body.weeks) && c.body.weeks.length === 0)));

const mountApp = async storage => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<App storage={storage} getToken={async () => 'tok'} user={{ imageUrl: null }} />);
  });
  // splash hold runs 4.2s (the tumbling mark); let it and hydration settle
  await act(async () => { await new Promise(r => setTimeout(r, 4600)); });
  return { el, root };
};

// a server plan response in the backend's wire shape (id + weeks of workouts)
const serverPlanResponse = (plan, id) => ({
  id,
  profile: plan.profile, race: plan.race, createdAt: plan.createdAt,
  updatedAt: plan.updatedAt || plan.createdAt, totalWeeks: plan.totalWeeks, paces: plan.paces,
  weeks: plan.weeks.map(w => ({
    index: w.index, phase: w.phase, isRecovery: w.isRecovery, start: w.start, totalMin: w.totalMin,
    workouts: w.workouts.map(wo => ({ ...wo, id: 'guid-' + wo.id, clientWorkoutRef: wo.id })),
  })),
});

beforeEach(() => {
  localStorage.clear();
  globalThis.confirm = () => true;
});

describe('plan identity (serverId on the plan object)', () => {
  it('hydrating a server plan stamps its GUID onto the local plan', async () => {
    const p = generatePlan(profile);
    const calls = recordFetch((u, m) => {
      if (u.endsWith('/api/plans/current') && m === 'GET') return serverPlanResponse(p, 'guid-A');
      return {};
    });
    const storage = storageForUser('p2id');
    const { el, root } = await mountApp(storage);
    expect(storage.load('plan', null).serverId).toBe('guid-A');
    expect(pushedSentinel(calls)).toBe(false);
    root.unmount(); el.remove();
  }, 20000);
});

describe('entering tracker (the end-plan flow)', () => {
  it('deletes exactly the stamped plan id, snapshots the profile, never pushes the sentinel', async () => {
    const p = generatePlan({ ...profile, startDate: '2026-04-06', raceDate: '2026-06-14' }); // finished
    const calls = recordFetch((u, m) => {
      if (u.endsWith('/api/plans/current') && m === 'GET') return serverPlanResponse(p, 'guid-END');
      return {};
    });
    const storage = storageForUser('p2end');
    const { el, root } = await mountApp(storage);
    // the finished plan auto-enters tracker after hydration stamped guid-END
    await act(async () => { await new Promise(r => setTimeout(r, 120)); });
    expect(storage.load('plan', null).race).toBe('tracker');
    expect(storage.load('plan', null).endedServerId).toBe('guid-END');
    expect(calls.some(c => c.method === 'DELETE' && c.url.includes('/api/plans/guid-END'))).toBe(true);
    expect(calls.filter(c => c.method === 'DELETE').length).toBe(1); // only the known id, no lookup-then-delete
    expect(calls.some(c => c.method === 'PUT' && c.url.endsWith('/api/me/profile'))).toBe(true);
    expect(pushedSentinel(calls)).toBe(false);
    expect(storage.load('profile', null)).toBeTruthy();
    root.unmount(); el.remove();
  }, 20000);

  it('a never-synced plan (no serverId) ends locally with no DELETE at all', async () => {
    const calls = recordFetch(u => (u.endsWith('/api/plans/current') ? null : {}));
    const storage = storageForUser('p2local');
    const finished = generatePlan({ ...profile, startDate: '2026-04-06', raceDate: '2026-06-14' });
    storage.save('plan', finished); // no serverId: planEnded routes it to tracker at hydrate
    const { el, root } = await mountApp(storage);
    await act(async () => { await new Promise(r => setTimeout(r, 120)); });
    expect(storage.load('plan', null).race).toBe('tracker');
    expect(calls.some(c => c.method === 'DELETE')).toBe(false);
    expect(pushedSentinel(calls)).toBe(false);
    root.unmount(); el.remove();
  }, 20000);
});

describe('the resurrection guard (hydrate none + local real plan)', () => {
  it('a plan the server once held (serverId stamped) is never pushed back up', async () => {
    const calls = recordFetch(u => (u.endsWith('/api/plans/current') ? null : {}));
    const storage = storageForUser('p2res');
    const p = generatePlan(profile); // active, not ended
    p.serverId = 'guid-GONE'; // it WAS synced; the server no longer has it
    storage.save('plan', p);
    const { el, root } = await mountApp(storage);
    expect(storage.load('plan', null).race).toBe('tracker'); // dropped to tracker
    expect(calls.some(c => c.method === 'POST' && /\/api\/plans/.test(c.url))).toBe(false);
    expect(pushedSentinel(calls)).toBe(false);
    root.unmount(); el.remove();
  }, 20000);

  it('a never-synced offline-created plan DOES migrate up', async () => {
    const calls = recordFetch(u => (u.endsWith('/api/plans/current') ? null : {}));
    const storage = storageForUser('p2mig');
    storage.save('plan', generatePlan(profile)); // active, no serverId
    const { el, root } = await mountApp(storage);
    expect(calls.some(c => c.method === 'POST' && /\/api\/plans/.test(c.url)
      && c.body && c.body.race === 'olympic')).toBe(true);
    root.unmount(); el.remove();
  }, 20000);
});

describe('the hydrate seam (local sentinel vs server plan) keys on identity, not timestamps', () => {
  it('server still holds the exact ended plan: the delete is finished, sentinel kept', async () => {
    const old = generatePlan(profile);
    const calls = recordFetch((u, m) => {
      if (u.endsWith('/api/plans/current') && m === 'GET') return serverPlanResponse(old, 'guid-OLD');
      return {};
    });
    const storage = storageForUser('p2seam');
    const sentinel = buildTrackerPlan({ ...old, serverId: 'guid-OLD' }, new Date().toISOString());
    sentinel.endedServerId = 'guid-OLD';
    storage.save('plan', sentinel);
    const { el, root } = await mountApp(storage);
    expect(storage.load('plan', null).race).toBe('tracker'); // sentinel kept
    expect(calls.some(c => c.method === 'DELETE' && c.url.includes('guid-OLD'))).toBe(true);
    root.unmount(); el.remove();
  }, 20000);

  it('server holds a DIFFERENT plan: adopt it, delete nothing', async () => {
    const fresh = generatePlan({ ...profile, startDate: '2026-07-06', raceDate: '2026-10-04' });
    const calls = recordFetch((u, m) => {
      if (u.endsWith('/api/plans/current') && m === 'GET') return serverPlanResponse(fresh, 'guid-NEW');
      return {};
    });
    const storage = storageForUser('p2adopt');
    const sentinel = buildTrackerPlan(generatePlan(profile), new Date().toISOString());
    sentinel.endedServerId = 'guid-OLD'; // ended a DIFFERENT plan once
    storage.save('plan', sentinel);
    const { el, root } = await mountApp(storage);
    const cached = storage.load('plan', null);
    expect(cached.race).toBe('olympic');       // the other device's plan wins
    expect(cached.serverId).toBe('guid-NEW');
    expect(calls.some(c => c.method === 'DELETE')).toBe(false); // never delete an unknown id
    root.unmount(); el.remove();
  }, 20000);
});

describe('fresh device with only a server profile', () => {
  it('lands in tracker on the SUBSET profile, not onboarding, and does not crash', async () => {
    recordFetch(u => {
      if (u.endsWith('/api/plans/current')) return null;
      if (u.endsWith('/api/me')) return { profile: serverProfile };
      return {};
    });
    const storage = storageForUser('p2fresh');
    const { el, root } = await mountApp(storage);
    expect(el.textContent).toContain('Ready for your next plan?');
    const cached = storage.load('plan', null);
    expect(cached.race).toBe('tracker');
    expect(cached.profile.raceType).toBeUndefined(); // never invented
    expect(cached.profile.daysPerWeek).toBe(5);      // derived from trainingDays
    root.unmount(); el.remove();
  }, 20000);

  it('trackerFromProfile never invents a race type and the editor gates on it', () => {
    const t = trackerFromProfile(serverProfile);
    expect(t.profile.raceType).toBeUndefined();
    expect(t.weeks).toEqual([]);
    expect(t.paces).toBeTruthy();
  });
});

describe('ending a plan whose create is still in flight (convergence-gate catch)', () => {
  it('the late create response triggers the end for the fresh row instead of resurrecting it', async () => {
    let releasePost;
    const calls = [];
    globalThis.fetch = (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      calls.push({ method, url: String(url) });
      if (String(url).endsWith('/api/plans/current') && method === 'GET')
        return Promise.resolve(new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      if (/\/api\/plans$/.test(String(url)) && method === 'POST')
        return new Promise(res => { releasePost = () => res(new Response(JSON.stringify({ id: 'guid-LATE', race: 'olympic', weeks: [] }), { status: 201, headers: { 'Content-Type': 'application/json' } })); });
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    const storage = storageForUser('p2late');
    storage.save('plan', generatePlan(profile)); // never synced: hydrate will migrate it up (held POST)
    const { el, root } = await mountApp(storage);
    // end the plan while its create is still in flight (Settings lives
    // behind the avatar button in the top bar)
    const settingsBtn = el.querySelector('.avatar-btn');
    await act(async () => { settingsBtn.click(); });
    const endBtn = [...el.querySelectorAll('button')].find(b => b.textContent.includes('End plan and just track'));
    await act(async () => { endBtn.click(); });
    expect(storage.load('plan', null).race).toBe('tracker');
    expect(calls.some(c => c.method === 'DELETE')).toBe(false); // nothing to delete yet
    // the create lands late: the sentinel finishes the end for the fresh row
    await act(async () => { releasePost(); await new Promise(r => setTimeout(r, 80)); });
    expect(calls.some(c => c.method === 'DELETE' && c.url.includes('guid-LATE'))).toBe(true);
    const cached = storage.load('plan', null);
    expect(cached.race).toBe('tracker');
    expect(cached.endedServerId).toBe('guid-LATE'); // the hydrate seam can now verify the end
    expect(cached.serverId).toBeUndefined();        // no plan map adopted onto the sentinel
    root.unmount(); el.remove();
  }, 20000);
});

describe('offline behaviour', () => {
  it('offline with a cached sentinel keeps working and pushes nothing', async () => {
    globalThis.fetch = () => Promise.reject(new Error('offline'));
    const storage = storageForUser('p2off');
    storage.save('plan', buildTrackerPlan(generatePlan(profile), new Date().toISOString()));
    storage.save('profile', profile);
    const { el, root } = await mountApp(storage);
    expect(el.textContent).toContain('Ready for your next plan?');
    expect(storage.load('plan', null).race).toBe('tracker');
    root.unmount(); el.remove();
  }, 20000);
});
