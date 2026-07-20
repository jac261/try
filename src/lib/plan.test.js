import { describe, it, expect } from 'vitest';
import { generatePlan, easeWorkout, trimWorkout, boostWorkout, addCustomWorkout, removeCustomWorkout, upgradePlanSegments, buildTrackerPlan, applyTrackerFitness, segMinutes, planEnded } from './plan.js';
import { RACES } from './domain.js';
import { estimateTss } from './adapt.js';
import { iso, addDays } from './date.js';

const profile = (raceDate, startDate) => ({
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  raceDate, startDate,
});

describe('planEnded (the default-to-no-plan rule)', () => {
  const p = generatePlan(profile('2026-09-23', '2026-07-01'));
  const lastDay = iso(addDays(p.weeks[p.weeks.length - 1].start, 6));
  const GRACE = 7; // legacy race plans (no scheduled recovery week) linger this long

  it('a race plan ends the morning after its scheduled recovery week, no extra grace', () => {
    // The generated plan's last week IS the recovery week now, so lastDay is
    // the recovery week's Sunday.
    expect(p.weeks[p.weeks.length - 1].isRecovery).toBe(true);
    expect(planEnded(p, '2026-07-15')).toBe(false);            // mid-plan
    expect(planEnded(p, lastDay)).toBe(false);                 // recovery week's last day
    expect(planEnded(p, iso(addDays(lastDay, 1)))).toBe(true); // the morning after
  });

  it('a LEGACY race plan (last week is race week, no recovery week) keeps the 7-day grace', () => {
    // Simulate a plan cached before the scheduled recovery week existed.
    const legacy = { ...p, weeks: p.weeks.slice(0, -1) };
    const legacyLast = iso(addDays(legacy.weeks[legacy.weeks.length - 1].start, 6));
    expect(legacy.weeks[legacy.weeks.length - 1].isRecovery).toBe(false);
    expect(planEnded(legacy, iso(addDays(legacyLast, GRACE)))).toBe(false);     // banner window
    expect(planEnded(legacy, iso(addDays(legacyLast, GRACE + 1)))).toBe(true);  // then default
  });

  it('a Sunday race still gets its banner window: the recovery week follows race day', () => {
    // 2026-09-20 is a Sunday — race day is the last day of the BUILD portion;
    // the scheduled recovery week follows it, so the post-race banner has a
    // full week before the default kicks in.
    const sun = generatePlan(profile('2026-09-20', '2026-07-01'));
    const raceDay = sun.weeks.flatMap(w => w.workouts).find(w => w.race).date;
    const recWeek = sun.weeks[sun.weeks.length - 1];
    expect(recWeek.isRecovery).toBe(true);
    expect(recWeek.start).toBe(iso(addDays(raceDay, 1))); // Monday after the Sunday race
    expect(planEnded(sun, iso(addDays(raceDay, 1)))).toBe(false); // banner + recovery week
    expect(planEnded(sun, iso(addDays(recWeek.start, 7)))).toBe(true); // morning after it ends
  });

  it('the recovery week is all easy sessions: no longs, bricks, quality or strength', () => {
    const rec = p.weeks[p.weeks.length - 1];
    const sessions = rec.workouts.filter(w => w.discipline !== 'rest');
    expect(sessions.length).toBeGreaterThan(0);
    sessions.forEach(w => {
      expect(['Easy', 'Technique', 'Endurance'], w.id + ' ' + w.type).toContain(w.type);
      expect(w.discipline, w.id).not.toBe('brick');
      expect(w.discipline, w.id).not.toBe('strength');
      expect(w.test, w.id).toBeFalsy();
      expect(w.durationMin, w.id).toBeLessThanOrEqual(60);
      // BUILT content, not just the type label: the first cut typed the bikes
      // "Easy", which buildBike has no branch for — they fell into its
      // Threshold else-branch and carried tempo blocks under an easy name.
      // Swims allow Z3: the canonical Technique format's steady 100s are
      // Z3-tagged in every recovery week today (pre-existing, gentle in
      // absolute stress); run and bike stay strictly Z1/Z2.
      expect(w.title, w.id).not.toMatch(/threshold|sweet spot|vo2|tempo/i);
      const okZones = w.discipline === 'swim' ? ['Z1', 'Z2', 'Z3'] : ['Z1', 'Z2'];
      w.segments.forEach(s => {
        if (s.zone) expect(okZones, w.id + ' ' + s.label).toContain(s.zone);
        (s.blocks || []).forEach(b => expect(okZones, w.id + ' block').toContain(b.zone));
      });
    });
  });

  it('the appended week never deloads the final Peak week (boundary reads buildWeeks)', () => {
    // Re-verify catch: `w < totalWeeks - 2` loosened by the appended week let
    // the periodic step-back land on the last Peak (sharpening) week — sprint,
    // intermediate, 9-week build flips week index 7 when the boundary is wrong.
    const p = generatePlan({ ...profile('2026-09-13', '2026-07-13'), raceType: 'sprint' });
    const peakWeeks = p.weeks.filter(w => w.phase === 'Peak');
    expect(peakWeeks.length).toBeGreaterThan(0);
    expect(peakWeeks[peakWeeks.length - 1].isRecovery).toBe(false); // the sharpening week stays sharp
    // and its quality is real quality, not recovery types
    const lastPeak = peakWeeks[peakWeeks.length - 1];
    expect(lastPeak.workouts.some(w => ['Threshold', 'VO2 Intervals', 'Race Pace', 'Sweet Spot', 'Open Water', 'Tempo'].includes(w.type))).toBe(true);
  });

  it('a race exactly 40 build-weeks out still saves: no recovery week appended past the backend cap', () => {
    const far = generatePlan({ ...profile(iso(addDays('2026-07-06', 40 * 7 - 1)), '2026-07-06'), raceType: 'full' });
    expect(far.totalWeeks).toBeLessThanOrEqual(40);       // backend MaxWeeks: previously savable stays savable
    expect(far.weeks.length).toBe(far.totalWeeks);        // backend requires the counts to match
    expect(far.weeks[far.weeks.length - 1].isRecovery).toBe(false); // legacy shape → planEnded grace covers post-race
    expect(planEnded(far, iso(addDays(addDays(far.weeks[far.weeks.length - 1].start, 6), 7)))).toBe(false); // grace holds
    expect(planEnded(far, iso(addDays(addDays(far.weeks[far.weeks.length - 1].start, 6), 8)))).toBe(true);
  });

  it('never fires for tracker, empty or missing plans', () => {
    expect(planEnded(buildTrackerPlan(p, '2026-07-13T10:00:00.000Z'), '2099-01-01')).toBe(false);
    expect(planEnded({ race: 'olympic', weeks: [] }, '2099-01-01')).toBe(false);
    expect(planEnded(null, '2099-01-01')).toBe(false);
  });

  it('a maintenance block ends the morning after its horizon, no grace', () => {
    const m = generatePlan({ ...profile('2026-09-23', '2026-07-01'), raceType: 'maintenance', horizonWeeks: 12 });
    const mLast = iso(addDays(m.weeks[m.weeks.length - 1].start, 6));
    expect(planEnded(m, mLast)).toBe(false);
    expect(planEnded(m, iso(addDays(mLast, 1)))).toBe(true);
  });
});

