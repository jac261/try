import { effDate } from './schedule.js';
import { DISCIPLINES } from './disciplines.js';
import { RACES } from './domain.js';
import { bikeFuellingPlan } from './bike-fuelling.js';
import { runFuellingPlan } from './run-fuelling.js';
import { longRideObjective } from './bike-long.js';

/* The Today briefing (phase 5, spec §5/§24): where am I in the plan, what
 * matters most today, and what does today's session need from me before I
 * start it. A pure READ over the generated plan — it computes nothing the
 * generator did not encode, and every sentence it can emit states only what
 * the engine actually does.
 *
 * Deliberately a different question from ReadinessCard's inline pick: that
 * one finds the HARD session (the one worth easing when readiness is low);
 * this one names the day's PRIMARY session (the one the day is shaped
 * around). A long endurance ride is rarely the hard pick but is almost
 * always the primary.
 *
 * The week label is composed here from the structured week fields rather
 * than reusing TodayView/WeeklyDigest/PlanView's hand-built strings: those
 * three are differently shaped from different sources, and a shared
 * options-API helper saves nothing (named decision, phase 5 plan). */

// Priority ranking, first match wins; ties keep plan order. The flags are
// the generator's own: race day replaces the day, tests and tune-ups are
// injected as key, key marks long/brick roles, quality is the day's reason
// on ordinary days. A stacked double (second: true) is support by
// construction and never primary while any non-second session is present.
const RANK = w => w.race ? 0 : w.bRace ? 1 : w.test ? 2 : w.key ? 3 : w.role === 'quality' ? 4 : 5;

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
// Lowercase a workout type for mid-sentence use without mangling acronyms:
// 'CSS Intervals' reads "CSS intervals", never "css intervals".
const lowerType = s => String(s).split(' ')
  .map(word => /[A-Z]{2}/.test(word) ? word : word.toLowerCase()).join(' ');

// The athlete-facing name of a session for the priority and dependency
// lines: "the long ride", "the brick session", "the bike threshold",
// "the swim test", "strength".
export function sessionLabel(w) {
  if (w.race) return 'race day';
  // Tune-ups are injected as { bRace, type: 'RACE' } with no race flag; the
  // fallthrough read "the run RACE" (gauntlet 2026-08-01). They are a race
  // rehearsal and the label says so, brick or run alike.
  if (w.bRace) return 'the tune-up race';
  if (w.test) return 'the ' + ((DISCIPLINES[w.discipline] || {}).name || w.discipline).toLowerCase() + ' test';
  if (w.discipline === 'brick') return 'the brick session';
  if (w.discipline === 'strength') return 'strength';
  const d = ((DISCIPLINES[w.discipline] || {}).name || w.discipline).toLowerCase();
  const noun = w.discipline === 'bike' ? 'ride' : w.discipline === 'run' ? 'run' : 'swim';
  if (w.role === 'long' || w.type === 'Long') return 'the long ' + noun;
  // Adjective-shaped types read adjective-first: "the easy run", never
  // "the run easy" (gauntlet 2026-08-01). Open Water names the swim it is.
  if (w.type === 'Easy') return 'the easy ' + noun;
  if (w.type === 'Open Water') return 'the open water swim';
  return 'the ' + d + ' ' + lowerType(w.type || w.role || 'session');
}

