// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { journalRows, decisionFamily } from './journal.js';
import { fromWeeklyProposal, fromThresholdProposal, fromRetest } from './decision.js';
import { storageForUser } from '../../app/storage.js';

/* Phase 2 §9 / §12: the journal's contract. Acceptance is idempotent,
 * rejection is preserved, supersession is recorded with a reason rather
 * than silently discarded, and rejected rows are never deleted. */

const weekly = fromWeeklyProposal({
  kind: 'trim-week', action: 'trimWeek', week: 3, factor: 0.7,
  targets: ['3-1'], ease: [], headline: 'Ease the week', why: 'Readiness has been low.',
});
const eftpBike = value => fromThresholdProposal({
  kind: 'eftp', sport: 'bike', headline: 'Your rides argue for more', why: 'The estimate sits above your setting.',
  retarget: { ftp: value, ftpMeta: { source: 'activity-model', measuredAt: '2026-06-09', confidence: 'medium' } },
});

describe('journalRows (pure)', () => {
  it('a plain append is one row carrying the decision fields', () => {
    const rows = journalRows([], weekly, 'accepted', { at: '2026-06-10T08:00:00Z', planCreatedAt: 'p1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: weekly.id, status: 'accepted', headline: 'Ease the week',
      why: 'Readiness has been low.', sourceEngine: 'adapt', planCreatedAt: 'p1',
    });
  });

  it('a newer same-family decision supersedes a REJECTED older one, with a reason', () => {
    const log = journalRows([], eftpBike(262), 'rejected', { at: 't1', planCreatedAt: 'p1' });
    const rows = journalRows(log, eftpBike(268), 'accepted', { at: 't2', planCreatedAt: 'p1' });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: eftpBike(262).id, status: 'superseded' });
    expect(rows[0].why).toBe('A newer proposal replaced it.');
    expect(rows[1]).toMatchObject({ id: eftpBike(268).id, status: 'accepted' });
  });

  it('families are sport-scoped for threshold proposals: bike never supersedes swim', () => {
    expect(decisionFamily('eftp:eftp:bike:262')).toBe('eftp:bike');
    expect(decisionFamily('eftp:csstest:swim:105')).toBe('eftp:swim');
    expect(decisionFamily('css-retest:retest:stale:x')).toBe('css-retest');
    const swimRejected = journalRows([], fromThresholdProposal({
      kind: 'csstest', sport: 'swim', headline: 'h', why: 'w',
      retarget: { css100Sec: 105, cssMeta: { source: 'try-test', confidence: 'high' } },
    }), 'rejected', { at: 't1' });
    const rows = journalRows(swimRejected, eftpBike(262), 'accepted', { at: 't2' });
    expect(rows).toHaveLength(1);                       // no cross-sport supersession
  });

  it('an ACCEPTED older decision is never superseded: it happened', () => {
    const log = journalRows([], eftpBike(262), 'accepted', { at: 't1' });
    const rows = journalRows(log, eftpBike(268), 'accepted', { at: 't2' });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('accepted');
  });
});

describe('storage.appendDecision (device store)', () => {
  let storage;
  beforeEach(() => { localStorage.clear(); storage = storageForUser('journal-test'); });

  it('acceptance is idempotent: the same (id, status) twice writes once', () => {
    const row = journalRows([], weekly, 'accepted', { at: 't1' })[0];
    storage.appendDecision(row);
    const after = storage.appendDecision({ ...row, at: 't2' });
    expect(after).toHaveLength(1);
  });

  it('rejection then acceptance preserves BOTH rows: history is the point', () => {
    const rej = journalRows([], weekly, 'rejected', { at: 't1' })[0];
    storage.appendDecision(rej);
    const acc = journalRows(storage.loadDecisionLog(), weekly, 'accepted', { at: 't2' })[0];
    const after = storage.appendDecision(acc);
    expect(after.map(e => e.status)).toEqual(['rejected', 'accepted']);
  });

  it('caps at 120, evicting oldest', () => {
    for (let i = 0; i < 130; i++) {
      storage.appendDecision({ id: 'x:' + i, status: 'rejected', at: 't' + i });
    }
    const log = storage.loadDecisionLog();
    expect(log).toHaveLength(120);
    expect(log[0].id).toBe('x:10');
  });
});

describe('the writers exist at the source', () => {
  const app = readFileSync('src/app/App.jsx', 'utf8');
  const today = readFileSync('src/features/today/TodayView.jsx', 'utf8');

  it('every accept path journals: weekly, the two sheets, the run one-tap', () => {
    expect(app).toMatch(/journalDecision\(T\.fromWeeklyProposal\(p, \{ at \}\), 'accepted'\)/);
    expect((app.match(/journalDecision\(T\.fromThresholdProposal\((cssSheet|ftpSheet|eftp)\), 'accepted'\)/g) || []).length).toBe(3);
  });

  it('every decision dismiss journals a rejection, including the NEW eftp dismiss', () => {
    expect(today).toMatch(/onDecision\(T\.fromWeeklyProposal\(weekly\), 'rejected'\)/);
    expect(today).toMatch(/onDecision\(T\.fromThresholdProposal\(eftp\), 'rejected'\)/);
    expect(today).toMatch(/onDecision\(T\.fromRetest\(ftpRetest, \{ discipline: 'bike' \}\), 'rejected'\)/);
    expect(today).toMatch(/onDecision\(T\.fromRetest\(retest, \{ discipline: 'swim' \}\), 'rejected'\)/);
    // the eftp banner finally has a dismiss, sticky per signature
    expect(today).toMatch(/eftpDismissed !== eftp\.sig/);
  });

  it('adjustLog is untouched beside the new journal: the coach brain keeps its reader', () => {
    expect(app).toMatch(/journalProposal\(p, at\);\n\s+journalDecision/);
    expect(app).toContain("storage.load('adjustLog', [])");
  });
});