describe('buildTrackerPlan (the no-plan sentinel)', () => {
  it('keeps the profile, fitness history and paces, drops the weeks and race date', () => {
    const plan = generatePlan(profile('2026-09-23', '2026-07-01'));
    plan.profile.fitnessHistory = [{ date: '2026-01-01', fivekSec: 1200 }];
    const t = buildTrackerPlan(plan, '2026-07-13T10:00:00.000Z');
    expect(t.race).toBe('tracker');
    expect(t.weeks).toEqual([]);
    expect(t.totalWeeks).toBe(0);
    expect(t.profile.raceDate).toBe(null);         // no stray countdown
    expect(t.profile.raceType).toBe('olympic');    // retained so the next plan and fitness math work
    expect(t.profile.fitnessHistory).toEqual(plan.profile.fitnessHistory); // trend preserved
    expect(t.paces).toBe(plan.paces);
    expect(t.createdAt).toBe(plan.createdAt);
    expect(t.updatedAt).toBe('2026-07-13T10:00:00.000Z');
  });

  it('a tracker fitness update snapshots history and refreshes paces without a plan', () => {
    const real = generatePlan({ ...profile('2026-09-23', '2026-07-01'), fivekSec: 1500 });
    const t = buildTrackerPlan(real, '2026-07-13T10:00:00.000Z');
    const up = applyTrackerFitness(t, { fivekSec: 1320 }, '2026-08-01T09:00:00.000Z');
    // still the sentinel: no plan appears from a fitness update
    expect(up.race).toBe('tracker');
    expect(up.weeks).toEqual([]);
    expect(up.createdAt).toBe(real.createdAt);
    expect(up.updatedAt).toBe('2026-08-01T09:00:00.000Z');
    // the OLD baseline lands in history, the new one is live
    const snap = up.profile.fitnessHistory[up.profile.fitnessHistory.length - 1];
    expect(snap.fivekSec).toBe(1500);
    expect(snap.date).toBe('2026-08-01');
    expect(up.profile.fivekSec).toBe(1320);
    // paces recompute so recap/review verdicts judge against the new numbers
    expect(up.paces.run.easy).toBeLessThan(t.paces.run.easy);
    // the update stamps its own marker; mere tracker ENTRY must not (the
    // Settings "Fitness updated" note gates on this, not on plan.updatedAt)
    expect(up.profile.fitnessUpdatedAt).toBe('2026-08-01T09:00:00.000Z');
    expect(t.profile.fitnessUpdatedAt).toBeUndefined();
  });

  it('the tracker race is real but never a generatable/selectable race', () => {
    expect(RACES.tracker).toBeTruthy();
    expect(RACES.tracker.noRace).toBe(true);   // excluded from race pickers (they filter !noRace)
    expect(RACES.tracker.tracker).toBe(true);
    expect(Object.values(RACES).filter(r => !r.noRace).some(r => r.key === 'tracker')).toBe(false);
  });
});

