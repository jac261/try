// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { RaceWeekCard } from '@/features/today/RaceWeekCard.jsx';
import * as T from '@/lib';

// Time flows through the component's `now` prop (same as the dev harness), so
// the fixtures are pure — no fake timers, no time-of-day sensitivity.
const NOW = new Date('2026-08-10T08:00:00');
const planAt = (days, race = 'olympic') =>
  ({ race, profile: { raceDate: T.iso(T.addDays(NOW, days)) }, weeks: [] });

// renderToString peppers comment nodes between JSX expressions
// ("1<!-- --> of <!-- -->3"); strip them so copy asserts read naturally.
const render = (plan, storage = mem()) =>
  renderToString(<RaceWeekCard plan={plan} storage={storage} now={NOW} />).replace(/<!-- -->/g, '');

const mem = () => {
  const m = {};
  return { load: (k, fb) => (k in m ? m[k] : fb), save: (k, v) => { m[k] = v; } };
};

describe('RaceWeekCard', () => {
  it('renders through the final week with the hero countdown', () => {
    const html = render(planAt(4));
    expect(html).toContain('Race week');
    expect(html).toContain('rw-num">4<');
    expect(html).toContain('Olympic Triathlon');
    expect(html).toContain('0 of 3 done');
  });

  it('stays hidden outside the window and for no-race blocks', () => {
    expect(render(planAt(8))).toBe('');
    expect(render(planAt(-1))).toBe('');
    expect(render(planAt(3, 'maintenance'))).toBe('');
    expect(render(planAt(3, 'tracker'))).toBe('');
  });

  it('counts calendar days, immune to the time of day', () => {
    // The clock-rounded daysBetween trap: an afternoon "now" rounds one day
    // short against a midnight race date, which showed race-day copy on the
    // eve and unmounted the card mid race day (review catch 2026-07-30).
    const afternoon = new Date('2026-08-10T16:30:00');
    const eve = renderToString(<RaceWeekCard plan={planAt(1)} storage={mem()} now={afternoon} />);
    expect(eve).toContain('rw-num">1<');
    expect(eve).not.toContain('Race day');
    const raceDay = renderToString(<RaceWeekCard plan={planAt(0)} storage={mem()} now={afternoon} />);
    expect(raceDay).toContain('Race day');
  });

  it('race day swaps the countdown for the flag, no stray zero', () => {
    const html = render(planAt(0));
    expect(html).toContain('Race day');
    expect(html).not.toContain('rw-num');
    expect(html).toContain('The work is banked');
  });

  it('solo run races drop the triathlon suffix and the swim recon copy', () => {
    const html = render(planAt(5, 'runhalf'));
    expect(html).toContain('Half Marathon');
    expect(html).not.toContain('Triathlon');
    expect(html).not.toContain('Swim exit');
    expect(html).not.toContain('wetsuit');
  });

  it('checklist rows are aria-pressed toggles with stable names', () => {
    const s = mem();
    const plan = planAt(4);
    s.save('racePrep', { sig: 'olympic:' + plan.profile.raceDate, done: { recon: true } });
    const html = render(plan, s);
    expect(html).toContain('aria-label="Recon the course" aria-pressed="true"');
    expect(html).toContain('aria-label="Prep your kit" aria-pressed="false"');
  });

  it('ignores persisted ticks from a different race signature', () => {
    const s = mem();
    s.save('racePrep', { sig: 'sprint:2026-01-01', done: { recon: true, kit: true, fuel: true } });
    expect(render(planAt(4), s)).toContain('0 of 3 done');
  });

  it('honours persisted ticks for the current signature', () => {
    const s = mem();
    const plan = planAt(4);
    s.save('racePrep', { sig: 'olympic:' + plan.profile.raceDate, done: { recon: true } });
    const html = render(plan, s);
    expect(html).toContain('1 of 3 done');
    expect(html).toContain('wk rw-item done');
  });
});
