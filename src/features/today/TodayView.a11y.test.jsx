// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: () => {} }),
  useUser: () => ({ user: { imageUrl: null, fullName: 'T' } }),
  SignOutButton: ({ children }) => children || null,
}));
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { TodayView } from './TodayView.jsx';
import { generatePlan } from '@/lib/plan.js';
import { iso, addDays } from '@/lib/date.js';

/* The coach card's controls, which is where the audit's one HIGH lived: the
   cycle chip was aria-hidden with no role and no tabindex, so every
   suggestion after the first was reachable by pointer alone. It was hidden
   because the card itself was a role="button" and a button inside a button
   is invalid — so the fix is structural, and these pin the structure.

   Also the first test file TodayView has ever had. It covers the controls
   only; the queue's priority order and dismissal stickiness are PR 3. */

const today = new Date();
const profile = {
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 2, 3, 4, 5, 6], longDay: 5, daysPerWeek: 7,
  startDate: iso(addDays(today, -35)), raceDate: iso(addDays(today, 77)),
};

// two dismissible cards with actions, so the queue is longer than one
const weekly = { kind: 'trim-week', week: 3, targets: ['bike'], headline: 'Trim this week', why: 'Fatigue is high.' };
const retest = { sig: 'retest:swim:1', headline: 'Time to retest your CSS', why: 'It is six weeks old.' };
// the one card in the whole queue with no action: informational only
const startShortfall = { sig: 'start-shortfall:bike20:2026-11-01', text: 'Your bike starts 20% under.' };

const render = (over = {}) => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  const noop = () => {};
  act(() => {
    root.render(<TodayView plan={generatePlan(profile)} log={{}} moves={{}} missedReasons={{}}
      open={noop} onTune={noop} wellness={[]} onFeel={noop} onEditWellness={noop}
      easedOf={w => w} onEaseToday={noop} onRestoreToday={noop}
      weekly={null} onWeekly={noop} spotted={null} onLogSpotted={noop} onAddWorkout={noop}
      eftp={null} onEftp={noop} onToggleWorkout={noop} planEdge={null} onSupport={noop}
      activities={[]} displayActivities={[]} onOpenRecording={noop} onEditPlan={noop}
      onEnterTracker={noop} offerTracker={false} adjust={{}} adjustLog={[]} coachLog={{}}
      blockReviewed={null} onBlockReviewed={noop} onFocus={noop} storage={null}
      retest={null} onRetest={noop} cssFail={null} onFixCss={noop} runFail={null} onFixRun={noop}
      ftpRetest={null} onFtpRetest={noop} startShortfall={null} onDecision={noop} fuelLog={{}}
      {...over} />);
  });
  // ReadinessCard renders its own .banner (the add-your-morning empty state)
  // and it has .bt too, so the coach card is found by its action wrapper
  const coach = () => [...el.querySelectorAll('.banner')].find(b => b.querySelector('.b-act'));
  return { el, root, card: coach(), coach, cleanup: () => { root.unmount(); el.remove(); } };
};

const press = (node, key = 'Enter') =>
  act(() => { node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });

beforeEach(() => { localStorage.clear(); });

describe('the coach card is a container, not a control', () => {
  it('puts the action on a wrapper so no button sits inside another', () => {
    const { card, cleanup } = render({ weekly });
    expect(card.getAttribute('role')).toBe(null);
    const act1 = card.querySelector('.b-act');
    expect(act1.getAttribute('role')).toBe('button');
    // every control is a SIBLING of the action, none a descendant
    card.querySelectorAll('[role="button"]').forEach(b => {
      expect(b.parentElement.closest('[role="button"]')).toBe(null);
    });
    cleanup();
  });

  it('an informational card is not a button and does not throw on Enter', () => {
    const { card, cleanup } = render({ startShortfall });
    expect(card.className).toContain('inert');
    const act1 = card.querySelector('.b-act');
    expect(act1.getAttribute('role')).toBe(null);
    expect(act1.getAttribute('tabindex')).toBe(null);
    // tap(undefined) used to hand keydown an undefined handler
    expect(() => press(act1)).not.toThrow();
    cleanup();
  });
});

describe('every suggestion in the queue is reachable', () => {
  it('the cycle chip is focusable, labelled, and not hidden from assistive tech', () => {
    const { card, cleanup } = render({ weekly, retest });
    const chip = [...card.querySelectorAll('.bmore')].find(n => /▸/.test(n.textContent));
    expect(chip.getAttribute('aria-hidden')).toBe(null);
    expect(chip.getAttribute('role')).toBe('button');
    expect(chip.getAttribute('tabindex')).toBe('0');
    // the label names where the tap GOES, not where it is
    expect(chip.getAttribute('aria-label')).toBe('Show suggestion 2 of 2');
    cleanup();
  });

  it('the keyboard actually advances the queue to a different suggestion', () => {
    const { card, coach, cleanup } = render({ weekly, retest });
    const first = card.querySelector('.bt').textContent;
    const chip = [...card.querySelectorAll('.bmore')].find(n => /▸/.test(n.textContent));
    press(chip);
    const second = coach().querySelector('.bt').textContent;
    expect(second).not.toBe(first);
    expect([first, second].sort()).toEqual(['Time to retest your CSS', 'Trim this week']);
    cleanup();
  });

  it('no chip when there is nothing to cycle to', () => {
    const { card, cleanup } = render({ weekly });
    expect([...card.querySelectorAll('.bmore')].some(n => /▸/.test(n.textContent))).toBe(false);
    cleanup();
  });

  it('the dismiss stays reachable and keeps its own label', () => {
    const dismissed = [];
    const { card, cleanup } = render({ weekly, onDecision: (p, verdict) => dismissed.push(verdict) });
    const x = card.querySelector('.bmore.bx');
    expect(x.getAttribute('role')).toBe('button');
    expect(x.getAttribute('aria-label')).toBe('Dismiss this suggestion');
    press(x, ' ');
    expect(dismissed).toEqual(['rejected']);
    cleanup();
  });
});