export function todayBriefing({ plan, todayISO, moves, fuelLog, easedOf, log }) {
  if (!plan || plan.race === 'tracker' || !Array.isArray(plan.weeks) || !plan.weeks.length) return null;
  const ease = easedOf || (w => w);
  const all = plan.weeks.flatMap(wk => wk.workouts);
  const today = all.filter(w => effDate(w, moves) === todayISO).map(ease);
  const real = today.filter(w => w.discipline !== 'rest');
  // On an empty day OUTSIDE the plan's own dates the briefing has nothing
  // true to say: the scheduled post-race recovery week is in range and
  // briefs honestly, but beyond it a confident "Rest day" would be the
  // selector talking past the end of its knowledge (gauntlet 2026-08-01).
  // The plan-edge chips own that territory. A session MOVED out there still
  // gets its briefing: real work is real wherever it lands.
  if (!real.length && (!all.length || todayISO < all[0].date || todayISO > all[all.length - 1].date)) return null;

  // The current week, by WeekOverview's exact rule; a second week-resolution
  // rule would eventually disagree with the one the athlete already sees.
  const curWeek = plan.weeks.find(wk => wk.workouts.some(x => x.date >= todayISO)) || plan.weeks[plan.weeks.length - 1];
  const week = { no: curWeek.index + 1, total: plan.totalWeeks, phase: curWeek.phase, isRecovery: !!curWeek.isRecovery };

  const raceDay = real.some(w => w.race);
  const maintenance = !!(RACES[plan.race] || {}).noRace;
  const contextLine = raceDay ? 'Race week'
    : week.isRecovery ? 'Recovery week · week ' + week.no + ' of ' + week.total
      : maintenance ? 'Maintenance · week ' + week.no + ' of ' + week.total
        : week.phase + ' · week ' + week.no + ' of ' + week.total;

  // Primary: the highest-ranked session, doubles never beating a non-double.
  const nonSecond = real.filter(w => !w.second);
  const pool = nonSecond.length ? nonSecond : real;
  const primary = pool.length ? pool.reduce((a, b) => (RANK(b) < RANK(a) ? b : a)) : null;

  const priorityLine = raceDay ? 'Race day. It is the only session that matters today.'
    : week.isRecovery && real.length ? 'Keep today controlled even if you feel strong.'
      : !real.length ? 'Rest day. Recover and adapt.'
        : primary ? "Today's priority: " + sessionLabel(primary) : null;

  // Primary marking and dependency copy exist only when the day actually has
  // a choice to make (spec: multiples only), and never on race day.
  const multi = real.length >= 2 && !raceDay;
  const primaryId = multi && primary ? primary.id : null;

  let dependencyLine = null;
  if (multi && primary) {
    /* The dependency copy asserts ENGINE intent, so it may only speak when
       the whole day is a day the engine built: every session present shares
       the primary's RAW generated date. A double dragged onto some other
       session's day is an athlete-assembled co-location, and "stacked here
       on purpose" would be a fabrication (gauntlet 2026-08-01: one ordinary
       reschedule put that sentence on an easy swim day) — and a pairing
       parked beside a resident session makes a mixed day the engine never
       shaped either. A pairing moved TOGETHER to an empty day keeps its raw
       dates equal, and the statement stays true wherever it lands. */
    const engineDay = real.every(w => w.date === primary.date);
    const paired = engineDay ? real.filter(w => w.id !== primary.id) : [];
    const strengthDouble = paired.find(w => w.second && w.discipline === 'strength');
    const volumeDouble = paired.find(w => w.second && w.discipline === 'bike' && w.role === 'easy');
    const easySecondary = paired.find(w => w.role === 'easy');
    if (strengthDouble) {
      dependencyLine = 'Strength is stacked here on purpose: it lands on the day that is already working hardest, so your easy days stay easy.';
    } else if (volumeDouble) {
      dependencyLine = 'The second ride is added volume, built easy on purpose. ' + cap(sessionLabel(primary)) + ' is what today is shaped around.';
    } else if (easySecondary) {
      dependencyLine = 'Keep the ' + ((DISCIPLINES[easySecondary.discipline] || {}).name || easySecondary.discipline).toLowerCase()
        + ' easy. Today is shaped around ' + sessionLabel(primary) + '.';
    }
    // Sessions co-located by the athlete's own moves get no line: the engine
    // did not build that day and has nothing true to say about it. It also
    // encodes no intra-day order at all, which is why no branch above ever
    // says "do X first".
  }

  // Preparation cues, computed with exactly the inputs DetailSheet uses for
  // the same session (eased workout, profile, fuelLog, brickFollows), so the
  // numbers here can never disagree with the sheet one tap deeper. The
  // helpers self-gate (wrong discipline, under threshold, race) and return
  // null, so a session that needs nothing shows nothing.
  const cues = {};
  for (const w of real) {
    // A logged session needs no preparation: the cue's job ended when the
    // session started (gauntlet 2026-08-01: partially-done days kept prep
    // advice under the finished row).
    if (log && log[w.id]) continue;
    const list = [];
    const brickFollows = w.discipline === 'brick';
    const bike = bikeFuellingPlan({ workout: w, profile: plan.profile, fuelLog, brickFollows });
    if (bike) list.push({ icon: 'flame', text: bike.carbsPerHour + ' g carbs an hour · start inside the first ' + bike.startAfterMin + ' min' });
    const run = runFuellingPlan({ workout: w, profile: plan.profile, fuelLog });
    if (run) list.push({ icon: 'flame', text: run.carbPerHour + ' g carbs an hour · ' + run.fluidMlPerHour[0] + ' to ' + run.fluidMlPerHour[1] + ' ml fluid an hour' });
    const obj = longRideObjective({ workout: w, seed: w.seed, brickFollows });
    if (obj && obj.focusCueAlone && list.length < 2) list.push({ icon: 'bolt', text: obj.focusCueAlone });
    if (list.length) cues[w.id] = list.slice(0, 2);
  }

  return { week, contextLine, priorityLine, primaryId, dependencyLine, cues };
}
