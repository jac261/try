// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
import { generatePlan } from '@/lib/plan.js';
import { iso, addDays, startOfWeekMonday } from '@/lib/date.js';

/* The post-race window (PR #19 gauntlet): between race day and planEnded
   rolling the plan into tracker mode, every countdown surface must state the
   phase in calendar language — "0 days to go" is race day and nothing else,
   and no surface may claim the race was RUN (the app can never log the A
   race, so it only ever knows the date passed). Only Date is faked — timers
   stay real for the splash hold — and it is pinned to 15:00 deliberately:
   afternoon is when raw-clock rounding rounds the same calendar day to -1,
   so these tests fail if the iso() normalisation in App.jsx ever reverts. */

const FROZEN_NOW = new Date(2026, 6, 15, 15, 0, 0);

const profileFor = raceDate => ({
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: iso(startOfWeekMonday(addDays(raceDate, -10 * 7))),
  raceDate: iso(raceDate),
});

const quietFetch = () => {
  globalThis.fetch = url => Promise.resolve(new Response(
    String(url).endsWith('/api/plans/current') ? 'null' : '{}',
    { status: 200, headers: { 'Content-Type': 'application/json' } }));
};

const mountApp = async storage => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<App storage={storage} getToken={async () => 'tok'} user={{ imageUrl: null }} />);
  });
  // splash hold runs 4.4s (the tumbling mark); let it and hydration settle
  await act(async () => { await new Promise(r => setTimeout(r, 4600)); });
  return { el, root };
};

const openProgress = async el => {
  const btn = [...el.querySelectorAll('.nav button')].find(b => b.textContent.includes('Progress'));
  await act(async () => { btn.click(); });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FROZEN_NOW);
  localStorage.clear();
  globalThis.confirm = () => true;
  quietFetch();
});
afterEach(() => { vi.useRealTimers(); });

describe('the post-race window (race day passed, plan not yet ended)', () => {
  it('the chip states the phase on every tab and the Progress KPI counts up', async () => {
    const storage = storageForUser('pr-window');
    // two days after race day: inside the scheduled recovery week, so
    // planEnded is false and the plan must NOT have entered tracker
    storage.save('plan', generatePlan(profileFor(addDays(FROZEN_NOW, -2))));
    const { el, root } = await mountApp(storage);
    expect(storage.load('plan', null).race).toBe('olympic');
    expect(el.textContent).toContain('race day has passed');
    expect(el.textContent).not.toContain('days to go');
    // Today keeps the sole action surface: the congratulations banner
    expect(el.textContent).toContain('Race day is behind you');
    // the chip is honest on tabs the post-race banner never reaches
    await openProgress(el);
    expect(el.textContent).toContain('race day has passed');
    expect(el.textContent).not.toContain('Until race day');
    expect(el.textContent).toContain('Since race day');
    root.unmount(); el.remove();
  }, 20000);

  it('race day itself still counts down to 0 — zero means today, not "passed"', async () => {
    const storage = storageForUser('pr-day0');
    storage.save('plan', generatePlan(profileFor(FROZEN_NOW)));
    const { el, root } = await mountApp(storage);
    expect(el.textContent).toContain('days to go');
    expect(el.textContent).not.toContain('race day has passed');
    // the banner boundary moved with the calendar-day fix: not on race day
    expect(el.textContent).not.toContain('Race day is behind you');
    root.unmount(); el.remove();
  }, 20000);

  it('a race still ahead keeps the countdown on both surfaces', async () => {
    const storage = storageForUser('pr-ahead');
    storage.save('plan', generatePlan(profileFor(addDays(FROZEN_NOW, 30))));
    const { el, root } = await mountApp(storage);
    expect(el.textContent).toContain('days to go');
    await openProgress(el);
    expect(el.textContent).toContain('Until race day');
    expect(el.textContent).not.toContain('race day has passed');
    expect(el.textContent).not.toContain('Since race day');
    root.unmount(); el.remove();
  }, 20000);
});
