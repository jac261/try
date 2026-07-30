// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { storageForUser } from '../../app/storage.js';
import { swimThreshold, hasRealCss } from '../domain.js';

/* Phase 2 commit 6: the strays. Each of these is a small instance of a
 * class the codebase has already paid for once — browser-global dismissals
 * leaking across accounts, unstamped week strings surviving a plan replace,
 * and an anchor without the real/estimated discriminator its siblings carry. */

describe('blockReviewed is plan-stamped (the coachLog/adjustLog rule, applied)', () => {
  let storage;
  beforeEach(() => { localStorage.clear(); storage = storageForUser('stray-test'); });

  it('a stamp from a replaced plan no longer suppresses the new plan', () => {
    storage.saveBlockReviewed('2026-07-20', 'plan-A');
    expect(storage.loadBlockReviewed('plan-A')).toBe('2026-07-20');
    expect(storage.loadBlockReviewed('plan-B')).toBe(null);   // foreign stamp is silence
  });

  it('a legacy bare week string is honoured once, then restamped on write', () => {
    localStorage.setItem('try.user.stray-test.blockReviewed', '2026-07-13');
    expect(storage.loadBlockReviewed('plan-A')).toBe('2026-07-13');  // honoured
    storage.saveBlockReviewed('2026-07-20', 'plan-A');
    const raw = JSON.parse(localStorage.getItem('try.user.stray-test.blockReviewed'));
    expect(raw).toEqual({ weekMonday: '2026-07-20', planCreatedAt: 'plan-A' });
  });
});

describe('ReadinessCard dismissals are per-user (the TodayView migration, completed)', () => {
  it('no browser-global keys remain; the legacy global is a read fallback only', () => {
    const src = readFileSync('src/features/wellness/ReadinessCard.jsx', 'utf8');
    expect(src).not.toMatch(/localStorage\.setItem\('try\./);          // writes never global
    expect(src).toMatch(/let CARD_NS = 'try\.'/);                       // pattern matches TodayView's
    expect(src).toMatch(/storage && storage\.ns\) CARD_NS = storage\.ns/);
    // and the proposal's accept AND reject journal through the shared layer
    expect(src).toMatch(/onDecision\(T\.fromTodayProposal\(rawProposal\), 'rejected'\)/);
    expect(src).toMatch(/onDecision\(T\.fromTodayProposal\(proposal\), 'accepted'\)/);
  });

  it('digestSeenWeek dismissals are plan-scoped', () => {
    const src = readFileSync('src/features/today/WeeklyDigest.jsx', 'utf8');
    expect(src).toMatch(/planCreatedAt: plan\.createdAt \|\| null/);
    expect(src).toMatch(/seenRaw\.planCreatedAt === \(plan\.createdAt \|\| null\)/);
  });
});

describe('swimThreshold carries the kind its siblings always had', () => {
  it('a supplied or measured CSS is real; an estimated one is not', () => {
    expect(swimThreshold({ css100Sec: 110, cssMeta: { source: 'try-test' } }).kind).toBe('real');
    expect(swimThreshold({ css100Sec: 110 }).kind).toBe('real');                    // manual entry
    expect(swimThreshold({ css100Sec: 110, cssMeta: { source: 'estimated' } }).kind).toBe('estimated');
    expect(swimThreshold({}).kind).toBe('estimated');                               // no number at all
    expect(hasRealCss({ css100Sec: 110 })).toBe(true);
    expect(hasRealCss({})).toBe(false);
  });

  it('additive: every pre-existing field is unchanged', () => {
    const t = swimThreshold({ css100Sec: 110, cssMeta: { source: 'try-test', measuredAt: '2026-07-01', confidence: 'high' } });
    expect(t.cssSecondsPer100m).toBe(110);
    expect(t.source).toBe('try-test');
    expect(t.measuredAt).toBe('2026-07-01');
    expect(t.confidence).toBe('high');
  });
});
