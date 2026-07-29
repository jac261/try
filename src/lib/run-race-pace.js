/* Try — race-pace prescription, on a calendar rather than a dice roll.
 * (run phase 7 §1 and §2)
 *
 * WHAT WAS THERE. The long run's race-pace variant was one entry in a menu
 * picked by a stepped seed walk. That walk exists for a good reason — it
 * breaks the modulo alignment that made a four-slot menu unreachable under
 * the four-week recovery cadence — but it decides WHICH FORMAT a long run
 * takes, and race-pace exposure is not a format question. Measured across
 * an 18-week plan it produced exactly two race-pace long runs, both the same
 * size, and for a beginner both of them landed in the taper with none at all
 * during Build. A marathon runner got two 35-minute race-pace efforts in
 * four months, late, and no progression between them.
 *
 * WHAT THIS DOES. Race-pace exposure becomes a calendar keyed on the things
 * that actually determine it: the race, the phase, and how many training
 * weeks of that phase have already happened. No seed, no modulo, so the
 * alignment trap cannot apply — this does not select from a menu at all.
 *
 * The shape follows §1: introductory blocks in early Build, longer controlled
 * blocks in late Build, the full rehearsal in Peak, and a short familiar
 * exposure in Taper. Recovery weeks are skipped entirely, and race week is
 * governed by phase 1b.
 *
 * ONLY THE HALF AND MARATHON. A 5 km or 10 km race pace IS threshold and VO2
 * work, which the ladder already prescribes; a separate race-pace session
 * there would be the same session under a second name. This mirrors
 * RACE_QUALITY_BIAS, which lifts the short races' ladder rung instead.
 */

/* The calendar. One entry per non-recovery week of the phase, indexed by how
 * many such weeks have already been trained. Entry types:
 *
 *   number          a race-pace block of that many minutes INSIDE the long run
 *   { midweek: n }  a standalone midweek Race Pace session of n minutes
 *   null            no race-pace work this week
 *
 * Running off the end of an array means no race-pace work, so a long Build
 * block does not keep firing forever; the exposures sit where they are
 * written and nowhere else.
 *
 * THE SHAPE, and why it is sparse. §4 of the previous phase established that
 * no more than a quarter of long runs may be hard ones, and the long run also
 * carries the tired-legs durability variant. A first draft of this calendar
 * put race pace in four Build weeks plus Peak plus Taper and drove the hard
 * share to 41%, which is a worse plan than the seed walk it replaced even
 * though every session in it was individually reasonable. Race-pace exposure
 * competes for the same long runs as durability work, so only TWO long runs
 * carry it: the longer controlled block late in Build, and the full rehearsal
 * in Peak. The other exposures are midweek sessions, which cost the long run
 * nothing.
 *
 * That also reads better against §1's own structure. An "introductory"
 * race-pace segment is exactly what a short midweek session is; putting the
 * introduction inside a long run makes the athlete's first taste of race pace
 * their hardest long run of the block so far.
 *
 * TAPER EXPOSURE GOES MIDWEEK. §1 asks for "shorter familiar race-pace
 * exposures" in the taper, and that is right, but putting them in the long
 * run keeps the taper's longest session hard in the week it most needs to be
 * easy. Midweek it is a short reminder of the pace, which is what a taper
 * exposure is for.
 */
export const RACE_PACE_CALENDAR = {
  runhalf: {
    Build: [null, { midweek: 20 }, null, 30],
    Peak: [35, { midweek: 25 }],
    Taper: [{ midweek: 15 }],
  },
  runmarathon: {
    Build: [null, { midweek: 25 }, null, 40],
    Peak: [50, { midweek: 30 }],
    Taper: [{ midweek: 20 }],
  },
};

// A midweek race-pace session is capped well under the long run's block: it
// is a rehearsal of pace, not of duration, and the durability work belongs to
// the weekend.
export const RACE_PACE_MIDWEEK_CAP = 30;

/* What race-pace work this week gets, or null for none.
 *
 * `phaseWeek` is the count of non-recovery weeks of THIS phase already
 * trained, zero-based. The caller has it; deriving it here would need the
 * whole plan.
 *
 * Returns { longMin } to put a block inside the long run, and/or
 * { midweekMin } for a standalone session. Never both in the same week.
 */
export function racePaceForWeek({ raceKey, phase, phaseWeek, isRecovery, isRaceWeek }) {
  const cal = RACE_PACE_CALENDAR[raceKey];
  if (!cal) return null;
  // Recovery weeks remove load; race week is phase 1b's business.
  if (isRecovery || isRaceWeek) return null;
  /* Beginners are NOT excluded. A first draft gated them out on the reasoning
     that they are training to finish rather than to hit a time — but the
     modulo trap that once made the race-pace slot unreachable for beginners
     was found and fixed deliberately, and re-excluding them here would have
     quietly undone that fix under a different justification. A beginner
     running their first marathon still benefits from knowing what the pace
     feels like; the calendar keeps their exposure short and late. */
  const steps = cal[phase];
  if (!steps) return null;
  // Past the end of the schedule means no work, NOT the last entry repeated:
  // clamping here is what turned a three-exposure block into one that fired
  // every week of a long Build phase.
  const entry = phaseWeek < steps.length ? steps[phaseWeek] : null;
  if (entry == null) return null;
  if (typeof entry === 'object') {
    return { midweekMin: Math.min(entry.midweek, RACE_PACE_MIDWEEK_CAP) };
  }
  return { longMin: entry };
}

/* The midweek session's shape. Exact pace only from a real benchmark; effort
   wording otherwise (§2, §6). The caller supplies the resolved pace so this
   module never has to know how a pace is computed — and so the SAME gate that
   decides whether to print a number decides whether the review may judge one.
*/
export function racePaceSession({ raceKey, minutes, pacePerKm }) {
  if (!RACE_PACE_CALENDAR[raceKey] || !minutes) return null;
  const name = raceKey === 'runmarathon' ? 'marathon' : 'half marathon';
  // Two blocks with a float between them: long enough to settle into the
  // pace, short enough that it stays a rehearsal.
  const reps = minutes >= 24 ? 3 : 2;
  const per = Math.round(minutes / reps);
  return {
    reps,
    perMin: per,
    floatMin: 3,
    label: reps + ' × (' + per + ' min at ' + name + ' effort / 3 min float)',
    /* The SAME wording the long run uses for this distance, real pace or not.
       Two surfaces describing one effort in two voices is how an athlete ends
       up believing they are different sessions — and the per-distance
       distinction (marathon between long and tempo, half at tempo) was a
       deliberate catch that a generic line would flatten. */
    detail: pacePerKm
      ? '~' + Math.floor(pacePerKm / 60) + ':' + String(Math.round(pacePerKm % 60)).padStart(2, '0') + ' /km · '
        + (raceKey === 'runmarathon' ? 'smooth and controlled' : 'settle in, do not chase it')
      : (raceKey === 'runmarathon'
        ? 'Between your long run and tempo pace, smooth and controlled'
        : 'Around your tempo pace, controlled'),
  };
}
