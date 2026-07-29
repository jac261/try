import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { predictRaceTimes, RIEGEL_EXP, RIEGEL_MARATHON_HI } from './runstats.js';
import { runAnchor, RUN_5K_SOURCES, FTP_CONFIDENCE } from './domain.js';
import { eftpProposal } from './eftp.js';
import {
  RUN_5K_RULES, runBenchmark, runBenchmarkHistory, run5kTestActivityFor,
  fivekFromTestIntervals, fivekTestIssues, runProposalDetails,
} from './run-benchmark.js';

/* Run phase 2 — the performance anchor and race projections.
 *
 * The phase exists because run5k is a first-class test kind, scheduled on the
 * same rotation as bikeFtp and swimCss, that had no provenance anywhere: the
 * fitness editor branched on 'swimCss' and 'bikeFtp' only, onboarding wrote
 * cssMeta and ftpMeta only, and the intervals.icu proposal retargeted a bare
 * fivekSec. The run was the one anchor the app could not date or attribute,
 * and it is the only one race projections extrapolate from.
 */

const TODAY = '2026-07-29';
const lap = (distance, movingTimeSec) => ({ type: 'WORK', distance, movingTimeSec });
// a 5 km in 22:00, plus the warm-up and cool-down laps a real recording has
const goodTest = [lap(1200, 400), lap(5000, 1320), lap(900, 330)];

