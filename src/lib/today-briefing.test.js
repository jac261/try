import { describe, it, expect } from 'vitest';
import { todayBriefing, sessionLabel } from './today-briefing.js';
import { generatePlan, buildTrackerPlan } from './plan.js';
import { bikeFuellingPlan } from './bike-fuelling.js';
import { runFuellingPlan } from './run-fuelling.js';
import { effDate } from './schedule.js';

/* The Today briefing selector: a pure read over generated plans. Every
   fixture below is a REAL generated plan, so if the generator's double or
   key mechanisms ever change shape, these tests break loudly instead of
   the copy going quietly stale. */

const profile = (over = {}) => ({
  name: 'P', raceType: 'olympic', fitness: 'elite',
  fivekSec: 1200, css100Sec: 95, ftp: 300, weightKg: 72,
  trainingDays: [0, 1, 2, 3, 4, 5, 6], longDay: 5, daysPerWeek: 7,
  startDate: '2026-06-01', raceDate: '2026-09-27', ...over,
});

const brief = (plan, todayISO, over = {}) =>
  todayBriefing({ plan, todayISO, moves: {}, fuelLog: {}, easedOf: w => w, ...over });

// find a date whose sessions satisfy pred, across the whole plan
const findDay = (plan, pred) => {
  const all = plan.weeks.flatMap(w => w.workouts);
  const dates = [...new Set(all.map(w => w.date))];
  return dates.find(d => pred(all.filter(w => w.date === d && w.discipline !== 'rest')));
};

describe('priority ranking', () => {
  const plan = generatePlan(profile());

  it('race day outranks everything and gets the race copy', () => {
    const raceDate = findDay(plan, day => day.some(w => w.race));
    expect(raceDate).toBeTruthy();
    const b = brief(plan, raceDate);
    expect(b.contextLine).toBe('Race week');
    expect(b.priorityLine).toContain('Race day');
    expect(b.dependencyLine).toBe(null); // nothing to negotiate on race day
  });

  it('a key session outranks a quality session on a shared day', () => {
    const d = findDay(plan, day => day.some(w => w.key && !w.race && !w.test)
      && day.some(w => w.role === 'quality' && !w.key) && day.length >= 2);
    if (!d) return; // shape not present in this plan; the double tests cover multiples
    const b = brief(plan, d);
    const all = plan.weeks.flatMap(w => w.workouts).filter(w => w.date === d);
    const key = all.find(w => w.key && !w.race && !w.test);
    expect(b.primaryId).toBe(key.id);
  });

  it('a stacked double is never primary while its host is present', () => {
    const d = findDay(plan, day => day.some(w => w.second) && day.length >= 2);
    expect(d, 'no double day found in an elite 7-day plan').toBeTruthy();
    const b = brief(plan, d);
    const day = plan.weeks.flatMap(w => w.workouts).filter(w => w.date === d);
    const dbl = day.find(w => w.second);
    expect(b.primaryId).not.toBe(null);
    expect(b.primaryId).not.toBe(dbl.id);
  });

  it('a rest day briefs rest; a single-session day marks no primary', () => {
    const restDay = findDay(plan, day => day.length === 0);
    if (restDay) {
      const b = brief(plan, restDay);
      expect(b.priorityLine).toBe('Rest day. Recover and adapt.');
      expect(b.primaryId).toBe(null);
    }
    const single = findDay(plan, day => day.length === 1 && !day[0].race);
    expect(single).toBeTruthy();
    const b1 = brief(plan, single);
    expect(b1.primaryId).toBe(null);       // spec: multiples only
    expect(b1.dependencyLine).toBe(null);
    expect(b1.priorityLine).toContain("Today's priority: ");
  });
});

