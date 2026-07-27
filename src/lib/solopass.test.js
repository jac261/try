import { describe, it, expect } from 'vitest';
import { generatePlan } from './plan.js';
import { RACES, B_RACES, FITNESS } from './domain.js';
import { weakestLink } from './weakest.js';
import { decideWeek, resolveFocus } from './coach.js';
import { eftpProposal } from './eftp.js';
import { tuneFields } from './tuning.js';
import { iso, addDays } from './date.js';

/* Tier 2: standalone run race plans. The house invariants under test:
   solo plans train exactly one discipline end to end, triathlon plans are
   byte-identical to before (their suites prove that side), and every
   extension is additive and honest. */

const SOLO_KEYS = ['run5k', 'run10k', 'runhalf', 'runmarathon'];
const base = {
  name: 'R', fitness: 'intermediate', fivekSec: 1320, daysPerWeek: 5,
  trainingDays: null, startDate: '2026-08-03', raceDate: '2026-11-22',
};
const gen = over => generatePlan({ ...base, ...over });

describe('solo generation invariants', () => {
  it('never schedules swim, bike or brick, never NaNs, never duplicates a session', () => {
    SOLO_KEYS.forEach(rt => {
      [3, 4, 5, 6, 7].forEach(days => {
        Object.keys(FITNESS).forEach(lvl => {
          const p = gen({ raceType: rt, daysPerWeek: days, fitness: lvl });
          const all = p.weeks.flatMap(w => w.workouts);
          expect(all.some(w => ['swim', 'bike', 'brick'].includes(w.discipline))).toBe(false);
          all.forEach(w => {
            expect(Number.isFinite(w.durationMin)).toBe(true);
            if (!w.race) expect(w.durationMin % 5).toBe(0);
          });
          // the wire-safe uniqueness invariant: type + duration identify a
          // run session within its week (seed is shared per week, so equal
          // type and duration would be byte-identical after a round-trip)
          p.weeks.forEach(wk => {
            const runs = wk.workouts.filter(x => x.discipline === 'run' && !x.race && !x.bRace && !x.test);
            const sigs = runs.map(x => x.type + '|' + x.durationMin);
            expect(new Set(sigs).size).toBe(sigs.length);
          });
        });
      });
    });
  });

  it('race day is a single honest leg with the real discipline', () => {
    SOLO_KEYS.forEach(rt => {
      const p = gen({ raceType: rt });
      const rd = p.weeks.flatMap(w => w.workouts).find(w => w.race);
      expect(rd.discipline).toBe('run');
      expect(rd.segments.some(s => /Swim|Bike/.test(s.label))).toBe(false);
      expect(rd.segments.some(s => /(Swim|Bike) 0 km/.test(s.label))).toBe(false);
      expect(rd.segments.some(s => s.label.indexOf('Run ' + RACES[rt].run + ' km') >= 0)).toBe(true);
    });
    // the marathon card carries its fuelling cue
    const m = gen({ raceType: 'runmarathon' });
    const rd = m.weeks.flatMap(w => w.workouts).find(w => w.race);
    expect(rd.segments.map(s => s.detail).join(' ')).toMatch(/fuel from the first 20 minutes/);
  });

  it('the limiter machinery is structurally inert, whatever the profile carries', () => {
    // stale triathlon baselines AND a stale locked swap AND a stale injury flag
    const p = generatePlan(
      { ...base, raceType: 'runmarathon', css100Sec: 95, ftp: 310, weightKg: 70, excludedDiscipline: 'run' },
      { lockedSwap: { weakest: 'swim', strongest: 'run' } });
    expect(p.limiterSwap).toBe(null);
    const all = p.weeks.flatMap(w => w.workouts);
    expect(all.some(w => w.discipline === 'swim' || w.discipline === 'bike')).toBe(false);
    expect(all.filter(w => w.discipline === 'run').length).toBeGreaterThan(0);
  });

  it('only run tests are scheduled, doubled with room, one in each half', () => {
    const p = gen({ raceType: 'runmarathon', raceDate: '2026-12-20' });
    const tests = p.weeks.flatMap(w => w.workouts).filter(w => w.test);
    expect(tests.every(t => t.testKind === 'run5k')).toBe(true);
    expect(tests.length).toBe(2);
    const mid = p.weeks[Math.floor(p.totalWeeks / 2)].start;
    expect(tests[0].date < mid).toBe(true);
    expect(tests[1].date >= mid).toBe(true);
    // a short plan keeps a single test rather than cramming two
    const short = gen({ raceType: 'run5k', raceDate: iso(addDays(new Date('2026-08-03'), 7 * 6)) });
    expect(short.weeks.flatMap(w => w.workouts).filter(w => w.test).length).toBeLessThanOrEqual(1);
  });

  it('quality days are spaced, and 7 days means 7 runs', () => {
    const p = gen({ raceType: 'runhalf', daysPerWeek: 7 });
    const wk = p.weeks.find(w => !w.isRecovery && (w.phase === 'Base' || w.phase === 'Build'));
    const runs = wk.workouts.filter(w => w.discipline === 'run');
    expect(runs.length).toBe(7);
    // role, not type: the house ladder types a Base intermediate quality
    // slot 'Easy' (pre-existing, triathlon does the same)
    const qDays = wk.workouts.filter(w => w.role === 'quality')
      .map(w => Number(w.id.split('-')[1]));
    expect(qDays.length).toBe(2);
    expect(Math.abs(qDays[0] - qDays[1])).toBeGreaterThanOrEqual(2);
  });
});

