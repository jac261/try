import { describe, it, expect } from 'vitest';
import { generatePlan } from './plan.js';
import { tuneFields } from './tuning.js';
import { runAnchor, hasReal5k, FITNESS, RACES, RUN_5K_SOURCES } from './domain.js';
import { predictRaceTimes } from './runstats.js';
import { runBenchmark, runBenchmarkHistory } from './run-benchmark.js';

/* Run phase 5 — experience-level calibration.
 *
 * The runner-level anchors themselves were already shipped and merged; §2's
 * "review the open pull request" describes work that is done. What was NOT
 * done is §3's separation rule, and it was broken in three places at once by
 * a single path: tuneFields.
 *
 * A feel-based nudge writes a fivekSec DERIVED FROM THE LEVEL TABLE when the
 * athlete has no real 5 km. Nothing marked it, so downstream every consumer
 * read a guess as a performance: race projections fired, the number entered
 * benchmark history, the marathon long run quoted an exact race pace, and
 * Settings labelled it as measured. Four of §3's five prohibitions and three
 * of §5's six criteria, from one unstamped write.
 */

const LEVELS = ['beginner', 'intermediate', 'advanced', 'elite'];
const SOLO = ['run5k', 'run10k', 'runhalf', 'runmarathon'];
const TRI = ['sprint', 'olympic', 'half', 't100', 'full'];
const base = {
  name: 'R', daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 5,
  startDate: '2026-06-01', raceDate: '2026-10-03',
};
const nudge = profile => ({ ...profile, ...tuneFields(profile, [{ discipline: 'run', direction: 'faster' }]) });

describe('the four runner anchors', () => {
  it('are 36:00 / 28:00 / 22:00 / 17:30, and differ from the triathlete table', () => {
    expect(LEVELS.map(l => FITNESS[l].runEst5k)).toEqual([2160, 1680, 1320, 1050]);
    // Runners are slower than triathletes at the bottom and faster at the top:
    // a beginner runner is genuinely new to running, while a beginner
    // triathlete may already run well.
    expect(FITNESS.beginner.runEst5k).toBeGreaterThan(FITNESS.beginner.est5k);
    expect(FITNESS.elite.runEst5k).toBeLessThan(FITNESS.elite.est5k);
    // and both tables are monotonic
    [ 'runEst5k', 'est5k' ].forEach(k => {
      const v = LEVELS.map(l => FITNESS[l][k]);
      expect(v, k + ' is not monotonically faster').toEqual([...v].sort((a, b) => b - a));
    });
  });

  it('every solo-run entry path uses runEst5k and every triathlon path est5k', () => {
    // §2's two confirmations, at all four levels and every race type.
    for (const fit of LEVELS) {
      for (const rt of [...SOLO, ...TRI, 'maintenance', undefined]) {
        const solo = (RACES[rt] || {}).solo === 'run';
        const want = solo ? FITNESS[fit].runEst5k : FITNESS[fit].est5k;
        const profile = { ...base, fitness: fit, raceType: rt };
        expect(runAnchor(profile).timeSec, String(rt) + '/' + fit).toBe(want);
        // The PLAN's paces must agree with the anchor, or the card and the
        // projection are built off different numbers. Read from a generated
        // plan rather than a private helper: that is the surface the app uses.
        if (RACES[rt]) {
          expect(generatePlan(profile).paces.run.fivekPace * 5, String(rt) + '/' + fit + ' paces').toBeCloseTo(want, 0);
        }
      }
    }
  });

  it('all four levels build a whole plan on the estimate alone', () => {
    for (const fit of LEVELS) {
      for (const rt of SOLO) {
        const p = generatePlan({ ...base, fitness: fit, raceType: rt });
        expect(p.weeks.length, rt + '/' + fit).toBeGreaterThan(0);
        expect(p.paces.runEstimated).toBe(true);
      }
    }
  });
});

