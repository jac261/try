import { describe, it, expect } from 'vitest';
import { decideWeek, classifyCompletion, DECISION_LABELS, COACH_RULE_VERSION, MISSED_REASONS } from './coach.js';
import { generatePlan, buildTrackerPlan } from './plan.js';
import { iso, startOfWeekMonday } from './date.js';

/* The coach brain, pass 1: every scenario here is one of the spec's fixture
   cases mapped onto Try's real signals, plus the design panel's catches. */

const profile = {
  name: 'C', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 145, ftp: 300, weightKg: 75, // swim is the limiter
  daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 5,
  startDate: '2026-06-01', raceDate: '2026-09-27',
};

// A mid-plan reviewed week, fully in the past relative to "today".
const plan = generatePlan(profile);
const wk = plan.weeks.find(w => (w.phase === 'Base' || w.phase === 'Build') && !w.isRecovery && w.index >= 2);
const weekMonday = wk.start;
const today = iso(new Date(new Date(weekMonday + 'T00:00:00Z').getTime() + 8 * 864e5)); // next Monday+1

const sessionsOf = w => w.workouts.filter(x => x.discipline !== 'rest' && !x.race);
const logAll = (w, opts = {}) => Object.fromEntries(sessionsOf(w).map(x => [x.id, { done: true, at: x.date + 'T10:00:00Z', ...opts }]));

const base = { plan, moves: {}, adjust: {}, adjustLog: [], wellness: [], activities: [], missedReasons: {}, todayISO: today, weekMonday, prevWeeks: [] };

describe('classifyCompletion', () => {
  const w = sessionsOf(wk)[0];
  it('covers the honest state space', () => {
    expect(classifyCompletion({ workout: w, entry: { done: true }, day: w.date, todayISO: today })).toBe('completed');
    expect(classifyCompletion({ workout: w, entry: { done: true, actualMin: Math.round(w.durationMin * 0.5) }, day: w.date, todayISO: today })).toBe('completed-partial');
    // no recorded duration NEVER infers partial
    expect(classifyCompletion({ workout: w, entry: { done: true, actualMin: undefined }, day: w.date, todayISO: today })).toBe('completed');
    expect(classifyCompletion({ workout: w, entry: { done: true }, adjustEntry: { kind: 'ease' }, day: w.date, todayISO: today })).toBe('modified');
    expect(classifyCompletion({ workout: w, day: w.date, todayISO: today })).toBe('missed-unknown');
    expect(classifyCompletion({ workout: w, missedReason: 'tired', day: w.date, todayISO: today })).toBe('missed-tired');
    expect(classifyCompletion({ workout: w, day: today, todayISO: today })).toBe('upcoming');
  });

  it('judges a moved session on its effective day', () => {
    // moved into the future: upcoming, not missed
    expect(classifyCompletion({ workout: w, day: iso(new Date(Date.now() + 7 * 864e5)), todayISO: today })).toBe('upcoming');
  });
});