describe('marathon taper honesty', () => {
  const p = gen({ raceType: 'runmarathon', fitness: 'elite', fivekSec: 1100, daysPerWeek: 6, raceDate: '2026-12-20' });
  const longs = p.weeks.map(w => w.workouts.find(x => x.role === 'long' || (x.role === 'easy' && x.durationMin <= 30 && w.phase === 'Taper')));

  it('caps the peak long at 3 hours even for an elite', () => {
    const peakLongs = p.weeks.filter(w => !w.isRecovery && w.phase !== 'Taper')
      .flatMap(w => w.workouts).filter(x => x.role === 'long');
    expect(Math.max(...peakLongs.map(x => x.durationMin))).toBe(180);
  });

  it('caps the taper long and demotes race week to a shakeout', () => {
    const taperWeeks = p.weeks.filter(w => w.phase === 'Taper');
    const raceWeek = taperWeeks.find(w => w.workouts.some(x => x.race));
    taperWeeks.filter(w => w !== raceWeek).forEach(w => {
      const long = w.workouts.find(x => x.role === 'long');
      if (long) expect(long.durationMin).toBeLessThanOrEqual(90);
    });
    // race week: no long run at all; the demoted slot is a short easy jog
    expect(raceWeek.workouts.some(x => x.role === 'long')).toBe(false);
    const shakeout = raceWeek.workouts.filter(x => x.discipline === 'run' && !x.race && x.type === 'Easy');
    expect(shakeout.length).toBeGreaterThan(0);
    expect(Math.min(...shakeout.map(x => x.durationMin))).toBeLessThanOrEqual(30);
  });
});