describe('workout library — Tranche 2 sizing (segments == durationMin)', () => {
  const mk = (f, rt, rd) => generatePlan({ name: 'T', raceType: rt, fitness: f, trainingDays: [1, 2, 3, 5, 6], longDay: 5, daysPerWeek: 5, raceDate: rd, startDate: '2026-09-01' });
  const sum = w => w.segments.reduce((a, s) => a + segMinutes(s), 0);

  it('every run and bike session sums to its durationMin, across levels and races', () => {
    const bad = [];
    ['beginner', 'intermediate', 'advanced', 'elite'].forEach(f =>
      [['sprint', '2027-01-15'], ['olympic', '2027-02-15'], ['half', '2027-03-01'], ['full', '2027-04-01']].forEach(([rt, rd]) =>
        mk(f, rt, rd).weeks.flatMap(w => w.workouts)
          .filter(w => (w.discipline === 'run' || w.discipline === 'bike') && !w.race && w.segments && w.segments.length)
          .forEach(w => { if (Math.abs(sum(w) - w.durationMin) > 1.01) bad.push(`${f}/${rt} ${w.discipline} ${w.type} ${w.durationMin}!=${sum(w)}`); })));
    expect(bad).toEqual([]);
  });

  it('a trim genuinely reduces the work: the rebuilt session sums to the smaller durationMin', () => {
    const p = mk('advanced', 'half', '2027-03-01');
    const q = p.weeks.flatMap(w => w.workouts).find(w => w.type === 'Threshold' && w.discipline === 'run' && w.durationMin >= 50);
    expect(q).toBeTruthy();
    const t = trimWorkout(q, p, 0.6);
    expect(t.durationMin).toBeLessThan(q.durationMin);
    expect(Math.abs(sum(t) - t.durationMin)).toBeLessThanOrEqual(1.01); // actually reduced, not floored back to ~full
  });

  it('the peak brick run-off-the-bike scales to race distance (D)', () => {
    // 7-day plans carry a brick session (5-day templates do not).
    const zoneOf = (rt, rd) => generatePlan({ name: 'T', raceType: rt, fitness: 'intermediate', trainingDays: [0, 1, 2, 3, 4, 5, 6], longDay: 5, daysPerWeek: 7, raceDate: rd, startDate: '2026-09-01' })
      .weeks.flatMap(w => w.workouts).filter(w => w.discipline === 'brick' && w.phase === 'Peak')
      .flatMap(w => w.segments).filter(s => /race pace/i.test(s.label || '')).map(s => s.zone);
    const sprint = zoneOf('sprint', '2027-01-15');
    expect(sprint.length).toBeGreaterThan(0);
    expect(sprint.every(z => z === 'Z4')).toBe(true);   // sprint race run is near threshold
    const full = zoneOf('full', '2027-06-01');
    expect(full.length).toBeGreaterThan(0);
    expect(full.every(z => z === 'Z2')).toBe(true);     // an Ironman race run is aerobic, not Z4
  });

  it('brick durations track LONG_BRICK per race distance, not a flat 60-min base', () => {
    // Same race date → same plan shape and load factors, so brick durations
    // across race types should differ only by the LONG_BRICK table
    // (sprint 70 / olympic 95 / full 165), not collapse to a shared 60-min base.
    const brickOf = rt => generatePlan({ name: 'T', raceType: rt, fitness: 'intermediate', trainingDays: [0, 1, 2, 3, 4, 5, 6], longDay: 5, daysPerWeek: 7, raceDate: '2027-06-01', startDate: '2026-09-01' })
      .weeks.flatMap(w => w.workouts).find(w => w.discipline === 'brick' && w.phase === 'Base' && !w.race);
    const sprint = brickOf('sprint'), oly = brickOf('olympic'), full = brickOf('full');
    expect(oly.type).toBe('Brick'); // not 'Long' — TSS factor and copy key off the type
    expect(oly.durationMin).toBeGreaterThan(60); // flat-60 base would land at/below 60 in Base
    expect(sprint.durationMin).toBeLessThan(oly.durationMin);
    expect(oly.durationMin).toBeLessThan(full.durationMin);
    expect(full.durationMin / oly.durationMin).toBeCloseTo(165 / 95, 1); // pure table ratio, same load
  });

  it('run distance uses the pace mix; swim distance is summed metres (F)', () => {
    const p = mk('advanced', 'olympic', '2027-02-15');
    const flat = p.weeks.flatMap(w => w.workouts);
    // a threshold run covers more ground than dur/easy-pace would give
    const thr = flat.find(w => w.type === 'Threshold' && w.discipline === 'run');
    if (thr) expect(thr.distance).toBeGreaterThan(+(thr.durationMin * 60 / p.paces.run.easy).toFixed(1));
    // a CSS swim's distance is its real ~600 m overhead + reps, not a flat 900
    const css = flat.find(w => w.type === 'CSS Intervals');
    if (css) expect(css.distance).toBeGreaterThan(0);
  });

  it('migration: a drifted run session is re-derived to sum, and it is idempotent', () => {
    const p = mk('intermediate', 'olympic', '2027-02-15');
    // hand-drift a run session (inflate its cool-down so it no longer sums)
    const drifted = JSON.parse(JSON.stringify(p));
    const w = drifted.weeks.flatMap(wk => wk.workouts).find(x => x.discipline === 'run' && x.segments.length > 1 && !x.race);
    w.segments[w.segments.length - 1].min += 12;
    const up = upgradePlanSegments(drifted);
    const w2 = up.weeks.flatMap(wk => wk.workouts).find(x => x.id === w.id);
    expect(Math.abs(w2.segments.reduce((a, s) => a + segMinutes(s), 0) - w2.durationMin)).toBeLessThanOrEqual(1.01);
    expect(upgradePlanSegments(up)).toBe(up); // idempotent: already sums → no-op
  });

  it('a trimmed Fartlek collapses cleanly, never a degenerate 2-min main', () => {
    const p = mk('intermediate', 'olympic', '2027-02-15');
    // Target the BY-FEEL variant (seed % 3 === 2) directly: its main is the
    // floored `Math.max(12, dur - 18)` line — a plan-found Fartlek lands on
    // seed 0 and would only ever exercise the v0 fallback path (the vacuity
    // the 2026-07-13 re-verify caught). The v2 main label ("Surges by feel")
    // is distinct from the fallback label ("Fartlek by feel").
    const fk2 = { id: 'fk2', discipline: 'run', type: 'Fartlek', durationMin: 50, phase: 'Build', seed: 2, week: 2, segments: [] };
    [0.5, 0.4].forEach(factor => { // dur 25 (floor binds: 12 vs old 7) and 20 (old gave a 2-min stub)
      const t = trimWorkout(fk2, p, factor);
      const feel = t.segments.find(s => /surges by feel/i.test(s.label || ''));
      expect(!feel || feel.min >= 12, 'factor ' + factor).toBe(true); // real block or clean fallback
      const sum = t.segments.reduce((a, s) => a + segMinutes(s), 0);
      expect(Math.abs(sum - t.durationMin), 'factor ' + factor).toBeLessThanOrEqual(1.01);
    });
  });

  it('migration repairs a stale peak brick race anchor (D), idempotently', () => {
    const full = generatePlan({ name: 'T', raceType: 'full', fitness: 'intermediate', trainingDays: [0, 1, 2, 3, 4, 5, 6], longDay: 5, daysPerWeek: 7, raceDate: '2027-06-01', startDate: '2026-09-01' });
    const stale = JSON.parse(JSON.stringify(full));
    let n = 0;
    stale.weeks.flatMap(w => w.workouts).filter(w => w.discipline === 'brick' && w.phase === 'Peak')
      .forEach(b => b.segments.forEach(s => { if (/race pace/i.test(s.label || '')) { s.zone = 'Z4'; n++; } })); // simulate a pre-fix cached plan
    expect(n).toBeGreaterThan(0);
    const up = upgradePlanSegments(stale);
    const zones = up.weeks.flatMap(w => w.workouts).filter(w => w.discipline === 'brick' && w.phase === 'Peak')
      .flatMap(w => w.segments).filter(s => /race pace/i.test(s.label || '')).map(s => s.zone);
    expect(zones.every(z => z === 'Z2')).toBe(true); // full → aerobic, not Z4
    expect(upgradePlanSegments(up)).toBe(up);        // idempotent
  });
});

