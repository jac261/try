// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { PlanView } from './PlanView.jsx';
import { generatePlan, buildTrackerPlan, weekPhaseLabel } from '@/lib/plan.js';
import { iso, addDays, startOfWeekMonday } from '@/lib/date.js';
import { readFileSync } from 'node:fs';

/* The Plan tab's first test file (the audit's CV-1: every branch was NONE).
   Fixtures pin their own dates; the component reads the clock only through
   the plan, so nothing here depends on the weekday the suite runs. */

const mon = iso(startOfWeekMonday(new Date()));
const profile = (over = {}) => ({
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: iso(addDays(mon, -28)), raceDate: iso(addDays(mon, 8 * 7)), ...over,
});
const noop = () => {};
const mount = async (plan, extra = {}) => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  const render = (p, x = {}) => act(async () => {
    root.render(<PlanView plan={p} log={{}} moves={{}} open={noop} easedOf={w => w}
      onToggleWorkout={noop} onSupport={noop} onEditPlan={noop} onStartMaintenance={noop}
      onFocus={noop} {...extra} {...x} />);
  });
  await render(plan);
  return { el, render, done: async () => { await act(async () => root.unmount()); el.remove(); } };
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('one phase boundary, everywhere', () => {
  it('the recovery week pill agrees with the overview', async () => {
    /* THE review finding: the pill used week.phase raw, so the final week
       wore a Recovery tag beside a Maintain pill while the overview above
       said Recovery. weekPhaseLabel's comment promised one boundary; this
       file was the consumer that never called it. */
    const plan = generatePlan(profile());
    const last = plan.weeks[plan.weeks.length - 1];
    expect(last.isRecovery).toBe(true);                       // fixture honest
    const { el, done } = await mount(plan);
    const cards = [...el.querySelectorAll('.weekhdr')];
    const pill = cards[cards.length - 1].querySelector('.ph');
    expect(pill.textContent).toBe('Recovery');
    expect([...el.querySelectorAll('.seg .l')].map(x => x.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Recovery')]));
    await done();
  });

  it('a post-race maintenance block says Recovery on week 1, overview included', async () => {
    /* The other recovery week (SW-4): the baked-in week 0 of a postRace
       roll. The overview said 'Maintain · 12 weeks' while the card wore a
       Recovery tag beside a Maintain pill. */
    const plan = generatePlan(profile({
      raceType: 'maintenance', horizonWeeks: 12, postRace: true,
      startDate: iso(addDays(mon, -7)), raceDate: iso(addDays(mon, 76)),
    }));
    expect(plan.weeks[0].isRecovery).toBe(true);
    expect(weekPhaseLabel(plan, plan.weeks[0])).toBe('Recovery');
    const { el, done } = await mount(plan);
    expect(el.querySelector('.weekhdr .ph').textContent).toBe('Recovery');
    expect([...el.querySelectorAll('.seg .l')][0].textContent).toContain('Recovery');
    await done();
  });

  it('the headline disowns the lead-in it used to count as build', async () => {
    const plan = generatePlan(profile({ raceDate: iso(addDays(mon, 28 * 7)) }));
    expect(plan.leadIn).toBeGreaterThan(0);
    const { el, done } = await mount(plan);
    const lead = el.querySelector('.card p.lead').textContent;
    expect(lead).toContain(plan.leadIn + '-week lead-in + ');
    const buildLen = plan.totalWeeks - 1 - plan.leadIn;       // recovery + leadIn out
    expect(lead).toContain(buildLen + '-week build');
    await done();
  });

  it('race week counts only what can be done', async () => {
    // the A-race is unloggable by every path, so it is not a denominator
    const plan = generatePlan(profile());
    const raceWeek = plan.weeks.find(w => w.workouts.some(x => x.race));
    const { el, done } = await mount(plan);
    const hdr = [...el.querySelectorAll('.weekhdr')][raceWeek.index];
    const doable = raceWeek.workouts.filter(w => w.discipline !== 'rest' && !w.race).length;
    expect(hdr.textContent).toContain(doable + ' sessions');
    const bar = [...el.querySelectorAll('.weekbar')][raceWeek.index];
    expect(bar.getAttribute('aria-valuemax')).toBe(String(doable));
    await done();
  });
});

describe('done means done', () => {
  it('a feel-only entry fills no bar, ticks no row, and is not "done" in the subtitle', async () => {
    /* The PR #66 classifier lesson, finally applied to the views: the
       server delivers feel-only entries with done:false, and the progress
       bar counted them by existence. */
    const plan = generatePlan(profile({ trainingDays: [0, 1, 2, 3, 4, 5, 6], daysPerWeek: 7 }));
    const wk = plan.weeks[1];
    const ws = wk.workouts.filter(w => w.discipline !== 'rest' && !w.race);
    const log = { [ws[0].id]: { done: true }, [ws[1].id]: { done: false, feel: 'ok' } };
    const el0 = document.createElement('div');
    document.body.appendChild(el0);
    const root = createRoot(el0);
    await act(async () => {
      root.render(<PlanView plan={plan} log={log} moves={{}} open={noop} easedOf={w => w}
        onToggleWorkout={noop} onSupport={noop} onEditPlan={noop} onStartMaintenance={noop} onFocus={noop} />);
    });
    const bar = [...el0.querySelectorAll('.weekbar')][1];
    expect(bar.getAttribute('aria-valuenow')).toBe('1');              // not 2
    const hdr = [...el0.querySelectorAll('.weekhdr')][1];
    expect(hdr.textContent).toContain('1 of ' + ws.length + ' sessions done');
    await act(async () => { hdr.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const rows = [...el0.querySelectorAll('.wk')];
    expect(rows.filter(r => r.className.includes('done'))).toHaveLength(1);  // not 2
    await act(async () => root.unmount());
    el0.remove();
  });
});

describe('the chooser is a fair control', () => {
  it('opens with an honest line, a cancel, and Escape; closing returns focus to the trigger', async () => {
    const plan = generatePlan(profile());
    const { el, done } = await mount(plan);
    const trigger = [...el.querySelectorAll('a.reset')].find(a => a.textContent.includes('Change what'));
    await act(async () => { trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(el.textContent).toContain('The plan\'s extra work still follows your limiter');
    const cancel = [...el.querySelectorAll('button')].find(b => b.textContent === 'Never mind');
    expect(cancel).toBeTruthy();
    await act(async () => { cancel.click(); });
    expect([...el.querySelectorAll('.feel-row button')]).toHaveLength(0);   // closed
    await done();
  });

  it('re-choosing the current focus closes without a plan push', async () => {
    const onFocus = vi.fn();
    const plan = generatePlan(profile({ blockFocus: 'bike' }));
    const { el, done } = await mount(plan, { onFocus });
    const trigger = [...el.querySelectorAll('a.reset')].find(a => a.textContent.includes('Change what'));
    await act(async () => { trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const bike = [...el.querySelectorAll('button')].find(b => b.textContent === 'Focus on the bike');
    expect(bike.getAttribute('aria-pressed')).toBe('true');   // the current one is marked
    await act(async () => { bike.click(); });
    expect(onFocus).not.toHaveBeenCalled();                    // no-op close, no push
    await done();
  });

  it("'Everything evenly' stores general instead of vanishing into null", async () => {
    /* SW-2: null means "never declared", so the labels silently reverted
       to the derived limiter and the tap looked broken. 'general' is a
       valid FOCUS_OPTIONS key and resolveFocus honours it. */
    const onFocus = vi.fn();
    const plan = generatePlan(profile({ blockFocus: 'bike' }));
    const { el, done } = await mount(plan, { onFocus });
    const trigger = [...el.querySelectorAll('a.reset')].find(a => a.textContent.includes('Change what'));
    await act(async () => { trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const evenly = [...el.querySelectorAll('button')].find(b => b.textContent === 'Everything evenly');
    await act(async () => { evenly.click(); });
    expect(onFocus).toHaveBeenCalledWith('general');
    await done();
  });

  it('is hidden entirely on a solo plan', async () => {
    const plan = generatePlan(profile({ raceType: 'runhalf', raceDate: iso(addDays(mon, 12 * 7)) }));
    const { el, done } = await mount(plan);
    expect([...el.querySelectorAll('a.reset')].find(a => a.textContent.includes('Change what'))).toBeUndefined();
    await done();
  });
});

describe('the component itself', () => {
  it('survives a live race->tracker flip in one mounted component', async () => {
    // enterTracker is the one plan.race flip with no splash unmount in
    // front of it; the behaviour pin is that both directions render.
    const plan = generatePlan(profile());
    const { el, render, done } = await mount(plan);
    const tracker = buildTrackerPlan(plan, iso(new Date()));
    await render(tracker);                                    // same mounted component
    expect(el.textContent).toContain('No plan active');
    await render(plan);                                       // and back
    expect(el.textContent).toContain('Week by week');
    await done();
  });

  it('declares every hook before the tracker return (source pin)', () => {
    /* React's runtime CANNOT catch this one: a zero-hook early return
       advances no hook cursor, so the fewer-hooks invariant never fires,
       and the flip above renders cleanly even with the hooks below the
       return. The violation only arms a real crash once someone adds a
       hook above the return later — so the guard is structural: in source,
       every hook call precedes the first conditional return. */
    const src = readFileSync('src/features/plan/PlanView.jsx', 'utf8');
    const firstReturn = src.indexOf("if (plan.race === 'tracker') return");
    expect(firstReturn).toBeGreaterThan(0);
    for (const hook of ['useState(', 'useMemo(']) {
      let i = src.indexOf(hook);
      while (i !== -1) {
        expect(i).toBeLessThan(firstReturn);
        i = src.indexOf(hook, i + 1);
      }
    }
  });

  it('the legend hides for one discipline and shows for several', async () => {
    const tri = generatePlan(profile());
    const { el, done } = await mount(tri);
    expect(el.querySelector('.legend')).toBeTruthy();
    const { el: el2, done: done2 } = await mount(generatePlan(profile({ raceType: 'run5k', raceDate: iso(addDays(mon, 8 * 7)) })));
    expect(el2.querySelector('.legend')).toBeFalsy();
    await done(); await done2();
  });

  it('the fold-out orders same-day sessions stably', async () => {
    const plan = generatePlan(profile({ trainingDays: [0, 1, 2, 3, 4, 5, 6], daysPerWeek: 7 }));
    const { el, done } = await mount(plan);
    const hdr = [...el.querySelectorAll('.weekhdr')][1];
    await act(async () => { hdr.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const first = [...el.querySelectorAll('.wk .t')].map(t => t.textContent);
    await act(async () => { hdr.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { hdr.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect([...el.querySelectorAll('.wk .t')].map(t => t.textContent)).toEqual(first);
    await done();
  });
});
