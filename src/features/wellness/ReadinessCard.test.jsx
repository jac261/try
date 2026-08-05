// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { iso } from '@/lib/date.js';
import { ReadinessCard } from './ReadinessCard.jsx';
import { storageForUser } from '@/app/storage.js';

/* The receipts fold (Jon, 2026-08-05). Card 1f made the signals permanently
   visible; the card then stood half a viewport tall between the athlete and
   today's session, so they moved one tap away. These pin the fold's
   contract: collapsed by default, keyboard-reachable, honest aria. */

const today = iso(new Date());
const wellness = [
  { date: '2026-06-01', hrv: 60, rhr: 50, sleepSec: 8 * 3600 },
  { date: today, hrv: 70, rhr: 47, sleepSec: 8 * 3600 },
];

const mount = (over = {}) => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(<ReadinessCard wellness={wellness} today={[]} onEdit={() => {}}
      onFeel={null} onEase={() => {}} onRestore={() => {}} onOpen={() => {}}
      onSupport={() => {}} noPlan={false} storage={null} onDecision={null} {...over} />);
  });
  return { el, cleanup: () => { root.unmount(); el.remove(); } };
};

describe('the readiness receipts fold', () => {
  it('collapses the signals by default, behind a labelled toggle', () => {
    const { el, cleanup } = mount();
    expect(el.querySelector('.rd-signals')).toBe(null);
    const t = el.querySelector('.rd-receipts-toggle');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(t.getAttribute('role')).toBe('button');
    expect(t.getAttribute('tabindex')).toBe('0');
    cleanup();
  });

  it('opens on tap and closes again, aria following along', () => {
    const { el, cleanup } = mount();
    const t = el.querySelector('.rd-receipts-toggle');
    act(() => { t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(el.querySelector('.rd-signals')).not.toBe(null);
    expect(el.querySelector('.rd-receipts-toggle').getAttribute('aria-expanded')).toBe('true');
    act(() => { el.querySelector('.rd-receipts-toggle').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(el.querySelector('.rd-signals')).toBe(null);
    cleanup();
  });

  it('opens by keyboard, since tap() is the path', () => {
    const { el, cleanup } = mount();
    const t = el.querySelector('.rd-receipts-toggle');
    act(() => { t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(el.querySelector('.rd-signals')).not.toBe(null);
    cleanup();
  });
});

/* The card's own dismissal, which had no coverage at all. It is athlete
   scoped on purpose: the signature carries the day, so "Not today" means
   today, and no plan change should either extend or cancel that. */
describe('the today proposal, once rejected', () => {
  const rough = [
    { date: '2026-06-01', hrv: 60, rhr: 50, sleepSec: 8 * 3600 },
    { date: today, hrv: 38, rhr: 62, sleepSec: 4.5 * 3600 },
  ];
  const hard = [{ id: 'w1', title: 'Threshold Run', type: 'Threshold', discipline: 'run', durationMin: 60, date: today }];
  const withStore = () => {
    localStorage.clear();
    return storageForUser('rc');
  };

  it('stays rejected on the next mount, through the store rather than a global key', () => {
    const storage = withStore();
    const first = mount({ wellness: rough, today: hard, storage });
    const x = first.el.querySelector('.rd-reject');
    expect(x).not.toBe(null);
    act(() => { x.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(first.el.querySelector('.rd-reject')).toBe(null);
    first.cleanup();

    const again = mount({ wellness: rough, today: hard, storage });
    expect(again.el.querySelector('.rd-reject')).toBe(null);
    again.cleanup();
    // and nothing was written browser-global, which is where it used to land
    expect(Object.keys(localStorage).filter(k => !k.startsWith('try.user.'))).toEqual([]);
  });

  it('a new plan neither revives nor cancels it: this dismissal is about the day', () => {
    const storage = withStore();
    const first = mount({ wellness: rough, today: hard, storage });
    act(() => { first.el.querySelector('.rd-reject').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    first.cleanup();
    // the store is asked with a stamp that matches nothing; athlete-scoped
    // keys do not consult it
    expect(storage.loadDismiss('todayProposalDismissed', 'some-other-plan')).not.toBe(null);
  });

  it('with no storage at all it neither throws nor writes', () => {
    localStorage.clear();
    const c = mount({ wellness: rough, today: hard, storage: null });
    const x = c.el.querySelector('.rd-reject');
    expect(() => act(() => { x.dispatchEvent(new MouseEvent('click', { bubbles: true })); })).not.toThrow();
    expect(Object.keys(localStorage)).toEqual([]);
    c.cleanup();
  });
});