describe('workout library — Tranche 1 audit fixes', () => {
  const forLevel = f => generatePlan({ ...profile('2026-09-23', '2026-07-01'), fitness: f });
  const allSegs = p => p.weeks.flatMap(w => w.workouts).flatMap(w => (w.segments || []).map(s => ({ ...s, w })));

  it('a beginner never gets a threshold "on tired legs" durability finish (E)', () => {
    const beg = forLevel('beginner');
    expect(allSegs(beg).some(s => /on tired legs/i.test(s.label || ''))).toBe(false);
    // intermediate keeps it available (gate is level-aware, not a blanket removal)
    const int = forLevel('intermediate');
    expect(allSegs(int).some(s => /on tired legs/i.test(s.label || ''))).toBe(true);
  });

  it('the bike over-under is delivered around threshold, never VO2/Z5 (B)', () => {
    // advanced bike quality in Build reaches the Threshold rung; a half plan has
    // enough Build weeks to land the over-under variant (seed % 3 === 1).
    const half = generatePlan({ ...profile('2027-03-01', '2026-09-01'), raceType: 'half', fitness: 'advanced' });
    const ous = allSegs(half).filter(s => /over-under/i.test(s.label || '') && s.blocks);
    expect(ous.length).toBeGreaterThan(0);
    ous.forEach(s => s.blocks.forEach(b => expect(['Z1', 'Z3', 'Z4']).toContain(b.zone)));
  });

  it('no builder yields a negative or zero-length segment at short durations (A-guard)', () => {
    const p = forLevel('intermediate');
    // trim EVERY Long (both disciplines, all seeds/variants) to the floor so the
    // offset variants — where the dur-15/dur-25/dur-32 clamps actually bite — are
    // exercised, not just the first Long's variant 0.
    const longs = p.weeks.flatMap(w => w.workouts).filter(w => w.type === 'Long');
    expect(longs.some(w => w.discipline === 'run')).toBe(true);
    longs.forEach(long => {
      const trimmed = trimWorkout(long, p, 0.1);
      trimmed.segments.forEach(s => { if (s.min != null) expect(s.min, long.discipline + ' ' + long.id + ' ' + s.label).toBeGreaterThan(0); });
    });
    // custom short Endurance bike (the dur-18 / dur-24 lead-ins the first cut missed)
    for (let wk = 0; wk < p.weeks.length; wk++) {
      const r = addCustomWorkout(p, { discipline: 'bike', type: 'Endurance', durationMin: 20, dateISO: p.weeks[wk].start });
      r.workout.segments.forEach(s => { if (s.min != null) expect(s.min, 'custom endurance wk ' + wk).toBeGreaterThan(0); });
    }
  });

  it('trimming a Long across the 45 min mark keeps its variant (rebuild-format invariant)', () => {
    const p = forLevel('intermediate');
    const long = p.weeks.flatMap(w => w.workouts)
      .find(w => w.type === 'Long' && w.discipline === 'run' && w.durationMin > 45 && (w.phase === 'Build' || w.phase === 'Peak'));
    expect(long).toBeTruthy();
    const trimmed = trimWorkout(long, p, 0.6); // 70 -> 42, crosses 45
    expect(trimmed.durationMin).toBeLessThan(45);
    // the durability menu no longer resizes on dur, so the same seed picks the
    // same variant: the segment labels (the variant's identity) are unchanged
    expect(trimmed.segments.map(s => s.label)).toEqual(long.segments.map(s => s.label));
  });

  it('interval "between sets" labels match the recovery the blocks encode (C)', () => {
    const segs = allSegs(forLevel('elite')).concat(allSegs(forLevel('advanced')));
    // the bike VO2 30/30 set-rest is 2 min; the label must say 2, not 4
    expect(segs.some(s => /30 s easy\) · 4 min between sets/.test(s.label || ''))).toBe(false);
    expect(segs.some(s => /30 s easy\) · 2 min between sets/.test(s.label || ''))).toBe(true);
  });

  it('interval labels match the recoveries their blocks actually encode (C)', () => {
    const segs = allSegs(forLevel('intermediate'));
    // the "sweet spot" long-ride label states its true 2.5 min recovery, not 5
    expect(segs.some(s => /sweet spot \/ 5 min easy/i.test(s.label || ''))).toBe(false);
    expect(segs.some(s => /sweet spot \/ 2\.5 min easy/i.test(s.label || ''))).toBe(true);
  });
});

describe('generatePlan', () => {
  it('produces weeks, paces and a clamped week count', () => {
    const p = generatePlan(profile('2026-09-23', '2026-07-01'));
    expect(Array.isArray(p.weeks)).toBe(true);
    expect(p.weeks.length).toBe(p.totalWeeks);
    expect(p.totalWeeks).toBeGreaterThanOrEqual(4);
    expect(p.totalWeeks).toBeLessThanOrEqual(40);
    expect(p.paces).toBeTruthy();
  });

  it('estimates bike watts from level × weight when the athlete has no FTP (regression: NaN ftp)', () => {
    // f633453 swept the bike-pass plan.js reads (lvl.estWkg) onto this branch
    // without the domain.js estWkg definition, so an estimated FTP came out NaN
    // and bikeWkg undefined — silently killing the whole estimate path.
    for (const fitness of ['beginner', 'intermediate', 'advanced', 'elite']) {
      const withWeight = generatePlan({ ...profile('2026-09-23', '2026-07-01'), fitness, weightKg: 70 });
      expect(Number.isNaN(withWeight.paces.ftp), `${fitness}: ftp is NaN`).toBe(false);
      expect(withWeight.paces.ftp, `${fitness}: estimated ftp`).toBeGreaterThan(0);
      expect(withWeight.paces.ftpEstimated, `${fitness}: flagged estimated`).toBe(true);
      expect(withWeight.paces.bikeWkg, `${fitness}: bikeWkg`).toBeGreaterThan(0);
    }
    // No weight → no honest W/kg scale → the estimate stays off (null, not NaN).
    const noWeight = generatePlan({ ...profile('2026-09-23', '2026-07-01'), weightKg: undefined });
    expect(noWeight.paces.ftp).toBe(null);
    expect(noWeight.paces.bikeWkg).toBe(null);
    // A real FTP always wins over the estimate.
    const real = generatePlan({ ...profile('2026-09-23', '2026-07-01'), weightKg: 70, ftp: 240 });
    expect(real.paces.ftp).toBe(240);
    expect(real.paces.ftpEstimated).toBe(false);
  });

  it('marks race day on the EXACT race date across every offset (regression: ceil week count)', () => {
    const start = '2026-07-01';
    for (let d = 28; d <= 200; d += 1) {
      const raceDate = iso(addDays(start, d));
      const p = generatePlan(profile(raceDate, start));
      if (p.totalWeeks >= 40) continue; // beyond the clamp the race is unreachable by design
      const raceDay = p.weeks.flatMap(w => w.workouts).find(w => w.race);
      expect(raceDay, `offset ${d} days`).toBeTruthy();
      expect(raceDay.date, `offset ${d} days`).toBe(raceDate);
    }
  });

  it('clamps very short and very long horizons (build + the appended recovery week)', () => {
    const short = generatePlan(profile(iso(addDays('2026-07-01', 10)), '2026-07-01'));
    expect(short.totalWeeks).toBe(5); // 4-week build floor + the post-race recovery week
    const long = generatePlan(profile(iso(addDays('2026-07-01', 500)), '2026-07-01'));
    expect(long.totalWeeks).toBe(52); // 51-build cap + recovery week keeps the 52 ceiling
  });

  it('lead-in long sessions hold at maintenance scale, not race scale', () => {
    const far = { ...profile(iso(addDays('2026-07-01', 45 * 7)), '2026-07-01'), raceType: 'full' }; // 45w for a 40w-max full
    const p = generatePlan(far);
    expect(p.leadIn).toBeGreaterThan(0);
    const leadLongs = p.weeks.slice(0, p.leadIn).flatMap(w => w.workouts).filter(w => w.type === 'Long' && w.discipline === 'bike');
    leadLongs.forEach(w => expect(w.durationMin, w.id).toBeLessThanOrEqual(100)); // maintenance long-bike scale
    const buildLongs = p.weeks.slice(p.leadIn + 4).flatMap(w => w.workouts).filter(w => w.type === 'Long' && w.discipline === 'bike' && !w.race);
    expect(Math.max(...buildLongs.map(w => w.durationMin))).toBeGreaterThan(150); // the build still reaches full scale
  });

  it('opens with a Maintain lead-in when the race is beyond the build window', () => {
    const p = generatePlan(profile(iso(addDays('2026-07-01', 30 * 7)), '2026-07-01')); // 30 weeks, olympic max 24
    expect(p.leadIn).toBe(p.totalWeeks - 1 - 24); // totalWeeks includes the appended recovery week
    p.weeks.slice(0, p.leadIn).forEach(w => expect(w.phase).toBe('Maintain'));
    expect(p.weeks[p.leadIn].phase).toBe('Base'); // the build starts after
    const raceDay = p.weeks.flatMap(w => w.workouts).find(w => w.race);
    expect(raceDay).toBeTruthy(); // race day reachable even beyond the window
  });

  it('flags a short runway instead of blocking', () => {
    const p = generatePlan({ ...profile(iso(addDays('2026-07-01', 6 * 7)), '2026-07-01'), raceType: 'half' }); // 6 weeks for a 12-min half
    expect(p.shortRunway).toBe(true);
    expect(p.weeks.flatMap(w => w.workouts).some(w => w.race)).toBe(true);
  });

  it('generates a t100 plan with its race-day distances', () => {
    const p = generatePlan({ ...profile('2026-10-14', '2026-07-01'), raceType: 't100' });
    const raceDay = p.weeks.flatMap(w => w.workouts).find(w => w.race);
    expect(raceDay.segments.map(s => s.label).join(' ')).toContain('80');
    expect(p.shortRunway).toBe(undefined);
  });

  it('builds a maintenance block: all Maintain, no race day, recovery cadence, tests included', () => {
    const p = generatePlan({ ...profile('2026-09-23', '2026-07-01'), raceType: 'maintenance', horizonWeeks: 12, postRace: true });
    expect(p.totalWeeks).toBe(12);
    p.weeks.forEach(w => expect(w.phase).toBe('Maintain'));
    expect(p.weeks[0].isRecovery).toBe(true); // post-race conversion starts easy
    expect(p.weeks.flatMap(w => w.workouts).some(w => w.race)).toBe(false);
    expect(p.weeks.flatMap(w => w.workouts).some(w => w.test)).toBe(true);
    expect(p.weeks.some(w => w.isRecovery && w.index > 0)).toBe(true);
  });
});

