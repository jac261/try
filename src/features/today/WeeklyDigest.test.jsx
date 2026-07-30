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
  const render = () => renderToString(
    <WeeklyDigest plan={plan} log={{}} moves={{}} adjust={{}} adjustLog={[]}
      wellness={[]} activities={null} storage={storage} todayISO="2026-07-13"
      coachLog={null} blockReviewed={null} onBlockReviewed={() => {}} onFocus={() => {}} />);

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
