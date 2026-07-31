import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/* daysBetween/weeksBetween used to round an instant against local midnight,
   so a bare `new Date()` end came out one day short from ~noon onward: the
   race chip read "0 days to go" on the eve's afternoon, and the post-race
   banner fired mid race day (race-chip catch 2026-07-30). The helpers now pin
   both ends to local midnight internally, so a clock instant can no longer
   miscount — this guard is belt-and-braces, kept at the source level like the
   TDZ guard in app/appOrder.test.js: call sites stay uniform (ISO strings, or
   a Date pinned via iso()/startOfWeekMonday), so a reader never has to know
   which helpers normalise and which don't (addDays does NOT zero the time).

   A regex can only see so far: a clock instant hoisted to a variable, an
   aliased import, or one nested inside another helper all pass this guard
   unseen — the internal pinning in date.js is what actually covers those. */

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name)) files.push(p);
  }
})(root);

// Comments and string/template literals must not count as call sites — the
// prose form "daysBetween(new Date(), x)" appears in trap notes by design.
const code = f => readFileSync(f, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => {
    const c = l.indexOf('//');
    return (c >= 0 ? l.slice(0, c) : l).replace(/'[^'\n]*'/g, "''").replace(/`[^`\n]*`/g, '``');
  }).join('\n');

// A Between call whose argument list contains a bare `new Date()` or
// `Date.now()` at nesting depth 0 or 1 — either end, multiline, and not
// hidden behind iso()/startOfWeekMonday (whose own parens break the match).
const OFFENDER = /(?:days|weeks)Between\((?:[^()]|\([^()]*\))*(?:new Date\(\)|Date\.now\(\))/;

describe('daysBetween call sites (afternoon-clock guard)', () => {
  it('scans a plausible slice of the source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no call takes a literal new Date() or Date.now() as either end — normalise with iso() first', () => {
    const offenders = files.filter(f => OFFENDER.test(code(f)));
    expect(offenders.map(f => relative(root, f))).toEqual([]);
  });

  it('the offender pattern still recognises the shapes it exists to catch', () => {
    for (const bad of [
      'T.daysBetween(new Date(), plan.profile.raceDate)',
      'daysBetween(T.iso(x.date), new Date())',
      'weeksBetween(Date.now(), raceDate)',
      'daysBetween(\n    w.date,\n    new Date())',
    ]) expect(OFFENDER.test(bad), bad).toBe(true);
    for (const ok of [
      'T.daysBetween(T.iso(new Date()), plan.profile.raceDate)',
      'daysBetween(startOfWeekMonday(new Date()), f.raceDate)',
      "daysBetween('2026-09-20', '2026-09-27')",
    ]) expect(OFFENDER.test(ok), ok).toBe(false);
  });
});