describe('dependency copy, gated on real co-location', () => {
  const plan = generatePlan(profile());
  const all = plan.weeks.flatMap(w => w.workouts);

  it('the strength double day gets the stacked-on-purpose line', () => {
    const d = findDay(plan, day => day.some(w => w.second && w.discipline === 'strength') && day.length >= 2);
    expect(d, 'no strength-double day generated').toBeTruthy();
    const b = brief(plan, d);
    expect(b.dependencyLine).toContain('Strength is stacked here on purpose');
  });

  it('the volume-double day gets the added-volume line, if the plan builds one', () => {
    const d = findDay(plan, day => day.some(w => w.second && w.discipline === 'bike' && w.role === 'easy') && day.length >= 2);
    if (!d) return; // volumeDouble is hours-gated; the strength double covers the mechanism
    const b = brief(plan, d);
    expect(b.dependencyLine).toContain('added volume, built easy on purpose');
  });

  it('a double dragged onto another day fabricates NOTHING: engine pairings only', () => {
    /* The dependency copy asserts engine intent, so an athlete-assembled
       co-location must never earn it (gauntlet 2026-08-01: the strength
       double moved onto an easy swim day claimed "stacked here on purpose,
       so your easy days stay easy"). The gate is the RAW generated dates:
       equal = the engine's own pairing, different = the athlete's. */
    const dbl = all.find(w => w.second && w.discipline === 'strength');
    expect(dbl).toBeTruthy();
    const stranger = all.find(w => !w.second && w.discipline !== 'rest' && !w.race && w.date !== dbl.date);
    expect(stranger).toBeTruthy();
    const moves = { [dbl.id]: stranger.date };
    const b = todayBriefing({ plan, todayISO: stranger.date, moves, fuelLog: {}, easedOf: w => w });
    expect(b.dependencyLine).toBe(null);
    expect(b.primaryId).toBe(stranger.id); // marking still works; only the copy stays silent
  });

  it('a pairing moved TOGETHER to an empty day keeps its line', () => {
    /* Raw dates equal = still the engine's pairing wherever it lands. The
       target must be an EMPTY day: landing beside resident sessions makes a
       mixed day the engine never built, and the line correctly stays
       silent there (the b.dependencyLine === null path below). */
    // a 7-day plan has no empty days to move onto; a 5-day plan does
    const p5 = generatePlan(profile({ trainingDays: [0, 1, 3, 5, 6], daysPerWeek: 5 }));
    const all5 = p5.weeks.flatMap(w => w.workouts);
    const dbl = all5.find(w => w.second && w.discipline === 'strength');
    expect(dbl, 'no strength double in the 5-day plan').toBeTruthy();
    const host = all5.find(w => w.date === dbl.date && !w.second && w.discipline !== 'rest');
    expect(host).toBeTruthy();
    const dates = new Set(all5.filter(w => w.discipline !== 'rest').map(w => w.date));
    let t = null;
    for (let i = 1; i <= 14 && !t; i++) {
      const c = new Date(dbl.date); c.setDate(c.getDate() + i);
      const iso = c.toISOString().slice(0, 10);
      if (!dates.has(iso)) t = iso;
    }
    expect(t, 'no empty day near the pair').toBeTruthy();
    const moves = { [dbl.id]: t, [host.id]: t };
    const b = todayBriefing({ plan: p5, todayISO: t, moves, fuelLog: {}, easedOf: w => w });
    expect(b.dependencyLine).toContain('Strength is stacked here on purpose');
    // and landing beside a resident session silences it (mixed day)
    const resident = all5.find(w => !w.second && w.discipline !== 'rest' && !w.race && w.date !== dbl.date);
    const b2 = todayBriefing({ plan: p5, todayISO: resident.date, moves: { [dbl.id]: resident.date, [host.id]: resident.date }, fuelLog: {}, easedOf: w => w });
    expect(b2.dependencyLine).toBe(null);
  });

  it('moving the host off the day kills the line and the lone double gets no primary marking', () => {
    const d = findDay(plan, day => day.some(w => w.second) && day.length === 2);
    expect(d).toBeTruthy();
    const day = all.filter(w => w.date === d && w.discipline !== 'rest');
    const host = day.find(w => !w.second);
    // move the host three days out
    const target = new Date(d); target.setDate(target.getDate() + 3);
    const moves = { [host.id]: target.toISOString().slice(0, 10) };
    const b = todayBriefing({ plan, todayISO: d, moves, fuelLog: {}, easedOf: w => w });
    expect(b.dependencyLine).toBe(null);
    expect(b.primaryId).toBe(null); // one session left: no marking
    // and the moved host is briefed at its new date
    const b2 = todayBriefing({ plan, todayISO: moves[host.id], moves, fuelLog: {}, easedOf: w => w });
    expect(effDate(host, moves)).toBe(moves[host.id]);
    expect(b2.priorityLine).toContain("Today's priority");
  });
});

