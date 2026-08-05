// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { iso } from '@/lib/date.js';
import { ReadinessCard } from './ReadinessCard.jsx';

/* The receipts fold (Jon, 2026-08-05). Card 1f made the signals permanently
   visible; the card then stood half a viewport tall between the athlete and
   today's session, so they moved one tap away. These pin the fold's
   contract: collapsed by default, keyboard-reachable, honest aria. */

const today = iso(new Date());
const wellness = [
  { date: '2026-06-01', hrv: 60, rhr: 50, sleepSec: 8 * 3600 },
  { date: today, hrv: 70, rhr: 47, sleepSec: 8 * 3600 },
];

const mount = () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(<ReadinessCard wellness={wellness} today={[]} onEdit={() => {}}
      onFeel={null} onEase={() => {}} onRestore={() => {}} onOpen={() => {}}
      onSupport={() => {}} noPlan={false} storage={null} onDecision={null} />);
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
