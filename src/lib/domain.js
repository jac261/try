/* Try — plan-domain constants: races, training zones, experience levels, phases. */

// minWeeks/maxWeeks bound the BUILD for each distance: under min the plan is
// a sharpen-and-arrive (warned, not blocked, down to the 4-week floor); over
// max the plan opens with a Maintain block until the build window begins.
// "maintenance" is the no-race rolling block (noRace: true); its raceDate is
// just the block's horizon.
export const RACES = {
  sprint:  { key: 'sprint',  name: 'Sprint',       swim: 0.75, bike: 20,  run: 5,    taperWeeks: 1, minWeeks: 6,  maxWeeks: 16 },
  olympic: { key: 'olympic', name: 'Olympic',      swim: 1.5,  bike: 40,  run: 10,   taperWeeks: 1, minWeeks: 8,  maxWeeks: 24 },
  half:    { key: 'half',    name: 'Half (70.3)',  swim: 1.9,  bike: 90,  run: 21.1, taperWeeks: 2, minWeeks: 12, maxWeeks: 32 },
  t100:    { key: 't100',    name: 'T100 (100k)',  swim: 2,    bike: 80,  run: 18,   taperWeeks: 2, minWeeks: 12, maxWeeks: 32 },
  full:    { key: 'full',    name: 'Full (140.6)', swim: 3.8,  bike: 180, run: 42.2, taperWeeks: 2, minWeeks: 16, maxWeeks: 40 },
  // Standalone run races. `solo: 'run'` means the plan trains and races
  // exactly one discipline, named by the value; absent means triathlon, so
  // every existing entry (and plan) behaves bit-identically. It is a race
  // property, never a profile field: it cannot go stale, and it round-trips
  // the backend for free because the race key is a stored column. solo
  // outranks excludedDiscipline and any locked limiter swap wherever the two
  // could disagree. swim/bike stay numeric zeros (never undefined) because
  // weakest.js's share math reads them. Names must stand alone in bare
  // interpolation ("Training for the 5k Run on..."); 'Half Marathon' cannot
  // collide with the tri Half, which keeps its (70.3) parenthetical.
  run5k:       { key: 'run5k',       name: '5k Run',        solo: 'run', swim: 0, bike: 0, run: 5,    taperWeeks: 1, minWeeks: 6,  maxWeeks: 16 },
  run10k:      { key: 'run10k',      name: '10k Run',       solo: 'run', swim: 0, bike: 0, run: 10,   taperWeeks: 1, minWeeks: 6,  maxWeeks: 20 },
  runhalf:     { key: 'runhalf',     name: 'Half Marathon', solo: 'run', swim: 0, bike: 0, run: 21.1, taperWeeks: 1, minWeeks: 8,  maxWeeks: 24 },
  runmarathon: { key: 'runmarathon', name: 'Marathon',      solo: 'run', swim: 0, bike: 0, run: 42.2, taperWeeks: 2, minWeeks: 12, maxWeeks: 28 },
  maintenance: { key: 'maintenance', name: 'Maintenance', swim: 0, bike: 0, run: 0, taperWeeks: 0, minWeeks: 4, maxWeeks: 52, noRace: true },
  // The no-plan / tracker state: no race, no weeks. noRace keeps it out of the
  // race pickers (which filter !noRace); tracker is the sole predicate for the
  // app's tracker-only mode. Never passed to generatePlan.
  tracker: { key: 'tracker', name: 'Tracker', swim: 0, bike: 0, run: 0, taperWeeks: 0, minWeeks: 0, maxWeeks: 0, noRace: true, tracker: true },
};

