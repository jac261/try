// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { CalendarView } from '@/features/calendar/CalendarView.jsx';
import { App } from '@/app/App.jsx';
import { storageForUser } from '@/app/storage.js';
import { buildTrackerPlan, generatePlan } from '@/lib/plan.js';
import { iso } from '@/lib/date.js';

/* The calendar's add-a-session cards (Jon, 2026-07-17): one heading and one
   card design in both modes, full discipline colour, icon front and centre,
   no hint line — and the full add/remove journey through the real App. */

const trackerPlan = () => buildTrackerPlan(generatePlan({
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: '2026-01-05', raceDate: '2026-04-05',
}), iso(new Date()));

describe('the add-a-session cards', () => {
  const base = { plan: trackerPlan(), log: {}, moves: {}, open: () => {}, easedOf: w => w, onToggleWorkout: () => {}, onMove: () => {}, activities: null, onOpenRecording: () => {} };

  it('say Add a session in tracker mode too, with no hint line', () => {
    const html = renderToString(<CalendarView {...base} onAddWorkout={() => {}} />);
    expect(html).toContain('Add a session');
    expect(html).not.toContain('Log a session');
    expect(html).not.toContain('+ Log');
    expect(html).not.toContain('+ Add');
  });

  it('wear the full discipline colour with the icon large and centred, strength included', () => {
    const html = renderToString(<CalendarView {...base} onAddWorkout={() => {}} />);
    // gradient background inlined on each card, icon at the large size
    expect((html.match(/cal-add-card/g) || []).length).toBe(4);
    expect(html).toContain('Strength');
    expect((html.match(/linear-gradient/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('width="32"');
  });

  it('tapping a card reports the sport and the selected day', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const got = [];
    await act(async () => {
      createRoot(el).render(<CalendarView {...base} onAddWorkout={(k, d) => got.push([k, d])} />);
    });
    [...el.querySelectorAll('.cal-add-card')][1].click();
    expect(got).toEqual([['bike', iso(new Date())]]);
    el.remove();
  });
});

describe('the full add and remove journey (tracker diary via the calendar)', () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.fetch = () => Promise.reject(new Error('offline'));
    globalThis.confirm = () => true;
  });

  it('adds a session from the calendar cards and removes it from its edit sheet', async () => {
    const storage = storageForUser('simuser');
    storage.save('plan', trackerPlan());
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(<App storage={storage} getToken={async () => null} user={{ imageUrl: null }} />);
    });
    // splash hold runs 2.6s (spin + three pulses); let it and hydration settle
    await act(async () => { await new Promise(r => setTimeout(r, 2800)); });

    // to the calendar tab
    const navBtn = [...el.querySelectorAll('.nav button')].find(b => b.textContent.includes('Calendar'));
    await act(async () => { navBtn.click(); });

    // tap the Run card, sheet opens in log mode for today
    const runCard = [...el.querySelectorAll('.cal-add-card')][0];
    await act(async () => { runCard.click(); });
    expect(el.querySelector('.sheet')).toBeTruthy();
    expect(el.querySelector('.sheet h2').textContent).toBe('Log a session');

    // submit: the diary gains the session, the Recorded list shows it Logged
    const submit = [...el.querySelectorAll('.sheet button')].find(b => b.textContent.startsWith('Log for'));
    await act(async () => { submit.click(); });
    expect(storage.loadManualActivities().length).toBe(1);
    expect(el.textContent).toContain('Logged');
    // and the session is on the calendar itself: the day cell gains a
    // recorded dot and announces it (Jon, 2026-07-17: added sessions must
    // land on the calendar)
    const todayCell = el.querySelector('.cal-day.today');
    expect(todayCell.querySelectorAll('.cd-dots i.done').length).toBe(1);
    expect(todayCell.getAttribute('aria-label')).toContain('1 recorded session');

    // first tap on the row celebrates (recap deck), close it
    const row = [...el.querySelectorAll('.wk')].find(r => (r.getAttribute('aria-label') || '').startsWith('Open '));
    await act(async () => { row.click(); });
    const closeRecap = el.querySelector('[aria-label="Close recap"], .recap-close, .scrim');
    expect(closeRecap).toBeTruthy();
    await act(async () => { closeRecap.click(); });

    // second tap opens the edit sheet; Remove deletes the entry
    const row2 = [...el.querySelectorAll('.wk')].find(r => (r.getAttribute('aria-label') || '').startsWith('Open '));
    await act(async () => { row2.click(); });
    const remove = [...el.querySelectorAll('button')].find(b => b.textContent === 'Remove this session');
    expect(remove).toBeTruthy();
    await act(async () => { remove.click(); });
    expect(storage.loadManualActivities().length).toBe(0);
    expect(el.textContent).not.toContain('Logged');
    root.unmount();
    el.remove();
  }, 20000);
});
