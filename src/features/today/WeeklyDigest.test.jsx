// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { WeeklyDigest } from './WeeklyDigest.jsx';
import { generatePlan } from '@/lib/plan.js';

/* The digest crashed the entire app on Dismiss: a useState sat below two
   early returns, so the render after dismissing mounted fewer hooks than the
   first and React threw its invariant straight into the app error boundary.
   The seen flag persisted before the crash, so a reload looked fine and the
   field signature was an unreproducible glitch. This pins hook placement
   STRUCTURALLY: every hook call must appear before the first early return. */
describe('WeeklyDigest hook order', () => {
  it('declares every hook before the first early return', () => {
    const src = readFileSync('src/features/today/WeeklyDigest.jsx', 'utf8');
    const body = src.slice(src.indexOf('export function WeeklyDigest'));
    const firstReturn = body.search(/\breturn null;/);
    expect(firstReturn).toBeGreaterThan(0);
    const afterReturn = body.slice(firstReturn);
    expect(afterReturn).not.toMatch(/\buse(State|Effect|Memo|Ref|Callback|Context)\s*\(/);
  });
});

/* The race line is calendar language by design: the A race carries no log
   entry, so the card may say when race day was — never whether it happened
   or how it went ("Race day: X. Done." shipped once, and the data-shape
   tests alone let it; gauntlet catch 2026-07-30). This renders the real
   thing: a generated plan whose race sits in the reviewed week, wrapped the
   Monday after. */
describe('the race week digest renders', () => {
  const plan = generatePlan({
    name: 'T', raceType: 'olympic', fitness: 'intermediate',
    fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
    trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
    startDate: '2026-05-04', raceDate: '2026-07-12',
  });
  const storage = { load: () => null, save: () => {} };
  const render = (over = {}) => renderToString(
    <WeeklyDigest plan={plan} log={{}} moves={{}} adjust={{}} adjustLog={[]}
      wellness={[]} activities={null} storage={storage} todayISO="2026-07-13"
      coachLog={null} blockReviewed={null} onBlockReviewed={() => {}} onFocus={() => {}} {...over} />);

  /* Embedded, this is a section of the Your week card rather than a card of
     its own — the two used to sit stacked, carrying the same three numbers,
     one of them under the title the other now wears. */
  it('embedded: drops its own card and title, keeps its own range line', () => {
    const bare = render({ embedded: true });
    expect(bare).not.toMatch(/class="card"/);
    expect(bare).not.toContain('section-title');
    /* It still says WHICH week it reviews. The strip above is live on the
       current week while this reviews a finished one, and from Monday to
       Wednesday those differ: one heading over both would put one week's
       numbers under another week's name. */
    expect(bare).toContain('Week in review');
    expect(bare).toContain('yw-review');
  });

  it('stands alone unchanged when it is not embedded', () => {
    const out = render();
    expect(out).toContain('section-title');
    expect(out).toContain('Your week');
    expect(out).toMatch(/class="card"/);
  });

  it('shows the race as a calendar fact, with the generated title bare', () => {
    let html;
    expect(() => { html = render(); }).not.toThrow();
    // the generator's own title, once — not "Race day: RACE DAY — …"
    expect(html).toContain('RACE DAY — Olympic');
    expect(html).not.toMatch(/Race day:/);
  });

  it('never wears outcome words the log cannot back', () => {
    const html = render();
    expect(html).not.toContain('Done.');
    // the race must not sit in the didn&#x27;t-happen list (renderToString
    // escapes the apostrophe, so match on the stable tail of the line)
    expect(html).not.toMatch(/happen:[^<]*RACE DAY/);
  });
});

/* The reason lives on the missed row now (the digest classifies through
   classifyCompletion), so the line can say what the athlete told it. The
   words come from MISSED_REASONS, not from a second copy here. */
describe('the missed line', () => {
  const plan = {
    race: 'olympic', totalWeeks: 2,
    weeks: [{ index: 0, phase: 'Build', workouts: [
      { id: 'a', date: '2026-07-07', discipline: 'run', type: 'Threshold', title: 'Threshold Run', durationMin: 50 },
      { id: 'b', date: '2026-07-09', discipline: 'bike', type: 'Endurance', title: 'Endurance Ride', durationMin: 75 },
    ] }],
  };
  const storage = { load: () => null, save: () => {} };
  const render = over => renderToString(
    <WeeklyDigest plan={plan} log={{}} moves={{}} adjust={{}} adjustLog={[]}
      wellness={[]} activities={null} storage={storage} todayISO="2026-07-13"
      coachLog={null} blockReviewed={null} onBlockReviewed={() => {}} onFocus={() => {}} {...over} />);

  it("names the athlete's answer beside the day, and stays bare without one", () => {
    const html = render({ missedReasons: { a: { reason: 'niggle', at: '2026-07-08T08:00:00Z' } } });
    expect(html).toContain('Threshold Run (Tue, an injury niggle)');
    expect(html).toMatch(/Endurance Ride \(Thu\)/);   // no answer, no invention
  });

  it('invents nothing when the stored answer is not one of the four', () => {
    const html = render({ missedReasons: { a: { reason: 'weather', at: '2026-07-08T08:00:00Z' } } });
    expect(html).toContain('Threshold Run (Tue)');
    expect(html).not.toContain('weather');
  });
});