// Tune-up (B) races: real events raced inside a plan without being its goal —
// a sprint six weeks out from an Olympic, a parkrun mid-block. durationMin is
// a rough all-in estimate for the load model; the mini-taper into the race and
// the recovery day after are shaped at generation. Tri kinds reuse the RACES
// distances for their leg breakdown.
export const B_RACES = {
  sprint:  { key: 'sprint',  name: 'Sprint Triathlon',  discipline: 'brick', durationMin: 80 },
  olympic: { key: 'olympic', name: 'Olympic Triathlon', discipline: 'brick', durationMin: 150 },
  run5k:   { key: 'run5k',   name: '5k Run Race',       discipline: 'run',   durationMin: 30 },
  run10k:  { key: 'run10k',  name: '10k Run Race',      discipline: 'run',   durationMin: 55 },
  // A raced half is a real event, not a parkrun: the easing pass widens its
  // exit window (see the B-race pass in plan.js). No marathon entry on
  // purpose; nobody races a marathon as a rehearsal.
  runhalf: { key: 'runhalf', name: 'Half Marathon Race', discipline: 'run',  durationMin: 110 },
};

export const ZONES = {
  Z1: { name: 'Recovery',   rpe: 'RPE 1-2' },
  Z2: { name: 'Endurance',  rpe: 'RPE 3-4' },
  Z3: { name: 'Tempo',      rpe: 'RPE 5-6' },
  Z4: { name: 'Threshold',  rpe: 'RPE 7-8' },
  Z5: { name: 'VO2 Max',    rpe: 'RPE 9-10' },
};

// Experience levels differ across several dials:
//   factor        — weekly volume multiplier (session durations)
//   intensity     — shifts quality sessions up/down the workout ladder (see plan.js)
//   recoveryEvery — a step-back recovery week every N weeks
//   recoveryDepth — how much volume drops on a recovery week (lower = bigger cut)
//   est5k/estCss  — fallback baselines (5k time in sec, swim /100m in sec) used to
//                   estimate paces when the athlete leaves the fitness fields blank.
//   runEst5k      — the same 5k fallback but calibrated to RUNNERS, used only on
//                   solo run race plans (RACES solo:'run'). est5k stays
//                   triathlete-scaled because it also sets the weakest.js run
//                   ladder rungs, a triathlon-only comparison; the two roles
//                   diverge in opposite directions at the ends, so the runner
//                   scale is a second field, never a shift of the first
//                   (design panel 2026-07-22, anchors signed off by Jon).
// A weight the app is willing to compute with. Anything outside human range
// is a typo (pounds entered as kilos, a stray minus) and every consumer must
// refuse it identically: the plan's watt estimate, the limiter board's W/kg
// score and the editors' previews all route through here, so none of them can
// project a nonsense number the others would reject (gauntlet 2026-07-18).
export const WEIGHT_KG = { min: 30, max: 250 };
export function saneWeightKg(weightKg) {
  const n = Number(weightKg);
  return n >= WEIGHT_KG.min && n <= WEIGHT_KG.max ? n : null;
}

/* Phase 1 (bike): the power anchor, said out loud.
 *
 * The bike has always had two different numbers wearing the same name: the
 * athlete's real FTP, and a level-times-weight estimate that exists only so
 * a new rider sees watt ranges instead of RPE text. Keeping them apart is
 * the module's oldest invariant (design panel 2026-07-18) and it is enforced
 * by convention today: the estimate lives on paces and profile.ftp stays
 * null, because weakest.js, eftp.js, tuning.js and the fitness-history trend
 * all read profile.ftp directly and every one of them would be corrupted by
 * a guess.
 *
 * This makes the distinction a value rather than a convention, so a caller
 * can ask what kind of number it is holding instead of remembering to check.
 * Only kind 'real' may drive review, tuning, weakness detection or history.
 *
 * It reads the profile and nothing else, so it cannot disagree with
 * computePaces about what is real.
 */
