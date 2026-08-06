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

describe('the season line: where done ends and planned begins', () => {
  /* Both halves come off ONE set of points, so the join is a geometric fact
     rather than a matter of taste: the solid line must end at the same x the
     dashed one starts, sharing exactly one point. It used to end one whole
     week further right, painting a week nobody had trained yet as done and
     overshooting the TODAY marker (calendar audit, 2026-08-06). */
  const xs = d => (d || '').split(/[ML]/).slice(1)
    .map(seg => parseFloat(seg.trim().split(/[ ,]/)[0])).filter(n => !Number.isNaN(n));
  const paths = el => [...el.querySelectorAll('.sr-plot path')];

  it('the solid line stops where the dashed one starts, and no further', async () => {
    const { el, done } = await mount(50);
    const strokes = paths(el).filter(p => p.getAttribute('fill') === 'none');
    const solid = strokes.find(p => !p.getAttribute('stroke-dasharray'));
    const dashed = strokes.find(p => p.getAttribute('stroke-dasharray'));
    const sx = xs(solid.getAttribute('d')), dx = xs(dashed.getAttribute('d'));
    expect(sx.length).toBeGreaterThan(1);
    expect(dx.length).toBeGreaterThan(1);
    expect(sx[sx.length - 1]).toBeCloseTo(dx[0], 1);
    await done();
  });

  it('the done half is shaded under, not just stroked', async () => {
    /* The fill is how the eye separates what happened from what is modelled
       at a glance. It never rendered: the area helper refused any series
       with a null in it, and the done half is null past the join by design. */
    const { el, done } = await mount(50);
    const filled = paths(el).filter(p => p.getAttribute('fill') && p.getAttribute('fill') !== 'none');
    expect(filled.length).toBeGreaterThan(0);
    expect(xs(filled[0].getAttribute('d')).length).toBeGreaterThan(2);
    await done();
  });
});