describe('gauntlet round 1 pins', () => {
  it('a beginner marathon long run is distance-driven: peaks 150 or more', () => {
    const p = gen({ raceType: 'runmarathon', fitness: 'beginner', daysPerWeek: 4, raceDate: '2026-12-20' });
    const longs = p.weeks.filter(w => !w.isRecovery).flatMap(w => w.workouts).filter(x => x.role === 'long');
    expect(Math.max(...longs.map(x => x.durationMin))).toBeGreaterThanOrEqual(160);
  });

  it('an elite recovery week long steps below the 180 ceiling', () => {
    const p = gen({ raceType: 'runmarathon', fitness: 'elite', fivekSec: 1100, raceDate: '2026-12-20' });
    const recLongs = p.weeks.filter(w => w.isRecovery && w.phase !== 'Taper' && !w.workouts.some(x => x.race))
      .flatMap(w => w.workouts).filter(x => x.role === 'long');
    expect(recLongs.length).toBeGreaterThan(0);
    recLongs.forEach(x => expect(x.durationMin).toBeLessThan(180));
  });

  it('no solo run session under 20 minutes, any config', () => {
    ['beginner', 'elite'].forEach(lvl => [5, 7].forEach(days => {
      const p = gen({ raceType: 'run5k', fitness: lvl, daysPerWeek: days });
      p.weeks.flatMap(w => w.workouts)
        .filter(x => x.discipline === 'run' && !x.race)
        .forEach(x => expect(x.durationMin).toBeGreaterThanOrEqual(20));
    }));
  });

  it('BEGINNERS can reach the race-pace variant despite the 3-week recovery cadence', () => {
    // beginner seeds are never 2 mod 3 outside recovery weeks, so a flat
    // seed % 3 selector could never pick the race-pace slot
    const p = gen({ raceType: 'runmarathon', fitness: 'beginner', raceDate: '2026-12-20' });
    const rp = p.weeks.flatMap(w => w.workouts).flatMap(x => x.segments || [])
      .filter(s => s.label && s.label.indexOf('marathon effort') >= 0);
    expect(rp.length).toBeGreaterThan(0);
  });

  it('marathon effort quotes one pace inside the long-to-tempo band, never a 78 second bracket', () => {
    const p = gen({ raceType: 'runmarathon', fivekSec: 1620, raceDate: '2026-12-20' });
    const segs = p.weeks.flatMap(w => w.workouts).flatMap(x => x.segments || [])
      .filter(s => s.label && s.label.indexOf('marathon effort') >= 0);
    expect(segs.length).toBeGreaterThan(0);
    segs.forEach(s => {
      expect(s.detail).toMatch(/^~\d+:\d\d \/km/);
      expect(s.detail).not.toMatch(/to \d+:\d\d/);
    });
  });

  it('four consecutive training days still space the two qualities', () => {
    const p = gen({ raceType: 'runhalf', daysPerWeek: 4, trainingDays: [0, 1, 2, 3], longDay: 3 });
    const wk = p.weeks.find(w => !w.isRecovery && !w.workouts.some(x => x.test || x.race));
    const qDays = wk.workouts.filter(w => w.role === 'quality').map(w => Number(w.id.split('-')[1]));
    expect(qDays.length).toBe(2);
    expect(Math.abs(qDays[0] - qDays[1])).toBeGreaterThanOrEqual(2);
  });

  it('the post-race recovery week is a real week, not one jog', () => {
    const p = gen({ raceType: 'runmarathon', daysPerWeek: 5, raceDate: '2026-11-22' });
    const rec = p.weeks[p.weeks.length - 1];
    expect(rec.isRecovery).toBe(true);
    const runs = rec.workouts.filter(x => x.discipline === 'run');
    expect(runs.length).toBe(3);
    const sigs = runs.map(x => x.type + '|' + x.durationMin);
    expect(new Set(sigs).size).toBe(sigs.length);
  });
});