describe('easeWorkout', () => {
  it('downgrades a run to easy aerobic at reduced volume', () => {
    const p = generatePlan(profile('2026-09-23', '2026-07-01'));
    const run = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'run' && w.durationMin > 0);
    const eased = easeWorkout(run, p);
    expect(eased.eased).toBe(true);
    expect(eased.type).toBe('Easy');
    expect(eased.durationMin).toBeLessThanOrEqual(run.durationMin);
    expect(eased.easedFrom).toBe(run.type);
  });

  it('leaves non-swim/bike/run sessions untouched', () => {
    const p = generatePlan(profile('2026-09-23', '2026-07-01'));
    const strength = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'strength');
    if (strength) expect(easeWorkout(strength, p)).toBe(strength);
  });
});

describe('trimWorkout (ramp guardrail)', () => {
  const p = generatePlan(profile('2026-09-23', '2026-07-01'));
  const run = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'run' && w.durationMin >= 40);

  it('reduces volume but keeps the session type and key flag', () => {
    const t = trimWorkout(run, p, 0.8);
    expect(t.trimmed).toBe(true);
    expect(t.trimmedFrom).toBe(run.durationMin);
    expect(t.durationMin).toBeLessThan(run.durationMin);
    expect(t.type).toBe(run.type);
    expect(t.key).toBe(run.key);
  });

  it('never lengthens: at the 20-minute floor the session comes back unchanged', () => {
    const short = { ...run, durationMin: 20 };
    expect(trimWorkout(short, p, 0.9)).toBe(short);
  });

  it('leaves non-swim/bike/run sessions untouched', () => {
    const strength = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'strength');
    if (strength) expect(trimWorkout(strength, p, 0.8)).toBe(strength);
  });
});

describe('boostWorkout (build nudge)', () => {
  const p = generatePlan(profile('2026-09-23', '2026-07-01'));
  const run = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'run' && w.durationMin >= 40);

  it('grows volume but keeps the session type', () => {
    const b = boostWorkout(run, p, 1.1);
    expect(b.boosted).toBe(true);
    expect(b.boostedFrom).toBe(run.durationMin);
    expect(b.durationMin).toBeGreaterThan(run.durationMin);
    expect(b.type).toBe(run.type);
  });

  it('never shrinks: a factor that rounds back down returns the session unchanged', () => {
    expect(boostWorkout(run, p, 1.0)).toBe(run);
  });

  it('leaves non-swim/bike/run sessions untouched', () => {
    const strength = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'strength');
    if (strength) expect(boostWorkout(strength, p, 1.1)).toBe(strength);
  });
});

describe('workout library variants', () => {
  const p = generatePlan(profile('2026-09-23', '2026-07-01'));

  it('is deterministic: the same profile always generates the identical plan', () => {
    const p2 = generatePlan(profile('2026-09-23', '2026-07-01'));
    const labels = pl => pl.weeks.flatMap(w => w.workouts).map(w => w.segments.map(x => x.label).join('|')).join('~');
    expect(labels(p2)).toBe(labels(p));
  });

  it('rotates session formats across weeks', () => {
    const longRuns = p.weeks.flatMap(w => w.workouts).filter(w => w.discipline === 'run' && w.type === 'Long');
    const shapes = new Set(longRuns.map(w => w.segments.length));
    expect(shapes.size).toBeGreaterThan(1); // steady weeks alternate with fast-finish weeks
  });

  it('selects the format from the week seed, wrapping deterministically', () => {
    const wk = seed => ({ discipline: 'run', type: 'Threshold', durationMin: 60, week: seed, phase: 'Build', id: seed + '-1' });
    const main = w => trimWorkout(w, p, 0.9).segments[1].label;
    expect(main(wk(0))).toContain('9 min threshold');
    expect(main(wk(1))).toContain('5 min threshold');
    expect(main(wk(2))).toContain('12 min cruise');
    expect(main(wk(3))).toContain('9 min threshold'); // wraps around
  });

  it('engine rebuilds keep the session in its week format', () => {
    const runs = p.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline === 'run' && w.durationMin >= 40 && !w.race && !w.test);
    const shape = w => w.segments.map(x => x.label.replace(/\d+/g, 'N')).join('|');
    runs.forEach(run => {
      expect(shape(trimWorkout(run, p, 0.8)), run.id).toBe(shape(run));
      expect(shape(boostWorkout(run, p, 1.15)), run.id).toBe(shape(run));
    });
  });
});

