import { describe, it, expect } from 'vitest';
import { decideWeek, classifyCompletion, prevWeeksFor, DECISION_LABELS, COACH_RULE_VERSION, MISSED_REASONS } from './coach.js';
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

describe('tune-up races are judged as races, not workouts', () => {
  // A synthetic bRace slot, shaped like the plan builder's tune-up output.
  const tuneup = { id: 'bx', date: weekMonday, discipline: 'run', type: 'RACE', bRace: true, key: true, durationMin: 30 };

  it('done is done: no partial or modified judgment on a race', () => {
    expect(classifyCompletion({ workout: tuneup, entry: { done: true }, day: tuneup.date, todayISO: today })).toBe('completed');
    // a 20-minute 5k against a 30-minute slot is a fast race, not a partial workout
    expect(classifyCompletion({ workout: tuneup, entry: { done: true, actualMin: 20 }, day: tuneup.date, todayISO: today })).toBe('completed');
    expect(classifyCompletion({ workout: tuneup, entry: { done: true }, adjustEntry: { kind: 'ease' }, day: tuneup.date, todayISO: today })).toBe('completed');
  });

  it('silence stays neutral; the athlete\'s own answer still stands', () => {
    // a bRace auto-closes only in autolog's narrowest case, so silence is
    // the app being blind, never a miss
    expect(classifyCompletion({ workout: tuneup, day: tuneup.date, todayISO: today })).toBe('unlogged-race');
    expect(classifyCompletion({ workout: tuneup, missedReason: 'life', day: tuneup.date, todayISO: today })).toBe('missed-life');
    expect(classifyCompletion({ workout: tuneup, day: today, todayISO: today })).toBe('upcoming');
  });

  // The same profile with a run tune-up dropped into the reviewed week, on a
  // non-key day: each discipline's own key work stays observable, which is
  // what lets the week stay clean around the race.
  const bDate = sessionsOf(wk).find(x => !x.key && !x.test).date;
  const planB = generatePlan({ ...profile, bRaces: [{ date: bDate, kind: 'run5k' }] });
  const wkB = planB.weeks.find(w => w.start === weekMonday);
  const tuneB = wkB.workouts.find(x => x.bRace);
  const logB = () => Object.fromEntries(wkB.workouts
    .filter(x => x.discipline !== 'rest' && !x.race && !x.bRace)
    .map(x => [x.id, { done: true, at: x.date + 'T10:00:00Z' }]));
  const baseB = { ...base, plan: planB };

  it('an unmarked tune-up keeps the week clean, stays in the planned counts, and is named', () => {
    expect(tuneB).toBeTruthy();
    const d = decideWeek({ ...baseB, log: logB() });
    Object.values(d.disciplines).forEach(row => expect(row.clean).toBe(true));
    // no strain evidence and no athlete-answer evidence appear for it
    expect(d.overall.evidence.some(e => e.signal === 'your answers')).toBe(false);
    // the denominator keeps the race (a shrunken tally presented as complete
    // was a re-verify catch), and the gap is disclosed next to it
    const keys = d.overall.evidence.find(e => e.signal === 'key sessions');
    expect(keys).toBeTruthy();
    const [, kd, kp] = keys.reading.match(/^(\d+) of (\d+) completed$/);
    expect(Number(kp)).toBe(Number(kd) + 1);
    expect(d.overall.evidence.some(e => e.signal === 'tune-up race')).toBe(true);
    expect(d.disciplines.run.evidence.some(e => e.signal === 'tune-up race')).toBe(true);
  });

  it('a ticked tune-up counts as key work done, however fast the finish', () => {
    const log = { ...logB(), [tuneB.id]: { done: true, at: tuneB.date + 'T10:00:00Z', actualMin: 20 } };
    const d = decideWeek({ ...baseB, log });
    expect(d.disciplines.run.clean).toBe(true);
    const keys = d.overall.evidence.find(e => e.signal === 'key sessions');
    expect(keys).toBeTruthy();
    expect(keys.reading).toMatch(/^(\d+) of \1 completed$/);
    expect(d.overall.evidence.some(e => e.signal === 'tune-up race')).toBe(false);
  });

  it('a tune-up the athlete SAID was missed still counts, and still resets clean', () => {
    const d = decideWeek({ ...baseB, log: logB(), missedReasons: { [tuneB.id]: { reason: 'niggle', at: today } } });
    expect(d.disciplines.run.clean).toBe(false);
    expect(d.overall.evidence.some(e => /injury niggle came up/.test(e.reading))).toBe(true);
  });

  it('an unmarked BRICK tune-up leaves both the run and the bike rows clean, and both are told', () => {
    // a brick tune-up NEVER auto-closes (pairing would bank the race minus
    // its swim leg), so only the athlete can close it: permanent 'missed'
    // here was the original defect
    const planC = generatePlan({ ...profile, bRaces: [{ date: bDate, kind: 'sprint' }] });
    const wkC = planC.weeks.find(w => w.start === weekMonday);
    const tuneC = wkC.workouts.find(x => x.bRace);
    expect(tuneC.discipline).toBe('brick');
    const log = Object.fromEntries(wkC.workouts
      .filter(x => x.discipline !== 'rest' && !x.race && !x.bRace)
      .map(x => [x.id, { done: true, at: x.date + 'T10:00:00Z' }]));
    const d = decideWeek({ ...base, plan: planC, log });
    ['run', 'bike'].forEach(k => {
      expect(d.disciplines[k], k + ' row must exist').toBeTruthy();
      expect(d.disciplines[k].clean).toBe(true);
      expect(d.disciplines[k].evidence.some(e => e.signal === 'tune-up race')).toBe(true);
    });
  });

  // The progression gate: the fade veto's shape, in-week only. A solo run
  // plan makes the run the limiter outright; the tune-up sits on an EASY
  // day, so the week's key long run stays observable and the week is clean.
  const soloProfile = { ...profile, raceType: 'runhalf' };
  const planS0 = generatePlan(soloProfile);
  const wkS0 = planS0.weeks.find(w => (w.phase === 'Base' || w.phase === 'Build') && !w.isRecovery && w.index >= 2);
  const keyRun = wkS0.workouts.find(x => x.discipline === 'run' && x.key && !x.test);
  const easyRun = wkS0.workouts.find(x => x.discipline === 'run' && !x.key && !x.test);
  const planS = generatePlan({ ...soloProfile, bRaces: [{ date: easyRun.date, kind: 'run5k' }] });
  const wkS = planS.weeks.find(w => w.start === wkS0.start);
  const tuneS = wkS.workouts.find(x => x.bRace);
  const todayS = iso(new Date(new Date(wkS.start + 'T00:00:00Z').getTime() + 8 * 864e5));
  const prevS = iso(new Date(new Date(wkS.start + 'T00:00:00Z').getTime() - 7 * 864e5));
  const prevSunday = iso(new Date(new Date(wkS.start + 'T00:00:00Z').getTime() - 1 * 864e5));
  const logS = () => Object.fromEntries(wkS.workouts
    .filter(x => x.discipline !== 'rest' && !x.race && !x.bRace)
    .map(x => [x.id, { done: true, at: x.date + 'T10:00:00Z' }]));
  const baseS = {
    ...base, plan: planS, weekMonday: wkS.start, todayISO: todayS,
    prevWeeks: [{ weekMonday: prevS, tracker: false, planCreatedAt: planS.createdAt, disciplines: { run: { clean: true } } }],
  };

  it('an unmarked tune-up holds the progression call without resetting the streak', () => {
    expect(tuneS).toBeTruthy();
    const d = decideWeek({ ...baseS, log: logS() });
    expect(d.disciplines.run.clean).toBe(true); // the streak survives
    expect(d.disciplines.run.decision).toBe('hold');
    expect(d.disciplines.run.headline).toMatch(/Mark the tune-up complete/);
    expect(d.progression).toBe(null);
  });

  it('the same week with the tune-up marked complete progresses', () => {
    const d = decideWeek({ ...baseS, log: { ...logS(), [tuneS.id]: { done: true, at: tuneS.date + 'T10:00:00Z' } } });
    expect(d.disciplines.run.decision).toBe('progress');
    expect(d.progression).toEqual({ discipline: 'run', what: 'extending the long run' });
  });

  it('a week whose ONLY key work was the unmarked race cannot certify the streak', () => {
    // the tune-up replaces the key long run itself: with zero key sessions
    // observed, clean would let next week progress on no evidence at all
    // (re-verify catch 2026-07-30)
    const planZ = generatePlan({ ...soloProfile, bRaces: [{ date: keyRun.date, kind: 'run5k' }] });
    const wkZ = planZ.weeks.find(w => w.start === wkS0.start);
    const logZ = Object.fromEntries(wkZ.workouts
      .filter(x => x.discipline !== 'rest' && !x.race && !x.bRace)
      .map(x => [x.id, { done: true, at: x.date + 'T10:00:00Z' }]));
    const d = decideWeek({ ...baseS, plan: planZ, log: logZ,
      prevWeeks: [{ weekMonday: prevS, tracker: false, planCreatedAt: planZ.createdAt, disciplines: { run: { clean: true } } }] });
    expect(d.disciplines.run.clean).toBe(false);
    expect(d.disciplines.run.decision).toBe('hold');
    // but marking the race complete restores both the streak and progression
    const tuneZ = wkZ.workouts.find(x => x.bRace);
    const ticked = decideWeek({ ...baseS, plan: planZ, log: { ...logZ, [tuneZ.id]: { done: true, at: tuneZ.date + 'T10:00:00Z' } },
      prevWeeks: [{ weekMonday: prevS, tracker: false, planCreatedAt: planZ.createdAt, disciplines: { run: { clean: true } } }] });
    expect(ticked.disciplines.run.clean).toBe(true);
    expect(ticked.disciplines.run.decision).toBe('progress');
  });

  it('a boost week held back by an unmarked race says so, not "not clean enough"', () => {
    const adjustLog = [{ at: prevSunday + 'T18:00:00Z', kind: 'boost-week', headline: 'Room to build', why: 'form' }];
    const d = decideWeek({ ...baseS, log: logS(), adjustLog });
    expect(d.overall.decision).toBe('hold');
    expect(d.overall.headline).toBe('Room to build soon, not yet');
    expect(d.overall.conflicting.some(c => /tune-up race has no result marked yet/.test(c))).toBe(true);
    expect(d.overall.conflicting.some(c => /not clean enough/.test(c))).toBe(false);
  });
});

describe('prevWeeksFor (the stored history a decision may read)', () => {
  it('excludes the decided week itself and anything after it, newest first', () => {
    // On a Sunday-evening provisional freeze the log already holds THIS
    // week's entry; feeding it back as prevWeeks[0] would fail the repeat
    // rule's adjacency check and wrongly deny progression.
    const coachLog = {
      '2026-07-06': { weekMonday: '2026-07-06' },
      '2026-07-13': { weekMonday: '2026-07-13' },
      '2026-07-20': { weekMonday: '2026-07-20' },
    };
    expect(prevWeeksFor(coachLog, '2026-07-20').map(d => d.weekMonday)).toEqual(['2026-07-13', '2026-07-06']);
    expect(prevWeeksFor(coachLog, '2026-07-27').map(d => d.weekMonday)).toEqual(['2026-07-20', '2026-07-13', '2026-07-06']);
    expect(prevWeeksFor({}, '2026-07-20')).toEqual([]);
    expect(prevWeeksFor(null, '2026-07-20')).toEqual([]);
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