describe('race-pace long runs', () => {
  it('the marathon rehearses race effort in Build and Peak, never in Base', () => {
    const p = gen({ raceType: 'runmarathon', raceDate: '2026-12-20' });
    const withRp = p.weeks.filter(w => w.workouts.some(x =>
      x.segments && x.segments.some(s => s.label && s.label.indexOf('marathon effort') >= 0)));
    expect(withRp.length).toBeGreaterThan(0);
    withRp.forEach(w => {
      expect(['Build', 'Peak']).toContain(w.phase);
      expect(w.isRecovery).toBe(false);
    });
    // pace range quoted with a tilde from the real 5k
    const seg = withRp[0].workouts.flatMap(x => x.segments || []).find(s => s.label.indexOf('marathon effort') >= 0);
    expect(seg.detail).toMatch(/^~\d+:\d\d \/km/); // one pace, never the finish-time bracket
  });

  it('an estimated 5k speaks in effort, never in projected numbers', () => {
    const p = gen({ raceType: 'runhalf', fivekSec: null, raceDate: '2026-12-20' });
    const segs = p.weeks.flatMap(w => w.workouts).flatMap(x => x.segments || [])
      .filter(s => s.label && s.label.indexOf('half marathon effort') >= 0);
    expect(segs.length).toBeGreaterThan(0);
    segs.forEach(s => {
      // per-distance effort wording: the half sits at tempo (the marathon
      // keeps the long-to-tempo band), matching what a real 5k would quote
      expect(s.detail).toBe('Around your tempo pace, controlled');
    });
  });

  it('recovery weeks keep the pure steady long (variant 0 by pinned seed)', () => {
    const p = gen({ raceType: 'runmarathon', raceDate: '2026-12-20' });
    p.weeks.filter(w => w.isRecovery && !w.workouts.some(x => x.race)).forEach(w => {
      const long = w.workouts.find(x => x.role === 'long');
      if (long) expect(long.segments.some(s => s.label.indexOf('marathon effort') >= 0)).toBe(false);
    });
  });
});

describe('tune-up races around solo entries', () => {
  it('a parkrun inside a TRIATHLON plan still renders the race-it shape, not Swim 0 km', () => {
    const p = generatePlan({
      ...base, raceType: 'olympic', css100Sec: 120, ftp: 250, weightKg: 75,
      bRaces: [{ kind: 'run5k', date: '2026-09-12' }],
    });
    const b = p.weeks.flatMap(w => w.workouts).find(w => w.bRace);
    expect(b).toBeTruthy();
    expect(b.segments.some(s => /Swim|Bike/.test(s.label))).toBe(false);
    expect(b.segments.some(s => s.label.indexOf('race it') >= 0)).toBe(true);
  });

  it('a raced half inside a marathon plan eases two days out the back; a parkrun does not', () => {
    const mk = kind => generatePlan({
      ...base, raceType: 'runmarathon', raceDate: '2026-12-20',
      bRaces: [{ kind, date: '2026-10-31' }], // a Saturday, mid-plan, clear of test weeks
    });
    const dayAfter = (p, d) => p.weeks.flatMap(w => w.workouts)
      .find(x => x.date === iso(addDays(new Date('2026-10-31'), d)) && x.discipline === 'run');
    const half = mk('runhalf');
    const bh = half.weeks.flatMap(w => w.workouts).find(w => w.bRace);
    expect(bh.title).toContain('Half Marathon Race');
    const twoOutHalf = dayAfter(half, 2);
    const park = mk('run5k');
    const twoOutPark = dayAfter(park, 2);
    // same slot, same plan shape: eased under the half, untouched under the parkrun
    if (twoOutHalf && twoOutPark) expect(twoOutHalf.durationMin).toBeLessThan(twoOutPark.durationMin);
  });

  it('the 10-day taper guard holds for solo goal races too', () => {
    const p = generatePlan({
      ...base, raceType: 'runmarathon', raceDate: '2026-12-20',
      bRaces: [{ kind: 'run5k', date: '2026-12-13' }], // 7 days out: ignored
    });
    expect(p.weeks.flatMap(w => w.workouts).some(w => w.bRace)).toBe(false);
  });
});