describe('intensity ladders (widened)', () => {
  const forFitness = fitness => generatePlan({ ...profile('2026-09-23', '2026-07-01'), fitness });
  const quality = (p, disc) => p.weeks.filter(w => !w.isRecovery).flatMap(w => w.workouts)
    .filter(x => x.discipline === disc && x.role === 'quality' && !x.test);

  it('keeps the intermediate arc unchanged: Base easy end, Build mid, Peak race-specific', () => {
    const p = forFitness('intermediate');
    const runs = quality(p, 'run');
    expect(runs.filter(x => x.phase === 'Base').every(x => x.type === 'Easy')).toBe(true);
    expect(runs.filter(x => x.phase === 'Build').every(x => x.type === 'Tempo')).toBe(true);
    expect(runs.filter(x => x.phase === 'Peak').every(x => x.type === 'Threshold')).toBe(true);
  });

  it('gives beginners structured play in Build instead of a jump to hard reps', () => {
    const p = forFitness('beginner');
    const buildRuns = quality(p, 'run').filter(x => x.phase === 'Build');
    expect(buildRuns.length).toBeGreaterThan(0);
    expect(buildRuns.every(x => x.type === 'Fartlek')).toBe(true);
    const buildBikes = quality(p, 'bike').filter(x => x.phase === 'Build');
    expect(buildBikes.every(x => x.type === 'Tempo')).toBe(true);
  });

  it('lets elites top out at VO2 on the bike', () => {
    const p = forFitness('elite');
    expect(new Set(quality(p, 'bike').map(x => x.type)).has('VO2 Intervals')).toBe(true);
  });
});

describe('brick variants', () => {
  const p = generatePlan({ ...profile('2026-09-23', '2026-07-01'), daysPerWeek: 4, trainingDays: [1, 3, 5, 6] });
  const bricks = p.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'brick' && !x.race);

  it('rotates brick formats across weeks', () => {
    expect(bricks.length).toBeGreaterThan(2);
    const shapes = new Set(bricks.map(x => x.segments.map(s => s.label.replace(/\d+/g, 'N')).join('|')));
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('pins recovery-week bricks to the canonical single-transition shape', () => {
    const rec = p.weeks.find(w => w.isRecovery);
    const recBrick = rec && rec.workouts.find(x => x.discipline === 'brick' && !x.race);
    if (recBrick) expect(recBrick.segments.some(s => s.label.includes('Round'))).toBe(false);
  });
});

describe('durability long sessions', () => {
  const p = generatePlan(profile('2026-09-23', '2026-07-01'));
  const longs = disc => p.weeks.flatMap(w => w.workouts).filter(x => x.discipline === disc && x.type === 'Long');
  const hasIntervals = x => x.segments.some(s => s.label.includes('on tired legs'));

  it('finishes some Build/Peak long sessions with intervals', () => {
    expect(longs('run').filter(x => (x.phase === 'Build' || x.phase === 'Peak') && hasIntervals(x)).length).toBeGreaterThan(0);
    expect(longs('bike').filter(x => (x.phase === 'Build' || x.phase === 'Peak') && hasIntervals(x)).length).toBeGreaterThan(0);
  });

  it('never puts interval finishes in Base, Taper or recovery weeks', () => {
    const recWeeks = new Set(p.weeks.filter(w => w.isRecovery).map(w => w.index));
    const offLimits = [...longs('run'), ...longs('bike')]
      .filter(x => x.phase === 'Base' || x.phase === 'Taper' || recWeeks.has(x.week));
    expect(offLimits.length).toBeGreaterThan(0);
    expect(offLimits.some(hasIntervals)).toBe(false);
  });
});

describe('custom workouts (user-added sessions)', () => {
  const p = generatePlan(profile('2026-09-23', '2026-07-01'));
  const someDate = p.weeks[1].start; // a Monday inside the plan

  it('builds from the library, flags custom and lands in the owning week', () => {
    const { plan: np, workout } = addCustomWorkout(p, { discipline: 'run', type: 'Tempo', durationMin: 40, dateISO: someDate });
    expect(workout.custom).toBe(true);
    expect(workout.week).toBe(1);
    expect(workout.title).toBe('Tempo Run');
    expect(workout.durationMin).toBe(40);
    expect(workout.segments.length).toBeGreaterThan(0);
    expect(np.weeks[1].workouts).toContain(workout);
    expect(np.weeks[1].totalMin).toBe(p.weeks[1].totalMin + 40);
    expect(p.weeks[1].workouts).not.toContain(workout); // original untouched
  });

  it('never reuses an id, even after a remove', () => {
    const a = addCustomWorkout(p, { discipline: 'bike', type: 'Endurance', durationMin: 60, dateISO: someDate });
    const b = addCustomWorkout(a.plan, { discipline: 'swim', type: 'Technique', durationMin: 30, dateISO: someDate });
    expect(b.workout.id).not.toBe(a.workout.id);
    const removed = removeCustomWorkout(b.plan, a.workout.id);
    const c = addCustomWorkout(removed, { discipline: 'run', type: 'Easy', durationMin: 30, dateISO: someDate });
    expect(c.workout.id).not.toBe(b.workout.id);
  });

  it('remove takes out only custom sessions and restores the weekly total', () => {
    const { plan: np, workout } = addCustomWorkout(p, { discipline: 'run', type: 'Easy', durationMin: 30, dateISO: someDate });
    const back = removeCustomWorkout(np, workout.id);
    expect(back.weeks[1].workouts.find(x => x.id === workout.id)).toBe(undefined);
    expect(back.weeks[1].totalMin).toBe(p.weeks[1].totalMin);
    const planned = p.weeks[1].workouts.find(x => x.discipline !== 'rest');
    expect(removeCustomWorkout(p, planned.id).weeks[1].workouts.length).toBe(p.weeks[1].workouts.length);
  });

  it('strength fixes its own duration', () => {
    const { workout } = addCustomWorkout(p, { discipline: 'strength', type: 'Strength', durationMin: 90, dateISO: someDate });
    expect(workout.durationMin).toBeLessThan(90);
  });
});

describe('upgradePlanSegments (schema migration for cached plans)', () => {
  const p = generatePlan(profile('2026-09-23', '2026-07-01'));
  // simulate cached plans from two past eras: post-variant/pre-profile keeps
  // its seed and just lacks zone/blocks; pre-variant lacks the seed too.
  const strip = (pl, dropSeed) => ({ ...pl, weeks: pl.weeks.map(w => ({ ...w, workouts: w.workouts.map(x => ({
    ...x, seed: dropSeed ? undefined : x.seed,
    segments: x.segments.map(({ zone, blocks, ...rest }) => rest),
  })) })) });

  it('restores profile data without changing any session shape (seeded plans)', () => {
    const old = strip(p, false);
    const up = upgradePlanSegments(old);
    const shape = pl => pl.weeks.flatMap(w => w.workouts).map(x => x.id + '|' + x.title + '|' + x.durationMin + '|' + x.segments.map(s => s.label).join(';')).join('~');
    expect(shape(up)).toBe(shape(old)); // identical labels and durations
    const runs = up.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'run' && !x.race && !x.test && x.durationMin);
    expect(runs.length).toBeGreaterThan(0);
    runs.forEach(x => expect(x.segments.some(s => s.zone || s.blocks), x.id).toBe(true));
  });

  it('pins pre-variant plans (no seed) to the canonical format their sessions had', () => {
    const up = upgradePlanSegments(strip(p, true));
    const thresholds = up.weeks.flatMap(w => w.workouts).filter(x => x.type === 'Threshold' && x.discipline === 'run' && !x.test);
    // Structured thresholds pin to canonical v0 (9-min reps); a very short one
    // (a tapered session) degrades to a single continuous block, which is fine.
    thresholds.filter(x => x.segments.length > 1)
      .forEach(x => expect(x.segments[1].label, x.id).toContain('9 min threshold'));
    expect(thresholds.some(x => x.segments.length > 1)).toBe(true);
  });

  it('leaves race day, tests and current plans alone', () => {
    const old = strip(p, false);
    const up = upgradePlanSegments(old);
    const pick = (pl, f) => pl.weeks.flatMap(w => w.workouts).find(f);
    expect(pick(up, x => x.race)).toBe(pick(old, x => x.race));
    expect(pick(up, x => x.test)).toBe(pick(old, x => x.test));
    expect(upgradePlanSegments(p)).toBe(p); // already current → same reference
    expect(upgradePlanSegments(null)).toBe(null);
  });
});

