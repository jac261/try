import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { evidenceItem, metric, SOURCE_KINDS, proposalSourceWord } from './evidence.js';
import { coachingDecision, fromCoachWeek, fromWeeklyProposal, fromThresholdProposal, fromRetest, fromTodayProposal } from './decision.js';
import { toCoachingProposal } from './proposal.js';
import { generatePlan } from '../plan.js';
import { decideWeek, COACH_RULE_VERSION } from '../coach.js';

/* Phase 2 stage 1: adapters only. These tests are the byte-identity
 * contract: producer copy survives adaptation verbatim, inputs are never
 * mutated, and the two fences the spec asks for hold — estimated evidence
 * cannot be upgraded, low confidence cannot carry a strong action. */

const profile = {
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: '2026-06-01', raceDate: '2026-10-03',
};

describe('evidence (§2)', () => {
  it('an unknown kind is missing, never a silent upgrade', () => {
    expect(evidenceItem({ label: 'x', kind: 'definitely-real' }).kind).toBe('missing');
    expect(metric(5, 'nonsense').kind).toBe('missing');
    expect(SOURCE_KINDS).toEqual(['recorded', 'derived', 'reported', 'estimated', 'missing']);
  });

  it('estimated evidence cannot become measured: the item is frozen', () => {
    const e = evidenceItem({ label: 'ftp', kind: 'estimated', confidence: 'low' });
    expect(() => { e.kind = 'recorded'; }).toThrow();
    expect(e.kind).toBe('estimated');
  });

  it('proposal source prose covers the union, including the entries that had drifted', () => {
    // the bike sheet's private map lacked 'estimated'; the shared one cannot
    expect(proposalSourceWord('estimated', 'bike')).toBe('an estimate');
    expect(proposalSourceWord('try-test', 'swim')).toBe('your swum 400/200 test');
    expect(proposalSourceWord('try-test', 'bike')).toBe('your bike test');
    expect(proposalSourceWord('activity-model', 'bike')).toBe('the rolling estimate from your rides');
    expect(proposalSourceWord('never-heard-of-it')).toBe('a new reading');
  });
});

describe('the fences (§3, §12)', () => {
  it('low confidence cannot carry a strong action', () => {
    ['progress', 'reduce', 'replace'].forEach(action => {
      const d = coachingDecision({ id: 'x', action, confidence: 'low', headline: 'h', explanation: 'e', sourceEngine: 't' });
      expect(d.action).toBe('collect-data');
    });
    // medium and high pass through
    expect(coachingDecision({ id: 'x', action: 'replace', confidence: 'medium', headline: 'h', explanation: 'e', sourceEngine: 't' }).action).toBe('replace');
  });

  it('a decision is frozen: status and action cannot be mutated after construction', () => {
    const d = coachingDecision({ id: 'x', action: 'hold', confidence: 'medium', headline: 'h', explanation: 'e', sourceEngine: 't' });
    expect(() => { d.status = 'accepted'; }).toThrow();
    expect(() => { d.evidence.push({}); }).toThrow();
  });
});

