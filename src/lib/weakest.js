/* Try — weakest-link detection: which sport is currently limiting the athlete.
 *
 * Each sport's baseline is placed on the same experience ladder the plan's
 * level estimates already define (FITNESS est5k/estCss), extended with a
 * watts-per-kilo ladder for the bike, giving a continuous level index per
 * sport (0 = beginner … 3 = elite). The limiter is the sport sitting a
 * MEANINGFUL gap below the best of the others — near-ties declare balance,
 * because naming a weakest link on noise would send training the wrong way.
 * Missing data (no FTP, no weight, no swim baseline) removes that sport from
 * the comparison rather than guessing, and with fewer than two comparable
 * sports there is no verdict at all.
 */
import { FITNESS, RACES } from './domain.js';

// The experience ladders, worst → best. Run/swim come from FITNESS so the two
// systems can never drift; the bike ladder is W/kg (the only honest cross-
// athlete bike scale, which is why the bike needs a recent weight).
const LADDERS = {
  run: { values: Object.values(FITNESS).map(f => f.est5k), lowerBetter: true },
  swim: { values: Object.values(FITNESS).map(f => f.estCss), lowerBetter: true },
  bike: { values: [2.0, 2.6, 3.2, 4.0], lowerBetter: false },
};

// Continuous position on a 4-rung ladder: 0 at rung 0, 3 at rung 3, clamped
// half a level beyond each end so outliers don't explode the gap maths.
function levelIndex(value, { values, lowerBetter }) {
  const v = lowerBetter ? -value : value;
  const rungs = values.map(x => (lowerBetter ? -x : x));
  if (v <= rungs[0]) return Math.max(-0.5, (v - rungs[0]) / (rungs[1] - rungs[0]));
  for (let i = 1; i < rungs.length; i++) {
    if (v <= rungs[i]) return i - 1 + (v - rungs[i - 1]) / (rungs[i] - rungs[i - 1]);
  }
  return Math.min(3.5, 3 + (v - rungs[3]) / (rungs[3] - rungs[2]));
}

const GAP = 0.5; // levels below the best of the others before a limiter is declared

// → { scores: {run?, swim?, bike?}, weakest, gap, share, missing: [...] } or null
// when fewer than two sports are comparable. `share` is the weakest sport's
// rough slice of the athlete's race, for the "and it matters because" line.
export function weakestLink({ profile }) {
  if (!profile) return null;
  const scores = {};
  if (profile.fivekSec) scores.run = levelIndex(profile.fivekSec, LADDERS.run);
  if (profile.css100Sec) scores.swim = levelIndex(profile.css100Sec, LADDERS.swim);
  if (profile.ftp && profile.weightKg) scores.bike = levelIndex(profile.ftp / profile.weightKg, LADDERS.bike);
  const have = Object.keys(scores);
  const missing = ['swim', 'bike', 'run'].filter(d => !have.includes(d));
  if (have.length < 2) return null;

  const sorted = have.slice().sort((a, b) => scores[a] - scores[b]);
  const low = sorted[0];
  const bestOfRest = Math.max(...sorted.slice(1).map(d => scores[d]));
  const gap = bestOfRest - scores[low];
  const race = RACES[profile.raceType];
  // Rough race time share per sport (swim is slow per km, bike is fast).
  const mins = race && !race.noRace
    ? { swim: race.swim * 20, bike: race.bike * 1.8, run: race.run * 5 }
    : { swim: 1, bike: 1, run: 1 };
  const total = mins.swim + mins.bike + mins.run;

  return {
    scores,
    missing,
    weakest: gap >= GAP ? low : null,
    gap: Math.round(gap * 10) / 10,
    share: gap >= GAP ? Math.round(mins[low] / total * 100) : null,
  };
}

// The plan-generation bias: the limiter's sessions earn extra time in the
// building phases. Returns a per-discipline duration multiplier map.
export const WEAK_BIAS = 1.1;
export function weakBias(profile) {
  const wl = weakestLink({ profile });
  return wl && wl.weakest ? { [wl.weakest]: WEAK_BIAS } : {};
}