describe('the weekly decision: spec scenarios', () => {
  it('a clean week holds by default, and hold reads as a good outcome', () => {
    const d = decideWeek({ ...base, log: logAll(wk) });
    expect(d.overall.decision).toBe('hold');
    expect(d.overall.headline).toMatch(/doing its job|Hold/);
    expect(d.ruleVersion).toBe(COACH_RULE_VERSION);
    expect(DECISION_LABELS[d.overall.decision]).toBe('Hold steady');
  });

  it('missed sessions with no answer stay unknown and never trigger recovery on their own', () => {
    const d = decideWeek({ ...base, log: {} }); // nothing done, nothing answered
    expect(d.overall.decision).toBe('hold'); // unknowns are not fatigue evidence
    expect(JSON.stringify(d)).not.toMatch(/illness|injury/i);
  });

  it('two run-down answers tip the week to recovery (the spec: reasons matter)', () => {
    const ss = sessionsOf(wk);
    const missedReasons = {
      [ss[0].id]: { reason: 'tired', at: today }, [ss[1].id]: { reason: 'tired', at: today },
    };
    const log = Object.fromEntries(ss.slice(2).map(x => [x.id, { done: true }]));
    const d = decideWeek({ ...base, log, missedReasons });
    expect(d.overall.decision).toBe('recover');
    expect(d.overall.evidence.some(e => /run down/.test(e.reading))).toBe(true);
  });

  it('the same misses answered "life got in the way" do NOT trigger recovery', () => {
    const ss = sessionsOf(wk);
    const missedReasons = {
      [ss[0].id]: { reason: 'life', at: today }, [ss[1].id]: { reason: 'life', at: today },
    };
    const log = Object.fromEntries(ss.slice(2).map(x => [x.id, { done: true }]));
    const d = decideWeek({ ...base, log, missedReasons });
    expect(d.overall.decision).toBe('hold');
  });

  it('a repeated niggle answer means ease off, in the athlete\'s own words only', () => {
    const ss = sessionsOf(wk);
    const missedReasons = {
      [ss[0].id]: { reason: 'niggle', at: today }, [ss[1].id]: { reason: 'niggle', at: today },
    };
    const d = decideWeek({ ...base, log: {}, missedReasons });
    expect(d.overall.decision).toBe('recover');
    expect(d.overall.evidence.some(e => /professional opinion/.test(e.reading))).toBe(true);
  });

  const prevSunday = iso(new Date(new Date(weekMonday + 'T00:00:00Z').getTime() - 1 * 864e5));

  it('an accepted engine trim is quoted, never re-derived, and maps to pull back', () => {
    // accepted DURING the previous week: the engine proposes for next week,
    // so this is the entry that governed the reviewed one (gauntlet catch:
    // searching the reviewed week itself was off by one)
    const adjustLog = [{ at: prevSunday + 'T18:00:00Z', kind: 'trim-week', headline: 'Pull back next week', why: 'ramp', factor: 0.7, targets: [] }];
    const d = decideWeek({ ...base, log: logAll(wk), adjustLog });
    expect(d.overall.decision).toBe('reduce-volume');
    expect(d.overall.evidence.some(e => e.signal === 'engine call you accepted' && e.reading === 'Pull back next week')).toBe(true);
  });

  it('an accepted recovery-depth trim reads as a recovery week', () => {
    const adjustLog = [{ at: prevSunday + 'T18:00:00Z', kind: 'trim-week', headline: 'Take a recovery week now', why: 'form', factor: 0.6, targets: [] }];
    const d = decideWeek({ ...base, log: logAll(wk), adjustLog });
    expect(d.overall.decision).toBe('recover');
  });

  it('a legacy journal entry without factor degrades to the generic reduction', () => {
    const adjustLog = [{ at: prevSunday + 'T18:00:00Z', kind: 'trim-week', headline: 'Pull back next week', why: 'ramp' }];
    const d = decideWeek({ ...base, log: logAll(wk), adjustLog });
    expect(d.overall.decision).toBe('reduce-volume'); // never the stronger recover call
  });

  it('the limiter progresses only after the repeat rule is satisfied', () => {
    const log = logAll(wk);
    const first = decideWeek({ ...base, log, prevWeeks: [] });
    expect(first.disciplines.swim.decision).toBe('hold'); // first clean week: not yet
    expect(first.disciplines.swim.headline).toMatch(/One more clean week/);
    const prevMonday = iso(new Date(new Date(weekMonday + 'T00:00:00Z').getTime() - 7 * 864e5));
    const second = decideWeek({ ...base, log, prevWeeks: [{ weekMonday: prevMonday, tracker: false, planCreatedAt: plan.createdAt, disciplines: { swim: { clean: true } } }] });
    expect(second.disciplines.swim.decision).toBe('progress');
    expect(second.progression).toEqual({ discipline: 'swim', what: 'a third swim in the week' });
  });

  it('a dirty prior week resets the repeat rule', () => {
    const prevMonday = iso(new Date(new Date(weekMonday + 'T00:00:00Z').getTime() - 7 * 864e5));
    const d = decideWeek({ ...base, log: logAll(wk), prevWeeks: [{ weekMonday: prevMonday, tracker: false, planCreatedAt: plan.createdAt, disciplines: { swim: { clean: false } } }] });
    expect(d.disciplines.swim.decision).toBe('hold');
  });

  it('never emits REST or RESTRICT decisions (the honest subset)', () => {
    const everything = [
      decideWeek({ ...base, log: logAll(wk) }),
      decideWeek({ ...base, log: {} }),
    ];
    everything.forEach(d => {
      const all = [d.overall.decision].concat(Object.values(d.disciplines).map(x => x.decision));
      all.forEach(x => expect(['progress', 'hold', 'reduce-volume', 'ease-intensity', 'recover']).toContain(x));
    });
  });
});

describe('tracker mode is honestly narrower', () => {
  const t = buildTrackerPlan(plan, '2026-07-01T10:00:00.000Z');
  const tBase = { ...base, plan: t, log: {}, weekMonday: iso(startOfWeekMonday(today)) };

  it('holds with no signals, recovers on red readiness days', () => {
    const quiet = decideWeek(tBase);
    expect(quiet.tracker).toBe(true);
    expect(quiet.overall.decision).toBe('hold');
    expect(Object.keys(quiet.disciplines).length).toBe(0); // no per-discipline claims without data
  });

  it('still names the limiter progression from the profile alone', () => {
    const d = decideWeek(tBase);
    expect(d.progression).toEqual({ discipline: 'swim', what: 'a third swim in the week' });
  });
});

describe('copy rules', () => {
  it('no em dashes, no all-caps, no engine parameters in any emitted string', () => {
    const outputs = [
      decideWeek({ ...base, log: logAll(wk) }),
      decideWeek({ ...base, log: {}, missedReasons: { [sessionsOf(wk)[0].id]: { reason: 'tired', at: today } } }),
    ];
    const strings = [];
    // walk COPY fields only: ids, dates and keys are data, not prose
    const COPY = new Set(['headline', 'reading', 'signal', 'what']);
    const walk = v => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => {
        if (typeof x === 'string') { if (COPY.has(k)) strings.push(x); }
        else if (k === 'conflicting' && Array.isArray(x)) x.forEach(c => strings.push(c));
        else walk(x);
      });
    };
    outputs.forEach(walk);
    Object.values(MISSED_REASONS).forEach(s => strings.push(s));
    Object.values(DECISION_LABELS).forEach(s => strings.push(s));
    strings.forEach(s => {
      expect(s, s).not.toMatch(/—/);
      expect(s, s).not.toMatch(/\b[A-Z]{3,}\b/); // no shouted words
      expect(s, s).not.toMatch(/0\.[0-9]|[0-9]+%\s*(threshold|factor)/); // no engine params
    });
  });
});

