// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { SeasonPanel } from './SeasonPanel.jsx';
import { generatePlan } from '@/lib/plan.js';
import { iso, addDays, startOfWeekMonday } from '@/lib/date.js';

/* The shortfall banner: the caption that escalates when the dashed line
   never regains the solid one. The rule lives in seasonShortfall (its own
   suite); these pin the wiring, the copy discipline and the tap. */

const TODAY = iso(new Date());
const mon = iso(startOfWeekMonday(new Date()));
const profile = {
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: iso(addDays(new Date(), -8 * 7)), raceDate: iso(addDays(new Date(), 8 * 7)),
};
const recs = (ctl, atl, from, end) => {
  const out = [];
  for (let d = from; d <= end; d = iso(addDays(d, 1))) out.push({ date: d, ctl, atl, tsb: ctl - atl });
  return out;
};

const mount = async (ctl, extra = {}) => {
  const plan = generatePlan(profile);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<SeasonPanel plan={plan} wellness={recs(ctl, ctl - 5, plan.weeks[0].start, TODAY)}
      log={{}} moves={{}} adjust={{}} todayISO={TODAY} {...extra} />);
  });
  return { el, done: async () => { await act(async () => root.unmount()); el.remove(); } };
};

describe('the season shortfall banner', () => {
  it('appears for an athlete the plan cannot hold, says fitness not CTL, and taps to the profile', async () => {
    const onOpenSettings = vi.fn();
    const { el, done } = await mount(80, { onOpenSettings });
    const banner = el.querySelector('.season-ramp .banner');
    expect(banner).not.toBe(null);
    expect(banner.textContent).toContain('below your fitness');
    // the engine-parameter rule, made mechanical
    expect(banner.textContent).not.toContain('CTL');
    await act(async () => { banner.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onOpenSettings).toHaveBeenCalledWith('profile');
    await done();
  });

  it('stays silent for an athlete the plan fits, chart and note untouched', async () => {
    const { el, done } = await mount(50, { onOpenSettings: vi.fn() });
    expect(el.querySelector('.season-ramp .banner')).toBe(null);
    expect(el.querySelector('.sr-plot')).not.toBe(null);
    expect(el.querySelector('.sr-note')).not.toBe(null);
    await done();
  });

  it('is information without the callback: rendered, but promising nothing', async () => {
    const { el, done } = await mount(80);
    const banner = el.querySelector('.season-ramp .banner');
    expect(banner).not.toBe(null);
    expect(banner.textContent).not.toContain('re-targets');
    expect(banner.getAttribute('role')).toBe(null);
    await done();
  });
});