describe('adapters preserve the producers verbatim (stage 1 byte-identity)', () => {
  const plan = generatePlan(profile);
  const week = decideWeek({
    plan, log: {}, moves: {}, adjust: {}, adjustLog: [], wellness: [],
    activities: [], missedReasons: {}, todayISO: '2026-06-10',
    weekMonday: '2026-06-08', prevWeeks: [], durabilityByDiscipline: null,
  });

  it('fromCoachWeek: headline and evidence copy byte-equal, input untouched', () => {
    const frozen = JSON.parse(JSON.stringify(week));
    const d = fromCoachWeek(week);
    expect(d.headline).toBe(week.overall.headline);
    week.overall.evidence.forEach((e, i) => {
      expect(d.evidence[i].label).toBe(e.signal);
      expect(d.evidence[i].explanation).toBe(e.reading);
    });
    expect(d.sourceEngine).toBe('coach');
    expect(d.sourceEngineVersion).toBe(String(COACH_RULE_VERSION)); // finally read
    expect(week).toEqual(frozen);                                   // pure
    // per-discipline flavour
    const run = fromCoachWeek(week, { discipline: 'run' });
    expect(run.headline).toBe(week.disciplines.run.headline);
    expect(run.discipline).toBe('run');
  });

  it('fromWeeklyProposal: deterministic id from the dismissal signature concept', () => {
    const p = { kind: 'trim-week', action: 'trimWeek', week: 3, factor: 0.7, targets: ['3-1', '3-4'], ease: ['3-2'], headline: 'Take it down a notch', why: 'Readiness has been low for three days.' };
    const a = fromWeeklyProposal(p, { at: '2026-06-10' });
    const b = fromWeeklyProposal({ ...p }, { at: '2026-06-11' });
    expect(a.id).toBe('adapt:trim-week:3:3-1.3-4');
    expect(a.id).toBe(b.id);                       // same proposal, same identity
    expect(a.headline).toBe(p.headline);
    expect(a.explanation).toBe(p.why);
    expect(a.action).toBe('reduce');
    expect(a.affectedWorkoutIds).toEqual(['3-1', '3-4', '3-2']);
    expect(a.reversible).toBe(true);
    const changed = fromWeeklyProposal({ ...p, targets: ['3-1'] });
    expect(changed.id).not.toBe(a.id);             // changed targets, new identity
  });

  it('fromThresholdProposal: meta drives kind and confidence; retargets are honestly irreversible', () => {
    const p = {
      kind: 'csstest', sport: 'swim', headline: 'Your test says faster', why: 'The swum 400/200 came in quicker than your setting.',
      retarget: { css100Sec: 105, cssMeta: { source: 'try-test', measuredAt: '2026-06-09', confidence: 'high' } },
    };
    const d = fromThresholdProposal(p);
    expect(d.evidence[0].kind).toBe('recorded');   // try-test is a measurement
    expect(d.confidence).toBe('high');
    expect(d.reversible).toBe(false);              // no plan versioning: say so
    expect(d.requiresAcceptance).toBe(true);
    const model = fromThresholdProposal({ ...p, kind: 'eftp', retarget: { ftp: 260, ftpMeta: { source: 'activity-model', measuredAt: '2026-06-09', confidence: 'medium' } }, sport: 'bike' });
    expect(model.evidence[0].kind).toBe('derived'); // a model is not a measurement
  });

  it('fromRetest: copy-only nudge, requiresAcceptance false, id rides the existing sig', () => {
    const rec = { reason: 'perf-slow', reasons: ['perf-slow'], headline: 'Worth a fresh CSS test', why: 'Several recent swims came in slower than your paces expect.', sig: 'retest:perf-slow:2026-06-01' };
    const d = fromRetest(rec, { discipline: 'swim' });
    expect(d.id).toBe('css-retest:retest:perf-slow:2026-06-01');
    expect(d.action).toBe('retest');
    expect(d.requiresAcceptance).toBe(false);
    expect(d.evidence[0].kind).toBe('recorded');   // perf-* comes from swims
    const missing = fromRetest({ ...rec, reason: 'missing', sig: 'retest:missing:' }, { discipline: 'bike' });
    expect(missing.evidence[0].kind).toBe('missing');
    expect(missing.sourceEngine).toBe('ftp-retest');
  });

  it('fromTodayProposal: move-test maps to reschedule (the actuator gap, named)', () => {
    const p = { kind: 'move-test', workout: { id: '2-3', discipline: 'bike' }, action: 'moveTest', headline: 'Not a test day', why: 'Readiness is low; a test today would underread you.' };
    const d = fromTodayProposal(p);
    expect(d.action).toBe('reschedule');
    expect(d.affectedWorkoutIds).toEqual(['2-3']);
  });

  it('no adapter imports a discipline engine: the layer has no opinions', () => {
    const src = readFileSync(new URL('./decision.js', import.meta.url), 'utf8');
    ['swim-review', 'bike-review', 'run-review', 'wellness', 'durability', 'adapt.js', 'eftp.js', 'css-retest', 'ftp-retest'].forEach(m =>
      expect(src, m).not.toContain("from '../" + m));
  });
});

describe('toCoachingProposal (§4)', () => {
  const plan = generatePlan(profile);

  it('wraps the sheet details verbatim, so preview and sheet cannot disagree', () => {
    const proposal = {
      kind: 'eftp', sport: 'bike', ftp: 250, eftp: 262, drift: 0.048, up: true,
      headline: 'Your rides argue for more', why: 'The rolling estimate has sat above your setting.',
      retarget: { ftp: 262, ftpMeta: { source: 'activity-model', measuredAt: '2026-06-09', confidence: 'medium' } },
    };
    const cp = toCoachingProposal({ proposal, plan, todayISO: '2026-06-10' });
    expect(cp.kind).toBe('ftp-retarget');
    expect(cp.currentValue).toBe(250);
    expect(cp.proposedValue).toBe(262);
    expect(cp.preview.summary).toBe(proposal.headline);
    expect(cp.preview.details.proposedWatts).toBe(262);
    expect(cp.decision.reversible).toBe(false);
  });

  it('no payload or no details means no proposal: nothing to accept, nothing offered', () => {
    /* The estimated-anchor fence itself lives PRODUCER-side — eftpProposal
       and runBenchmark refuse to emit a retarget from an estimated anchor,
       pinned by the eftp and runpass suites — so this wrapper can never see
       one. What it guards is its own contract: a proposal without a payload
       or whose details builder declines yields null, never a half-proposal. */
    expect(toCoachingProposal({ proposal: null, plan, todayISO: '2026-06-10' })).toBe(null);
    expect(toCoachingProposal({ proposal: { kind: 'eftp', sport: 'run', headline: 'x', why: 'y' }, plan, todayISO: '2026-06-10' })).toBe(null);
    const noPaces = { profile: plan.profile, paces: null, weeks: [] };
    expect(toCoachingProposal({
      proposal: { kind: 'eftp', sport: 'run', headline: 'x', why: 'y', retarget: { fivekSec: 1450, fivekMeta: {} } },
      plan: noPaces, todayISO: '2026-06-10',
    })).toBe(null);
  });
});
