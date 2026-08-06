// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { RecordedActivities } from '@/components/RecordedActivities.jsx';
import { CalendarView } from '@/features/calendar/CalendarView.jsx';
import { generatePlan } from '@/lib/plan.js';

/* Production error, reported 2026-07-30: tapping a calendar box threw
 * "plan is not defined" and the whole app fell to the error boundary.
 *
 * statBits is a MODULE-LEVEL function taking (a, disc). Its swim branch
 * referenced `plan`, which was never in its scope — a straight
 * ReferenceError, shipped in the pool-profile phase. It only fired on the
 * one path that reached that branch: an OUTDOOR swim recording carrying both
 * a duration and a distance. Every other discipline, and any indoor swim,
 * returned before touching it, which is why it survived a full swim
 * build-out, a bike arc, a run arc and an audit.
 *
 * The lesson for the fixture: exercising "a calendar day" is not the same as
 * exercising "a calendar day with a swim recording on it". These tests render
 * the specific shape that crashed.
 */

const profile = {
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: '2026-06-01', raceDate: '2026-10-03',
};
const DATE = '2026-06-03';
const swim = { id: 's1', date: DATE, type: 'Swim', name: 'Morning swim', movingTimeSec: 1800, distance: 1500 };

describe('RecordedActivities (production ReferenceError 2026-07-30)', () => {
  const plan = generatePlan(profile);

  it('renders an outdoor swim recording without throwing', () => {
    // THE crash case. Before the fix this threw "plan is not defined".
    let html;
    expect(() => {
      html = renderToString(<RecordedActivities activities={[swim]} date={DATE} plan={plan} log={{}} moves={{}} onOpen={() => {}} />);
    }).not.toThrow();
    expect(html).toContain('Morning swim');
    expect(html).toMatch(/\/100/); // the pace it exists to show
  });

  it('speaks its stats: the label must not replace the line it sits above', () => {
    /* aria-label REPLACES the accessible name, so pace, distance and
       duration were rendered for the eye and announced to nobody (audit
       2026-08-05). */
    const html = renderToString(<RecordedActivities activities={[swim]} date={DATE} plan={plan} log={{}} moves={{}} onOpen={() => {}} />);
    const label = (html.match(/aria-label="([^"]*Morning swim[^"]*)"/) || [])[1] || '';
    expect(label).toContain('Morning swim');
    expect(label).toMatch(/\/100/);   // the same pace the row shows
  });

  it('renders a swim with no plan at all, and with no profile', () => {
    // poolFor must absorb both: a tracker has no weeks, and a half-hydrated
    // plan can arrive without a profile.
    expect(() => renderToString(<RecordedActivities activities={[swim]} date={DATE} plan={null} log={{}} moves={{}} onOpen={() => {}} />)).not.toThrow();
    expect(() => renderToString(<RecordedActivities activities={[swim]} date={DATE} plan={{}} log={{}} moves={{}} onOpen={() => {}} />)).not.toThrow();
  });

  it('renders every discipline, indoor and out', () => {
    const acts = [
      swim,
      { id: 'p1', date: DATE, type: 'Swim', name: 'Pool set', movingTimeSec: 1800, distance: 1500 },
      { id: 'r1', date: DATE, type: 'Run', name: 'Easy run', movingTimeSec: 2400, distance: 8000 },
      { id: 'b1', date: DATE, type: 'Ride', name: 'Spin', movingTimeSec: 3600, distance: 30000 },
      { id: 'v1', date: DATE, type: 'VirtualRun', name: 'Treadmill', movingTimeSec: 1800, distance: 5000 },
      { id: 'v2', date: DATE, type: 'VirtualRide', name: 'Trainer', movingTimeSec: 3600, distance: 30000 },
      { id: 'o1', date: DATE, type: 'OpenWaterSwim', name: 'Lake', movingTimeSec: 1500, distance: 1200 },
    ];
    expect(() => renderToString(<RecordedActivities activities={acts} date={DATE} plan={plan} log={{}} moves={{}} onOpen={() => {}} />)).not.toThrow();
  });

  it('the calendar renders a day that has a swim recording on it', () => {
    // The user-facing path: the crash surfaced through CalendarView, which
    // renders RecordedActivities for the selected day.
    expect(() => renderToString(
      <CalendarView plan={plan} log={{}} moves={{}} open={() => {}} easedOf={w => w}
        onToggleWorkout={() => {}} onMove={() => {}} activities={[swim]}
        onOpenRecording={() => {}} onAddWorkout={() => {}} />)).not.toThrow();
  });
});

describe('no component references an identifier it does not have', () => {
  it('statBits takes its pool as an argument rather than reaching for a scope', async () => {
    /* Asserted on the source, because the value tests above only cover the
       paths a fixture happens to reach — and this bug lived in the one branch
       no fixture reached. A module-level helper reaching for `plan` is the
       shape of the defect, so that shape is what this forbids. */
    // cwd-relative, not import.meta.url: under happy-dom that is not a
    // file:// URL and readFileSync rejects it.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/RecordedActivities.jsx', 'utf8');
    const helper = src.slice(src.indexOf('function statBits('), src.indexOf('function Row('));
    /* The signature is pinned by its ARGUMENTS, not its arity: it gained a
       withLoad flag when the week's rows moved the number into their own
       slot, and the guard that matters is that every value it uses arrives
       as one of them. */
    expect(helper).toMatch(/function statBits\(a, disc, pool(, \w+)*\)/);
    expect(helper).not.toMatch(/\bplan\b/);
  });
});