describe('generatePlan — tune-up (B) races', () => {
  // Base profile: Olympic on 2026-09-23, weeks run Monday 2026-06-29 onward,
  // training days Mon/Tue/Thu/Sat/Sun. The tune-up lands on Saturday 2026-07-25.
  const B_DATE = '2026-07-25';
  const withB = kind => generatePlan({ ...profile('2026-09-23', '2026-07-01'), bRaces: [{ kind, date: B_DATE }] });
  const flat = p => p.weeks.flatMap(w => w.workouts);
  const at = (p, d) => flat(p).filter(x => x.date === d);

  it('drops the race onto its day, replacing the planned session, and keeps the id', () => {
    const base = generatePlan(profile('2026-09-23', '2026-07-01'));
    const p = withB('sprint');
    const day = at(p, B_DATE);
    expect(day.length).toBe(1); // any strength double is dropped — racing is the session
    const b = day[0];
    expect(b.bRace).toBe(true);
    expect(b.type).toBe('RACE');
    expect(b.title).toMatch(/TUNE-UP — Sprint Triathlon/);
    expect(b.discipline).toBe('brick');
    expect(b.key).toBe(true);
    expect(b.id).toBe(at(base, B_DATE)[0].id); // stable id → logs/moves survive reshape
    expect(b.segments.length).toBe(3); // swim/bike/run legs for a tri tune-up
    // the goal race is untouched
    expect(flat(p).filter(x => x.race).length).toBe(1);
    // week totals reflect the replacement
    const wk = p.weeks.find(w => w.workouts.some(x => x.date === B_DATE));
    expect(wk.totalMin).toBe(wk.workouts.reduce((a, x) => a + (x.durationMin || 0), 0));
  });

  it('eases the two days before and the day after (mini-taper in, recovery out)', () => {
    const base = generatePlan(profile('2026-09-23', '2026-07-01'));
    const p = withB('run10k');
    ['2026-07-23', '2026-07-26'].forEach(d => { // trained Thu before, Sun after
      const eased = at(p, d).filter(x => x.discipline !== 'rest' && x.discipline !== 'strength' && !x.test);
      const orig = at(base, d).filter(x => x.discipline !== 'rest' && x.discipline !== 'strength' && !x.test);
      eased.forEach((x, i) => expect(x.durationMin, d).toBeLessThan(orig[i].durationMin));
    });
    // a run race day carries warm-up / race / cool-down guidance
    expect(at(p, B_DATE)[0].segments[1].label).toMatch(/race it/i);
  });

  it('protects the goal-race taper and the plan bounds: invalid tune-ups are ignored', () => {
    const taper = generatePlan({ ...profile('2026-09-23', '2026-07-01'), bRaces: [{ kind: 'sprint', date: '2026-09-18' }] }); // 5 days out
    expect(flat(taper).some(x => x.bRace)).toBe(false);
    const outside = generatePlan({ ...profile('2026-09-23', '2026-07-01'), bRaces: [{ kind: 'sprint', date: '2026-11-01' }] });
    expect(flat(outside).some(x => x.bRace)).toBe(false);
    const junk = generatePlan({ ...profile('2026-09-23', '2026-07-01'), bRaces: [{ kind: 'marathon', date: B_DATE }, null] });
    expect(flat(junk).some(x => x.bRace)).toBe(false);
  });

  it('a tune-up on a rest day just becomes the race day', () => {
    const p = generatePlan({ ...profile('2026-09-23', '2026-07-01'), bRaces: [{ kind: 'run5k', date: '2026-07-24' }] }); // Friday, untrained
    const day = at(p, '2026-07-24');
    expect(day.length).toBe(1);
    expect(day[0].bRace).toBe(true);
    expect(day[0].discipline).toBe('run');
  });
});

