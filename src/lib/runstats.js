/* Try — run statistics: race-time projections and weekly run volume.
 *
 * Projections come from the athlete's own 5k time ONLY — never the level
 * estimate (a projection of a guess is noise wearing a number). The 10k and
 * half marathon extrapolate on the standard endurance power law, which holds
 * well at those ranges. The marathon does not get the same confidence: a lone
 * 5k says nothing about marathon-specific endurance, and a single flat
 * exponent is exactly the overconfidence race-prediction features get mocked
 * for. It renders as a range, optimistic-to-realistic, and its copy says why
 * (design panel 2026-07-18). */

import { DISCIPLINE } from './autolog.js';
import { iso, addDays, startOfWeekMonday } from './date.js';

const EXP = 1.06;           // Riegel exponent: solid 5k -> half marathon
const EXP_MARATHON_HI = 1.15; // the realistic end once endurance is unproven

export function predictRaceTimes(profile) {
  if (!profile || !profile.fivekSec) return null;
  const t = profile.fivekSec;
  const at = (km, exp) => Math.round(t * Math.pow(km / 5, exp));
  return {
    tenK: at(10, EXP),
    halfMarathon: at(21.0975, EXP),
    marathon: { lo: at(42.195, EXP), hi: at(42.195, EXP_MARATHON_HI) },
  };
}

// Weekly run kilometres from the merged activity list (recordings + manual
// diary entries that carry a distance). Indoor runs count: the bike pass
// suppressed derived RATE for indoor recordings, never raw distance. Weeks
// with runs but no distances stay honest at their real sum. Returns oldest
// first: [{ start, km }].
export function weeklyRunKm({ activities, todayISO, weeks = 8 }) {
  const acts = Array.isArray(activities) ? activities : [];
  const thisMonday = iso(startOfWeekMonday(todayISO));
  const starts = Array.from({ length: weeks }, (_, i) => iso(addDays(thisMonday, -7 * (weeks - 1 - i))));
  const byWeek = Object.fromEntries(starts.map(w => [w, 0]));
  acts.forEach(a => {
    if (!a || DISCIPLINE[a.type] !== 'run' || !a.distance || !a.date) return;
    const wk = iso(startOfWeekMonday(a.date));
    if (wk in byWeek) byWeek[wk] += a.distance / 1000;
  });
  return starts.map(w => ({ start: w, km: Math.round(byWeek[w] * 10) / 10 }));
}
