import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as T from '@/lib';

/* Every `T.<member>` the app reaches for must exist on the barrel. This bug
   class has now shipped twice: bike-execution.js was once written and never
   added to the barrel (BikeExecution.test.jsx grew a hand-listed guard), and
   durability-shape.js repeated it in #53 — `import * as T` makes a missing
   export a silent undefined, and a call inside an async effect dies as an
   unhandled rejection, so the durability charts' engine never reached a
   shipped bundle at all until 2026-08-04. A hand list only guards the names
   someone remembered; this scrapes them.

   Test files are excluded from the scan: BikeExecution.test.jsx deliberately
   names T.somethingThatIsNotExported as its own counter-example. Comments
   are scanned too — strict on purpose, since a comment reaching for a
   T.member that does not exist is a stale comment worth failing on. */

const ROOTS = ['src/app', 'src/features', 'src/components', 'src/dev'];

const sources = dir => readdirSync(dir).flatMap(name => {
  const p = join(dir, name);
  if (statSync(p).isDirectory()) return sources(p);
  if (!/\.(js|jsx)$/.test(name) || /\.test\.(js|jsx)$/.test(name)) return [];
  return [p];
});

describe('the lib barrel', () => {
  it('exports every T.member any non-test source reaches for', () => {
    const used = new Set();
    for (const root of ROOTS) {
      for (const file of sources(root)) {
        for (const m of readFileSync(file, 'utf8').matchAll(/\bT\.([A-Za-z_]\w*)/g)) {
          used.add(m[1]);
        }
      }
    }
    // sanity: the scrape found the app's real usage, not an empty tree
    expect(used.size).toBeGreaterThan(150);
    const missing = [...used].filter(name => !(name in T)).sort();
    expect(missing, 'used in app code but absent from src/lib/index.js: ' + missing.join(', ')).toEqual([]);
    // 30s: walks and regexes four whole source roots, and a loaded machine has
    // pushed that past the 5s default. See the note in bike-durability.test.js.
  }, 30000);
});
