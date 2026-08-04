import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// App renders a splash / onboarding / building screen via early returns. Any
// effect declared above those returns still FIRES after such a render commits,
// but every const declared below the return is left in its temporal dead zone
// for that invocation — touching one throws "cannot access before
// initialization" and takes the whole app down. This shipped twice (2026-07-11
// and 2026-07-15, both via easedOf), so the ordering is pinned here at the
// source level: whatever a pre-return hook closes over must be declared above
// the first early return.
const src = readFileSync(fileURLToPath(new URL('./App.jsx', import.meta.url)), 'utf8');

const code = src.split('\n').map(l => {
  const c = l.indexOf('//');
  // drop comments and string-literal contents: 'tracker' the string must not
  // count as a reference to a `tracker` binding
  return (c >= 0 ? l.slice(0, c) : l).replace(/'[^'\n]*'/g, "''").replace(/`[^`\n]*`/g, '``');
}).join('\n');

describe('durability backfill: the freeze releases before the sweep', () => {
  /* No unit test can see this timing — the effect is one async body — so the
     sequence is pinned at the source, the openRecording pattern. The coach
     freeze waits on durabilityDone, which must flip the moment the two fresh
     reads finish: the store sweep that follows only attaches shapes, can
     never change a decision, and must never make the athlete wait. Busy is
     released last so a re-render cannot start a second overlapping body. */
  const body = src.slice(src.indexOf('durabilityBusy.current = true;'), src.indexOf('// deps deliberately EXCLUDE'));

  it('finds the async backfill body where it expects it', () => {
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain('for (const c of fresh)');
    expect(body).toContain('for (const spec of queue)');
  });

  it('setDurabilityDone(true) sits between the fresh reads and the sweep', () => {
    const done = body.indexOf('setDurabilityDone(true)');
    expect(done).toBeGreaterThan(body.indexOf('for (const c of fresh)'));
    expect(done).toBeLessThan(body.indexOf('for (const spec of queue)'));
  });

  it('busy is held across both stages and released after the sweep', () => {
    expect(body.indexOf('durabilityBusy.current = false')).toBeGreaterThan(body.indexOf('for (const spec of queue)'));
  });
});

describe('App.jsx declaration order (TDZ guard)', () => {
  // anchor on the splash early return itself, not on effect guards that also
  // test !hydrated (matching those made `above` end before the effects and
  // blinded the sweep entirely)
  const firstReturn = code.search(/\n\s*if \([^\n]*\) return <Splash/);

  it('has the early-return block where this test expects it', () => {
    expect(firstReturn).toBeGreaterThan(0);
  });

  it('easedOf is declared above the first early return and above its first use', () => {
    const decl = code.indexOf('const easedOf');
    expect(decl).toBeGreaterThan(0);
    expect(decl).toBeLessThan(firstReturn);
    expect(decl).toBeLessThan(code.indexOf('easedOf,')); // buildWatchEvents call site
  });

  it('no hook above the early returns closes over a const declared below them', () => {
    const above = code.slice(0, firstReturn);
    const below = code.slice(firstReturn);
    // consts/lets declared below the first early return, still in this
    // component's function scope (indented declarations only)
    // short names (w, a, t...) are overwhelmingly arrow params that shadow —
    // the regex scope check can't see params, so only meaningful names count
    const decls = [...below.matchAll(/\n\s+(?:const|let)\s+(\w{3,})\s*=/g)].map(m => m[1]);
    // hook callback bodies above the returns: block-bodied arrows scan to the
    // dependency array (overshooting into following hooks is fine, it only
    // checks MORE text); expression-bodied hooks (useMemo(() => expr, [..]))
    // have no block, so their whole line is the body
    const hooks = [
      ...[...above.matchAll(/use(?:Effect|Memo|Callback)\(\s*\(\)\s*=>\s*\{/g)].map(m => {
        const end = above.indexOf('\n  }, [', m.index);
        return above.slice(m.index, end > 0 ? end : m.index + 2000);
      }),
      ...[...above.matchAll(/use(?:Effect|Memo|Callback)\([^\n{]*/g)].map(m => m[0]),
    ];
    for (const body of hooks) {
      for (const name of decls) {
        // skip names that are ALSO declared above (shadows/locals are fine)
        if (new RegExp(`(?:const|let|var)\\s+${name}\\b`).test(above)) continue;
        // a real reference: not a property key (kind:), not a member access
        // (.kind), not a string — regexes can't see strings, but keys and
        // member access cover the false positives that actually occur here
        if (new RegExp(`(?<![.\\w])${name}\\b(?!\\s*:)`).test(body)) {
          throw new Error(`hook above the early returns references "${name}", declared below them (TDZ crash on splash/onboarding/building renders)`);
        }
      }
    }
  });
});