describe('an estimate may size training, and may not become evidence', () => {
  const blank = { ...base, fitness: 'intermediate', raceType: 'runhalf' };

  it('a feel-based nudge keeps sizing the plan but is stamped as an estimate', () => {
    const f = tuneFields(blank, [{ discipline: 'run', direction: 'faster' }]);
    // §3 "may support plan sizing": the number still lands on the profile and
    // still drives the paces, two per cent faster than the level table.
    expect(f.fivekSec).toBeLessThan(FITNESS.intermediate.runEst5k);
    expect(f.fivekSec).toBeGreaterThan(FITNESS.intermediate.runEst5k * 0.95);
    // and it says what it is
    expect(f.fivekMeta).toEqual({ source: 'estimated', measuredAt: expect.any(String), confidence: 'low' });
    expect(RUN_5K_SOURCES).toContain('estimated');
    expect(generatePlan({ ...blank, ...f }).paces.run.fivekPace * 5).toBeCloseTo(f.fivekSec, 0);
  });

  it('a nudged estimate is not a real anchor', () => {
    const after = nudge(blank);
    expect(after.fivekSec).toBeTruthy();          // the number IS stored
    expect(runAnchor(after).kind).toBe('estimated'); // and is still an estimate
    expect(hasReal5k(after)).toBe(false);
  });

  it('cannot power race projections', () => {
    // §3 and §5. Before the stamp, one nudge on a blank-5k plan produced a
    // marathon prediction of 4h23 to 5h19 from a time never run.
    expect(predictRaceTimes(blank)).toBe(null);
    expect(predictRaceTimes(nudge(blank))).toBe(null);
    // a real 5 km still projects, or the guard has simply broken the feature
    expect(predictRaceTimes({ ...blank, fivekSec: 1500 })).toBeTruthy();
  });

  it('cannot enter benchmark history', () => {
    const after = nudge(blank);
    expect(runBenchmark(after)).toBe(null);
    expect(runBenchmarkHistory(after)).toEqual([]);
    // nor through the history list itself
    expect(runBenchmarkHistory({
      ...after,
      fitnessHistory: [{ date: '2026-06-01', fivekSec: 1700, fivekMeta: { source: 'estimated' } }],
    }).filter(h => h.source === 'estimated').length).toBe(1);
  });

  it('cannot make the long run quote an exact race pace', () => {
    // §3 "must not support exact race-pace Long Run quoting". The gate used to
    // read !profile.fivekSec, which a nudge flips.
    const quoted = profile => generatePlan({ ...profile, raceType: 'runmarathon' })
      .weeks.flatMap(w => w.workouts)
      .filter(x => x.discipline === 'run' && x.type === 'Long')
      .flatMap(x => x.segments || [])
      .filter(s => /marathon effort/i.test(s.label || '') && /~\d/.test(s.detail || '')).length;
    expect(quoted(blank)).toBe(0);
    expect(quoted(nudge(blank))).toBe(0);
    expect(quoted({ ...blank, fivekSec: 1500 })).toBeGreaterThan(0);
  });

  it('a real benchmark that is then nudged stops claiming to be measured', () => {
    /* The swim settled this when its own fifth write point was found: a
       tuned number is no longer whatever was tested, so the provenance must
       stop saying so. The measured value is not lost, it is snapshotted into
       fitnessHistory by the retarget that applies these fields. */
    const real = { ...blank, fivekSec: 1500, fivekMeta: { source: 'try-test', confidence: 'high' } };
    expect(runAnchor(real).kind).toBe('real');
    const after = nudge(real);
    expect(after.fivekMeta.source).toBe('estimated');
    expect(runAnchor(after).kind).toBe('estimated');
    expect(predictRaceTimes(after)).toBe(null);
  });
});

describe('estimates are labelled wherever they are shown', () => {
  it('Settings reads the anchor rather than the raw field', async () => {
    // §5 "estimated values are always labelled". Asserting the SOURCE,
    // because a nudged estimate renders a perfectly plausible pace and a
    // value test cannot tell a labelled one from an unlabelled one.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../features/settings/SettingsView.jsx', import.meta.url), 'utf8');
    const stat = src.slice(src.indexOf('5k pace') - 700, src.indexOf('5k pace') + 200);
    expect(stat).toContain('runAnchor');
    expect(stat).toMatch(/5k pace · est/);
    // the old test was `p.fivekSec ? measured : estimated`, which a nudge
    // silently flipped to the measured branch
    expect(stat).not.toMatch(/p\.fivekSec \? '5k pace\/km'/);
  });

  it('an estimated plan marks its paces and distances as estimates', () => {
    for (const fit of LEVELS) {
      const p = generatePlan({ ...base, fitness: fit, raceType: 'runhalf' });
      expect(p.paces.runEstimated).toBe(true);
      const anyRun = p.weeks.flatMap(w => w.workouts).find(x => x.discipline === 'run' && !x.race);
      expect(anyRun.distEst).toBe(true);
    }
    const real = generatePlan({ ...base, fitness: 'intermediate', raceType: 'runhalf', fivekSec: 1500 });
    expect(real.paces.runEstimated).toBe(false);
  });
});
