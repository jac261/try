// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { generatePlan, phaseGroups, weekPhaseLabel } from './plan.js';
import { resolveFocus, focusClause, FOCUS_OPTIONS, decideWeek } from './coach.js';
import { buildBlockReview } from './digest.js';
import { weakestLink } from './weakest.js';
import { storageForUser } from '@/app/storage.js';
import { iso, addDays } from './date.js';

/* Block objectives, coach brain pass 4: display-and-coach-only by panel
   verdict. The limiter machinery is untouched; a declared focus labels
   blocks, scopes the review, and where it disagrees with the limiter both
   are said plainly. */

const profile = {
  name: 'B', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1200, css100Sec: 145, ftp: 320, weightKg: 75, // swim is the limiter
  daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 5,
  startDate: '2026-06-01', raceDate: '2026-09-27',
};
const plan = generatePlan(profile);

describe('phaseGroups (the shared block definition)', () => {
  it('groups contiguous phases and relabels the scheduled recovery week', () => {
    const g = phaseGroups(plan);
    expect(g.length).toBeGreaterThan(2);
    expect(g[g.length - 1].phase).toBe('Recovery');
    expect(g.reduce((a, x) => a + x.weeks, 0)).toBe(plan.weeks.length);
    // maintenance: one unbroken block
    const m = generatePlan({ ...profile, raceType: 'maintenance', horizonWeeks: 12 });
    expect(phaseGroups(m).length).toBe(1);
  });
  it('weekPhaseLabel relabels ONLY the terminal post-race week', () => {
    const last = plan.weeks[plan.weeks.length - 1];
    expect(last.isRecovery).toBe(true);
    expect(weekPhaseLabel(plan, last)).toBe('Recovery');
    // mid-plan recovery weeks keep their real phase: relabelling them
    // would shatter contiguous blocks
    const mid = plan.weeks.find(w => w.isRecovery && w.index < plan.weeks.length - 1);
    if (mid) expect(weekPhaseLabel(plan, mid)).toBe(mid.phase);
    // and the frozen stamp can never diverge from the display again
    const g = phaseGroups(plan);
    expect(g[g.length - 1].phase).toBe(weekPhaseLabel(plan, last));
  });
});

describe('resolveFocus and the divergence rule', () => {
  const wl = weakestLink({ profile });
  it('derives the limiter by default and never actuates', () => {
    const fx = resolveFocus(profile, wl);
    expect(fx.focus).toBe('swim');
    expect(fx.declared).toBe(null);
    expect(fx.diverges).toBe(false);
  });
  it('a declared focus labels; divergence is named, not hidden', () => {
    const fx = resolveFocus({ ...profile, blockFocus: 'bike' }, wl);
    expect(fx.focus).toBe('bike');
    expect(fx.derived).toBe('swim');
    expect(fx.diverges).toBe(true);
  });
  it('the progression variable NEVER follows a divergent focus', () => {
    // decideWeek untouched: swim (the limiter) stays the only progress-
    // eligible discipline whatever blockFocus says
    const wk = plan.weeks.find(w => !w.isRecovery && w.index >= 2);
    const log = Object.fromEntries(wk.workouts.filter(x => x.discipline !== 'rest' && !x.race).map(x => [x.id, { done: true }]));
    const prevMonday = iso(addDays(wk.start, -7));
    const args = {
      plan: { ...plan, profile: { ...plan.profile, blockFocus: 'bike' } },
      log, moves: {}, adjust: {}, adjustLog: [], wellness: [], activities: [], missedReasons: {},
      todayISO: iso(addDays(wk.start, 8)), weekMonday: wk.start,
      prevWeeks: [{ weekMonday: prevMonday, tracker: false, planCreatedAt: plan.createdAt, disciplines: { swim: { clean: true } } }],
    };
    const d = decideWeek(args);
    expect(d.disciplines.swim.decision).toBe('progress');
    expect(d.progression.discipline).toBe('swim'); // not bike
  });
});

describe('the frozen phase stamp', () => {
  const stamp = wk => decideWeek({
    plan, log: {}, moves: {}, adjust: {}, adjustLog: [], wellness: [], activities: [],
    missedReasons: {}, todayISO: iso(addDays(wk.start, 8)), weekMonday: wk.start, prevWeeks: [],
  }).phase;
  it('freezes the label the athlete sees, not the raw engine phase', () => {
    const last = plan.weeks[plan.weeks.length - 1];
    expect(stamp(last)).toBe('Recovery'); // raw phase is Maintain; the stamp must match the display
    const mid = plan.weeks.find(w => w.isRecovery && w.index < plan.weeks.length - 1);
    if (mid) expect(stamp(mid)).toBe(mid.phase); // mid-plan recovery weeks keep their block's phase
  });
});

