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
//                   estimate paces when the athlete leaves the fitness fields blank
export const FITNESS = {
  beginner:     { key: 'beginner',     name: 'Beginner',     factor: 0.75, intensity: -1, recoveryEvery: 3, recoveryDepth: 0.6,  est5k: 2040, estCss: 140, blurb: 'New to multisport — build the base' },
  intermediate: { key: 'intermediate', name: 'Intermediate', factor: 1.0,  intensity: 0,  recoveryEvery: 4, recoveryDepth: 0.72, est5k: 1620, estCss: 120, blurb: 'A few seasons in, training consistently' },
  advanced:     { key: 'advanced',     name: 'Advanced',     factor: 1.2,  intensity: 1,  recoveryEvery: 4, recoveryDepth: 0.75, est5k: 1320, estCss: 105, blurb: 'Experienced & chasing a result' },
  elite:        { key: 'elite',        name: 'Elite',        factor: 1.42, intensity: 2,  recoveryEvery: 4, recoveryDepth: 0.82, est5k: 1110, estCss: 90,  blurb: 'Semi-pro / front-of-pack age-grouper' },
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