describe('cue parity with the detail sheet', () => {
  const plan = generatePlan(profile());
  const all = plan.weeks.flatMap(w => w.workouts);

  it('a long ride cue carries exactly the numbers bikeFuellingPlan gives the sheet', () => {
    const long = all.find(w => w.discipline === 'bike' && w.type === 'Long' && !w.race);
    expect(long, 'no long ride generated').toBeTruthy();
    const b = todayBriefing({ plan, todayISO: long.date, moves: {}, fuelLog: {}, easedOf: w => w });
    const sheet = bikeFuellingPlan({ workout: long, profile: plan.profile, fuelLog: {}, brickFollows: false });
    expect(sheet).toBeTruthy();
    const cue = (b.cues[long.id] || []).find(c => c.text.includes('g carbs'));
    expect(cue, 'no fuelling cue for the long ride').toBeTruthy();
    expect(cue.text).toContain(sheet.carbsPerHour + ' g carbs an hour');
    expect(cue.text).toContain('start inside the first ' + sheet.startAfterMin + ' min');
  });

  it('a low proven tolerance CAPS the cue, in lockstep with the sheet', () => {
    /* The cap only bites when session demand exceeds proven + one gut step.
       Olympic-distance rides never ask more than the no-history default, so
       the fixture is a half-distance plan whose long rides do. A wrong level
       key here silently exercises nothing (the first version used a numeric
       level the closed set does not contain), so the test asserts
       capped === true before trusting the parity. */
    const halfPlan = generatePlan(profile({ raceType: 'half' }));
    const halfAll = halfPlan.weeks.flatMap(w => w.workouts);
    const fuelLog = { a1: { level: 'bit', discipline: 'bike' } };
    const target = halfAll.find(w => {
      if (w.race || (w.discipline !== 'bike' && w.discipline !== 'brick')) return false;
      const f = bikeFuellingPlan({ workout: w, profile: halfPlan.profile, fuelLog, brickFollows: w.discipline === 'brick' });
      return f && f.capped;
    });
    expect(target, 'no session in a half plan exercises the cap').toBeTruthy();
    const sheet = bikeFuellingPlan({ workout: target, profile: halfPlan.profile, fuelLog, brickFollows: target.discipline === 'brick' });
    expect(sheet.capped).toBe(true);
    const b = todayBriefing({ plan: halfPlan, todayISO: target.date, moves: {}, fuelLog, easedOf: w => w });
    const cue = (b.cues[target.id] || []).find(c => c.text.includes('g carbs'));
    expect(cue).toBeTruthy();
    expect(cue.text).toContain(sheet.carbsPerHour + ' g carbs an hour');
  });

  it('a long run gets run numbers, not bike numbers', () => {
    const long = all.find(w => w.discipline === 'run' && (w.role === 'long' || w.type === 'Long') && !w.race && w.durationMin >= 75);
    expect(long, 'no fuelling-length long run generated').toBeTruthy();
    const b = brief(plan, long.date);
    const sheet = runFuellingPlan({ workout: long, profile: plan.profile, fuelLog: {} });
    expect(sheet).toBeTruthy();
    const cue = (b.cues[long.id] || []).find(c => c.text.includes('g carbs'));
    expect(cue).toBeTruthy();
    expect(cue.text).toContain(sheet.carbPerHour + ' g carbs an hour');
    expect(cue.text).toContain('ml fluid an hour');
  });

  it('short sessions and race day get no cues', () => {
    const short = all.find(w => w.discipline === 'bike' && !w.race && w.durationMin < 75 && w.type !== 'Long');
    if (short) {
      const b = brief(plan, short.date);
      expect((b.cues[short.id] || []).filter(c => c.text.includes('g carbs'))).toEqual([]);
    }
    const raceDate = findDay(plan, day => day.some(w => w.race));
    const b2 = brief(plan, raceDate);
    const race = all.find(w => w.date === raceDate && w.race);
    expect(b2.cues[race.id]).toBeUndefined();
  });
});

