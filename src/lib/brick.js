/* Try — did the bike set the run up, or ruin it? (phase 6 §4)
 *
 * §4's sentence is the whole module: "A bike execution that repeatedly
 * destroys the run should not be scored as successful triathlon pacing." A
 * ride reviewed on its own can be excellent and still be the wrong ride, and
 * nothing in the app has ever been able to say so, because the bike review
 * and the run review never looked at each other.
 *
 * REPEATEDLY is load-bearing and is enforced, not decorated. One wrecked run
 * off the bike is a hot day, a bad breakfast, or a rider who went too hard
 * once on purpose. It takes a pattern to argue that someone's habitual bike
 * pacing is the problem, and the pattern is what this returns; a single brick
 * only ever gets a description.
 *
 * WHAT IT CANNOT SEE, said plainly rather than left as an absence: transition
 * duration. §4 lists it, and activities carry a DATE but no time of day, so
 * the gap between the ride ending and the run starting is not recoverable. It
 * is in the backend handoff with the other timing asks. Early-run
 * DETERIORATION needs the run's own laps and is read only when they arrive.
 */
import { RACES } from './domain.js';
import { brickPairFor } from './autolog.js';
import { FUEL_LEVEL_GRAMS, FUELLING_RULES, bikeFuellingPlan } from './bike-fuelling.js';

export const BRICK_RULES = {
  // A run off the bike is legitimately slower than the same run fresh. This
  // is the allowance before slowness means anything at all; below it, the
  // athlete simply ran off a bike.
  paceAllowancePct: 8,
  ruinedPct: 18,        // this much slower than the allowance = the run went
  window: 3,            // bricks considered for a pattern
  minPattern: 2,        // this many ruined inside the window = a pattern
  hardRideFrac: 0.85,   // ride average this far above threshold sets up badly
};

/* §3.3: the transition, derived from the delivered timestamps and only when
   they can be trusted: both starts present and parseable, the ride's
   elapsed known (moving time cannot say when a ride ENDED), the run after
   the ride, and the gap inside a plausibility window. Outside any of that
   the answer is null — unknown, never a guess. The window is generous
   because training bricks include faff a race T2 does not. */
export const TRANSITION_RULES = { maxSec: 30 * 60 };
export function transitionSecFor(ride, run) {
  if (!ride || !run || !ride.startedAt || !run.startedAt || ride.elapsedTimeSec == null) return null;
  const rideStart = Date.parse(ride.startedAt);
  const runStart = Date.parse(run.startedAt);
  if (!Number.isFinite(rideStart) || !Number.isFinite(runStart)) return null;
  const t = Math.round((runStart - (rideStart + ride.elapsedTimeSec * 1000)) / 1000);
  if (t < 0 || t > TRANSITION_RULES.maxSec) return null;
  return t;
}

/* One brick, described. Never a verdict on the athlete's pacing: that needs
   several, and brickPattern is where it lives. */
export function brickExecution({ ride, run, paces, fuelLevel, raceType, fuellingPlan }) {
  if (!ride || !run || !run.movingTimeSec || !run.distance) return null;
  const pc = paces || {};
  const target = pc.run && (pc.run.long || pc.run.easy);
  if (!target) return null;

  const secPerKm = run.movingTimeSec / (run.distance / 1000);
  // how far past the honest brick allowance the run actually came in
  const allowed = target * (1 + BRICK_RULES.paceAllowancePct / 100);
  const overPct = (secPerKm - allowed) / allowed * 100;
  const ruined = overPct >= BRICK_RULES.ruinedPct;

  // the bike-side explanations, in the order they usually apply
  const causes = [];
  const realFtp = !!(pc.ftp && !pc.ftpEstimated);
  if (realFtp && ride.averageWatts && ride.averageWatts / pc.ftp >= BRICK_RULES.hardRideFrac) {
    causes.push({ key: 'ride-hard', text: 'the ride averaged close to your threshold, which is not a pace anyone runs well off' });
  }
  /* Under-fuelling is judged against WHAT THIS SESSION ASKED FOR, not an
     absolute. A short brick gets no fuelling plan at all — the app decides
     deliberately that it runs on what you already had — and an athlete who
     correctly took nothing was then accused of under-fuelling it. No plan
     means no shortfall to accuse anyone of. */
  const asked = fuellingPlan && fuellingPlan.carbsPerHour;
  if (asked && fuelLevel && FUEL_LEVEL_GRAMS[fuelLevel] != null
    && FUEL_LEVEL_GRAMS[fuelLevel] <= asked - FUELLING_RULES.shortfallGrams) {
    causes.push({ key: 'under-fuelled', text: 'you took in well under what the session asked for, and the run is where that shows up' });
  }
  if (run.rpe != null && run.rpe >= 8) {
    causes.push({ key: 'run-maximal', text: 'you rated the run near maximal, so it cost more than a brick run should' });
  }

  const race = RACES[raceType];
  return {
    ruined,
    overPct: Math.round(overPct * 10) / 10,
    runSecPerKm: Math.round(secPerKm),
    targetSecPerKm: Math.round(target),
    rideWatts: ride.averageWatts != null ? Math.round(ride.averageWatts) : null,
    runHr: run.averageHeartrate != null ? Math.round(run.averageHeartrate) : null,
    runRpe: run.rpe != null ? run.rpe : null,
    causes: causes.map(c => c.key),
    date: run.date || ride.date || null,
    // §4: live since 2026-07-30 — startedAt and elapsedTimeSec arrive on
    // the feed. Null whenever either timestamp is missing or implausible.
    transitionSec: transitionSecFor(ride, run),
    /* Three bands, not two. The non-ruined branch used to be an unconditional
       else, so a run twenty-seven per cent down on fresh pace was told it came
       in "close to the pace you hold fresh" — praise for a session that went
       badly, which is worse than saying nothing. */
    text: ruined
      ? 'Your run off this ride came in well below the pace you hold fresh'
        + (causes.length ? ', and ' + causes[0].text : '') + '.'
      : overPct > 0
        ? 'Your run off this ride came in a little down on the pace you hold fresh, which is normal off a ride this long.'
        : 'You ran off this ride at close to the pace you hold fresh, which is the point of a brick'
          + (race ? ' and the thing ' + race.name + ' actually asks for' : '') + '.',
  };
}