describe('focusClause phase gating', () => {
  it('builds in Base and Build, sharpens in Peak, stays silent through Taper', () => {
    expect(focusClause('Base', 'swim')).toBe('building the swim');
    expect(focusClause('Build', 'bike')).toBe('building the bike');
    expect(focusClause('Peak', 'run')).toBe('sharpening the run');
    expect(focusClause('Taper', 'swim')).toBe(null);
    expect(focusClause('Recovery', 'swim')).toBe(null);
    expect(focusClause('Maintain', null)).toBe('keeping everything ticking');
  });
  it('copy rules hold', () => {
    Object.values(FOCUS_OPTIONS).concat(['building the swim', 'sharpening the run']).forEach(sx => {
      expect(sx).not.toMatch(/—/);
      expect(sx).not.toMatch(/\b[A-Z]{3,}\b/);
    });
  });
});

describe('buildBlockReview (stored-only: the live plan layout is never trusted)', () => {
  const mkDecision = (weekMonday, phase, overall = 'hold', clean = true) => ({
    weekMonday, phase, planCreatedAt: plan.createdAt, tracker: false,
    overall: { decision: overall }, disciplines: { swim: { clean } },
  });
  const build = plan.weeks.filter(w => w.phase === 'Build');
  const peak = plan.weeks.filter(w => w.phase === 'Peak');
  const lastBuild = build[build.length - 1];

  it('fires when the first decision of a NEW phase freezes, from stored phases alone', () => {
    const coachLog = {};
    build.forEach(w => { coachLog[w.start] = mkDecision(w.start, 'Build'); });
    coachLog[peak[0].start] = mkDecision(peak[0].start, 'Peak');
    // no review while the block is still running
    expect(buildBlockReview({ plan, coachLog, weekMonday: lastBuild.start, focus: 'swim', lastReviewedMonday: null })).toBe(null);
    const r = buildBlockReview({ plan, coachLog, weekMonday: peak[0].start, focus: 'swim', lastReviewedMonday: null });
    expect(r).toBeTruthy();
    expect(r.trigger).toBe('boundary');
    expect(r.phase).toBe('Build'); // the CLOSED block, not the new one
    expect(r.summary).toMatch(/swim came through clean/);
    expect(r.coverage).toBe(null); // every block week frozen on this device
  });

  it('survives a createdAt-preserving reshape: a relabelled live plan changes nothing', () => {
    const coachLog = {};
    build.forEach(w => { coachLog[w.start] = mkDecision(w.start, 'Build'); });
    coachLog[peak[0].start] = mkDecision(peak[0].start, 'Peak');
    // a settings-edit reshape regenerates every week; simulate the worst
    // case where the live layout no longer agrees with anything stored
    const reshaped = { ...plan, weeks: plan.weeks.map(w => ({ ...w, phase: 'Base' })) };
    const r = buildBlockReview({ plan: reshaped, coachLog, weekMonday: peak[0].start, focus: 'swim', lastReviewedMonday: null });
    expect(r).toBeTruthy();
    expect(r.trigger).toBe('boundary');
    expect(r.phase).toBe('Build');
  });

  it('states its own coverage when the device is missing weeks inside the block', () => {
    const coachLog = { [build[0].start]: mkDecision(build[0].start, 'Build'), [lastBuild.start]: mkDecision(lastBuild.start, 'Build') };
    coachLog[peak[0].start] = mkDecision(peak[0].start, 'Peak');
    const r = buildBlockReview({ plan, coachLog, weekMonday: peak[0].start, focus: 'swim', lastReviewedMonday: null });
    if (build.length > 2) {
      expect(r.coverage).toMatch(/logged on this device/);
      expect(r.coverage).toMatch('2 of ' + build.length);
    } else expect(r.coverage).toBe(null);
  });

  it('a one-week block does not claim throughout', () => {
    const coachLog = { [lastBuild.start]: mkDecision(lastBuild.start, 'Build') };
    coachLog[peak[0].start] = mkDecision(peak[0].start, 'Peak');
    const r = buildBlockReview({ plan, coachLog, weekMonday: peak[0].start, focus: 'swim', lastReviewedMonday: null });
    expect(r.summary).toMatch(/held steady\./);
    expect(r.summary).not.toMatch(/throughout/);
  });

  it('maintenance plans review on the four-week cadence instead, capped at four', () => {
    const m = generatePlan({ ...profile, raceType: 'maintenance', horizonWeeks: 12 });
    const coachLog = {};
    m.weeks.slice(0, 7).forEach(w => { coachLog[w.start] = { ...mkDecision(w.start, 'Maintain'), planCreatedAt: m.createdAt } });
    const r = buildBlockReview({ plan: m, coachLog, weekMonday: m.weeks[6].start, focus: 'general', lastReviewedMonday: null });
    expect(r).toBeTruthy();
    expect(r.trigger).toBe('cadence');
    expect(r.summary).toMatch(/^4 weeks/); // first fire is the last few weeks, never the whole backlog
    // and the marker stops a weekly refire
    const again = buildBlockReview({ plan: m, coachLog, weekMonday: m.weeks[6].start, focus: 'general', lastReviewedMonday: m.weeks[6].start });
    expect(again === null || again.trigger !== 'cadence').toBe(true);
  });

  it('cadence never folds in decisions from a different phase of the same plan row', () => {
    // post-race rollover keeps the plan identity: old Build/Peak decisions
    // share planCreatedAt with the new Maintain run but must never be counted
    const m = generatePlan({ ...profile, raceType: 'maintenance', horizonWeeks: 12 });
    const coachLog = {};
    ['2026-04-06', '2026-04-13', '2026-04-20'].forEach(d => {
      coachLog[d] = { ...mkDecision(d, 'Build', 'progress'), planCreatedAt: m.createdAt };
    });
    m.weeks.slice(0, 4).forEach(w => { coachLog[w.start] = { ...mkDecision(w.start, 'Maintain'), planCreatedAt: m.createdAt } });
    const r = buildBlockReview({ plan: m, coachLog, weekMonday: m.weeks[3].start, focus: 'general', lastReviewedMonday: null });
    expect(r).toBeTruthy();
    expect(r.trigger).toBe('cadence');
    expect(r.summary).toMatch(/^4 weeks, held steady/); // no progressed count leaking in from Build
  });

  it('a frozen Recovery tail never masquerades as a Maintain cadence run', () => {
    const coachLog = {};
    const last = plan.weeks[plan.weeks.length - 1];
    ['-21', '-14', '-7'].forEach(off => {
      const d = iso(addDays(last.start, Number(off)));
      coachLog[d] = mkDecision(d, 'Maintain');
    });
    coachLog[last.start] = mkDecision(last.start, 'Recovery');
    const r = buildBlockReview({ plan, coachLog, weekMonday: last.start, focus: 'swim', lastReviewedMonday: null });
    // phase change Maintain->Recovery is a boundary; the point is it is NOT
    // an unbounded Maintain catch-up
    expect(r === null || r.trigger !== 'cadence').toBe(true);
  });

  it('decisions from another plan never count', () => {
    const coachLog = {};
    build.forEach(w => { coachLog[w.start] = { ...mkDecision(w.start, 'Build'), planCreatedAt: 'other' }; });
    coachLog[peak[0].start] = { ...mkDecision(peak[0].start, 'Peak'), planCreatedAt: 'other' };
    expect(buildBlockReview({ plan, coachLog, weekMonday: peak[0].start, focus: 'swim', lastReviewedMonday: null })).toBe(null);
  });
});

describe('the focus journal is isolated from the engine journal', () => {
  it('lives in its own store, capped, and decideWeek never sees it', () => {
    localStorage.clear();
    const st = storageForUser('blocks-test');
    for (let i = 0; i < 25; i++) st.saveFocusChange({ at: '2026-07-' + String((i % 28) + 1).padStart(2, '0') + 'T10:00:00Z', from: null, to: 'bike', planCreatedAt: 'p' });
    expect(st.loadFocusLog().length).toBe(20);
    // a focus entry shaped like a journal row, fed to decideWeek as
    // adjustLog, must never be quoted as an engine call: it has no headline
    const entry = st.loadFocusLog()[0];
    expect(entry.headline).toBeUndefined();
  });
});
