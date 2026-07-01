/* Try — plan-domain constants: races, training zones, experience levels, phases. */

export const RACES = {
  sprint:  { key: 'sprint',  name: 'Sprint',       swim: 0.75, bike: 20,  run: 5,    taperWeeks: 1 },
  olympic: { key: 'olympic', name: 'Olympic',      swim: 1.5,  bike: 40,  run: 10,   taperWeeks: 1 },
  half:    { key: 'half',    name: 'Half (70.3)',  swim: 1.9,  bike: 90,  run: 21.1, taperWeeks: 2 },
  full:    { key: 'full',    name: 'Full (140.6)', swim: 3.8,  bike: 180, run: 42.2, taperWeeks: 2 },
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
};
