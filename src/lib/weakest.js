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
  // An excluded discipline (injured state) is never scored or named the
  // limiter, even when a pre-injury baseline still sits on the profile: the
  // plan cannot act on it, so a verdict would be a nag, not a decision.
  const excluded = profile.excludedDiscipline || null;
  if (excluded) delete scores[excluded];
  const have = Object.keys(scores);
  const missing = ['swim', 'bike', 'run'].filter(d => !have.includes(d) && d !== excluded);
  if (have.length < 2) return null;

  const sorted = have.slice().sort((a, b) => scores[a] - scores[b]);
  const low = sorted[0];
  const bestOfRest = Math.max(...sorted.slice(1).map(d => scores[d]));
  const gap = bestOfRest - scores[low];
  const race = RACES[profile.raceType];
  // Rough race time share per sport (swim is slow per km, bike is fast).
  // Only meaningful with a real race on the calendar — a maintenance block
  // has no race for the limiter to be a share OF (field report 2026-07-12:
  // "the swim is 33% of my race" on a plan with no race).
  const mins = race && !race.noRace
    ? { swim: race.swim * 20, bike: race.bike * 1.8, run: race.run * 5 }
    : null;
  const total = mins ? mins.swim + mins.bike + mins.run : 0;

  // The strongest sport is only named alongside a declared limiter: it is the
  // donor for the frequency swap (plan.js swapForLimiter), and naming one on
  // a near-tie would be the same noise problem as naming a weakest.
  const high = sorted[sorted.length - 1];
  return {
    scores,
    missing,
    excludedSport: excluded,
    weakest: gap >= GAP ? low : null,
    strongest: gap >= GAP ? high : null,
    gap: Math.round(gap * 10) / 10,
    // Unrounded, for threshold decisions: rounding a 1.0125 gap to the display
    // value 1.0 and then comparing `> 1` mis-tiered the bias (gauntlet catch).
    gapRaw: gap,
    share: gap >= GAP && mins ? Math.round(mins[low] / total * 100) : null,
  };
}

// The plan-generation bias: the limiter's sessions earn extra time in the
// building phases, graduated by how far behind it sits — a meaningful gap
// gets a nudge, a full level or more gets a shove (Jon, 2026-07-16). Returns
// a per-discipline duration multiplier map.
export const WEAK_BIAS = 1.1;      // modest gap: half a level to a level
export const WEAK_BIAS_BIG = 1.2;  // large gap: more than a full level
export function weakBias(profile) {
  const wl = weakestLink({ profile });
  if (!wl || !wl.weakest) return {};
  return { [wl.weakest]: wl.gapRaw > 1 ? WEAK_BIAS_BIG : WEAK_BIAS };
}