describe('the coach brain on a solo plan', () => {
  const plan = gen({ raceType: 'runmarathon', raceDate: '2026-12-20' });
  // stale triathlon baselines that would otherwise name a limiter
  plan.profile.css100Sec = 95;
  plan.profile.ftp = 310;
  plan.profile.weightKg = 70;
  const wk = plan.weeks.find(w => !w.isRecovery && w.index >= 2 && !w.workouts.some(x => x.test));
  const cleanLog = Object.fromEntries(wk.workouts.filter(x => x.discipline !== 'rest' && !x.race).map(x => [x.id, { done: true }]));
  const args = {
    plan, log: cleanLog, moves: {}, adjust: {}, adjustLog: [], wellness: [], activities: [],
    missedReasons: {}, todayISO: iso(addDays(new Date(wk.start), 8)), weekMonday: wk.start, prevWeeks: [],
  };

  it('clean week one reads the solo one-more-week copy, no limiter language', () => {
    const d = decideWeek(args);
    expect(d.disciplines.run).toBeTruthy();
    expect(d.disciplines.bike).toBeUndefined();
    expect(d.disciplines.swim).toBeUndefined();
    expect(d.disciplines.run.decision).toBe('hold');
    const rep = d.disciplines.run.evidence.find(e => e.signal === 'repeatability');
    expect(rep.reading).toMatch(/progression needs/);
    expect(rep.reading).not.toMatch(/limiter/);
  });

  it('two clean weeks progress the run: the degenerate limiter actuates', () => {
    const prevMonday = iso(addDays(new Date(wk.start), -7));
    const d = decideWeek({
      ...args,
      prevWeeks: [{ weekMonday: prevMonday, tracker: false, planCreatedAt: plan.createdAt, disciplines: { run: { clean: true } } }],
    });
    expect(d.disciplines.run.decision).toBe('progress');
    expect(d.progression.discipline).toBe('run');
    const rep = d.disciplines.run.evidence.find(e => e.signal === 'repeatability');
    expect(rep.reading).not.toMatch(/limiter/);
  });

  it('solo decision copy obeys the house rules', () => {
    const d = decideWeek(args);
    const texts = [d.overall.headline]
      .concat(d.overall.evidence.map(e => e.reading))
      .concat(Object.values(d.disciplines).flatMap(x => [x.headline].concat(x.evidence.map(e => e.reading))));
    texts.filter(Boolean).forEach(sx => {
      expect(sx).not.toMatch(/—/);
      expect(sx).not.toMatch(/\b[A-Z]{3,}\b/);
    });
  });
});

describe('plan-scoped gates', () => {
  it('resolveFocus on a solo plan ignores a stale declared focus, no divergence', () => {
    const fx = resolveFocus({ blockFocus: 'swim' }, { weakest: 'bike', strongest: 'run' }, 'run');
    expect(fx).toEqual({ focus: 'run', derived: 'run', declared: null, diverges: false });
    // tracker callers pass null solo and keep the full resolution
    const fx2 = resolveFocus({ blockFocus: 'swim' }, { weakest: 'bike', strongest: 'run' }, null);
    expect(fx2.focus).toBe('swim');
    expect(fx2.diverges).toBe(true);
  });

  it('weakestLink on a solo raceType returns a verdict without the race-share lie', () => {
    const wl = weakestLink({ profile: { raceType: 'runmarathon', fitness: 'intermediate', fivekSec: 1800, css100Sec: 95, ftp: 310, weightKg: 70 } });
    expect(wl).toBeTruthy(); // tracker mode still gets its board
    expect(wl.share).toBe(null); // never "the swim is 100% of your race"
  });

  it('eftpProposal on a solo plan is silent for swim and bike, live for run', () => {
    const plan = gen({ raceType: 'runmarathon', raceDate: '2026-12-20' });
    plan.profile.ftp = 310;
    // a leftover intervals.icu swim setting proposes nothing on a run plan
    const swim = eftpProposal({ activities: [], thresholds: { swimThresholdPace: 1.5 }, plan, todayISO: '2026-09-01' });
    expect(swim).toBe(null);
    // run threshold drift still fires
    const planSec = plan.paces.run.threshold;
    const fast = 1000 / (planSec * 0.9);
    const run = eftpProposal({ activities: [], thresholds: { runThresholdPace: fast }, plan, todayISO: '2026-09-01' });
    expect(run).toBeTruthy();
    expect(run.sport).toBe('run');
  });
});