describe('context copy', () => {
  it('recovery week says so and coaches restraint', () => {
    const plan = generatePlan(profile());
    const rec = plan.weeks.find(w => w.isRecovery && w.workouts.some(x => x.discipline !== 'rest' && !x.race));
    expect(rec, 'no recovery week generated').toBeTruthy();
    const d = rec.workouts.find(x => x.discipline !== 'rest' && !x.race).date;
    const b = brief(plan, d);
    expect(b.contextLine).toContain('Recovery week · week ');
    expect(b.priorityLine).toBe('Keep today controlled even if you feel strong.');
  });

  it('a maintenance plan labels itself maintenance', () => {
    const plan = generatePlan(profile({ raceType: 'maintenance', raceDate: '2026-08-23' }));
    const d = findDay(plan, day => day.length >= 1);
    const b = brief(plan, d);
    expect(b.contextLine).toContain('Maintenance · week ');
  });

  it('tracker plans get no briefing at all', () => {
    const t = buildTrackerPlan(generatePlan(profile()), '2026-07-13T10:00:00.000Z');
    expect(todayBriefing({ plan: t, todayISO: '2026-07-14', moves: {}, fuelLog: {}, easedOf: w => w })).toBe(null);
  });

  it('a tune-up day briefs the tune-up race, never "the run RACE"', () => {
    const plan = generatePlan(profile({ bRaces: [{ date: '2026-07-18', kind: 'run5k' }] }));
    const all = plan.weeks.flatMap(w => w.workouts);
    const tune = all.find(w => w.bRace);
    expect(tune, 'no tune-up injected').toBeTruthy();
    const b = todayBriefing({ plan, todayISO: tune.date, moves: {}, fuelLog: {}, easedOf: w => w });
    expect(b.priorityLine).toBe("Today's priority: the tune-up race");
    expect(b.priorityLine).not.toContain('RACE');
  });

  it('adjective types read adjective-first', () => {
    expect(sessionLabel({ discipline: 'run', type: 'Easy' })).toBe('the easy run');
    expect(sessionLabel({ discipline: 'swim', type: 'Easy' })).toBe('the easy swim');
    expect(sessionLabel({ discipline: 'swim', type: 'Open Water' })).toBe('the open water swim');
  });

  it('an empty day beyond the plan gets no briefing, but a session moved out there does', () => {
    const plan = generatePlan(profile());
    const all = plan.weeks.flatMap(w => w.workouts);
    const last = all[all.length - 1].date;
    const beyond = new Date(last); beyond.setDate(beyond.getDate() + 10);
    const bISO = beyond.toISOString().slice(0, 10);
    expect(todayBriefing({ plan, todayISO: bISO, moves: {}, fuelLog: {}, easedOf: w => w })).toBe(null);
    // the scheduled post-race recovery week is IN range and briefs honestly
    const lastWeek = plan.weeks[plan.weeks.length - 1];
    if (lastWeek.isRecovery) {
      const d = lastWeek.workouts[0].date;
      expect(todayBriefing({ plan, todayISO: d, moves: {}, fuelLog: {}, easedOf: w => w })).not.toBe(null);
    }
    // a moved session out beyond the end still earns its briefing (the week
    // context falls back to the final week, the established resolution rule)
    const some = all.find(w => w.discipline !== 'rest' && !w.race && !w.second);
    const b = todayBriefing({ plan, todayISO: bISO, moves: { [some.id]: bISO }, fuelLog: {}, easedOf: w => w });
    expect(b).not.toBe(null);
    expect(b.contextLine).toBeTruthy();
  });

  it('a logged session loses its prep cues: preparation ends when the session starts', () => {
    const plan = generatePlan(profile());
    const all = plan.weeks.flatMap(w => w.workouts);
    const long = all.find(w => w.discipline === 'bike' && w.type === 'Long' && !w.race);
    const before = todayBriefing({ plan, todayISO: long.date, moves: {}, fuelLog: {}, easedOf: w => w });
    expect(before.cues[long.id]).toBeTruthy();
    const after = todayBriefing({ plan, todayISO: long.date, moves: {}, fuelLog: {}, easedOf: w => w, log: { [long.id]: { completed: true } } });
    expect(after.cues[long.id]).toBeUndefined();
  });
});

describe('copy hygiene', () => {
  it('no produced string carries an em dash, a zero-minute, or a hole', () => {
    const plan = generatePlan(profile());
    const dates = [...new Set(plan.weeks.flatMap(w => w.workouts).map(w => w.date))];
    for (const d of dates) {
      const b = brief(plan, d);
      const strings = [b.contextLine, b.priorityLine, b.dependencyLine,
        ...Object.values(b.cues).flat().map(c => c.text)].filter(Boolean);
      for (const s of strings) {
        expect(s).not.toContain('—');
        expect(s).not.toContain('0 min ');
        expect(s).not.toMatch(/NaN|undefined/);
      }
    }
  });

  it('sessionLabel keeps acronyms readable', () => {
    expect(sessionLabel({ discipline: 'swim', type: 'CSS Intervals' })).toBe('the swim CSS intervals');
    expect(sessionLabel({ discipline: 'bike', type: 'Threshold' })).toBe('the bike threshold');
    expect(sessionLabel({ discipline: 'run', role: 'long' })).toBe('the long run');
    expect(sessionLabel({ discipline: 'brick', type: 'Brick' })).toBe('the brick session');
  });
});