describe('generatePlan — weekly load reads test weeks honestly (the week-6 report)', () => {
  const realSess = w => w.workouts.filter(x => x.discipline !== 'rest' && !x.race);
  const weekMins = w => realSess(w).reduce((s, x) => s + x.durationMin, 0);
  const weekLoad = w => realSess(w).reduce((s, x) => s + estimateTss(x), 0);

  it('a non-recovery benchmark-test week can have fewer minutes than the week before yet more load', () => {
    // A benchmark test is short but taxing; it replaces a longer endurance/quality
    // session, so raw minutes dipped even though the week is harder. This is exactly
    // why the progress chart plots training load, not time.
    const p = generatePlan({
      name: 'J', raceType: 'olympic', fitness: 'advanced',
      trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
      startDate: '2026-07-06', raceDate: iso(addDays('2026-07-06', 77)),
    });
    // The reported case: a non-recovery test week whose previous (also non-recovery)
    // week has at least as many minutes — the minutes look like a step back.
    const i = p.weeks.findIndex((w, k) => k > 0 && !w.isRecovery && !p.weeks[k - 1].isRecovery
      && w.workouts.some(x => x.test) && weekMins(w) <= weekMins(p.weeks[k - 1]));
    expect(i).toBeGreaterThan(0);
    expect(weekLoad(p.weeks[i])).toBeGreaterThan(weekLoad(p.weeks[i - 1])); // load tells the truth
  });
});


describe('injured state (profile.excludedDiscipline)', () => {
  const base = { name: 'J', fitness: 'intermediate', trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5,
    daysPerWeek: 6, startDate: '2026-07-13' };
  const race = { ...base, raceType: 'olympic', raceDate: '2026-09-20' };
  const maint = { ...base, raceType: 'maintenance', raceDate: '2026-10-04', horizonWeeks: 12 };
  const all = p => p.weeks.flatMap(w => w.workouts).filter(w => w.discipline !== 'rest');

  it('no-run plans contain zero run sessions and zero bricks, race day untouched', () => {
    const p = generatePlan({ ...race, excludedDiscipline: 'run' });
    const sessions = all(p).filter(w => !w.race);
    expect(sessions.some(w => w.discipline === 'run' || w.discipline === 'brick')).toBe(false);
    expect(sessions.length).toBeGreaterThan(0);
    // race day is the real race, independent of what was trained
    expect(all(p).some(w => w.race)).toBe(true);
  });

  it('no-swim plans contain zero swim sessions; bricks keep both their legs', () => {
    // 7 training days: the brick slot only exists at 4 and 7 days, exactly
    // as in the classic templates
    const p = generatePlan({ ...race, excludedDiscipline: 'swim', trainingDays: [0, 1, 2, 3, 4, 5, 6], daysPerWeek: 7 });
    const sessions = all(p).filter(w => !w.race);
    expect(sessions.some(w => w.discipline === 'swim')).toBe(false);
    expect(sessions.some(w => w.discipline === 'brick')).toBe(true);
  });

  it('swim and bike top out at five sessions a week: surplus days stay free', () => {
    const p = generatePlan({ ...maint, excludedDiscipline: 'run', trainingDays: [0, 1, 2, 3, 4, 5, 6], daysPerWeek: 7 });
    p.weeks.forEach(wk => {
      const real = wk.workouts.filter(w => w.discipline !== 'rest' && !w.race && !w.test);
      expect(real.length).toBeLessThanOrEqual(5);
    });
  });

  it('every generated session has positive, sane segments (the bike easy slot maps to Endurance, never a Threshold fallback)', () => {
    ['run', 'swim'].forEach(ex => {
      const p = generatePlan({ ...maint, excludedDiscipline: ex });
      all(p).filter(w => !w.race && !w.test).forEach(w => {
        expect(w.durationMin).toBeGreaterThan(0);
        expect(Array.isArray(w.segments) && w.segments.length > 0).toBe(true);
      });
      // no bike session may carry the Threshold-fallback title from an
      // unmapped 'Easy' type (the recovery-week lesson)
      const bikes = all(p).filter(w => w.discipline === 'bike' && !w.test);
      bikes.forEach(w => expect(w.type).not.toBe('Easy'));
    });
  });

  it('benchmark tests skip the excluded discipline', () => {
    const noRun = generatePlan({ ...race, excludedDiscipline: 'run' });
    const tests = all(noRun).filter(w => w.test);
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.some(w => w.discipline === 'run')).toBe(false);
    const noSwim = generatePlan({ ...race, excludedDiscipline: 'swim' });
    expect(all(noSwim).filter(w => w.test).some(w => w.discipline === 'swim')).toBe(false);
  });

  it('an unrecognised exclusion fails safe to the full template', () => {
    const p = generatePlan({ ...maint, excludedDiscipline: 'bike' });
    expect(all(p).some(w => w.discipline === 'bike')).toBe(true); // fallback, not a crash
  });

  it('no week schedules the same discipline and role twice (seed-identical duplicate hazard)', () => {
    ['run', 'swim'].forEach(ex => {
      const p = generatePlan({ ...maint, excludedDiscipline: ex, trainingDays: [0, 1, 2, 3, 4, 5, 6], daysPerWeek: 7 });
      p.weeks.forEach(wk => {
        const real = wk.workouts.filter(w => w.discipline !== 'rest' && !w.race && !w.test);
        // the hazard is BYTE-IDENTICAL sessions: same discipline, same type,
        // same duration (recovery weeks collapse easy/quality to one gentle
        // type, which is fine as long as the sessions still differ)
        const keys = real.map(w => w.discipline + ':' + w.type + ':' + w.durationMin);
        expect(new Set(keys).size).toBe(keys.length);
      });
    });
  });
});


describe('gauntlet regressions: recovery-week and Peak duplication', () => {
  const race = { name: 'J', raceType: 'olympic', fitness: 'intermediate',
    trainingDays: [0, 1, 2, 3, 4, 5, 6], longDay: 5, daysPerWeek: 7,
    startDate: '2026-07-13', raceDate: '2026-09-20' };

  it('the post-race recovery week holds at most one session per discipline, all distinct', () => {
    [undefined, 'run', 'swim'].forEach(ex => {
      const p = generatePlan({ ...race, excludedDiscipline: ex });
      const last = p.weeks[p.weeks.length - 1];
      expect(last.isRecovery).toBe(true);
      const real = last.workouts.filter(w => w.discipline !== 'rest' && !w.race);
      const discs = real.map(w => w.discipline);
      expect(new Set(discs).size).toBe(discs.length);
      const keys = real.map(w => w.discipline + ':' + w.type + ':' + w.durationMin);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  it('Peak weeks with two swims differentiate: quality goes Open Water, easy keeps Technique', () => {
    const p = generatePlan({ ...race, excludedDiscipline: 'run' });
    const peak = p.weeks.filter(w => w.phase === 'Peak' && !w.isRecovery);
    expect(peak.length).toBeGreaterThan(0);
    peak.forEach(wk => {
      const swims = wk.workouts.filter(w => w.discipline === 'swim' && !w.test && !w.race);
      if (swims.length >= 2) {
        const types = new Set(swims.map(w => w.type));
        expect(types.size).toBeGreaterThan(1); // never two identical Open Water sessions
        expect([...types]).toContain('Open Water'); // race-specific work survives
      }
    });
  });
});
