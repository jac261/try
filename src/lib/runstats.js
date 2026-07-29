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
import { runAnchor } from './domain.js';

// Exported so the plan builder's race-pace long runs quote the same
// projection the Progress tab shows; two Riegel exponents would drift.
export const RIEGEL_EXP = 1.06;           // solid 5k -> half marathon
export const RIEGEL_MARATHON_HI = 1.15;   // the realistic end once endurance is unproven
const EXP = RIEGEL_EXP;
const EXP_MARATHON_HI = RIEGEL_MARATHON_HI;

export function predictRaceTimes(profile) {
  /* Gated on the ANCHOR, not on profile.fivekSec. The raw field is true for a
     feel-nudged level estimate as well as for a time the athlete ran, and
     projecting a marathon off the former quotes a finish time derived from
     nothing they have ever done (phase 5 §3, §5). runAnchor is the only thing
     that knows the difference. */
  if (!profile) return null;
  const anchor = runAnchor(profile);
  if (anchor.kind !== 'real') return null;
  const t = anchor.timeSec;
  const at = (km, exp) => Math.round(t * Math.pow(km / 5, exp));
  /* The bare numbers stay exactly where every existing caller reads them.
     `projections` and the model metadata are additive (phase 2 §3), so the
     assumptions behind a quoted time can be SHOWN rather than being folklore
     living in this file's header comment.

     sourceBenchmark is built from runAnchor rather than from
     run-benchmark.js: that module imports RIEGEL_EXP from here, and importing
     it back would close a cycle. domain.js imports nothing, so this direction
     is safe. (Circular-module TDZ has bitten this codebase twice.) */
  const benchmark = {
    distanceMetres: 5000,
    timeSeconds: t,
    source: anchor.source,
    measuredAt: anchor.measuredAt,
    confidence: anchor.confidence,
  };
  const one = (distance, seconds, hi) => ({
    distance,
    optimisticSeconds: seconds,
    ...(hi != null ? { realisticSeconds: hi } : {}),
    sourceBenchmark: benchmark,
    model: 'riegel',
    exponentRange: { min: EXP, max: hi != null ? EXP_MARATHON_HI : EXP },
  });
  return {
    tenK: at(10, EXP),
    halfMarathon: at(21.0975, EXP),
    marathon: { lo: at(42.195, EXP), hi: at(42.195, EXP_MARATHON_HI) },
    model: 'riegel',
    sourceBenchmark: benchmark,
    projections: [
      one('10k', at(10, EXP)),
      one('half', at(21.0975, EXP)),
      one('marathon', at(42.195, EXP), at(42.195, EXP_MARATHON_HI)),
    ],
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