describe('runner-calibrated experience levels (signed off 2026-07-22)', () => {
  const RUN_ANCHOR = { beginner: 2160, intermediate: 1680, advanced: 1320, elite: 1050 };
  const mk = (raceType, fitness, over) => generatePlan({
    name: 'R', raceType, fitness, daysPerWeek: 5, trainingDays: null,
    startDate: '2026-08-03', raceDate: '2026-11-22', ...over,
  });

  it('a blank-5k solo plan derives every pace from the RUNNER anchor', () => {
    Object.keys(RUN_ANCHOR).forEach(lvl => {
      const pc = mk('runmarathon', lvl).paces.run;
      const p = RUN_ANCHOR[lvl] / 5;
      expect(pc.fivekPace).toBe(p);
      // the whole offset chain propagates from the anchor
      expect(pc.easy).toBe(p + 70);
      expect(pc.threshold).toBe(p + 12);
      expect(pc.interval).toBe(p - 8);
    });
  });

  it('a blank-5k triathlon plan still derives from the triathlete est5k', () => {
    Object.keys(RUN_ANCHOR).forEach(lvl => {
      expect(mk('olympic', lvl).paces.run.fivekPace).toBe(FITNESS[lvl].est5k / 5);
    });
  });

  it('an entered 5k always wins, whatever the plan or level', () => {
    expect(mk('runmarathon', 'elite', { fivekSec: 1500 }).paces.run.fivekPace).toBe(300);
    expect(mk('olympic', 'beginner', { fivekSec: 1500 }).paces.run.fivekPace).toBe(300);
  });

  it('the runner anchor is a separate field: the weakest-link ladder is untouched', () => {
    // weakest.js maps f.est5k by name; adding runEst5k must not perturb it
    expect(Object.values(FITNESS).map(f => f.est5k)).toEqual([2040, 1620, 1320, 1110]);
    // and the runner scale is slower at the bottom, faster at the top
    expect(FITNESS.beginner.runEst5k).toBeGreaterThan(FITNESS.beginner.est5k);
    expect(FITNESS.elite.runEst5k).toBeLessThan(FITNESS.elite.est5k);
    // no runner rung faster than its triathlete twin except elite (the carried constraint)
    ['beginner', 'intermediate', 'advanced'].forEach(lvl =>
      expect(FITNESS[lvl].runEst5k).toBeGreaterThanOrEqual(FITNESS[lvl].est5k));
  });

  it('the pace tuner seeds from the runner anchor on solo, the triathlete anchor otherwise', () => {
    const sug = [{ discipline: 'run', direction: 'faster' }];
    expect(tuneFields({ raceType: 'runmarathon', fitness: 'intermediate' }, sug).fivekSec)
      .toBe(Math.round(1680 * 0.98));
    expect(tuneFields({ raceType: 'olympic', fitness: 'intermediate' }, sug).fivekSec)
      .toBe(Math.round(1620 * 0.98));
    // an entered time still wins through the tuner
    expect(tuneFields({ raceType: 'runmarathon', fitness: 'intermediate', fivekSec: 1500 }, sug).fivekSec)
      .toBe(Math.round(1500 * 0.98));
  });

  it('a tracker profile with no raceType keeps the triathlete anchor (no spurious runner scale)', () => {
    // computePaces sees RACES[undefined] === {}, so soloRun is false
    const pc = generatePlan({ name: 'T', raceType: 'maintenance', fitness: 'intermediate', horizonWeeks: 12, daysPerWeek: 5, startDate: '2026-08-03', raceDate: '2026-10-26' }).paces.run;
    expect(pc.fivekPace).toBe(FITNESS.intermediate.est5k / 5);
  });
});

describe('domain shape', () => {
  it('solo entries carry numeric zero legs and honest windows', () => {
    ['run5k', 'run10k', 'runhalf', 'runmarathon'].forEach(k => {
      const r = RACES[k];
      expect(r.solo).toBe('run');
      expect(r.swim).toBe(0);
      expect(r.bike).toBe(0);
      expect(r.run).toBeGreaterThan(0);
      expect(r.minWeeks).toBeGreaterThanOrEqual(6);
    });
    expect(RACES.runmarathon.taperWeeks).toBe(2);
    expect(RACES.runhalf.taperWeeks).toBe(1);
    expect(B_RACES.runhalf.discipline).toBe('run');
    expect(B_RACES.runmarathon).toBeUndefined(); // nobody races a marathon as a rehearsal
  });
});