// The sources a REAL threshold can have (phase 2 §1). 'activity-model' is a
// rolling estimate from recorded rides: a real threshold, modelled rather
// than tested. The level-times-weight guess is NOT in here, because it is
// never a threshold at all.
export const FTP_SOURCES = ['manual', 'try-test', 'activity-model', 'intervals-icu'];
export function bikePowerAnchor(profile) {
  const p = profile || {};
  const meta = p.ftpMeta || {};
  if (p.ftp) {
    return {
      kind: 'real',
      ftpWatts: p.ftp,
      source: FTP_SOURCES.includes(meta.source) ? meta.source : 'manual',
      measuredAt: meta.measuredAt || null,
    };
  }
  // No weight means no estimate at all: converting watts per kilo into watts
  // needs a weight, and an unusable one (500 kg once read as a 975 W
  // endurance ride) must fail closed rather than project a confident wrong
  // number onto the card.
  const kg = saneWeightKg(p.weightKg);
  const lvl = FITNESS[p.fitness] || FITNESS.intermediate;
  if (kg && lvl.estWkg) {
    return { kind: 'estimated', ftpWatts: Math.round(lvl.estWkg * kg), levelWkg: lvl.estWkg, weightKg: kg };
  }
  return { kind: 'none' };
}

// The one question every consumer of a threshold actually wants to ask.
export function hasRealFtp(profile) {
  return bikePowerAnchor(profile).kind === 'real';
}

export const FTP_CONFIDENCE = ['low', 'medium', 'high'];

/* Phase 2 §3: the accepted real FTPs over time, newest last.
 *
 * Read from the same fitnessHistory the run and swim trends use, so there is
 * one history rather than a private bike one. A history entry stores the
 * value that was SUPERSEDED on that date, which is why the live value is
 * appended as the final point: without that the trend ends on the number the
 * athlete has just beaten (the swim dashboard had exactly this bug).
 *
 * Estimates never appear. Only a real FTP is ever written to the profile, so
 * only real FTPs can be in here, but the filter is explicit rather than
 * assumed. */
export function bikeThresholdHistory(profile) {
  const p = profile || {};
  const past = (p.fitnessHistory || [])
    .filter(h => h && h.ftp)
    .map(h => ({
      date: h.date, ftpWatts: h.ftp,
      // snapshots written since phase 2 carry the superseded value's own
      // provenance; older ones simply have none, and none is shown as none
      ...(h.ftpMeta ? { source: FTP_SOURCES.includes(h.ftpMeta.source) ? h.ftpMeta.source : 'manual', confidence: FTP_CONFIDENCE.includes(h.ftpMeta.confidence) ? h.ftpMeta.confidence : null } : {}),
    }));
  const anchor = bikePowerAnchor(p);
  if (anchor.kind !== 'real') return past;
  const meta = p.ftpMeta || {};
  return past.concat([{
    date: anchor.measuredAt || null,
    ftpWatts: anchor.ftpWatts,
    source: anchor.source,
    confidence: FTP_CONFIDENCE.includes(meta.confidence) ? meta.confidence : null,
    current: true,
  }]);
}

// The athlete's pool. A DISPLAY-and-construction setting only: it changes how
// swim work is expressed (lengths, unit), never the physiological threshold.
// CSS stays canonical in seconds per 100 m whatever the pool. The default is
// 25 m, which reproduces today's output exactly because every current swim
// distance is already a multiple of 50 m (swim build-out phase 2, 2026-07-22).
export const DEFAULT_POOL = { length: 25, unit: 'metres' };
export const POOL_PROFILES = [
  { key: '25m', length: 25, unit: 'metres', label: '25 m pool' },
  { key: '50m', length: 50, unit: 'metres', label: '50 m pool' },
  { key: '25yd', length: 25, unit: 'yards', label: '25 yd pool' },
  // a custom length is stored directly as { length, unit }, no catalog entry.
];
// A pool length the app is willing to build with: 10-100 in either unit. An
// out-of-range or malformed setting falls back to the default rather than
// generating a partial or absurd length (the saneWeightKg pattern).
export function sanePool(pool) {
  if (!pool || (pool.unit !== 'metres' && pool.unit !== 'yards')) return null;
  const n = Number(pool.length);
  return n >= 10 && n <= 100 ? { length: n, unit: pool.unit } : null;
}
// The pool to build with for a profile: its own valid setting, or the default.
export function poolFor(profile) {
  return sanePool(profile && profile.pool) || DEFAULT_POOL;
}

