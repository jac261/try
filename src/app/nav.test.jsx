// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Same inert Clerk stand-ins as the other App-level tests: SettingsView pulls
// the hooks and there is no ClerkProvider here.
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

/* Which tab is active used to be carried by a text colour and nothing else,
   which says it to sighted users and to no one else. These assert the
   non-visual half on the REAL app markup rather than on a harness copy: a
   dev harness renders its own chrome, so it can only ever prove the CSS. */

const FROZEN_NOW = new Date(2026, 6, 15, 15, 0, 0);
const raceDate = addDays(FROZEN_NOW, 40);

const profile = {
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: iso(startOfWeekMonday(addDays(raceDate, -10 * 7))),
  raceDate: iso(raceDate),
};

const quietFetch = () => {
  globalThis.fetch = url => Promise.resolve(new Response(
    String(url).endsWith('/api/plans/current') ? 'null' : '{}',
    { status: 200, headers: { 'Content-Type': 'application/json' } }));
};

/* App holds the splash for 4.4s (the mark tumbling through all three faces).
   Sleeping that out on the wall clock made every mount a race it could lose:
   under the full suite running in parallel the app's own timer fires late,
   the margin gets eaten, and the assertions read a splash instead of the app.
   The hold is a setTimeout, so this file fakes setTimeout and winds the clock
   instead — the mount is then instant AND deterministic. Anything past 4400
   is spare. */
const PAST_SPLASH_HOLD_MS = 4600;

const mountApp = async storage => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<App storage={storage} getToken={async () => 'tok'} user={{ imageUrl: null }} />);
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(PAST_SPLASH_HOLD_MS); });
  // Say so here rather than three lines later as a null querySelector, if the
  // hold ever outgrows the wind.
  if (el.querySelector('.splash')) throw new Error('splash still up past PAST_SPLASH_HOLD_MS');
  return { el, root };
};

const tabNamed = (el, label) =>
  [...el.querySelectorAll('.nav button')].find(b => b.textContent.includes(label));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(FROZEN_NOW);
  localStorage.clear();
  globalThis.confirm = () => true;
  quietFetch();
});
afterEach(() => { vi.useRealTimers(); });

describe('the tab bar announces itself', () => {
  it('is a landmark, and aria-current follows the active tab', async () => {
    const storage = storageForUser('nav-aria');
    storage.save('plan', generatePlan(profile));
    const { el, root } = await mountApp(storage);

    const bar = el.querySelector('.nav');
    expect(bar.tagName).toBe('NAV');
    expect(bar.getAttribute('aria-label')).toBe('Main');

    const current = () => [...el.querySelectorAll('.nav button')]
      .filter(b => b.getAttribute('aria-current') === 'page');

    // exactly one, and it is the one the class marks: the two signals cannot
    // drift apart without this failing
    expect(current()).toHaveLength(1);
    expect(current()[0].textContent).toContain('Today');
    expect(current()[0].classList.contains('active')).toBe(true);

    await act(async () => { tabNamed(el, 'Progress').click(); });
    expect(current()).toHaveLength(1);
    expect(current()[0].textContent).toContain('Progress');
    expect(tabNamed(el, 'Today').hasAttribute('aria-current')).toBe(false);

    root.unmount();
    el.remove();
  });
});
