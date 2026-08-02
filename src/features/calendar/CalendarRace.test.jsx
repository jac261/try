// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { CalendarView } from '@/features/calendar/CalendarView.jsx';
import { generatePlan } from '@/lib/plan.js';
import { iso, addDays, startOfWeekMonday } from '@/lib/date.js';

/* The gold ring on the grid means "this is your race". A maintenance block
   has no race, but it does have a raceDate — domain.js calls it "just the
   block's horizon" — and rollMaintenance sets that to the start Monday plus
   twelve weeks less a day, which is exactly planEnd. So the ring landed on
   the last browsable day of every maintenance block.
 *
 * These walk the whole browsable window rather than checking one month,
 * because the horizon is twelve weeks out and a single-month assertion would
 * pass while looking at the wrong month. The race plan is here as the control:
 * without it, deleting the ring outright would pass the maintenance test. */

const today = new Date();
const mon = startOfWeekMonday(today);

const base = over => ({
  name: 'T', fitness: 'intermediate',
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: iso(mon), ...over,
});

const noop = () => {};
const mount = async plan => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<CalendarView plan={plan} log={{}} moves={{}} open={noop} easedOf={w => w}
      onToggleWorkout={noop} onMove={noop} activities={null} onOpenRecording={noop} onAddWorkout={noop} />);
  });
  return { el, root };
};

// every month the athlete can reach, forwards from where it opens
const sweepForward = async (el, visit) => {
  for (let guard = 0; guard < 40; guard++) {
    visit(el.querySelector('.cal-head .ttl').textContent);
    const next = [...el.querySelectorAll('.cal-nav')][1];
    if (next.disabled) return;
    await act(async () => { next.click(); });
  }
  throw new Error('the month sweep never reached the end of the plan');
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('the gold race ring', () => {
  it('never appears anywhere in a maintenance block', async () => {
    const plan = generatePlan(base({
      raceType: 'maintenance', horizonWeeks: 12, raceDate: iso(addDays(mon, 12 * 7 - 1)),
    }));
    expect(plan.race).toBe('maintenance');
    const { el, root } = await mount(plan);

    const months = [];
    await sweepForward(el, label => {
      months.push(label);
      expect(el.querySelectorAll('.cal-day.race')).toHaveLength(0);
    });
    // the sweep has to have actually reached the horizon, or it proves nothing
    expect(months.length).toBeGreaterThanOrEqual(3);

    root.unmount(); el.remove();
  }, 20000);

  it('appears exactly once on a real race plan, on race day', async () => {
    const raceDate = iso(addDays(mon, 12 * 7));
    const plan = generatePlan(base({ raceType: 'olympic', raceDate }));
    const { el, root } = await mount(plan);

    let seen = 0;
    await sweepForward(el, () => {
      const ring = [...el.querySelectorAll('.cal-day.race')];
      seen += ring.length;
      ring.forEach(c => expect(c.getAttribute('data-caldate')).toBe(raceDate));
    });
    expect(seen).toBe(1);

    root.unmount(); el.remove();
  }, 20000);
});

/* The pin carries the DATE, which is the one thing about the race that no
   other surface shows — the top bar counts days — and it stays put while the
   athlete browses to a month the race is not in. It deliberately says nothing
   about how far away the race is. */
describe('the pinned race', () => {
  it('names the date and the race, and survives browsing away from its month', async () => {
    const raceDate = iso(addDays(mon, 12 * 7));
    const { el, root } = await mount(generatePlan(base({ raceType: 'olympic', raceDate })));

    const pin = () => el.querySelector('.cal-race-pin');
    expect(pin()).not.toBeNull();
    expect(pin().textContent).toContain('Olympic Triathlon');
    // the day-of-month, in whatever order the locale writes it
    expect(pin().textContent).toContain(String(Number(raceDate.slice(8))));
    // no countdown language: the top bar owns that, and two of them drift
    expect(pin().textContent).not.toMatch(/to go|days|day\b/i);

    const before = pin().textContent;
    await act(async () => { [...el.querySelectorAll('.cal-nav')][1].click(); });
    expect(el.querySelector('.cal-day.race')).toBeNull();   // race month left behind
    expect(pin().textContent).toBe(before);                 // the pin did not

    root.unmount(); el.remove();
  }, 20000);

  it('is absent with no race to pin, and once the date has passed', async () => {
    const maint = await mount(generatePlan(base({
      raceType: 'maintenance', horizonWeeks: 12, raceDate: iso(addDays(mon, 12 * 7 - 1)),
    })));
    expect(maint.el.querySelector('.cal-race-pin')).toBeNull();
    maint.root.unmount(); maint.el.remove();

    const past = await mount(generatePlan(base({
      startDate: iso(addDays(mon, -12 * 7)), raceType: 'olympic', raceDate: iso(addDays(today, -2)),
    })));
    expect(past.el.querySelector('.cal-race-pin')).toBeNull();
    past.root.unmount(); past.el.remove();
  }, 20000);
});
