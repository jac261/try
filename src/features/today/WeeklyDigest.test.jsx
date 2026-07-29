import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { readFileSync } from 'node:fs';

/* The digest crashed the entire app on Dismiss: a useState sat below two
   early returns, so the render after dismissing mounted fewer hooks than the
   first and React threw its invariant straight into the app error boundary.
   The seen flag persisted before the crash, so a reload looked fine and the
   field signature was an unreproducible glitch. This pins hook placement
   STRUCTURALLY: every hook call must appear before the first early return. */
describe('WeeklyDigest hook order', () => {
  it('declares every hook before the first early return', () => {
    const src = readFileSync(new URL('./WeeklyDigest.jsx', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export function WeeklyDigest'));
    const firstReturn = body.search(/\breturn null;/);
    expect(firstReturn).toBeGreaterThan(0);
    const afterReturn = body.slice(firstReturn);
    expect(afterReturn).not.toMatch(/\buse(State|Effect|Memo|Ref|Callback|Context)\s*\(/);
  });
});
