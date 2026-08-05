// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: () => {} }),
  useUser: () => ({ user: { imageUrl: null, fullName: 'T' } }),
  SignOutButton: ({ children }) => children || null,
}));
/* Spied at the module the components import DIRECTLY, so no barrel mocking
   is needed and the real implementations still run. */
vi.mock('@/lib/tuning.js', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, paceSuggestions: vi.fn(actual.paceSuggestions) };
});
vi.mock('@/lib/week-strip.js', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, weekStrip: vi.fn(actual.weekStrip) };
});
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { paceSuggestions } from '@/lib/tuning.js';
import { weekStrip } from '@/lib/week-strip.js';
import { TodayView } from './TodayView.jsx';
import { generatePlan } from '@/lib/plan.js';
import { iso, addDays } from '@/lib/date.js';

/* The memoisation, guarded on BOTH sides.
 *
 * A test that only proved "the memo fires" would pass happily over a memo
 * that never invalidates — showing yesterday's week for ever — which is the
 * more dangerous of the two failures by far. So each case asserts the pair:
 * a state change that changes no input must not recompute, and a change to a
 * real input must.
 *
 * Call counts, not milliseconds: a timing assertion in CI is a flake waiting
 * to happen, and the number that matters here is "how many times", not "how
 * fast". The wall-clock measurement lives in the PR body. */

/* Dismissals are deliberately dead here: this file counts selector calls,
   so nothing stored may change which cards render. Hoisted because a fresh
   object each render is exactly the prop-identity churn it exists to police. */
const MEMO_STORE = { ns: 'try.memo.', load: (k, d) => d, save: () => {}, loadDismiss: () => null, saveDismiss: () => {}, clearDismiss: () => {} };

const today = new Date();
const todayISO = iso(today);
const profile = {
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 2, 3, 4, 5, 6], longDay: 5, daysPerWeek: 7,
  startDate: iso(addDays(today, -35)), raceDate: iso(addDays(today, 77)),
};
const plan = generatePlan(profile);
// two cards, so there is a cycle chip to tap
const CARDS = {
  weekly: { kind: 'trim-week', week: 3, targets: ['bike'], headline: 'Trim this week', why: 'x' },
  retest: { sig: 'retest:1', headline: 'Time to retest your CSS', why: 'x' },
};
const noop = () => {};

const mount = () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  const draw = over => act(() => {
    root.render(<TodayView plan={plan} log={{}} moves={{}} missedReasons={{}} open={noop} onTune={noop}
      wellness={[]} onFeel={noop} onEditWellness={noop} easedOf={w => w} onEaseToday={noop} onRestoreToday={noop}
      onWeekly={noop} spotted={null} onLogSpotted={noop} onAddWorkout={noop} onEftp={noop} onToggleWorkout={noop}
      planEdge={null} onSupport={noop} activities={[]} displayActivities={[]} onOpenRecording={noop}
      onEditPlan={noop} onEnterTracker={noop} offerTracker={false} adjust={{}} adjustLog={[]} coachLog={{}}
      blockReviewed={null} onBlockReviewed={noop} onFocus={noop} storage={MEMO_STORE}
      onRetest={noop} cssFail={null} onFixCss={noop} runFail={null} onFixRun={noop} ftpRetest={null}
      onFtpRetest={noop} startShortfall={null} onDecision={noop} fuelLog={{}} {...CARDS} {...over} />);
  });
  draw({});
  const chip = () => [...el.querySelectorAll('.banner')].filter(b => b.querySelector('.b-act'))
    .flatMap(b => [...b.querySelectorAll('.bmore')]).find(n => /▸/.test(n.textContent));
  return { el, draw, chip, cleanup: () => { act(() => root.unmount()); el.remove(); } };
};
const tapChip = c => act(() => { c.chip().dispatchEvent(new MouseEvent('click', { bubbles: true })); });

beforeEach(() => { localStorage.clear(); paceSuggestions.mockClear(); weekStrip.mockClear(); });

describe('a state change that changes no input recomputes nothing', () => {
  it('cycling the coach queue leaves the pace suggestions alone', () => {
    const c = mount();
    const before = paceSuggestions.mock.calls.length;
    // two taps on a two-card queue: away and back, so the wrap proves the
    // re-renders really happened rather than the taps being swallowed
    expect(c.el.textContent).toContain('Trim this week');
    tapChip(c);
    expect(c.el.textContent).toContain('Time to retest your CSS');
    tapChip(c);
    expect(c.el.textContent).toContain('Trim this week');
    expect(paceSuggestions.mock.calls.length).toBe(before);
    c.cleanup();
  });

  it('cycling the coach queue leaves the week strip alone', () => {
    // the expensive one: weekStrip walks the plan seven times over and
    // classifies every session
    const c = mount();
    const before = weekStrip.mock.calls.length;
    tapChip(c); tapChip(c); tapChip(c);
    expect(weekStrip.mock.calls.length).toBe(before);
    c.cleanup();
  });
});

describe('a change to a real input recomputes, because a stale week is worse than a slow one', () => {
  it('logging a session rebuilds both', () => {
    const c = mount();
    const mine = plan.weeks.flatMap(w => w.workouts).find(w => w.discipline !== 'rest' && !w.race);
    const beforePace = paceSuggestions.mock.calls.length;
    const beforeStrip = weekStrip.mock.calls.length;
    c.draw({ log: { [mine.id]: { done: true, at: todayISO } } });
    expect(paceSuggestions.mock.calls.length).toBeGreaterThan(beforePace);
    expect(weekStrip.mock.calls.length).toBeGreaterThan(beforeStrip);
    c.cleanup();
  });

  it('rescheduling a session rebuilds the strip', () => {
    const c = mount();
    const mine = plan.weeks.flatMap(w => w.workouts).find(w => w.discipline !== 'rest' && !w.race);
    const before = weekStrip.mock.calls.length;
    c.draw({ moves: { [mine.id]: todayISO } });
    expect(weekStrip.mock.calls.length).toBeGreaterThan(before);
    c.cleanup();
  });

  it('an adjustment overlay rebuilds the strip, since it changes the load it reports', () => {
    const c = mount();
    const mine = plan.weeks.flatMap(w => w.workouts).find(w => w.discipline !== 'rest' && !w.race);
    const before = weekStrip.mock.calls.length;
    c.draw({ adjust: { [mine.id]: { kind: 'ease' } } });
    expect(weekStrip.mock.calls.length).toBeGreaterThan(before);
    c.cleanup();
  });
});