describe('the benchmark type: real only, with provenance', () => {
  it('a real 5 km becomes a benchmark; an estimate becomes null, not a benchmark', () => {
    const b = runBenchmark({ fivekSec: 1500, fivekMeta: { source: 'try-test', measuredAt: '2026-07-01', confidence: 'high' } });
    expect(b).toEqual({
      distanceMetres: 5000, timeSeconds: 1500,
      source: 'try-test', measuredAt: '2026-07-01', confidence: 'high',
    });
    // The spec's whole point is that these are different TYPES. A caller
    // holding a RunBenchmark must never have to re-check which kind it is.
    expect(runBenchmark({ fitness: 'elite', raceType: 'runmarathon' })).toBe(null);
    expect(runAnchor({ fitness: 'elite', raceType: 'runmarathon' }).kind).toBe('estimated');
  });

  it('an unrecognised source or confidence is not passed through', () => {
    const b = runBenchmark({ fivekSec: 1500, fivekMeta: { source: 'vibes', confidence: 'certain' } });
    expect(RUN_5K_SOURCES).toContain(b.source);
    expect(b.source).toBe('manual');   // the honest default, not 'vibes'
    expect(b.confidence).toBe(null);
  });

  it('every surface that stamps swim or bike provenance stamps the run too', () => {
    /* THE BUG THIS PHASE FIXED, as a standing guard.
       The fitness editor branched on 'swimCss' and 'bikeFtp', onboarding wrote
       cssMeta and ftpMeta, and the intervals.icu proposal retargeted a bare
       fivekSec. Each surface handled two of the three anchors and silently
       skipped the run, which is the one race projections extrapolate from.

       Asserting the SOURCE of each write point, not the behaviour of a
       function: a value test passes happily while the write point that would
       produce it has been deleted. Removing the editor's fivekMeta block is
       exactly the regression this catches. */
    /* tuning.js was missing from this list when the guard was written, and
       that is exactly how the fifth write point survived: it stamped cssMeta
       and ftpMeta, wrote a bare fivekSec, and no test looked. A guard is only
       as good as the set of files it is pointed at. */
    const files = {
      'eftp.js': './eftp.js',
      'tuning.js': './tuning.js',
      'FitnessEditor.jsx': '../features/settings/FitnessEditor.jsx',
      'Onboarding.jsx': '../features/onboarding/Onboarding.jsx',
      'plan.js': './plan.js',
    };
    Object.entries(files).forEach(([name, path]) => {
      const src = readFileSync(new URL(path, import.meta.url), 'utf8');
      const handlesOthers = src.includes('cssMeta') || src.includes('ftpMeta');
      expect(handlesOthers, name + ' no longer stamps any provenance').toBe(true);
      expect(src.includes('fivekMeta'), name + ' stamps swim/bike provenance but not the run').toBe(true);
    });
  });

  it('every source the app can actually write is in the closed set', () => {
    // Built by reading the WRITE POINTS, not by copying the table: a new
    // writer with a source the set does not know would fail here rather than
    // silently degrade to 'manual' in front of an athlete.
    const src = ['./eftp.js', '../features/settings/FitnessEditor.jsx', '../features/onboarding/Onboarding.jsx']
      .map(f => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
    const written = [...src.matchAll(/fivekMeta:\s*\{\s*source:\s*(?:[^'"]*\?\s*)?'([a-z-]+)'(?:\s*:\s*'([a-z-]+)')?/g)]
      .flatMap(m => [m[1], m[2]]).filter(Boolean);
    expect(written.length).toBeGreaterThan(2); // the writers really were found
    [...new Set(written)].forEach(s =>
      expect(RUN_5K_SOURCES, 'a write point uses source ' + s).toContain(s));
  });
});

describe('benchmark history', () => {
  it('reads superseded values from fitnessHistory and appends the live one last', () => {
    const profile = {
      fivekSec: 1400,
      fivekMeta: { source: 'try-test', measuredAt: '2026-07-20', confidence: 'high' },
      fitnessHistory: [
        { date: '2026-05-01', fivekSec: 1560, fivekMeta: { source: 'manual', confidence: 'medium' } },
        { date: '2026-06-01', fivekSec: 1480 },      // an older snapshot, no provenance
        { date: '2026-06-15', ftp: 250 },            // a bike-only snapshot is not run history
      ],
    };
    const h = runBenchmarkHistory(profile);
    expect(h.map(x => x.timeSeconds)).toEqual([1560, 1480, 1400]);
    expect(h[0].source).toBe('manual');
    expect(h[1].source).toBeUndefined();  // none is shown as none, never invented
    // The live value is LAST. Without it the trend ends on the number the
    // athlete has just beaten, which is the bug the swim dashboard shipped.
    expect(h[2].current).toBe(true);
    expect(h[2].source).toBe('try-test');
  });

  it('an athlete with only an estimate has no history at all', () => {
    expect(runBenchmarkHistory({ fitness: 'beginner' })).toEqual([]);
    expect(runBenchmarkHistory(null)).toEqual([]);
  });
});

describe('reading a 5 km out of a recorded test', () => {
  it('finds the 5 km lap and ignores the warm-up and cool-down', () => {
    const t = fivekFromTestIntervals(goodTest);
    expect(t.fivekSec).toBe(1320);
    expect(t.lapMetres).toBe(5000);
    expect(t.scaled).toBe(false);
    expect(fivekTestIssues(goodTest)).toBe(null);
  });

  it('normalises a nearly-5 km lap on the projection power law', () => {
    // 4,950 m in 1,300 s scales UP to 5,000 m: slightly slower, never faster.
    const t = fivekFromTestIntervals([lap(4950, 1300)]);
    expect(t.scaled).toBe(true);
    expect(t.lapMetres).toBe(4950);
    expect(t.fivekSec).toBeGreaterThan(1300);
    expect(t.fivekSec).toBe(Math.round(1300 * Math.pow(5000 / 4950, RIEGEL_EXP)));
  });

  it('the parser and the explainer agree on every case', () => {
    /* The swim pair is tested this way and the run pair must be too: a case
       where the parser returns null and the explainer also returns null is a
       silent rejection, which is the failure this pairing exists to prevent. */
    const cases = [
      [], null, [lap(4200, 1100)], [lap(5000, 1320), lap(4980, 1400)],
      [lap(5000, 400)], [lap(5000, 3000)], [{ type: 'REST', distance: 5000, movingTimeSec: 1320 }],
      goodTest, [lap(4950, 1300)], [lap(1200, 400)],
    ];
    cases.forEach((c, i) => {
      const parsed = fivekFromTestIntervals(c);
      const issue = fivekTestIssues(c);
      expect(!!parsed === !issue, 'case ' + i + ' parsed=' + !!parsed + ' issue=' + issue).toBe(true);
    });
  });

  it('a partial 5 km is rejected and named as partial', () => {
    // §6: an athlete who stopped at 4.2 km did not run a 5 km time, and
    // scaling one up would invent the part they did not run.
    expect(fivekFromTestIntervals([lap(4200, 1100)])).toBe(null);
    expect(fivekTestIssues([lap(4200, 1100)])).toMatch(/4\.2 km|short of a full 5 km/);
  });

  it('an ambiguous recording is rejected rather than guessed at', () => {
    expect(fivekFromTestIntervals([lap(5000, 1320), lap(4980, 1400)])).toBe(null);
    expect(fivekTestIssues([lap(5000, 1320), lap(4980, 1400)])).toMatch(/more than one/i);
  });

  it('an implausible time cannot move the anchor', () => {
    expect(fivekFromTestIntervals([lap(5000, 400)])).toBe(null);   // beats the world record
    expect(fivekFromTestIntervals([lap(5000, 3000)])).toBe(null);  // a 50 minute walk
    expect(RUN_5K_RULES.minSeconds).toBeGreaterThan(600);
  });

  it('a treadmill recording never becomes a benchmark', () => {
    // §6: belt-derived distance says nothing about how fast the athlete ran.
    const issue = fivekTestIssues(goodTest, { type: 'VirtualRun' });
    expect(issue).toMatch(/indoors|treadmill/i);
    // and the same laps outdoors are fine, so the rejection is the recording
    expect(fivekTestIssues(goodTest, { type: 'Run' })).toBe(null);
  });

  it('matches the right recording on the test date', () => {
    const activities = [
      { id: 1, type: 'Run', date: TODAY, movingTimeSec: 2700 },
      { id: 2, type: 'Ride', date: TODAY, movingTimeSec: 2700 },
      { id: 3, type: 'Run', date: '2026-07-28', movingTimeSec: 2700 },
      { id: 4, type: 'Run', date: TODAY, movingTimeSec: 400 }, // too short to be the test
    ];
    expect(run5kTestActivityFor({ activities, date: TODAY }).id).toBe(1);
    expect(run5kTestActivityFor({ activities, date: null })).toBe(null);
  });
});

describe('the test becomes a proposal', () => {
  const plan = { profile: { fivekSec: 1500 }, paces: { run: { threshold: 312, fivekPace: 300 } } };

  it('a measured 5 km proposes a retarget carrying try-test provenance', () => {
    const r = eftpProposal({
      plan, todayISO: TODAY,
      runTest: { date: '2026-07-25', test: fivekFromTestIntervals(goodTest) },
    });
    expect(r.sport).toBe('run');
    expect(r.kind).toBe('runtest');
    expect(r.up).toBe(true); // 1320 beats the plan's 1500
    expect(r.retarget.fivekSec).toBe(1320);
    expect(r.retarget.fivekMeta).toEqual({ source: 'try-test', measuredAt: '2026-07-25', confidence: 'high' });
    expect(RUN_5K_SOURCES).toContain(r.retarget.fivekMeta.source);
    expect(FTP_CONFIDENCE).toContain(r.retarget.fivekMeta.confidence);
  });

  it('quotes the recorded lap, never a nominal 5 km it did not run', () => {
    const r = eftpProposal({
      plan, todayISO: TODAY,
      runTest: { date: '2026-07-25', test: fivekFromTestIntervals([lap(4950, 1300)]) },
    });
    expect(r.why).toContain('4950 m');
  });

  it('a change too small to matter proposes nothing', () => {
    const r = eftpProposal({
      plan: { profile: { fivekSec: 1330 }, paces: { run: { threshold: 278, fivekPace: 266 } } },
      todayISO: TODAY,
      runTest: { date: '2026-07-25', test: fivekFromTestIntervals(goodTest) },
    });
    expect(r == null || r.sport !== 'run' || r.kind !== 'runtest').toBe(true);
  });

  it('a solo run plan takes the run proposal and refuses the others', () => {
    /* solo gating: a proposal to retarget a discipline the plan does not
       train is noise however real the signal. RACES only ever sets
       solo:'run', so the meaningful direction is that a run-only plan still
       accepts its own run test while a stray swim signal is ignored. */
    const soloPlan = {
      race: 'runhalf', profile: { fivekSec: 1500 },
      paces: { run: { threshold: 312, fivekPace: 300 }, swim: { css: 120 } },
    };
    const withRun = eftpProposal({
      plan: soloPlan, todayISO: TODAY,
      runTest: { date: '2026-07-25', test: fivekFromTestIntervals(goodTest) },
    });
    expect(withRun.sport).toBe('run');
    // the same plan, given only a swim signal, proposes nothing
    const swimOnly = eftpProposal({
      plan: soloPlan, todayISO: TODAY,
      thresholds: { swimThresholdPace: 100 / 90 },
    });
    expect(swimOnly == null || swimOnly.sport !== 'swim').toBe(true);
  });

  it('the proposal sheet shows the effect on paces and names its evidence', () => {
    const proposal = eftpProposal({
      plan, todayISO: TODAY,
      runTest: { date: '2026-07-25', test: fivekFromTestIntervals(goodTest) },
    });
    const d = runProposalDetails({ proposal, plan, todayISO: TODAY });
    expect(d.faster).toBe(true);
    expect(d.curSec).toBe(1500);
    expect(d.nextSec).toBe(1320);
    expect(d.source).toBe('try-test');
    expect(d.measuredAt).toBe('2026-07-25');
    expect(d.confidence).toBe('high');
    // the threshold pace really moves, and in the right direction
    expect(d.thresholdNext).toBeLessThan(d.thresholdCur);
    expect(runProposalDetails({ proposal: { sport: 'swim' }, plan, todayISO: TODAY })).toBe(null);
  });
});

describe('race projections carry their assumptions', () => {
  it('the Riegel model is unchanged', () => {
    const p = predictRaceTimes({ fivekSec: 1500 });
    expect(p.tenK).toBe(Math.round(1500 * Math.pow(2, RIEGEL_EXP)));
    expect(p.halfMarathon).toBe(Math.round(1500 * Math.pow(21.0975 / 5, RIEGEL_EXP)));
    expect(p.marathon.lo).toBe(Math.round(1500 * Math.pow(42.195 / 5, RIEGEL_EXP)));
    expect(p.marathon.hi).toBe(Math.round(1500 * Math.pow(42.195 / 5, RIEGEL_MARATHON_HI)));
  });

  it('the bare numbers every existing caller reads are still there', () => {
    // §3 is additive. A projection surface that lost .tenK would be a
    // regression dressed as a feature.
    const p = predictRaceTimes({ fivekSec: 1500 });
    ['tenK', 'halfMarathon', 'marathon'].forEach(k => expect(p[k]).toBeTruthy());
    expect(typeof p.marathon.lo).toBe('number');
  });

  it('every projection names its model, its exponents and its source', () => {
    const p = predictRaceTimes({
      fivekSec: 1500, fivekMeta: { source: 'try-test', measuredAt: '2026-07-20', confidence: 'high' },
    });
    expect(p.model).toBe('riegel');
    expect(p.projections.map(x => x.distance)).toEqual(['10k', 'half', 'marathon']);
    p.projections.forEach(x => {
      expect(x.model).toBe('riegel');
      expect(x.sourceBenchmark.timeSeconds).toBe(1500);
      expect(x.sourceBenchmark.source).toBe('try-test');
      expect(x.sourceBenchmark.distanceMetres).toBe(5000);
      expect(x.exponentRange.min).toBe(RIEGEL_EXP);
      expect(x.optimisticSeconds).toBeGreaterThan(0);
    });
  });

  it('only the marathon is hedged, and it is hedged in the metadata too', () => {
    const p = predictRaceTimes({ fivekSec: 1500 });
    const byD = Object.fromEntries(p.projections.map(x => [x.distance, x]));
    expect(byD['10k'].realisticSeconds).toBeUndefined();
    expect(byD.half.realisticSeconds).toBeUndefined();
    expect(byD.marathon.realisticSeconds).toBeGreaterThan(byD.marathon.optimisticSeconds);
    expect(byD.marathon.exponentRange.max).toBe(RIEGEL_MARATHON_HI);
    expect(byD['10k'].exponentRange.max).toBe(RIEGEL_EXP);
  });

  it('an estimated anchor still produces no projection at all', () => {
    // The guardrail phase 1 pinned, restated here because §6 leads with it:
    // a projection of a guess is noise wearing a number.
    expect(predictRaceTimes({ fitness: 'elite', raceType: 'runmarathon' })).toBe(null);
    expect(predictRaceTimes({ fitness: 'beginner', raceType: 'olympic' })).toBe(null);
    expect(predictRaceTimes(null)).toBe(null);
  });
});

describe('the barrel exports the benchmark module', () => {
  it('run-benchmark is reachable from the package entry point', async () => {
    const barrel = await import('./index.js');
    ['runBenchmark', 'runBenchmarkHistory', 'run5kTestActivityFor',
      'fivekFromTestIntervals', 'fivekTestIssues', 'runProposalDetails', 'RUN_5K_RULES']
      .forEach(k => expect(barrel[k], k + ' missing from the barrel').toBeTruthy());
  });
});
