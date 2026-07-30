// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { DetailSheet } from '@/components/DetailSheet.jsx';
import { generatePlan } from '@/lib/plan.js';

/* Reported 2026-07-30: tapping a previous activity in the calendar replays the
 * recap every time, with no way to reach the overview.
 *
 * openRecording has three paths and only two of them honoured the seen flag:
 *
 *   matched workout   -> second tap: setDetail(workout)        (correct)
 *   manual entry      -> second tap: opens the edit sheet      (correct)
 *   unplanned recording -> setRecap(...) unconditionally       (the bug)
 *
 * The third called markRecapSeen and then never READ the flag, so it wrote
 * "seen" forever and acted on it never. The recap's own way out was also
 * disabled for ad-hoc sessions (`onDetails={w.adhoc ? null : ...}`), so there
 * was no route to the overview from either direction.
 *
 * These assert the SEQUENCE at the source, because the defect is a missing
 * branch rather than a wrong value: nothing rendered wrongly, an unreachable
 * state was simply unreachable.
 */

const APP = readFileSync('src/app/App.jsx', 'utf8');
const openRecording = APP.slice(APP.indexOf('const openRecording = arg =>'), APP.indexOf('const moveWorkout ='));

describe('openRecording honours the seen flag on every path', () => {
  it('all three paths read the flag, not just write it', () => {
    // one read per path: matched, manual, unplanned
    const reads = openRecording.match(/if \(\s*(?:a &&\s*)?seen\w*\[a\.id\]\s*\)/g) || [];
    expect(reads.length, 'a path writes markRecapSeen without reading it').toBe(3);
    const writes = openRecording.match(/markRecapSeen\(/g) || [];
    expect(writes.length).toBe(3);
  });

  it('the unplanned path routes a second tap to the overview', () => {
    const tail = openRecording.slice(openRecording.indexOf('const adhoc = {'));
    expect(tail).toMatch(/seenAdhoc\[a\.id\]/);
    expect(tail).toMatch(/setDetail\(adhoc\)/);
    // and the recap still happens on the FIRST tap
    expect(tail).toMatch(/setRecap\(\{ workout: adhoc, activity: a \}\)/);
  });

  it('the recap and the overview share one workout object', () => {
    // Two literals would let the deck and the sheet describe the same session
    // differently — the drift this codebase keeps finding.
    const tail = openRecording.slice(openRecording.indexOf('const adhoc = {'));
    expect((tail.match(/adhoc: true/g) || []).length).toBe(1);
  });

  it('the recap deck offers its details exit for ad-hoc sessions too', () => {
    expect(APP).not.toMatch(/onDetails=\{w\.adhoc \? null/);
    // detail takes the RAW plan workout (the sheet applies the adjustment
    // overlay itself; handing it the eased object would transform twice)
    expect(APP).toMatch(/onDetails=\{\(\) => \{ setRecap\(null\); setDetail\(recap\.workout\); \}\}/);
  });

  it('an ad-hoc overview resolves its recording and counts as done', () => {
    // Its id encodes the activity; there is no log entry to read it from.
    expect(APP).toMatch(/detail\.adhoc\s*\n?\s*\?\s*\(displayActivities \|\| \[\]\)\.find/);
    expect(APP).toMatch(/done=\{detail\.adhoc \|\| !!log\[detail\.id\]\}/);
  });
});

describe('the ad-hoc overview renders', () => {
  const plan = generatePlan({
    name: 'T', raceType: 'olympic', fitness: 'intermediate',
    fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
    trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
    startDate: '2026-06-01', raceDate: '2026-10-03',
  });
  const activity = { id: 'a9', date: '2026-06-03', type: 'Run', name: 'Lunch run', movingTimeSec: 2400, distance: 8000 };
  const adhoc = { id: 'adhoc-a9', adhoc: true, title: 'Lunch run', discipline: 'run', durationMin: 40 };

  const render = () => renderToString(
    <DetailSheet w={adhoc} plan={plan} done activity={activity} eff={activity.date}
      onClose={() => {}} onToggle={() => {}} onMove={() => {}} onResetMove={() => {}}
      onLogResult={() => {}} feel={null} onFeel={() => {}} onRestore={() => {}}
      onRemove={null} onLoadIntervals={() => {}} onSupport={() => {}} onWhatIf={null}
      onReplayRecap={() => {}} fuelLog={{}} onFuel={() => {}} positionLog={{}}
      onPosition={() => {}} brick={null} onCue={() => {}} cueAnswer={null} />);

  it('shows the session and its recorded numbers, without throwing', () => {
    let html;
    expect(() => { html = render(); }).not.toThrow();
    expect(html).toContain('Lunch run');
    expect(html).toContain('How it went');   // the review section it exists for
    expect(html).toContain('Replay recap');  // the way back into the deck
  });

  it('offers no complete toggle: an ad-hoc session occupies no plan slot', () => {
    // Marking it complete would log against a workout id no plan contains.
    const html = render();
    expect(html).not.toContain('Mark as complete');
    expect(html).not.toContain('tap to undo');
  });
});
