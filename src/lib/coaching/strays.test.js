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

/* The audit's two held-back findings, closed together: a dismissal now says
   WHOSE it is (the per-user namespace, with no global fallback left) and
   WHICH PLAN it was about. The rules diverge from loadBlockReviewed above in
   three places, and each divergence gets its own case here, because every
   one of them is silent in a single-account, single-plan test run. */
describe('a dismissal knows which plan it was about', () => {
  let storage;
  beforeEach(() => { localStorage.clear(); storage = storageForUser('stray-test'); });

  it('a plan-scoped rejection does not carry into the next plan', () => {
    storage.saveDismiss('weeklyProposalDismissed', 'trim-week:3:a.b', 'plan-A');
    expect(storage.loadDismiss('weeklyProposalDismissed', 'plan-A')).toBe('trim-week:3:a.b');
    expect(storage.loadDismiss('weeklyProposalDismissed', 'plan-B')).toBe(null);
  });

  it('a null stamp is silence on a plan-scoped key, not a wildcard', () => {
    // loadBlockReviewed reads a null stamp as "matches anything". Here that
    // would hand a foreign athlete's rejection to any caller without a plan.
    storage.saveDismiss('weeklyProposalDismissed', 'sig', 'plan-A');
    expect(storage.loadDismiss('weeklyProposalDismissed', null)).toBe(null);
  });

  it('an athlete-scoped rejection ignores the plan entirely', () => {
    // A CSS retest is due or not due because of the athlete's testing, and a
    // new plan says nothing about that.
    storage.saveDismiss('cssRetestDismissed', 'retest:stale:2026-06-01', 'plan-A');
    expect(storage.loadDismiss('cssRetestDismissed', 'plan-B')).toBe('retest:stale:2026-06-01');
    expect(storage.loadDismiss('cssRetestDismissed', null)).toBe('retest:stale:2026-06-01');
  });

  it('a legacy bare signature is honoured where no stamp was ever needed, ignored where it was', () => {
    localStorage.setItem('try.user.stray-test.cssRetestDismissed', 'legacy-sig');
    localStorage.setItem('try.user.stray-test.weeklyProposalDismissed', 'legacy-sig');
    expect(storage.loadDismiss('cssRetestDismissed', 'plan-A')).toBe('legacy-sig');
    expect(storage.loadDismiss('weeklyProposalDismissed', 'plan-A')).toBe(null);
  });

  it('an unregistered key is treated as plan-scoped, so a forgotten card re-asks', () => {
    storage.saveDismiss('someNewCardDismissed', 'sig', 'plan-A');
    expect(storage.loadDismiss('someNewCardDismissed', 'plan-A')).toBe('sig');
    expect(storage.loadDismiss('someNewCardDismissed', 'plan-B')).toBe(null);
  });

  it('clearDismiss drops the plan-scoped rejections and spares the rest', () => {
    storage.saveDismiss('weeklyProposalDismissed', 'w', 'plan-A');
    storage.saveDismiss('cssRetestDismissed', 'c', 'plan-A');
    storage.clearDismiss();
    expect(storage.loadDismiss('weeklyProposalDismissed', 'plan-A')).toBe(null);
    expect(storage.loadDismiss('cssRetestDismissed', 'plan-A')).toBe('c');
  });

  it('starting a new plan clears them too', () => {
    storage.saveDismiss('startShortfallDismissed', 's', 'plan-A');
    storage.saveDismiss('ftpRetestDismissed', 'f', 'plan-A');
    storage.clear();
    expect(storage.loadDismiss('startShortfallDismissed', 'plan-A')).toBe(null);
    expect(storage.loadDismiss('ftpRetestDismissed', 'plan-A')).toBe('f');
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
