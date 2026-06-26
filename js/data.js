/* Try — domain data: races, disciplines, zones, fitness levels, helpers */
window.TF = window.TF || {};

TF.RACES = {
  sprint:  { key: 'sprint',  name: 'Sprint',       swim: 0.75, bike: 20,  run: 5,    taperWeeks: 1 },
  olympic: { key: 'olympic', name: 'Olympic',      swim: 1.5,  bike: 40,  run: 10,   taperWeeks: 1 },
  half:    { key: 'half',    name: 'Half (70.3)',  swim: 1.9,  bike: 90,  run: 21.1, taperWeeks: 2 },
  full:    { key: 'full',    name: 'Full (140.6)', swim: 3.8,  bike: 180, run: 42.2, taperWeeks: 2 },
};

TF.DISCIPLINES = {
  swim:     { name: 'Swim',     color: '#38bdf8', grad: 'linear-gradient(135deg, #38bdf8, #2563eb)', icon: 'swim' },
  bike:     { name: 'Bike',     color: '#fb923c', grad: 'linear-gradient(135deg, #fbbf24, #f97316)', icon: 'bike' },
  run:      { name: 'Run',      color: '#34d399', grad: 'linear-gradient(135deg, #4ade80, #10b981)', icon: 'run' },
  brick:    { name: 'Brick',    color: '#c084fc', grad: 'linear-gradient(135deg, #c084fc, #8b5cf6)', icon: 'brick' },
  strength: { name: 'Strength', color: '#94a3b8', grad: 'linear-gradient(135deg, #94a3b8, #64748b)', icon: 'strength' },
  rest:     { name: 'Rest',     color: '#3a3f4a', grad: 'linear-gradient(135deg, #3a3f4a, #2a2f38)', icon: 'rest' },
};

TF.ZONES = {
  Z1: { name: 'Recovery',   rpe: 'RPE 1-2' },
  Z2: { name: 'Endurance',  rpe: 'RPE 3-4' },
  Z3: { name: 'Tempo',      rpe: 'RPE 5-6' },
  Z4: { name: 'Threshold',  rpe: 'RPE 7-8' },
  Z5: { name: 'VO2 Max',    rpe: 'RPE 9-10' },
};

// Experience levels differ across four dials:
//   factor        — weekly volume multiplier (session durations)
//   intensity     — shifts quality sessions up/down the workout ladder (see plan.js)
//   recoveryEvery — a step-back recovery week every N weeks
//   recoveryDepth — how much volume drops on a recovery week (lower = bigger cut)
TF.FITNESS = {
  beginner:     { key: 'beginner',     name: 'Beginner',     factor: 0.75, intensity: -1, recoveryEvery: 3, recoveryDepth: 0.6,  blurb: 'New to multisport — build the base' },
  intermediate: { key: 'intermediate', name: 'Intermediate', factor: 1.0,  intensity: 0,  recoveryEvery: 4, recoveryDepth: 0.72, blurb: 'A few seasons in, training consistently' },
  advanced:     { key: 'advanced',     name: 'Advanced',     factor: 1.2,  intensity: 1,  recoveryEvery: 4, recoveryDepth: 0.75, blurb: 'Experienced & chasing a result' },
  elite:        { key: 'elite',        name: 'Elite',        factor: 1.42, intensity: 2,  recoveryEvery: 4, recoveryDepth: 0.82, blurb: 'Semi-pro / front-of-pack age-grouper' },
};

TF.PHASE_INFO = {
  Base:  { color: '#38bdf8', blurb: 'Build aerobic engine & technique' },
  Build: { color: '#fb923c', blurb: 'Add intensity & race-specific work' },
  Peak:  { color: '#f87171', blurb: 'Sharpen at race pace' },
  Taper: { color: '#c084fc', blurb: 'Rest, recover & arrive fresh' },
};

/* ---- date helpers ---- */
TF.startOfWeekMonday = function (d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - day);
  return x;
};
TF.addDays = function (d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
TF.iso = function (d) {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};
TF.weeksBetween = function (a, b) {
  return (new Date(b) - new Date(a)) / (7 * 24 * 3600 * 1000);
};
TF.daysBetween = function (a, b) {
  return Math.round((new Date(b) - new Date(a)) / (24 * 3600 * 1000));
};
TF.fmtDate = function (iso, opts) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, opts || { weekday: 'short', month: 'short', day: 'numeric' });
};

/* ---- number / pace helpers ---- */
TF.clamp = function (n, lo, hi) { return Math.max(lo, Math.min(hi, n)); };
TF.round5 = function (n) { return Math.max(5, Math.round(n / 5) * 5); };
TF.lerp = function (a, b, t) { return a + (b - a) * t; };

TF.fmtPace = function (secPerKm) {
  const s = Math.round(secPerKm);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
TF.parseTimeToSec = function (str) {
  if (!str) return null;
  const parts = String(str).split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number(str) * 60;
};
TF.fmtDuration = function (min) {
  const m = Math.round(min);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return r ? h + 'h ' + r + 'm' : h + 'h';
};
