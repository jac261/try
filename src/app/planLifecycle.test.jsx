// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: () => {} }),
  useUser: () => ({ user: { imageUrl: null, fullName: 'T' } }),
  SignOutButton: ({ children }) => children || null,
}));
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { App } from '@/app/App.jsx';
import { storageForUser } from '@/app/storage.js';
import { generatePlan, buildTrackerPlan } from '@/lib/plan.js';
import { iso, addDays, startOfWeekMonday } from '@/lib/date.js';

/* The plan lifecycle: what reshapePlan does when the athlete is starting a
   genuinely NEW block rather than reshaping the one they have. The audit's
   two HIGHs live here, both empirically reproduced before they were fixed:

   - "Start a plan" from tracker resurrected the ONBOARDING startDate (the
     tracker sentinel has no weeks, so the kept-grid fallback died and
     generatePlan fell back to profile.startDate stamped months ago): a
     34-week plan for a 12-week ask, ~20 weeks dated in the past, every one
     of them instantly missed.
   - profile.postRace, set by the post-race maintenance roll, was never
     cleared again, so every later race build generated week 1 as a deloaded
     recovery week, forever.

   These drive the real App over a mocked fetch: real storage, real
   reshapePlan, the real editor sheet where the flow goes through it. */

/* A FIXED Wednesday. The App reads the real clock, so without this every
   date assertion here would depend on the weekday the suite runs — the flake
   family this week kept producing (splash, season panel, moveSync). Faking
   Date alongside the timer pair keeps advanceTimersByTimeAsync coherent. */
const FIXED_NOW = new Date('2026-05-13T10:00:00');
const mon = iso(startOfWeekMonday(FIXED_NOW));
const todayISO = iso(FIXED_NOW);
const profile = (over = {}) => ({
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 2, 3, 4, 5, 6], longDay: 5, daysPerWeek: 7,
  startDate: iso(addDays(mon, -140)), raceDate: iso(addDays(mon, 8 * 7)), ...over,
});

/* The server's GET must return a REAL plan shape or null: an empty object
   adopts a profile-less husk and the whole App falls over on
   plan.profile.raceDate (the exact trap moveSync's producer test hit). Local
   fixtures here are the truth, so the route answers null (no server row) and
   the App keeps what storage holds. */
const serverHasNothing = (u, m) => (u.endsWith('/api/plans/current') && m === 'GET' ? undefined : {});

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

const PAST_SPLASH_HOLD_MS = 4600;
const mountApp = async storage => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<App storage={storage} getToken={async () => 'tok'} user={{ imageUrl: null }} />);
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(PAST_SPLASH_HOLD_MS); });
  return { el, root, done: () => { root.unmount(); el.remove(); } };
};

// Cross the reshape splash (setPlanWork 2600ms) and let the push settle.
const acrossSplash = async () => act(async () => { await vi.advanceTimersByTimeAsync(PAST_SPLASH_HOLD_MS); });

const tab = (el, label) => [...el.querySelectorAll('.tabbar button, nav button')]
  .find(b => b.textContent.trim() === label);
const btn = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent.includes(text));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(FIXED_NOW);
  localStorage.clear();
  globalThis.confirm = () => true;
});
afterEach(() => { vi.useRealTimers(); });