/* §4: the pattern. This is the only thing allowed to say a rider's bike
   pacing is wrong, and it needs the pattern to say it. */
export function brickPattern(executions) {
  const usable = (executions || []).filter(Boolean).slice(0, BRICK_RULES.window);
  if (usable.length < BRICK_RULES.minPattern) return null;
  const ruined = usable.filter(e => e.ruined);
  if (ruined.length < BRICK_RULES.minPattern) return null;
  // the explanation shared by the ruined ones, when there is a shared one
  const counts = {};
  ruined.forEach(e => (e.causes || []).forEach(c => { counts[c] = (counts[c] || 0) + 1; }));
  const shared = Object.keys(counts).filter(c => counts[c] >= BRICK_RULES.minPattern);
  const CAUSE_ADVICE = {
    'ride-hard': 'Ride the bike leg easier than feels right. The time you give up on the bike is smaller than the time the run takes back.',
    'under-fuelled': 'Fuel the bike leg to the plan on the card. A brick run is where an under-fuelled ride presents its bill.',
    'run-maximal': 'Start the run at an effort you could hold for the whole distance, rather than at the effort the first kilometre allows.',
  };
  return {
    sessions: usable.length,
    ruined: ruined.length,
    causes: shared,
    latest: ruined.map(e => e.date).filter(Boolean).sort().pop() || null,
    /* §4's acceptance criterion, in one sentence: the bike is not scored as
       successful triathlon pacing just because the ride itself was good. */
    text: 'Your last ' + ruined.length + ' brick runs came in well down on the pace you hold fresh. '
      + (shared.length ? CAUSE_ADVICE[shared[0]] : 'The rides themselves looked fine, which is the point: how a bike leg is ridden shows up in the run, not in the ride.'),
  };
}

/* The recent bricks an athlete has actually completed, read straight off the
   plan and the activity feed, so §4's evidence has a way into the app rather
   than being a module nobody calls.
 *
 * That mattered enough to write down: the first cut of this phase shipped
 * brickExecution and brickPattern with ZERO consumers, exactly as the phase
 * before it shipped its load model with none. A model with no caller is not a
 * feature, and "bike review can use following-run evidence" is an acceptance
 * criterion, not an aspiration. */
export function brickHistory({ plan, activities, log, moves, paces, fuelLog, limit }) {
  if (!plan || !Array.isArray(activities)) return { executions: [], pattern: null };
  const used = new Set();
  /* Raced bricks stay OUT of this evidence, deliberately (design panel
     2026-07-30). The pattern is a HABIT read — REPEATEDLY is this module's
     own load-bearing word — and a raced bike leg is deliberate pacing, not
     habit. Worse, brickExecution judges the run against fresh long/easy
     pace, so a race-effort run off a race-effort ride is all but guaranteed
     'ruined': two tune-ups inside the small window would fabricate the
     accusation out of two sessions that went exactly to plan — and the
     inverse holds too: one fast race leg entering the window pushes a
     ruined brick out and silences a real pattern (gauntlet catch
     2026-07-30). Race-day fuelling still counts toward the proven gut
     ceiling (bike-fuelling.js) and race hours are real hours — this
     boundary is only about habit. */
  const bricks = (plan.weeks || []).flatMap(w => w.workouts || [])
    .filter(w => w.discipline === 'brick' && !w.race && !w.bRace && log && log[w.id])
    .sort((a, b) => (((moves && moves[b.id]) || b.date) < ((moves && moves[a.id]) || a.date) ? -1 : 1));
  const executions = [];
  for (const w of bricks) {
    if (limit && executions.length >= limit) break;
    const pair = brickPairFor({ workout: w, activities, moves, used });
    if (!pair) continue;
    used.add(pair.ride.id); used.add(pair.run.id);
    const level = fuelLog && fuelLog[pair.ride.id] && fuelLog[pair.ride.id].level;
    const e = brickExecution({
      ride: pair.ride, run: pair.run, paces, fuelLevel: level,
      raceType: (plan.profile || {}).raceType,
      fuellingPlan: bikeFuellingPlan({ workout: w, profile: plan.profile, fuelLog }),
    });
    if (e) executions.push(e);
  }
  return { executions, pattern: brickPattern(executions) };
}
