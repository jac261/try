import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/* daysBetween/weeksBetween round an instant against local midnight, so a bare
   `new Date()` start comes out one day short from ~noon onward: the race chip
   read "0 days to go" on the eve's afternoon, and the post-race banner fired
   mid race day (review catch 2026-07-30). Pinned at the source level, like the
   TDZ guard in appOrder.test.js: every call must start from a calendar day —
   an ISO string or an iso()-wrapped Date — never a bare clock instant. */

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.jsx?$/.test(e) && !/\.test\.jsx?$/.test(e)) files.push(p);
  }
})(root);

describe('daysBetween call sites (afternoon-clock guard)', () => {
  it('scans a plausible slice of the source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no call passes a bare new Date() as either end — normalise with iso() first', () => {
    const offenders = files.filter(f =>
      /(?:days|weeks)Between\(\s*new Date\(|(?:days|weeks)Between\([^()\n]*,\s*new Date\(/
        .test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => relative(root, f))).toEqual([]);
  });
});