// The canonical swim threshold (swim build-out phase 3). css100Sec stays the
// physiological number every consumer reads (seconds per 100 m); this records
// WHERE it came from and how much to trust it, WITHOUT replacing the number,
// so no reader changes. The test workflow (phase 3b) writes profile.cssMeta.
export const CSS_SOURCES = ['manual', 'estimated', 'try-test', 'intervals-icu'];
export const CSS_CONFIDENCE = ['low', 'medium', 'high'];
export function swimThreshold(profile) {
  const meta = (profile && profile.cssMeta) || {};
  const css = (profile && profile.css100Sec) || null;
  return {
    cssSecondsPer100m: css,
    source: CSS_SOURCES.includes(meta.source) ? meta.source : (css ? 'manual' : 'estimated'),
    measuredAt: meta.measuredAt || null,
    confidence: CSS_CONFIDENCE.includes(meta.confidence) ? meta.confidence : null,
  };
}

// estWkg mirrors est5k/estCss for the bike, in watts per kilo. It matches the
// weakest.js ladder so the two systems can never disagree about what a level
// means. It is a WEAKER estimate than its run/swim siblings: profile.fitness
// is one multisport dial, so a strong cyclist new to triathlon reads low and
// a strong runner reads high. That is why an estimated FTP never judges a
// session in review (design panel 2026-07-18).
export const FITNESS = {
  beginner:     { key: 'beginner',     name: 'Beginner',     factor: 0.75, intensity: -1, recoveryEvery: 3, recoveryDepth: 0.6,  est5k: 2040, runEst5k: 2160, estCss: 140, estWkg: 2.0, blurb: 'New to multisport — build the base', runBlurb: 'New to structured running, build the base' },
  intermediate: { key: 'intermediate', name: 'Intermediate', factor: 1.0,  intensity: 0,  recoveryEvery: 4, recoveryDepth: 0.72, est5k: 1620, runEst5k: 1680, estCss: 120, estWkg: 2.6, blurb: 'A few seasons in, training consistently', runBlurb: 'Running consistently, a few races in' },
  advanced:     { key: 'advanced',     name: 'Advanced',     factor: 1.2,  intensity: 1,  recoveryEvery: 4, recoveryDepth: 0.75, est5k: 1320, runEst5k: 1320, estCss: 105, estWkg: 3.2, blurb: 'Experienced & chasing a result', runBlurb: 'Experienced and chasing a time' },
  elite:        { key: 'elite',        name: 'Elite',        factor: 1.42, intensity: 2,  recoveryEvery: 4, recoveryDepth: 0.82, est5k: 1110, runEst5k: 1050, estCss: 90,  estWkg: 4.0, blurb: 'Semi-pro / front-of-pack age-grouper', runBlurb: 'Front of the pack, big weeks welcome' },
};

export const PHASE_INFO = {
  Base:  { color: '#38bdf8', blurb: 'Build aerobic engine & technique' },
  Build: { color: '#fb923c', blurb: 'Add intensity & race-specific work' },
  Peak:  { color: '#f87171', blurb: 'Sharpen at race pace' },
  Taper: { color: '#c084fc', blurb: 'Rest, recover & arrive fresh' },
  Maintain: { color: '#2dd4bf', blurb: 'Stay fit & keep the engine ticking' },
  // Display-only label for the scheduled post-race week (stored phase stays
  // 'Maintain' — the backend's phase catalog has no 'Recovery').
  Recovery: { color: '#34d399', blurb: 'Easy week after race day — soak it in' },
};
