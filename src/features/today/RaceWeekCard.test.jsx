// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { RaceWeekCard } from '@/features/today/RaceWeekCard.jsx';
import * as T from '@/lib';

// The card shares the race-chip's clock-rounded daysBetween, so "now" is
// pinned to a morning: an afternoon test run would round every fixture one
// day short (the -16h/24 trap the chip clamps away).
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-10T08:00:00')); });
afterAll(() => vi.useRealTimers());

const planAt = (days, race = 'olympic') =>
  ({ race, profile: { raceDate: T.iso(T.addDays(new Date(), days)) }, weeks: [] });

// renderToString peppers comment nodes between JSX expressions
// ("1<!-- --> of <!-- -->3"); strip them so copy asserts read naturally.
const render = el => renderToString(el).replace(/<!-- -->/g, '');

const mem = () => {
  const m = {};
  return { load: (k, fb) => (k in m ? m[k] : fb), save: (k, v) => { m[k] = v; } };
};

describe('RaceWeekCard', () => {
  it('renders through the final week with the hero countdown', () => {
    const html = render(<RaceWeekCard plan={planAt(4)} storage={mem()} />);
    expect(html).toContain('Race week');
    expect(html).toContain('rw-num">4<');
    expect(html).toContain('Olympic Triathlon');
    expect(html).toContain('0 of 3 done');
  });

  it('stays hidden outside the window and for no-race blocks', () => {
    expect(render(<RaceWeekCard plan={planAt(8)} storage={mem()} />)).toBe('');
    expect(render(<RaceWeekCard plan={planAt(-1)} storage={mem()} />)).toBe('');
    expect(render(<RaceWeekCard plan={planAt(3, 'maintenance')} storage={mem()} />)).toBe('');
    expect(render(<RaceWeekCard plan={planAt(3, 'tracker')} storage={mem()} />)).toBe('');
  });

  it('race day swaps the countdown for the flag, no stray zero', () => {
    const html = render(<RaceWeekCard plan={planAt(0)} storage={mem()} />);
    expect(html).toContain('Race day');
    expect(html).not.toContain('rw-num');
    expect(html).toContain('The work is banked');
  });

  it('solo run races drop the triathlon suffix and the swim recon copy', () => {
    const html = render(<RaceWeekCard plan={planAt(5, 'runhalf')} storage={mem()} />);
    expect(html).toContain('Half Marathon');
    expect(html).not.toContain('Triathlon');
    expect(html).not.toContain('Swim exit');
    expect(html).not.toContain('wetsuit');
  });

  it('ignores persisted ticks from a different race signature', () => {
    const s = mem();
    s.save('racePrep', { sig: 'sprint:2026-01-01', done: { recon: true, kit: true, fuel: true } });
    const html = render(<RaceWeekCard plan={planAt(4)} storage={s} />);
    expect(html).toContain('0 of 3 done');
  });

  it('honours persisted ticks for the current signature', () => {
    const s = mem();
    const plan = planAt(4);
    s.save('racePrep', { sig: 'olympic:' + plan.profile.raceDate, done: { recon: true } });
    const html = render(<RaceWeekCard plan={plan} storage={s} />);
    expect(html).toContain('1 of 3 done');
    expect(html).toContain('wk done');
  });
});