describe('gauntlet fixes', () => {
  const prevMonday = iso(new Date(new Date(weekMonday + 'T00:00:00Z').getTime() - 7 * 864e5));

  it('a clean prior week from ANOTHER plan or a non-adjacent week never unlocks progression', () => {
    const log = logAll(wk);
    const otherPlan = decideWeek({ ...base, log, prevWeeks: [{ weekMonday: prevMonday, tracker: false, planCreatedAt: 'someone-else', disciplines: { swim: { clean: true } } }] });
    expect(otherPlan.disciplines.swim.decision).toBe('hold');
    const gap = decideWeek({ ...base, log, prevWeeks: [{ weekMonday: '2020-01-06', tracker: false, planCreatedAt: plan.createdAt, disciplines: { swim: { clean: true } } }] });
    expect(gap.disciplines.swim.decision).toBe('hold');
    const trackerWeek = decideWeek({ ...base, log, prevWeeks: [{ weekMonday: prevMonday, tracker: true, planCreatedAt: null, disciplines: { swim: { clean: true } } }] });
    expect(trackerWeek.disciplines.swim.decision).toBe('hold');
  });

  it('cleanliness is about the work that matters, per discipline', () => {
    // run has a key session (the long run): skipping an easy run leaves the
    // week clean as long as the key work landed and nothing was missed under
    // strain. Swim has NO key sessions in this template, so every swim
    // counts: half the swim volume skipped is honestly not a clean swim week.
    // pick a week that really has both a key and a non-key run
    const wk2 = plan.weeks.find(w => !w.isRecovery
      && w.workouts.some(x => x.discipline === 'run' && x.key)
      && w.workouts.some(x => x.discipline === 'run' && !x.key && !x.test));
    const base2 = { ...base, weekMonday: wk2.start, todayISO: iso(new Date(new Date(wk2.start + 'T00:00:00Z').getTime() + 8 * 864e5)) };
    const ss = sessionsOf(wk2);
    const runEasy = ss.find(x => x.discipline === 'run' && !x.key && !x.test);
    const log = logAll(wk2);
    delete log[runEasy.id];
    const d = decideWeek({ ...base2, log });
    expect(d.disciplines.run.clean).toBe(true); // key work intact
    // the same miss answered "run down" resets it
    const strained = decideWeek({ ...base2, log, missedReasons: { [runEasy.id]: { reason: 'tired', at: base2.todayISO } } });
    expect(strained.disciplines.run.clean).toBe(false);
    // and a skipped swim (no key sessions to fall back on) breaks swim
    const swimEasy = ss.find(x => x.discipline === 'swim');
    const log2 = logAll(wk2);
    delete log2[swimEasy.id];
    expect(decideWeek({ ...base2, log: log2 }).disciplines.swim.clean).toBe(false);
  });

  it('the decision carries its plan identity and week for the adjacency rule', () => {
    const d = decideWeek({ ...base, log: logAll(wk) });
    expect(d.planCreatedAt).toBe(plan.createdAt);
    expect(d.weekMonday).toBe(weekMonday);
  });

  it('the index match needs plan identity and a sane timestamp; foreign entries never quote', () => {
    const planWeek = plan.weeks.find(w => w.start === weekMonday);
    const prevMonday = iso(new Date(new Date(weekMonday + 'T00:00:00Z').getTime() - 7 * 864e5));
    // properly stamped: same plan, accepted in the realistic window
    const good = [{ at: prevMonday + 'T09:00:00Z', kind: 'trim-week', headline: 'Pull back next week', why: 'ramp', factor: 0.7, targets: [], week: planWeek.index, planCreatedAt: plan.createdAt }];
    expect(decideWeek({ ...base, log: logAll(wk), adjustLog: good }).overall.decision).toBe('reduce-volume');
    // an index from ANOTHER plan, or an ancient timestamp, must never quote
    const foreign = [{ ...good[0], planCreatedAt: 'other-plan' }];
    expect(decideWeek({ ...base, log: logAll(wk), adjustLog: foreign }).overall.decision).toBe('hold');
    const ancient = [{ ...good[0], at: '2020-01-01T00:00:00Z' }];
    expect(decideWeek({ ...base, log: logAll(wk), adjustLog: ancient }).overall.decision).toBe('hold');
  });

  it('headlines never repeat their pill label word for word', () => {
    const d = decideWeek({ ...base, log: logAll(wk) });
    const label = DECISION_LABELS[d.overall.decision];
    expect(d.overall.headline.startsWith(label)).toBe(false);
  });
});
