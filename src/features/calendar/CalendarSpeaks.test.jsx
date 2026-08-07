// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { CalendarView } from '@/features/calendar/CalendarView.jsx';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';
import { LoadSlot } from '@/components/LoadSlot.jsx';
import { RecordedActivities } from '@/components/RecordedActivities.jsx';
import { generatePlan } from '@/lib/plan.js';
import { iso, addDays, startOfWeekMonday } from '@/lib/date.js';

/* One house rule, four places it was broken: a visible ~ means "modelled,
   not measured", and a marker the eye gets while the ear gets nothing is a
   silent difference between what the screen says and what the athlete hears
   (calendar audit, 2026-08-06). The tilde is punctuation; screen readers
   skip it, so every site that prints one has to say "about" somewhere a
   screen reader will reach.

   The four are deliberately in one file: they are one rule, and a rule with
   its examples scattered across four suites is a rule that gets half-applied
   the next time somebody prints a number. */

const mon = iso(startOfWeekMonday('2026-08-05'));
const TODAY = '2026-08-05';
const profile = (over = {}) => ({
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: iso(addDays(mon, -28)), raceDate: iso(addDays(mon, 84)), ...over,
});

const noop = () => {};
const mount = async (extra = {}) => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<CalendarView plan={generatePlan(profile())} log={{}} moves={{}} open={noop}
      easedOf={w => w} onToggleWorkout={noop} onMove={noop} activities={null}
      onOpenRecording={noop} onAddWorkout={noop} todayISO={TODAY} {...extra} />);
  });
  const toWeek = async () => act(async () => {
    [...el.querySelectorAll('.segbar button')].find(b => b.textContent === 'Week').click();
  });
  return { el, toWeek, done: async () => { await act(async () => root.unmount()); el.remove(); } };
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('the estimate marker is spoken, not just printed', () => {
  const w = { id: 'x', discipline: 'run', type: 'Easy', title: 'Easy run', durationMin: 45, date: TODAY };

  /* Read as TEXT, not as markup: SSR splits adjacent expressions with
     comment markers, so a string assertion on the html would be testing
     React's serialiser rather than the row. */
  const text = node => { const d = document.createElement('div'); d.innerHTML = renderToString(node); return d.textContent; };

  it('a planned row says "about" beside its modelled load', () => {
    /* From INSIDE the slot, as a visually-hidden word. WorkoutRow has no
       aria-label on purpose (its comment says why), so its accessible name is
       built from its content — which means the fix has to be content. */
    const est = text(<WorkoutRow w={w} done={false} eff={w.date} onClick={noop}
      right={<LoadSlot tss={42} measured={false} />} />);
    expect(est).toContain('about ');
    expect(est).toContain('~42');
  });

  it('a measured row says no such thing', () => {
    // The word tracks the marker. A row that measured its load has no tilde
    // and must not gain a hedge the number does not carry.
    const real = text(<WorkoutRow w={w} done eff={w.date} onClick={noop}
      right={<LoadSlot tss={42} measured />} />);
    expect(real).not.toContain('about ');
    expect(real).not.toContain('~42');
  });

  it('an estimated distance is spoken too', () => {
    // Same rule, the other tilde on the same row.
    const est = text(<WorkoutRow w={{ ...w, distance: 8, unit: 'km', distEst: true }}
      done={false} eff={w.date} onClick={noop} />);
    expect(est).toContain('about ');
    expect(est).toContain('~8 km');
    const known = text(<WorkoutRow w={{ ...w, distance: 8, unit: 'km' }}
      done={false} eff={w.date} onClick={noop} />);
    expect(known).not.toContain('about ');
  });

  it('the week header carries a spoken twin when its total is modelled', async () => {
    /* The header is one string in one element, so it gets an aria-label —
       and only when the two differ, so a fully measured week is not given a
       label that merely repeats it. */
    const acts = [{ id: 'a1', type: 'Ride', name: 'Club ride', date: iso(addDays(mon, 1)),
      movingTimeSec: 3600, distance: 30000 }];   // no trainingLoad: modelled
    const { el, toWeek, done } = await mount({ activities: acts });
    await toWeek();
    const head = el.querySelector('.wk-head');
    expect(head.textContent).toContain('~');
    expect(head.getAttribute('aria-label')).toContain('about ');
    expect(head.getAttribute('aria-label')).not.toContain('~');
    await done();
  });

  it('a fully measured week header is left unlabelled', async () => {
    const acts = [{ id: 'a1', type: 'Ride', name: 'Club ride', date: iso(addDays(mon, 1)),
      movingTimeSec: 3600, distance: 30000, trainingLoad: 55 }];
    const { el, toWeek, done } = await mount({ activities: acts });
    await toWeek();
    const head = el.querySelector('.wk-head');
    expect(head.textContent).not.toContain('~');
    expect(head.getAttribute('aria-label')).toBe(null);
    await done();
  });

  it('a recorded row says "about load" where its line prints "~load"', () => {
    /* This row DOES own an aria-label (it opens something, and the label
       says which), so the substitution happens where the label is built. The
       visible line keeps the tilde: the rule is that both say the same
       thing, not that either gives up its own idiom. */
    const plan = generatePlan(profile());
    const date = iso(addDays(mon, 1));
    const act1 = { id: 'r1', type: 'Ride', name: 'Club ride', date, movingTimeSec: 3600,
      distance: 30000, trainingLoad: 55, estimated: true };
    const html = renderToString(<RecordedActivities activities={[act1]} date={date} plan={plan}
      log={{}} moves={{}} onOpen={noop} />);
    expect(html).toContain('~load');
    expect(html).toMatch(/aria-label="[^"]*about load/);
  });
});