describe('a new block anchors at today, not at a ghost start', () => {
  it('Start a plan from tracker builds this week, not the onboarding week', async () => {
    /* THE reproduced HIGH. The tracker sentinel keeps the profile's
       onboarding startDate; the fix anchors any non-live-race build at
       today, so the oldest week in the new plan is this week. */
    const ended = generatePlan(profile());
    const tracker = buildTrackerPlan(ended, todayISO);
    const storage = storageForUser('lc-tracker');
    storage.save('plan', tracker);
    recordFetch(serverHasNothing);
    const app = await mountApp(storage);

    await act(async () => { tab(app.el, 'Plan').click(); });
    await act(async () => { btn(app.el, 'Start a plan').click(); });
    // the editor sheet: pick a race, save with the default 12-weeks-out date
    const olympic = [...app.el.querySelectorAll('.opt')].find(o => o.textContent.includes('Olympic'));
    await act(async () => { olympic.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { btn(app.el, 'Save & rebuild plan').click(); });
    await acrossSplash();

    const np = storage.load('plan', null);
    expect(np.race).toBe('olympic');
    // no week may predate this week: the stale-start resurrection is the
    // mutation this test exists to kill
    expect(np.weeks[0].start >= mon).toBe(true);
    expect(np.weeks.every(w => w.start >= mon)).toBe(true);
    // and the size matches the ask (12 weeks out), not months of ghost lead-in
    expect(np.totalWeeks).toBeLessThanOrEqual(14);
    app.done();
  }, 20000);

  it('picking a race from a maintenance block starts fresh, not at the old block Monday', async () => {
    /* The sweep's generalisation (SW-1): the kept-grid branch fired for any
       caller without startDate, including "pick your next race" from a
       maintenance block that started months ago. */
    const maint = generatePlan(profile({
      raceType: 'maintenance', horizonWeeks: 12,
      startDate: iso(addDays(mon, -70)), raceDate: iso(addDays(mon, 13)),
    }));
    const storage = storageForUser('lc-maint');
    storage.save('plan', maint);
    recordFetch(serverHasNothing);
    const app = await mountApp(storage);

    await act(async () => { app.el.querySelector('.avatar-btn').click(); });
    await act(async () => { btn(app.el, 'Edit race').click(); });
    const olympic = [...app.el.querySelectorAll('.opt')].find(o => o.textContent.includes('Olympic'));
    await act(async () => { olympic.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    // give the new build a real runway: the maintenance profile's raceDate is
    // 13 days out, which would otherwise build a legitimate short plan
    const dateInput = app.el.querySelector('input[type="date"]');
    await act(async () => {
      dateInput.value = iso(addDays(mon, 12 * 7));
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { btn(app.el, 'Save & rebuild plan').click(); });
    await acrossSplash();

    const np = storage.load('plan', null);
    expect(np.race).toBe('olympic');
    expect(np.weeks.every(w => w.start >= mon)).toBe(true);
    app.done();
  }, 20000);

  it('reshaping a LIVE race build keeps its grid, ticks included', async () => {
    /* The other half of the rule, so the fix cannot overreach: an athlete
       mid-build who changes their race date keeps the weeks they have
       trained (the documented keep-the-grid intent).

       The fixture is deliberately LEGACY-shaped: profile.startDate sits
       mid-week while the grid was laid full-width (plans generated before
       the 2026-08-01 trim fix look exactly like this). A fresh regeneration
       from that profile would TRIM week 1 to Thursday, delete the Monday
       session, and the survivor check would discard its completion — which
       is the gauntlet scenario the keep-the-grid comment records, and the
       observable that kills the always-regenerate mutation. */
    const live = generatePlan(profile({ startDate: iso(addDays(mon, -28)) }));
    live.profile.startDate = iso(addDays(mon, -25));   // legacy drift: a Thursday
    const monday1 = live.weeks[0].workouts.find(w => w.discipline !== 'rest' && w.date === live.weeks[0].start);
    const storage = storageForUser('lc-live');
    storage.save('plan', live);
    storage.save('log', { [monday1.id]: { done: true } });
    recordFetch(serverHasNothing);
    const app = await mountApp(storage);

    await act(async () => { app.el.querySelector('.avatar-btn').click(); });
    await act(async () => { btn(app.el, 'Edit race').click(); });
    const dateInput = app.el.querySelector('input[type="date"]');
    await act(async () => {
      dateInput.value = iso(addDays(mon, 10 * 7));
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { btn(app.el, 'Save & rebuild plan').click(); });
    await acrossSplash();

    const np = storage.load('plan', null);
    expect(np.weeks[0].start).toBe(live.weeks[0].start);   // the grid survived
    // and so did the Monday completion a fresh regeneration would have trimmed
    expect(np.weeks[0].workouts.some(w => w.id === monday1.id && w.date === monday1.date)).toBe(true);
    expect(storage.load('log', {})[monday1.id]).toBeTruthy();
    app.done();
  }, 20000);
});

describe('rollMaintenance anchors at today and stamps the true end', () => {
  it('a roll never creates past-dated sessions, whatever day it is', async () => {
    /* The Monday anchor no-oped the trim/roll and laid sessions on days
       already gone — a Sunday tap created six days of instant misses. */
    const ended = generatePlan(profile());
    // a stale tune-up from the old race plan, dated inside the coming block:
    // without the clear it would be scheduled for real (the maintenance path
    // skips the 10-day race-window filter)
    ended.profile.bRaces = [{ kind: 'run5k', date: iso(addDays(mon, 21)) }];
    const tracker = buildTrackerPlan(ended, todayISO);
    const storage = storageForUser('lc-roll');
    storage.save('plan', tracker);
    recordFetch(serverHasNothing);
    const app = await mountApp(storage);

    await act(async () => { tab(app.el, 'Plan').click(); });
    await act(async () => { btn(app.el, 'Start a maintenance block').click(); });
    await acrossSplash();

    const np = storage.load('plan', null);
    expect(np.race).toBe('maintenance');
    const sessions = np.weeks.flatMap(w => w.workouts).filter(w => w.discipline !== 'rest');
    expect(sessions.every(w => w.date >= todayISO)).toBe(true);
    // the synthetic raceDate is the block's real final Sunday, not mon+83
    const lastWk = np.weeks[np.weeks.length - 1];
    expect(np.profile.raceDate).toBe(iso(addDays(lastWk.start, 6)));
    // and stale tune-ups from the old race plan do not ride into the block
    expect(np.profile.bRaces || []).toEqual([]);
    app.done();
  }, 20000);

  it('stamps the true end when generation ROLLS the block to next Monday', async () => {
    /* A Mon/Tue/Wed athlete rolling on a Wednesday has one usable day left
       this week (under FIRST_WEEK_MIN_DAYS = 2), so generatePlan rolls the
       whole block to next Monday. The old mon+83 formula and the true end
       now differ by a week — this is the fixture that kills the formula,
       deterministically, because the clock is fixed to a Wednesday. Three
       days, not two: generation treats fewer than three trainingDays as a
       legacy profile (plan.js:2082) and legacy profiles trim but never
       roll. */
    const tracker = buildTrackerPlan(generatePlan(profile({
      trainingDays: [0, 1, 2], daysPerWeek: 3, longDay: 2,
    })), todayISO);
    const storage = storageForUser('lc-roll2');
    storage.save('plan', tracker);
    recordFetch(serverHasNothing);
    const app = await mountApp(storage);

    await act(async () => { tab(app.el, 'Plan').click(); });
    await act(async () => { btn(app.el, 'Start a maintenance block').click(); });
    await acrossSplash();

    const np = storage.load('plan', null);
    expect(np.weeks[0].start).toBe(iso(addDays(mon, 7)));            // it rolled
    const lastWk = np.weeks[np.weeks.length - 1];
    expect(np.profile.raceDate).toBe(iso(addDays(lastWk.start, 6))); // and the stamp followed
    app.done();
  }, 20000);
});

describe('postRace dies unless the caller says otherwise', () => {
  /* The second reproduced HIGH: rollMaintenance(true) merged postRace into
     the durable profile and nothing ever wrote it false again, so every
     later race build opened with a phantom recovery week. */

  const postRaceMaint = () => {
    const p = generatePlan(profile({
      raceType: 'maintenance', horizonWeeks: 12, postRace: true,
      startDate: iso(addDays(mon, -14)), raceDate: iso(addDays(mon, 69)),
    }));
    expect(p.weeks[0].isRecovery).toBe(true);   // fixture is honest
    return p;
  };

  it('an editor-built race plan after a post-race roll opens at full load', async () => {
    const storage = storageForUser('pr-clear');
    storage.save('plan', postRaceMaint());
    recordFetch(serverHasNothing);
    const app = await mountApp(storage);

    await act(async () => { app.el.querySelector('.avatar-btn').click(); });
    await act(async () => { btn(app.el, 'Edit race').click(); });
    const olympic = [...app.el.querySelectorAll('.opt')].find(o => o.textContent.includes('Olympic'));
    await act(async () => { olympic.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const dateInput = app.el.querySelector('input[type="date"]');
    await act(async () => {
      dateInput.value = iso(addDays(mon, 12 * 7));
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { btn(app.el, 'Save & rebuild plan').click(); });
    await acrossSplash();

    const np = storage.load('plan', null);
    expect(np.race).toBe('olympic');
    expect(np.profile.postRace).toBe(false);          // the flag died with the block
    expect(np.weeks[0].isRecovery).toBeFalsy();       // no phantom recovery week
    app.done();
  }, 20000);

  it('rollMaintenance(true) still gets its recovery week', async () => {
    /* The strip must not overreach: the caller that ASSERTS postRace keeps
       it. Driven through the tracker CTA with the stamped flag, which also
       pins the third entry point — this path used to hard-code false and
       ship the heavier first week the other two were fixed for. */
    const ended = generatePlan(profile({ raceDate: iso(addDays(mon, -5)) }));
    const tracker = buildTrackerPlan(ended, todayISO);
    const storage = storageForUser('pr-keep');
    storage.save('plan', tracker);
    recordFetch(serverHasNothing);
    const app = await mountApp(storage);

    // enterTracker stamped the flag when the plan ended; buildTrackerPlan in
    // the fixture cannot, so assert the App-level stamp separately below via
    // the CTA behaviour: the fixture pre-stamps what enterTracker would.
    expect(storage.load('plan', null).profile.postRace).toBeFalsy();
    app.done();

    // Now the stamped shape: the tracker profile carries postRace true.
    const tracker2 = { ...tracker, profile: { ...tracker.profile, postRace: true } };
    const storage2 = storageForUser('pr-keep2');
    storage2.save('plan', tracker2);
    recordFetch(serverHasNothing);
    const app2 = await mountApp(storage2);
    await act(async () => { tab(app2.el, 'Plan').click(); });
    await act(async () => { btn(app2.el, 'Start a maintenance block').click(); });
    await acrossSplash();

    const np = storage2.load('plan', null);
    expect(np.race).toBe('maintenance');
    expect(np.profile.postRace).toBe(true);
    expect(np.weeks[0].isRecovery).toBe(true);        // the recovery week survived the detour
    app2.done();
  }, 20000);

  it('enterTracker stamps whether the plan ended past its race', async () => {
    /* The stamp itself: end a LIVE plan whose race already passed and the
       sentinel must carry postRace true; end one mid-build and it must not. */
    const past = generatePlan(profile({ raceDate: iso(addDays(mon, -5)) }));
    const storage = storageForUser('pr-stamp');
    storage.save('plan', past);
    recordFetch(serverHasNothing);
    const app = await mountApp(storage);

    // End the plan via the Today planEdge / settings path: endPlanToTracker
    // confirm() is stubbed true in beforeEach.
    await act(async () => { app.el.querySelector('.avatar-btn').click(); });
    const endBtn = btn(app.el, 'End plan');
    await act(async () => { endBtn.click(); });
    await acrossSplash();

    const np = storage.load('plan', null);
    expect(np.race).toBe('tracker');
    expect(np.profile.postRace).toBe(true);
    app.done();
  }, 20000);
});
